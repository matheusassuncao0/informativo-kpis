-- GMV por loja e canal de venda: de onde veio (ou para onde foi) a variação.
-- Mesmos filtros de GMV de vendas.sql. Canal = dim_sales_channels.sales_channel_normalized,
-- com o site próprio (type = 'flagship') agrupado como "Site próprio".
-- Períodos iguais aos de vendas.sql (atual, anterior e alinhado). Parâmetro: @data_ref (DATE) = D-1.
WITH periodos AS (
  SELECT
    DATE_TRUNC(@data_ref, MONTH) AS ini_atual,
    @data_ref AS fim_atual,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 1 MONTH) AS ini_anterior,
    DATE_SUB(@data_ref, INTERVAL 1 MONTH) AS fim_anterior,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 28 DAY) AS ini_alinhado,
    DATE_SUB(@data_ref, INTERVAL 28 DAY) AS fim_alinhado
),

vendas AS (
  SELECT
    TRIM(COALESCE(ds.company_name, si.company_name, '(sem loja)')) AS loja,
    CASE sc.type
      WHEN 'flagship' THEN 'Site próprio'
      WHEN 'marketplace' THEN 'Marketplace'
      WHEN 'darkstore' THEN 'Darkstore'
      WHEN 'omnichannel' THEN 'Omnichannel'
      ELSE 'Sem informação'
    END AS tipo,
    CASE
      WHEN sc.type = 'flagship' THEN 'Site próprio'
      WHEN sc.sales_channel_normalized IS NULL
        OR LOWER(TRIM(sc.sales_channel_normalized)) IN ('', 'null', 'sem informação') THEN 'Sem informação'
      ELSE TRIM(sc.sales_channel_normalized)
    END AS canal,
    CAST(f.invoiced_date AS DATE) AS dia,
    CAST(f.receita_faturada AS FLOAT64) AS valor
  FROM visualization_order_cycle_context.vw_fat_order_sales_summary AS f
  LEFT JOIN gold_master_data_context.dim_sales_channels AS sc
    ON sc.id = f.sales_channel_id
  LEFT JOIN gold_master_data_context.dim_sellers AS ds
    ON ds.id = f.seller_id
  LEFT JOIN visualization_master_data_context.vw_sellers_industria AS si
    ON si.id = f.seller_id
  WHERE f.invoice_canceled_date IS NULL
    AND COALESCE(f.invoice_deleted_on_source, FALSE) = FALSE
    AND (f.sefaz_status_normalized IS NULL OR f.sefaz_status_normalized IN ('FINALIZED', '[C]APROVADO'))
    AND LOWER(COALESCE(f.item_cfop_type, f.order_sale_type)) = 'venda'
    AND COALESCE(f.operation_type, '') <> 'E'
)

SELECT
  v.loja,
  v.tipo,
  v.canal,
  SUM(IF(v.dia BETWEEN p.ini_atual AND p.fim_atual, v.valor, NULL)) AS gmv_atual,
  SUM(IF(v.dia BETWEEN p.ini_anterior AND p.fim_anterior, v.valor, NULL)) AS gmv_anterior,
  SUM(IF(v.dia BETWEEN p.ini_alinhado AND p.fim_alinhado, v.valor, NULL)) AS gmv_alinhado
FROM vendas AS v
CROSS JOIN periodos AS p
WHERE v.dia BETWEEN p.ini_anterior AND p.fim_atual
GROUP BY v.loja, v.tipo, v.canal
HAVING gmv_atual IS NOT NULL OR gmv_anterior IS NOT NULL OR gmv_alinhado IS NOT NULL
