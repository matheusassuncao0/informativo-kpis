-- As 5 promoções com mais GMV por loja no mês corrente até D-1, com o mesmo período do mês
-- anterior ao lado. Mesma fonte e regras de promocoes.sql (só VTEX flagship Brasil, valor
-- captado recortado pela data da NF, sem marcadores de desconto <= R$ 0,01).
-- gmv = rateio do item entre as promoções empilhadas (representativeness): soma entre
-- promoções sem duplicar. Pedidos NÃO somam entre promoções (um pedido pode ter várias).
-- Agrupado pelo nome da promoção, como no dashboard; o código do cupom não existe na fonte.
-- Parâmetro: @data_ref (DATE) = D-1.
WITH periodos AS (
  SELECT
    DATE_TRUNC(@data_ref, MONTH) AS ini_atual,
    @data_ref AS fim_atual,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 1 MONTH) AS ini_anterior,
    DATE_SUB(@data_ref, INTERVAL 1 MONTH) AS fim_anterior
),

linhas AS (
  SELECT
    v.order_code,
    v.item_code,
    v.item_index,
    v.promotion_index,
    ANY_VALUE(v.seller_id) AS seller_id,
    ANY_VALUE(v.invoiced_date) AS dia,
    ANY_VALUE(TRIM(v.name)) AS promocao,
    ANY_VALUE(v.type_normalized) AS tipo,
    ANY_VALUE(v.item_net_amount) AS valor_item,
    ANY_VALUE(v.representativeness) AS valor_rateado,
    ANY_VALUE(v.total_discount_amount) AS desconto
  FROM visualization_order_cycle_context.vw_fat_promotions_b2c AS v
  CROSS JOIN periodos AS p
  WHERE v.data_source = 'vtex'
    AND v.invoice_canceled = FALSE
    AND v.is_promotion
    AND v.total_discount_amount > 0.01
    AND (v.invoiced_date BETWEEN p.ini_atual AND p.fim_atual
      OR v.invoiced_date BETWEEN p.ini_anterior AND p.fim_anterior)
  GROUP BY v.order_code, v.item_code, v.item_index, v.promotion_index
),

com_loja AS (
  SELECT
    TRIM(COALESCE(ds.company_name, si.company_name, '(sem loja)')) AS loja,
    IF(l.dia BETWEEN p.ini_atual AND p.fim_atual, 'atual', 'anterior') AS periodo,
    l.*
  FROM linhas AS l
  CROSS JOIN periodos AS p
  LEFT JOIN gold_master_data_context.dim_sellers AS ds
    ON ds.id = l.seller_id
  LEFT JOIN visualization_master_data_context.vw_sellers_industria AS si
    ON si.id = l.seller_id
),

por_promocao AS (
  SELECT
    loja,
    promocao,
    STRING_AGG(DISTINCT tipo, ' / ') AS tipo,
    LOGICAL_AND(valor_item <= 0.01) AS brinde,
    COUNT(DISTINCT IF(periodo = 'atual', order_code, NULL)) AS pedidos_atual,
    SUM(IF(periodo = 'atual', valor_rateado, 0)) AS gmv_atual,
    SUM(IF(periodo = 'atual', desconto, 0)) AS desconto_atual,
    COUNT(DISTINCT IF(periodo = 'anterior', order_code, NULL)) AS pedidos_anterior,
    SUM(IF(periodo = 'anterior', valor_rateado, 0)) AS gmv_anterior,
    SUM(IF(periodo = 'anterior', desconto, 0)) AS desconto_anterior
  FROM com_loja
  GROUP BY loja, promocao
)

SELECT
  loja,
  ROW_NUMBER() OVER (PARTITION BY loja ORDER BY gmv_atual DESC, desconto_atual DESC) AS posicao,
  promocao,
  tipo,
  brinde,
  pedidos_atual,
  gmv_atual,
  desconto_atual,
  pedidos_anterior,
  gmv_anterior,
  desconto_anterior
FROM por_promocao
WHERE pedidos_atual > 0
QUALIFY posicao <= 5
