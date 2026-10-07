(function () {
  'use strict';

  const TODAS = '__todas__';
  const CHAVE_LOJA = 'informativo-kpis:loja';
  const CHAVE_META = 'informativo-kpis:meta';
  const METAS = { forecast: 'Forecast', budget: 'Budget' };
  const META_OTD = 0.95;
  const BASE_MINIMA_OTD = 100; // entregas: abaixo disso o % de OTD oscila demais para virar destaque
  const LINHAS_TABELA = 10;

  const nf = opcoes => new Intl.NumberFormat('pt-BR', opcoes);
  const fmt = {
    inteiro: nf({ maximumFractionDigits: 0 }),
    inteiroSinal: nf({ maximumFractionDigits: 0, signDisplay: 'exceptZero' }),
    compacto: nf({ notation: 'compact', maximumFractionDigits: 1 }),
    pct: nf({ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    pct0: nf({ style: 'percent', maximumFractionDigits: 0 }),
    pctSinal: nf({ style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }),
    variacao: nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }),
    pp: nf({ minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' }),
  };
  // Espaço não separável: "−R$" nunca quebra longe do número
  const reais = (v, comSinal = false) =>
    `${comSinal && v > 0 ? '+' : ''}${v < 0 ? '−' : ''}R$ ${fmt.compacto.format(Math.abs(v))}`;

  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const razao = (a, b) => (a == null || !b ? null : a / b);
  const nomeMeta = ctx => METAS[ctx.meta];

  // ---------------------------------------------------------------------------
  // Indicadores derivados. Sempre calculados sobre campos já somados, para o
  // "Todas as lojas" não virar média de percentual.

  function serieVendas(d, prefixo, meta) {
    const real = num(d[`${prefixo}_atual`]);
    const anterior = num(d[`${prefixo}_anterior`]);
    const metaAteOntem = num(d[`${prefixo}_${meta}`]);
    const metaMes = num(d[`${prefixo}_${meta}_mes`]);
    // Sem venda e com meta, o dashboard trata o realizado como 0 (vira -100%)
    const atingimento = metaAteOntem ? (real ?? 0) / metaAteOntem : null;
    return {
      real,
      anterior,
      metaAteOntem,
      metaMes,
      atingimento,
      diferenca: atingimento == null ? null : (real ?? 0) - metaAteOntem,
      // Projeção: mantém o atingimento atual sobre a meta do mês. A meta diária
      // já traz o peso de fim de semana e feriado, então não é uma média linear.
      projecao: atingimento == null || !metaMes ? null : atingimento * metaMes,
      variacao: real == null || !anterior ? null : real / anterior - 1,
    };
  }

  function indicadores(d, ctx) {
    return {
      gmv: serieVendas(d, 'gmv', ctx.meta),
      ser: serieVendas(d, 'ser', ctx.meta),
      estoque: { disponiveis: num(d.itens_disponiveis), avaria: num(d.itens_avaria) },
      otd: {
        entregues: num(d.otd_entregues_atual),
        entreguesAnterior: num(d.otd_entregues_anterior),
        atual: razao(num(d.otd_no_prazo_atual), num(d.otd_entregues_atual)),
        anterior: razao(num(d.otd_no_prazo_anterior), num(d.otd_entregues_anterior)),
      },
    };
  }

  // Farol do dashboard: > 103% verde, > 97% âmbar, abaixo disso (ou realizado zerado) vermelho
  function farol(atingimento) {
    if (atingimento == null) return { classe: 'neutro', longo: 'Sem meta', curto: 'Sem meta' };
    if (atingimento > 1.03) return { classe: 'bom', longo: 'Acima da meta (> 103%)', curto: 'Acima' };
    if (atingimento > 0.97) return { classe: 'alerta', longo: 'Na faixa da meta (97% a 103%)', curto: 'Na faixa' };
    return { classe: 'ruim', longo: 'Abaixo da meta (< 97%)', curto: 'Abaixo' };
  }

  // ---------------------------------------------------------------------------
  // Seções de cards. tipo 'valor' (padrão): número com variação opcional vs mês
  // anterior; 'meta': delta contra a meta até ontem; 'projecao': fechamento do mês.

  const SECAO_VENDAS = {
    sobretitulo: 'Desempenho de vendas · One page',
    titulo: 'Vendas',
    nota: ctx => `Faturado por data de NF, tipo de venda "Venda" (mesmas regras da One page do Desempenho de vendas). Meta: ${nomeMeta(ctx)}. A projeção mantém o atingimento atual até o fim do mês.`,
    tiles: [
      { rotulo: 'GMV realizado (R$)', atual: i => i.gmv.real, anterior: i => i.gmv.anterior, formato: 'inteiro', melhor: 'alta' },
      { tipo: 'meta', rotulo: ctx => `Delta GMV vs ${nomeMeta(ctx).toLowerCase()} (%)`, serie: i => i.gmv },
      { tipo: 'projecao', rotulo: 'Projeção de GMV no mês (R$)', serie: i => i.gmv },
      { rotulo: 'SER estimado (R$)', atual: i => i.ser.real, anterior: i => i.ser.anterior, formato: 'inteiro', melhor: 'alta' },
      { tipo: 'meta', rotulo: ctx => `Delta SER vs ${nomeMeta(ctx).toLowerCase()} (%)`, serie: i => i.ser },
      { tipo: 'projecao', rotulo: 'Projeção de SER no mês (R$)', serie: i => i.ser },
    ],
  };

  const SECAO_ESTOQUE = {
    sobretitulo: 'Estoque B2C',
    titulo: 'Estoque',
    nota: 'Posição no momento da atualização, sem comparativo. Avaria da Pernod Ricard não é exibida (mesma regra do dashboard Estoque B2C).',
    tiles: [
      { rotulo: 'Itens disponíveis (un.)', atual: i => i.estoque.disponiveis, formato: 'inteiro' },
      { rotulo: 'Itens em avaria (un.)', atual: i => i.estoque.avaria, formato: 'inteiro' },
    ],
  };

  const SECAO_OTD = {
    sobretitulo: 'OTD B2C',
    titulo: 'Entregas',
    nota: 'Pedidos B2C pela data de entrega (mesma regra do dashboard OTD B2C).',
    tiles: [
      { rotulo: 'Pedidos entregues (qtd.)', atual: i => i.otd.entregues, anterior: i => i.otd.entreguesAnterior, formato: 'inteiro', melhor: 'alta' },
      { rotulo: 'OTD (%)', atual: i => i.otd.atual, anterior: i => i.otd.anterior, formato: 'pct', melhor: 'alta', alvo: META_OTD },
    ],
  };

  // ---------------------------------------------------------------------------
  // Utilitários de DOM e texto

  const el = id => document.getElementById(id);
  const resolver = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

  function criar(tag, classe, texto) {
    const node = document.createElement(tag);
    if (classe) node.className = classe;
    if (texto != null) node.textContent = texto;
    return node;
  }

  function linha(...conteudo) {
    const p = criar('p', 'tile__linha');
    p.append(...conteudo);
    return p;
  }

  function status(classe, texto) {
    return criar('span', `status status--${classe}`, texto);
  }

  function juntar(itens) {
    return itens.length < 2 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
  }

  function dataCurta(iso) {
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  function intervalo(p) {
    return `${dataCurta(p.inicio)} a ${dataCurta(p.fim)}`;
  }

  function formatar(valor, formato) {
    return formato === 'pct' ? fmt.pct.format(valor) : fmt.inteiro.format(valor);
  }

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

  // ---------------------------------------------------------------------------
  // Cards

  function vazio(card, conteudo) {
    card.append(criar('p', 'tile__valor tile__valor--vazio', '—'));
    card.append(linha(conteudo));
    return card;
  }

  function linhaVariacao(tile, atual, anterior, periodoAnterior) {
    if (anterior == null || (tile.formato !== 'pct' && anterior === 0)) {
      return linha('Sem base no mesmo período do mês anterior');
    }
    const diferenca = atual - anterior;
    const texto = tile.formato === 'pct'
      ? `${fmt.pp.format(diferenca * 100)} p.p.`
      : fmt.variacao.format(atual / anterior - 1);
    const subiu = diferenca > 0;
    const classe = diferenca === 0 ? 'delta--neutro'
      : (subiu === (tile.melhor === 'alta') ? 'delta--bom' : 'delta--ruim');
    const seta = diferenca === 0 ? '■' : (subiu ? '▲' : '▼');
    return linha(criar('span', `delta ${classe}`, `${seta} ${texto}`), ` vs ${intervalo(periodoAnterior)}`);
  }

  function linhaAlvo(tile, atual) {
    const dentro = atual >= tile.alvo;
    return linha(
      status(dentro ? 'bom' : 'ruim', dentro ? 'Dentro da meta' : 'Abaixo da meta'),
      ` · meta ${formatar(tile.alvo, tile.formato)} (${fmt.pp.format((atual - tile.alvo) * 100)} p.p.)`,
    );
  }

  function tileMeta(card, s, ctx) {
    if (s.atingimento == null) return vazio(card, status('neutro', 'Sem meta'));
    const f = farol(s.atingimento);
    card.append(criar('p', 'tile__valor', fmt.pctSinal.format(s.atingimento - 1)));
    card.append(linha(`${nomeMeta(ctx)} até ontem: ${fmt.inteiro.format(s.metaAteOntem)} (R$)`));
    card.append(linha(`Diferença: ${fmt.inteiroSinal.format(s.diferenca)} (R$)`));
    card.append(linha(status(f.classe, f.longo)));
    return card;
  }

  function medidor(s, f) {
    const limitar = v => Math.min(Math.max(v, 0), 1);
    const realizado = limitar((s.real ?? 0) / s.metaMes);
    const esperado = limitar(s.metaAteOntem / s.metaMes);
    const caixa = criar('div', `medidor medidor--${f.classe}`);
    caixa.setAttribute('role', 'img');
    caixa.setAttribute('aria-label', `Realizado ${fmt.pct0.format(realizado)} da meta do mês; esperado até ontem ${fmt.pct0.format(esperado)}`);
    const barra = criar('div', 'medidor__preenchimento');
    barra.style.width = `${realizado * 100}%`;
    const marca = criar('div', 'medidor__marca');
    marca.style.left = `${esperado * 100}%`;
    caixa.append(barra, marca);
    return caixa;
  }

  function tileProjecao(card, s, ctx) {
    if (s.projecao == null) {
      return vazio(card, s.metaMes ? 'Sem meta até ontem para projetar' : status('neutro', 'Sem meta'));
    }
    const meta = nomeMeta(ctx).toLowerCase();
    const f = farol(s.atingimento);
    card.append(criar('p', 'tile__valor', fmt.inteiro.format(s.projecao)));
    card.append(medidor(s, f));
    card.append(linha(`${fmt.pct0.format((s.real ?? 0) / s.metaMes)} do mês feito · ${fmt.pct0.format(s.metaAteOntem / s.metaMes)} esperado até ontem`));
    card.append(linha(status(f.classe, `Fecha em ${fmt.pct0.format(s.atingimento)} do ${meta} do mês (${fmt.compacto.format(s.metaMes)})`)));
    return card;
  }

  function renderizarTile(tile, ind, ctx) {
    const card = criar('article', 'tile');
    card.append(criar('h3', 'tile__rotulo', resolver(tile.rotulo, ctx)));
    if (tile.tipo === 'meta') return tileMeta(card, tile.serie(ind), ctx);
    if (tile.tipo === 'projecao') return tileProjecao(card, tile.serie(ind), ctx);

    const atual = num(tile.atual(ind));
    if (atual == null) return vazio(card, 'Sem dado para esta seleção');
    card.append(criar('p', 'tile__valor', formatar(atual, tile.formato)));
    if (tile.anterior) card.append(linhaVariacao(tile, atual, num(tile.anterior(ind)), estado.base.periodo.anterior));
    if (tile.alvo != null) card.append(linhaAlvo(tile, atual));
    return card;
  }

  // ---------------------------------------------------------------------------
  // Seções

  function novaSecao({ sobretitulo, titulo, nota }, ctx) {
    const secao = criar('section', 'secao');
    if (sobretitulo) secao.append(criar('p', 'secao__sobretitulo', sobretitulo));
    secao.append(criar('h2', 'secao__titulo', titulo));
    if (nota) secao.append(criar('p', 'secao__nota', resolver(nota, ctx)));
    return secao;
  }

  function secaoCards(def, ind, ctx) {
    const secao = novaSecao(def, ctx);
    const grade = criar('div', 'secao__grade');
    for (const tile of def.tiles) grade.append(renderizarTile(tile, ind, ctx));
    secao.append(grade);
    return secao;
  }

  // Resumo: frases montadas a partir dos números, do jeito que alguém contaria numa reunião

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

  function destaquesGerais(total, porLoja, ctx) {
    const meta = nomeMeta(ctx).toLowerCase();
    const itens = [fraseVendas('GMV', total.gmv, ctx)];

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
    if (alta && alta.delta > 0) frases.push(`Maior alta de GMV vs mês anterior: ${alta.loja} (${reais(alta.delta, true)}, ${fmt.variacao.format(alta.ind.gmv.variacao)}).`);
    if (queda && queda.delta < 0) frases.push(`Maior queda: ${queda.loja} (${reais(queda.delta, true)}, ${fmt.variacao.format(queda.ind.gmv.variacao)}).`);
    if (frases.length) itens.push({ tom: 'neutro', texto: frases.join(' ') });

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
    return itens;
  }

  function destaquesLoja(ind, ctx) {
    const itens = [fraseVendas('GMV', ind.gmv, ctx)];
    if (ind.gmv.variacao != null) {
      const delta = ind.gmv.real - ind.gmv.anterior;
      itens.push({
        tom: delta >= 0 ? 'bom' : 'ruim',
        texto: `GMV ${fmt.variacao.format(ind.gmv.variacao)} vs mesmo período do mês anterior (${reais(delta, true)}).`,
      });
    }
    if (ind.otd.atual != null) {
      const pequena = ind.otd.entregues < BASE_MINIMA_OTD;
      itens.push({
        tom: pequena ? 'neutro' : (ind.otd.atual >= META_OTD ? 'bom' : 'ruim'),
        texto: `OTD de ${fmt.pct.format(ind.otd.atual)} em ${fmt.inteiro.format(ind.otd.entregues)} entregas (meta ${fmt.pct0.format(META_OTD)}).`
          + (pequena ? ' Base pequena: o percentual oscila muito com poucos pedidos.' : ''),
      });
    }
    const { disponiveis, avaria } = ind.estoque;
    if (disponiveis != null) {
      const parteAvaria = avaria ? ` e ${fmt.inteiro.format(avaria)} em avaria (${fmt.pct.format(avaria / (disponiveis + avaria))} do total)` : '';
      itens.push({ tom: 'neutro', texto: `Estoque com ${fmt.inteiro.format(disponiveis)} itens disponíveis${parteAvaria}.` });
    }
    return itens;
  }

  function secaoResumo(total, porLoja, ctx) {
    const secao = novaSecao({ sobretitulo: 'Destaques do período', titulo: 'Resumo' }, ctx);
    const lista = criar('ul', 'destaques');
    const itens = ctx.loja === TODAS ? destaquesGerais(total, porLoja, ctx) : destaquesLoja(total, ctx);
    for (const { tom, texto } of itens) lista.append(criar('li', `destaque destaque--${tom}`, texto));
    secao.append(lista);
    return secao;
  }

  // Tabela "onde agir": maiores desvios em R$ primeiro, lojas sem meta no fim

  function celula(tr, texto, classe = 'num') {
    const td = tr.insertCell();
    td.className = classe;
    td.textContent = texto;
    return td;
  }

  function secaoTabela(porLoja, ctx) {
    const meta = nomeMeta(ctx);
    const secao = novaSecao({
      sobretitulo: 'Todas as lojas',
      titulo: 'Onde agir',
      nota: `Ordenado pela diferença em R$ contra o ${meta.toLowerCase()} até ontem, maiores desvios primeiro. Lojas sem meta ficam no fim. Clique no nome para ver a loja.`,
    }, ctx);

    const linhas = porLoja.filter(x => x.ind.gmv.real != null || x.ind.gmv.atingimento != null);
    const comMeta = linhas.filter(x => x.ind.gmv.atingimento != null).sort((a, b) => a.ind.gmv.diferenca - b.ind.gmv.diferenca);
    const semMeta = linhas.filter(x => x.ind.gmv.atingimento == null).sort((a, b) => (b.ind.gmv.real ?? 0) - (a.ind.gmv.real ?? 0));
    const ordenadas = [...comMeta, ...semMeta];
    const visiveis = ctx.tabelaCompleta ? ordenadas : ordenadas.slice(0, LINHAS_TABELA);

    const tabela = criar('table', 'tabela');
    const cabecalho = tabela.createTHead().insertRow();
    const colunas = [
      ['Loja', ''], ['GMV (R$)', 'num'], [`${meta} até ontem (R$)`, 'num'], ['Delta (%)', 'num'],
      ['Diferença (R$)', 'num'], ['Projeção do mês (R$)', 'num'], ['OTD (%)', 'num'], ['Farol', ''],
    ];
    for (const [texto, classe] of colunas) {
      const th = criar('th', classe, texto);
      th.scope = 'col';
      cabecalho.append(th);
    }

    const corpo = tabela.createTBody();
    for (const x of visiveis) {
      const g = x.ind.gmv;
      const o = x.ind.otd;
      const tr = corpo.insertRow();
      const nome = criar('th');
      nome.scope = 'row';
      const botao = criar('button', 'link-loja', x.loja);
      botao.type = 'button';
      botao.addEventListener('click', () => selecionarLoja(x.loja));
      nome.append(botao);
      tr.append(nome);

      celula(tr, g.real == null ? '—' : fmt.inteiro.format(g.real));
      celula(tr, g.metaAteOntem ? fmt.inteiro.format(g.metaAteOntem) : '—');
      celula(tr, g.atingimento == null ? '—' : fmt.pctSinal.format(g.atingimento - 1));
      celula(tr, g.diferenca == null ? '—' : fmt.inteiroSinal.format(g.diferenca));
      celula(tr, g.projecao == null ? '—' : fmt.inteiro.format(g.projecao));
      const otd = celula(tr, o.atual == null ? '—' : fmt.pct.format(o.atual));
      if (o.atual != null && o.entregues < BASE_MINIMA_OTD) {
        otd.classList.add('num--fraco');
        otd.title = `Base pequena: ${fmt.inteiro.format(o.entregues)} entregas`;
      }
      const f = farol(g.atingimento);
      tr.insertCell().append(status(f.classe, f.curto));
    }

    const envoltorio = criar('div', 'tabela-envoltorio');
    envoltorio.append(tabela);
    secao.append(envoltorio);

    if (ordenadas.length > LINHAS_TABELA) {
      const botao = criar('button', 'botao-secundario', ctx.tabelaCompleta ? 'Mostrar menos' : `Mostrar todas as ${ordenadas.length} lojas`);
      botao.type = 'button';
      botao.addEventListener('click', () => {
        ctx.tabelaCompleta = !ctx.tabelaCompleta;
        renderizar();
      });
      secao.append(botao);
    }
    return secao;
  }

  // ---------------------------------------------------------------------------
  // Estado, filtros e carga

  const estado = { base: null, ctx: { loja: TODAS, meta: 'forecast', tabelaCompleta: false } };

  function renderizar() {
    const { base, ctx } = estado;
    const linhas = ctx.loja === TODAS ? base.lojas : base.lojas.filter(l => l.loja === ctx.loja);
    const total = indicadores(somar(linhas), ctx);
    const porLoja = base.lojas.map(l => ({ loja: l.loja, ind: indicadores(l, ctx) }));

    el('secoes').replaceChildren(
      secaoResumo(total, porLoja, ctx),
      secaoCards(SECAO_VENDAS, total, ctx),
      ...(ctx.loja === TODAS ? [secaoTabela(porLoja, ctx)] : []),
      secaoCards(SECAO_ESTOQUE, total, ctx),
      secaoCards(SECAO_OTD, total, ctx),
    );
  }

  // Estado inicial: URL > última escolha do usuário > padrão
  function lerPreferencia(param, chave, validos, padrao) {
    const daUrl = new URLSearchParams(location.search).get(param);
    if (daUrl && validos.includes(daUrl)) return daUrl;
    try {
      const salva = localStorage.getItem(chave);
      if (salva && validos.includes(salva)) return salva;
    } catch (_) { /* storage bloqueado: segue sem lembrar */ }
    return padrao;
  }

  function lembrar(param, chave, valor, padrao) {
    try { localStorage.setItem(chave, valor); } catch (_) { /* idem */ }
    const url = new URL(location.href);
    if (valor === padrao) url.searchParams.delete(param);
    else url.searchParams.set(param, valor);
    history.replaceState(null, '', url);
  }

  function selecionarLoja(loja) {
    estado.ctx.loja = loja;
    el('seletor-loja').value = loja;
    lembrar('loja', CHAVE_LOJA, loja, TODAS);
    renderizar();
    document.querySelector('.filtros').scrollIntoView({ behavior: 'smooth' });
  }

  function montarFiltros() {
    const { base, ctx } = estado;
    const lojas = [...new Set(base.lojas.map(l => l.loja))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const seletor = el('seletor-loja');
    seletor.append(new Option('Todas as lojas', TODAS));
    for (const loja of lojas) seletor.append(new Option(loja, loja));

    ctx.loja = lerPreferencia('loja', CHAVE_LOJA, [TODAS, ...lojas], TODAS);
    seletor.value = ctx.loja;
    seletor.addEventListener('change', () => {
      ctx.loja = seletor.value;
      lembrar('loja', CHAVE_LOJA, ctx.loja, TODAS);
      renderizar();
    });

    ctx.meta = lerPreferencia('meta', CHAVE_META, Object.keys(METAS), 'forecast');
    const botoes = [...document.querySelectorAll('[data-meta]')];
    const marcar = () => botoes.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.meta === ctx.meta)));
    marcar();
    botoes.forEach(botao => botao.addEventListener('click', () => {
      ctx.meta = botao.dataset.meta;
      lembrar('meta', CHAVE_META, ctx.meta, 'forecast');
      marcar();
      renderizar();
    }));
  }

  async function carregar() {
    const real = await fetch('data/kpis.json', { cache: 'no-store' }).catch(() => null);
    if (real && real.ok) return real.json();
    const exemplo = await fetch('data/kpis.exemplo.json', { cache: 'no-store' });
    if (!exemplo.ok) throw new Error(`HTTP ${exemplo.status}`);
    el('aviso-exemplo').hidden = false;
    return exemplo.json();
  }

  carregar()
    .then(base => {
      estado.base = base;
      const gerado = new Date(base.gerado_em).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
      });
      el('atualizacao').textContent = `Atualizado em ${gerado}`;
      el('periodo').textContent = `Mês corrente: ${intervalo(base.periodo.atual)} · comparado com ${intervalo(base.periodo.anterior)}`;
      montarFiltros();
      renderizar();
    })
    .catch(erro => {
      el('atualizacao').textContent = 'Falha ao carregar';
      el('secoes').replaceChildren(criar('p', 'erro', `Não foi possível carregar os dados (${erro.message}).`));
    });
})();
