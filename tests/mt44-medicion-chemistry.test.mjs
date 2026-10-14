// tests/mt44-medicion-chemistry.test.mjs
// MT.44 - _rowToMedicion lifts the lab chemistry mediciones_tecnicas already
// stores (brix, ph, at, ag, am, av, polifenoles, catequinas, antocianos) into
// the JS shape the scoring engine and the Mediciones table read.
//
// Before this, every chemistry column was parsed on upload, type-validated and
// stored, then dropped on read: _rowToMedicion mapped only identity, tonnage,
// physical measurements and the sanitary counts. The columns were invisible to
// the whole front end, which is why a medicion could not be graded without a
// matching WineXRay berry row even though it carried the full rubric itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DataStore } from '../js/dataLoader.js';

function mkRow(o = {}) {
  return {
    medicion_code: 'MT-26-001',
    medicion_date: '2026-09-01',
    vintage_year: 2026,
    variety: 'Cabernet Sauvignon',
    supplier: 'KMP',
    lot_code: 'KCS-S1',
    brix: 24.1,
    ph: 3.62,
    at: 6.1,
    ag: 0.02,
    am: 2.4,
    av: 0.01,
    polifenoles: 1980,
    catequinas: 210,
    antocianos: 1120,
    berry_avg_weight_g: 1.09,
    ...o
  };
}

test('MT.44 _rowToMedicion: maps every stored chemistry column to its JS name', () => {
  const m = DataStore._rowToMedicion(mkRow());
  assert.equal(m.brix, 24.1);
  assert.equal(m.pH, 3.62);
  assert.equal(m.ta, 6.1);          // 'at' on the sheet is titratable acidity
  assert.equal(m.ag, 0.02);
  assert.equal(m.am, 2.4);
  assert.equal(m.av, 0.01);
  assert.equal(m.polyphenols, 1980);
  assert.equal(m.catechins, 210);
  assert.equal(m.anthocyanins, 1120);
});

test('MT.44 _rowToMedicion: a genuine zero survives as 0, never as null', () => {
  // AG is 0.00 on most real rows. The tons_received mapping right above this
  // one uses a truthiness test (`row.tons_received ? parseFloat(..) : null`),
  // which turns a real 0 into a missing reading. A 0 g/L gluconic acid is the
  // BEST bucket in every rubric, so losing it costs the lot its cleanest axis.
  const m = DataStore._rowToMedicion(mkRow({ ag: 0, av: 0, brix: 0 }));
  assert.equal(m.ag, 0);
  assert.equal(m.av, 0);
  assert.equal(m.brix, 0);
});

test('MT.44 _rowToMedicion: absent and blank chemistry stays null, never 0', () => {
  // A fabricated 0 would score the best bucket on av/ag and the worst on
  // brix/anthocyanins. Absence has to reach scoreParam as null so the axis
  // lands in missing[] instead of inventing a reading.
  const m = DataStore._rowToMedicion(mkRow({
    av: null, polifenoles: undefined, antocianos: '', catequinas: null, am: null
  }));
  assert.equal(m.av, null);
  assert.equal(m.polyphenols, null);
  assert.equal(m.anthocyanins, null);
  assert.equal(m.catechins, null);
  assert.equal(m.am, null);
});

test('MT.44 _rowToMedicion: numeric strings from PostgREST coerce to numbers', () => {
  // Supabase returns `numeric` columns as strings. Left as strings they would
  // reach scoreParam, which calls Number() and would still work, but every
  // display path (toFixed) and every comparison would be on a string.
  const m = DataStore._rowToMedicion(mkRow({ brix: '24.10', ph: '3.62', at: '6.10', ag: '0.00' }));
  assert.equal(m.brix, 24.1);
  assert.equal(m.pH, 3.62);
  assert.equal(m.ta, 6.1);
  assert.equal(m.ag, 0);
});

test('MT.44 _rowToMedicion: non-numeric garbage rejects to null, not NaN', () => {
  // 'NA' is normalized away at upload, but a hand-edited row can carry text.
  // NaN would flow into scoreParam (which rejects it) and into toFixed (which
  // would render 'NaN' in the table), so reject it here.
  const m = DataStore._rowToMedicion(mkRow({ brix: 'NA', ph: 'pendiente', at: {}, ag: true }));
  assert.equal(m.brix, null);
  assert.equal(m.pH, null);
  assert.equal(m.ta, null);
  assert.equal(m.ag, null);
});

test('MT.44 _rowToMedicion: chemistry mapping leaves the existing fields alone', () => {
  const m = DataStore._rowToMedicion(mkRow({
    tons_received: 8.5,
    health_madura: 180, health_inmadura: 5, health_sobremadura: 3,
    health_picadura: 2, health_enfermedad: 1, health_quemadura: null,
    health_grade: 'Limpio', phenolic_maturity: 'Sobresaliente'
  }));
  assert.equal(m.code, 'MT-26-001');
  assert.equal(m.vintage, 2026);
  assert.equal(m.variety, 'Cabernet Sauvignon');
  assert.equal(m.tons, 8.5);
  assert.equal(m.berryWeight, 1.09);
  assert.equal(m.healthMadura, 180);
  assert.equal(m.healthQuemadura, null);
  assert.equal(m.healthGrade, 'Limpio');
  assert.equal(m.phenolicMaturity, 'Sobresaliente');
});

test('MT.44 _rowToMedicion: a row with no chemistry at all yields nulls, not undefined', () => {
  // Form-entered rows (source='form') carry no lab columns. Callers branch on
  // `=== null`, so undefined would slip past those guards.
  const bare = {
    medicion_code: 'MT-26-099', medicion_date: '2026-09-02', vintage_year: 2026,
    variety: 'Chardonnay', supplier: 'VDG', lot_code: 'CHMX-1'
  };
  const m = DataStore._rowToMedicion(bare);
  for (const f of ['brix', 'pH', 'ta', 'ag', 'am', 'av', 'polyphenols', 'catechins', 'anthocyanins']) {
    assert.equal(m[f], null, `${f} should be null on a row with no lab columns`);
  }
});
