// Gera data/kpis.exemplo.json: lojas fictícias no mesmo formato do exportar-kpis.mjs,
// usadas na demo pública e quando data/kpis.json não existe. Cobre de propósito os casos
// que o site trata (abaixo da meta, sem meta, base pequena, alertas de dado).
// Determinístico: rodar de novo gera o mesmo arquivo. Uso: npm run exemplo
import { writeFile } from 'node:fs/promises';

let semente = 20261006;
function aleatorio() { // mulberry32
  semente = (semente + 0x6d2b79f5) | 0;
  let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (a, b) => a + (b - a) * aleatorio();
const arred = (v, casas = 2) => (v == null ? null : Math.round(v * 10 ** casas) / 10 ** casas);

const DATA_REF = '2026-10-06';
const DIAS_ATUAIS = 6;
const periodo = {
  atual: { inicio: '2026-10-01', fim: DATA_REF },
  anterior: { inicio: '2026-09-01', fim: '2026-09-06' },
  alinhado: { inicio: '2026-09-03', fim: '2026-09-08' },
  mes: { inicio: '2026-10-01', fim: '2026-10-31' },
};
const dias = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const fimDeSemana = iso => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());

// gmvDia: venda média diária; ating: realizado ÷ forecast; cresc/crescAlinhado: vs comparações;
// ticketVar: variação do ticket (o resto da variação vem do volume de pedidos)
const LOJAS = [
  { loja: 'Loja exemplo A', modelo: 'B2C', gmvDia: 300000, ating: 1.05, cresc: 0.084, crescAlinhado: 0.06, budget: 1.08, ticket: 420, itensPedido: 1.6, ticketVar: -0.02, ser: 0.12, serAting: 0.97,
    estoque: [182340, 1215, 1800, 42, 6, 25, 2400, 96000], otd: [8420, 0.962, 7980, 0.936, 8100, 0.945], nps: [640, 0.62, 0.12, 610, 0.58, 0.14], growth: [410000, 0.021, 380000, 0.020, 395000, 0.0205],
    canais: [['Site próprio', 'Site próprio', 0.55, 0.10], ['Mercado Livre', 'Marketplace', 0.20, 0.15], ['Amazon', 'Marketplace', 0.15, -0.05], ['Magazine Luiza', 'Marketplace', 0.10, 0.02]] },
  { loja: 'Loja exemplo B', modelo: 'B2C', gmvDia: 100000, ating: 0.957, cresc: -0.066, crescAlinhado: -0.04, budget: 0.94, ticket: 290, itensPedido: 1.3, ticketVar: -0.05, ser: 0.11, serAting: 1.01,
    estoque: [64810, 0, 900, 85, 22, 40, 1300, 30000], otd: [2310, 0.926, 2655, 0.968, 2500, 0.96], nps: [210, 0.48, 0.20, 230, 0.52, 0.18], growth: [150000, 0.016, 160000, 0.018, 155000, 0.0175],
    canais: [['Site próprio', 'Site próprio', 0.70, -0.08], ['Shopee', 'Marketplace', 0.20, 0.30], ['Mercado Livre', 'Marketplace', 0.10, -0.10]] },
  { loja: 'Loja exemplo C', modelo: 'B2C', gmvDia: 16000, ating: null, cresc: null, crescAlinhado: null, budget: null, ticket: 150, itensPedido: 1.2, ticketVar: 0, ser: null,
    estoque: [23905, null, 400, 12, 0, 8, 300, 9000], otd: [940, 0.98, 0, 0, 0, 0], nps: null, growth: [30000, 0.012, null, null, null, null],
    canais: [['Site próprio', 'Site próprio', 1, null]] },
  { loja: 'Loja exemplo D', modelo: null, gmvDia: null,
    estoque: [7120, 38, 120, 3, 0, 2, 90, 2000], otd: [0, 0, 410, 0.95, 400, 0.95], nps: null, growth: null, canais: [] },
  { loja: 'Loja exemplo E', modelo: 'B2C', gmvDia: 185000, ating: 0.90, cresc: -0.145, crescAlinhado: -0.12, budget: 1.05, ticket: 510, itensPedido: 1.4, ticketVar: 0.03, ser: 0.12, serAting: 0.89,
    estoque: [95400, 2310, 1500, 160, 35, 70, 2100, 52000], otd: [3120, 0.894, 2980, 0.956, 3050, 0.95], nps: [300, 0.40, 0.28, 280, 0.47, 0.22], growth: [260000, 0.0125, 270000, 0.0148, 265000, 0.0145],
    canais: [['Site próprio', 'Site próprio', 0.45, -0.20], ['Mercado Livre', 'Marketplace', 0.30, -0.10], ['Amazon', 'Marketplace', 0.15, 0.05], ['Sem informação', 'Sem informação', 0.10, 0]] },
  { loja: 'Loja exemplo F', modelo: 'B2C', gmvDia: 75000, ating: 1.06, cresc: 0.145, crescAlinhado: 0.12, budget: 1.03, ticket: 180, itensPedido: 2.1, ticketVar: 0.01, ser: 0.11, serAting: 1.06,
    estoque: [41200, 120, 600, 8, 1, 6, 900, 26000], otd: [1450, 0.985, 1210, 0.975, 1300, 0.98], nps: [150, 0.66, 0.08, 140, 0.63, 0.09], growth: [90000, 0.021, 82000, 0.019, 86000, 0.02],
    canais: [['Site próprio', 'Site próprio', 0.50, 0.05], ['TikTok Shop', 'Marketplace', 0.30, 0.80], ['Shopee', 'Marketplace', 0.20, 0.40]] },
  { loja: 'Loja exemplo G', modelo: 'B2C', gmvDia: 47000, ating: 0.898, cresc: -0.047, crescAlinhado: -0.02, budget: 0.97, ticket: 230, itensPedido: 1.5, ticketVar: -0.03, ser: 0.11, serAting: 0.90,
    estoque: [18750, 410, 300, 20, 4, 9, 400, 11000], otd: [61, 0.852, 70, 0.943, 66, 0.94], nps: [18, 0.44, 0.22, 20, 0.5, 0.2], growth: [70000, 0.011, 72000, 0.012, 71000, 0.012],
    canais: [['Site próprio', 'Site próprio', 0.80, -0.05], ['Mercado Livre', 'Marketplace', 0.20, -0.02]] },
  { loja: 'Loja exemplo H', modelo: 'B2B', gmvDia: 500000, ating: 1.01, cresc: 0.129, crescAlinhado: 0.10, budget: 1.05, ticket: 3200, itensPedido: 24, ticketVar: 0.04, ser: 0.11, serAting: 1.01,
    estoque: [310500, 3980, 2400, 30, 4, 18, 3800, 150000], otd: [10240, 0.938, 9870, 0.954, 10000, 0.95], nps: null, growth: null,
    canais: [['Portal B2B', 'Marketplace', 0.70, 0.15], ['Sem informação', 'Sem informação', 0.30, 0.08]] },
];

// Farol manual do CS e última integração de estoque (padrão: dia da exportação)
const CS = { 'Loja exemplo A': 'Feliz', 'Loja exemplo B': 'Atenção', 'Loja exemplo C': 'Atenção', 'Loja exemplo E': 'Feliz', 'Loja exemplo F': 'Feliz', 'Loja exemplo G': 'Churn', 'Loja exemplo H': 'Feliz' };
// Desconto médio [atual, anterior] onde a origem informa (na base real, poucas lojas)
const DESCONTO = { 'Loja exemplo A': [0.08, 0.06], 'Loja exemplo E': [0.05, 0.09] };
const INTEGRACAO = { 'Loja exemplo G': '2026-10-02' };
// Promoções na VTEX: [parcela dos pedidos com promoção, desconto médio] atual e anterior, e o
// tamanho da base VTEX no período anterior em relação ao atual (volume)
const PROMO = {
  'Loja exemplo A': { atual: [0.30, 0.15], anterior: [0.25, 0.14], volumeAnterior: 0.95 },
  'Loja exemplo B': { atual: [0.10, 0.12], anterior: [0.22, 0.12], volumeAnterior: 1.25 },
  'Loja exemplo E': { atual: [0.40, 0.33], anterior: [0.38, 0.25], volumeAnterior: 1.15 },
  'Loja exemplo F': { atual: [0.38, 0.18], anterior: [0.26, 0.18], volumeAnterior: 0.85 },
};
// [nome, tipo, parcela do GMV com promoção, desconto médio, variação vs mês anterior]
const TOP_PROMOCOES = {
  'Loja exemplo A': [['10% no Pix', 'Promoção', 0.45, 0.10, 0.12], ['Cupom BEMVINDO10', 'Cupom de Desconto', 0.30, 0.10, 0.25], ['Leve 3, pague 2', 'Promoção', 0.25, 0.33, null]],
  'Loja exemplo B': [['Frete com desconto acima de R$ 199', 'Promoção', 0.60, 0.08, -0.45], ['Cupom VOLTA15', 'Cupom de Desconto', 0.40, 0.15, -0.30]],
  'Loja exemplo E': [['Semana do cliente 30% OFF', 'Promoção', 0.65, 0.30, 0.40], ['Cupom APP20', 'Cupom de Desconto', 0.35, 0.20, 0.10]],
  'Loja exemplo F': [['Kit presente 15% OFF', 'Promoção', 0.70, 0.15, 0.80], ['10% no Pix', 'Promoção', 0.30, 0.10, 0.20]],
};

const lojas = [];
const diario = [];
const canais = [];
const promocoesTop = [];

for (const p of LOJAS) {
  const l = { loja: p.loja, modelo: p.modelo };

  if (p.gmvDia) {
    // Meta diária: dia útil leva a meta; fim de semana vai para a segunda, como na vw_forecast
    const metaDia = p.ating ? p.gmvDia / p.ating : null;
    let pendente = 0;
    const serie = dias.map((dia, i) => {
      const fds = fimDeSemana(dia);
      const real = i < DIAS_ATUAIS ? p.gmvDia * (fds ? 0.7 : 1.08) * entre(0.85, 1.15) : null;
      let meta = null;
      if (metaDia) {
        if (fds) { pendente += metaDia; meta = 0; } else { meta = metaDia * entre(0.95, 1.05) + pendente; pendente = 0; }
      }
      return { dia, real, meta };
    });
    const soma = (de, ate, campo) => serie.slice(de, ate).reduce((a, d) => a + (d[campo] ?? 0), 0);
    const gmvAtual = soma(0, DIAS_ATUAIS, 'real');
    const forecast = p.ating ? soma(0, DIAS_ATUAIS, 'meta') : null;
    const forecastMes = p.ating ? soma(0, 31, 'meta') : null;

    const gmvAnterior = p.cresc == null ? null : gmvAtual / (1 + p.cresc);
    const gmvAlinhado = p.crescAlinhado == null ? null : gmvAtual / (1 + p.crescAlinhado);
    const pedidos = gmv => (gmv == null ? null : gmv / p.ticket);
    const ticketAnterior = p.ticket / (1 + p.ticketVar);
    Object.assign(l, {
      gmv_atual: arred(gmvAtual), gmv_anterior: arred(gmvAnterior), gmv_alinhado: arred(gmvAlinhado),
      pedidos_atual: Math.round(pedidos(gmvAtual)),
      pedidos_anterior: gmvAnterior == null ? 0 : Math.round(gmvAnterior / ticketAnterior),
      pedidos_alinhado: gmvAlinhado == null ? 0 : Math.round(gmvAlinhado / ticketAnterior),
      itens_atual: arred(pedidos(gmvAtual) * p.itensPedido, 0),
      itens_anterior: gmvAnterior == null ? null : arred(gmvAnterior / ticketAnterior * p.itensPedido * 0.98, 0),
      itens_alinhado: gmvAlinhado == null ? null : arred(gmvAlinhado / ticketAnterior * p.itensPedido * 0.99, 0),
      gmv_forecast: arred(forecast), gmv_budget: arred(forecast && forecast * p.budget),
      gmv_forecast_mes: arred(forecastMes), gmv_budget_mes: arred(forecastMes && forecastMes * p.budget),
    });
    if (DESCONTO[p.loja]) {
      const [atual, anterior] = DESCONTO[p.loja];
      Object.assign(l, {
        desconto_atual: arred(gmvAtual * atual / (1 - atual)),
        desconto_anterior: arred(gmvAnterior * anterior / (1 - anterior)),
        desconto_alinhado: arred(gmvAlinhado * anterior / (1 - anterior)),
      });
    }
    if (PROMO[p.loja]) {
      // Base VTEX: 90% do GMV e dos pedidos da loja (a fonte de promoção cobre só a VTEX)
      const cfg = PROMO[p.loja];
      const periodos = [
        ['atual', cfg.atual, gmvAtual * 0.9, l.pedidos_atual * 0.9],
        ['anterior', cfg.anterior, gmvAtual * 0.9 * cfg.volumeAnterior, l.pedidos_atual * 0.9 * cfg.volumeAnterior],
      ];
      for (const [sufixo, [parcela, taxa], gmv, totalPedidos] of periodos) {
        const pedidosCom = Math.round(totalPedidos * parcela);
        const gmvCom = gmv * parcela * 1.1;
        const gmvItens = gmvCom * 0.7;
        Object.assign(l, {
          [`promo_gmv_com_${sufixo}`]: arred(gmvCom),
          [`promo_gmv_sem_${sufixo}`]: arred(gmv - gmvCom),
          [`promo_gmv_itens_${sufixo}`]: arred(gmvItens),
          [`promo_pedidos_com_${sufixo}`]: pedidosCom,
          [`promo_pedidos_sem_${sufixo}`]: Math.round(totalPedidos) - pedidosCom,
          [`promo_pedidos_cupom_${sufixo}`]: Math.round(pedidosCom * 0.3),
          [`promo_desconto_${sufixo}`]: arred(gmvItens * taxa / (1 - taxa)),
          [`promo_desconto_brinde_${sufixo}`]: 0,
        });
      }
      (TOP_PROMOCOES[p.loja] ?? []).forEach(([promocao, tipo, parcela, taxa, variacao], i) => {
        const gmv = l.promo_gmv_itens_atual * parcela;
        promocoesTop.push({
          loja: p.loja, posicao: i + 1, promocao, tipo, brinde: false,
          pedidos_atual: Math.round(l.promo_pedidos_com_atual * parcela), gmv_atual: arred(gmv), desconto_atual: arred(gmv * taxa / (1 - taxa)),
          pedidos_anterior: variacao == null ? 0 : Math.round(l.promo_pedidos_com_atual * parcela / (1 + variacao)),
          gmv_anterior: variacao == null ? 0 : arred(gmv / (1 + variacao)),
          desconto_anterior: variacao == null ? 0 : arred(gmv / (1 + variacao) * taxa / (1 - taxa)),
        });
      });
    }
    if (p.ser) {
      const serAtual = gmvAtual * p.ser;
      const serForecast = serAtual / p.serAting;
      Object.assign(l, {
        ser_atual: arred(serAtual), ser_anterior: arred(gmvAnterior && gmvAnterior * p.ser * 0.98), ser_alinhado: arred(gmvAlinhado && gmvAlinhado * p.ser * 0.99),
        ser_forecast: arred(serForecast), ser_budget: arred(serForecast * p.budget),
        ser_forecast_mes: arred(serForecast * forecastMes / forecast), ser_budget_mes: arred(serForecast * forecastMes / forecast * p.budget),
      });
    }
    for (const d of serie) {
      diario.push({ loja: p.loja, dia: d.dia, gmv: arred(d.real), gmv_forecast: arred(d.meta), gmv_budget: arred(d.meta && d.meta * p.budget) });
    }
    for (const [canal, tipo, parcela, variacao] of p.canais) {
      const atual = gmvAtual * parcela;
      canais.push({
        loja: p.loja, tipo, canal, gmv_atual: arred(atual),
        gmv_anterior: arred(variacao == null ? null : atual / (1 + variacao)),
        gmv_alinhado: arred(variacao == null ? null : atual / (1 + variacao * 0.8)),
      });
    }
  }

  const [disp, avaria, skusVenda, ruptura, rupturaA, risco, demanda, dispVenda] = p.estoque;
  Object.assign(l, {
    itens_disponiveis: disp, itens_avaria: avaria, skus_com_venda: skusVenda, skus_ruptura: ruptura, skus_ruptura_a: rupturaA,
    skus_risco_ruptura: risco, disponivel_com_venda: dispVenda, demanda_dia: demanda, demanda_dia_ruptura: arred(demanda * ruptura / skusVenda * 1.4, 1),
    estoque_ultima_integracao: INTEGRACAO[p.loja] ?? '2026-10-07',
  });
  if (CS[p.loja]) Object.assign(l, { farol_cs: CS[p.loja], farol_cs_detalhe: `${p.modelo ?? '?'}: ${CS[p.loja]}` });

  const [ent, pct, entAnt, pctAnt, entAlin, pctAlin] = p.otd;
  Object.assign(l, {
    otd_entregues_atual: ent, otd_no_prazo_atual: Math.round(ent * pct),
    otd_entregues_anterior: entAnt, otd_no_prazo_anterior: Math.round(entAnt * pctAnt),
    otd_entregues_alinhado: entAlin, otd_no_prazo_alinhado: Math.round(entAlin * pctAlin),
  });

  if (p.nps) {
    const [resp, prom, detr, respAnt, promAnt, detrAnt] = p.nps;
    Object.assign(l, {
      nps_respostas_atual: resp, nps_promotores_atual: Math.round(resp * prom), nps_detratores_atual: Math.round(resp * detr),
      nps_respostas_anterior: respAnt, nps_promotores_anterior: Math.round(respAnt * promAnt), nps_detratores_anterior: Math.round(respAnt * detrAnt),
    });
  }
  if (p.growth) {
    const [ses, conv, sesAnt, convAnt, sesAlin, convAlin] = p.growth;
    Object.assign(l, {
      sessoes_atual: ses, transacoes_atual: Math.round(ses * conv),
      sessoes_anterior: sesAnt, transacoes_anterior: sesAnt == null ? null : Math.round(sesAnt * convAnt),
      sessoes_alinhado: sesAlin, transacoes_alinhado: sesAlin == null ? null : Math.round(sesAlin * convAlin),
    });
  }
  lojas.push(l);
}

const saida = {
  gerado_em: '2026-10-07T10:00:00.000Z',
  data_ref: DATA_REF,
  periodo,
  lojas,
  canais,
  diario,
  promocoes_top: promocoesTop,
  frescor: [
    { fonte: 'Vendas', ultima_carga: '2026-10-07T09:40:00.000Z', dado_ate: '2026-10-07' },
    { fonte: 'Estoque', ultima_carga: '2026-10-07T06:15:00.000Z', dado_ate: '2026-10-07' },
    { fonte: 'OTD', ultima_carga: '2026-10-05T03:00:00.000Z', dado_ate: '2026-10-04' },
    { fonte: 'NPS', ultima_carga: '2026-10-07T05:30:00.000Z', dado_ate: '2026-09-16' },
    { fonte: 'Farol de CS', ultima_carga: '2026-10-07T05:25:00.000Z', dado_ate: null },
  ],
};

await writeFile(new URL('../data/kpis.exemplo.json', import.meta.url), `${JSON.stringify(saida, null, 1)}\n`);
console.log(`data/kpis.exemplo.json: ${lojas.length} lojas, ${canais.length} canais, ${diario.length} dias`);
