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
      loadMediciones:   DataStore.loadMediciones
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
  const VINTAGE = 2025;
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
