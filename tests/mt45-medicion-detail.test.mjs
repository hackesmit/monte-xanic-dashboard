// tests/mt45-medicion-detail.test.mjs
// MT.45 - the Mediciones detail panel model: every physicochemical reading a
// medicion carries, grouped by the rubric sheet's own Criterio column, each
// with the bucket it earned.
//
// The load-bearing rule is the three-way distinction between a reading that
// scored, a reading the rubric wants and does not have, and an axis the rubric
// does not have at all. The third is the whites case: the SB and CH-CB-SBGR
// sheets have no Polifenoles and no Antocianos row, which is why the workbook
// prints NA against them. Showing a blank there would read as a gap somebody
// still has to fill.

import test from 'node:test';
import assert from 'node:assert/strict';
import { medicionDetail } from '../js/mediciones.js';
import { scoreFromMedicion, resolveRubric, rubricById, sanitaryDamagePct } from '../js/classification.js';

function mkMedicion(o = {}) {
  return {
    code: 'MT-26-001', vintage: 2026,
    variety: 'Cabernet Sauvignon', appellation: 'Valle de Ojos Negros',
    lotCode: 'KCS-S1', tons: 8,
    brix: 24.0, pH: 3.60, ta: 6.0, av: 0.01, ag: 0.0, am: 2.4,
    berryWeight: 1.0, polyphenols: 1950, anthocyanins: 1100,
    healthMadura: 190, healthInmadura: 4, healthSobremadura: 3,
    healthPicadura: 2, healthEnfermedad: 1, healthQuemadura: null,
    phenolicMaturity: 'Sobresaliente', evaluaciones: [],
    ...o
  };
}

// Build the model the way the renderer does, so the test exercises the real
// wiring rather than a hand-made score object.
function detailFor(m) {
  const score = scoreFromMedicion(m, new Map());
  const rubric = resolveRubric(m.variety, m.appellation);
  const pct = sanitaryDamagePct({
    health_madura: m.healthMadura, health_inmadura: m.healthInmadura,
    health_sobremadura: m.healthSobremadura, health_picadura: m.healthPicadura,
    health_enfermedad: m.healthEnfermedad, health_quemadura: m.healthQuemadura,
  });
  return { detail: medicionDetail(m, score, rubric, pct, null), score, rubric };
}

const axisNamed = (detail, label) =>
  detail.groups.flatMap(g => g.axes).find(a => a.label === label);

test('MT.45 detail: a red shows every physicochemical reading with its bucket', () => {
  const { detail } = detailFor(mkMedicion());
  const brix = axisNamed(detail, 'Grado Brix');
  assert.equal(brix.state, 'scored');
  assert.equal(brix.value, 24.0);
  assert.equal(brix.unit, 'Bx');
  assert.ok(['A', 'B', 'C'].includes(brix.bucket));
  for (const label of ['pH', 'Acidez total', 'Acidez volatil', 'Acido gluconico',
                       'Peso de baya', 'Polifenoles', 'Antocianos totales']) {
    assert.equal(axisNamed(detail, label).state, 'scored', `${label} should be scored for a red`);
  }
});

test('MT.45 detail: the groups follow the rubric sheet Criterio column', () => {
  const { detail } = detailFor(mkMedicion());
  assert.deepEqual(detail.groups.map(g => g.criterio),
    ['Fisicoquimico', 'Sanidad', 'Rendimiento', 'Fenolico']);
});

test('MT.45 detail: a white reads NA for polifenoles and antocianos', () => {
  // Not "missing". The rubric has no such axis, so there is nothing to fill.
  const m = mkMedicion({
    variety: 'Sauvignon Blanc', appellation: 'Valle de Guadalupe',
    brix: 21.0, pH: 3.15, ta: 6.8, berryWeight: 1.2,
  });
  const { detail } = detailFor(m);
  assert.equal(axisNamed(detail, 'Polifenoles').state, 'na');
  assert.equal(axisNamed(detail, 'Antocianos totales').state, 'na');
  assert.equal(axisNamed(detail, 'Polifenoles').bucket, null);
  assert.equal(axisNamed(detail, 'Antocianos totales').bucket, null);
});

test('MT.45 detail: a white reads NA even when a number was recorded', () => {
  // The rating must not count it, and the panel must not imply it did. A stray
  // anthocyanin figure on a white row is the workbook's NA, mis-keyed.
  const m = mkMedicion({
    variety: 'Chardonnay', appellation: 'Valle de Ojos Negros',
    brix: 23.0, pH: 3.30, ta: 6.9, berryWeight: 1.45,
    anthocyanins: 1400, polyphenols: 900,
  });
  const { detail, score } = detailFor(m);
  assert.equal(axisNamed(detail, 'Antocianos totales').state, 'na');
  assert.equal(axisNamed(detail, 'Polifenoles').state, 'na');
  assert.ok(!('anthocyanins' in score.buckets), 'the rating must not score it either');
  assert.ok(!('polyphenols' in score.buckets));
});

test('MT.45 detail: a red with no phenolics reads missing, not NA', () => {
  // The mirror of the whites case. For a red the rubric does want these two,
  // so their absence is a gap and has to look like one.
  const m = mkMedicion({ polyphenols: null, anthocyanins: null });
  const { detail } = detailFor(m);
  assert.equal(axisNamed(detail, 'Polifenoles').state, 'missing');
  assert.equal(axisNamed(detail, 'Antocianos totales').state, 'missing');
});

test('MT.45 detail: acido malico is shown but never scored', () => {
  // Measured on the sheet, in no rubric. It must not look like a gap.
  const { detail } = detailFor(mkMedicion());
  const am = axisNamed(detail, 'Acido malico');
  assert.equal(am.state, 'info');
  assert.equal(am.value, 2.4);
  assert.equal(am.bucket, null);
});

test('MT.45 detail: a real 0.00 reading is a value, not an absence', () => {
  const { detail } = detailFor(mkMedicion({ ag: 0 }));
  const ag = axisNamed(detail, 'Acido gluconico');
  assert.equal(ag.value, 0);
  assert.equal(ag.state, 'scored');
  assert.equal(ag.bucket, 'A', '0.00 g/L is the best bucket');
});

test('MT.45 detail: the sanitary count axis carries its percentage', () => {
  const { detail } = detailFor(mkMedicion());
  const s = axisNamed(detail, 'Estado sanitario (conteo)');
  assert.equal(s.state, 'scored');
  assert.ok(s.value > 0 && s.value < 100, `expected a percentage, got ${s.value}`);
  assert.equal(s.unit, '%');
});

test('MT.45 detail: an incomplete sanitary count reads missing', () => {
  // Partial counts used to be read as zeroes and score the cleanest bucket off
  // a total nobody counted. The panel has to show that as a gap.
  const { detail } = detailFor(mkMedicion({ healthPicadura: null }));
  assert.equal(axisNamed(detail, 'Estado sanitario (conteo)').state, 'missing');
});

test('MT.45 detail: without a rubric every axis is a plain reading and the reason carries', () => {
  // Nebbiolo is in no rubric. Nothing is applicable yet, so nothing should
  // read as NA (that is the whites rule) nor as a gap.
  const m = mkMedicion({ variety: 'Nebbiolo' });
  const { detail } = detailFor(m);
  assert.equal(detail.reason, 'Sin rúbrica');
  for (const a of detail.groups.flatMap(g => g.axes)) {
    assert.notEqual(a.state, 'na', `${a.label} should not read NA without a rubric`);
    assert.equal(a.bucket, null, `${a.label} cannot have a bucket without a rubric`);
  }
  assert.equal(axisNamed(detail, 'Grado Brix').value, 24.0, 'readings are still shown');
});

test('MT.45 detail: missing core chemistry reads missing and the reason carries', () => {
  const m = mkMedicion({ brix: null, pH: null, ta: null });
  const { detail } = detailFor(m);
  assert.equal(detail.reason, 'Datos insuficientes');
  assert.equal(axisNamed(detail, 'Grado Brix').state, 'missing');
  assert.equal(axisNamed(detail, 'pH').state, 'missing');
  assert.equal(axisNamed(detail, 'Acidez total').state, 'missing');
});

test('MT.45 detail: madurez fenolica shows its label and never a bucket', () => {
  const { detail } = detailFor(mkMedicion());
  const mf = axisNamed(detail, 'Madurez fenolica');
  assert.equal(mf.value, 'Sobresaliente');
  assert.equal(mf.bucket, null);
  assert.notEqual(mf.state, 'na');
});

test('MT.45 detail: every axis lands in exactly one known state', () => {
  const cases = [
    mkMedicion(),
    mkMedicion({ variety: 'Sauvignon Blanc', appellation: 'Valle de Guadalupe' }),
    mkMedicion({ variety: 'Nebbiolo' }),
    mkMedicion({ brix: null, pH: null, ta: null, av: null, ag: null, am: null,
                 berryWeight: null, polyphenols: null, anthocyanins: null,
                 phenolicMaturity: null }),
  ];
  const known = new Set(['scored', 'missing', 'na', 'info']);
  for (const m of cases) {
    const { detail } = detailFor(m);
    for (const a of detail.groups.flatMap(g => g.axes)) {
      assert.ok(known.has(a.state), `${a.label} had state ${a.state}`);
      if (a.state === 'scored') assert.ok(a.bucket || a.points !== null,
        `${a.label} is scored so it must carry a bucket or points`);
    }
  }
});

test('MT.45 detail: a berry-filled axis shows the value that earned the bucket', () => {
  // The panel must not print "sin dato" beside an A. polifenoles is populated
  // on 1 of 287 production mediciones and usually arrives via the berry's
  // tank_receptions average, so this is the common case, not an edge one.
  const berry = {
    lotCode: 'KCS-S1', vintage: 2026,
    variety: 'Cabernet Sauvignon', appellation: 'Valle de Ojos Negros',
    polyphenols: 2600,
  };
  const m = mkMedicion({ polyphenols: null });
  const byLot = new Map([['KCS-S1||2026', berry]]);
  const score = scoreFromMedicion(m, byLot);
  const rubric = resolveRubric(m.variety, m.appellation);
  const detail = medicionDetail(m, score, rubric, null, null);
  const poly = axisNamed(detail, 'Polifenoles');
  assert.equal(poly.state, 'scored');
  assert.equal(poly.value, 2600, 'the berry-filled value must be the one shown');
  assert.equal(poly.bucket, 'A');
});

test('MT.45 detail: acido malico is unaffected by the resolved chemistry', () => {
  // am is not a rubric axis, so it is never in score.chemistry and must still
  // come off the medicion.
  const m = mkMedicion({ am: 3.1 });
  const { detail } = detailFor(m);
  assert.equal(axisNamed(detail, 'Acido malico').value, 3.1);
});

// Raised by the cross-vendor review, 2026-09-15.
test('MT.45 detail: the panel uses the rubric the score used, not one re-resolved', () => {
  // With a blank identity the score falls back to the berry's. Re-resolving
  // from the medicion would show a grade in the badge and "Sin rubrica
  // aplicable" in the panel right below it, with every axis demoted to info.
  const berry = {
    lotCode: 'KCS-S1', vintage: 2026,
    variety: 'Cabernet Sauvignon', appellation: 'Valle de Ojos Negros',
  };
  const m = mkMedicion({ variety: '', appellation: '' });
  const byLot = new Map([['KCS-S1||2026', berry]]);
  const score = scoreFromMedicion(m, byLot);
  assert.ok(score.grade, 'precondition: the score resolved a rubric via the berry');

  const detail = medicionDetail(m, score, rubricById(score.rubricId), null, null);
  assert.equal(detail.reason, null);
  assert.equal(axisNamed(detail, 'Grado Brix').state, 'scored',
    'the panel must agree with the badge');
  assert.equal(axisNamed(detail, 'Antocianos totales').state, 'scored');
});

test('MT.45 detail: catequinas is shown and never scored', () => {
  const { detail } = detailFor(mkMedicion({ catechins: 210 }));
  const cat = axisNamed(detail, 'Catequinas');
  assert.ok(cat, 'catequinas is stored on every row, so the panel must show it');
  assert.equal(cat.value, 210);
  assert.equal(cat.state, 'info');
  assert.equal(cat.bucket, null);
});

// ---------------------------------------------------------------------------
// Findings from the fresh-context adversarial review, 2026-09-15.
// ---------------------------------------------------------------------------

test('MT.45 B3: the sanitary visual axis never renders a fake A/B/C', () => {
  // buckets.visual is the native 0-4 Grado Sanitario, so 3, 2 and 1 collide
  // with the rubric buckets. Before the fix "Limpio" (3 pts, second-best)
  // printed an A while "Muy limpio" (4 pts, the best) printed points, and
  // "Contaminado" (0 pts, which the workbook itself calls C) printed points
  // too. Every grade must use the same representation.
  const GRADES = ['Muy limpio', 'Limpio', 'Parcialmente limpio', 'Sucio', 'Contaminado'];
  for (const grade of GRADES) {
    const m = mkMedicion({ healthGrade: grade, evaluaciones: [] });
    const score = scoreFromMedicion(m, new Map());
    const detail = medicionDetail(m, score, rubricById(score.rubricId), null, grade, null);
    const visual = axisNamed(detail, 'Estado sanitario (visual)');
    assert.equal(visual.bucket, null,
      `"${grade}" must not render an A/B/C bucket; the 0-4 scale is not that scale`);
    assert.ok(visual.points !== null,
      `"${grade}" must carry its points instead`);
  }
});

test('MT.45 N1: a white reads NA on the phenolic axes even with no rubric at all', () => {
  // The NA rule keys on grape colour, not on a rubric lookup. Viognier is in
  // grapeTypes.white and in no varietyRubricMap, so keying on rubric.params
  // printed its raw polifenoles and antocianos numbers.
  for (const [variety, appellation] of [
    ['Viognier', 'Valle de Ojos Negros'],
    ['Viognier', 'Valle de Guadalupe'],
    ['Sauvignon Blanc', 'Valle de San Vicente'],
    ['Chardonnay', 'Valle de San Vicente'],
  ]) {
    const m = mkMedicion({ variety, appellation, polyphenols: 900, anthocyanins: 1400 });
    const score = scoreFromMedicion(m, new Map());
    const detail = medicionDetail(m, score, rubricById(score.rubricId), null, null, null);
    for (const label of ['Polifenoles', 'Antocianos totales']) {
      assert.equal(axisNamed(detail, label).state, 'na',
        `${variety} in ${appellation}: ${label} must read NA, never a number`);
    }
    assert.ok(!('anthocyanins' in (score.buckets || {})),
      `${variety} in ${appellation} must not score antocianos either`);
  }
});

test('MT.45 N1: a red with no rubric still shows its phenolics as plain readings', () => {
  // The mirror. "No rubric yet" is not the same claim as "not applicable".
  const m = mkMedicion({ variety: 'Nebbiolo', polyphenols: 1950, anthocyanins: 1100 });
  const score = scoreFromMedicion(m, new Map());
  const detail = medicionDetail(m, score, rubricById(score.rubricId), null, null, null);
  assert.equal(axisNamed(detail, 'Polifenoles').state, 'info');
  assert.equal(axisNamed(detail, 'Polifenoles').value, 1950);
});

test('MT.45 N6: madurez shows the label the engine actually scored', () => {
  // averageEvaluations ignores the scalar when the panel carries madurez
  // entries, so printing m.phenolicMaturity could show a label that did not
  // produce the adjustment in the score.
  const m = mkMedicion({ phenolicMaturity: 'Sobresaliente' });
  const score = scoreFromMedicion(m, new Map());
  const detail = medicionDetail(m, score, rubricById(score.rubricId), null, null, 'No sobresaliente');
  assert.equal(axisNamed(detail, 'Madurez fenolica').value, 'No sobresaliente',
    'the consensus the engine used wins over the row scalar');
});
