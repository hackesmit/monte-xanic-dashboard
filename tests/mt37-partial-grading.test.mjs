// tests/mt37-partial-grading.test.mjs
// MT.37 — Partial classification + pre-recepción field mappings.
//
// (1) scoreLot grades with core berry chemistry (brix+pH+ta) plus medicion
//     even when reception chemistry (av/ag/polifenoles/antocianinas) is
//     missing — flagged `partial: true` so the UI warns. Without the core
//     chemistry it still refuses to grade.
// (2) _rowToMedicion derives berry diameter from the file's
//     'Longitud promedio por baya (cm)' (berry_length_avg_cm → mm) and the
//     origin from 'Proveedor' (supplier abbreviation → full appellation),
//     falling back to the ranch resolved from the lot code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLot, scoreFromMedicion } from '../js/classification.js';
import { DataStore } from '../js/dataLoader.js';

const medicion = {
  health_grade: 'Bueno', health_madura: 90, health_inmadura: 5,
  health_sobremadura: 2, health_picadura: 1, health_enfermedad: 1,
  health_quemadura: 1, phenolic_maturity: null,
};

test('MT.37 scoreLot: grades without reception chemistry, flagged partial', () => {
  const lot = {
    variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
    vintage: 2025, lotCode: 'CSMX-5B',
    brix: 24.0, pH: 3.55, ta: 6.0, berryFW: 1.0,   // no av/ag/poly/ant
    medicion,
  };
  const r = scoreLot(lot);
  assert.notEqual(r.grade, null, `expected a grade, got ${r.reason}`);
  assert.equal(r.partial, true, 'must be flagged partial');
  assert.ok(r.missing.includes('av') && r.missing.includes('polyphenols'),
    `missing list must name reception params: ${r.missing}`);
});

test('MT.37 scoreLot: full data is NOT flagged partial', () => {
  const lot = {
    variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
    vintage: 2025, lotCode: 'CSMX-5B',
    brix: 24.0, pH: 3.55, ta: 6.0, berryFW: 1.0,
    av: 0.0, ag: 0.02, polyphenols: 2200, anthocyanins: 850,
    medicion,
  };
  const r = scoreLot(lot);
  assert.notEqual(r.grade, null);
  assert.equal(r.partial, false);
});

test('MT.37 scoreLot: still refuses without core chemistry', () => {
  const lot = {
    variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)',
    vintage: 2025, lotCode: 'CSMX-5B',
    pH: 3.55, ta: 6.0,    // no brix
    medicion,
  };
  const r = scoreLot(lot);
  assert.equal(r.grade, null);
  assert.equal(r.reason, 'Datos insuficientes');
});

test('MT.37 _rowToMedicion: diameter from berry_length_avg_cm and origin from supplier', () => {
  const m = DataStore._rowToMedicion({
    id: 1, medicion_code: 'MT-25-001', medicion_date: '2025-09-20',
    vintage_year: 2025, variety: 'Tempranillo', lot_code: 'TEKMP-S1',
    supplier: 'KMP', berry_length_avg_cm: 1.344, berry_avg_weight_g: '1.27',
  });
  assert.equal(m.berryDiameter, 13.4, 'cm → mm conversion');
  assert.equal(m.appellation, 'Kompali (VON)', 'supplier abbr → appellation');
  // Explicit diameter wins over derived length
  const m2 = DataStore._rowToMedicion({
    id: 2, medicion_code: 'MT-25-002', lot_code: 'CSMX-5B',
    berry_diameter_mm: 12.5, berry_length_avg_cm: 1.1,
  });
  assert.equal(m2.berryDiameter, 12.5);
  // No supplier/appellation → ranch resolved from the lot code
  const m3 = DataStore._rowToMedicion({
    id: 3, medicion_code: 'MT-25-003', lot_code: 'SYUC-L5', vintage_year: 2025,
  });
  assert.equal(m3.appellation, 'Dominio de las Abejas (VON)');
  // 'DOMINIO' spelled out (as the 2025 file does)
  const m4 = DataStore._rowToMedicion({
    id: 4, medicion_code: 'MT-25-004', lot_code: 'SYUC-L13,14', supplier: 'DOMINIO',
  });
  assert.equal(m4.appellation, 'Dominio de las Abejas (VON)');
});

test('MT.37 end-to-end: an absent sanitary count is missing, not a fabricated clean zero', () => {
  // The whole bead in one chain: a WineXRay row that genuinely never carried
  // one of the five required counts must flow DB row → _rowToMedicion →
  // scoreFromMedicion → scoreLot and land in missing[], NOT be scored off a
  // total that pretends the uncounted berries were healthy. Fails against the
  // pre-fix code (dataLoader coerced the blank to 0, so a partial reading
  // silently earned the best sanitary bucket).
  const berry = {
    lotCode: 'CS-TEST-1', vintage: 2026,
    variety: 'Cabernet Sauvignon', appellation: 'Valle de Ojos Negros',
    brix: 24.5, pH: 3.55, ta: 5.5, tANT: 1200, berryFW: 1.0,
    av: 0.20, ag: 0.30, polyphenols: 2500, anthocyanins: 1200,
  };
  const byLot = new Map([[`${berry.lotCode}||${berry.vintage}`, berry]]);

  // Partial reading: health_enfermedad genuinely absent from the uploaded row.
  const medAbsent = DataStore._rowToMedicion({
    id: 10, medicion_code: 'MT-26-010', vintage_year: 2026,
    variety: 'Cabernet Sauvignon', lot_code: 'CS-TEST-1',
    health_madura: 90, health_inmadura: 5, health_sobremadura: 2,
    health_picadura: 1, /* health_enfermedad absent */
  });
  assert.equal(medAbsent.healthEnfermedad, null,
    'absent count must be null-preserved by _rowToMedicion, not coerced to 0');
  const rAbsent = scoreFromMedicion(medAbsent, byLot);
  assert.ok(rAbsent.missing.includes('sanitary_pct'),
    `partial sanitary data must be flagged missing: ${JSON.stringify(rAbsent.missing)}`);
  assert.equal(rAbsent.buckets?.sanitary_pct, undefined,
    'a partial reading must NOT earn a sanitary bucket');

  // Complete clean reading: every required count present, unhealthy counted as
  // a genuine 0. It still earns the top sanitary bucket — telling this apart
  // from the partial row above is the entire point of the fix.
  const medClean = DataStore._rowToMedicion({
    id: 11, medicion_code: 'MT-26-011', vintage_year: 2026,
    variety: 'Cabernet Sauvignon', lot_code: 'CS-TEST-1',
    health_madura: 95, health_inmadura: 3, health_sobremadura: 2,
    health_picadura: 0, health_enfermedad: 0,
  });
  assert.equal(medClean.healthEnfermedad, 0, 'a counted zero is preserved as 0');
  const rClean = scoreFromMedicion(medClean, byLot);
  assert.ok(!rClean.missing.includes('sanitary_pct'),
    'a complete clean reading must not be flagged missing');
  assert.equal(rClean.buckets.sanitary_pct, 3,
    'a complete clean reading earns the top sanitary bucket');
});
