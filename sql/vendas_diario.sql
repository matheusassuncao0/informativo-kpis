-- Série diária do mês corrente por loja: GMV realizado (até D-1) e metas (mês inteiro).
-- Alimenta a faixa da projeção de fechamento. Mesmas regras de GMV e meta de vendas.sql.
-- Parâmetro: @data_ref (DATE) = D-1.
WITH periodos AS (
  SELECT
    DATE_TRUNC(@data_ref, MONTH) AS ini,
    @data_ref AS fim,
    LAST_DAY(@data_ref, MONTH) AS fim_mes
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

  SELECT seller_id, 'gmv_forecast', CAST(date AS DATE), CAST(goal_calculated AS FLOAT64)
  FROM visualization_master_data_context.vw_dim_forecast

  UNION ALL

  SELECT seller_id, 'gmv_budget', CAST(date AS DATE), CAST(goal_calculated AS FLOAT64)
  FROM visualization_master_data_context.vw_dim_goals
)

SELECT
  TRIM(COALESCE(ds.company_name, si.company_name, '(sem loja)')) AS loja,
  FORMAT_DATE('%F', f.dia) AS dia,
  SUM(IF(f.metrica = 'gmv' AND f.dia <= p.fim, f.valor, NULL)) AS gmv,
  SUM(IF(f.metrica = 'gmv_forecast', f.valor, NULL)) AS gmv_forecast,
  SUM(IF(f.metrica = 'gmv_budget', f.valor, NULL)) AS gmv_budget
FROM fatos AS f
CROSS JOIN periodos AS p
LEFT JOIN gold_master_data_context.dim_sellers AS ds
  ON ds.id = f.seller_id
LEFT JOIN visualization_master_data_context.vw_sellers_industria AS si
  ON si.id = f.seller_id
WHERE f.dia BETWEEN p.ini AND p.fim_mes
GROUP BY 1, 2
