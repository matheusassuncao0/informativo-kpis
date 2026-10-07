-- Promoções por loja: componentes aditivos, mês corrente até D-1 (_atual) vs mesmo intervalo
-- do mês anterior (_anterior).
--
-- Fonte: vw_fat_promotions_b2c, a mesma do dashboard Eficiência promocional B2C. Só VTEX
-- flagship Brasil, B2C/B2E, sem lojas em churn (~27 lojas). NÃO é a base do GMV do site: o
-- valor é o captado na VTEX (item_net_amount), recortado pela data da NF. Usar só razões
-- dentro desta fonte e comparar cada loja com ela mesma: há lojas que fazem tabela de preço
-- via promoção (ex.: "Kits ... Tabela"), então a taxa de desconto não é comparável entre lojas.
--
-- Diferenças propositais em relação ao dashboard:
--   - a view duplica linhas quando o mesmo SKU aparece 2+ vezes no pedido; aqui deduplica por
--     (pedido, item, item_index, promoção). O dashboard fica ~2-3% inflado.
--   - brinde/amostra (item promocional com valor <= R$ 0,01) não marca o pedido como promo;
--     vai para desconto_brinde_*
--   - item só é promocionado com desconto > R$ 0,01 (marcadores como o cupom Livelo de
--     identificação têm R$ 0,003)
--   - pedidos com e sem promoção são grupos exclusivos (no dashboard, pedido misto conta 2x)
-- Frete grátis, desconto manual e de marketplace não são price tag de item: caem em "sem promo".
-- Estée Lauder não tem promoção registrada em 2026 com milhares de pedidos: falta de captura.
-- Data: invoiced_date com invoice_canceled = FALSE (o captado inclui pedido que nunca faturou).
-- Parâmetro: @data_ref (DATE) = D-1.
WITH periodos AS (
  SELECT
    DATE_TRUNC(@data_ref, MONTH) AS ini_atual,
    @data_ref AS fim_atual,
    DATE_SUB(DATE_TRUNC(@data_ref, MONTH), INTERVAL 1 MONTH) AS ini_anterior,
    DATE_SUB(@data_ref, INTERVAL 1 MONTH) AS fim_anterior
),

-- 1 linha por (pedido, item, promoção): remove a duplicação da view
linhas AS (
  SELECT
    v.order_code,
    v.item_code,
    v.item_index,
    v.promotion_index,
    ANY_VALUE(v.seller_id) AS seller_id,
    ANY_VALUE(v.invoiced_date) AS dia,
    ANY_VALUE(v.is_promotion) AS is_promotion,
    ANY_VALUE(v.type_normalized) AS tipo,
    ANY_VALUE(v.item_quantity) AS qtd,
    ANY_VALUE(v.item_net_amount) AS valor_item,
    ANY_VALUE(v.total_discount_amount) AS desconto
  FROM visualization_order_cycle_context.vw_fat_promotions_b2c AS v
  CROSS JOIN periodos AS p
  WHERE v.data_source = 'vtex'
    AND v.invoice_canceled = FALSE
    AND (v.invoiced_date BETWEEN p.ini_atual AND p.fim_atual
      OR v.invoiced_date BETWEEN p.ini_anterior AND p.fim_anterior)
  GROUP BY v.order_code, v.item_code, v.item_index, v.promotion_index
),

-- 1 linha por item (desconto = soma das promoções empilhadas)
itens AS (
  SELECT
    order_code,
    item_code,
    item_index,
    ANY_VALUE(seller_id) AS seller_id,
    ANY_VALUE(dia) AS dia,
    ANY_VALUE(qtd) AS qtd,
    ANY_VALUE(valor_item) AS valor_item,
    SUM(IF(is_promotion, desconto, 0)) AS desconto,
    SUM(IF(is_promotion AND tipo = 'Cupom de Desconto', desconto, 0)) AS desconto_cupom
  FROM linhas
  GROUP BY order_code, item_code, item_index
),

-- 1 linha por pedido × período (faturamento parcial pode dividir o pedido)
pedidos AS (
  SELECT
    i.order_code,
    IF(i.dia BETWEEN p.ini_atual AND p.fim_atual, 'atual', 'anterior') AS periodo,
    ANY_VALUE(i.seller_id) AS seller_id,
    LOGICAL_OR(i.desconto > 0.01 AND i.valor_item > 0.01) AS pedido_promo,
    LOGICAL_OR(i.desconto_cupom > 0.01 AND i.valor_item > 0.01) AS pedido_cupom,
    SUM(i.valor_item) AS valor,
    SUM(IF(i.desconto > 0.01 AND i.valor_item > 0.01, i.valor_item, 0)) AS valor_itens_promo,
    SUM(IF(i.valor_item > 0.01, i.desconto, 0)) AS desconto,
    SUM(IF(i.valor_item <= 0.01, i.desconto, 0)) AS desconto_brinde
  FROM itens AS i
  CROSS JOIN periodos AS p
  GROUP BY 1, 2
),

com_loja AS (
  SELECT
    TRIM(COALESCE(ds.company_name, si.company_name, '(sem loja)')) AS loja,
    pd.*
  FROM pedidos AS pd
  LEFT JOIN gold_master_data_context.dim_sellers AS ds
    ON ds.id = pd.seller_id
  LEFT JOIN visualization_master_data_context.vw_sellers_industria AS si
    ON si.id = pd.seller_id
)

SELECT
  loja,
  SUM(IF(periodo = 'atual' AND pedido_promo, valor, 0)) AS promo_gmv_com_atual,
  SUM(IF(periodo = 'atual' AND NOT pedido_promo, valor, 0)) AS promo_gmv_sem_atual,
  SUM(IF(periodo = 'atual', valor_itens_promo, 0)) AS promo_gmv_itens_atual,
  COUNTIF(periodo = 'atual' AND pedido_promo) AS promo_pedidos_com_atual,
  COUNTIF(periodo = 'atual' AND NOT pedido_promo) AS promo_pedidos_sem_atual,
  COUNTIF(periodo = 'atual' AND pedido_cupom) AS promo_pedidos_cupom_atual,
  SUM(IF(periodo = 'atual', desconto, 0)) AS promo_desconto_atual,
  SUM(IF(periodo = 'atual', desconto_brinde, 0)) AS promo_desconto_brinde_atual,
  SUM(IF(periodo = 'anterior' AND pedido_promo, valor, 0)) AS promo_gmv_com_anterior,
  SUM(IF(periodo = 'anterior' AND NOT pedido_promo, valor, 0)) AS promo_gmv_sem_anterior,
  SUM(IF(periodo = 'anterior', valor_itens_promo, 0)) AS promo_gmv_itens_anterior,
  COUNTIF(periodo = 'anterior' AND pedido_promo) AS promo_pedidos_com_anterior,
  COUNTIF(periodo = 'anterior' AND NOT pedido_promo) AS promo_pedidos_sem_anterior,
  COUNTIF(periodo = 'anterior' AND pedido_cupom) AS promo_pedidos_cupom_anterior,
  SUM(IF(periodo = 'anterior', desconto, 0)) AS promo_desconto_anterior,
  SUM(IF(periodo = 'anterior', desconto_brinde, 0)) AS promo_desconto_brinde_anterior
FROM com_loja
GROUP BY loja
