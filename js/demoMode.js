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
    DataStore.loaded            = { berry: true, wine: true };

    DataStore.cacheData        = () => {};
    DataStore.loadFromSupabase = async () => true;
    DataStore.loadMediciones   = async () => {};
    DataStore.loadHarvestTargetOverrides = async () => {};

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
    DataStore.loaded            = s.loaded;
    DataStore.cacheData        = s.cacheData;
    DataStore.loadFromSupabase = s.loadFromSupabase;
    DataStore.loadMediciones   = s.loadMediciones;
    DataStore.loadHarvestTargetOverrides = s.loadHarvestTargetOverrides;
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
// Distribution: A+ 25%, A 35%, B 30%, C 10%.
function pickGradeTarget(r) {
  const x = r();
  if (x < 0.25) return 'A+';
  if (x < 0.60) return 'A';
  if (x < 0.90) return 'B';
  return 'C';
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

function generateDemoData() {
  const r = rng(20250421);
  const currentYear = new Date().getFullYear();
  const today = new Date();
  const historical = generateHistoricalSeason(2025, r);
  const current = generateCurrentSeason(currentYear, today, r);
  // Berry uses current-season only so the predictor's historicalSlopePrior
  // sees V=0 (3-point historical data is too sparse; V=0 + downgrade rule
  // produces reliable 'Media' confidence labels).
  //
  // Mediciones / receptions / wine concatenate both vintages so that:
  //  - Predictor views still see historical 2025 context.
  //  - Calidad map's joinBerryWithMediciones (keyed on lotCode + vintage)
  //    finds current-vintage matches for current-vintage berries → grades
  //    populate instead of all-grey "Sin clasificar".
  return {
    berry: current.berry,
    mediciones:    [...historical.mediciones,    ...current.mediciones],
    receptions:    [...historical.receptions,    ...current.receptions],
    receptionLots: [...historical.receptionLots, ...current.receptionLots],
    wine:          [...historical.wine,          ...current.wine],
    preferment:    historical.preferment,
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
    case 'eta-corta':
      return {
        yBrix: brixLower - (2 + r()), bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.85 : null, bAnt: 12,
        yPh:   phTarget  != null ? phTarget  - 0.15 : null, bPh: 0.008,
      };
    case 'eta-media':
      return {
        yBrix: brixLower - (5 + r() * 2), bBrix: 0.30,
        yAnt:  antTarget != null ? antTarget * 0.65 : null, bAnt: 12,
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

// Deduplicate vineyardSections into (variety, appellation) groups with
// their resolved rubric. Stable sort by (appellation, variety) for
// deterministic scenario assignment.
function buildCurrentSeasonGroups() {
  const seen = new Map();  // key: "variety|appellation"
  for (const section of CONFIG.vineyardSections) {
    const variety = primaryVariety(section.variety);
    if (!variety) continue;
    const appellation = section.ranch;
    const rubric = demoRubricFor(variety, appellation);
    if (!rubric) continue;
    const key = `${variety}|${appellation}`;
    if (seen.has(key)) continue;
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
    // One representative section per group — use a stable suffix that
    // doesn't collide with the historical lotCode pattern.
    const lotCode = `${prefix}${ranchCode}-G`;
    seen.set(key, { variety, appellation, target, lotCode });
  }
  return [...seen.values()].sort((a, b) =>
    a.appellation.localeCompare(b.appellation)
    || a.variety.localeCompare(b.variety));
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
  const scenarios = assignScenarios(groups.length, r);

  // Realign: ANT-scenarios should land on red groups; pH-scenarios on white groups.
  // The base shuffle is uniform across all groups, so without this swap pass the
  // PH/ANT reassignment guards below silently demote pH/ANT scenarios to
  // 'eta-media' whenever the RNG happens to place them on the "wrong" group type.
  const isRed   = i => groups[i].target.antTarget != null;
  const isWhite = i => groups[i].target.phTarget != null && groups[i].target.antTarget == null;
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

  const offsets = [-32, -24, -16, -8, 0];  // days from today
  const dayMs = 86_400_000;

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    let scenario = scenarios[gi];
    // White (no antTarget) — reassign ANT-dependent scenarios
    if (g.target.antTarget == null && ANT_DEPENDENT_SCENARIOS.has(scenario)) {
      scenario = 'eta-media';
    }
    // Red (no phTarget) — reassign pH-dependent scenarios
    if (g.target.phTarget == null && PH_DEPENDENT_SCENARIOS.has(scenario)) {
      scenario = 'eta-media';
    }
    const p = scenarioParams(scenario, g.target, r);
    if (!p) continue;
    const yy = String(currentYear).slice(2);
    const isWhite = g.target.phTarget != null && g.target.antTarget == null;
    for (let i = 0; i < offsets.length; i++) {
      const t = offsets[i];
      const seq = i + 1;
      const dateObj = new Date(today.getTime() + t * dayMs);
      const sampleDate = dateObj.toISOString().slice(0, 10);
      const brix = p.yBrix + p.bBrix * t + (r() - 0.5) * 0.2;
      const ant  = p.yAnt != null
        ? Math.max(0, p.yAnt + p.bAnt * t + (r() - 0.5) * 60)
        : null;
      const pH = isWhite && p.yPh != null
        ? Math.max(2.5, Math.min(4.5, p.yPh + p.bPh * t + (r() - 0.5) * 0.02))
        : 3.5 + (r() - 0.5) * 0.3;
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
        ta: 5 + (r() - 0.5) * 1.5,
        tANT: ant != null ? Math.round(ant) : null,
        berryFW: 1.0 + (r() - 0.5) * 0.2,
        anthocyanins: ant != null ? Math.round(ant) : null,
        daysPostCrush: 38 + t,
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

function generateHistoricalSeason(VINTAGE, r) {
  const berry = [];
  const mediciones = [];
  const receptions = [];
  const receptionLots = [];
  const wine = [];
  const preferment = [];

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
    // Kompali sections keep their S prefix in sectionLabel, so "KCS-S2B" works.
    const lotCode = `${prefix}${ranchCode}-${suffix}`;
    const sampleId = `${String(VINTAGE).slice(2)}${lotCode}-1`;

    const target = pickGradeTarget(r);
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
    const tons = 5 + Math.round(r() * 40);

    // Three time-series points (≈days post-envero 18, 28, 38) so the evolution
    // charts render actual curves. The 38-day point carries the final (A+/A/B/C)
    // chemistry; earlier points interpolate back to lower brix + higher ta.
    const dpcPoints = [
      { dpc: 18, sampleDate: `${VINTAGE}-07-${String(20 + Math.floor(r()*5)).padStart(2,'0')}`, seq: 1, k: 0.4 },
      { dpc: 28, sampleDate: `${VINTAGE}-08-${String(5 + Math.floor(r()*5)).padStart(2,'0')}`,  seq: 2, k: 0.7 },
      { dpc: 38, sampleDate: `${VINTAGE}-08-${String(18 + Math.floor(r()*5)).padStart(2,'0')}`, seq: 3, k: 1.0 }
    ];
    // Matures linearly toward the target chemistry: k=1 uses vals, k<1 uses a
    // plausible green-fruit baseline scaled toward vals.
    const baseBrix = 16, baseTa = 12, baseTant = 250, basePH = 2.9, baseFW = 0.7;
    const latestRow = {
      sampleId,
      sampleDate: dpcPoints[2].sampleDate,
      vintage: VINTAGE,
      variety,
      appellation,
      sampleType: 'Berries',
      lotCode,
      brix: vals.brix,
      pH: vals.pH,
      ta: vals.ta,
      tANT: 500 + Math.round(r() * 1500),
      berryFW: vals.berryFW,
      anthocyanins: vals.anthocyanins ?? (400 + Math.round(r() * 800)),
      daysPostCrush: 38,
      sampleSeq: 3,
      grapeType: null
    };
    for (const pt of dpcPoints) {
      if (pt.seq === 3) { berry.push(latestRow); continue; }
      const k = pt.k;
      berry.push({
        sampleId: `${String(VINTAGE).slice(2)}${lotCode}-${pt.seq}`,
        sampleDate: pt.sampleDate,
        vintage: VINTAGE,
        variety,
        appellation,
        sampleType: 'Berries',
        lotCode,
        brix:    baseBrix + k * (vals.brix - baseBrix),
        pH:      basePH   + k * (vals.pH   - basePH),
        ta:      baseTa   + k * (vals.ta   - baseTa),
        tANT:    Math.round(baseTant + k * (latestRow.tANT - baseTant)),
        berryFW: baseFW   + k * (vals.berryFW - baseFW),
        anthocyanins: Math.round(100 + k * (latestRow.anthocyanins - 100)),
        daysPostCrush: pt.dpc,
        sampleSeq: pt.seq,
        grapeType: null
      });
    }
    const berryRow = latestRow;  // used below for dates/references

    mediciones.push({
      id: mediciones.length + 1,
      code: `M-DEMO-${mediciones.length + 1}`,
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

    // Tank reception carries av / ag / polyphenols
    const rid = receptionId++;
    receptions.push({
      id: rid,
      report_code: `RC-DEMO-${rid}`,
      reception_date: berryRow.sampleDate,
      batch_code: `${String(VINTAGE).slice(2)}${lotCode}-T${rid}`,
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
      reception_id: rid,
      lot_code: lotCode,
      lot_position: 1
    });

    // Wine reception row — some downstream views (tables, explorer) read it
    wine.push({
      codigoBodega: `${String(VINTAGE).slice(2)}${lotCode}-W`,
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
