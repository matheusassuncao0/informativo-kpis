-- OTD B2C por loja: mês corrente até D-1 vs mesmo período do mês anterior
-- e vs mesmos dias da semana 4 semanas antes.
-- Espelha o dashboard OTD B2C:
--   pedidos entregues = '# Delivered' -> SUM(delivered)
--   % OTD             = SUM(delivered_on_time) / SUM(delivered), ambos com delivered = 1
--                       (a razão é calculada no site, para o total de lojas sair certo)
--   data de recorte   = delivery_date (relacionamento ativo com dim_calendar)
--   loja              = dim_sellers.company_name via seller_code = code
-- Parâmetro: @data_ref (DATE) = D-1. 31/03 - 1 mês = 28/02 (o BigQuery ajusta o fim do mês).
WITH periodos AS (
  SELECT
    DATE_TRUNC(@data_ref, MONTH) AS ini_atual,
    @data_ref AS fim_atual,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 1 MONTH) AS ini_anterior,
    DATE_SUB(@data_ref, INTERVAL 1 MONTH) AS fim_anterior,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 28 DAY) AS ini_alinhado,
    DATE_SUB(@data_ref, INTERVAL 28 DAY) AS fim_alinhado
),

base AS (
  SELECT
    TRIM(COALESCE(s.company_name, '(sem loja)')) AS loja,
    f.delivery_date AS dia,
    f.delivered,
    f.delivered_on_time
  FROM visualization_order_cycle_context.vw_fat_delivery_pipeline AS f
  CROSS JOIN periodos AS p
  LEFT JOIN gold_master_data_context.dim_sellers AS s
    ON s.code = f.seller_code
  WHERE f.business_model <> 'B2B'
    AND f.delivered = 1
    AND f.delivery_date BETWEEN LEAST(p.ini_anterior, p.ini_alinhado) AND p.fim_atual
)

-- Os períodos se sobrepõem (anterior e alinhado), então cada um tem sua própria soma
SELECT
  b.loja,
  SUM(IF(b.dia BETWEEN p.ini_atual AND p.fim_atual, b.delivered, 0)) AS otd_entregues_atual,
  SUM(IF(b.dia BETWEEN p.ini_atual AND p.fim_atual, b.delivered_on_time, 0)) AS otd_no_prazo_atual,
  SUM(IF(b.dia BETWEEN p.ini_anterior AND p.fim_anterior, b.delivered, 0)) AS otd_entregues_anterior,
  SUM(IF(b.dia BETWEEN p.ini_anterior AND p.fim_anterior, b.delivered_on_time, 0)) AS otd_no_prazo_anterior,
  SUM(IF(b.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, b.delivered, 0)) AS otd_entregues_alinhado,
  SUM(IF(b.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, b.delivered_on_time, 0)) AS otd_no_prazo_alinhado
FROM base AS b
CROSS JOIN periodos AS p
GROUP BY b.loja
