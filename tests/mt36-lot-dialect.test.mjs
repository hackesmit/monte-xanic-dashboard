// tests/mt36-lot-dialect.test.mjs
// MT.36 — Field-lot dialect normalization (Kompali/Dominio spreadsheet codes
// vs WineXRay berry codes).
//
// Regression guard for the 2026-06-10 "Clasificación: Sin datos" bug: the
// mediciones técnicas spreadsheets write Kompali lots as {VAR}KMP-{SUF}
// ('TEKMP-S1') and Dominio de las Abejas as {VAR}UC-{SUF} ('SYUC-L5'), while
// berry samples write K{VAR}-{SUF} ('KTE-S1') and {VAR}DA-{SUF} ('SYDA-L5').
// joinBerryWithMediciones keys on exact (lotCode, vintage), so every Kompali
// and Dominio section rendered grey with "Sin datos" despite mediciones
// existing for them. Also guards the duplicate-CONFIG-key fix: the second
// fieldLotToSection/fieldLotRanchPatterns definitions silently shadowed the
// richer first ones (losing the KMP pattern and the whole berry-lot table).

import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { DataStore } from '../js/dataLoader.js';
import { MapStore } from '../js/maps.js';

test('MT.36 normalizeFieldLotCode: KMP transposition and friends', () => {
  const cases = [
    // Kompali: spreadsheet dialect → berry dialect
    ['TEKMP-S1',        'KTE-S1'],
    ['TEKMP-S1-R',      'KTE-S1-R'],
    ['MEKMP-S6-2',      'KME-S6-2'],
    ['CAKMP-S3B',       'KCA-S3B'],
    ['SYKMP-S723',      'KSY-S723'],
    ['CSKMP-S8-1',      'KCS-S8-1'],
    // Long variety prefix maps to the berry 2-letter convention
    ['MRSKMP-S5A+',     'KMS-S5A+'],
    // Short numeric block ids gain the section S-prefix
    ['DUKMP-2B',        'KDU-S2B'],
    ['PVKMP-3A',        'KPV-S3A'],
    ['CSKMP-2B-ALIVIO', 'KCS-S2B-ALIVIO'],
    // Long block ids must NOT get a fabricated S-prefix
    ['CHKMP-110R1',     'KCH-110R1'],
    ['CHKMP-SALT',      'KCH-SALT'],
    // Dominio de las Abejas: UC → DA
    ['SYUC-L5',         'SYDA-L5'],
    ['SYUC-L13,14',     'SYDA-L13,14'],
    // Annotations and separators
    ['SBVDG-4B (P.A.+P.F.)', 'SBVDG-4B'],
    ['CSOLE.1',         'CSOLE-1'],
    // Idempotency: berry-dialect codes pass through unchanged
    ['KTE-S1',          'KTE-S1'],
    ['KMS-S5A+',        'KMS-S5A+'],
    ['SYDA-L13,14',     'SYDA-L13,14'],
    ['CSMX-5B',         'CSMX-5B'],
    ['SYVA-1D,2C,3C,4C','SYVA-1D,2C,3C,4C'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(CONFIG.normalizeFieldLotCode(input), expected, `${input} → ${expected}`);
  }
  // Double application changes nothing
  for (const [input] of cases) {
    const once = CONFIG.normalizeFieldLotCode(input);
    assert.equal(CONFIG.normalizeFieldLotCode(once), once, `idempotent: ${input}`);
  }
});

test('MT.36 config: no duplicate shadowing — KTE-S1 resolves via fieldLotToSection', () => {
  // The first (rich) table must be live: it maps the Kompali berry lots.
  assert.equal(CONFIG.fieldLotToSection['KTE-S1'], 'K-S1');
  assert.equal(CONFIG.fieldLotToSection['CSON-3'], 'ON-3');
  // Entries that only existed in the second (shadowing) table survive the merge
  assert.equal(CONFIG.fieldLotToSection['KCS-S8-1-ABA'], 'K-S8');
  assert.equal(CONFIG.fieldLotToSection['SYVA-1D,2C,3C,4C'], 'VA-1D');
  // The KMP pattern must be present (was only in the shadowed first list)
  assert.ok(CONFIG.fieldLotRanchPatterns.some(p => String(p.regex).includes('KMP')),
    'fieldLotRanchPatterns must include the KMP pattern');
});

test('MT.36 join: spreadsheet-dialect medicion reaches berry-dialect berries', () => {
  const snapshot = {
    berry: DataStore.berryData, med: DataStore.medicionesData,
  };
  try {
    DataStore.medicionesData = [
      DataStore._rowToMedicion({
        id: 1, medicion_code: 'MT-25-068', medicion_date: '2025-09-20',
        vintage_year: 2025, variety: 'Tempranillo', appellation: 'Kompali (VON)',
        lot_code: 'TEKMP-S1',                  // spreadsheet dialect, as in the DB
        tons_received: '12.5', health_grade: 'Bueno',
        health_madura: 90, health_inmadura: 5, health_sobremadura: 2,
        health_picadura: 1, health_enfermedad: 1, health_quemadura: 1,
        phenolic_maturity: 'Sobresaliente',
      }),
      // Multi-lot medicion must join berries of each sub-lot
      DataStore._rowToMedicion({
        id: 2, medicion_code: 'MT-25-010', medicion_date: '2025-08-25',
        vintage_year: 2025, variety: 'Sauvignon Blanc', appellation: 'VDG',
        lot_code: 'SBVDG-2A/2B', tons_received: '8', health_grade: 'Excelente',
        health_madura: 95, health_inmadura: 3, health_sobremadura: 1,
        health_picadura: 1, health_enfermedad: 0, health_quemadura: 0,
      }),
    ];
    DataStore.berryData = [
      { sampleId: '25KTE-S1-3', lotCode: 'KTE-S1', vintage: 2025,
        variety: 'Tempranillo', appellation: 'Kompali (VON)', brix: 24 },
      { sampleId: '25SBVDG-2B-1', lotCode: 'SBVDG-2B', vintage: 2025,
        variety: 'Sauvignon Blanc', appellation: 'VDG', brix: 21 },
      // Other vintage must NOT receive the medicion
      { sampleId: '24KTE-S1-2', lotCode: 'KTE-S1', vintage: 2024,
        variety: 'Tempranillo', appellation: 'Kompali (VON)', brix: 23 },
    ];
    DataStore.joinBerryWithMediciones();
    assert.ok(DataStore.berryData[0].medicion, 'KTE-S1 2025 berry must join TEKMP-S1 medicion');
    assert.equal(DataStore.berryData[0].medicion.health_madura, 90);
    assert.ok(DataStore.berryData[1].medicion, 'SBVDG-2B berry must join the SBVDG-2A/2B medicion');
    assert.equal(DataStore.berryData[2].medicion, null, 'no cross-vintage join');
  } finally {
    DataStore.berryData = snapshot.berry;
    DataStore.medicionesData = snapshot.med;
  }
});

test('MT.36 map: normalized Kompali lots resolve to real sections', () => {
  const sectionIds = new Set(CONFIG.vineyardSections.map(s => s.sectionId));
  for (const raw of ['TEKMP-S1', 'TEKMP-S1-R', 'MRSKMP-S5A+', 'DUKMP-2B', 'CAKMP-S3B']) {
    const norm = CONFIG.normalizeFieldLotCode(raw);
    const section = MapStore.resolveSection(norm);
    assert.ok(section && sectionIds.has(section),
      `${raw} → ${norm} → ${section} must be a real section`);
  }
});
