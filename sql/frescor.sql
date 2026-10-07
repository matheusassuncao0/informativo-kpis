-- Quando cada fonte do site foi carregada e até que dia vai o dado.
-- As vw_* da camada visualization são tabelas materializadas no prd, então a hora de
-- modificação da tabela (__TABLES__) é a "última carga" que o site enxerga.
-- Colunas de data dentro das views não servem para isso: há datas futuras (até o ano 5202)
-- e fusos misturados.
--   ultima_carga  TIMESTAMP da última recriação da tabela que o site lê
--   dado_ate      dia mais recente com dado (vendas e OTD pelas partições da gold, que
--                 custa quase nada; estoque e NPS pela própria view)
WITH carga AS (
  SELECT 'Vendas' AS fonte, last_modified_time FROM visualization_order_cycle_context.__TABLES__ WHERE table_id = 'vw_fat_order_sales_summary'
  UNION ALL
  SELECT 'OTD', last_modified_time FROM visualization_order_cycle_context.__TABLES__ WHERE table_id = 'vw_fat_delivery_pipeline'
  UNION ALL
  SELECT 'Estoque', last_modified_time FROM visualization_daily_records_context.__TABLES__ WHERE table_id = 'vw_fat_inventory'
  UNION ALL
  SELECT 'NPS', last_modified_time FROM visualization_marketing_context.__TABLES__ WHERE table_id = 'vw_fat_nps'
  UNION ALL
  SELECT 'Farol de CS', last_modified_time FROM visualization_master_data_context.__TABLES__ WHERE table_id = 'vw_dim_farol'
),

conteudo AS (
  SELECT
    IF(table_name = 'fat_order_sales', 'Vendas', 'OTD') AS fonte,
    MAX(SAFE.PARSE_DATE('%Y%m%d', partition_id)) AS dado_ate
  FROM gold_order_cycle_context.INFORMATION_SCHEMA.PARTITIONS
  WHERE table_name IN ('fat_order_sales', 'fat_order_tracking')
    AND total_rows > 0
    AND SAFE.PARSE_DATE('%Y%m%d', partition_id) <= CURRENT_DATE('America/Sao_Paulo')
  GROUP BY 1

  UNION ALL

  SELECT 'Estoque', MAX(CAST(last_integration_date AS DATE))
  FROM visualization_daily_records_context.vw_fat_inventory
  WHERE CAST(last_integration_date AS DATE) <= CURRENT_DATE('America/Sao_Paulo')

  UNION ALL

  SELECT 'NPS', MAX(DATE(SAFE.PARSE_DATETIME('%Y-%m-%d %H:%M:%S', response_date)))
  FROM visualization_marketing_context.vw_fat_nps
)

SELECT
  c.fonte,
  TIMESTAMP_MILLIS(c.last_modified_time) AS ultima_carga,
  FORMAT_DATE('%F', d.dado_ate) AS dado_ate
FROM carga AS c
LEFT JOIN conteudo AS d
  USING (fonte)
