// Interface do site. As regras e os textos dos insights ficam em nucleo.js.
(function () {
  'use strict';

  const N = globalThis.Nucleo;
  const { fmt, reais, num, nomeMeta } = N;

  const TODAS = '__todas__';
  const LINHAS_TABELA = 10;
  const PREFERENCIAS = {
    loja: { chave: 'informativo-kpis:loja', padrao: TODAS },
    meta: { chave: 'informativo-kpis:meta', padrao: 'forecast' },
    comp: { chave: 'informativo-kpis:comp', padrao: 'anterior' },
  };

  // ---------------------------------------------------------------------------
  // Utilitários de DOM

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

  function periodoComparacao(ctx) {
    return estado.base.periodo[ctx.comparacao] ?? estado.base.periodo.anterior;
  }

  // ---------------------------------------------------------------------------
  // Cards

  function formatar(valor, formato) {
    if (formato === 'pct') return fmt.pct.format(valor);
    if (formato === 'decimal') return fmt.decimal.format(valor);
    if (formato === 'nps') return fmt.inteiro.format(valor);
    return fmt.inteiro.format(valor);
  }

  function vazio(card, conteudo) {
    card.append(criar('p', 'tile__valor tile__valor--vazio', '—'));
    card.append(linha(conteudo));
    return card;
  }

  function linhaVariacao(tile, atual, anterior, ctx) {
    if (anterior == null || (tile.formato !== 'pct' && tile.formato !== 'nps' && anterior === 0)) {
      return linha(`Sem base ${tile.rotuloComparacao ? `nos ${resolver(tile.rotuloComparacao, ctx)}` : `no ${N.COMPARACOES[ctx.comparacao].curto}`}`);
    }
    const diferenca = atual - anterior;
    const texto = tile.formato === 'pct' ? `${fmt.pp.format(diferenca * 100)} p.p.`
      : tile.formato === 'nps' ? `${fmt.inteiroSinal.format(diferenca)} ${Math.round(Math.abs(diferenca)) === 1 ? 'ponto' : 'pontos'}`
        : fmt.variacao.format(atual / anterior - 1);
    const subiu = diferenca > 0;
    // melhor: 'neutro' = mudança sem juízo de bom ou ruim (ex.: mais desconto)
    const classe = diferenca === 0 || tile.melhor === 'neutro' ? 'delta--neutro'
      : (subiu === (tile.melhor === 'alta') ? 'delta--bom' : 'delta--ruim');
    const seta = diferenca === 0 ? '■' : (subiu ? '▲' : '▼');
    const referencia = tile.rotuloComparacao ? resolver(tile.rotuloComparacao, ctx) : N.intervalo(periodoComparacao(ctx));
    return linha(criar('span', `delta ${classe}`, `${seta} ${texto}`), ` vs ${referencia}`);
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
    const f = N.farol(s.atingimento);
    card.append(criar('p', 'tile__valor', fmt.pctSinal.format(s.atingimento - 1)));
    card.append(linha(`${nomeMeta(ctx)} até ontem: ${fmt.inteiro.format(s.metaAteOntem)} (R$)`));
    card.append(linha(`Diferença: ${fmt.inteiroSinal.format(s.diferenca)} (R$)`));
    card.append(linha(status(f.classe, f.longo)));
    return card;
  }

  // Trilho: meta do mês. Preenchimento: realizado. Faixa clara: projeção provável. Marca: esperado até ontem.
  function medidor(s, f, faixa) {
    const limitar = v => Math.min(Math.max(v, 0), 1);
    const realizado = limitar((s.real ?? 0) / s.metaMes);
    const esperado = limitar(s.metaAteOntem / s.metaMes);
    const caixa = criar('div', `medidor medidor--${f.classe}`);
    caixa.setAttribute('role', 'img');
    caixa.setAttribute('aria-label', `Realizado ${fmt.pct0.format(realizado)} da meta do mês; esperado até ontem ${fmt.pct0.format(esperado)}`);
    if (faixa) {
      const banda = criar('div', 'medidor__faixa');
      banda.style.left = `${limitar(faixa.min / s.metaMes) * 100}%`;
      banda.style.width = `${(limitar(faixa.max / s.metaMes) - limitar(faixa.min / s.metaMes)) * 100}%`;
      caixa.append(banda);
    }
    const barra = criar('div', 'medidor__preenchimento');
    barra.style.width = `${realizado * 100}%`;
    const marca = criar('div', 'medidor__marca');
    marca.style.left = `${esperado * 100}%`;
    caixa.append(barra, marca);
    return caixa;
  }

  function tileProjecao(card, s, ctx, faixa) {
    if (s.projecao == null) {
      return vazio(card, s.metaMes ? 'Sem meta até ontem para projetar' : status('neutro', 'Sem meta'));
    }
    const meta = nomeMeta(ctx).toLowerCase();
    const f = N.farol(s.atingimento);
    card.append(criar('p', 'tile__valor', fmt.inteiro.format(s.projecao)));
    card.append(medidor(s, f, faixa));
    card.append(linha(`${fmt.pct0.format((s.real ?? 0) / s.metaMes)} do mês feito · ${fmt.pct0.format(s.metaAteOntem / s.metaMes)} esperado até ontem`));
    if (faixa) {
      card.append(linha(`Faixa provável (80%): ${reais(faixa.min)} a ${reais(faixa.max)}`));
    }
    card.append(linha(status(f.classe, `Fecha em ${fmt.pct0.format(s.atingimento)} do ${meta} do mês (${fmt.compacto.format(s.metaMes)})`)));
    return card;
  }

  function renderizarTile(tile, ind, ctx, extra) {
    const card = criar('article', 'tile');
    card.append(criar('h3', 'tile__rotulo', resolver(tile.rotulo, ctx)));
    if (tile.tipo === 'meta') return tileMeta(card, tile.serie(ind), ctx);
    if (tile.tipo === 'projecao') return tileProjecao(card, tile.serie(ind), ctx, tile.faixa ? extra.faixa : null);

    const atual = num(tile.atual(ind));
    if (atual == null) return vazio(card, 'Sem dado para esta seleção');
    card.append(criar('p', 'tile__valor', formatar(atual, tile.formato)));
    if (tile.anterior) card.append(linhaVariacao(tile, atual, num(tile.anterior(ind)), ctx));
    if (tile.alvo != null) card.append(linhaAlvo(tile, atual));
    if (tile.nota) {
      const nota = tile.nota(ind);
      if (nota) card.append(linha(nota));
    }
    return card;
  }

  // ---------------------------------------------------------------------------
  // Definição das seções de cards

  const SECAO_VENDAS = {
    sobretitulo: 'Desempenho de vendas · One page',
    titulo: 'Vendas',
    nota: ctx => `Faturado por data de NF, tipo de venda "Venda" (mesmas regras da One page do Desempenho de vendas). Meta: ${nomeMeta(ctx)}. A projeção mantém o atingimento atual até o fim do mês.`,
    tiles: [
      { rotulo: 'GMV realizado (R$)', atual: i => i.gmv.real, anterior: i => i.gmv.anterior, formato: 'inteiro', melhor: 'alta' },
      { tipo: 'meta', rotulo: ctx => `Delta GMV vs ${nomeMeta(ctx).toLowerCase()} (%)`, serie: i => i.gmv },
      { tipo: 'projecao', rotulo: 'Projeção de GMV no mês (R$)', serie: i => i.gmv, faixa: true },
      { rotulo: 'SER estimado (R$)', atual: i => i.ser.real, anterior: i => i.ser.anterior, formato: 'inteiro', melhor: 'alta' },
      { tipo: 'meta', rotulo: ctx => `Delta SER vs ${nomeMeta(ctx).toLowerCase()} (%)`, serie: i => i.ser },
      { tipo: 'projecao', rotulo: 'Projeção de SER no mês (R$)', serie: i => i.ser },
    ],
  };

  const SECAO_DECOMPOSICAO = {
    sobretitulo: 'Por que o GMV variou',
    titulo: 'Volume e ticket',
    nota: 'GMV = pedidos × ticket médio, e ticket médio = itens por pedido × preço médio por item. Pedidos e itens faturados, com os mesmos filtros do GMV.',
    tiles: [
      { rotulo: 'Pedidos faturados (qtd.)', atual: i => i.venda.atual.pedidos || null, anterior: i => i.venda.anterior.pedidos, formato: 'inteiro', melhor: 'alta' },
      { rotulo: 'Ticket médio (R$)', atual: i => i.venda.atual.ticket, anterior: i => i.venda.anterior.ticket, formato: 'inteiro', melhor: 'alta' },
      { rotulo: 'Itens por pedido (qtd.)', atual: i => i.venda.atual.itensPorPedido, anterior: i => i.venda.anterior.itensPorPedido, formato: 'decimal', melhor: 'alta' },
    ],
  };

  // Promoções: fonte própria (VTEX flagship Brasil), comparada só com ela mesma
  const MES_ANTERIOR = 'mesmo período do mês anterior';
  const SECAO_PROMO = {
    sobretitulo: 'Promoções · VTEX',
    titulo: 'Promoções',
    nota: 'Fonte própria: promoções da VTEX, só lojas flagship VTEX Brasil, com o valor captado recortado pela data da NF. Não compare com o GMV das seções acima; compare a loja com ela mesma (há lojas que fazem tabela de preço via promoção). Brindes e marcadores sem desconto ficam de fora; frete grátis e desconto de marketplace não aparecem. Comparação sempre com o mesmo período do mês anterior.',
    tiles: [
      { rotulo: 'Pedidos com promoção (%)', atual: i => i.promo.atual?.pctPedidos, anterior: i => i.promo.anterior?.pctPedidos, formato: 'pct', melhor: 'neutro', rotuloComparacao: MES_ANTERIOR,
        nota: i => (i.promo.atual ? `${fmt.inteiro.format(i.promo.atual.pedidosCom)} de ${fmt.inteiro.format(i.promo.atual.pedidos)} pedidos · ${fmt.pct0.format(i.promo.atual.pctGmv)} do GMV na VTEX` : null) },
      { rotulo: 'Desconto concedido (R$)', atual: i => i.promo.atual?.desconto, anterior: i => i.promo.anterior?.desconto, formato: 'inteiro', melhor: 'neutro', rotuloComparacao: MES_ANTERIOR,
        nota: i => (i.promo.atual?.investimento != null ? `${fmt.pct1.format(i.promo.atual.investimento)} do GMV na VTEX` : null) },
      { rotulo: 'Desconto médio (%)', atual: i => i.promo.atual?.taxaDesconto, anterior: i => i.promo.anterior?.taxaDesconto, formato: 'pct', melhor: 'neutro', rotuloComparacao: MES_ANTERIOR,
        nota: () => 'Sobre o preço cheio dos itens em promoção' },
      { rotulo: 'Ticket com promoção (R$)', atual: i => i.promo.atual?.ticketCom, anterior: i => i.promo.anterior?.ticketCom, formato: 'inteiro', melhor: 'alta', rotuloComparacao: MES_ANTERIOR,
        nota: i => (i.promo.atual?.ticketSem != null ? `Sem promoção: ${reais(i.promo.atual.ticketSem)}` : null) },
    ],
  };

  const comparacaoGrowth = ctx => `${N.COMPARACOES[ctx.comparacao].curto} (até D-2)`;

  const SECAO_GROWTH = {
    sobretitulo: 'Growth',
    titulo: 'Tráfego e conversão',
    nota: 'Sessões e transações do Google Analytics (GA4), até D-2: o GA ainda não fechou o dia anterior na hora da carga. Conversão = transações ÷ sessões sobre as somas (os dashboards de GA fazem média das taxas por linha, que distorce). Só lojas com propriedade GA carregada.',
    tiles: [
      { rotulo: 'Sessões (qtd.)', atual: i => i.growth.sessoes, anterior: i => i.growth.sessoesAnterior, formato: 'inteiro', melhor: 'alta', rotuloComparacao: comparacaoGrowth },
      { rotulo: 'Taxa de conversão (%)', atual: i => i.growth.conversao, anterior: i => i.growth.conversaoAnterior, formato: 'pct', melhor: 'alta', rotuloComparacao: comparacaoGrowth },
      { rotulo: 'Transações (qtd.)', atual: i => i.growth.transacoes, anterior: i => i.growth.transacoesAnterior, formato: 'inteiro', melhor: 'alta', rotuloComparacao: comparacaoGrowth },
    ],
  };

  const SECAO_ESTOQUE = {
    sobretitulo: 'Estoque B2C',
    titulo: 'Estoque',
    nota: 'Posição no momento da atualização, sem comparativo. Ruptura = SKU sem estoque que vendia nos últimos 90 dias. Avaria da Pernod Ricard não é exibida (mesma regra do dashboard Estoque B2C).',
    tiles: [
      { rotulo: 'Itens disponíveis (un.)', atual: i => i.estoque.disponiveis, formato: 'inteiro',
        nota: i => {
          const e = i.estoque;
          const partes = [];
          if (e.cobertura != null) partes.push(`Cobertura de ${fmt.inteiro.format(e.cobertura)} dias nos SKUs com venda`);
          if (e.paradoPct != null) partes.push(`${fmt.pct0.format(e.paradoPct)} em SKUs sem venda em 90 dias`);
          return partes.join(' · ') || null;
        } },
      { rotulo: 'Itens em avaria (un.)', atual: i => i.estoque.avaria, formato: 'inteiro',
        nota: i => (i.estoque.avariaPct != null ? `${fmt.pct.format(i.estoque.avariaPct)} do estoque total` : null) },
      { rotulo: 'SKUs em ruptura (qtd.)', atual: i => i.estoque.skusRuptura, formato: 'inteiro',
        nota: i => {
          const e = i.estoque;
          if (e.skusRuptura == null) return null;
          const pct = e.rupturaPct != null ? `${fmt.pct1.format(e.rupturaPct)} dos SKUs com venda` : '';
          return `${pct}${e.skusRupturaA ? ` · ${fmt.inteiro.format(e.skusRupturaA)} da curva A` : ''}${e.skusRisco ? ` · ${fmt.inteiro.format(e.skusRisco)} em risco de ruptura` : ''}`;
        } },
      { rotulo: 'Venda em risco por ruptura (R$/dia)', atual: i => i.estoque.vendaRiscoDia, formato: 'inteiro',
        nota: i => (i.estoque.demandaRuptura != null ? `Estimativa: ${fmt.inteiro.format(i.estoque.demandaRuptura)} un./dia × preço médio por item da loja` : null) },
    ],
  };

  const SECAO_OTD = {
    sobretitulo: 'OTD B2C',
    titulo: 'Entregas',
    nota: 'Pedidos B2C pela data de entrega (mesma regra do dashboard OTD B2C).',
    tiles: [
      { rotulo: 'Pedidos entregues (qtd.)', atual: i => i.otd.entregues, anterior: i => i.otd.entreguesAnterior, formato: 'inteiro', melhor: 'alta' },
      { rotulo: 'OTD (%)', atual: i => i.otd.atual, anterior: i => i.otd.anterior, formato: 'pct', melhor: 'alta', alvo: N.META_OTD },
    ],
  };

  // ---------------------------------------------------------------------------
  // Seções

  function novaSecao({ sobretitulo, titulo, nota }, ctx) {
    const secao = criar('section', 'secao');
    if (sobretitulo) secao.append(criar('p', 'secao__sobretitulo', sobretitulo));
    secao.append(criar('h2', 'secao__titulo', titulo));
    if (nota) secao.append(criar('p', 'secao__nota', resolver(nota, ctx)));
    return secao;
  }

  function secaoCards(def, ind, ctx, extra = {}) {
    const secao = novaSecao(def, ctx);
    const grade = criar('div', 'secao__grade');
    for (const tile of def.tiles) grade.append(renderizarTile(tile, ind, ctx, extra));
    secao.append(grade);
    return secao;
  }

  function listaDestaques(itens) {
    const lista = criar('ul', 'destaques');
    for (const { tom, texto } of itens) lista.append(criar('li', `destaque destaque--${tom}`, texto));
    return lista;
  }

  function secaoResumo(total, porLoja, alertas, ctx) {
    const secao = novaSecao({ sobretitulo: 'Destaques do período', titulo: 'Resumo' }, ctx);
    const itens = ctx.loja === TODAS
      ? N.destaquesGerais(total, porLoja, estado.base, ctx)
      : [...alertas.map(a => ({ tom: 'alerta', texto: `Atenção ao dado: ${a.texto}` })), ...N.destaquesLoja(total, ctx)];
    secao.append(listaDestaques(itens));
    return secao;
  }

  function secaoAlertas(alertas, ctx) {
    const secao = novaSecao({
      sobretitulo: 'Qualidade dos dados',
      titulo: 'Alertas de dados',
      nota: 'Quedas abruptas e lacunas que costumam ser problema de integração ou de cadastro, não do negócio. Vale checar antes de agir em cima desses números.',
    }, ctx);
    secao.append(listaDestaques(alertas.map(a => ({ tom: 'alerta', texto: a.texto }))));
    return secao;
  }

  // Mix de canais: barras horizontais de uma cor; "Sem informação" e "Outros" em cinza
  // Promoções que mais venderam: por loja, as 5 dela; na visão geral, as maiores entre todas
  function cardTopPromocoes(linhas, todas) {
    const card = criar('article', 'tile tile--inteiro');
    card.append(criar('h3', 'tile__rotulo', todas ? 'Promoções que mais venderam (todas as lojas)' : 'Promoções que mais venderam'));
    const tabela = criar('table', 'tabela tabela--compacta');
    const cabecalho = tabela.createTHead().insertRow();
    const colunas = [['Promoção', ''], ...(todas ? [['Loja', '']] : []), ['Tipo', ''], ['Pedidos (qtd.)', 'num'], ['GMV rateado (R$)', 'num'], ['Desconto (R$)', 'num'], ['GMV vs mês anterior (%)', 'num']];
    for (const [texto, classe] of colunas) {
      const th = criar('th', classe, texto);
      th.scope = 'col';
      cabecalho.append(th);
    }
    const corpo = tabela.createTBody();
    for (const p of linhas) {
      const tr = corpo.insertRow();
      const nome = criar('th', 'promocao__nome', p.promocao);
      nome.scope = 'row';
      nome.title = p.promocao;
      tr.append(nome);
      if (todas) celula(tr, p.loja, '');
      celula(tr, p.brinde ? 'Brinde' : p.tipo ?? '—', '');
      celula(tr, fmt.inteiro.format(p.pedidos_atual ?? 0));
      celula(tr, fmt.inteiro.format(p.gmv_atual ?? 0));
      celula(tr, fmt.inteiro.format(p.desconto_atual ?? 0));
      celula(tr, p.gmv_anterior ? fmt.variacao.format(p.gmv_atual / p.gmv_anterior - 1) : 'nova');
    }
    const envoltorio = criar('div', 'tabela-envoltorio tabela-envoltorio--plano');
    envoltorio.append(tabela);
    card.append(envoltorio);
    return card;
  }

  function secaoPromocoes(total, ctx) {
    const todas = ctx.loja === TODAS;
    const secao = secaoCards(SECAO_PROMO, total, ctx);
    const pa = total.promo.atual;
    const pb = total.promo.anterior;
    if (pa && !pa.pedidosCom && !(pb?.pedidosCom) && pa.pedidos >= 500) {
      secao.querySelector('.secao__nota').after(criar('p', 'secao__nota', 'Nenhuma promoção registrada na VTEX nos dois períodos, mesmo com muitos pedidos: costuma ser falta de captura na origem, não ausência de promoção.'));
    }
    const linhas = (estado.base.promocoes_top ?? [])
      .filter(p => todas || p.loja === ctx.loja)
      .sort((a, b) => (b.gmv_atual ?? 0) - (a.gmv_atual ?? 0))
      .slice(0, todas ? 8 : 5);
    if (linhas.length) secao.querySelector('.secao__grade').append(cardTopPromocoes(linhas, todas));
    return secao;
  }

  function secaoCanais(resumo, ctx) {
    const secao = novaSecao({
      sobretitulo: 'De onde vem o GMV',
      titulo: 'Canais de venda',
      nota: `Participação no GMV do período e variação vs ${N.COMPARACOES[ctx.comparacao].curto}. Site próprio = canais do tipo flagship.`,
    }, ctx);
    const caixa = criar('div', 'canais');
    const maior = Math.max(...resumo.itens.map(c => c.parcela), 0.0001);
    for (const c of resumo.itens) {
      const linhaCanal = criar('div', 'canal');
      linhaCanal.title = `${c.canal}: ${reais(c.atual)} no período, ${reais(c.anterior)} na comparação`;
      linhaCanal.append(criar('span', 'canal__nome', c.canal));
      const trilho = criar('div', 'canal__trilho');
      const barra = criar('div', `canal__barra${c.canal === 'Sem informação' || c.tipo === 'Outros' ? ' canal__barra--neutra' : ''}`);
      barra.style.width = `${(c.parcela / maior) * 100}%`;
      trilho.append(barra);
      linhaCanal.append(trilho);
      linhaCanal.append(criar('span', 'canal__valor', `${reais(c.atual)} · ${fmt.pct0.format(c.parcela)}`));
      if (c.variacao == null) {
        linhaCanal.append(criar('span', 'canal__var delta--neutro', 'novo'));
      } else {
        const classe = c.variacao > 0 ? 'delta--bom' : c.variacao < 0 ? 'delta--ruim' : 'delta--neutro';
        linhaCanal.append(criar('span', `canal__var delta ${classe}`, `${c.variacao > 0 ? '▲' : c.variacao < 0 ? '▼' : '■'} ${fmt.variacao.format(c.variacao)}`));
      }
      caixa.append(linhaCanal);
    }
    secao.append(caixa);
    return secao;
  }

  // Barra empilhada de composição (partes de um todo) com legenda em texto: a cor nunca
  // carrega o significado sozinha. 2px de respiro entre os segmentos.
  function composicao(partes) {
    const total = partes.reduce((a, p) => a + p.valor, 0);
    const caixa = criar('div', 'composicao');
    const barra = criar('div', 'composicao__barra');
    barra.setAttribute('role', 'img');
    barra.setAttribute('aria-label', partes.map(p => `${p.rotulo}: ${fmt.inteiro.format(p.valor)}`).join(', '));
    const legenda = criar('div', 'composicao__legenda');
    for (const p of partes) {
      if (!p.valor) continue;
      const segmento = criar('div', `composicao__segmento composicao__segmento--${p.classe}`);
      segmento.style.flexGrow = String(p.valor);
      segmento.title = `${p.rotulo}: ${fmt.inteiro.format(p.valor)} (${fmt.pct0.format(p.valor / total)})`;
      barra.append(segmento);
      legenda.append(status(p.classe, `${p.rotulo} ${p.mostrarPct ? fmt.pct0.format(p.valor / total) : fmt.inteiro.format(p.valor)}`));
    }
    caixa.append(barra, legenda);
    return caixa;
  }

  function cardNps(ind, ctx) {
    const card = criar('article', 'tile');
    card.append(criar('h3', 'tile__rotulo', 'NPS · últimos 90 dias (pontos)'));
    const n = ind.nps;
    if (n.atual == null) return vazio(card, 'Sem respostas de NPS para esta seleção');
    const zona = N.zonaNps(n.atual);
    card.append(criar('p', 'tile__valor', fmt.inteiro.format(n.atual)));
    card.append(linha(status(zona.classe, zona.rotulo), n.respostas < N.BASE_MINIMA_NPS ? ' · amostra pequena, interprete com cuidado' : ''));
    card.append(linhaVariacao({ formato: 'nps', melhor: 'alta', rotuloComparacao: '90 dias anteriores' }, n.atual, n.anterior, ctx));
    const promotores = n.promotores ?? 0;
    const detratores = n.detratores ?? 0;
    card.append(composicao([
      { rotulo: 'Promotores', valor: promotores, classe: 'bom', mostrarPct: true },
      { rotulo: 'Neutros', valor: Math.max(n.respostas - promotores - detratores, 0), classe: 'neutro', mostrarPct: true },
      { rotulo: 'Detratores', valor: detratores, classe: 'ruim', mostrarPct: true },
    ]));
    card.append(linha(`${fmt.inteiro.format(n.respostas)} respostas · NPS = % promotores (9 e 10) − % detratores (0 a 6)`));
    return card;
  }

  function cardSaudeLoja(item) {
    const card = criar('article', 'tile');
    card.append(criar('h3', 'tile__rotulo', 'Saúde da loja'));
    card.append(criar('p', `tile__valor saude saude--${item.saude.classe}`, item.saude.rotulo));
    const lista = criar('ul', 'componentes');
    for (const c of item.saude.componentes) {
      const li = criar('li', 'componente');
      li.append(status(c.classe, c.nome), ` ${c.texto}`);
      lista.append(li);
    }
    card.append(lista);
    if (item.ind.farolCs) {
      const cs = linha(`Farol de CS (manual): ${item.ind.farolCs}`);
      if (item.ind.farolCsDetalhe) cs.title = item.ind.farolCsDetalhe;
      card.append(cs);
    }
    return card;
  }

  function cardDistribuicao(titulo, valor, partes, nota) {
    const card = criar('article', 'tile');
    card.append(criar('h3', 'tile__rotulo', titulo));
    card.append(criar('p', 'tile__valor', valor));
    card.append(composicao(partes));
    if (nota) card.append(linha(nota));
    return card;
  }

  function cardPosicao(posicao) {
    const card = criar('article', 'tile tile--inteiro');
    card.append(criar('h3', 'tile__rotulo', `Posição entre as lojas ${posicao.modelo}`));
    const tabela = criar('table', 'tabela tabela--compacta');
    const corpo = tabela.createTBody();
    for (const l of posicao.linhas) {
      const tr = corpo.insertRow();
      const nome = criar('th', '', l.nome);
      nome.scope = 'row';
      tr.append(nome);
      celula(tr, l.valor);
      celula(tr, `${l.posicao}º de ${l.total}`);
      tr.insertCell().append(status(l.classe, l.faixa));
    }
    card.append(tabela);
    return card;
  }

  // Topo da página: saúde, NPS e farol de CS lado a lado
  function secaoDiagnostico(total, porLoja, ctx) {
    const todas = ctx.loja === TODAS;
    const secao = novaSecao({
      sobretitulo: 'Diagnóstico',
      titulo: todas ? 'Visão geral das lojas' : 'Saúde e satisfação',
      nota: 'Saúde combina vendas vs meta, OTD, ruptura, avaria e NPS (quando há base). Os limites de ruptura, avaria e NPS são pontos de partida e podem ser ajustados.',
    }, ctx);
    const grade = criar('div', 'secao__grade');

    if (todas) {
      const saudes = N.contar(porLoja, x => (x.saude.classe === 'neutro' ? null : x.saude.classe));
      const comSaude = (saudes.bom ?? 0) + (saudes.alerta ?? 0) + (saudes.ruim ?? 0);
      grade.append(cardDistribuicao('Saúde das lojas', `${fmt.inteiro.format(saudes.ruim ?? 0)} críticas`, [
        { rotulo: 'Saudável', valor: saudes.bom ?? 0, classe: 'bom' },
        { rotulo: 'Atenção', valor: saudes.alerta ?? 0, classe: 'alerta' },
        { rotulo: 'Crítica', valor: saudes.ruim ?? 0, classe: 'ruim' },
      ], `de ${fmt.inteiro.format(comSaude)} lojas com dados suficientes`));
      grade.append(cardNps(total, ctx));
      const faroes = N.contar(porLoja, x => x.ind.farolCs);
      const divergentes = porLoja.filter(x => x.ind.farolCs === 'Feliz' && x.saude.classe === 'ruim').length;
      if (Object.keys(faroes).length) {
        grade.append(cardDistribuicao('Farol de CS (manual)', `${fmt.inteiro.format(faroes.Churn ?? 0)} em churn`, [
          { rotulo: 'Feliz', valor: faroes.Feliz ?? 0, classe: 'bom' },
          { rotulo: 'Atenção', valor: faroes['Atenção'] ?? 0, classe: 'alerta' },
          { rotulo: 'Churn', valor: faroes.Churn ?? 0, classe: 'ruim' },
        ], divergentes ? `${divergentes} lojas "Feliz" estão com saúde crítica nos dados` : null));
      }
    } else {
      const item = porLoja.find(x => x.loja === ctx.loja);
      if (item && item.saude.componentes.length) grade.append(cardSaudeLoja(item));
      grade.append(cardNps(total, ctx));
      const posicao = item ? N.posicaoRelativa(ctx.loja, porLoja, item.modelo) : null;
      if (posicao) grade.append(cardPosicao(posicao));
    }
    secao.append(grade);
    return secao;
  }

  function secaoPlano(recs, ctx) {
    const todas = ctx.loja === TODAS;
    const secao = novaSecao({
      sobretitulo: 'O que fazer',
      titulo: 'Plano de ação',
      nota: todas
        ? 'As sugestões com mais valor em jogo entre todas as lojas (até 3 por área). Clique na loja para ver o plano completo dela. As regras apontam onde olhar a partir dos números; a causa precisa ser confirmada.'
        : 'Sugestões desta loja, das de maior valor em jogo para as demais. As regras apontam onde olhar a partir dos números; a causa precisa ser confirmada.',
    }, ctx);
    if (!recs.length) {
      secao.append(criar('p', 'secao__nota', 'Nenhuma regra disparou para esta seleção.'));
      return secao;
    }
    const lista = criar('div', 'plano');
    for (const r of recs) {
      const acao = criar('article', 'acao');
      const topo = criar('div', 'acao__topo');
      topo.append(criar('span', 'acao__area', r.area));
      if (todas) {
        const botao = criar('button', 'link-loja acao__loja', r.loja);
        botao.type = 'button';
        botao.addEventListener('click', () => selecionarLoja(r.loja));
        topo.append(botao);
      }
      acao.append(topo);
      acao.append(criar('h3', 'acao__titulo', r.titulo));
      acao.append(criar('p', 'acao__evidencia', r.evidencia));
      if (r.impacto != null) acao.append(criar('p', 'acao__impacto', `≈ ${reais(r.impacto)} em jogo`));
      lista.append(acao);
    }
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
      ['Diferença (R$)', 'num'], ['Projeção do mês (R$)', 'num'], ['OTD (%)', 'num'], ['Farol', ''], ['Saúde', ''], ['CS', ''],
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
      if (o.atual != null && o.entregues < N.BASE_MINIMA_OTD) {
        otd.classList.add('num--fraco');
        otd.title = `Base pequena: ${fmt.inteiro.format(o.entregues)} entregas`;
      }
      const f = N.farol(g.atingimento);
      tr.insertCell().append(status(f.classe, f.curto));
      const celulaSaude = tr.insertCell();
      celulaSaude.append(status(x.saude.classe, x.saude.classe === 'neutro' ? '—' : x.saude.rotulo));
      celulaSaude.title = x.saude.componentes.map(c => `${c.nome}: ${c.texto}`).join('\n');
      const celulaCs = celula(tr, x.ind.farolCs ?? '—', '');
      if (x.ind.farolCsDetalhe) celulaCs.title = x.ind.farolCsDetalhe;
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

  const estado = { base: null, ctx: { loja: TODAS, meta: 'forecast', comparacao: 'anterior', tabelaCompleta: false } };

  function renderizar() {
    const { base, ctx } = estado;
    const todas = ctx.loja === TODAS;
    const linhas = todas ? base.lojas : base.lojas.filter(l => l.loja === ctx.loja);
    const filtroLojas = todas ? null : new Set([ctx.loja]);
    const total = N.indicadores(N.somar(linhas), ctx);
    const porLoja = base.lojas.map(l => {
      const ind = N.indicadores(l, ctx);
      return { loja: l.loja, modelo: l.modelo, ind, saude: N.saude(ind) };
    });
    const alertas = N.anomalias(todas ? porLoja : porLoja.filter(x => x.loja === ctx.loja), base, ctx, { geral: todas });
    const faixa = N.faixaProjecao(N.serieDiaria(base.diario ?? [], filtroLojas), `gmv_${ctx.meta}`, total.gmv, base.data_ref);
    const resumoCanais = N.canais(base.canais ?? [], filtroLojas, ctx);

    el('periodo').textContent = `Mês corrente: ${N.intervalo(base.periodo.atual)} · comparado com ${N.intervalo(periodoComparacao(ctx))} (${N.COMPARACOES[ctx.comparacao].curto})`;

    const secoes = [
      secaoDiagnostico(total, porLoja, ctx),
      secaoResumo(total, porLoja, alertas, ctx),
      secaoPlano(N.recomendacoes(porLoja, base, ctx, todas ? null : ctx.loja), ctx),
    ];
    if (todas && alertas.length) secoes.push(secaoAlertas(alertas, ctx));
    secoes.push(secaoCards(SECAO_VENDAS, total, ctx, { faixa }));
    if (total.venda.atual.pedidos) secoes.push(secaoCards(SECAO_DECOMPOSICAO, total, ctx));
    // Só "Sem informação" (ex.: GMV lançado manualmente) não diz nada sobre mix
    if (resumoCanais.itens.length && resumoCanais.semCanal < 0.999) secoes.push(secaoCanais(resumoCanais, ctx));
    if (total.promo.atual) secoes.push(secaoPromocoes(total, ctx));
    if (todas) secoes.push(secaoTabela(porLoja, ctx));
    if (total.growth.sessoes != null) secoes.push(secaoCards(SECAO_GROWTH, total, ctx));
    secoes.push(secaoCards(SECAO_ESTOQUE, total, ctx));
    secoes.push(secaoCards(SECAO_OTD, total, ctx));

    el('secoes').replaceChildren(...secoes);
  }

  // Estado inicial: URL > última escolha do usuário > padrão
  function lerPreferencia(param, validos) {
    const { chave, padrao } = PREFERENCIAS[param];
    const daUrl = new URLSearchParams(location.search).get(param);
    if (daUrl && validos.includes(daUrl)) return daUrl;
    try {
      const salva = localStorage.getItem(chave);
      if (salva && validos.includes(salva)) return salva;
    } catch (_) { /* storage bloqueado: segue sem lembrar */ }
    return padrao;
  }

  function lembrar(param, valor) {
    const { chave, padrao } = PREFERENCIAS[param];
    try { localStorage.setItem(chave, valor); } catch (_) { /* idem */ }
    const url = new URL(location.href);
    if (valor === padrao) url.searchParams.delete(param);
    else url.searchParams.set(param, valor);
    history.replaceState(null, '', url);
  }

  function selecionarLoja(loja) {
    estado.ctx.loja = loja;
    el('seletor-loja').value = loja;
    lembrar('loja', loja);
    renderizar();
    document.querySelector('.filtros').scrollIntoView({ behavior: 'smooth' });
  }

  // Alternador em pílula: botões com data-<atributo>, um ativo por vez
  function montarAlternador(atributo, param, campoCtx, validos) {
    const { ctx } = estado;
    ctx[campoCtx] = lerPreferencia(param, validos);
    const botoes = [...document.querySelectorAll(`[data-${atributo}]`)];
    const marcar = () => botoes.forEach(b => b.setAttribute('aria-pressed', String(b.dataset[atributo] === ctx[campoCtx])));
    marcar();
    botoes.forEach(botao => botao.addEventListener('click', () => {
      ctx[campoCtx] = botao.dataset[atributo];
      lembrar(param, ctx[campoCtx]);
      marcar();
      renderizar();
    }));
  }

  function montarFiltros() {
    const { base, ctx } = estado;
    const lojas = [...new Set(base.lojas.map(l => l.loja))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const seletor = el('seletor-loja');
    seletor.append(new Option('Todas as lojas', TODAS));
    for (const loja of lojas) seletor.append(new Option(loja, loja));

    ctx.loja = lerPreferencia('loja', [TODAS, ...lojas]);
    seletor.value = ctx.loja;
    seletor.addEventListener('change', () => {
      ctx.loja = seletor.value;
      lembrar('loja', ctx.loja);
      renderizar();
    });

    montarAlternador('meta', 'meta', 'meta', Object.keys(N.METAS));
    // Dados antigos sem o período alinhado: só o mês anterior fica disponível
    const comparacoes = base.periodo.alinhado ? Object.keys(N.COMPARACOES) : ['anterior'];
    if (!base.periodo.alinhado) el('filtro-comparacao').hidden = true;
    montarAlternador('comp', 'comp', 'comparacao', comparacoes);
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
      N.enriquecer(base.lojas);
      estado.base = base;
      const gerado = new Date(base.gerado_em).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
      });
      el('atualizacao').textContent = `Atualizado em ${gerado}`;
      montarFiltros();
      renderizar();
    })
    .catch(erro => {
      el('atualizacao').textContent = 'Falha ao carregar';
      el('secoes').replaceChildren(criar('p', 'erro', `Não foi possível carregar os dados (${erro.message}).`));
    });
})();
