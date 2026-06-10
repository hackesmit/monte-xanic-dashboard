// js/demoMode.js
// "Modo Demo" — in-memory data overlay for demonstrations.
// Snapshots the real DataStore arrays, overlays a generated dataset,
// blocks cache writes and Supabase reloads while active, then restores
// everything cleanly on toggle off. Never writes to Supabase or localStorage.

import { DataStore } from './dataLoader.js';
import { CONFIG } from './config.js';

const STATE = {
  active: false,
  snapshot: null
};

export const DemoMode = {
  isActive() { return STATE.active; },

  enable() {
    if (STATE.active) return;

    STATE.snapshot = {
      berry: DataStore.berryData,
      wineR: DataStore.wineRecepcion,
      wineP: DataStore.winePreferment,
      med:   DataStore.medicionesData,
      recs:  DataStore.receptionData,
      recL:  DataStore.receptionLotsData,
      overrides: DataStore.harvestTargetOverrides,
      loaded: { ...DataStore.loaded },
      // Functions we'll monkey-patch so demo stays sealed off from Supabase
      cacheData:        DataStore.cacheData,
      loadFromSupabase: DataStore.loadFromSupabase,
      loadMediciones:   DataStore.loadMediciones,
      loadHarvestTargetOverrides: DataStore.loadHarvestTargetOverrides,
    };

    const demo = generateDemoData();
    DataStore.berryData         = demo.berry;
    DataStore.wineRecepcion     = demo.wine;
    DataStore.winePreferment    = demo.preferment;
    DataStore.medicionesData    = demo.mediciones;
    DataStore.receptionData     = demo.receptions;
    DataStore.receptionLotsData = demo.receptionLots;
    // Real harvest-target overrides would re-aim the calibrated scenarios
    DataStore.harvestTargetOverrides = [];
    DataStore.loaded            = { berry: true, wine: true };

    DataStore.cacheData        = () => {};
    DataStore.loadFromSupabase = async () => true;
    DataStore.loadMediciones   = async () => {};
    DataStore.loadHarvestTargetOverrides = async () => {};
    // Loads already in flight when demo was enabled check this flag before
    // assigning their results (the monkey-patches only stop FUTURE calls).
    DataStore._demoActive = true;

    // Rebuild the joins so berry rows see their matching medicion + reception.
    DataStore._enrichData();

    STATE.active = true;
    if (typeof document !== 'undefined') document.body.classList.add('demo-mode-active');
  },

  disable() {
    if (!STATE.active) return;
    const s = STATE.snapshot;
    DataStore.berryData         = s.berry;
    DataStore.wineRecepcion     = s.wineR;
    DataStore.winePreferment    = s.wineP;
    DataStore.medicionesData    = s.med;
    DataStore.receptionData     = s.recs;
    DataStore.receptionLotsData = s.recL;
    DataStore.harvestTargetOverrides = s.overrides;
    DataStore.loaded            = s.loaded;
    DataStore.cacheData        = s.cacheData;
    DataStore.loadFromSupabase = s.loadFromSupabase;
    DataStore.loadMediciones   = s.loadMediciones;
    DataStore.loadHarvestTargetOverrides = s.loadHarvestTargetOverrides;
    DataStore._demoActive = false;
    DataStore._enrichData();

    STATE.active = false;
    STATE.snapshot = null;
    if (typeof document !== 'undefined') document.body.classList.remove('demo-mode-active');
  },

  toggle() {
    if (STATE.active) this.disable();
    else this.enable();
    return STATE.active;
  }
};

// ── Deterministic RNG (mulberry32) so the demo is reproducible ──

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Two-letter variety prefix used when building lot codes (matches
// fieldLotRanchPatterns expectations: `{VAR}{RANCH}-{SUFFIX}`).
const VARIETY_PREFIX = {
  'Cabernet Sauvignon': 'CS',
  'Cabernet Franc':     'CF',
  'Sauvignon Blanc':    'SB',
  'Syrah':              'SY',
  'Merlot':             'ML',
  'Grenache':           'GR',
  'Caladoc':            'CD',
  'Chardonnay':         'CH',
  'Chenin Blanc':       'CB',
  'Malbec':             'MB',
  'Marselan':           'MS',
  'Petit Verdot':       'PV',
  'Tempranillo':        'TP',
  'Durif':              'DU',
  'Viognier':           'VG'
};

// Split slash-divided variety labels and return the first variety we know how
// to score. Sections whose variety isn't recognized are skipped in the demo.
function primaryVariety(raw) {
  if (!raw) return null;
  const parts = String(raw).split(/[\/,]/).map(s => s.trim());
  for (const p of parts) {
    // Expand short forms used in section labels
    const expanded = p
      .replace(/^Cab\.?\s*Sauv\.?/i, 'Cabernet Sauvignon')
      .replace(/^Cab\.?\s*Franc/i,   'Cabernet Franc')
      .replace(/^Sauv\.?\s*Blanc/i,  'Sauvignon Blanc')
      .replace(/^Temp\.?$/i,         'Tempranillo');
    if (VARIETY_PREFIX[expanded]) return expanded;
  }
  return null;
}

// Pick a grade target so the demo spans the full A+/A/B/C spectrum.
// `cum` is the cumulative distribution [A+, A, B] from the year profile
// (e.g. a warm year skews toward A+/A, a cool year toward B/C).
function pickGradeTarget(r, cum = [0.25, 0.60, 0.90]) {
  const x = r();
  if (x < cum[0]) return 'A+';
  if (x < cum[1]) return 'A';
  if (x < cum[2]) return 'B';
  return 'C';
}

// ── Maturation curve shapes (historical seasons) ──
// Both map normalized season progress k ∈ [0,1] to [0,1].

// Saturating rise: fast early, flattening toward harvest. Models brix
// accumulation, TA decay (with final < base) and pH rise.
function riseShape(k, c) {
  return (1 - Math.exp(-c * k)) / (1 - Math.exp(-c));
}

// Normalized logistic: slow start, mid-season surge, plateau. Models
// anthocyanin accumulation. `center` shifts the surge within the season.
function sigShape(k, center, steep = 6) {
  const f = x => 1 / (1 + Math.exp(-steep * (x - center)));
  return (f(k) - f(0)) / (f(1) - f(0));
}

// Return a chemistry value that scores 3 / 2 / 1 pts for a given rubric param.
// Uses the rubric's thresholds so the engine maps back to the intended bucket.
function valueForPts(spec, pts, r) {
  const jitter = () => (r() - 0.5) * 0.02; // tiny noise for realism
  switch (spec.kind) {
    case 'le-a-le-b': {
      if (pts === 3) return Math.max(0, spec.a - r() * (spec.a * 0.3 + 0.01));
      if (pts === 2) return spec.a + r() * Math.max(0.01, spec.b - spec.a);
      return spec.b + r() * spec.b * 0.8 + 0.01;
    }
    case 'ge-a-ge-b': {
      if (pts === 3) return spec.a + r() * spec.a * 0.15;
      if (pts === 2) return spec.b + r() * Math.max(0.01, spec.a - spec.b);
      return Math.max(0, spec.b - r() * spec.b * 0.4);
    }
    case 'range': {
      const [lo, hi] = spec.a;
      if (pts === 3) return lo + r() * (hi - lo);
      if (pts === 2) {
        const range = spec.b[Math.floor(r() * spec.b.length)];
        return range[0] + r() * (range[1] - range[0]);
      }
      // Outside both A and B — land just above the upper B band so the value
      // is still physiologically plausible (e.g. berryFW stays > 0).
      const maxB = spec.b.reduce((m, rng) => Math.max(m, rng[1]), hi);
      return maxB + 0.05 + r() * (maxB * 0.2);
    }
  }
  return spec.a ?? 0;
}

// Pick a distribution of per-param points such that the overall score36 lands
// in the target grade band. We bias each param's pts to match, accepting that
// partial overlays (madurez/sanitary) may nudge the final grade slightly —
// that's desirable for a demo that shows the full machinery in action.
function pointsForGrade(grade, r) {
  switch (grade) {
    case 'A+': return () => (r() < 0.85 ? 3 : 2);
    case 'A':  return () => (r() < 0.60 ? 3 : 2);
    case 'B':  return () => {
      const x = r();
      if (x < 0.15) return 3;
      if (x < 0.75) return 2;
      return 1;
    };
    case 'C':  return () => (r() < 0.70 ? 1 : 2);
  }
  return () => 2;
}

function healthForGrade(grade, r) {
  // Health counts sum to 100 for easy pct calculation
  switch (grade) {
    case 'A+':
    case 'A':
      return { grade: r() < 0.5 ? 'Excelente' : 'Bueno',
               madura: 82 + Math.round(r() * 8),
               inmadura: 2 + Math.round(r() * 3),
               sobremadura: 1 + Math.round(r() * 2),
               picadura: 0, enfermedad: 0, quemadura: 0 };
    case 'B':
      return { grade: r() < 0.5 ? 'Bueno' : 'Regular',
               madura: 78 + Math.round(r() * 6),
               inmadura: 4 + Math.round(r() * 4),
               sobremadura: 2 + Math.round(r() * 3),
               picadura: 1, enfermedad: 1, quemadura: 0 };
    case 'C':
      return { grade: r() < 0.5 ? 'Regular' : 'Malo',
               madura: 60 + Math.round(r() * 10),
               inmadura: 8 + Math.round(r() * 6),
               sobremadura: 3 + Math.round(r() * 4),
               picadura: 3 + Math.round(r() * 3),
               enfermedad: 2 + Math.round(r() * 3),
               quemadura: 1 + Math.round(r() * 2) };
  }
}

// Resolve the rubric id a (variety, appellation) would use, so we can assign
// threshold-matching parameter values.
function demoRubricFor(variety, appellation) {
  // Cheap duplicate of resolveRubric — we want to stay dependency-free here.
  let valley = null;
  const s = String(appellation || '');
  if (/Valle de Ojos Negros|\(VON\)/i.test(s)) valley = 'Valle de Ojos Negros';
  else if (/Valle de Guadalupe|\(VDG\)|VDG/i.test(s)) valley = 'Valle de Guadalupe';
  else if (/San Vicente|VSV|\(SV\)/i.test(s)) valley = 'Valle de San Vicente';
  if (!valley) return null;
  const map = CONFIG.varietyRubricMap[valley];
  if (!map) return null;
  const rubricId = map[variety];
  if (!rubricId) return null;
  const rubric = CONFIG.rubrics[rubricId];
  if (!rubric) return null;
  return { id: rubricId, ...rubric };
}

// Year-character profiles for the two historical vintages. The demo spans
// 3 vendimias (currentYear-2, currentYear-1, currentYear) so vintage
// comparison charts overlay distinct, realistic seasons:
//  - currentYear-2: cool/late year — envero in early August, slower 8-day
//    sampling cadence, anthocyanins still climbing at harvest (antCenter
//    late), lower grade mix, lighter yields.
//  - currentYear-1: warm/early year — envero mid-July, weekly sampling,
//    anthocyanins plateau before harvest (antCenter early), better grades.
// The divergent late-season anthocyanin slopes also keep the predictor's
// historicalSlopePrior variance (τ²) high, so the Bayesian prior stays weak
// and the current-season scenario calibration (scenarioParams) is preserved.
// brixC / phC set each year's riseShape exponent: the cool year saturates
// early (flat late-season slope), the warm year keeps climbing into harvest.
// Like antCenter, this divergence keeps the slope prior's between-vintage
// variance honest — two generator-identical years would make τ² ≈ 0 and let
// the prior crush the current-season fit.
function yearProfiles(currentYear) {
  return [
    { vintage: currentYear - 2, idBase: 0,    enveroMMDD: '08-02', stepDays: 8,
      gradeCum: [0.12, 0.42, 0.80], antFactor: 0.85, antCenter: 0.62,
      brixC: 3.0, phC: 2.1, tonsFactor: 0.85 },
    { vintage: currentYear - 1, idBase: 3000, enveroMMDD: '07-15', stepDays: 7,
      gradeCum: [0.30, 0.70, 0.95], antFactor: 1.10, antCenter: 0.38,
      brixC: 1.3, phC: 1.4, tonsFactor: 1.05 },
  ];
}

function generateDemoData() {
  const r = rng(20250421);
  const currentYear = new Date().getFullYear();
  const today = new Date();
  const [coolYear, warmYear] = yearProfiles(currentYear).map(p => generateHistoricalSeason(p, r));
  const current = generateCurrentSeason(currentYear, today, r);
  // Berry now concatenates ALL three vintages so the vintage comparison
  // charts (brix/tANT/pH/AT vs días post-envero) overlay 3 vendimias.
  // The historical berries feed the predictor's historicalSlopePrior (V=2),
  // but the prior stays weak by design — see yearProfiles() above — so the
  // current-season scenarios still land on their calibrated `reason`s.
  //
  // Mediciones / receptions / wine concatenate all vintages so that:
  //  - Calidad map's joinBerryWithMediciones (keyed on lotCode + vintage)
  //    finds matches for every vintage → grades populate for any year
  //    selected on the map instead of all-grey "Sin clasificar".
  //  - Wine views get 3 vintage chips.
  return {
    berry:         [...coolYear.berry,         ...warmYear.berry,         ...current.berry],
    mediciones:    [...coolYear.mediciones,    ...warmYear.mediciones,    ...current.mediciones],
    receptions:    [...coolYear.receptions,    ...warmYear.receptions,    ...current.receptions],
    receptionLots: [...coolYear.receptionLots, ...warmYear.receptionLots, ...current.receptionLots],
    wine:          [...coolYear.wine,          ...warmYear.wine,          ...current.wine],
    preferment:    [...coolYear.preferment,    ...warmYear.preferment],
  };
}

// ── Current-season scenarios (mid-harvest demo) ──
// Each scenario yields (yhat_brix_today, β_brix, yhat_ant_today, β_ant)
// calibrated against the group's rubric so Prediction.computeOne lands
// on the intended `reason`. See spec § Scenarios.
const SCENARIO_QUOTAS = [
  ['ya-en-ventana',             0.20],
  ['eta-corta',                 0.20],
  ['eta-media',                 0.30],
  ['no-alcanzar-A',             0.10],
  ['antocianinas-estancadas',   0.10],
  ['riesgo-ph',                 0.05],
  ['ph-temprano',               0.05],
];

// Scenarios that require ANT machinery — reassigned to 'eta-media' when
// the group's rubric has no anthocyanins target (white varieties).
const ANT_DEPENDENT_SCENARIOS = new Set([
  'no-alcanzar-A', 'antocianinas-estancadas',
]);

// Scenarios that require pH-as-deadline machinery — reassigned to 'eta-media'
// when the group's rubric has no pH target (i.e., reds in current ruleset).
const PH_DEPENDENT_SCENARIOS = new Set([
  'riesgo-ph', 'ph-temprano',
]);

// Resolve (yhat_brix_today, β_brix, yhat_ant_today, β_ant, yhat_ph_today, β_ph)
// for a scenario, given the group's target window. `r` is the seeded RNG.
function scenarioParams(scenario, target, r) {
  const { brixLower, brixUpper, brixTarget, antTarget, phTarget } = target;
  switch (scenario) {
    case 'ya-en-ventana':
      return {
        yBrix: brixTarget + r() * 0.5, bBrix: 0.15,
        yAnt:  antTarget != null ? antTarget * 1.10 : null, bAnt: 8,
        yPh:   phTarget  != null ? phTarget  - 0.05 : null, bPh: 0.005,
      };
    // bAnt is calibrated so antEta stays BELOW the brix window close
    // ((brixUpper - yBrix) / bBrix); with the old 12/day these scenarios
    // bled into 'no-alcanzar-A' for most red groups.
    case 'eta-corta':
      return {
        yBrix: brixLower - (2 + r()), bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.85 : null, bAnt: 16,
        yPh:   phTarget  != null ? phTarget  - 0.15 : null, bPh: 0.008,
      };
    case 'eta-media':
      return {
        // Deficit 3.6–4.5 Bx at 0.25 Bx/día (≈17–22 días). The old 5–7 Bx
        // deficit back-cast below green-fruit chemistry over the sampled
        // window, which is physiologically impossible and clashed with the
        // early-season floors.
        yBrix: brixLower - (3.6 + r() * 0.9), bBrix: 0.25,
        yAnt:  antTarget != null ? antTarget * 0.75 : null, bAnt: 18,
        yPh:   phTarget  != null ? phTarget  - 0.20 : null, bPh: 0.008,
      };
    case 'no-alcanzar-A':
      return {
        yBrix: brixTarget - r(), bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.50 : null, bAnt: 1.5,
        yPh:   null, bPh: 0,
      };
    case 'antocianinas-estancadas':
      return {
        yBrix: brixLower + r(), bBrix: 0.25,
        yAnt:  antTarget != null ? antTarget * 0.70 : null, bAnt: -0.5,
        yPh:   null, bPh: 0,
      };
    case 'riesgo-ph':
      return {
        yBrix: brixLower - (3 + r() * 0.5), bBrix: 0.25,
        yAnt:  null, bAnt: 0,
        yPh:   phTarget != null ? phTarget - 0.05 : null, bPh: 0.025,
      };
    case 'ph-temprano':
      return {
        yBrix: brixLower - (6 + r() * 0.5), bBrix: 0.20,
        yAnt:  null, bAnt: 0,
        yPh:   phTarget != null ? phTarget - 0.02 : null, bPh: 0.030,
      };
  }
  return null;
}

// Build one demo group per CONFIG.vineyardSections row that has a recognized
// variety and a resolvable rubric. No deduplication by (variety, appellation):
// each section gets its own demo lot so every polygon on the calidad map can
// render a grade (otherwise N sections sharing a variety/appellation collapse
// into 1 demo lot and N-1 polygons stay grey). Each section's scenario is
// assigned independently downstream, so the same variety in two sections may
// surface different grades — visually closer to a realistic sampling week.
// Stable sort by (appellation, variety, lotCode) for deterministic scenario
// assignment.
function buildCurrentSeasonGroups() {
  const groups = [];
  for (const section of CONFIG.vineyardSections) {
    const variety = primaryVariety(section.variety);
    if (!variety) continue;
    const appellation = section.ranch;
    const rubric = demoRubricFor(variety, appellation);
    if (!rubric) continue;
    // Effective rubric params (variety-specific peso_overrides applied
    // upstream; here we only need brix + anthocyanins + pH thresholds).
    const brixSpec = rubric.params.brix;
    const antSpec  = rubric.params.anthocyanins;
    const phSpec   = rubric.params.pH;
    const target = {
      brixLower:  brixSpec?.a?.[0] ?? null,
      brixUpper:  brixSpec?.a?.[1] ?? null,
      brixTarget: brixSpec?.a ? (brixSpec.a[0] + brixSpec.a[1]) / 2 : null,
      antTarget:  antSpec?.a ?? null,
      phTarget:   (phSpec && !antSpec) ? phSpec.a : null,
    };
    if (target.brixLower == null) continue;  // can't calibrate without window
    const ranchCode = section.ranchCode;
    const prefix = VARIETY_PREFIX[variety] || 'XX';
    // Lot code must round-trip through MapStore.resolveSection back to this
    // section's sectionId — otherwise the SVG polygon can't find its data.
    // Kompali puts K first ("KCS-S8"); every other ranch puts the variety
    // prefix first ("CSMX-1A").
    const suffix = section.sectionLabel;
    const lotCode = ranchCode === 'K'
      ? `K${prefix}-${suffix}`
      : `${prefix}${ranchCode}-${suffix}`;
    groups.push({ variety, appellation, target, lotCode });
  }
  return groups.sort((a, b) =>
    a.appellation.localeCompare(b.appellation)
    || a.variety.localeCompare(b.variety)
    || a.lotCode.localeCompare(b.lotCode));
}

// Largest-remainder quota allocation: returns an array of scenario names
// (length === nGroups) with each scenario's count matching SCENARIO_QUOTAS,
// shuffled deterministically.
function assignScenarios(nGroups, r) {
  const raw = SCENARIO_QUOTAS.map(([name, pct]) => ({
    name, exact: pct * nGroups, floor: Math.floor(pct * nGroups),
  }));
  let allocated = raw.reduce((s, x) => s + x.floor, 0);
  const remainder = nGroups - allocated;
  // Sort by fractional part desc, add 1 to top `remainder` slots
  const order = raw.map((x, i) => ({ i, frac: x.exact - x.floor }))
                   .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) raw[order[k].i].floor += 1;
  // Build pool
  const pool = [];
  for (const x of raw) for (let k = 0; k < x.floor; k++) pool.push(x.name);
  // Fisher–Yates with seeded RNG
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// Generate 5-point berry time series for each (variety, appellation)
// group in CONFIG.vineyardSections, calibrated so Prediction.computeOne
// lands on the assigned scenario's expected reason. Returns { berry }.
function generateCurrentSeason(currentYear, today, r) {
  const berry = [];
  const mediciones = [];
  const receptions = [];
  const receptionLots = [];
  const wine = [];
  let receptionId = 1;
  const groups = buildCurrentSeasonGroups();

  // Assign ONE scenario per (variety, appellation) prediction group, not per
  // section: Prediction.computeAll pools every section sharing variety +
  // appellation into a single regression, so per-section scenarios mixed
  // lines up to ~5 Bx apart in one fit — the inflated residual variance let
  // the historical slope prior dominate the posterior and dragged every ETA
  // out by weeks. Sections of the same group share scenario params (adjacent
  // same-variety blocks ripening together is also closer to a real week).
  const keyOf = g => `${g.variety}|${g.appellation}`;
  const keys = [];
  const targetByKey = new Map();
  for (const g of groups) {
    const k = keyOf(g);
    if (!targetByKey.has(k)) { keys.push(k); targetByKey.set(k, g.target); }
  }
  const scenarios = assignScenarios(keys.length, r);

  // Realign: ANT-scenarios should land on red groups; pH-scenarios on white groups.
  // The base shuffle is uniform across all groups, so without this swap pass the
  // PH/ANT reassignment guards below silently demote pH/ANT scenarios to
  // 'eta-media' whenever the RNG happens to place them on the "wrong" group type.
  const isRed   = i => targetByKey.get(keys[i]).antTarget != null;
  const isWhite = i => targetByKey.get(keys[i]).phTarget != null
                    && targetByKey.get(keys[i]).antTarget == null;
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    if (ANT_DEPENDENT_SCENARIOS.has(s) && !isRed(i)) {
      for (let j = 0; j < scenarios.length; j++) {
        if (i === j) continue;
        if (isRed(j) && !ANT_DEPENDENT_SCENARIOS.has(scenarios[j])
            && !PH_DEPENDENT_SCENARIOS.has(scenarios[j])) {
          [scenarios[i], scenarios[j]] = [scenarios[j], scenarios[i]];
          break;
        }
      }
    } else if (PH_DEPENDENT_SCENARIOS.has(s) && !isWhite(i)) {
      for (let j = 0; j < scenarios.length; j++) {
        if (i === j) continue;
        if (isWhite(j) && !ANT_DEPENDENT_SCENARIOS.has(scenarios[j])
            && !PH_DEPENDENT_SCENARIOS.has(scenarios[j])) {
          [scenarios[i], scenarios[j]] = [scenarios[j], scenarios[i]];
          break;
        }
      }
    }
  }

  // Resolve scenario params once per group key; the white/red fallbacks
  // mirror the old per-section guards.
  const paramsByKey = new Map();
  for (let i = 0; i < keys.length; i++) {
    const target = targetByKey.get(keys[i]);
    let scenario = scenarios[i];
    if (target.antTarget == null && ANT_DEPENDENT_SCENARIOS.has(scenario)) {
      scenario = 'eta-media';
    }
    if (target.phTarget == null && PH_DEPENDENT_SCENARIOS.has(scenario)) {
      scenario = 'eta-media';
    }
    paramsByKey.set(keys[i], scenarioParams(scenario, target, r));
  }

  // 7 samples every 4 days over a 24-day window — nCurrent ≥ 6 keeps the
  // confidence label's freshness score at 1.0 now that historical vintages
  // make V=2, and the short window keeps the scenario's linear segment
  // dominant in the regression (a longer back-cast at scenario slopes would
  // fall below green-fruit chemistry and force the physiological floors to
  // flatten the fit).
  const offsets = [-24, -20, -16, -12, -8, -4, 0];  // days from today
  const dayMs = 86_400_000;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const p = paramsByKey.get(keyOf(g));
    if (!p) continue;
    const yy = String(currentYear).slice(2);
    const isWhite = g.target.phTarget != null && g.target.antTarget == null;
    // Per-lot green-fruit baselines. Early samples are floored at these
    // physiological values so the back-cast scenario lines can't drop below
    // envero chemistry — the current vintage keeps the same flat-start →
    // ripening-ramp shape as the historical sigmoids. The floors only bind
    // on the oldest samples (outside the 14-day recency-boost window), so
    // the weighted regression stays on each scenario's calibrated line.
    const baseBrix = 14.2 + r() * 1.2;
    const baseAnt  = 100 + r() * 60;
    const basePh   = 2.9 + r() * 0.1;
    for (let i = 0; i < offsets.length; i++) {
      const t = offsets[i];
      const seq = i + 1;
      const dpc = 38 + t;
      const dateObj = new Date(today.getTime() + t * dayMs);
      const sampleDate = dateObj.toISOString().slice(0, 10);
      const brix = Math.max(p.yBrix + p.bBrix * t, baseBrix + 0.02 * dpc)
        + (r() - 0.5) * 0.4;
      // Noise is ±12 (was ±30): with the historical prior now active (V=2),
      // larger noise widens σβ² enough for the prior's positive mean slope to
      // flip the 'antocianinas-estancadas' posterior above zero.
      const ant  = p.yAnt != null
        ? Math.max(p.yAnt + p.bAnt * t, baseAnt + 3.5 * dpc) + (r() - 0.5) * 24
        : null;
      // Red pH rises gently through the season (cosmetic only — the predictor
      // ignores pH when antTarget is set); whites keep scenario calibration.
      const pH = isWhite && p.yPh != null
        ? Math.max(2.5, Math.min(4.5,
            Math.max(p.yPh + p.bPh * t, basePh + 0.004 * dpc) + (r() - 0.5) * 0.02))
        : 3.6 + t * 0.011 + (r() - 0.5) * 0.08;
      berry.push({
        sampleId: `${yy}${g.lotCode}-c${seq}`,
        sampleDate,
        vintage: currentYear,
        variety: g.variety,
        appellation: g.appellation,
        sampleType: 'Berries',
        lotCode: g.lotCode,
        brix,
        pH,
        // TA decays from ~9.2 g/L post-envero toward ~5.1 at harvest
        ta: 5.1 - t * 0.115 + (r() - 0.5) * 0.6,
        tANT: ant != null ? Math.round(ant) : null,
        // Berry weight swells through the season like the historical rise
        berryFW: 1.02 + t * 0.008 + (r() - 0.5) * 0.06,
        anthocyanins: ant != null ? Math.round(ant) : null,
        daysPostCrush: dpc,
        sampleSeq: seq,
        grapeType: null,
      });
    }
    const latestSampleDate = berry[berry.length - 1].sampleDate;

    // NOTE: chemistry/health values below are hand-calibrated to the rubric's
    // 3-pts thresholds (see CONFIG.rubrics). If rubric thresholds shift, this
    // demo will silently drift to lower grades. Follow-up: refactor to use
    // valueForPts(spec, 3, r) like generateHistoricalSeason — out of scope
    // for the Wave 1 #2 fix.

    // Current-season mediciones row — targets a "good" grade so the demo
    // calidad map renders colors. Health distribution heavy on madura/buena.
    const totalBerries = 100;
    mediciones.push({
      id: 1000 + receptionId,
      code: `M-CUR-${g.lotCode}`,
      date: latestSampleDate,
      vintage: currentYear,
      variety: g.variety,
      appellation: g.appellation,
      lotCode: g.lotCode,
      tons: 5 + r() * 8,                        // 5–13 tons (realistic lot size)
      berryCount: totalBerries,
      berryWeight: 1.0 + (r() - 0.5) * 0.15,
      berryDiameter: 12 + r(),
      healthGrade: 'Excelente',                 // visual score = 3
      healthMadura: 88 + Math.floor(r() * 10),  // ~92% madura
      healthInmadura: Math.floor(r() * 4),
      healthSobremadura: Math.floor(r() * 3),
      healthPicadura: Math.floor(r() * 2),
      healthEnfermedad: 0,
      healthQuemadura: Math.floor(r() * 2),
      phenolicMaturity: r() < 0.7 ? 'Sobresaliente' : 'Parcial',
      measuredBy: 'Demo',
      notes: null
    });

    // Current-season tank reception — supplies av/ag/polyphenols via
    // joinBerryWithReceptions so the rubric's chemistry params fill.
    const rid = receptionId++;
    receptions.push({
      id: 10000 + rid,
      report_code: `RC-CUR-${rid}`,
      reception_date: latestSampleDate,
      batch_code: `${String(currentYear).slice(2)}${g.lotCode}-T${rid}`,
      tank_id: `T-CUR-${rid}`,
      supplier: g.appellation,
      variety: g.variety,
      brix: 24 + r(),
      ph: 3.6 + (r() - 0.5) * 0.3,
      ta: 5.5 + (r() - 0.5) * 1.0,
      av: 0.20 + r() * 0.10,                    // <= 0.30 = 3pts in rubric
      ag: 0.30 + r() * 0.15,                    // <= 0.40 = 3pts
      polifenoles_wx: 2200 + Math.round(r() * 600),  // >= 2200 = 3pts in most rubrics
      antocianinas_wx: 1100 + Math.round(r() * 300),
      vintage_year: currentYear
    });
    receptionLots.push({
      reception_id: 10000 + rid,
      lot_code: g.lotCode,
      lot_position: 1
    });

    // Wine row mirrors historical-season shape so the wine table renders.
    wine.push({
      codigoBodega: `${String(currentYear).slice(2)}${g.lotCode}-W`,
      fecha: latestSampleDate,
      tanque: `T-CUR-${rid}`,
      variedad: g.variety,
      proveedor: g.appellation,
      sampleType: 'Wine',
      vintage: currentYear,
      brix: 24 + r(),
      pH: 3.6 + (r() - 0.5) * 0.3,
      at: 5.5 + (r() - 0.5) * 1.0,
      antoWX: 1100 + Math.round(r() * 300),
      iptSpica: 60 + Math.round(r() * 15),
      grapeType: null
    });
  }
  return { berry, mediciones, receptions, receptionLots, wine };
}

function generateHistoricalSeason(profile, r) {
  const VINTAGE = profile.vintage;
  const berry = [];
  const mediciones = [];
  const receptions = [];
  const receptionLots = [];
  const wine = [];
  const preferment = [];

  const dayMs = 86_400_000;
  const yy = String(VINTAGE).slice(2);
  const enveroBaseMs = Date.parse(`${VINTAGE}-${profile.enveroMMDD}T12:00:00Z`);
  let receptionId = 1;

  for (const section of CONFIG.vineyardSections) {
    const variety = primaryVariety(section.variety);
    if (!variety) continue;  // Plantas Madre, unknown
    const appellation = section.ranch;
    const rubric = demoRubricFor(variety, appellation);
    if (!rubric) continue;

    const prefix = VARIETY_PREFIX[variety] || 'XX';
    const suffix = section.sectionLabel;
    const ranchCode = section.ranchCode;

    // Lot code convention matches fieldLotRanchPatterns: e.g. CSMX-5B, SYDA-L5.
    // Kompali ('K') puts the ranch code FIRST: KCS-S2B (regex /^K[A-Z]{2,3}-/),
    // so the variety prefix has to follow K — otherwise the resolver returns
    // null and historical Kompali lots never map to a section.
    const lotCode = ranchCode === 'K'
      ? `K${prefix}-${suffix}`
      : `${prefix}${ranchCode}-${suffix}`;

    const target = pickGradeTarget(r, profile.gradeCum);
    const ptsFn = pointsForGrade(target, r);

    // Effective params include variety-specific peso_overrides
    const params = { ...rubric.params };
    if (rubric.peso_overrides && rubric.peso_overrides[variety]) {
      params.berryFW = rubric.peso_overrides[variety];
    }

    // Build value for each param the rubric cares about
    const vals = {};
    for (const [field, spec] of Object.entries(params)) {
      vals[field] = valueForPts(spec, ptsFn(), r);
    }

    const health = healthForGrade(target, r);

    // Phenolic maturity overlay — mirrored to the grade target
    const madurezMap = { 'A+': 'Sobresaliente', 'A': null, 'B': 'Parcial', 'C': 'No sobresaliente' };
    const phenolicMaturity = madurezMap[target];
    const tons = Math.round((5 + r() * 40) * profile.tonsFactor * 10) / 10;

    // Six time-series points at a weekly-ish cadence (profile.stepDays ± 1)
    // from shortly after envero to harvest, so the vintage comparison and
    // evolution charts render dense, natural curves. The last point carries
    // the final (A+/A/B/C) rubric-calibrated chemistry; earlier points follow
    // physiological shapes from green-fruit baselines:
    //   brix saturating rise · TA decay · pH rise · anthocyanin sigmoid.
    const nPts = 6;
    const dpcStart = 8 + Math.floor(r() * 5);
    const step = profile.stepDays + Math.floor(r() * 2);
    const dpcs = Array.from({ length: nPts }, (_, i) => dpcStart + i * step);
    const dpcH = dpcs[nPts - 1];
    // Stagger each lot's envero ±5 days around the vintage's base date.
    const enveroMs = enveroBaseMs + Math.round((r() - 0.5) * 10) * dayMs;
    const dateFor = dpc => new Date(enveroMs + dpc * dayMs).toISOString().slice(0, 10);

    // Per-lot green-fruit baselines
    const baseBrix = 14.5 + r() * 1.5;
    const baseTa   = 11 + r() * 2.5;
    const basePH   = 2.85 + r() * 0.12;
    const baseFW   = 0.62 + r() * 0.1;
    const baseTant = 90 + r() * 60;

    // Final total anthocyanins: tied to the rubric's extractable target for
    // reds (× year character), low plateau for whites (no anthocyanins param).
    const extFinal = vals.anthocyanins ?? (400 + Math.round(r() * 800));
    const tantFinal = params.anthocyanins
      ? Math.round(extFinal * (1.25 + r() * 0.3) * profile.antFactor)
      : Math.round(50 + r() * 70);

    const latestRow = {
      sampleId: `${yy}${lotCode}-${nPts}`,
      sampleDate: dateFor(dpcH),
      vintage: VINTAGE,
      variety,
      appellation,
      sampleType: 'Berries',
      lotCode,
      brix: vals.brix,
      pH: vals.pH,
      ta: vals.ta,
      tANT: tantFinal,
      berryFW: vals.berryFW,
      anthocyanins: Math.round(extFinal),
      daysPostCrush: dpcH,
      sampleSeq: nPts,
      grapeType: null
    };
    for (let i = 0; i < nPts - 1; i++) {
      const dpc = dpcs[i];
      const k = dpc / dpcH;
      const antK = sigShape(k, profile.antCenter);
      berry.push({
        sampleId: `${yy}${lotCode}-${i + 1}`,
        sampleDate: dateFor(dpc),
        vintage: VINTAGE,
        variety,
        appellation,
        sampleType: 'Berries',
        lotCode,
        brix:    baseBrix + (vals.brix - baseBrix) * riseShape(k, profile.brixC) + (r() - 0.5) * 0.5,
        pH:      basePH   + (vals.pH   - basePH)   * riseShape(k, profile.phC) + (r() - 0.5) * 0.05,
        ta:      baseTa   + (vals.ta   - baseTa)   * riseShape(k, 2.0) + (r() - 0.5) * 0.4,
        tANT:    Math.round(baseTant + (tantFinal - baseTant) * antK + (r() - 0.5) * 50),
        berryFW: baseFW   + (vals.berryFW - baseFW) * riseShape(k, 2.0) + (r() - 0.5) * 0.04,
        anthocyanins: Math.round(Math.max(50, extFinal * (0.15 + 0.85 * antK))),
        daysPostCrush: dpc,
        sampleSeq: i + 1,
        grapeType: null
      });
    }
    berry.push(latestRow);
    const berryRow = latestRow;  // used below for dates/references

    mediciones.push({
      id: profile.idBase + mediciones.length + 1,
      code: `M-DEMO-${yy}-${mediciones.length + 1}`,
      date: berryRow.sampleDate,
      vintage: VINTAGE,
      variety,
      appellation,
      lotCode,
      tons,
      berryCount: 100,
      berryWeight: vals.berryFW,
      berryDiameter: 12 + r(),
      healthGrade: health.grade,
      healthMadura: health.madura,
      healthInmadura: health.inmadura,
      healthSobremadura: health.sobremadura,
      healthPicadura: health.picadura,
      healthEnfermedad: health.enfermedad,
      healthQuemadura: health.quemadura,
      phenolicMaturity,
      measuredBy: 'Demo',
      notes: null
    });

    // Tank reception carries av / ag / polyphenols.
    // ids are offset per vintage (profile.idBase) so the two historical
    // seasons never collide in the reception_id → lots index.
    const rid = receptionId++;
    receptions.push({
      id: profile.idBase + rid,
      report_code: `RC-DEMO-${yy}-${rid}`,
      reception_date: berryRow.sampleDate,
      batch_code: `${yy}${lotCode}-T${rid}`,
      tank_id: `T${rid}`,
      supplier: appellation,
      variety,
      brix: vals.brix,
      ph: vals.pH,
      ta: vals.ta,
      av: vals.av,
      ag: vals.ag,
      polifenoles_wx: vals.polyphenols ?? null,
      antocianinas_wx: vals.anthocyanins ?? null,
      vintage_year: VINTAGE
    });
    receptionLots.push({
      reception_id: profile.idBase + rid,
      lot_code: lotCode,
      lot_position: 1
    });

    // Wine reception row — some downstream views (tables, explorer) read it
    wine.push({
      codigoBodega: `${yy}${lotCode}-W`,
      fecha: berryRow.sampleDate,
      tanque: `T${rid}`,
      variedad: variety,
      proveedor: appellation,
      sampleType: 'Wine',
      vintage: VINTAGE,
      brix: vals.brix,
      pH: vals.pH,
      at: vals.ta,
      antoWX: vals.anthocyanins ?? null,
      iptSpica: vals.polyphenols ?? null,
      grapeType: null
    });
  }

  return { berry, wine, preferment, mediciones, receptions, receptionLots };
}
