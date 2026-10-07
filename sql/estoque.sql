-- Estoque B2C por loja: posição atual (a view não guarda histórico, então não há comparativo).
-- Espelha os cards da página "Estoque" do dashboard Estoque B2C:
--   itens_disponiveis = sum_inventory_position_kpi -> SUM(available); a view já zera negativos por linha
--   itens_avaria      = sum_damaged_kpi -> SUM(damaged), negativo vira 0 depois da soma,
--                       e Pernod Ricard fica em branco
-- No modelo, a loja vem de dim_distributors (source_location_id = id), não de dim_sellers.
SELECT
  COALESCE(d.company_name, '(sem loja)') AS loja,
  SUM(i.available) AS itens_disponiveis,
  CASE
    WHEN d.company_name = 'Pernod Ricard' THEN NULL
    ELSE GREATEST(SUM(i.damaged), 0)
  END AS itens_avaria
FROM visualization_daily_records_context.vw_fat_inventory AS i
LEFT JOIN gold_master_data_context.dim_distributors AS d
  ON d.id = i.source_location_id
 AND d.business_model <> 'B2B'
WHERE i.business_model IN ('B2C', 'B2E')
GROUP BY d.company_name
