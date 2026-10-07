-- Estoque B2C por loja: posição atual (a view não guarda histórico, então não há comparativo).
-- Espelha os cards da página "Estoque" do dashboard Estoque B2C:
--   itens_disponiveis = sum_inventory_position_kpi -> SUM(available); a view já zera negativos por linha
--   itens_avaria      = sum_damaged_kpi -> SUM(damaged), negativo vira 0 depois da soma,
--                       e Pernod Ricard fica em branco
-- No modelo, a loja vem de dim_distributors (source_location_id = id), não de dim_sellers.
--
-- Ruptura e demanda (não existem como card no dashboard):
--   inventory_classification = 'ruptura'  -> sem estoque e com venda média > 0 (demanda perdida)
--                              'stockout' -> sem estoque e sem venda (fica de fora)
--   A DAX do dashboard procura "giro normal", valor que não existe na view.
--   demanda_dia          = SUM(daily_average_last_90_days), unidades vendidas por dia
--   demanda_dia_ruptura  = a mesma soma só dos SKUs em ruptura: venda que deixa de acontecer
--   disponivel_com_venda = estoque só dos SKUs que vendem; base da cobertura em dias (os
--                          SKUs parados, centenas de milhares, levariam a milhares de dias)
--   estoque_ultima_integracao = última integração da loja; lojas inativas param de integrar e
--                          seguem com estoque na view
SELECT
  TRIM(COALESCE(d.company_name, '(sem loja)')) AS loja,
  SUM(i.available) AS itens_disponiveis,
  CASE
    WHEN d.company_name = 'Pernod Ricard' THEN NULL
    ELSE GREATEST(SUM(i.damaged), 0)
  END AS itens_avaria,
  COUNT(DISTINCT IF(i.daily_average_last_90_days > 0, i.product_code, NULL)) AS skus_com_venda,
  COUNT(DISTINCT IF(i.inventory_classification = 'ruptura', i.product_code, NULL)) AS skus_ruptura,
  COUNT(DISTINCT IF(i.inventory_classification = 'ruptura' AND i.abc_curve = 'A', i.product_code, NULL)) AS skus_ruptura_a,
  COUNT(DISTINCT IF(i.inventory_classification = 'risco de ruptura', i.product_code, NULL)) AS skus_risco_ruptura,
  SUM(IF(i.daily_average_last_90_days > 0, i.available, 0)) AS disponivel_com_venda,
  SUM(i.daily_average_last_90_days) AS demanda_dia,
  SUM(IF(i.inventory_classification = 'ruptura', i.daily_average_last_90_days, 0)) AS demanda_dia_ruptura,
  FORMAT_DATE('%F', MAX(CAST(i.last_integration_date AS DATE))) AS estoque_ultima_integracao
FROM visualization_daily_records_context.vw_fat_inventory AS i
LEFT JOIN gold_master_data_context.dim_distributors AS d
  ON d.id = i.source_location_id
 AND d.business_model <> 'B2B'
WHERE i.business_model IN ('B2C', 'B2E')
GROUP BY d.company_name
