-- OTD B2C por loja: mês corrente até D-1 vs mesmo período do mês anterior.
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
    DATE_SUB(@data_ref, INTERVAL 1 MONTH) AS fim_anterior
),

base AS (
  SELECT
    COALESCE(s.company_name, '(sem loja)') AS loja,
    CASE
      WHEN f.delivery_date BETWEEN p.ini_atual AND p.fim_atual THEN 'atual'
      WHEN f.delivery_date BETWEEN p.ini_anterior AND p.fim_anterior THEN 'anterior'
    END AS periodo,
    f.delivered,
    f.delivered_on_time
  FROM visualization_order_cycle_context.vw_fat_delivery_pipeline AS f
  CROSS JOIN periodos AS p
  LEFT JOIN gold_master_data_context.dim_sellers AS s
    ON s.code = f.seller_code
  WHERE f.business_model <> 'B2B'
    AND f.delivered = 1
    AND f.delivery_date BETWEEN p.ini_anterior AND p.fim_atual
)

SELECT
  loja,
  SUM(IF(periodo = 'atual', delivered, 0)) AS otd_entregues_atual,
  SUM(IF(periodo = 'atual', delivered_on_time, 0)) AS otd_no_prazo_atual,
  SUM(IF(periodo = 'anterior', delivered, 0)) AS otd_entregues_anterior,
  SUM(IF(periodo = 'anterior', delivered_on_time, 0)) AS otd_no_prazo_anterior
FROM base
WHERE periodo IS NOT NULL
GROUP BY loja
