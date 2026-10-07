-- Farol de CS por loja: classificação manual do time de CS (planilha Google), só o estado
-- atual, sem histórico. Valores: Feliz, Atenção, Churn.
-- A view tem uma linha por company_name × business_model_internal; quando a loja tem mais
-- de um farol, fica o pior. O detalhe por modelo de negócio vai junto.
-- Tenants da planilha sem company_name correspondente somem no join da própria view.
WITH linhas_farol AS (
  SELECT
    TRIM(company_name) AS loja,
    business_model_internal,
    TRIM(farol) AS farol
  FROM visualization_master_data_context.vw_dim_farol
  WHERE company_name IS NOT NULL
    AND farol IS NOT NULL
)

SELECT
  loja,
  ARRAY_AGG(farol ORDER BY CASE farol WHEN 'Churn' THEN 1 WHEN 'Atenção' THEN 2 WHEN 'Feliz' THEN 3 ELSE 4 END LIMIT 1)[OFFSET(0)] AS farol_cs,
  STRING_AGG(DISTINCT CONCAT(IFNULL(business_model_internal, '?'), ': ', farol), '; ') AS farol_cs_detalhe
FROM linhas_farol
GROUP BY loja
