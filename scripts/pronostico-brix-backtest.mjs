// scripts/pronostico-brix-backtest.mjs (xd-2ov.2)
// Backtest of the per-lot Brix date forecast (js/pronostico/brix.js) on past
// seasons. Read-only: it reads two tab-separated pulls made with psql under
// default_transaction_read_only=on (queries in docs/pronostico.md):
//   node scripts/pronostico-brix-backtest.mjs brix.tsv recep.tsv [--loso] [--json js/pronostico/brixBanda.js]
// brix.tsv:  sample_id, sample_date, vintage_year, variety, appellation, brix
// recep.tsv: vintage_year, lot_code, variety, appellation, reception_date, brix, tons_received
// Prints: per method, error in days by lead time (weeks before the observed
// crossing) and by forecast horizon; the Brix-at-harvest check against the
// first reception; coverage counts. --json writes the band module the view uses.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveRubric } from '../js/classification.js';
import { resolveTarget } from '../js/prediction.js';
import {
  seriesPorLote, backtestSerie, resumenPorSemana, pronosticar,   METODOS, METODO, MIN_MUESTRAS, ritmoHistorico, claveLote, diaDe, MODELO_VERSION,
} from '../js/pronostico/brix.js';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
// Prior seasons for the pooled rate: 'pasadas' (default, what ships: only
// vintages before the lot's) or 'loso' (--loso: every other vintage).
const PRIOR = args.includes('--loso') ? 'loso' : 'pasadas';
const [brixPath, recepPath] = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));

function tsv(path) {
  const [cab, ...lineas] = readFileSync(path, 'utf8').trim().split('\n');
  const cols = cab.split('\t');
  return lineas.filter(l => l && !/^\(\d+ rows?\)$/.test(l)).map(l => {
    const v = l.split('\t'); const o = {};
    cols.forEach((c, i) => { o[c] = v[i] === '' ? null : v[i]; });
    return o;
  });
}

const series = seriesPorLote(tsv(brixPath));
const objetivoDe = (s) => resolveTarget({ rubric: resolveRubric(s.variedad, s.denominacion), override: null }).brixTarget;

// Coverage: samples per lot per vintage.
console.log('== Muestras por lote y vendimia');
for (const v of [...new Set(series.map(s => s.vendimia))].sort()) {
  const ss = series.filter(s => s.vendimia === v);
  const ge3 = ss.filter(s => s.puntos.length >= MIN_MUESTRAS).length;
  const med = ss.map(s => s.puntos.length).sort((a, b) => a - b)[Math.floor(ss.length / 2)];
  const conObj = ss.filter(s => s.puntos.length >= MIN_MUESTRAS && Number.isFinite(objetivoDe(s))).length;
  console.log(`${v}: ${ss.length} lotes, ${ge3} con >=3 muestras, mediana ${med}, ${conObj} con >=3 y objetivo de catalogo`);
}

const fmt = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '-';
function tabla(titulo, filas, clave) {
  console.log(`\n${titulo}`);
  console.log('semana | n | MAE d | RMSE d | sesgo d | P80 |err| d');
  for (const r of resumenPorSemana(filas, clave)) {
    const et = r.semana === 4 ? '4+' : `${r.semana}`;
    console.log(`${et} | ${r.n} | ${fmt(r.mae)} | ${fmt(r.rmse)} | ${fmt(r.sesgo)} | ${fmt(r.p80)}`);
  }
}

const resultado = {};
for (const metodo of Object.keys(METODOS)) {
  const filas = [];
  let lotesObs = 0;
  for (const s of series) {
    const obj = objetivoDe(s);
    if (!Number.isFinite(obj)) continue;
    const prior = ritmoHistorico(series.filter(o => (PRIOR === "loso" ? o.vendimia !== s.vendimia : o.vendimia < s.vendimia)));
    const f = backtestSerie(s.puntos, obj, { metodo, prior });
    if (f.length) lotesObs++;
    for (const x of f) filas.push({ ...x, vendimia: s.vendimia, lote: s.lote });
  }
  const conFecha = filas.filter(f => f.error !== null);
  const mae = conFecha.reduce((a, f) => a + Math.abs(f.error), 0) / conFecha.length;
  console.log(`\n==== Metodo ${metodo}: ${lotesObs} lotes que cruzan su objetivo, ${filas.length} cortes, ${conFecha.length} con fecha (${filas.length - conFecha.length} sin tendencia o fuera de rango), MAE total ${fmt(mae)} d`);
  tabla('Error vs adelanto real (semanas antes del cruce observado)', filas, 'adelanto');
  tabla('Error vs horizonte pronosticado (la banda del tablero)', filas, 'horizonte');
  for (const v of [...new Set(filas.map(f => f.vendimia))].sort()) {
    tabla(`  solo ${v}, por adelanto`, filas.filter(f => f.vendimia === v), 'adelanto');
  }
  resultado[metodo] = { filas, porHorizonte: resumenPorSemana(filas, 'horizonte'), porAdelanto: resumenPorSemana(filas, 'adelanto') };
}

// Harvest check: Brix forecast on the first reception day vs the reception
// Brix (tonnage-weighted over that day's receptions of the lot).
const recep = new Map();
for (const r of tsv(recepPath)) {
  const k = `${claveLote(r.lot_code)}|${Number(r.vintage_year)}`;
  const dia = diaDe(r.reception_date); const b = Number(r.brix); const t = Number(r.tons_received);
  if (!Number.isFinite(dia) || !Number.isFinite(b)) continue;
  const prev = recep.get(k);
  if (!prev || dia < prev.dia) recep.set(k, { dia, sb: b * (t > 0 ? t : 1), st: t > 0 ? t : 1 });
  else if (dia === prev.dia) { prev.sb += b * (t > 0 ? t : 1); prev.st += t > 0 ? t : 1; }
}
const cosecha = [];
let unidos = 0;
for (const s of series) {
  const r = recep.get(`${s.lote}|${s.vendimia}`);
  if (!r) continue;
  unidos++;
  const brixCosecha = r.sb / r.st;
  for (let i = MIN_MUESTRAS; i <= s.puntos.length; i++) {
    const corte = s.puntos.slice(0, i);
    const ult = corte[corte.length - 1];
    if (ult.dia >= r.dia) break;
    const aj = METODOS[METODO](corte, ritmoHistorico(series.filter(o => (PRIOR === "loso" ? o.vendimia !== s.vendimia : o.vendimia < s.vendimia))));
    if (!aj) continue;
    cosecha.push({ adelanto: r.dia - ult.dia, horizonte: r.dia - ult.dia, error: (aj.nivel + aj.pendiente * (r.dia - ult.dia)) - brixCosecha,
      ingenuo: ult.brix - brixCosecha });
  }
}
console.log(`\n==== Brix a la fecha de cosecha (primera recepcion), metodo ${METODO}: ${unidos} lotes unidos a recepcion, ${cosecha.length} cortes`);
console.log('semana | n | MAE Bx modelo | MAE Bx ultimo valor (ingenuo) | sesgo Bx');
for (const r of resumenPorSemana(cosecha, 'adelanto')) {
  const ing = cosecha.filter(c => Math.min(4, Math.floor(c.adelanto / 7)) === r.semana).map(c => Math.abs(c.ingenuo));
  console.log(`${r.semana === 4 ? '4+' : r.semana} | ${r.n} | ${fmt(r.mae, 2)} | ${fmt(ing.reduce((a, b) => a + b, 0) / ing.length, 2)} | ${fmt(r.sesgo, 2)}`);
}

if (jsonOut) {
  const banda = {};
  for (const r of resultado[METODO].porHorizonte) banda[r.semana] = { n: r.n, p80: Math.round(r.p80 * 10) / 10, mae: Math.round(r.mae * 10) / 10, sesgo: Math.round(r.sesgo * 10) / 10 };
  const datos = { modelo: MODELO_VERSION, metodo: METODO,
    vendimias: [...new Set(resultado[METODO].filas.map(f => f.vendimia))].sort(), banda };
  writeFileSync(jsonOut, '// Generated by scripts/pronostico-brix-backtest.mjs --json (xd-2ov.2). Do not edit by hand.\n'
    + '// banda[semana of the forecast horizon] = { n backtest cases, p80 = 80th percentile of |error| in days, mae, sesgo }.\n'
    + `export const BANDA_BRIX = ${JSON.stringify(datos, null, 2)};\n`);
  console.log(`\nbanda escrita en ${jsonOut}`);
}
