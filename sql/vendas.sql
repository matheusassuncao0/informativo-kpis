-- Desempenho de vendas (página "One page v2") por loja: GMV e SER, realizado e metas.
-- Mês corrente até D-1; realizado também no mesmo período do mês anterior.
--
-- ATENÇÃO: o modelo do Power BI lê as views equivalentes no Databricks
-- (prd_05/prd_09). Aqui são usadas as versões BigQuery do infra-tech-catalog-views,
-- que podem divergir. Validar contra o dashboard antes de publicar.
--
-- Regras espelhadas:
--   GMV realizado = receita_fat -> SUM(receita_faturada) por invoiced_date, sem NF cancelada,
--                   sem NF deletada (NULL conta como não deletada), SEFAZ NULL/FINALIZED/[C]APROVADO,
--                   tipo de venda 'Venda' em COALESCE(item_cfop_type, order_sale_type),
--                   operation_type <> 'E'. Devolução não é descontada.
--   SER estimado  = ser_realizado_base -> SUM(ser_projetado) com item_cfop_type = 'Venda'
--   Metas         = SUM(goal_calculated) / SUM(ser_goal_calculated) pelo dia da meta
--                   (fim de semana e feriado já vêm empurrados para o próximo dia útil)
--     forecast    = vw_dim_forecast / vw_dim_forecast_ser (padrão do dashboard)
--     budget      = vw_dim_goals / vw_dim_goal_ser
--   Loja          = dim_sellers.company_name via seller_id = id. A meta é por tenant e
--                   fica presa ao seller flagship, então só aparece no company_name dele.
-- Tipo de venda comparado em minúsculas: a relação no Power BI não diferencia caixa.
-- Metas do mês inteiro (*_mes) alimentam a projeção de fechamento no site.
-- Parâmetro: @data_ref (DATE) = D-1.
WITH periodos AS (
  SELECT
    DATE_TRUNC(@data_ref, MONTH) AS ini_atual,
    @data_ref AS fim_atual,
    LAST_DAY(@data_ref, MONTH) AS fim_mes,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 1 MONTH) AS ini_anterior,
    DATE_SUB(@data_ref, INTERVAL 1 MONTH) AS fim_anterior
),

fatos AS (
  SELECT
    f.seller_id,
    'gmv' AS metrica,
    CAST(f.invoiced_date AS DATE) AS dia,
    CAST(f.receita_faturada AS FLOAT64) AS valor
  FROM visualization_order_cycle_context.vw_fat_order_sales_summary AS f
  WHERE f.invoice_canceled_date IS NULL
    AND COALESCE(f.invoice_deleted_on_source, FALSE) = FALSE
    AND (f.sefaz_status_normalized IS NULL OR f.sefaz_status_normalized IN ('FINALIZED', '[C]APROVADO'))
    AND LOWER(COALESCE(f.item_cfop_type, f.order_sale_type)) = 'venda'
    AND COALESCE(f.operation_type, '') <> 'E'

  UNION ALL

  SELECT
    s.seller_id,
    'ser',
    CAST(s.invoiced_date AS DATE),
    CAST(s.ser_projetado AS FLOAT64)
  FROM visualization_order_cycle_context.vw_ser_projetado AS s
  WHERE LOWER(s.item_cfop_type) = 'venda'

  UNION ALL

  SELECT seller_id, 'gmv_forecast', CAST(date AS DATE), CAST(goal_calculated AS FLOAT64)
  FROM visualization_master_data_context.vw_dim_forecast

  UNION ALL

  SELECT seller_id, 'gmv_budget', CAST(date AS DATE), CAST(goal_calculated AS FLOAT64)
  FROM visualization_master_data_context.vw_dim_goals

  UNION ALL

  SELECT seller_id, 'ser_forecast', CAST(date AS DATE), CAST(ser_goal_calculated AS FLOAT64)
  FROM visualization_master_data_context.vw_dim_forecast_ser

  UNION ALL

  SELECT seller_id, 'ser_budget', CAST(date AS DATE), CAST(ser_goal_calculated AS FLOAT64)
  FROM visualization_master_data_context.vw_dim_goal_ser
)

-- ELSE NULL (e não 0): sem venda no período, o card do dashboard fica em branco.
SELECT
  TRIM(COALESCE(ds.company_name, si.company_name, '(sem loja)')) AS loja,
  SUM(IF(f.metrica = 'gmv' AND f.dia BETWEEN p.ini_atual AND p.fim_atual, f.valor, NULL)) AS gmv_atual,
  SUM(IF(f.metrica = 'gmv' AND f.dia BETWEEN p.ini_anterior AND p.fim_anterior, f.valor, NULL)) AS gmv_anterior,
  SUM(IF(f.metrica = 'gmv_forecast' AND f.dia BETWEEN p.ini_atual AND p.fim_atual, f.valor, NULL)) AS gmv_forecast,
  SUM(IF(f.metrica = 'gmv_budget' AND f.dia BETWEEN p.ini_atual AND p.fim_atual, f.valor, NULL)) AS gmv_budget,
  SUM(IF(f.metrica = 'ser' AND f.dia BETWEEN p.ini_atual AND p.fim_atual, f.valor, NULL)) AS ser_atual,
  SUM(IF(f.metrica = 'ser' AND f.dia BETWEEN p.ini_anterior AND p.fim_anterior, f.valor, NULL)) AS ser_anterior,
  SUM(IF(f.metrica = 'ser_forecast' AND f.dia BETWEEN p.ini_atual AND p.fim_atual, f.valor, NULL)) AS ser_forecast,
  SUM(IF(f.metrica = 'ser_budget' AND f.dia BETWEEN p.ini_atual AND p.fim_atual, f.valor, NULL)) AS ser_budget,
  SUM(IF(f.metrica = 'gmv_forecast' AND f.dia BETWEEN p.ini_atual AND p.fim_mes, f.valor, NULL)) AS gmv_forecast_mes,
  SUM(IF(f.metrica = 'gmv_budget' AND f.dia BETWEEN p.ini_atual AND p.fim_mes, f.valor, NULL)) AS gmv_budget_mes,
  SUM(IF(f.metrica = 'ser_forecast' AND f.dia BETWEEN p.ini_atual AND p.fim_mes, f.valor, NULL)) AS ser_forecast_mes,
  SUM(IF(f.metrica = 'ser_budget' AND f.dia BETWEEN p.ini_atual AND p.fim_mes, f.valor, NULL)) AS ser_budget_mes
FROM fatos AS f
CROSS JOIN periodos AS p
LEFT JOIN gold_master_data_context.dim_sellers AS ds
  ON ds.id = f.seller_id
-- Sellers B2B (de dim_manufacturers) só existem aqui; sem este join, ~40% do forecast
-- caía em "(sem loja)" (Reppos, Faber Castell, Mondelez...). O id é único na view.
LEFT JOIN visualization_master_data_context.vw_sellers_industria AS si
  ON si.id = f.seller_id
-- Até fim_mes só para as metas: o realizado nunca passa de D-1 nos SUMs acima.
WHERE f.dia BETWEEN p.ini_anterior AND p.fim_mes
GROUP BY loja
