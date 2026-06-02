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

test('MT.31 scoreFromMedicion: returns null grade with reason="Sin berry" on index miss', () => {
  const med = mkMedicion();
  const result = scoreFromMedicion(med, new Map());
  assert.equal(result.grade, null);
  assert.equal(result.reason, 'Sin berry');
});

test('MT.31 scoreFromMedicion: returns null grade with reason="Sin berry" on null index', () => {
  const med = mkMedicion();
  const result = scoreFromMedicion(med, null);
  assert.equal(result.grade, null);
  assert.equal(result.reason, 'Sin berry');
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

test('MT.31 scoreFromMedicion: handles missing lotCode on medicion', () => {
  const med = mkMedicion({ lotCode: null });
  const berryByLot = new Map([[`CS-TEST-1||2026`, mkBerry()]]);
  const result = scoreFromMedicion(med, berryByLot);
  assert.equal(result.grade, null);
  assert.equal(result.reason, 'Sin berry');
});

test('MT.31 scoreFromMedicion: handles missing vintage on medicion', () => {
  const med = mkMedicion({ vintage: null });
  const berryByLot = new Map([[`CS-TEST-1||2026`, mkBerry()]]);
  const result = scoreFromMedicion(med, berryByLot);
  assert.equal(result.grade, null);
  assert.equal(result.reason, 'Sin berry');
});
