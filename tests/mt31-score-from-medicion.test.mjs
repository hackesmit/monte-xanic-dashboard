// tests/mt31-score-from-medicion.test.mjs
// MT.31 — scoreFromMedicion: resolve berry by (lotCode, vintage), graft
// snake-cased medicion fields, delegate to scoreLot.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreFromMedicion, scoreLot } from '../js/classification.js';

function mkBerry(o = {}) {
  return {
    lotCode: 'CS-TEST-1',
    vintage: 2026,
    variety: 'Cabernet Sauvignon',
    appellation: 'Valle de Ojos Negros',
    brix: 24.5, pH: 3.55, ta: 5.5,
    tANT: 1200, berryFW: 1.0,
    av: 0.20, ag: 0.30,
    polyphenols: 2500, anthocyanins: 1200,
    medicion: null,
    ...o
  };
}

function mkMedicion(o = {}) {
  return {
    lotCode: 'CS-TEST-1',
    vintage: 2026,
    variety: 'Cabernet Sauvignon',
    appellation: 'Valle de Ojos Negros',
    tons: 8,
    healthGrade: 'Excelente',
    healthMadura: 95, healthInmadura: 2, healthSobremadura: 1,
    healthPicadura: 1, healthEnfermedad: 0, healthQuemadura: 1,
    phenolicMaturity: 'Sobresaliente',
    ...o
  };
}

// Chemistry a medicion carries in its own right. mediciones_tecnicas stores
// every rubric axis, so _rowToMedicion hands these over on every real row.
function mkChemistry(o = {}) {
  return {
    brix: 24.5, pH: 3.55, ta: 5.5,
    av: 0.02, ag: 0.01, berryWeight: 1.0,
    polyphenols: 2500, anthocyanins: 1200,
    ...o
  };
}

test('MT.31 scoreFromMedicion: an index miss no longer blocks the grade', () => {
  // Was 'Sin berry'. A medicion carrying its own chemistry is gradeable on its
  // own: this is the whole point of the change. 223 of the 236 ungraded
  // mediciones in the 2026-09-15 production snapshot failed exactly here.
  const med = mkMedicion(mkChemistry());
  const result = scoreFromMedicion(med, new Map());
  assert.ok(result.grade, `expected a grade, got ${result.grade} (${result.reason})`);
  assert.equal(result.reason, null);
  assert.ok(result.score36 > 0);
});

test('MT.31 scoreFromMedicion: a null index no longer blocks the grade', () => {
  const med = mkMedicion(mkChemistry());
  const result = scoreFromMedicion(med, null);
  assert.ok(result.grade, `expected a grade, got ${result.grade} (${result.reason})`);
});

test('MT.31 scoreFromMedicion: without chemistry and without a berry it is Datos insuficientes', () => {
  // The rubric resolves (variety + valley are known), so the honest reason is
  // that the readings are missing, not that a berry is. A form-entered medicion
  // with no lab analysis lands here.
  const med = mkMedicion();
  const result = scoreFromMedicion(med, new Map());
  assert.equal(result.grade, null);
  assert.equal(result.reason, 'Datos insuficientes');
  assert.ok(result.missing.includes('brix'), 'brix should be reported missing');
  assert.ok(result.missing.includes('pH'));
  assert.ok(result.missing.includes('ta'));
});

test('MT.31 scoreFromMedicion: null medicion reports Sin medición', () => {
  const result = scoreFromMedicion(null, new Map());
  assert.equal(result.grade, null);
  assert.equal(result.reason, 'Sin medición');
});

test('MT.31 scoreFromMedicion: the medicion chemistry wins over the berry it matched', () => {
  // The lab analysis on the reception-day sheet is the rubric's own Resultado
  // column. A berry sampled days earlier must not override it.
  const berry = mkBerry({ brix: 19.0 });         // would bucket 1 for this rubric
  const med   = mkMedicion(mkChemistry({ brix: 24.0 }));  // buckets 3
  const byLot = new Map([[`${berry.lotCode}||${berry.vintage}`, berry]]);
  const withBerry = scoreFromMedicion(med, byLot);
  const without   = scoreFromMedicion(med, new Map());
  assert.equal(withBerry.buckets.brix, 3, 'medicion brix should pick the bucket');
  assert.equal(withBerry.buckets.brix, without.buckets.brix);
});

test('MT.31 scoreFromMedicion: the berry fills only the axes the medicion lacks', () => {
  // polifenoles is populated on 1 of 287 production mediciones; the berry
  // carries it averaged in from tank_receptions, so the join still earns its
  // keep. It must fill the gap without displacing anything the medicion has.
  const berry = mkBerry({ polyphenols: 2600, brix: 19.0 });
  const med   = mkMedicion(mkChemistry({ polyphenols: null, brix: 24.0 }));
  const byLot = new Map([[`${berry.lotCode}||${berry.vintage}`, berry]]);
  const r = scoreFromMedicion(med, byLot);
  assert.ok('polyphenols' in r.buckets, 'berry polyphenols should fill the gap');
  assert.ok(!r.missing.includes('polyphenols'));
  assert.equal(r.buckets.brix, 3, 'medicion brix still wins');
});

test('MT.31 scoreFromMedicion: a real 0.00 reading is not treated as a gap', () => {
  // AV and AG read 0.00 on most real rows and 0 is the BEST bucket in every
  // rubric. A truthiness test would call that absent and let the berry's worse
  // value overwrite it, silently downgrading the lot.
  const berry = mkBerry({ av: 0.9, ag: 0.9 });   // both would bucket 1
  const med   = mkMedicion(mkChemistry({ av: 0, ag: 0 }));
  const byLot = new Map([[`${berry.lotCode}||${berry.vintage}`, berry]]);
  const r = scoreFromMedicion(med, byLot);
  assert.equal(r.buckets.av, 3, 'av 0.00 is the best bucket');
  assert.equal(r.buckets.ag, 3, 'ag 0.00 is the best bucket');
});

test('MT.31 scoreFromMedicion: a multilot code resolves its berry like the map does', () => {
  // joinBerryWithMediciones expands 'SBVDG-2A/2B' from the index side, so the
  // calidad map joined these while this table said Sin berry (xd-5en.9).
  const berry = mkBerry({ lotCode: 'GREVA-3A', polyphenols: 2600 });
  const med   = mkMedicion({ lotCode: 'GREVA-3A,4A', ...mkChemistry({ polyphenols: null }) });
  const byLot = new Map([[`GREVA-3A||2026`, berry]]);
  const r = scoreFromMedicion(med, byLot);
  assert.ok('polyphenols' in r.buckets,
    'the expanded lot code should have found the berry and filled polyphenols');
});

test('MT.31 scoreFromMedicion: the verbatim lot code still wins over an expansion', () => {
  const exact    = mkBerry({ lotCode: 'GREVA-3A,4A', polyphenols: 2600 });
  const expanded = mkBerry({ lotCode: 'GREVA-3A',    polyphenols: 100 });
  const med   = mkMedicion({ lotCode: 'GREVA-3A,4A', ...mkChemistry({ polyphenols: null }) });
  const byLot = new Map([
    [`GREVA-3A,4A||2026`, exact],
    [`GREVA-3A||2026`, expanded],
  ]);
  const r = scoreFromMedicion(med, byLot);
  assert.equal(r.buckets.polyphenols, 3, 'the exact match (2600) should have been used');
});

test('MT.31 scoreFromMedicion: whites never score antocianos, present or not', () => {
  // The rubric sheets for SB and CH-CB-SBGR have no Polifenoles and no
  // Antocianos row at all, which is why the workbook prints NA for whites.
  // Pinned here so a future rubric edit cannot quietly start scoring it.
  const med = mkMedicion({
    variety: 'Sauvignon Blanc',
    appellation: 'Valle de Guadalupe',
    ...mkChemistry({ brix: 21.0, pH: 3.15, ta: 6.8, berryWeight: 1.2, anthocyanins: 1400 })
  });
  const r = scoreFromMedicion(med, new Map());
  assert.ok(r.grade, `expected a grade, got ${r.grade} (${r.reason})`);
  assert.ok(!('anthocyanins' in r.buckets), 'antocianos must not score for a white');
  assert.ok(!('polyphenols' in r.buckets), 'polifenoles must not score for a white');
  assert.ok(!r.missing.includes('anthocyanins'),
    'antocianos is not an axis for whites, so it is not missing either');
});

test('MT.31 scoreFromMedicion: a white grades on its own chemistry alone', () => {
  // The case that motivated the change. WineXRay is a phenolics instrument and
  // whites are largely not sampled, so whites almost never have a berry row.
  const med = mkMedicion({
    variety: 'Chardonnay',
    appellation: 'Valle de Ojos Negros',
    ...mkChemistry({ brix: 23.0, pH: 3.30, ta: 6.9, berryWeight: 1.45,
                     polyphenols: null, anthocyanins: null })
  });
  const r = scoreFromMedicion(med, new Map());
  assert.ok(r.grade, `expected a grade, got ${r.grade} (${r.reason})`);
  assert.equal(r.partial, false,
    'a white with its full rubric present is not a partial grade');
});

test('MT.31 scoreFromMedicion: matches scoreLot grade when berry has all chemistry', () => {
  const berry = mkBerry();
  const med = mkMedicion();
  const berryByLot = new Map([[`${berry.lotCode}||${berry.vintage}`, berry]]);

  // Build the snake-cased medicion the way joinBerryWithMediciones would,
  // attach it to a clone of berry, and compare with what scoreFromMedicion
  // produces. They should yield identical grades.
  const berryWithMed = {
    ...berry,
    medicion: {
      health_grade: med.healthGrade,
      health_madura: med.healthMadura,
      health_inmadura: med.healthInmadura,
      health_sobremadura: med.healthSobremadura,
      health_picadura: med.healthPicadura,
      health_enfermedad: med.healthEnfermedad,
      health_quemadura: med.healthQuemadura,
      tons_received: med.tons,
      phenolic_maturity: med.phenolicMaturity
    }
  };
  const expected = scoreLot(berryWithMed);
  const actual = scoreFromMedicion(med, berryByLot);

  assert.equal(actual.grade, expected.grade,
    `scoreFromMedicion grade ${actual.grade} differs from scoreLot ${expected.grade}`);
  assert.equal(actual.score36, expected.score36);
  assert.equal(actual.rubricId, expected.rubricId);
});

test('MT.31 scoreFromMedicion: returns null grade when variety unrecognized', () => {
  const berry = mkBerry({ variety: 'Unknown Grape', appellation: 'Valle de Ojos Negros' });
  const med   = mkMedicion({ variety: 'Unknown Grape' });
  const berryByLot = new Map([[`${med.lotCode}||${med.vintage}`, berry]]);
  const result = scoreFromMedicion(med, berryByLot);
  assert.equal(result.grade, null);
  assert.equal(result.reason, 'Sin rúbrica');
});

test('MT.31 scoreFromMedicion: a medicion with no lotCode still grades on its own chemistry', () => {
  // The lot code only ever existed to find a berry. With the medicion as the
  // primary source, not having one costs the berry-filled axes, not the grade.
  const med = mkMedicion({ lotCode: null, ...mkChemistry() });
  const berryByLot = new Map([[`CS-TEST-1||2026`, mkBerry()]]);
  const result = scoreFromMedicion(med, berryByLot);
  assert.ok(result.grade, `expected a grade, got ${result.grade} (${result.reason})`);
});

test('MT.31 scoreFromMedicion: a medicion with no vintage still grades on its own chemistry', () => {
  const med = mkMedicion({ vintage: null, ...mkChemistry() });
  const berryByLot = new Map([[`CS-TEST-1||2026`, mkBerry()]]);
  const result = scoreFromMedicion(med, berryByLot);
  assert.ok(result.grade, `expected a grade, got ${result.grade} (${result.reason})`);
});

test('MT.31 scoreFromMedicion: no lotCode means no berry, not the wrong berry', () => {
  // A blank lot code must not fall through to some arbitrary berry in the index.
  const berry = mkBerry({ polyphenols: 2600 });
  const med   = mkMedicion({ lotCode: null, ...mkChemistry({ polyphenols: null }) });
  const byLot = new Map([[`${berry.lotCode}||${berry.vintage}`, berry]]);
  const r = scoreFromMedicion(med, byLot);
  assert.ok(r.missing.includes('polyphenols'),
    'no lot code means the berry must not be consulted');
});
