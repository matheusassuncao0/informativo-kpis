// Roda as consultas de sql/ no BigQuery e gera data/kpis.json para o site.
// Cada consulta devolve uma linha por loja (coluna `loja`) com campos numéricos aditivos.
//
// Variáveis de ambiente:
//   BQ_PROJECT   projeto onde as views vivem (obrigatório)
//   BQ_LOCATION  localização do dataset (padrão: US)
//   DATA_REF     YYYY-MM-DD para reprocessar uma data; padrão: D-1 em São Paulo
import { BigQuery } from '@google-cloud/bigquery';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const CONSULTAS = ['vendas', 'estoque', 'otd'];

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

const inicioDoMes = iso => `${iso.slice(0, 7)}-01`;

const numero = valor => {
  if (valor == null) return null;
  const n = Number(String(valor));
  return Number.isFinite(n) ? n : null;
};

const dataRef = process.env.DATA_REF || somarDias(hojeEmSaoPaulo(), -1);
const periodo = {
  atual: { inicio: inicioDoMes(dataRef), fim: dataRef },
  anterior: { inicio: inicioDoMes(menosUmMes(dataRef)), fim: menosUmMes(dataRef) },
};

const bigquery = new BigQuery({ projectId });
const porLoja = new Map();

for (const nome of CONSULTAS) {
  const sql = await readFile(new URL(`../sql/${nome}.sql`, import.meta.url), 'utf8');
  const [linhas] = await bigquery.query({
    query: sql,
    location,
    ...(sql.includes('@data_ref') && { params: { data_ref: BigQuery.date(dataRef) } }),
  });
  console.log(`${nome}: ${linhas.length} lojas`);

  for (const { loja, ...campos } of linhas) {
    const destino = porLoja.get(loja) ?? { loja };
    for (const [campo, valor] of Object.entries(campos)) destino[campo] = numero(valor);
    porLoja.set(loja, destino);
  }
}

const saida = {
  gerado_em: new Date().toISOString(),
  data_ref: dataRef,
  periodo,
  lojas: [...porLoja.values()],
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/kpis.json', import.meta.url), JSON.stringify(saida));
console.log(`data/kpis.json gerado: ${saida.lojas.length} lojas, data de referência ${dataRef}`);
