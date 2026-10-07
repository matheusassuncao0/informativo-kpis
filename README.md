# Informativo de KPIs

Site estático com os principais KPIs dos dashboards de Power BI (Desempenho de vendas, Estoque B2C e OTD B2C), com filtro por loja (`dim_sellers.company_name`). Feito para ser embutido no aplicativo do Power BI.

## Como funciona

```
BigQuery (sql/*.sql)
   │  GitHub Action diária (07:00) — scripts/exportar-kpis.mjs
   ▼
data/kpis.json  (uma linha por loja, campos aditivos)
   │
   ▼
index.html + assets/app.js  (soma as lojas, calcula razões e variações no navegador)
```

- O navegador não acessa o BigQuery. Só a Action tem credencial.
- `data/kpis.json` não é versionado: é gerado e publicado direto no Pages a cada execução.
- Sem `data/kpis.json`, o site usa `data/kpis.exemplo.json` (lojas fictícias) e mostra um aviso.

## Regras dos números

- **Comparativo:** mês corrente até D-1 vs mesmo período do mês anterior (31/03 compara com 28/02).
- **Total de lojas:** as SQLs devolvem só componentes aditivos (ex.: entregues e no prazo). Percentuais são calculados depois da soma, nunca como média de percentuais.
- **Projeção de fechamento:** realizado ÷ meta até D-1 × meta do mês inteiro, ou seja, mantém o atingimento atual até o fim do mês. Como a meta diária já empurra fim de semana e feriado para o dia útil seguinte, a projeção respeita o calendário em vez de ser uma média linear por dia.
- **Farol:** > 103% acima, 97% a 103% na faixa, < 97% abaixo (mesmos limites do dashboard).
- **Resumo e "Onde agir":** gerados no navegador a partir do JSON. Destaques de OTD por loja só consideram lojas com ao menos 100 entregas no período.
- **Estoque:** foto atual, sem comparativo (a origem não tem histórico).
- **Vendas:** o dashboard Desempenho de vendas lê o Databricks; `sql/vendas.sql` usa as views equivalentes no BigQuery, que podem divergir. A meta padrão é Forecast (igual ao dashboard), com opção de Budget no site.
- Cada SQL documenta no cabeçalho qual medida DAX ela espelha.

## Adicionar um KPI

1. Escreva a consulta em `sql/<nome>.sql`: uma linha por `loja` e colunas numéricas aditivas. Use `@data_ref` (DATE) se precisar do período.
2. Inclua `<nome>` em `CONSULTAS` em `scripts/exportar-kpis.mjs`.
3. Adicione o tile em `SECOES` em `assets/app.js`.

## Rodar localmente

```bash
npm install
npm run servir            # http://localhost:8080 (com dados de exemplo)

# com dados reais (precisa de gcloud auth application-default login)
BQ_PROJECT=<projeto> npm run exportar
```

`?loja=<company_name>` na URL abre o site já filtrado.

## Configuração no GitHub

1. **Settings › Pages › Source:** GitHub Actions.
2. **Secrets:** `GCP_WORKLOAD_IDENTITY_PROVIDER` e `GCP_SERVICE_ACCOUNT`. A service account precisa de `roles/bigquery.jobUser` no projeto e `roles/bigquery.dataViewer` nos datasets das views e tabelas usadas.
3. **Variables:** `BQ_PROJECT` (projeto das views) e `BQ_LOCATION` (padrão `US`).

> **Visibilidade:** um site do GitHub Pages em conta pessoal é público na internet, mesmo que o repositório seja privado. Antes de ativar o Pages com dados reais, confirme que esse nível de exposição é aceitável.
