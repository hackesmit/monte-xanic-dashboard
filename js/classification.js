// js/classification.js
// Pure scoring engine. No DOM, no network, no module-level side effects.
// See docs/superpowers/specs/2026-04-21-quality-classification-design.md

import { CONFIG } from './config.js';

// ── Valley resolution ────────────────────────────────────────────────

export function resolveValley(appellation) {
  if (!appellation) return null;
  const s = String(appellation);
  for (const { re, valley } of CONFIG.valleyPatterns) {
    if (re.test(s)) return valley;
  }
  return null;
}

// ── Rubric resolution ────────────────────────────────────────────────

export function resolveRubric(variety, appellationOrValley) {
  if (!variety) return null;
  const valley = CONFIG.varietyRubricMap[appellationOrValley]
    ? appellationOrValley
    : resolveValley(appellationOrValley);
  if (!valley) return null;
  const map = CONFIG.varietyRubricMap[valley];
  if (!map) return null;
  const rubricId = map[variety];
  if (!rubricId) return null;
  const rubric = CONFIG.rubrics[rubricId];
  if (!rubric) return null;
  return { id: rubricId, ...rubric };
}

// ── Threshold bucketing ──────────────────────────────────────────────

// Rubric parameters define two thresholds each, so they yield three buckets.
// The engine's internal scale is 0-4 (see CONFIG.scoreScaleMax), so those
// three buckets are stretched onto it by 4/3: 1 -> 1.333, 2 -> 2.667, 3 -> 4.
// The normalizer widens by the same factor, so this rescale is an identity on
// the final 36-point score. It exists so every axis speaks one scale, letting
// the native 0-4 sanitary grade sit alongside chemistry without a special case.
const BUCKET_RESCALE = CONFIG.scoreScaleMax / CONFIG.scoreScaleLegacyMax;

function rescaleBucket(bucket) {
  return bucket === null ? null : bucket * BUCKET_RESCALE;
}

// Returns the raw 1-3 bucket. Callers rescale via rescaleBucket; kept separate
// so the thresholds stay readable against the rubric tables in config.js.
export function scoreParam(spec, value) {
  if (value === null || value === undefined) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;

  switch (spec.kind) {
    case 'le-a-le-b':
      if (v <= spec.a) return 3;
      if (v <= spec.b) return 2;
      return 1;
    case 'ge-a-ge-b':
      if (v >= spec.a) return 3;
      if (v >= spec.b) return 2;
      return 1;
    case 'range': {
      const [lo, hi] = spec.a;
      if (v >= lo && v <= hi) return 3;
      for (const [blo, bhi] of spec.b) {
        if (v >= blo && v <= bhi) return 2;
      }
      return 1;
    }
    default:
      return null;
  }
}

// ── Sanitary conteo + visual ─────────────────────────────────────────

function scoreSanitaryPct(medicion) {
  if (!medicion) return null;
  const unhealthy = (medicion.health_picadura || 0)
                  + (medicion.health_enfermedad || 0)
                  + (medicion.health_quemadura || 0);
  const total = (medicion.health_madura || 0)
              + (medicion.health_inmadura || 0)
              + (medicion.health_sobremadura || 0)
              + unhealthy;
  if (total === 0) return null;
  const pct = unhealthy / total * 100;
  const { a, b } = CONFIG.sanitaryThresholds.pct;
  if (pct <= a) return 3;
  if (pct <= b) return 2;
  return 1;
}

// The vocabulary, the per-axis averaging, and the consensus labels live in
// js/quality-scale.js so the browser and the serverless upload path share one
// definition and cannot drift. Re-exported here because this module is the
// scoring engine's public face and callers already import from it.
// `export ... from` re-exports without binding the names in this module's
// scope, and scoreLot below calls averageEvaluations directly, so import too.
import { averageEvaluations } from './quality-scale.js';

export {
  canonicalSanitaryLabel,
  sanitaryPoints,
  madurezPoints,
  averageEvaluations,
  consensusSanitaryLabel,
  consensusMadurezLabel,
  panelConsensus,
} from './quality-scale.js';

// ── Core: scoreLot ───────────────────────────────────────────────────

export function scoreLot(lot) {
  const rubric = resolveRubric(lot.variety, lot.appellation);
  if (!rubric) {
    return { grade: null, score36: null, rubricId: null, missing: [], reason: 'Sin rúbrica' };
  }

  // Build effective params with variety-level peso override applied
  const params = { ...rubric.params };
  if (rubric.peso_overrides && rubric.peso_overrides[lot.variety]) {
    params.berryFW = rubric.peso_overrides[lot.variety];
  }

  let raw = 0;
  let impSum = 0;
  const missing = [];
  const buckets = {};

  for (const [field, spec] of Object.entries(params)) {
    const pts = scoreParam(spec, lot[field]);
    if (pts === null) {
      missing.push(field);
      continue;
    }
    raw += rescaleBucket(pts) * spec.imp;
    impSum += spec.imp;
    buckets[field] = pts;
  }

  // Sanitary (pct + visual) are derived from medicion, not the rubric
  const conteoImp = CONFIG.sanitaryThresholds.defaultConteoImp;
  const visualImp = rubric.visualImp ?? CONFIG.sanitaryThresholds.defaultVisualImp;

  const conteoPts = scoreSanitaryPct(lot.medicion);
  if (conteoPts === null) missing.push('sanitary_pct');
  else { raw += rescaleBucket(conteoPts) * conteoImp; impSum += conteoImp; buckets.sanitary_pct = conteoPts; }

  // Grado Sanitario already speaks the 0-4 scale, so it enters unscaled.
  const panel = averageEvaluations(lot.medicion);
  const visualPts = panel.sanidad;
  if (visualPts === null) missing.push('visual');
  else { raw += visualPts * visualImp; impSum += visualImp; buckets.visual = visualPts; }

  // Partial-data guard
  // Partial-data guard: the core berry chemistry (brix + pH + ta, Imp 25)
  // must be present. Heavier lab params (av/ag/polifenoles/antocianinas,
  // from the tank reception) may be missing — the grade is then flagged
  // `partial` so the UI can warn it will refine when that chemistry lands.
  const hasCore = 'brix' in buckets && 'pH' in buckets && 'ta' in buckets;
  if (!hasCore || impSum < 25) {
    return { grade: null, score36: null, rubricId: rubric.id, missing, partial: false, reason: 'Datos insuficientes' };
  }
  const partial = impSum < 60;

  const base36 = raw / (CONFIG.scoreScaleMax * impSum) * 36;

  // Madurez overlay (winemaker), averaged across the evaluator panel.
  const madurezAdj = panel.madurez ?? 0;

  const score36raw = base36 + madurezAdj;
  const score36 = Math.max(0, Math.min(36, score36raw));

  const grade = score36 >= 30 ? 'A+'
              : score36 >= 27 ? 'A'
              : score36 >= 23 ? 'B'
              :                 'C';

  return {
    grade,
    score36: Math.round(score36 * 100) / 100,
    rubricId: rubric.id,
    missing,
    partial,
    buckets,
    madurezAdj,
    sanidadAvg: panel.sanidad,
    madurezAvg: panel.madurez,
    // Everyone who graded at least one axis. Taking the larger of the two
    // axis counts under-reports a panel where different people covered
    // different axes (lucy, 2026-08-12).
    evaluadorCount: panel.evaluadorCount,
    reason: null
  };
}

// ── scoreAll: adds percentile within cohort ──────────────────────────

export function scoreAll(lots, options = {}) {
  const cohortMode = options.cohort || 'vintage-variety';
  const scored = lots.map(l => ({ ...l, ...scoreLot(l) }));

  const keyFn = cohortMode === 'variety-only'
    ? (l) => l.variety
    : (l) => `${l.variety}||${l.vintage}`;

  const groups = new Map();
  for (const s of scored) {
    if (s.score36 === null) continue;
    const k = keyFn(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.score36 - b.score36);
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      let j = i;
      while (j + 1 < n && sorted[j + 1].score36 === sorted[i].score36) j++;
      const pct = n === 1 ? 100 : Math.round(((j + 1) / n) * 100);
      for (let k = i; k <= j; k++) sorted[k].percentile = pct;
      i = j;
    }
  }

  for (const s of scored) {
    if (s.percentile === undefined) s.percentile = null;
    s.percentileCohort = cohortMode;
  }

  return scored;
}

// ── aggregateSection: tonnage-weighted roll-up ───────────────────────

export function aggregateSection(lots) {
  let weightedSum = 0;
  let weightTotal = 0;
  let scoredLots = 0;
  for (const l of lots) {
    if (l.score36 === null || l.score36 === undefined) continue;
    const w = (l.tons && l.tons > 0) ? l.tons : 1;
    weightedSum += l.score36 * w;
    weightTotal += w;
    scoredLots++;
  }
  if (scoredLots === 0) {
    return { grade: null, score36: null, lotCount: lots.length };
  }
  const score36 = Math.round((weightedSum / weightTotal) * 100) / 100;
  const grade = score36 >= 30 ? 'A+'
              : score36 >= 27 ? 'A'
              : score36 >= 23 ? 'B'
              :                 'C';
  return { grade, score36, lotCount: lots.length };
}

// ── scoreFromMedicion: lift a medicion row into the lot shape scoreLot expects ──
// Mediciones rows lack berry chemistry (brix, pH, tANT, …). To grade a medicion,
// we look up its matching berry by (lotCode, vintage), graft the medicion's
// snake-cased health fields onto a clone, and delegate to scoreLot.
//
// Mirrors what joinBerryWithMediciones in dataLoader.js does for the map view,
// but starts from the medicion side so the Mediciones Técnicas table can show
// a per-row badge without requiring the user to navigate to the berry view.
//
// @param {object} m — mediciones_tecnicas row (camelCase from _rowToMedicion)
// @param {Map<string, object>|null} berryByLot — keyed `${lotCode}||${vintage}`
// @returns {object} same shape as scoreLot, or { grade: null, reason: 'Sin berry' }
export function scoreFromMedicion(m, berryByLot) {
  if (!m || !m.lotCode || m.vintage == null) {
    return { grade: null, score36: null, rubricId: null, missing: [], reason: 'Sin berry' };
  }
  if (!berryByLot || typeof berryByLot.get !== 'function') {
    return { grade: null, score36: null, rubricId: null, missing: [], reason: 'Sin berry' };
  }
  const berry = berryByLot.get(`${m.lotCode}||${m.vintage}`);
  if (!berry) {
    return { grade: null, score36: null, rubricId: null, missing: [], reason: 'Sin berry' };
  }
  const lot = {
    ...berry,
    medicion: {
      health_grade:       m.healthGrade,
      health_madura:      m.healthMadura,
      health_inmadura:    m.healthInmadura,
      health_sobremadura: m.healthSobremadura,
      health_picadura:    m.healthPicadura,
      health_enfermedad:  m.healthEnfermedad,
      health_quemadura:   m.healthQuemadura,
      tons_received:      m.tons,
      phenolic_maturity:  m.phenolicMaturity,
      evaluaciones:       m.evaluaciones
    }
  };
  return scoreLot(lot);
}
