-- NPS por loja em janela móvel de 90 dias (atual) vs os 90 dias anteriores.
-- Mês corrente não serve: o volume é baixo (mediana mensal de 1 a ~300 respostas por loja)
-- e no começo do mês quase zera. Componentes aditivos; o site calcula
-- NPS = 100 × (promotores − detratores) ÷ respostas.
--
-- Espelha o dashboard NPS B2C:
--   respostas  = linhas com response_date preenchida (medida "Respostas")
--   promotores = nota 9 e 10, detratores = nota 0 a 6
--   loja       = dim_nps.company_name via nps_id. Sem o filtro B2C/B2E do modelo, para
--                incluir lojas B2B como a Mondelez.
--   data       = data da resposta (visão "Avaliação" do dashboard; o padrão de lá,
--                "Experiência", usa a data de disparo e muda meses já fechados)
-- response_date e nps são STRING na origem.
-- Parâmetro: @data_ref (DATE) = D-1.
WITH periodos AS (
  SELECT
    DATE_SUB(@data_ref, INTERVAL 89 DAY) AS ini_atual,
    @data_ref AS fim_atual,
    DATE_SUB(@data_ref, INTERVAL 179 DAY) AS ini_anterior,
    DATE_SUB(@data_ref, INTERVAL 90 DAY) AS fim_anterior
),

respostas AS (
  SELECT
    TRIM(d.company_name) AS loja,
    DATE(SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', f.response_date)) AS dia,
    SAFE_CAST(f.nps AS INT64) AS nota
  FROM visualization_marketing_context.vw_fat_nps AS f
  JOIN gold_master_data_context.dim_nps AS d
    ON d.id = f.nps_id
  WHERE f.response_date IS NOT NULL
)

SELECT
  r.loja,
  COUNTIF(r.dia BETWEEN p.ini_atual AND p.fim_atual) AS nps_respostas_atual,
  COUNTIF(r.dia BETWEEN p.ini_atual AND p.fim_atual AND r.nota BETWEEN 9 AND 10) AS nps_promotores_atual,
  COUNTIF(r.dia BETWEEN p.ini_atual AND p.fim_atual AND r.nota BETWEEN 0 AND 6) AS nps_detratores_atual,
  COUNTIF(r.dia BETWEEN p.ini_anterior AND p.fim_anterior) AS nps_respostas_anterior,
  COUNTIF(r.dia BETWEEN p.ini_anterior AND p.fim_anterior AND r.nota BETWEEN 9 AND 10) AS nps_promotores_anterior,
  COUNTIF(r.dia BETWEEN p.ini_anterior AND p.fim_anterior AND r.nota BETWEEN 0 AND 6) AS nps_detratores_anterior
FROM respostas AS r
CROSS JOIN periodos AS p
WHERE r.dia BETWEEN p.ini_anterior AND p.fim_atual
GROUP BY r.loja
