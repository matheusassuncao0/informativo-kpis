-- Desempenho de vendas (página "One page v2") por loja: GMV e SER, realizado e metas,
-- mais pedidos e itens para decompor a variação do GMV.
--
-- O modelo do Power BI lê as views equivalentes no Databricks; aqui são usadas as versões
-- BigQuery do infra-tech-catalog-views. Validado na unidade contra a One page em 2026-10-07.
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
--   Pedidos/itens = pedidos distintos e SUM(itens_faturado) com os mesmos filtros do GMV
--                   (não existem no dashboard; servem para separar volume de ticket)
--   Desconto      = SUM(desconto_faturado). Só algumas lojas preenchem (ex.: Estée Lauder,
--                   Hyperapharma); zero aqui quase sempre é "não informado", não "sem desconto"
--   Loja          = dim_sellers.company_name via seller_id = id, com fallback na
--                   vw_sellers_industria (sellers B2B). A meta é por tenant e fica presa ao
--                   seller flagship, então só aparece no company_name dele.
-- Tipo de venda comparado em minúsculas: a relação no Power BI não diferencia caixa.
--
-- Períodos (parâmetro @data_ref = D-1):
--   atual     dia 1 do mês até D-1
--   anterior  mesmo intervalo de dias no mês anterior (31/03 -> 28/02)
--   alinhado  mesmos dias da semana, 4 semanas antes (o "anterior" mistura dias da semana)
--   mes       metas do mês inteiro, para a projeção de fechamento
WITH periodos AS (
  SELECT
    DATE_TRUNC(@data_ref, MONTH) AS ini_atual,
    @data_ref AS fim_atual,
    LAST_DAY(@data_ref, MONTH) AS fim_mes,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 1 MONTH) AS ini_anterior,
    DATE_SUB(@data_ref, INTERVAL 1 MONTH) AS fim_anterior,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 28 DAY) AS ini_alinhado,
    DATE_SUB(@data_ref, INTERVAL 28 DAY) AS fim_alinhado
),

fatos AS (
  SELECT
    f.seller_id,
    'gmv' AS metrica,
    CAST(f.invoiced_date AS DATE) AS dia,
    CAST(f.receita_faturada AS FLOAT64) AS valor,
    f.order_code AS pedido,
    CAST(f.itens_faturado AS FLOAT64) AS itens,
    CAST(f.desconto_faturado AS FLOAT64) AS desconto,
    f.business_model_internal_fat AS modelo
  FROM visualization_order_cycle_context.vw_fat_order_sales_summary AS f
  WHERE f.invoice_canceled_date IS NULL
    AND COALESCE(f.invoice_deleted_on_source, FALSE) = FALSE
    AND (f.sefaz_status_normalized IS NULL OR f.sefaz_status_normalized IN ('FINALIZED', '[C]APROVADO'))
    AND LOWER(COALESCE(f.item_cfop_type, f.order_sale_type)) = 'venda'
    AND COALESCE(f.operation_type, '') <> 'E'

  UNION ALL

  SELECT s.seller_id, 'ser', CAST(s.invoiced_date AS DATE), CAST(s.ser_projetado AS FLOAT64), NULL, NULL, NULL, NULL
  FROM visualization_order_cycle_context.vw_ser_projetado AS s
  WHERE LOWER(s.item_cfop_type) = 'venda'

  UNION ALL

  SELECT seller_id, 'gmv_forecast', CAST(date AS DATE), CAST(goal_calculated AS FLOAT64), NULL, NULL, NULL, NULL
  FROM visualization_master_data_context.vw_dim_forecast

  UNION ALL

  SELECT seller_id, 'gmv_budget', CAST(date AS DATE), CAST(goal_calculated AS FLOAT64), NULL, NULL, NULL, NULL
  FROM visualization_master_data_context.vw_dim_goals

  UNION ALL

  SELECT seller_id, 'ser_forecast', CAST(date AS DATE), CAST(ser_goal_calculated AS FLOAT64), NULL, NULL, NULL, NULL
  FROM visualization_master_data_context.vw_dim_forecast_ser

  UNION ALL

  SELECT seller_id, 'ser_budget', CAST(date AS DATE), CAST(ser_goal_calculated AS FLOAT64), NULL, NULL, NULL, NULL
  FROM visualization_master_data_context.vw_dim_goal_ser
),

com_loja AS (
  SELECT
    TRIM(COALESCE(ds.company_name, si.company_name, '(sem loja)')) AS loja,
    f.*
  FROM fatos AS f
  CROSS JOIN periodos AS p
  LEFT JOIN gold_master_data_context.dim_sellers AS ds
    ON ds.id = f.seller_id
  -- Sellers B2B (de dim_manufacturers) só existem aqui; sem este join, ~40% do forecast
  -- caía em "(sem loja)" (Reppos, Faber Castell, Mondelez...). O id é único na view.
  LEFT JOIN visualization_master_data_context.vw_sellers_industria AS si
    ON si.id = f.seller_id
  -- Até fim_mes só para as metas: o realizado nunca passa de D-1 nos SUMs abaixo.
  WHERE f.dia BETWEEN LEAST(p.ini_anterior, p.ini_alinhado) AND p.fim_mes
),

-- Modelo de negócio com mais GMV na loja, para comparar lojas parecidas entre si
modelo AS (
  SELECT
    loja,
    ARRAY_AGG(modelo ORDER BY gmv DESC LIMIT 1)[OFFSET(0)] AS modelo
  FROM (
    SELECT loja, modelo, SUM(valor) AS gmv
    FROM com_loja
    WHERE metrica = 'gmv' AND modelo IS NOT NULL
    GROUP BY loja, modelo
  )
  GROUP BY loja
)

-- ELSE NULL (e não 0): sem venda no período, o card do dashboard fica em branco.
SELECT
  c.loja,
  ANY_VALUE(m.modelo) AS modelo,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.valor, NULL)) AS gmv_atual,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_anterior AND p.fim_anterior, c.valor, NULL)) AS gmv_anterior,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, c.valor, NULL)) AS gmv_alinhado,
  COUNT(DISTINCT IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.pedido, NULL)) AS pedidos_atual,
  COUNT(DISTINCT IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_anterior AND p.fim_anterior, c.pedido, NULL)) AS pedidos_anterior,
  COUNT(DISTINCT IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, c.pedido, NULL)) AS pedidos_alinhado,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.itens, NULL)) AS itens_atual,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_anterior AND p.fim_anterior, c.itens, NULL)) AS itens_anterior,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, c.itens, NULL)) AS itens_alinhado,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.desconto, NULL)) AS desconto_atual,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_anterior AND p.fim_anterior, c.desconto, NULL)) AS desconto_anterior,
  SUM(IF(c.metrica = 'gmv' AND c.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, c.desconto, NULL)) AS desconto_alinhado,
  SUM(IF(c.metrica = 'gmv_forecast' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.valor, NULL)) AS gmv_forecast,
  SUM(IF(c.metrica = 'gmv_budget' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.valor, NULL)) AS gmv_budget,
  SUM(IF(c.metrica = 'gmv_forecast' AND c.dia BETWEEN p.ini_atual AND p.fim_mes, c.valor, NULL)) AS gmv_forecast_mes,
  SUM(IF(c.metrica = 'gmv_budget' AND c.dia BETWEEN p.ini_atual AND p.fim_mes, c.valor, NULL)) AS gmv_budget_mes,
  SUM(IF(c.metrica = 'ser' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.valor, NULL)) AS ser_atual,
  SUM(IF(c.metrica = 'ser' AND c.dia BETWEEN p.ini_anterior AND p.fim_anterior, c.valor, NULL)) AS ser_anterior,
  SUM(IF(c.metrica = 'ser' AND c.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, c.valor, NULL)) AS ser_alinhado,
  SUM(IF(c.metrica = 'ser_forecast' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.valor, NULL)) AS ser_forecast,
  SUM(IF(c.metrica = 'ser_budget' AND c.dia BETWEEN p.ini_atual AND p.fim_atual, c.valor, NULL)) AS ser_budget,
  SUM(IF(c.metrica = 'ser_forecast' AND c.dia BETWEEN p.ini_atual AND p.fim_mes, c.valor, NULL)) AS ser_forecast_mes,
  SUM(IF(c.metrica = 'ser_budget' AND c.dia BETWEEN p.ini_atual AND p.fim_mes, c.valor, NULL)) AS ser_budget_mes
FROM com_loja AS c
CROSS JOIN periodos AS p
LEFT JOIN modelo AS m
  ON m.loja = c.loja
GROUP BY c.loja
