// Regras de negócio e geração de insights, sem DOM: o mesmo arquivo roda no navegador
// (script comum) e no Node (scripts/enviar-resumo.mjs importa e lê globalThis.Nucleo).
(function () {
  'use strict';

  const METAS = { forecast: 'Forecast', budget: 'Budget' };
  const COMPARACOES = {
    anterior: { rotulo: 'Mês anterior', curto: 'mesmo período do mês anterior' },
    alinhado: { rotulo: 'Mesmos dias da semana', curto: 'mesmos dias da semana, 4 semanas antes' },
  };
  const META_OTD = 0.95;
  const BASE_MINIMA_OTD = 100; // entregas: abaixo disso o % oscila demais para virar destaque
  const BASE_MINIMA_NPS = 30; // respostas

  // Limites da saúde da loja. Vendas e OTD seguem as metas dos dashboards; ruptura,
  // avaria e NPS são pontos de partida, ajuste conforme a régua do negócio.
  const SAUDE = {
    vendas: { bom: 0.97, alerta: 0.85 }, // atingimento da meta até ontem
    otd: { bom: 0.95, alerta: 0.90 },
    ruptura: { bom: 0.03, alerta: 0.08 }, // % dos SKUs com venda que estão em ruptura (menor é melhor)
    avaria: { bom: 0.02, alerta: 0.05 }, // % do estoque em avaria (menor é melhor)
    nps: { bom: 50, alerta: 0 },
  };

  // Alertas de dado: quedas para perto de zero costumam ser carga atrasada ou venda
  // registrada em outro seller, não comportamento real da loja.
  const ANOMALIA = {
    baseGmv: 50000, // R$ no período de comparação/meta para o alerta valer
    queda: 0.10, // atual abaixo de 10% da base
    baseOtd: 50, // entregas no período de comparação
    semCanal: 0.20, // parcela do GMV sem canal identificado
    horasFonte: 36, // fonte sem carga há mais tempo que isso
    otdMinimo: 0.5, // OTD abaixo disso com base grande é quase sempre dado errado
    diasDado: 2, // fonte cujo dado mais recente ficou mais velho que isso em relação ao D-1
    diasIntegracao: [2, 30], // estoque de loja sem integrar nesse intervalo de dias (acima: loja inativa)
    baseSessoes: 1000, // sessões no período de comparação para alertar GA zerado
  };

  // ---------------------------------------------------------------------------
  // Formatação

  const nf = opcoes => new Intl.NumberFormat('pt-BR', opcoes);
  const fmt = {
    inteiro: nf({ maximumFractionDigits: 0 }),
    inteiroSinal: nf({ maximumFractionDigits: 0, signDisplay: 'exceptZero' }),
    decimal: nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    compacto: nf({ notation: 'compact', maximumFractionDigits: 1 }),
    pct: nf({ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct1: nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    pct0: nf({ style: 'percent', maximumFractionDigits: 0 }),
    pctSinal: nf({ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }),
    variacao: nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }),
    pp: nf({ minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }),
  };
  // Espaço não separável: "−R$" nunca quebra longe do número
  const reais = (v, comSinal = false) =>
    `${comSinal && v > 0 ? '+' : ''}${v < 0 ? '−' : ''}R$ ${(Math.abs(v) < 1000 ? fmt.inteiro : fmt.compacto).format(Math.abs(v))}`;

  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const razao = (a, b) => (a == null || !b ? null : a / b);
  const nomeMeta = ctx => METAS[ctx.meta];

  // maximo: acima disso, "A, B, C e mais N"
  function juntar(itens, maximo = Infinity) {
    if (itens.length > maximo) return `${itens.slice(0, maximo).join(', ')} e mais ${itens.length - maximo}`;
    return itens.length < 2 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
  }

  function dataCurta(iso) {
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  function intervalo(p) {
    return `${dataCurta(p.inicio)} a ${dataCurta(p.fim)}`;
  }

  // ---------------------------------------------------------------------------
  // Agregação

  function somar(linhas) {
    const total = {};
    for (const l of linhas) {
      for (const [campo, valor] of Object.entries(l)) {
        if (typeof valor !== 'number') continue;
        total[campo] = (total[campo] ?? 0) + valor;
      }
    }
    return total;
  }

  // Campos derivados que precisam ser calculados loja a loja antes de somar
  function enriquecer(lojas) {
    for (const l of lojas) {
      // Venda que deixa de acontecer por ruptura: unidades/dia × preço médio por item da loja
      const preco = razao(num(l.gmv_atual), num(l.itens_atual));
      l.venda_risco_dia = preco != null && num(l.demanda_dia_ruptura) != null ? l.demanda_dia_ruptura * preco : null;
    }
    return lojas;
  }

  // ---------------------------------------------------------------------------
  // Indicadores (sempre sobre campos já somados: o total não vira média de percentual)

  function serieVendas(d, prefixo, ctx) {
    const real = num(d[`${prefixo}_atual`]);
    const anterior = num(d[`${prefixo}_${ctx.comparacao}`]);
    const metaAteOntem = num(d[`${prefixo}_${ctx.meta}`]);
    const metaMes = num(d[`${prefixo}_${ctx.meta}_mes`]);
    // Sem venda e com meta, o dashboard trata o realizado como 0 (vira -100%)
    const atingimento = metaAteOntem ? (real ?? 0) / metaAteOntem : null;
    return {
      real,
      anterior,
      metaAteOntem,
      metaMes,
      atingimento,
      diferenca: atingimento == null ? null : (real ?? 0) - metaAteOntem,
      // Mantém o atingimento atual sobre a meta do mês; a meta diária já traz o peso
      // de fim de semana e feriado, então não é uma média linear por dia
      projecao: atingimento == null || !metaMes ? null : atingimento * metaMes,
      variacao: real == null || !anterior ? null : real / anterior - 1,
    };
  }

  function periodoVenda(d, sufixo) {
    const gmv = num(d[`gmv_${sufixo}`]);
    const pedidos = num(d[`pedidos_${sufixo}`]);
    const itens = num(d[`itens_${sufixo}`]);
    return {
      gmv,
      pedidos,
      itens,
      ticket: razao(gmv, pedidos),
      itensPorPedido: razao(itens, pedidos),
      precoItem: razao(gmv, itens),
    };
  }

  function indicadores(d, ctx) {
    const disponiveis = num(d.itens_disponiveis);
    const avaria = num(d.itens_avaria);
    return {
      gmv: serieVendas(d, 'gmv', ctx),
      ser: serieVendas(d, 'ser', ctx),
      venda: { atual: periodoVenda(d, 'atual'), anterior: periodoVenda(d, ctx.comparacao) },
      estoque: {
        disponiveis,
        avaria,
        avariaPct: avaria != null && disponiveis != null && disponiveis + avaria > 0 ? avaria / (disponiveis + avaria) : null,
        skusComVenda: num(d.skus_com_venda),
        skusRuptura: num(d.skus_ruptura),
        skusRupturaA: num(d.skus_ruptura_a),
        skusRisco: num(d.skus_risco_ruptura),
        rupturaPct: razao(num(d.skus_ruptura), num(d.skus_com_venda)),
        cobertura: razao(num(d.disponivel_com_venda), num(d.demanda_dia)),
        // Parcela do estoque em SKUs sem venda nos últimos 90 dias (média de venda da própria view)
        paradoPct: disponiveis ? 1 - (num(d.disponivel_com_venda) ?? disponiveis) / disponiveis : null,
        demandaRuptura: num(d.demanda_dia_ruptura),
        vendaRiscoDia: num(d.venda_risco_dia),
        ultimaIntegracao: typeof d.estoque_ultima_integracao === 'string' ? d.estoque_ultima_integracao : null,
      },
      otd: {
        entregues: num(d.otd_entregues_atual),
        entreguesAnterior: num(d[`otd_entregues_${ctx.comparacao}`]),
        atual: razao(num(d.otd_no_prazo_atual), num(d.otd_entregues_atual)),
        anterior: razao(num(d[`otd_no_prazo_${ctx.comparacao}`]), num(d[`otd_entregues_${ctx.comparacao}`])),
      },
      nps: {
        respostas: num(d.nps_respostas_atual),
        atual: npsDe(d, 'atual'),
        // Janela móvel de 90 dias contra os 90 anteriores, independente da comparação escolhida
        anterior: npsDe(d, 'anterior'),
      },
      growth: {
        sessoes: num(d.sessoes_atual),
        sessoesAnterior: num(d[`sessoes_${ctx.comparacao}`]),
        transacoes: num(d.transacoes_atual),
        transacoesAnterior: num(d[`transacoes_${ctx.comparacao}`]),
        conversao: razao(num(d.transacoes_atual), num(d.sessoes_atual)),
        conversaoAnterior: razao(num(d[`transacoes_${ctx.comparacao}`]), num(d[`sessoes_${ctx.comparacao}`])),
      },
      farolCs: typeof d.farol_cs === 'string' ? d.farol_cs : null,
      farolCsDetalhe: typeof d.farol_cs_detalhe === 'string' ? d.farol_cs_detalhe : null,
    };
  }

  function npsDe(d, sufixo) {
    const respostas = num(d[`nps_respostas_${sufixo}`]);
    if (!respostas) return null;
    return ((num(d[`nps_promotores_${sufixo}`]) ?? 0) - (num(d[`nps_detratores_${sufixo}`]) ?? 0)) / respostas * 100;
  }

  // Farol do dashboard: > 103% verde, > 97% âmbar, abaixo disso (ou realizado zerado) vermelho
  function farol(atingimento) {
    if (atingimento == null) return { classe: 'neutro', longo: 'Sem meta', curto: 'Sem meta' };
    if (atingimento > 1.03) return { classe: 'bom', longo: 'Acima da meta (> 103%)', curto: 'Acima' };
    if (atingimento > 0.97) return { classe: 'alerta', longo: 'Na faixa da meta (97% a 103%)', curto: 'Na faixa' };
    return { classe: 'ruim', longo: 'Abaixo da meta (< 97%)', curto: 'Abaixo' };
  }

  // ---------------------------------------------------------------------------
  // Decomposição do GMV: (1 + ΔGMV) = (1 + Δpedidos) × (1 + Δitens por pedido) × (1 + Δpreço por item)

  function decomposicao(ind) {
    const { atual, anterior } = ind.venda;
    if (!atual.gmv || !anterior.gmv || !atual.pedidos || !anterior.pedidos || !atual.itens || !anterior.itens) return null;
    return {
      gmv: atual.gmv / anterior.gmv - 1,
      pedidos: atual.pedidos / anterior.pedidos - 1,
      ticket: atual.ticket / anterior.ticket - 1,
      itensPorPedido: atual.itensPorPedido / anterior.itensPorPedido - 1,
      precoItem: atual.precoItem / anterior.precoItem - 1,
    };
  }

  // detalhado: inclui itens por pedido e preço por item. No total de lojas esses dois
  // oscilam pelo mix (B2B vende muito item por pedido), então ficam só na visão de loja.
  function fraseDecomposicao(dec, ctx, detalhado) {
    const principal = Math.abs(dec.pedidos) >= Math.abs(dec.ticket) ? 'volume de pedidos' : 'ticket médio';
    const detalhe = detalhado
      ? ` (itens por pedido ${fmt.variacao.format(dec.itensPorPedido)}, preço médio por item ${fmt.variacao.format(dec.precoItem)})`
      : '';
    return `GMV ${fmt.variacao.format(dec.gmv)} vs ${COMPARACOES[ctx.comparacao].curto}: pedidos ${fmt.variacao.format(dec.pedidos)} e ticket médio ${fmt.variacao.format(dec.ticket)}${detalhe}. O que mais pesou foi o ${principal}.`;
  }

  // ---------------------------------------------------------------------------
  // Faixa da projeção: variação do atingimento dia a dia. A venda de dias sem meta
  // (fim de semana, feriado) vai para o próximo dia com meta, como a própria meta faz.

  function faixaProjecao(diario, campoMeta, s, dataRef) {
    if (s.projecao == null || !diario.length) return null;
    const razoes = [];
    let acumulado = 0;
    for (const d of diario) {
      if (d.dia > dataRef) break;
      acumulado += num(d.gmv) ?? 0;
      const meta = num(d[campoMeta]);
      if (meta > 0) {
        razoes.push(acumulado / meta);
        acumulado = 0;
      }
    }
    if (razoes.length < 3) return null;
    const media = razoes.reduce((a, b) => a + b, 0) / razoes.length;
    const desvio = Math.sqrt(razoes.reduce((a, r) => a + (r - media) ** 2, 0) / (razoes.length - 1));
    const erro = 1.28 * desvio / Math.sqrt(razoes.length); // ~80%
    const restante = s.metaMes - s.metaAteOntem;
    const real = s.real ?? 0;
    return {
      min: real + restante * Math.max(0, s.atingimento - erro),
      max: real + restante * (s.atingimento + erro),
      dias: razoes.length,
    };
  }

  // Série diária somada entre as lojas selecionadas, ordenada por dia
  function serieDiaria(diario, lojas) {
    const porDia = new Map();
    for (const linha of diario) {
      if (lojas && !lojas.has(linha.loja)) continue;
      const atual = porDia.get(linha.dia) ?? { dia: linha.dia };
      for (const campo of ['gmv', 'gmv_forecast', 'gmv_budget']) {
        if (typeof linha[campo] === 'number') atual[campo] = (atual[campo] ?? 0) + linha[campo];
      }
      porDia.set(linha.dia, atual);
    }
    return [...porDia.values()].sort((a, b) => (a.dia < b.dia ? -1 : 1));
  }

  // ---------------------------------------------------------------------------
  // Canais

  function canais(linhas, lojas, ctx, maximo = 6) {
    const porCanal = new Map();
    let total = 0;
    let totalAnterior = 0;
    for (const l of linhas) {
      if (lojas && !lojas.has(l.loja)) continue;
      const atual = num(l.gmv_atual) ?? 0;
      const anterior = num(l[`gmv_${ctx.comparacao}`]) ?? 0;
      const item = porCanal.get(l.canal) ?? { canal: l.canal, tipo: l.tipo, atual: 0, anterior: 0 };
      item.atual += atual;
      item.anterior += anterior;
      porCanal.set(l.canal, item);
      total += atual;
      totalAnterior += anterior;
    }
    const ordenados = [...porCanal.values()].filter(c => c.atual > 0 || c.anterior > 0).sort((a, b) => b.atual - a.atual);
    const visiveis = ordenados.slice(0, maximo);
    const resto = ordenados.slice(maximo);
    if (resto.length) {
      visiveis.push(resto.reduce((acc, c) => ({ ...acc, atual: acc.atual + c.atual, anterior: acc.anterior + c.anterior }),
        { canal: `Outros (${resto.length})`, tipo: 'Outros', atual: 0, anterior: 0 }));
    }
    return {
      total,
      totalAnterior,
      itens: visiveis.map(c => ({ ...c, parcela: total ? c.atual / total : 0, variacao: c.anterior ? c.atual / c.anterior - 1 : null })),
      semCanal: total ? (porCanal.get('Sem informação')?.atual ?? 0) / total : 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Saúde da loja

  function nivel(valor, limites, menorMelhor = false) {
    if (valor == null) return null;
    if (menorMelhor) return valor <= limites.bom ? 'bom' : valor <= limites.alerta ? 'alerta' : 'ruim';
    return valor >= limites.bom ? 'bom' : valor >= limites.alerta ? 'alerta' : 'ruim';
  }

  function saude(ind) {
    const componentes = [];
    const add = (nome, classe, texto) => classe && componentes.push({ nome, classe, texto });
    add('Vendas', nivel(ind.gmv.atingimento, SAUDE.vendas),
      ind.gmv.atingimento == null ? '' : `${fmt.pct0.format(ind.gmv.atingimento)} da meta até ontem`);
    if ((ind.otd.entregues ?? 0) >= BASE_MINIMA_OTD) {
      add('OTD', nivel(ind.otd.atual, SAUDE.otd), `${fmt.pct1.format(ind.otd.atual)} no prazo`);
    }
    add('Ruptura', nivel(ind.estoque.rupturaPct, SAUDE.ruptura, true),
      ind.estoque.rupturaPct == null ? '' : `${fmt.pct1.format(ind.estoque.rupturaPct)} dos SKUs com venda`);
    add('Avaria', nivel(ind.estoque.avariaPct, SAUDE.avaria, true),
      ind.estoque.avariaPct == null ? '' : `${fmt.pct1.format(ind.estoque.avariaPct)} do estoque`);
    if ((ind.nps.respostas ?? 0) >= BASE_MINIMA_NPS) {
      add('NPS', nivel(ind.nps.atual, SAUDE.nps), `NPS ${fmt.inteiro.format(ind.nps.atual)}`);
    }
    if (componentes.length < 2) return { classe: 'neutro', rotulo: 'Sem dados suficientes', componentes };
    const pontos = { bom: 1, alerta: 0.5, ruim: 0 };
    const media = componentes.reduce((a, c) => a + pontos[c.classe], 0) / componentes.length;
    const geral = media >= 0.75 ? ['bom', 'Saudável'] : media >= 0.5 ? ['alerta', 'Atenção'] : ['ruim', 'Crítica'];
    return { classe: geral[0], rotulo: geral[1], componentes };
  }

  // ---------------------------------------------------------------------------
  // Posição relativa entre lojas do mesmo modelo de negócio

  const METRICAS_POSICAO = [
    { nome: 'Crescimento do GMV', valor: i => i.gmv.variacao, maiorMelhor: true, formato: v => fmt.variacao.format(v) },
    { nome: 'Atingimento da meta', valor: i => i.gmv.atingimento, maiorMelhor: true, formato: v => fmt.pct0.format(v) },
    { nome: 'OTD', valor: i => ((i.otd.entregues ?? 0) >= BASE_MINIMA_OTD ? i.otd.atual : null), maiorMelhor: true, formato: v => fmt.pct1.format(v) },
    { nome: 'Ruptura', valor: i => i.estoque.rupturaPct, maiorMelhor: false, formato: v => fmt.pct1.format(v) },
  ];

  function posicaoRelativa(loja, porLoja, modelo) {
    if (!modelo) return null;
    const pares = porLoja.filter(x => x.modelo === modelo);
    const linhas = [];
    for (const m of METRICAS_POSICAO) {
      const valores = pares.map(x => ({ loja: x.loja, v: m.valor(x.ind) })).filter(x => x.v != null);
      const minha = valores.find(x => x.loja === loja);
      if (!minha || valores.length < 5) continue;
      valores.sort((a, b) => (m.maiorMelhor ? b.v - a.v : a.v - b.v));
      const posicao = valores.findIndex(x => x.loja === loja) + 1;
      const quantil = posicao / valores.length;
      const faixa = quantil <= 0.25 ? ['bom', 'Top 25%'] : quantil <= 0.5 ? ['bom', 'Acima da mediana']
        : quantil <= 0.75 ? ['alerta', 'Abaixo da mediana'] : ['ruim', 'Últimos 25%'];
      linhas.push({ nome: m.nome, valor: m.formato(minha.v), posicao, total: valores.length, classe: faixa[0], faixa: faixa[1] });
    }
    return linhas.length ? { modelo, linhas } : null;
  }

  // ---------------------------------------------------------------------------
  // Alertas de dado

  function diasEntre(deIso, ateIso) {
    return Math.round((Date.parse(`${ateIso}T00:00:00Z`) - Date.parse(`${deIso}T00:00:00Z`)) / 864e5);
  }

  function horasDesde(iso, agora) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : (agora - t) / 36e5;
  }

  // geral: inclui os alertas que não são de uma loja (canal sem identificação, fonte atrasada)
  // O atraso de uma fonte é medido no momento da exportação, não de quem abre o site
  function anomalias(porLoja, base, ctx, { geral = true, agora = Date.parse(base.gerado_em) } = {}) {
    const alertas = [];
    const comparacao = COMPARACOES[ctx.comparacao].curto;
    for (const { loja, ind } of porLoja) {
      const { entregues, entreguesAnterior } = ind.otd;
      if ((entregues ?? 0) === 0 && (entreguesAnterior ?? 0) >= ANOMALIA.baseOtd) {
        alertas.push({ loja, texto: `${loja}: nenhuma entrega registrada no período, contra ${fmt.inteiro.format(entreguesAnterior)} no ${comparacao}. Pode ser carga atrasada do OTD.` });
      }
      if ((entregues ?? 0) >= BASE_MINIMA_OTD && ind.otd.atual < ANOMALIA.otdMinimo) {
        alertas.push({ loja, texto: `${loja}: OTD de ${fmt.pct.format(ind.otd.atual)} em ${fmt.inteiro.format(entregues)} entregas. Um valor tão baixo costuma ser prazo prometido errado na origem, não atraso real.` });
      }
      const { sessoes, sessoesAnterior } = ind.growth;
      if ((sessoes ?? 0) === 0 && (sessoesAnterior ?? 0) >= ANOMALIA.baseSessoes) {
        alertas.push({ loja, texto: `${loja}: nenhuma sessão no Google Analytics no período, contra ${fmt.inteiro.format(sessoesAnterior)} no ${comparacao}. A propriedade GA pode ter parado de coletar ou de carregar.` });
      }
      const integracao = ind.estoque.ultimaIntegracao;
      if (integracao) {
        const dias = diasEntre(integracao, base.data_ref);
        if (dias >= ANOMALIA.diasIntegracao[0] && dias <= ANOMALIA.diasIntegracao[1]) {
          alertas.push({ loja, texto: `${loja}: estoque sem integrar há ${dias} dias (última integração em ${dataCurta(integracao)}). A posição mostrada pode estar velha.` });
        }
      }
      const g = ind.gmv;
      if ((g.anterior ?? 0) >= ANOMALIA.baseGmv && (g.real ?? 0) < g.anterior * ANOMALIA.queda) {
        alertas.push({ loja, texto: `${loja}: GMV de ${reais(g.real ?? 0)}, contra ${reais(g.anterior)} no ${comparacao}. Queda abrupta assim costuma ser falha de integração.` });
      } else if ((g.metaAteOntem ?? 0) >= ANOMALIA.baseGmv && (g.real ?? 0) < g.metaAteOntem * ANOMALIA.queda) {
        alertas.push({ loja, texto: `${loja}: GMV em ${fmt.pct0.format(g.atingimento)} da meta até ontem. Pode ser venda registrada em outro seller (a meta fica no seller principal) ou falha de integração.` });
      }
    }
    if (geral) {
      const resumoCanais = canais(base.canais ?? [], null, ctx);
      if (resumoCanais.semCanal >= ANOMALIA.semCanal) {
        alertas.push({ loja: null, texto: `${fmt.pct0.format(resumoCanais.semCanal)} do GMV está sem canal de venda identificado na dim_sales_channels, o que limita a leitura do mix de canais.` });
      }
      for (const f of base.frescor ?? []) {
        const horas = horasDesde(f.ultima_carga, agora);
        const diasDado = f.dado_ate ? diasEntre(f.dado_ate, base.data_ref) : null;
        if (diasDado != null && diasDado > ANOMALIA.diasDado) {
          alertas.push({ loja: null, texto: `${f.fonte}: o dado mais recente é de ${dataCurta(f.dado_ate)}, ${diasDado} dias antes da data de referência. A tabela é recarregada, mas não chega dado novo da origem.` });
        } else if (horas != null && horas > ANOMALIA.horasFonte) {
          alertas.push({ loja: null, texto: `${f.fonte}: última carga há ${fmt.inteiro.format(horas)} horas. Os números dessa fonte podem estar defasados.` });
        }
      }
      const inativas = porLoja.filter(x => x.ind.estoque.ultimaIntegracao && diasEntre(x.ind.estoque.ultimaIntegracao, base.data_ref) > ANOMALIA.diasIntegracao[1]);
      if (inativas.length) {
        const itens = inativas.reduce((a, x) => a + (x.ind.estoque.disponiveis ?? 0), 0);
        alertas.push({ loja: null, texto: `${inativas.length} lojas de estoque não integram há mais de ${ANOMALIA.diasIntegracao[1]} dias e ainda somam ${fmt.compacto.format(itens)} itens disponíveis no total. Se forem lojas inativas, inflam a posição de estoque.` });
      }
    }
    return alertas;
  }

  // ---------------------------------------------------------------------------
  // Resumo em texto

  function fraseVendas(nome, s, ctx) {
    const meta = nomeMeta(ctx).toLowerCase();
    if (s.real == null && s.atingimento == null) return { tom: 'neutro', texto: `Sem ${nome} faturado no período.` };
    const realizado = `${nome} de ${reais(s.real ?? 0)} até ontem`;
    if (s.atingimento == null) return { tom: 'neutro', texto: `${realizado}; sem ${meta} cadastrado para comparar.` };
    let texto = `${realizado}, ${fmt.pctSinal.format(s.atingimento - 1)} vs ${meta}.`;
    if (s.projecao != null) {
      texto += ` No ritmo atual, fecha o mês em ${reais(s.projecao)} (${fmt.pct0.format(s.atingimento)} do ${meta} do mês).`;
    }
    return { tom: farol(s.atingimento).classe, texto };
  }

  function fraseRuptura(e) {
    if (!e.skusRuptura) return null;
    const risco = e.vendaRiscoDia ? `, cerca de ${reais(e.vendaRiscoDia)} por dia em venda que não acontece` : '';
    const curvaA = e.skusRupturaA ? ` (${fmt.inteiro.format(e.skusRupturaA)} da curva A)` : '';
    return {
      tom: e.skusRupturaA ? 'ruim' : 'alerta',
      texto: `${fmt.inteiro.format(e.skusRuptura)} SKUs com venda estão em ruptura${curvaA}${risco}.`,
    };
  }

  function fraseParado(e) {
    if (e.paradoPct == null || e.paradoPct < 0.5) return null;
    return {
      tom: 'alerta',
      texto: `${fmt.pct0.format(e.paradoPct)} do estoque disponível (${fmt.compacto.format(e.disponiveis * e.paradoPct)} itens) está em SKUs sem venda nos últimos 90 dias.`,
    };
  }

  function destaquesGerais(total, porLoja, base, ctx) {
    const meta = nomeMeta(ctx).toLowerCase();
    const comparacao = COMPARACOES[ctx.comparacao].curto;
    const itens = [fraseVendas('GMV', total.gmv, ctx)];

    const dec = decomposicao(total);
    if (dec) itens.push({ tom: dec.gmv >= 0 ? 'bom' : 'ruim', texto: fraseDecomposicao(dec, ctx, false) });

    const comMeta = porLoja.filter(x => x.ind.gmv.atingimento != null);
    if (comMeta.length) {
      const abaixo = comMeta
        .filter(x => farol(x.ind.gmv.atingimento).classe === 'ruim')
        .sort((a, b) => a.ind.gmv.diferenca - b.ind.gmv.diferenca);
      if (abaixo.length) {
        const soma = abaixo.reduce((acc, x) => acc + x.ind.gmv.diferenca, 0);
        const verbo = abaixo.length === 1 ? 'está' : 'estão';
        itens.push({
          tom: 'ruim',
          texto: `${abaixo.length} de ${comMeta.length} lojas com meta ${verbo} abaixo de 97% do ${meta} até ontem, somando ${reais(soma, true)}. Maiores desvios: ${juntar(abaixo.slice(0, 3).map(x => x.loja))}.`,
        });
      } else {
        itens.push({ tom: 'bom', texto: `Todas as ${comMeta.length} lojas com meta estão acima de 97% do ${meta} até ontem.` });
      }
    }

    // Variação em R$ e não em %: loja pequena com base minúscula não domina o destaque
    const comBase = porLoja
      .filter(x => x.ind.gmv.real != null && x.ind.gmv.anterior)
      .map(x => ({ ...x, delta: x.ind.gmv.real - x.ind.gmv.anterior }))
      .sort((a, b) => b.delta - a.delta);
    const frases = [];
    const alta = comBase[0];
    const queda = comBase[comBase.length - 1];
    if (alta && alta.delta > 0) frases.push(`Maior alta de GMV vs ${comparacao}: ${alta.loja} (${reais(alta.delta, true)}, ${fmt.variacao.format(alta.ind.gmv.variacao)}).`);
    if (queda && queda.delta < 0) frases.push(`Maior queda: ${queda.loja} (${reais(queda.delta, true)}, ${fmt.variacao.format(queda.ind.gmv.variacao)}).`);
    if (frases.length) itens.push({ tom: 'neutro', texto: frases.join(' ') });

    const ruptura = fraseRuptura(total.estoque);
    if (ruptura) itens.push(ruptura);
    const parado = fraseParado(total.estoque);
    if (parado) itens.push(parado);

    if (total.otd.atual != null) {
      const baixas = porLoja
        .filter(x => (x.ind.otd.entregues ?? 0) >= BASE_MINIMA_OTD && x.ind.otd.atual < META_OTD)
        .sort((a, b) => a.ind.otd.atual - b.ind.otd.atual);
      let texto = `OTD geral de ${fmt.pct.format(total.otd.atual)} (meta ${fmt.pct0.format(META_OTD)}).`;
      if (baixas.length) {
        const [sujeito, verbo] = baixas.length === 1 ? ['loja', 'está'] : ['lojas', 'estão'];
        texto += ` ${baixas.length} ${sujeito} com ao menos ${BASE_MINIMA_OTD} entregas ${verbo} abaixo da meta: ${juntar(baixas.slice(0, 3).map(x => `${x.loja} (${fmt.pct.format(x.ind.otd.atual)})`))}.`;
      } else {
        texto += ` Nenhuma loja com ao menos ${BASE_MINIMA_OTD} entregas abaixo da meta.`;
      }
      const tom = total.otd.atual < META_OTD ? 'ruim' : (baixas.length ? 'alerta' : 'bom');
      itens.push({ tom, texto });
    }

    const churn = porLoja.filter(x => x.ind.farolCs === 'Churn' && (x.ind.gmv.real ?? 0) > 0);
    if (churn.length) {
      const gmv = churn.reduce((a, x) => a + x.ind.gmv.real, 0);
      itens.push({ tom: 'alerta', texto: `${churn.length} ${churn.length === 1 ? 'loja marcada' : 'lojas marcadas'} como Churn pelo CS ainda ${churn.length === 1 ? 'faturou' : 'faturaram'} ${reais(gmv)} no período (${fmt.pct0.format(gmv / (total.gmv.real || 1))} do GMV): ${juntar(churn.sort((a, b) => b.ind.gmv.real - a.ind.gmv.real).map(x => x.loja), 3)}.` });
    }
    const divergentes = porLoja.filter(x => x.ind.farolCs === 'Feliz' && x.saude.classe === 'ruim');
    if (divergentes.length) {
      itens.push({ tom: 'alerta', texto: `${divergentes.length} ${divergentes.length === 1 ? 'loja aparece' : 'lojas aparecem'} como Feliz no farol de CS, mas com saúde crítica nos dados: ${juntar(divergentes.map(x => x.loja), 4)}.` });
    }

    const criticas = porLoja.filter(x => x.saude.classe === 'ruim');
    if (criticas.length) {
      itens.push({
        tom: 'ruim',
        texto: `${criticas.length} ${criticas.length === 1 ? 'loja com saúde crítica' : 'lojas com saúde crítica'} (vendas, OTD, ruptura, avaria e NPS combinados): ${juntar(criticas.map(x => x.loja), 4)}.`,
      });
    }
    return itens;
  }

  function destaquesLoja(ind, ctx) {
    const comparacao = COMPARACOES[ctx.comparacao].curto;
    const itens = [fraseVendas('GMV', ind.gmv, ctx)];
    const dec = decomposicao(ind);
    if (dec) {
      itens.push({ tom: dec.gmv >= 0 ? 'bom' : 'ruim', texto: fraseDecomposicao(dec, ctx, true) });
    } else if (ind.gmv.variacao != null) {
      const delta = ind.gmv.real - ind.gmv.anterior;
      itens.push({ tom: delta >= 0 ? 'bom' : 'ruim', texto: `GMV ${fmt.variacao.format(ind.gmv.variacao)} vs ${comparacao} (${reais(delta, true)}).` });
    }
    if (ind.otd.atual != null) {
      const pequena = ind.otd.entregues < BASE_MINIMA_OTD;
      itens.push({
        tom: pequena ? 'neutro' : (ind.otd.atual >= META_OTD ? 'bom' : 'ruim'),
        texto: `OTD de ${fmt.pct.format(ind.otd.atual)} em ${fmt.inteiro.format(ind.otd.entregues)} entregas (meta ${fmt.pct0.format(META_OTD)}).`
          + (pequena ? ' Base pequena: o percentual oscila muito com poucos pedidos.' : ''),
      });
    }
    const ruptura = fraseRuptura(ind.estoque);
    if (ruptura) itens.push(ruptura);
    const parado = fraseParado(ind.estoque);
    if (parado) itens.push(parado);
    const { disponiveis, avaria, avariaPct } = ind.estoque;
    if (disponiveis != null) {
      const parteAvaria = avaria ? ` e ${fmt.inteiro.format(avaria)} em avaria (${fmt.pct.format(avariaPct)} do total)` : '';
      itens.push({ tom: 'neutro', texto: `Estoque com ${fmt.inteiro.format(disponiveis)} itens disponíveis${parteAvaria}.` });
    }
    return itens;
  }

  globalThis.Nucleo = {
    METAS, COMPARACOES, META_OTD, BASE_MINIMA_OTD, SAUDE,
    fmt, reais, num, razao, nomeMeta, juntar, dataCurta, intervalo,
    somar, enriquecer, indicadores, farol, decomposicao, faixaProjecao, serieDiaria,
    canais, saude, posicaoRelativa, anomalias, destaquesGerais, destaquesLoja,
  };
})();
