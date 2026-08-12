// js/quality-scale.js
// The qualitative vocabulary of a medicion tecnica, and the arithmetic that
// turns an evaluator panel into numbers. Pure: no DOM, no network, no imports,
// so both the browser (js/classification.js) and the serverless upload path
// (api/upload.js) can share exactly one definition.
//
// Two axes, redefined by Daniel on 2026-08-12:
//
//   Grado Sanitario   muy limpio 4, limpio 3, parcialmente limpio 2,
//                     sucio 1, contaminado 0. Native 0-4, and 0 is a real
//                     grade, not an absence of one.
//   Madurez fenolica  Sobresaliente +3, Buena +1, Parcial 0, Baja -1,
//                     No sobresaliente -3. Additive on the 36-point score.
//
// Both are graded by 1..N people and averaged. Each axis averages over its own
// graders: someone who judged sanidad and left madurez blank counts toward the
// sanidad mean only. A blank is missing data, never a zero, because zero would
// silently condemn a lot nobody assessed.

// Insertion order is scale order, best first. The form renders its dropdowns
// straight from these keys, so the order is user-visible.
export const SANITARY_POINTS = {
  'Muy limpio':          4,
  'Limpio':              3,
  'Parcialmente limpio': 2,
  'Sucio':               1,
  'Contaminado':         0,
};

// Pre-2026 vocabulary. migration_evaluaciones_multi.sql renames these in
// place; this map keeps any row the migration has not reached scoreable, and
// lets the edit form show a grade that is on record but spelled the old way.
// 'Excelente' and 'Bueno' both scored 3 of 3 before, so the split puts
// Excelente at the new top grade and Bueno one step down.
export const SANITARY_LEGACY = {
  'Excelente': 'Muy limpio',
  'Bueno':     'Limpio',
  'Regular':   'Parcialmente limpio',
  'Malo':      'Sucio',
};

export const MADUREZ_POINTS = {
  'Sobresaliente':    +3,
  'Buena':            +1,
  'Parcial':           0,
  'Baja':             -1,
  'No sobresaliente': -3,
};

// A ceiling on panel size, so one request cannot push unbounded JSON into the
// column. It is a rejection threshold, never a truncation: silently keeping
// the first 20 of 21 evaluators would drop a real grade and move the average
// (20 Muy limpio plus one Contaminado averages 3.81, but the stored 20 average
// 4.00), which is exactly the kind of quiet score change this whole change is
// meant to prevent (lucy, 2026-08-12). The form stops at the same number, so
// a panel entered by hand can never reach it.
export const MAX_EVALUADORES = 20;

export const MAX_CAMPO_LEN = 120;

export function exceedsPanelLimit(value) {
  if (!Array.isArray(value)) return false;
  if (value.length > MAX_EVALUADORES) return true;
  // Same rule one level down: a name longer than the cap is malformed input,
  // and quietly storing the first 120 characters corrupts it just as surely
  // as dropping the 21st evaluator did (lucy, 2026-08-12).
  return value.some(e => e && typeof e === 'object' &&
    ['evaluador', 'sanidad', 'madurez'].some(
      k => typeof e[k] === 'string' && e[k].trim().length > MAX_CAMPO_LEN));
}

// Own-property lookup returning a finite number, or null.
//
// These maps are indexed by strings arriving from the database, an uploaded
// workbook, or an API payload, so they are attacker-influenced. A plain
// `key in map` or `map[key]` walks the prototype chain: 'toString' and
// 'constructor' would both resolve, yielding a function that survives into the
// mean as NaN and silently collapses the lot's score.
function lookupPoints(map, label) {
  if (label === null || label === undefined) return null;
  const key = String(label).trim();
  if (!key || !Object.hasOwn(map, key)) return null;
  const pts = map[key];
  return typeof pts === 'number' && Number.isFinite(pts) ? pts : null;
}

export function canonicalSanitaryLabel(label) {
  if (label === null || label === undefined) return null;
  const key = String(label).trim();
  if (!key) return null;
  if (Object.hasOwn(SANITARY_POINTS, key)) return key;
  if (Object.hasOwn(SANITARY_LEGACY, key)) return SANITARY_LEGACY[key];
  return null;
}

export function sanitaryPoints(label) {
  return lookupPoints(SANITARY_POINTS, canonicalSanitaryLabel(label));
}

export function madurezPoints(label) {
  return lookupPoints(MADUREZ_POINTS, label);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Collapses an evaluator panel into one mean per axis.
//
// `medicion.evaluaciones` is the source of truth. The legacy scalars
// health_grade and phenolic_maturity are the single-evaluator fallback, and
// each one fills only an axis the panel left empty, so a row carrying both
// shapes is never double-counted.
export function averageEvaluations(medicion) {
  const empty = {
    sanidad: null, madurez: null,
    sanidadCount: 0, madurezCount: 0, evaluadorCount: 0,
  };
  if (!medicion) return empty;

  const panel = Array.isArray(medicion.evaluaciones) ? medicion.evaluaciones : [];
  const sanidad = [];
  const madurez = [];
  let evaluadorCount = 0;

  for (const e of panel) {
    if (!e || typeof e !== 'object') continue;
    const s = sanitaryPoints(e.sanidad);
    const m = madurezPoints(e.madurez);
    if (s !== null) sanidad.push(s);
    if (m !== null) madurez.push(m);
    // A person counts once if they graded anything at all. Taking the larger
    // of the two axis counts would under-report a panel where different people
    // covered different axes.
    if (s !== null || m !== null) evaluadorCount++;
  }

  if (!sanidad.length) {
    const s = sanitaryPoints(medicion.health_grade);
    if (s !== null) { sanidad.push(s); if (!evaluadorCount) evaluadorCount = 1; }
  }
  if (!madurez.length) {
    const m = madurezPoints(medicion.phenolic_maturity);
    if (m !== null) { madurez.push(m); if (!evaluadorCount) evaluadorCount = 1; }
  }

  return {
    sanidad: mean(sanidad),
    madurez: mean(madurez),
    sanidadCount: sanidad.length,
    madurezCount: madurez.length,
    evaluadorCount,
  };
}

// Nearest label to a numeric average. A panel mean is usually fractional
// (three evaluators at 4, 4, 2 average 3.33) while health_grade and
// phenolic_maturity are label columns, so the consensus label is what the
// table, the map tooltips, and the exports display. Ties round toward the
// lower grade, the conservative read for a quality call.
function nearestLabel(map, avg) {
  if (avg === null || avg === undefined || !Number.isFinite(avg)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const [label, pts] of Object.entries(map)) {
    const dist = Math.abs(pts - avg);
    if (dist < bestDist || (dist === bestDist && best !== null && pts < map[best])) {
      best = label;
      bestDist = dist;
    }
  }
  return best;
}

export function consensusSanitaryLabel(avg) {
  return nearestLabel(SANITARY_POINTS, avg);
}

export function consensusMadurezLabel(avg) {
  return nearestLabel(MADUREZ_POINTS, avg);
}

// Reduces whatever arrives to the shape the scoring engine expects: an array
// of {evaluador, sanidad, madurez}, each a string or null.
//
// Labels are NOT checked against the vocabulary. The engine already ignores
// what it does not recognise, and rejecting here would turn one typo in a
// workbook into a failure of the entire upload rather than one axis of one row.
export function sanitizeEvaluaciones(value) {
  if (!Array.isArray(value)) return null;
  const text = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v !== 'string') return null;
    const s = v.trim();
    return s === '' ? null : s;
  };
  return value
    .filter(e => e && typeof e === 'object' && !Array.isArray(e))
    .map(e => ({
      evaluador: text(e.evaluador),
      sanidad:   text(e.sanidad),
      madurez:   text(e.madurez),
    }))
    .filter(e => e.sanidad !== null || e.madurez !== null || e.evaluador !== null);
}

// The two derived scalar labels for a panel. Every write path calls this
// rather than trusting a caller-supplied label, so the panel and the scalars
// can never disagree about the same row.
export function panelConsensus(evaluaciones) {
  const avg = averageEvaluations({ evaluaciones });
  return {
    health_grade:      consensusSanitaryLabel(avg.sanidad),
    phenolic_maturity: consensusMadurezLabel(avg.madurez),
    sanidadAvg:        avg.sanidad,
    madurezAvg:        avg.madurez,
    evaluadorCount:    avg.evaluadorCount,
  };
}
