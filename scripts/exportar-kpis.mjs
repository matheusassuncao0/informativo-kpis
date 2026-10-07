// Roda as consultas de sql/ no BigQuery e gera data/kpis.json para o site.
//
// Variáveis de ambiente:
//   BQ_PROJECT   projeto onde as views vivem (obrigatório)
//   BQ_LOCATION  localização do dataset (padrão: US)
//   DATA_REF     YYYY-MM-DD para reprocessar uma data; padrão: D-1 em São Paulo
import { BigQuery } from '@google-cloud/bigquery';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// destino 'lojas': uma linha por loja, campos juntados num objeto por loja.
// Outro destino: lista de linhas (com coluna `loja`) gravada com esse nome no JSON.
const CONSULTAS = [
  { nome: 'vendas', destino: 'lojas' },
  { nome: 'estoque', destino: 'lojas' },
  { nome: 'otd', destino: 'lojas' },
  { nome: 'nps', destino: 'lojas' },
  { nome: 'farol_cs', destino: 'lojas' },
  { nome: 'growth', destino: 'lojas' },
  { nome: 'vendas_canal', destino: 'canais' },
  { nome: 'vendas_diario', destino: 'diario' },
  { nome: 'frescor', destino: 'frescor' },
];

const projectId = process.env.BQ_PROJECT;
const location = process.env.BQ_LOCATION || 'US';
if (!projectId) {
  console.error('Defina BQ_PROJECT com o projeto das views no BigQuery.');
  process.exit(1);
}

function hojeEmSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function somarDias(iso, dias) {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

// Mesmo comportamento de DATE_SUB(data, INTERVAL 1 MONTH) no BigQuery: 31/03 -> 28/02.
function menosUmMes(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  const alvo = new Date(Date.UTC(ano, mes - 2, 1));
  const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(dia, ultimoDia));
  return alvo.toISOString().slice(0, 10);
}

function fimDoMes(iso) {
  const [ano, mes] = iso.split('-').map(Number);
  return new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
}

const inicioDoMes = iso => `${iso.slice(0, 7)}-01`;

// BigQuery devolve DATE/TIMESTAMP como objeto com `value` e NUMERIC como Big
function paraJson(valor) {
  if (valor == null) return null;
  if (typeof valor === 'number' || typeof valor === 'string' || typeof valor === 'boolean') return valor;
  if (typeof valor === 'object' && 'value' in valor) return valor.value;
  const n = Number(String(valor));
  return Number.isFinite(n) ? n : null;
}

// As fontes escrevem a mesma loja de jeitos diferentes ("M.Officer" x "Mofficer",
// "Samsung Pra Você" x "Samsung pra você"): junta por caixa, acento e pontuação.
const chaveLoja = loja => loja.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9()]/g, '');

const dataRef = process.env.DATA_REF || somarDias(hojeEmSaoPaulo(), -1);
const periodo = {
  atual: { inicio: inicioDoMes(dataRef), fim: dataRef },
  anterior: { inicio: inicioDoMes(menosUmMes(dataRef)), fim: menosUmMes(dataRef) },
  alinhado: { inicio: somarDias(inicioDoMes(dataRef), -28), fim: somarDias(dataRef, -28) },
  mes: { inicio: inicioDoMes(dataRef), fim: fimDoMes(dataRef) },
};

const bigquery = new BigQuery({ projectId });
const porLoja = new Map();
const listas = {};

function juntarLoja(linha) {
  const { loja, ...campos } = linha;
  const chave = chaveLoja(loja);
  const destino = porLoja.get(chave) ?? { loja }; // vale o nome da primeira fonte (vendas)
  if (destino.loja !== loja) console.log(`  "${loja}" juntado com "${destino.loja}"`);
  // Números somam (a mesma loja pode vir em mais de uma linha); texto fica com o primeiro
  for (const [campo, bruto] of Object.entries(campos)) {
    const valor = paraJson(bruto);
    if (typeof valor === 'number' && typeof destino[campo] === 'number') destino[campo] += valor;
    else if (valor != null || !(campo in destino)) destino[campo] ??= valor;
  }
  porLoja.set(chave, destino);
}

for (const { nome, destino } of CONSULTAS) {
  const sql = await readFile(new URL(`../sql/${nome}.sql`, import.meta.url), 'utf8');
  const [linhas] = await bigquery.query({
    query: sql,
    location,
    ...(sql.includes('@data_ref') && { params: { data_ref: BigQuery.date(dataRef) } }),
  });
  console.log(`${nome}: ${linhas.length} linhas`);

  if (destino === 'lojas') {
    linhas.forEach(juntarLoja);
  } else {
    // Mesmo nome de loja usado em `lojas`, para o filtro do site casar
    listas[destino] = linhas.map(linha => {
      const convertida = Object.fromEntries(Object.entries(linha).map(([k, v]) => [k, paraJson(v)]));
      if (typeof convertida.loja === 'string') {
        convertida.loja = porLoja.get(chaveLoja(convertida.loja))?.loja ?? convertida.loja;
      }
      return convertida;
    });
  }
}

const saida = {
  gerado_em: new Date().toISOString(),
  data_ref: dataRef,
  periodo,
  lojas: [...porLoja.values()],
  ...listas,
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/kpis.json', import.meta.url), JSON.stringify(saida));
console.log(`data/kpis.json gerado: ${saida.lojas.length} lojas, data de referência ${dataRef}`);
