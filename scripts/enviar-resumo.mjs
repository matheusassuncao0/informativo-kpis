// Monta o resumo (os mesmos textos do site, de assets/nucleo.js) e envia para um canal
// do Teams por um webhook do app Workflows ("Post to a channel when a webhook request
// is received"). Sem TEAMS_WEBHOOK_URL, só imprime a mensagem: serve de teste.
//
// Uso: npm run resumo [-- caminho/do/kpis.json]
// Variáveis: TEAMS_WEBHOOK_URL (opcional), SITE_URL (botão no card), META (forecast | budget)
import { readFile } from 'node:fs/promises';

await import('../assets/nucleo.js');
const N = globalThis.Nucleo;

const arquivo = process.argv[2] ?? new URL('../data/kpis.json', import.meta.url);
const base = JSON.parse(await readFile(arquivo, 'utf8'));
N.enriquecer(base.lojas);

const ctx = { meta: process.env.META === 'budget' ? 'budget' : 'forecast', comparacao: 'anterior' };
const porLoja = base.lojas.map(l => {
  const ind = N.indicadores(l, ctx);
  return { loja: l.loja, modelo: l.modelo, ind, saude: N.saude(ind) };
});
const total = N.indicadores(N.somar(base.lojas), ctx);
const destaques = N.destaquesGerais(total, porLoja, base, ctx);
const alertas = N.anomalias(porLoja, base, ctx);

const titulo = `Informativo de KPIs · ${N.intervalo(base.periodo.atual)}`;
const marcador = { bom: '🟢', alerta: '🟡', ruim: '🔴', neutro: '⚪' };
const linhas = destaques.map(d => `${marcador[d.tom]} ${d.texto}`);
const linhasAlerta = alertas.map(a => `⚠️ ${a.texto}`);

const webhook = process.env.TEAMS_WEBHOOK_URL;
if (!webhook) {
  console.log([titulo, '', ...linhas, ...(linhasAlerta.length ? ['', 'Alertas de dados', ...linhasAlerta] : [])].join('\n'));
  console.log('\n(TEAMS_WEBHOOK_URL não definido: nada foi enviado)');
  process.exit(0);
}

const bloco = texto => ({ type: 'TextBlock', text: texto, wrap: true, spacing: 'Small' });
const card = {
  type: 'AdaptiveCard',
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  version: '1.4',
  body: [
    { type: 'TextBlock', text: titulo, size: 'Medium', weight: 'Bolder', wrap: true },
    { type: 'TextBlock', text: `Meta: ${N.METAS[ctx.meta]} · comparado com ${N.intervalo(base.periodo.anterior)}`, isSubtle: true, wrap: true, spacing: 'None' },
    ...linhas.map(bloco),
    ...(linhasAlerta.length ? [{ type: 'TextBlock', text: 'Alertas de dados', weight: 'Bolder', spacing: 'Medium' }, ...linhasAlerta.map(bloco)] : []),
  ],
  actions: process.env.SITE_URL ? [{ type: 'Action.OpenUrl', title: 'Abrir o informativo', url: process.env.SITE_URL }] : [],
};

const resposta = await fetch(webhook, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }],
  }),
});
if (!resposta.ok) {
  console.error(`Teams respondeu HTTP ${resposta.status}: ${await resposta.text()}`);
  process.exit(1);
}
console.log(`Resumo enviado ao Teams (${linhas.length} destaques, ${linhasAlerta.length} alertas).`);
