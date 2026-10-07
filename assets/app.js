(function () {
  'use strict';

  const TODAS = '__todas__';
  const CHAVE_LOJA = 'informativo-kpis:loja';
  const CHAVE_META = 'informativo-kpis:meta';
  const METAS = { forecast: 'Forecast', budget: 'Budget' };

  const fmtInteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const fmtInteiroSinal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0, signDisplay: 'exceptZero' });
  const fmtPct = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPctSinal = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
  const fmtVariacao = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const fmtPp = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });

  const razao = (num, den) => (num == null || !den ? null : num / den);

  // Os tiles leem campos aditivos de kpis.json. Razões são calculadas depois da
  // soma das lojas, senão o "Todas as lojas" vira média de percentual.
  // tipo 'valor': número com variação opcional vs mês anterior (melhor: 'alta' | 'baixa')
  // tipo 'meta':  delta do realizado contra a meta escolhida, com farol
  const SECOES = [
    {
      titulo: 'Vendas',
      nota: ctx => `Faturado por data de NF, tipo de venda "Venda" (mesmas regras da One page do Desempenho de vendas). Meta: ${METAS[ctx.meta]}.`,
      tiles: [
        { rotulo: 'GMV realizado (R$)', atual: s => s.gmv_atual, anterior: s => s.gmv_anterior, formato: 'inteiro', melhor: 'alta' },
        { rotulo: ctx => `${METAS[ctx.meta]} GMV (R$)`, atual: (s, ctx) => s[`gmv_${ctx.meta}`], formato: 'inteiro' },
        { tipo: 'meta', rotulo: ctx => `Delta GMV vs ${METAS[ctx.meta].toLowerCase()} (%)`, realizado: s => s.gmv_atual, meta: (s, ctx) => s[`gmv_${ctx.meta}`] },
        { rotulo: 'SER estimado (R$)', atual: s => s.ser_atual, anterior: s => s.ser_anterior, formato: 'inteiro', melhor: 'alta' },
        { rotulo: ctx => `${METAS[ctx.meta]} SER (R$)`, atual: (s, ctx) => s[`ser_${ctx.meta}`], formato: 'inteiro' },
        { tipo: 'meta', rotulo: ctx => `Delta SER vs ${METAS[ctx.meta].toLowerCase()} (%)`, realizado: s => s.ser_atual, meta: (s, ctx) => s[`ser_${ctx.meta}`] },
      ],
    },
    {
      titulo: 'Estoque',
      nota: 'Posição no momento da atualização, sem comparativo. Avaria da Pernod Ricard não é exibida (mesma regra do dashboard Estoque B2C).',
      tiles: [
        { rotulo: 'Itens disponíveis (un.)', atual: s => s.itens_disponiveis, formato: 'inteiro' },
        { rotulo: 'Itens em avaria (un.)', atual: s => s.itens_avaria, formato: 'inteiro' },
      ],
    },
    {
      titulo: 'OTD B2C',
      nota: 'Pedidos B2C pela data de entrega (mesma regra do dashboard OTD B2C).',
      tiles: [
        { rotulo: 'Pedidos entregues (qtd.)', atual: s => s.otd_entregues_atual, anterior: s => s.otd_entregues_anterior, formato: 'inteiro', melhor: 'alta' },
        {
          rotulo: 'OTD (%)',
          atual: s => razao(s.otd_no_prazo_atual, s.otd_entregues_atual),
          anterior: s => razao(s.otd_no_prazo_anterior, s.otd_entregues_anterior),
          formato: 'pct',
          melhor: 'alta',
          alvo: 0.95,
        },
      ],
    },
  ];

  const el = id => document.getElementById(id);
  const resolver = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

  function criar(tag, classe, texto) {
    const node = document.createElement(tag);
    if (classe) node.className = classe;
    if (texto != null) node.textContent = texto;
    return node;
  }

  function dataCurta(iso) {
    const [ano, mes, dia] = iso.split('-');
    return `${dia}/${mes}/${ano}`;
  }

  function intervalo(p) {
    return `${dataCurta(p.inicio)} a ${dataCurta(p.fim)}`;
  }

  function formatar(valor, formato) {
    return formato === 'pct' ? fmtPct.format(valor) : fmtInteiro.format(valor);
  }

  function somar(linhas) {
    const total = {};
    for (const linha of linhas) {
      for (const [campo, valor] of Object.entries(linha)) {
        if (typeof valor !== 'number') continue;
        total[campo] = (total[campo] ?? 0) + valor;
      }
    }
    return total;
  }

  function ler(fn, dados, ctx) {
    const v = fn ? fn(dados, ctx) : null;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function status(classe, texto) {
    return criar('span', `status status--${classe}`, texto);
  }

  // Farol do dashboard: > 103% verde, > 97% âmbar, abaixo disso (ou realizado zerado) vermelho
  function farol(realizado, meta) {
    const atingimento = realizado / meta;
    if (atingimento > 1.03) return ['bom', 'Acima da meta (> 103%)'];
    if (atingimento > 0.97) return ['alerta', 'Na faixa da meta (97% a 103%)'];
    return ['ruim', 'Abaixo da meta (< 97%)'];
  }

  function linhaVariacao(tile, atual, anterior, periodoAnterior) {
    const linha = criar('p', 'tile__linha');
    if (anterior == null || (tile.formato !== 'pct' && anterior === 0)) {
      linha.textContent = 'Sem base no mesmo período do mês anterior';
      return linha;
    }

    const diferenca = atual - anterior;
    const texto = tile.formato === 'pct'
      ? `${fmtPp.format(diferenca * 100)} p.p.`
      : fmtVariacao.format(atual / anterior - 1);
    const subiu = diferenca > 0;
    const classe = diferenca === 0 ? 'delta--neutro'
      : (subiu === (tile.melhor === 'alta') ? 'delta--bom' : 'delta--ruim');
    const seta = diferenca === 0 ? '■' : (subiu ? '▲' : '▼');

    linha.append(criar('span', `delta ${classe}`, `${seta} ${texto}`));
    linha.append(` vs ${intervalo(periodoAnterior)}`);
    return linha;
  }

  function linhaAlvo(tile, atual) {
    const dentro = atual >= tile.alvo;
    const linha = criar('p', 'tile__linha');
    linha.append(status(dentro ? 'bom' : 'ruim', dentro ? 'Dentro da meta' : 'Abaixo da meta'));
    linha.append(` · meta ${formatar(tile.alvo, tile.formato)} (${fmtPp.format((atual - tile.alvo) * 100)} p.p.)`);
    return linha;
  }

  function vazio(card, texto) {
    card.append(criar('p', 'tile__valor tile__valor--vazio', '—'));
    card.append(criar('p', 'tile__linha', texto));
    return card;
  }

  function renderizarTileMeta(card, tile, dados, ctx) {
    const meta = ler(tile.meta, dados, ctx);
    if (!meta) {
      card.append(criar('p', 'tile__valor tile__valor--vazio', '—'));
      const linha = criar('p', 'tile__linha');
      linha.append(status('neutro', 'Sem meta'));
      card.append(linha);
      return card;
    }

    const realizado = ler(tile.realizado, dados, ctx) ?? 0;
    const [classe, texto] = farol(realizado, meta);
    card.append(criar('p', 'tile__valor', fmtPctSinal.format((realizado - meta) / meta)));
    card.append(criar('p', 'tile__linha', `Diferença: ${fmtInteiroSinal.format(realizado - meta)} (R$)`));
    const linha = criar('p', 'tile__linha');
    linha.append(status(classe, texto));
    card.append(linha);
    return card;
  }

  function renderizarTile(tile, dados, base, ctx) {
    const card = criar('article', 'tile');
    card.append(criar('h3', 'tile__rotulo', resolver(tile.rotulo, ctx)));
    if (tile.tipo === 'meta') return renderizarTileMeta(card, tile, dados, ctx);

    const atual = ler(tile.atual, dados, ctx);
    if (atual == null) return vazio(card, 'Sem dado para esta seleção');

    card.append(criar('p', 'tile__valor', formatar(atual, tile.formato)));
    if (tile.anterior) {
      card.append(linhaVariacao(tile, atual, ler(tile.anterior, dados, ctx), base.periodo.anterior));
    }
    if (tile.alvo != null) card.append(linhaAlvo(tile, atual));
    return card;
  }

  function renderizar(base, ctx) {
    const linhas = ctx.loja === TODAS ? base.lojas : base.lojas.filter(l => l.loja === ctx.loja);
    const dados = somar(linhas);
    const destino = el('secoes');
    destino.replaceChildren();

    for (const secao of SECOES) {
      const bloco = criar('section', 'secao');
      bloco.append(criar('h2', 'secao__testeira', secao.titulo));
      if (secao.nota) bloco.append(criar('p', 'secao__nota', resolver(secao.nota, ctx)));
      const grade = criar('div', 'secao__grade');
      for (const tile of secao.tiles) grade.append(renderizarTile(tile, dados, base, ctx));
      bloco.append(grade);
      destino.append(bloco);
    }
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

  function montarFiltros(base, ctx, aoMudar) {
    const lojas = [...new Set(base.lojas.map(l => l.loja))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const seletor = el('seletor-loja');
    seletor.append(new Option('Todas as lojas', TODAS));
    for (const loja of lojas) seletor.append(new Option(loja, loja));

    ctx.loja = lerPreferencia('loja', CHAVE_LOJA, [TODAS, ...lojas], TODAS);
    seletor.value = ctx.loja;
    seletor.addEventListener('change', () => {
      ctx.loja = seletor.value;
      lembrar('loja', CHAVE_LOJA, ctx.loja, TODAS);
      aoMudar();
    });

    ctx.meta = lerPreferencia('meta', CHAVE_META, Object.keys(METAS), 'forecast');
    const botoes = [...document.querySelectorAll('[data-meta]')];
    const marcar = () => botoes.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.meta === ctx.meta)));
    marcar();
    botoes.forEach(botao => botao.addEventListener('click', () => {
      ctx.meta = botao.dataset.meta;
      lembrar('meta', CHAVE_META, ctx.meta, 'forecast');
      marcar();
      aoMudar();
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
      const gerado = new Date(base.gerado_em).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
      });
      el('atualizacao').textContent = `Atualizado em ${gerado}`;
      el('periodo').textContent = `Mês corrente: ${intervalo(base.periodo.atual)} · comparado com ${intervalo(base.periodo.anterior)}`;

      const ctx = {};
      montarFiltros(base, ctx, () => renderizar(base, ctx));
      renderizar(base, ctx);
    })
    .catch(erro => {
      el('atualizacao').textContent = 'Falha ao carregar';
      el('secoes').replaceChildren(criar('p', 'erro', `Não foi possível carregar os dados (${erro.message}).`));
    });
})();
