// js/pronostico/brix.js (xd-2ov.2)
// Per-lot Brix ripening curve: the date a lot reaches its target Brix, fitted
// on the lot's own berry samples of the season as they arrive, with the error
// band measured by backtest on Monte Xanic's past seasons (never a theoretical
// interval). Pure: no DOM, no network, no imports. Node-importable.
//
// Model (METODO, chosen by backtest): ordinary least squares of Brix on days
// over the lot's samples of the season so far, crossing read off the line.
// scripts/pronostico-brix-backtest.mjs also measures a last-4-samples line, a
// pooled past-seasons rate and the two shrunk together; under the rule that
// ships (only seasons before the lot's), the whole-season line erred least
// and needs no past season at all. docs/pronostico.md has the tables.

export const MODELO_VERSION = 'brix-lineal-v1';
export const MIN_MUESTRAS = 3;   // never a forecast before 3 samples
export const VENTANA = 4;        // samples in the late-phase fit
export const MAX_SIN_MUESTRA = 14; // days; a lot with no sample this long before the cutoff is inactive
export const HORIZONTE_MAX = 21; // days; past 3 weeks every method erred 2 to 3 weeks (backtest), so no date

const DIA_MS = 86_400_000;

// 'YYYY-MM-DD' (or Date) to a whole UTC day number; NaN when not a date.
export function diaDe(fecha) {
  if (fecha instanceof Date) {
    const t = fecha.getTime();
    return Number.isFinite(t)
      ? Math.floor(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()) / DIA_MS)
      : NaN;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha ?? ''));
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  // reject 2025-02-31 style dates that Date.UTC rolls over
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return NaN;
  return t / DIA_MS;
}

export function fechaDe(dia) {
  return new Date(Math.round(dia) * DIA_MS).toISOString().slice(0, 10);
}

function lectura(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'string' && v.trim() === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Lot key shared by berry samples and receptions: '25CSMX-5B' and 'CSMX-5B'
// and '26CSMX5B' all become 'CSMX5B'. The two-digit vintage prefix is dropped
// only when it is followed by a letter, so a code is never cut inside a number.
export function claveLote(codigo) {
  const s = String(codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.replace(/^\d{2}(?=[A-Z])/, '');
}

// Rows { sample_id, sample_date, vintage_year, variety, appellation, brix }
// to one series per (lot, vintage): readings on the same day averaged, sorted
// by day. Rows without a finite Brix or a valid date are dropped.
export function seriesPorLote(filas) {
  const grupos = new Map();
  for (const f of filas || []) {
    const brix = lectura(f.brix);
    const dia = diaDe(f.sample_date ?? f.sampleDate);
    const lote = claveLote(f.sample_id ?? f.sampleId);
    const vendimia = Number(f.vintage_year ?? f.vintage);
    if (!Number.isFinite(brix) || !Number.isFinite(dia) || !lote || !Number.isFinite(vendimia)) continue;
    const k = `${lote}|${vendimia}`;
    if (!grupos.has(k)) {
      grupos.set(k, { lote, vendimia, codigo: f.sample_id ?? f.sampleId,
        variedad: f.variety ?? null, denominacion: f.appellation ?? null, porDia: new Map() });
    }
    const g = grupos.get(k);
    const lst = g.porDia.get(dia) ?? [];
    lst.push(brix);
    g.porDia.set(dia, lst);
  }
  const out = [];
  for (const g of grupos.values()) {
    const puntos = [...g.porDia.entries()]
      .map(([dia, v]) => ({ dia, brix: v.reduce((a, b) => a + b, 0) / v.length }))
      .sort((a, b) => a.dia - b.dia);
    out.push({ lote: g.lote, vendimia: g.vendimia, codigo: g.codigo,
      variedad: g.variedad, denominacion: g.denominacion, puntos });
  }
  return out;
}

// OLS of brix on dia. Returns { a, b, varB, tm, ym } (brix = a + b*dia;
// varB = residual variance / Stt, Infinity when n < 3) or null.
export function ajusteLineal(puntos) {
  const n = puntos.length;
  if (n < 2) return null;
  let st = 0, sy = 0;
  for (const p of puntos) { st += p.dia; sy += p.brix; }
  const tm = st / n, ym = sy / n;
  let stt = 0, sty = 0;
  for (const p of puntos) { stt += (p.dia - tm) ** 2; sty += (p.dia - tm) * (p.brix - ym); }
  if (stt === 0) return null;
  const b = sty / stt;
  const a = ym - b * tm;
  let ssr = 0;
  for (const p of puntos) ssr += (p.brix - (a + b * p.dia)) ** 2;
  const varB = n > 2 ? ssr / (n - 2) / stt : Infinity;
  return { a, b, varB, tm, ym };
}

// Pooled ripening rate of past seasons: mean and between-lot variance of the
// positive whole-season slopes of lots with at least MIN_MUESTRAS samples.
// series: output of seriesPorLote. Returns { ritmo, varRitmo, lotes } or null.
export function ritmoHistorico(series) {
  const b = [];
  for (const s of series || []) {
    if ((s.puntos?.length ?? 0) < MIN_MUESTRAS) continue;
    const a = ajusteLineal(s.puntos);
    if (a && a.b > 0 && Number.isFinite(a.b)) b.push(a.b);
  }
  if (b.length < 2) return null;
  const m = b.reduce((x, y) => x + y, 0) / b.length;
  const v = b.reduce((x, y) => x + (y - m) ** 2, 0) / (b.length - 1);
  return { ritmo: m, varRitmo: v, lotes: b.length };
}

// The fits the backtest compares. Each returns { nivel, pendiente }:
// the fitted Brix on the day of the last sample and the rate in Bx/day, or
// null. The shipped one is METODO.
export const METODOS = {
  // whole-season line
  temporada: (p) => {
    const a = ajusteLineal(p);
    return a && { nivel: a.a + a.b * p[p.length - 1].dia, pendiente: a.b };
  },
  // line on the last VENTANA samples
  ultimas: (p) => {
    const a = ajusteLineal(p.slice(-VENTANA));
    return a && { nivel: a.a + a.b * p[p.length - 1].dia, pendiente: a.b };
  },
  // the past seasons' pooled rate from the last reading (the baseline)
  'ritmo-fijo': (p, prior) => prior && { nivel: p[p.length - 1].brix, pendiente: prior.ritmo },
  // whole-season slope shrunk toward the pooled rate by precision: a lot
  // with few or noisy samples leans on the pooled rate, a long clean series
  // on its own slope
  contraido: (p, prior) => {
    const a = ajusteLineal(p);
    if (!a) return null;
    let b = a.b;
    if (prior && prior.varRitmo > 0) {
      const wL = Number.isFinite(a.varB) && a.varB > 0 ? 1 / a.varB : 0;
      const wP = 1 / prior.varRitmo;
      b = (wL * a.b + wP * prior.ritmo) / (wL + wP);
    }
    return { nivel: a.ym + b * (p[p.length - 1].dia - a.tm), pendiente: b };
  },
};
export const METODO = 'temporada';

// Forecast for one lot from the samples it has so far (puntos sorted by dia).
// prior: ritmoHistorico of past seasons (null: the methods that need it
// fall back to the lot alone or give no date). Returns { estado, ... }:
//   'pocas-muestras'   fewer than MIN_MUESTRAS samples: no forecast
//   'sin-objetivo'     no target Brix for the lot
//   'alcanzado'        the last sample is already at or above the target
//   'sin-tendencia'    the fitted rate is not positive
//   'fuera-de-rango'   the crossing is more than HORIZONTE_MAX days after the last sample
//   'pronostico'       diaObjetivo = crossing day, never before the last sample
export function pronosticar(puntos, objetivo, { metodo = METODO, prior = null } = {}) {
  const n = puntos?.length ?? 0;
  if (n < MIN_MUESTRAS) return { estado: 'pocas-muestras', n };
  if (!Number.isFinite(objetivo)) return { estado: 'sin-objetivo', n };
  const ultimo = puntos[n - 1];
  const base = { n, diaCorte: ultimo.dia, brixUltimo: ultimo.brix };
  if (ultimo.brix >= objetivo) return { estado: 'alcanzado', ...base };
  const ajuste = METODOS[metodo](puntos, prior);
  if (!ajuste || !(ajuste.pendiente > 0) || !Number.isFinite(ajuste.nivel)) {
    return { estado: 'sin-tendencia', ...base, ajuste };
  }
  const horizonte = Math.max(0, (objetivo - ajuste.nivel) / ajuste.pendiente);
  if (horizonte > HORIZONTE_MAX) return { estado: 'fuera-de-rango', ...base, ajuste, horizonte };
  return { estado: 'pronostico', ...base, ajuste, horizonte,
    diaObjetivo: ultimo.dia + horizonte, pendiente: ajuste.pendiente };
}

// Observed day a full series first reached the target: linear interpolation
// between the two samples that bracket it, at most maxHueco days apart, and
// the first sample below the target. null when the series never brackets it.
export function diaObservado(puntos, objetivo, maxHueco = 14) {
  if (!puntos?.length || puntos[0].brix >= objetivo) return null;
  for (let i = 1; i < puntos.length; i++) {
    const p0 = puntos[i - 1], p1 = puntos[i];
    if (p0.brix < objetivo && p1.brix >= objetivo) {
      if (p1.dia - p0.dia > maxHueco) return null;
      return p0.dia + (objetivo - p0.brix) / (p1.brix - p0.brix) * (p1.dia - p0.dia);
    }
  }
  return null;
}

// Backtest of one series: truncate at each sample i (from the third), forecast,
// and compare with the observed crossing. Only cutoffs before the crossing
// count. Returns rows { diaCorte, n, adelanto, horizonte, error } where
// adelanto = observed - cutoff (days), horizonte = forecast - cutoff (days),
// error = forecast - observed (days). A cutoff whose forecast is not a date
// ('sin-tendencia', 'fuera-de-rango') is returned with error null so coverage
// can be reported.
export function backtestSerie(puntos, objetivo, opciones = {}) {
  const obs = diaObservado(puntos, objetivo);
  if (obs === null) return [];
  const filas = [];
  for (let i = MIN_MUESTRAS; i <= puntos.length; i++) {
    const corte = puntos.slice(0, i);
    const ultimo = corte[corte.length - 1];
    if (ultimo.dia >= obs || ultimo.brix >= objetivo) break;
    const r = pronosticar(corte, objetivo, opciones);
    filas.push({
      diaCorte: ultimo.dia, n: i, adelanto: obs - ultimo.dia, estado: r.estado,
      horizonte: r.estado === 'pronostico' ? r.horizonte : null,
      error: r.estado === 'pronostico' ? r.diaObjetivo - obs : null,
    });
  }
  return filas;
}

// Week bucket of a lead time or horizon in days: 0 = under 7 days, 1 = 7 to
// 13, ... capped at the last bucket.
export function semana(dias, max = 4) {
  return Math.min(max, Math.max(0, Math.floor(dias / 7)));
}

function cuantil(ordenados, q) {
  if (!ordenados.length) return NaN;
  const pos = (ordenados.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return ordenados[lo] + (ordenados[hi] - ordenados[lo]) * (pos - lo);
}

// Summary of backtest rows grouped by a week key. Returns one entry per week:
// { semana, n, mae, rmse, sesgo, p80 } in days (p80 = 80th percentile of the
// absolute error, the band the view shows).
export function resumenPorSemana(filas, clave = 'adelanto') {
  const g = new Map();
  for (const f of filas) {
    if (f.error === null || !Number.isFinite(f.error)) continue;
    const s = semana(f[clave]);
    const lst = g.get(s) ?? [];
    lst.push(f.error);
    g.set(s, lst);
  }
  return [...g.entries()].sort((a, b) => a[0] - b[0]).map(([s, e]) => {
    const abs = e.map(Math.abs).sort((a, b) => a - b);
    const n = e.length;
    return {
      semana: s, n,
      mae: abs.reduce((a, b) => a + b, 0) / n,
      rmse: Math.sqrt(e.reduce((a, b) => a + b * b, 0) / n),
      sesgo: e.reduce((a, b) => a + b, 0) / n,
      p80: cuantil(abs, 0.8),
    };
  });
}

// The band (days, +/-) for a forecast with this horizon, from the measured
// table { semana: { n, p80 } }. null when that week has fewer than minN
// backtest cases: the view then shows no date (no band, no number).
export function bandaPara(horizonte, tabla, minN = 10) {
  const fila = tabla?.[semana(horizonte)];
  if (!fila || !(fila.n >= minN) || !Number.isFinite(fila.p80)) return null;
  return fila.p80;
}

// The forecast of every lot of one vintage as of day corteDia (samples and
// receptions after corteDia are ignored), ready for the view and the
// pronosticos table. Pure.
//   series:      seriesPorLote of every vintage (past ones feed the prior)
//   recepciones: [{ lote_code|lot_code, vintage_year, reception_date }]
//   objetivoDe:  (serie) => target Brix or null
//   banda:       { [semana]: { n, p80 } } measured by the backtest
// A lot with a reception on or before corteDia is 'cosechado'; one whose last
// sample is more than MAX_SIN_MUESTRA days before corteDia is
// 'sin-muestra-reciente' (harvested under another code, or dropped). A 'pronostico'
// with no measured band for its horizon becomes 'sin-banda' (no date shown).
export function pronosticosLotes({ series, recepciones = [], objetivoDe, vendimia, corteDia, banda }) {
  const prior = ritmoHistorico((series || []).filter(s => s.vendimia < vendimia));
  const cosechados = new Set();
  for (const r of recepciones) {
    const d = diaDe(r.reception_date);
    if (Number(r.vintage_year) === vendimia && Number.isFinite(d) && d <= corteDia) {
      cosechados.add(claveLote(r.lot_code ?? r.lote_code));
    }
  }
  const out = [];
  for (const s of series || []) {
    if (s.vendimia !== vendimia) continue;
    const puntos = s.puntos.filter(p => p.dia <= corteDia);
    if (!puntos.length) continue;
    const objetivo = objetivoDe(s);
    const ult = puntos[puntos.length - 1];
    const fila = {
      lote: s.lote, codigo: s.codigo, variedad: s.variedad, denominacion: s.denominacion,
      vendimia, n: puntos.length, fechaUltima: fechaDe(ult.dia), brixUltimo: ult.brix,
      objetivo: Number.isFinite(objetivo) ? objetivo : null,
      estado: null, fechaObjetivo: null, bandaDias: null, horizonte: null, ritmo: null,
    };
    if (cosechados.has(s.lote)) { fila.estado = 'cosechado'; out.push(fila); continue; }
    if (corteDia - ult.dia > MAX_SIN_MUESTRA) { fila.estado = 'sin-muestra-reciente'; out.push(fila); continue; }
    const r = pronosticar(puntos, objetivo, { prior });
    fila.estado = r.estado;
    if (r.estado === 'pronostico') {
      const b = bandaPara(r.horizonte, banda);
      fila.ritmo = r.pendiente;
      fila.horizonte = r.horizonte;
      if (b === null) fila.estado = 'sin-banda';
      else { fila.fechaObjetivo = fechaDe(r.diaObjetivo); fila.bandaDias = Math.ceil(b); }
    }
    out.push(fila);
  }
  const orden = { pronostico: 0, 'sin-banda': 1, 'fuera-de-rango': 2, 'sin-tendencia': 3,
    alcanzado: 4, 'pocas-muestras': 5, 'sin-objetivo': 6, 'sin-muestra-reciente': 7, cosechado: 8 };
  out.sort((a, b) => (orden[a.estado] - orden[b.estado])
    || String(a.fechaObjetivo ?? '').localeCompare(String(b.fechaObjetivo ?? ''))
    || a.lote.localeCompare(b.lote));
  return { filas: out, prior };
}
