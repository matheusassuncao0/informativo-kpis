-- Funil de Growth por loja: sessões e transações do Google Analytics (GA4).
-- Conversão = transações ÷ sessões, calculada no site sobre as somas. Os dashboards GA B2C e
-- Desempenho de vendas fazem média das taxas linha a linha, o que distorce (ex.: Wella aparece
-- caindo quando a razão real sobe); por isso aqui não é igual ao dashboard, de propósito.
--
-- Fonte: gold_engagement_context.fat_analytics (recarga completa diária; a view do GA B2C é
-- um reagrupamento dela). Grão único (dia × propriedade × país × host × device × origem ×
-- mídia × campanha), então somar não duplica. Receita GA fica de fora: vem na moeda de cada
-- propriedade.
-- Loja: seller_id = dim_sellers.id (registro "google_analytics" da loja); 5 propriedades sem
-- registro caem no cadastro de growth (bronze_google_sheet.growth_brands) pelo id da GA4.
--
-- Períodos até D-2: a carga roda de madrugada e o GA ainda não fechou o D-1 (vem com ~30%
-- menos sessões e é corrigido no dia seguinte). Os três períodos perdem o último dia, para
-- a comparação continuar justa.
-- Parâmetro: @data_ref (DATE) = D-1.
WITH periodos AS (
  SELECT
    DATE_TRUNC(@data_ref, MONTH) AS ini_atual,
    DATE_SUB(@data_ref, INTERVAL 1 DAY) AS fim_atual,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 1 MONTH) AS ini_anterior,
    DATE_SUB(DATE_SUB(@data_ref, INTERVAL 1 MONTH), INTERVAL 1 DAY) AS fim_anterior,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 28 DAY) AS ini_alinhado,
    DATE_SUB(@data_ref, INTERVAL 29 DAY) AS fim_alinhado
),

ga AS (
  SELECT
    g.seller_id,
    g.data_source,
    DATE(g.date) AS dia,
    g.sessions,
    g.transactions
  FROM gold_engagement_context.fat_analytics AS g
  CROSS JOIN periodos AS p
  WHERE g.date >= TIMESTAMP(LEAST(p.ini_anterior, p.ini_alinhado))
    AND g.date < TIMESTAMP(@data_ref)
),

cadastro_growth AS (
  SELECT id_propriedade_ga4, ANY_VALUE(marca) AS marca
  FROM bronze_google_sheet.growth_brands
  WHERE id_propriedade_ga4 IS NOT NULL
  GROUP BY id_propriedade_ga4
),

com_loja AS (
  SELECT
    TRIM(COALESCE(ds.company_name, si.company_name, cg.marca, CONCAT('(GA sem loja) ', ga.data_source))) AS loja,
    ga.*
  FROM ga
  LEFT JOIN gold_master_data_context.dim_sellers AS ds
    ON ds.id = ga.seller_id
  LEFT JOIN visualization_master_data_context.vw_sellers_industria AS si
    ON si.id = ga.seller_id
  LEFT JOIN cadastro_growth AS cg
    ON cg.id_propriedade_ga4 = REGEXP_EXTRACT(ga.data_source, r'_(\d+)$')
)

SELECT
  c.loja,
  SUM(IF(c.dia BETWEEN p.ini_atual AND p.fim_atual, c.sessions, NULL)) AS sessoes_atual,
  SUM(IF(c.dia BETWEEN p.ini_anterior AND p.fim_anterior, c.sessions, NULL)) AS sessoes_anterior,
  SUM(IF(c.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, c.sessions, NULL)) AS sessoes_alinhado,
  SUM(IF(c.dia BETWEEN p.ini_atual AND p.fim_atual, c.transactions, NULL)) AS transacoes_atual,
  SUM(IF(c.dia BETWEEN p.ini_anterior AND p.fim_anterior, c.transactions, NULL)) AS transacoes_anterior,
  SUM(IF(c.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, c.transactions, NULL)) AS transacoes_alinhado
FROM com_loja AS c
CROSS JOIN periodos AS p
GROUP BY c.loja
