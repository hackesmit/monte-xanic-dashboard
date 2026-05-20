// tests/mt24-prediction-resolve.test.mjs
// MT.24 — Target resolution + computeOne orchestration tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget } from '../js/prediction.js';

// Stub rubric matching js/config.js structure
const RUBRIC_CS_VON = {
  params: {
    brix:         { kind: 'range', a: [23.5, 24.2] },
    anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
  },
};
const RUBRIC_SB_VDG = {
  params: {
    brix:         { kind: 'range', a: [19.0, 23.0] },
    // no anthocyanins entry → whites
  },
};

test('MT.24 resolveTarget: no override → midpoint, lower, upper, ant from rubric', () => {
  const t = resolveTarget({ rubric: RUBRIC_CS_VON, override: null });
  assert.ok(Math.abs(t.brixTarget - 23.85) < 1e-9);
  assert.equal(t.brixLower, 23.5);
  assert.equal(t.brixUpper, 24.2);
  assert.equal(t.antTarget, 950);
});

test('MT.24 resolveTarget: full override wins', () => {
  const t = resolveTarget({
    rubric: RUBRIC_CS_VON,
    override: { brix_target: 23.6, brix_target_lower: 23.0, brix_upper: 24.0,
                anthocyanin_target: 900 },
  });
  assert.equal(t.brixTarget, 23.6);
  assert.equal(t.brixLower, 23.0);
  assert.equal(t.brixUpper, 24.0);
  assert.equal(t.antTarget, 900);
});

test('MT.24 resolveTarget: partial override (only ANT) → others from rubric', () => {
  const t = resolveTarget({
    rubric: RUBRIC_CS_VON,
    override: { brix_target: null, brix_target_lower: null, brix_upper: null,
                anthocyanin_target: 1100 },
  });
  assert.ok(Math.abs(t.brixTarget - 23.85) < 1e-9);
  assert.equal(t.antTarget, 1100);
});

test('MT.24 resolveTarget: white rubric without anthocyanins → antTarget null', () => {
  const t = resolveTarget({ rubric: RUBRIC_SB_VDG, override: null });
  assert.equal(t.antTarget, null);
});

import { computeOne } from '../js/prediction.js';

// Build a realistic season-to-date Brix + ANT sequence
const mkSeries = (slopeBrix, slopeAnt, n, lastT = 25) => ({
  current: Array.from({ length: n }, (_, i) => {
    const t = i * (lastT / (n - 1));
    return {
      sampleDate: `2026-08-${String(1 + i).padStart(2, '0')}`,
      tDays: t,
      brix: 19 + slopeBrix * t,
      ant:  600 + slopeAnt * t,
    };
  }),
  historicalByVintage: [
    // 3 prior vintages, each with ~8 samples in the last 21 days, slope ~slopeBrix
    Array.from({ length: 8 }, (_, i) => ({
      tDays: 60 + i * 3,
      brix: 20 + slopeBrix * (60 + i * 3 - 60),
      ant:  700 + slopeAnt * (60 + i * 3 - 60),
    })),
    Array.from({ length: 8 }, (_, i) => ({
      tDays: 60 + i * 3,
      brix: 19.5 + (slopeBrix * 0.95) * (60 + i * 3 - 60),
      ant:  680  + (slopeAnt  * 0.95) * (60 + i * 3 - 60),
    })),
    Array.from({ length: 8 }, (_, i) => ({
      tDays: 60 + i * 3,
      brix: 20.5 + (slopeBrix * 1.05) * (60 + i * 3 - 60),
      ant:  720  + (slopeAnt  * 1.05) * (60 + i * 3 - 60),
    })),
  ],
});

test('MT.24 computeOne: produces all expected fields when n_current=6 and V=3', () => {
  const { current, historicalByVintage } = mkSeries(0.14, 12, 6);
  const target = { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 };
  const today = new Date('2026-09-01');
  const out = computeOne({ current, historicalByVintage, target, today });
  assert.ok(out.recommendedDate instanceof Date);
  assert.ok(out.brixWindowCloses instanceof Date);
  assert.ok(Number.isFinite(out.bandDays));
  assert.ok(['Alta', 'Media', 'Baja'].includes(out.label));
  assert.equal(out.nCurrent, 6);
  assert.equal(out.V, 3);
  assert.equal(out.reason, null);
});

test('MT.24 computeOne: nCurrent<2 → reason=pocos-datos-temporada', () => {
  const out = computeOne({
    current: [{ sampleDate: '2026-08-01', tDays: 0, brix: 20, ant: 600 }],
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-01'),
  });
  assert.equal(out.reason, 'pocos-datos-temporada');
  assert.equal(out.recommendedDate, null);
});

test('MT.24 computeOne: ya-en-ventana when ŷ already in [lower,upper] and ANT≥target', () => {
  // Build a series where the latest is exactly in window and ANT comfortably over target.
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-09-${String(1 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 23.5 + 0.05 * i,    // ŷ_today ≈ 23.7 ⇒ in [23.5, 24.2]
    ant:  1000 + 5 * i,       // > 950
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-09-05'),
  });
  assert.equal(out.reason, 'ya-en-ventana');
});

test('MT.24 computeOne: β_post_brix ≤ 0 → sin-tendencia-positiva', () => {
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-08-${String(1 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 22 - 0.1 * i,        // declining
    ant:  700 + 5 * i,
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-05'),
  });
  assert.equal(out.reason, 'sin-tendencia-positiva');
});

test('MT.24 computeOne: V=0 caps label at Media even with strong current data', () => {
  const current = Array.from({ length: 8 }, (_, i) => ({
    sampleDate: `2026-08-${String(20 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 22 + 0.3 * i,        // strong upward
    ant:  800 + 30 * i,
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-27'),
  });
  assert.ok(out.label !== 'Alta', `label=${out.label} must not be Alta when V=0`);
});

test('MT.24 computeOne: β_post_ant ≤ 0 → antocianinas-estancadas', () => {
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-08-${String(1 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 21 + 0.4 * i,         // brix climbing fine
    ant:  900 - 5 * i,          // ANT declining
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-05'),
  });
  assert.equal(out.reason, 'antocianinas-estancadas');
});

test('MT.24 computeOne: ANT crosses target after Brix exits upper → no-alcanzar-A', () => {
  // Brix climbs fast (will exit upper soon); ANT climbs very slowly (won't
  // reach target before Brix is past 24.2).
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-08-${String(20 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 23.5 + 0.4 * i,       // ŷ_today ≈ 25.1 → already above upper
    ant:  650 + 5 * i,          // very slow ANT
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-24'),
  });
  assert.ok(['no-alcanzar-A', 'riesgo-sobremadurez'].includes(out.reason),
    `reason=${out.reason}`);
});

test('MT.24 computeOne: recommendedDate past brixWindowCloses → riesgo-sobremadurez', () => {
  // Brix climbs fast (closes window soon); ANT climbs slowly (recommended
  // date sits after window closes).
  const current = Array.from({ length: 5 }, (_, i) => ({
    sampleDate: `2026-08-${String(1 + i).padStart(2,'0')}`,
    tDays: i,
    brix: 22 + 0.3 * i,          // ŷ_today ≈ 23.2; closes ≈ 3.3 d later
    ant:  600 + 12 * i,          // ANT will need ~30 d to reach 950
  }));
  const out = computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.5, brixUpper: 24.2, brixTarget: 23.85, antTarget: 950 },
    today: new Date('2026-08-05'),
  });
  assert.ok(['riesgo-sobremadurez', 'no-alcanzar-A'].includes(out.reason),
    `reason=${out.reason}`);
});

import { computeAll } from '../js/prediction.js';

test('MT.24 computeAll: groups berry samples by (variety, appellation) and computes each', () => {
  const today = new Date('2026-09-01');
  const mkRow = (variety, appellation, vintage, dayOffset, brix, ant) => ({
    variety, appellation, vintage,
    sampleDate: new Date('2026-08-01').getTime() + dayOffset * 86_400_000,
    brix, tant: ant,
  });
  const berryData = [
    // CS Kompali current vintage (2026), 5 samples
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026,  0, 19.5, 600),
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026,  7, 20.5, 650),
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026, 14, 21.5, 720),
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026, 21, 22.5, 800),
    mkRow('Cabernet Sauvignon', 'Kompali (VON)', 2026, 28, 23.0, 870),
    // CS Kompali 2025 (historical), 8 samples in last 21 days
    ...Array.from({ length: 8 }, (_, i) => mkRow(
      'Cabernet Sauvignon', 'Kompali (VON)', 2025, 60 + i * 3, 20 + 0.1 * i * 3, 700 + 10 * i * 3,
    )),
  ];
  const rubricMap = {
    'Cabernet Sauvignon|Valle de Ojos Negros': {
      params: {
        brix: { kind: 'range', a: [23.5, 24.2] },
        anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
      },
    },
  };
  const valleyOf = appellation =>
    appellation.includes('VON') ? 'Valle de Ojos Negros'
      : appellation.includes('VDG') ? 'Valle de Guadalupe'
      : appellation.includes('VSV') ? 'Valle de San Vicente' : null;

  const result = computeAll({
    berryData, today, currentVintage: 2026,
    overrides: [],
    rubricFor: ({ variety, appellation }) =>
      rubricMap[`${variety}|${valleyOf(appellation)}`] ?? null,
    valleyFor: ({ appellation }) => valleyOf(appellation),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].variety, 'Cabernet Sauvignon');
  assert.equal(result[0].appellation, 'Kompali (VON)');
  assert.equal(result[0].prediction.nCurrent, 5);
  assert.equal(result[0].prediction.V, 1);
});

test('MT.24 computeAll: reads anthocyanins from production `tANT` field, not lowercase `tant`', () => {
  const today = new Date('2026-09-01');
  const t0 = new Date('2026-08-01').getTime();
  const dayMs = 86_400_000;
  // Use the PRODUCTION field name `tANT` (per CONFIG.supabaseToBerryJS in config.js)
  const berryData = [
    { variety: 'CS', appellation: 'X (VON)', vintage: 2026,
      sampleDate: t0,             brix: 19.0, tANT: 600 },
    { variety: 'CS', appellation: 'X (VON)', vintage: 2026,
      sampleDate: t0 + 14*dayMs,  brix: 21.0, tANT: 800 },
  ];
  const result = computeAll({
    berryData, today, currentVintage: 2026,
    overrides: [],
    rubricFor: () => ({ params: {
      brix:         { kind: 'range', a: [23.5, 24.2] },
      anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700 },
    }}),
    valleyFor: () => 'VON',
  });
  assert.equal(result.length, 1);
  const p = result[0].prediction;
  // antHoy is computed from this-season ANT fit; should be a finite number,
  // not NaN — proving the tANT field was read.
  assert.ok(Number.isFinite(p.antHoy),
    `antHoy=${p.antHoy} — production tANT field was not extracted`);
});
