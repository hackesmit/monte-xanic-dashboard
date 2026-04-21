// tests/mt11-classification.test.mjs
// MT.11 — Quality classification engine: thresholds, scoring, percentile.
// Engine lives in js/classification.js (pure functions, no DOM, no queries).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreParam,
  scoreLot,
  scoreAll,
  resolveRubric,
  resolveValley,
  aggregateSection
} from '../js/classification.js';

// ── Helpers ──────────────────────────────────────────────────────────
const mkLot = (o = {}) => ({
  lotCode: o.lotCode ?? 'TEST-1',
  vintage: o.vintage ?? 2025,
  variety: o.variety ?? 'Cabernet Sauvignon',
  appellation: o.appellation ?? 'Valle de Ojos Negros',
  brix: 23.8, pH: 3.60, ta: 6.0, av: 0.0, ag: 0.02,
  berryFW: 1.0, polyphenols: 2000, anthocyanins: 1000,
  medicion: { health_grade: 'Excelente', health_madura: 100, health_inmadura: 0,
              health_sobremadura: 0, health_picadura: 0, health_enfermedad: 0,
              health_quemadura: 0, tons_received: 5, phenolic_maturity: null },
  ...o
});

// ── Valley resolution ────────────────────────────────────────────────
test('MT.11 resolveValley: VON appellation', () => {
  assert.equal(resolveValley('Valle de Ojos Negros'), 'Valle de Ojos Negros');
});
test('MT.11 resolveValley: VDG abbreviation', () => {
  assert.equal(resolveValley('Monte Xanic VDG'), 'Valle de Guadalupe');
});
test('MT.11 resolveValley: VSV abbreviation', () => {
  assert.equal(resolveValley('Dominio VSV SPOT'), 'Valle de San Vicente');
});
test('MT.11 resolveValley: unknown returns null', () => {
  assert.equal(resolveValley('Napa Valley'), null);
});
test('MT.11 resolveValley: null appellation', () => {
  assert.equal(resolveValley(null), null);
});

// ── Rubric resolution ────────────────────────────────────────────────
test('MT.11 resolveRubric: CS in VON → CS-SY-MAL-MRS-TEM-VON', () => {
  const r = resolveRubric('Cabernet Sauvignon', 'Valle de Ojos Negros');
  assert.equal(r?.id, 'CS-SY-MAL-MRS-TEM-VON');
});
test('MT.11 resolveRubric: CS in VDG → CS-SY-VDG (different thresholds)', () => {
  const r = resolveRubric('Cabernet Sauvignon', 'Valle de Guadalupe');
  assert.equal(r?.id, 'CS-SY-VDG');
});
test('MT.11 resolveRubric: unknown variety → null', () => {
  assert.equal(resolveRubric('Nebbiolo', 'Valle de Ojos Negros'), null);
});

// ── scoreParam — threshold bucketing ────────────────────────────────
test('MT.11 scoreParam le-a-le-b: pH=3.60 → A (≤3.67)', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, 3.60), 3);
});
test('MT.11 scoreParam le-a-le-b: pH=3.68 → B (boundary)', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, 3.68), 2);
});
test('MT.11 scoreParam le-a-le-b: pH=3.81 → C', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, 3.81), 1);
});
test('MT.11 scoreParam le-a-le-b: pH=3.67 exact → A (inclusive)', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, 3.67), 3);
});
test('MT.11 scoreParam ge-a-ge-b: ta=6.0 → A (≥5.85)', () => {
  assert.equal(scoreParam({ kind: 'ge-a-ge-b', a: 5.85, b: 5.40 }, 6.0), 3);
});
test('MT.11 scoreParam ge-a-ge-b: ta=5.60 → B', () => {
  assert.equal(scoreParam({ kind: 'ge-a-ge-b', a: 5.85, b: 5.40 }, 5.60), 2);
});
test('MT.11 scoreParam ge-a-ge-b: ta=5.39 → C', () => {
  assert.equal(scoreParam({ kind: 'ge-a-ge-b', a: 5.85, b: 5.40 }, 5.39), 1);
});
test('MT.11 scoreParam range: brix 23.7 → A (within A range)', () => {
  const p = { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]] };
  assert.equal(scoreParam(p, 23.7), 3);
});
test('MT.11 scoreParam range: brix 23.0 → B (within lower B range)', () => {
  const p = { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]] };
  assert.equal(scoreParam(p, 23.0), 2);
});
test('MT.11 scoreParam range: brix 25.0 → B (within upper B range)', () => {
  const p = { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]] };
  assert.equal(scoreParam(p, 25.0), 2);
});
test('MT.11 scoreParam range: brix 26.0 → C (outside all ranges)', () => {
  const p = { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]] };
  assert.equal(scoreParam(p, 26.0), 1);
});
test('MT.11 scoreParam: null value → null (drop from scoring)', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, null), null);
});

// ── scoreLot — end-to-end ────────────────────────────────────────────
test('MT.11 scoreLot: perfect reds → A+ 36', () => {
  const lot = mkLot({ brix: 23.7, pH: 3.60, ta: 6.0, av: 0.0, ag: 0.02,
                      berryFW: 1.0, polyphenols: 2100, anthocyanins: 1000 });
  const r = scoreLot(lot);
  assert.equal(r.grade, 'A+');
  assert.equal(r.score36, 36);
  assert.equal(r.rubricId, 'CS-SY-MAL-MRS-TEM-VON');
});

test('MT.11 scoreLot: all-C reds → C 12', () => {
  const lot = mkLot({ brix: 26, pH: 3.90, ta: 5.0, av: 0.10, ag: 0.20,
                      berryFW: 0.5, polyphenols: 500, anthocyanins: 200,
                      medicion: { ...mkLot().medicion, health_grade: 'Malo',
                                  health_picadura: 10, health_madura: 90 } });
  const r = scoreLot(lot);
  assert.equal(r.grade, 'C');
  assert.equal(r.score36, 12);
});

test('MT.11 scoreLot: madurez Sobresaliente adds +3', () => {
  // Push both phenolics into the B bucket so base36 ≈ 30.7; +3 → 33.7 (no clamp).
  const lot = mkLot({ brix: 23.0, pH: 3.60, ta: 6.0, av: 0.0, ag: 0.02,
                      berryFW: 1.0, polyphenols: 1800, anthocyanins: 700 });
  const without = scoreLot({ ...lot, medicion: { ...lot.medicion, phenolic_maturity: null } });
  const with_ = scoreLot({ ...lot, medicion: { ...lot.medicion, phenolic_maturity: 'Sobresaliente' } });
  assert.ok(without.score36 < 33, `base must be <33 to avoid clamp (got ${without.score36})`);
  assert.equal(with_.score36 - without.score36, 3);
});

test('MT.11 scoreLot: madurez No sobresaliente subtracts 3, clamps at 0', () => {
  // Full all-C lot (including Malo medicion) so base36 == 12; -3 → 9.
  const lot = mkLot({ brix: 26, pH: 3.90, ta: 5.0, av: 0.10, ag: 0.20,
                      berryFW: 0.5, polyphenols: 500, anthocyanins: 200,
                      medicion: { ...mkLot().medicion, health_grade: 'Malo',
                                  health_picadura: 10, health_madura: 90,
                                  phenolic_maturity: 'No sobresaliente' } });
  const r = scoreLot(lot);
  assert.equal(r.score36, 9); // 12 base - 3 = 9
  assert.equal(r.grade, 'C');
});

test('MT.11 scoreLot: unknown variety/valley → null rubric', () => {
  const lot = mkLot({ variety: 'Nebbiolo', appellation: 'Napa Valley' });
  const r = scoreLot(lot);
  assert.equal(r.grade, null);
  assert.equal(r.score36, null);
  assert.equal(r.reason, 'Sin rúbrica');
});

test('MT.11 scoreLot: partial data (3 params missing) still scores', () => {
  // Drop berryFW (5) + ag (13) + av (13) = 31 Imp; remaining still ≥ 60.
  const lot = mkLot({ berryFW: null, ag: null, av: null });
  const r = scoreLot(lot);
  assert.ok(r.grade); // still scores
  assert.ok(r.missing.includes('berryFW'));
  assert.ok(r.missing.includes('ag'));
  assert.ok(r.missing.includes('av'));
});

test('MT.11 scoreLot: too little data (< 60 Imp) → null', () => {
  const lot = mkLot({
    brix: null, pH: null, ta: null, av: null, ag: null,
    polyphenols: null, anthocyanins: null,
    medicion: null
  });
  // Only berryFW (imp=5) remains → 5 < 60 → unscorable
  const r = scoreLot(lot);
  assert.equal(r.grade, null);
  assert.equal(r.reason, 'Datos insuficientes');
});

test('MT.11 scoreLot: peso override applies to Tempranillo', () => {
  const lot = mkLot({ variety: 'Tempranillo', berryFW: 1.4 });
  const r = scoreLot(lot);
  assert.ok(r.score36 > 30); // stays near A+ because 1.4 is A under the override
});

test('MT.11 scoreLot: peso override applies to Syrah in VDG', () => {
  const lot = mkLot({
    variety: 'Syrah', appellation: 'Valle de Guadalupe',
    berryFW: 1.3, brix: 24.0, pH: 3.55, ta: 6.0, av: 0.0, ag: 0.02,
    polyphenols: 2100, anthocyanins: 800
  });
  const r = scoreLot(lot);
  assert.equal(r.rubricId, 'CS-SY-VDG');
  assert.ok(r.score36 >= 30); // should stay A+
});

test('MT.11 scoreLot: sanitary conteo=1% → B bucket', () => {
  const lot = mkLot({
    medicion: { ...mkLot().medicion,
                health_madura: 99, health_picadura: 1 } // 1% unhealthy
  });
  const r = scoreLot(lot);
  assert.equal(r.grade, 'A+');
  assert.ok(r.score36 < 36);
});

test('MT.11 scoreLot: sanitary conteo=5% → C bucket, knocks grade', () => {
  const lot = mkLot({
    brix: 23.0, pH: 3.70, ta: 5.60, av: 0.02, ag: 0.05,
    berryFW: 1.15, polyphenols: 1700, anthocyanins: 800,
    medicion: { ...mkLot().medicion,
                health_madura: 95, health_enfermedad: 5 } // 5% unhealthy
  });
  const r = scoreLot(lot);
  assert.ok(['A', 'B'].includes(r.grade));
});

test('MT.11 scoreLot: visual Regular → B pts for visual param', () => {
  const lot = mkLot({
    medicion: { ...mkLot().medicion, health_grade: 'Regular' }
  });
  const r = scoreLot(lot);
  assert.equal(r.grade, 'A+');
  assert.equal(r.score36.toFixed(1), '35.8');
});

test('MT.11 scoreLot: visual Malo → C pts for visual param', () => {
  const lot = mkLot({
    medicion: { ...mkLot().medicion, health_grade: 'Malo' }
  });
  const r = scoreLot(lot);
  assert.equal(r.grade, 'A+');
});

test('MT.11 scoreLot: medicion null → sanitary params dropped, not fail', () => {
  const lot = mkLot({ medicion: null });
  const r = scoreLot(lot);
  assert.ok(r.grade !== null);
  assert.ok(r.missing.includes('sanitary_pct'));
  assert.ok(r.missing.includes('visual'));
});

test('MT.11 scoreLot: white rubric (SB) normalizes correctly', () => {
  const lot = mkLot({
    variety: 'Sauvignon Blanc', appellation: 'Valle de Ojos Negros',
    brix: 22.0, pH: 3.15, ta: 7.0, av: 0.0, ag: 0.02, berryFW: 1.2,
    polyphenols: null, anthocyanins: null
  });
  const r = scoreLot(lot);
  assert.equal(r.rubricId, 'SB-VDG-VON');
  assert.equal(r.grade, 'A+');
});

// ── Percentile + aggregate ───────────────────────────────────────────
test('MT.11 scoreAll: percentile within same-variety same-vintage cohort', () => {
  // Use pH (le-a-le-b, monotonic) so three distinct values produce three distinct scores.
  const lots = [
    { ...mkLot({ lotCode: 'a' }), pH: 3.60 },  // A (≤3.67) → 3pts
    { ...mkLot({ lotCode: 'b' }), pH: 3.75 },  // B (≤3.80) → 2pts
    { ...mkLot({ lotCode: 'c' }), pH: 3.90 }   // C (>3.80) → 1pt
  ];
  const scored = scoreAll(lots, { cohort: 'vintage-variety' });
  const byCode = Object.fromEntries(scored.map(s => [s.lotCode, s]));
  assert.ok(byCode.a.percentile > byCode.b.percentile);
  assert.ok(byCode.b.percentile > byCode.c.percentile);
  assert.equal(byCode.a.percentile, 100); // top of cohort
});

test('MT.11 scoreAll: tied scores share higher percentile', () => {
  const lots = [
    { ...mkLot({ lotCode: 'a' }) },
    { ...mkLot({ lotCode: 'b' }) } // identical
  ];
  const scored = scoreAll(lots, { cohort: 'vintage-variety' });
  assert.equal(scored[0].percentile, scored[1].percentile);
});

test('MT.11 aggregateSection: tonnage-weighted average', () => {
  const lots = [
    { lotCode: 'a', score36: 30, grade: 'A+', tons: 10 },
    { lotCode: 'b', score36: 24, grade: 'B',  tons: 10 }
  ];
  const agg = aggregateSection(lots);
  assert.equal(agg.score36, 27);    // weighted avg
  assert.equal(agg.grade, 'A');     // 27 is the A bucket floor
  assert.equal(agg.lotCount, 2);
});

test('MT.11 aggregateSection: missing tons defaults to weight 1', () => {
  const lots = [
    { lotCode: 'a', score36: 30, grade: 'A+', tons: null },
    { lotCode: 'b', score36: 24, grade: 'B',  tons: null }
  ];
  const agg = aggregateSection(lots);
  assert.equal(agg.score36, 27);
});

test('MT.11 aggregateSection: all-null lots → grade null', () => {
  const lots = [
    { lotCode: 'a', score36: null, grade: null, tons: 10 },
    { lotCode: 'b', score36: null, grade: null, tons: 5 }
  ];
  const agg = aggregateSection(lots);
  assert.equal(agg.grade, null);
  assert.equal(agg.score36, null);
});

test('MT.11 aggregateSection: null lots excluded from numerator and denominator', () => {
  const lots = [
    { lotCode: 'a', score36: 32, grade: 'A+', tons: 10 },
    { lotCode: 'b', score36: null, grade: null, tons: 10 }
  ];
  const agg = aggregateSection(lots);
  assert.equal(agg.score36, 32); // only lot a counts
  assert.equal(agg.grade, 'A+');
});
