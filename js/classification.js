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

function scoreVisual(medicion) {
  if (!medicion || !medicion.health_grade) return null;
  return CONFIG.sanitaryThresholds.visual[medicion.health_grade] ?? null;
}

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
    raw += pts * spec.imp;
    impSum += spec.imp;
    buckets[field] = pts;
  }

  // Sanitary (pct + visual) are derived from medicion, not the rubric
  const conteoImp = CONFIG.sanitaryThresholds.defaultConteoImp;
  const visualImp = rubric.visualImp ?? CONFIG.sanitaryThresholds.defaultVisualImp;

  const conteoPts = scoreSanitaryPct(lot.medicion);
  if (conteoPts === null) missing.push('sanitary_pct');
  else { raw += conteoPts * conteoImp; impSum += conteoImp; buckets.sanitary_pct = conteoPts; }

  const visualPts = scoreVisual(lot.medicion);
  if (visualPts === null) missing.push('visual');
  else { raw += visualPts * visualImp; impSum += visualImp; buckets.visual = visualPts; }

  // Partial-data guard
  if (impSum < 60) {
    return { grade: null, score36: null, rubricId: rubric.id, missing, reason: 'Datos insuficientes' };
  }

  const base36 = raw / (3 * impSum) * 36;

  // Madurez overlay (winemaker)
  const madurezKey = lot.medicion?.phenolic_maturity ?? null;
  const madurezAdj = CONFIG.madurezOverlay[madurezKey] ?? 0;

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
    buckets,
    madurezAdj,
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
