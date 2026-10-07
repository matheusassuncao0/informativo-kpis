# Informativo de KPIs

Site estático com os principais KPIs dos dashboards de Power BI (Desempenho de vendas, Estoque B2C, OTD B2C) e insights que eles não mostram: projeção de fechamento, decomposição do GMV, mix de canais, venda em risco por ruptura, saúde da loja, funil de Growth e alertas de qualidade de dado. Filtro por loja (`company_name`), feito para ser embutido no aplicativo do Power BI.

## Como funciona

```
BigQuery (sql/*.sql)
   │  GitHub Action diária (07:00) — scripts/exportar-kpis.mjs
   ▼
data/kpis.json  (lojas + canais + série diária + atualização das fontes)
   │
   ▼
index.html → assets/nucleo.js (regras e insights, sem DOM) → assets/app.js (tela)
```

- O navegador não acessa o BigQuery. Só a Action tem credencial.
- `data/kpis.json` não é versionado: é gerado e publicado direto no Pages a cada execução.
- Sem `data/kpis.json`, o site usa `data/kpis.exemplo.json` (lojas fictícias, gerado por `npm run exemplo`) e mostra um aviso.
- `assets/nucleo.js` roda no navegador e no Node: o resumo do Teams (`scripts/enviar-resumo.mjs`) usa os mesmos textos do site.

## Consultas

| Arquivo | Destino no JSON | O que traz |
|---|---|---|
| `vendas.sql` | `lojas` | GMV, SER, metas (até D-1 e mês inteiro), pedidos e itens. Validado contra a One page |
| `estoque.sql` | `lojas` | Disponível, avaria, ruptura, demanda e última integração. Validado contra o Estoque B2C |
| `otd.sql` | `lojas` | Entregues e no prazo. Validado contra o OTD B2C |
| `nps.sql` | `lojas` | Respostas, promotores e detratores em janela de 90 dias |
| `farol_cs.sql` | `lojas` | Farol manual do CS (Feliz, Atenção, Churn) |
| `growth.sql` | `lojas` | Sessões e transações do GA4, até D-2 |
| `vendas_canal.sql` | `canais` | GMV por canal de venda |
| `vendas_diario.sql` | `diario` | GMV e meta por dia do mês (faixa da projeção) |
| `frescor.sql` | `frescor` | Última carga e data do dado mais recente de cada fonte |

Cada SQL documenta no cabeçalho as regras que espelha e as pegadinhas da origem.

## Regras dos números

- **Comparativo:** mês corrente até D-1 contra o mesmo período do mês anterior (31/03 compara com 28/02) ou contra os mesmos dias da semana 4 semanas antes. O primeiro mistura dias da semana diferentes.
- **Total de lojas:** as SQLs devolvem só componentes aditivos. Percentuais e médias são calculados depois da soma, nunca como média de percentuais.
- **Projeção de fechamento:** realizado ÷ meta até D-1 × meta do mês inteiro. A meta diária já empurra fim de semana e feriado para o dia útil seguinte, então respeita o calendário. A faixa provável (80%) vem da variação do atingimento dia a dia.
- **Farol:** > 103% acima, 97% a 103% na faixa, < 97% abaixo (mesmos limites do dashboard).
- **Decomposição:** GMV = pedidos × ticket médio; ticket = itens por pedido × preço por item. No total de lojas só pedidos e ticket, porque os outros dois oscilam pelo mix B2B/B2C.
- **Venda em risco:** unidades/dia dos SKUs em ruptura (sem estoque e com venda nos últimos 90 dias) × preço médio por item da loja. É estimativa.
- **Cobertura:** estoque dos SKUs com venda ÷ venda média diária. Os SKUs parados ficam de fora, senão a cobertura dá milhares de dias.
- **Saúde da loja:** média de vendas vs meta, OTD, ruptura, avaria e NPS (bom 1, atenção 0,5, ruim 0). Limites em `SAUDE` no `nucleo.js`; os de ruptura, avaria e NPS são pontos de partida.
- **Conversão:** transações ÷ sessões sobre as somas. Os dashboards de GA fazem média das taxas por linha, que distorce.
- **Alertas de dados:** quedas para perto de zero, OTD implausível, fonte sem dado novo, loja de estoque sem integrar e GMV sem canal. Limites em `ANOMALIA` no `nucleo.js`.
- **Estoque:** foto atual, sem comparativo (a origem não tem histórico).
- **Vendas:** o dashboard lê o Databricks; aqui são as views equivalentes no BigQuery.

## Rodar localmente

```bash
npm install
npm run servir            # http://localhost:8080 (com dados de exemplo)

# com dados reais (precisa de gcloud auth application-default login)
BQ_PROJECT=infra-datalake-prd-4a9a npm run exportar
npm run resumo            # imprime o resumo do Teams sem enviar
```

Na URL: `?loja=<company_name>`, `?meta=budget` e `?comp=alinhado` abrem o site já filtrado.

Mudou CSS ou JS? Suba o `?v=` no `index.html`: o Pages guarda esses arquivos em cache por 10 minutos.

## Configuração no GitHub

1. **Settings › Pages › Source:** GitHub Actions.
2. **Secrets:** `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT` e, para o resumo semanal, `TEAMS_WEBHOOK_URL` (webhook do app Workflows no canal).
3. **Variables:** `BQ_PROJECT` (`infra-datalake-prd-4a9a`), `BQ_LOCATION` (padrão `US`) e `SITE_URL` (botão do card no Teams).
4. **Permissões da service account:** `roles/bigquery.jobUser` no projeto e `roles/bigquery.dataViewer` em:
   `visualization_order_cycle_context`, `visualization_daily_records_context`, `visualization_master_data_context`, `visualization_marketing_context`, `gold_master_data_context`, `gold_order_cycle_context` (partições, para a atualização das fontes), `gold_engagement_context` (GA) e `bronze_google_sheet` (cadastro de growth). As `vw_*` levantadas são tabelas materializadas no prd, o que dispensa acesso às tabelas de origem; se alguma for view de verdade, o primeiro run acusa a permissão que falta.

Custo: cerca de 37 GB processados por execução, quase tudo nas três consultas de vendas.

> **Visibilidade:** um site do GitHub Pages em conta pessoal é público na internet, mesmo com repositório privado. Antes de publicar dados reais, confirme que esse nível de exposição é aceitável.
