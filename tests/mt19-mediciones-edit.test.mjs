// MT.19 — Mediciones edit helpers (pure functions, no DOM).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDirty, ariaSortFor, shouldShowSourceBanner,
  normalizeEvaluadorPanel, compactEvaluadorPanel, evaluadorPanelSummary,
  evaluadorPanelOptions, seedEvaluadorPanel, projectSnapshot,
  countInputValue, readCountInput, liveScoreMedicion,
} from '../js/mediciones.js';
import {
  scoreFromMedicion, averageEvaluations,
  consensusSanitaryLabel, consensusMadurezLabel,
} from '../js/classification.js';
import { DataStore } from '../js/dataLoader.js';
import { todayInVineyard } from '../js/utils.js';

// The five WineXRay counts plus the optional burn count, the fields the edit
// modal populates from the snapshot and reads back on save.
const COUNT_KEYS = [
  'healthMadura', 'healthInmadura', 'healthSobremadura',
  'healthPicadura', 'healthEnfermedad', 'healthQuemadura',
];

// Reproduce the modal's real count round-trip without a DOM: seed each input
// from the snapshot with countInputValue, then read it back with readCountInput,
// exactly as openEditModal + _readEditForm do. Returns the {healthX: value} the
// form would carry for an untouched modal.
function roundTripCounts(editing) {
  const form = {};
  for (const k of COUNT_KEYS) {
    form[k] = readCountInput(countInputValue(editing[k]));
  }
  return form;
}

// xd-b0o blocker (adversarial review round 1): the null-preserving loader
// un-did itself on first edit. The modal populated every count input with
// `row.healthX ?? 0` and read it back as `intv(...) ?? 0`, so an untouched
// modal over a partial uploaded row (absent counts null) already read 0 for
// those counts; collectDirty saw snapshot-null vs form-0 as a real change, the
// Save button lit on open, and any save wrote health_x = 0 over the DB NULL,
// pinning the row to the clean bucket forever. These pin the fixed round-trip:
// a null count survives untouched, a real 0 stays 0, a typed value still saves.
describe('MT.19 — edit-modal count round-trip preserves NULL (xd-b0o)', () => {
  it('countInputValue seeds a blank for an absent count, "0" for a real zero', () => {
    assert.equal(countInputValue(null), '');
    assert.equal(countInputValue(undefined), '');
    assert.equal(countInputValue(0), '0');
    assert.equal(countInputValue(7), '7');
  });

  it('readCountInput reads a blank input back as null, not a fabricated 0', () => {
    assert.equal(readCountInput(''), null);
    assert.equal(readCountInput(null), null);
    assert.equal(readCountInput('0'), 0);
    assert.equal(readCountInput('7'), 7);
    assert.equal(readCountInput('abc'), null);
  });

  it('an untouched modal over a partial uploaded row marks no count dirty', () => {
    // Absent health_enfermedad + health_quemadura (upload never carries burn).
    const editing = DataStore._rowToMedicion({
      id: 1, medicion_code: 'MT-26-001', vintage_year: 2026,
      variety: 'Cabernet Sauvignon', lot_code: 'CS-TEST-1',
      health_madura: 90, health_inmadura: 5, health_sobremadura: 2,
      health_picadura: 1,
    });
    assert.equal(editing.healthEnfermedad, null);
    assert.equal(editing.healthQuemadura, null);
    const form = roundTripCounts(editing);
    const dirty = collectDirty(projectSnapshot(editing, form), form);
    assert.deepEqual(dirty, {},
      'untouched modal must not mark absent counts dirty (Save stays disabled)');
  });

  it('a save over an untouched partial row writes no fabricated 0 count', () => {
    const editing = DataStore._rowToMedicion({
      id: 2, medicion_code: 'MT-26-002', vintage_year: 2026,
      variety: 'Cabernet Sauvignon', lot_code: 'CS-TEST-1',
      health_madura: 90, health_inmadura: 5, health_sobremadura: 2,
      health_picadura: 1,
    });
    const form = roundTripCounts(editing);
    const dirty = collectDirty(projectSnapshot(editing, form), form);
    // submitEdit only maps keys present in `dirty` onto the DB row, so no
    // health_* key here means the DB NULL is never overwritten with 0.
    for (const k of COUNT_KEYS) {
      assert.ok(!(k in dirty), `${k} must not be dirty on an untouched save`);
    }
  });

  it('a genuine stored 0 round-trips as 0 and is not dirty', () => {
    const editing = DataStore._rowToMedicion({
      id: 3, medicion_code: 'MT-26-003', vintage_year: 2026,
      variety: 'Cabernet Sauvignon', lot_code: 'CS-TEST-1',
      health_madura: 95, health_inmadura: 3, health_sobremadura: 2,
      health_picadura: 0, health_enfermedad: 0, health_quemadura: 0,
    });
    const form = roundTripCounts(editing);
    assert.equal(form.healthPicadura, 0);
    assert.deepEqual(collectDirty(projectSnapshot(editing, form), form), {});
  });

  it('typing a value into an absent count is a real, saveable edit', () => {
    const editing = DataStore._rowToMedicion({
      id: 4, medicion_code: 'MT-26-004', vintage_year: 2026,
      variety: 'Cabernet Sauvignon', lot_code: 'CS-TEST-1',
      health_madura: 90, health_inmadura: 5, health_sobremadura: 2,
      health_picadura: 1,
    });
    const form = roundTripCounts(editing);
    form.healthEnfermedad = readCountInput('3'); // user types 3 into the blank
    const dirty = collectDirty(projectSnapshot(editing, form), form);
    assert.deepEqual(dirty, { healthEnfermedad: 3 },
      'a typed count must still register as a genuine edit');
  });
});

describe('MT.19 — collectDirty', () => {
  it('returns empty when no fields differ', () => {
    const initial = { a: 1, b: 2, c: 'x' };
    const current = { a: 1, b: 2, c: 'x' };
    assert.deepEqual(collectDirty(initial, current), {});
  });

  it('returns only the changed fields', () => {
    const initial = { a: 1, b: 2, c: 'x' };
    const current = { a: 1, b: 5, c: 'y' };
    assert.deepEqual(collectDirty(initial, current), { b: 5, c: 'y' });
  });

  it('treats null and undefined as equal so blank fields don\'t show as dirty', () => {
    const initial = { a: null };
    const current = { a: undefined };
    assert.deepEqual(collectDirty(initial, current), {});
  });

  it('detects a value reverted to its initial as no-longer-dirty', () => {
    const initial = { a: 1 };
    const current = { a: 1 };  // user typed and re-typed the same
    assert.deepEqual(collectDirty(initial, current), {});
  });
});

describe('MT.19 — ariaSortFor', () => {
  it('returns "ascending" or "descending" for the active column', () => {
    assert.equal(ariaSortFor('date', true,  'date'), 'ascending');
    assert.equal(ariaSortFor('date', false, 'date'), 'descending');
  });

  it('returns null for a non-active column', () => {
    assert.equal(ariaSortFor('date', true, 'variety'), null);
  });
});

describe('MT.19 — shouldShowSourceBanner', () => {
  it('returns true for upload-source rows', () => {
    assert.equal(shouldShowSourceBanner({ source: 'upload' }), true);
  });

  it('returns false for form-source rows', () => {
    assert.equal(shouldShowSourceBanner({ source: 'form' }), false);
  });

  it('returns false when source is missing (defensive)', () => {
    assert.equal(shouldShowSourceBanner({}), false);
  });
});

// Vendimia 2026 evaluator panel helpers.
describe('MT.19 — evaluator panel helpers', () => {
  it('always yields at least one row so the form opens ready to type', () => {
    assert.equal(normalizeEvaluadorPanel(null).length, 1);
    assert.equal(normalizeEvaluadorPanel([]).length, 1);
    assert.deepEqual(normalizeEvaluadorPanel(null)[0],
      { evaluador: null, sanidad: null, madurez: null });
  });

  it('fills in the missing keys of a partial row', () => {
    assert.deepEqual(normalizeEvaluadorPanel([{ sanidad: 'Limpio' }]),
      [{ evaluador: null, sanidad: 'Limpio', madurez: null }]);
  });

  it('drops untouched spare rows before they reach the database', () => {
    const panel = [
      { evaluador: 'Carla', sanidad: 'Muy limpio', madurez: null },
      { evaluador: null,    sanidad: null,         madurez: null },
    ];
    assert.equal(compactEvaluadorPanel(panel).length, 1);
    assert.equal(compactEvaluadorPanel(normalizeEvaluadorPanel(null)).length, 0);
  });

  it('keeps a row that carries only a name, so a typo is not silently lost', () => {
    assert.equal(compactEvaluadorPanel([{ evaluador: 'Carla' }]).length, 1);
  });

  it('offers exactly the 2026 vocabulary, in scale order', () => {
    const { sanidad, madurez } = evaluadorPanelOptions();
    assert.deepEqual(sanidad,
      ['Muy limpio', 'Limpio', 'Parcialmente limpio', 'Sucio', 'Contaminado']);
    assert.deepEqual(madurez,
      ['Sobresaliente', 'Buena', 'Parcial', 'Baja', 'No sobresaliente']);
  });

  it('summarises each axis over its own evaluators', () => {
    const s = evaluadorPanelSummary([
      { evaluador: 'A', sanidad: 'Muy limpio',          madurez: 'Sobresaliente' },
      { evaluador: 'B', sanidad: 'Muy limpio',          madurez: 'Baja' },
      { evaluador: 'C', sanidad: 'Parcialmente limpio', madurez: null },
    ]);
    assert.match(s, /Sanidad: 3\.33 de 4/);   // mean(4,4,2)
    assert.match(s, /Madurez: \+1\.00/);      // mean(+3,-1), C excluded
    assert.match(s, /3 evaluadores/);
  });

  it('counts every participant, not the busier axis', () => {
    // Two people, neither axis graded twice: the line must still say two.
    const s = evaluadorPanelSummary([
      { evaluador: 'A', sanidad: 'Limpio', madurez: null },
      { evaluador: 'B', sanidad: null,     madurez: 'Parcial' },
    ]);
    assert.match(s, /2 evaluadores/);
  });

  it('says so plainly when an axis has no grades at all', () => {
    const s = evaluadorPanelSummary([{ evaluador: 'A', sanidad: 'Limpio', madurez: null }]);
    assert.match(s, /Madurez: sin calificar/);
    assert.match(s, /1 evaluador\b/);
  });

  it('reports an empty panel rather than inventing a zero', () => {
    assert.equal(evaluadorPanelSummary([]), 'Sin evaluaciones');
    assert.equal(evaluadorPanelSummary(normalizeEvaluadorPanel(null)), 'Sin evaluaciones');
  });
});

// Lucy (cross-vendor adversarial review, 2026-08-12), second pass.
describe('MT.19 — seeding the edit modal never destroys a grade', () => {
  it('grafts an orphaned madurez scalar onto the panel', () => {
    // The engine falls back to phenolic_maturity because no evaluator graded
    // madurez. If the modal did not seed the same way it would derive null,
    // mark the field dirty, and erase a +3 the user never touched.
    const seeded = seedEvaluadorPanel(
      [{ evaluador: 'A', sanidad: 'Limpio', madurez: null }],
      null, 'Sobresaliente');
    assert.equal(seeded[0].madurez, 'Sobresaliente');
    assert.equal(seeded[0].sanidad, 'Limpio');
  });

  it('grafts an orphaned sanidad scalar the same way', () => {
    const seeded = seedEvaluadorPanel(
      [{ evaluador: 'A', sanidad: null, madurez: 'Parcial' }],
      'Muy limpio', null);
    assert.equal(seeded[0].sanidad, 'Muy limpio');
  });

  it('leaves a scalar alone when the panel already covers that axis', () => {
    const seeded = seedEvaluadorPanel(
      [{ evaluador: 'A', sanidad: 'Contaminado', madurez: 'Baja' }],
      'Muy limpio', 'Sobresaliente');
    assert.equal(seeded[0].sanidad, 'Contaminado');
    assert.equal(seeded[0].madurez, 'Baja');
    assert.equal(seeded.length, 1);
  });

  it('canonicalises a pre-2026 label so the select can show it', () => {
    // The selects only carry the 2026 vocabulary, so an un-renamed 'Bueno'
    // would match no option and the select would fall back to blank.
    assert.equal(seedEvaluadorPanel([], 'Bueno', null)[0].sanidad, 'Limpio');
    assert.equal(
      seedEvaluadorPanel([{ evaluador: 'A', sanidad: 'Regular' }], null, null)[0].sanidad,
      'Parcialmente limpio');
  });

  it('seeds one blank row for a medicion nobody has graded', () => {
    const seeded = seedEvaluadorPanel([], null, null);
    assert.equal(seeded.length, 1);
    assert.equal(compactEvaluadorPanel(seeded).length, 0);
  });
});

// Lucy fourth pass: an unrecognised label (a workbook typo the sanitizer
// deliberately lets through, so one typo does not fail a whole upload) used
// to be dropped by the seed and then saved away by the next unrelated edit.
describe('MT.19 — an unrecognised label survives an unrelated edit', () => {
  it('keeps a sanidad label the vocabulary does not know', () => {
    const seeded = seedEvaluadorPanel(
      [{ evaluador: 'A', sanidad: 'medio sucio', madurez: 'Buenaa' }], null, null);
    assert.equal(seeded[0].sanidad, 'medio sucio');
    assert.equal(seeded[0].madurez, 'Buenaa');
  });

  it('still renames a legacy label rather than preserving it verbatim', () => {
    assert.equal(seedEvaluadorPanel([{ sanidad: 'Regular' }], null, null)[0].sanidad,
      'Parcialmente limpio');
  });

  it('does not treat an unrecognised label as a graded axis', () => {
    // Preserved for display, but it must not be grafted over or scored.
    const seeded = seedEvaluadorPanel([{ sanidad: 'medio sucio' }], 'Muy limpio', null);
    assert.equal(seeded[0].sanidad, 'medio sucio', 'the stored value wins');
    assert.equal(evaluadorPanelSummary(seeded).includes('Sanidad: sin calificar'), true);
  });
});

// xd-61q: the snapshot is a clone of the whole DataStore row, so keys the form
// never produces (id, code, source, audit stamps) counted as permanent edits
// through collectDirty's key union. Pre-existing, found while building the
// evaluator panel.
describe('MT.19 — projectSnapshot: only the form owns the comparison', () => {
  const row = {
    id: 7, code: 'MT-25-999', source: 'form',
    lastEditedAt: '2026-08-01T00:00:00Z', lastEditedBy: 'carla',
    date: '2025-09-20', notes: 'x', tons: 4.2,
  };
  const form = { date: '2025-09-20', notes: 'x', tons: 4.2 };

  it('an untouched modal reports no edits at all', () => {
    assert.deepEqual(collectDirty(projectSnapshot(row, form), form), {},
      'Save must open disabled and closing must not prompt');
  });

  it('a real edit is still detected', () => {
    const edited = { ...form, notes: 'nota nueva' };
    assert.deepEqual(collectDirty(projectSnapshot(row, edited), edited),
      { notes: 'nota nueva' });
  });

  it('a column a future migration adds cannot make the modal dirty', () => {
    const wider = { ...row, alguna_columna_nueva: 'valor' };
    assert.deepEqual(collectDirty(projectSnapshot(wider, form), form), {});
  });

  it('a field the form owns but the row lacks still counts when filled in', () => {
    const filled = { ...form, measuredBy: 'Carla' };
    assert.deepEqual(collectDirty(projectSnapshot(row, filled), filled),
      { measuredBy: 'Carla' });
  });
});

// Lucy 2026-08-14: the medicion date defaulted from toISOString(), so a
// measurement entered after 17:00 in Tijuana was filed under the next day.
describe('MT.19 — the default medicion date is a vineyard date', () => {
  it('never uses the UTC date when the two disagree', () => {
    const local = todayInVineyard();
    assert.match(local, /^\d{4}-\d{2}-\d{2}$/);
    // Tijuana is behind UTC year-round, so its date is the UTC one or the day
    // before, never ahead. Filing a measurement ahead of the local day is the
    // failure this guards.
    const utc = new Date().toISOString().split('T')[0];
    assert.ok(local <= utc, `local ${local} must never be ahead of UTC ${utc}`);
  });
});

// ---------------------------------------------------------------------------
// B1 from the fresh-context adversarial review, 2026-09-15.
// Round 2 found the round-1 fixtures encoded a form shape that does not exist:
// they omitted healthGrade, phenolicMaturity, evaluacionesJson, measuredBy and
// notes, and that is exactly why they missed the panel regression. This helper
// mirrors the real _readEditForm return, all 19 keys, so a rename breaks a test
// instead of the badge.
// ---------------------------------------------------------------------------

function editFormShape(row, overrides = {}) {
  const evaluaciones = overrides.evaluaciones ?? row.evaluaciones ?? [];
  const avg = averageEvaluations({ evaluaciones });
  return {
    date: row.date, vintage: row.vintage, variety: row.variety,
    appellation: row.appellation, lotCode: row.lotCode, tons: row.tons,
    berryWeight: row.berryWeight, berryDiameter: row.berryDiameter,
    healthMadura: row.healthMadura, healthInmadura: row.healthInmadura,
    healthSobremadura: row.healthSobremadura, healthPicadura: row.healthPicadura,
    healthEnfermedad: row.healthEnfermedad, healthQuemadura: row.healthQuemadura,
    // Derived from the panel, not from their own inputs.
    healthGrade: consensusSanitaryLabel(avg.sanidad),
    phenolicMaturity: consensusMadurezLabel(avg.madurez),
    evaluacionesJson: JSON.stringify(evaluaciones),
    measuredBy: row.measuredBy ?? null,
    notes: row.notes ?? null,
    ...(overrides.raw || {}),
  };
}

function editableRow(o = {}) {
  return {
    code: 'MT-26-001', date: '2026-09-01', vintage: 2026,
    variety: 'Cabernet Sauvignon', appellation: 'Valle de Ojos Negros',
    lotCode: 'KCS-S1', tons: 8, berryWeight: 1.0, berryDiameter: 13.1,
    brix: 24.0, pH: 3.6, ta: 6.0, av: 0.01, ag: 0, am: 2.4,
    polyphenols: 1950, catechins: 210, anthocyanins: 1100,
    healthGrade: 'Muy limpio', healthMadura: 190, healthInmadura: 4,
    healthSobremadura: 3, healthPicadura: 2, healthEnfermedad: 1, healthQuemadura: 0,
    phenolicMaturity: 'Sobresaliente',
    evaluaciones: [
      { evaluador: 'A', sanidad: 'Muy limpio', madurez: 'Sobresaliente' },
      { evaluador: 'B', sanidad: 'Muy limpio', madurez: 'Sobresaliente' },
    ],
    measuredBy: 'Lab', notes: null,
    ...o
  };
}

it('MT.19 liveScoreMedicion: an untouched form scores identically to the row', () => {
  // The modal badge and the table badge behind it must agree when nothing has
  // been edited. The old builder re-listed the fields to copy and went stale
  // the moment the engine started reading the medicion's own chemistry: 269 of
  // 287 production rows disagreed, 203 of them showing a grade in the table and
  // "Datos insuficientes" in the modal.
  const row = editableRow();
  const table = scoreFromMedicion(row, new Map());
  const modal = scoreFromMedicion(liveScoreMedicion(row, editFormShape(row)), new Map());
  assert.ok(table.grade, 'precondition: the row grades at all');
  assert.equal(modal.grade, table.grade);
  assert.equal(modal.score36, table.score36);
});

it('MT.19 liveScoreMedicion: re-grading the evaluator panel moves the live badge', () => {
  // The form serialises the panel as a JSON STRING under evaluacionesJson, so a
  // plain key-name overlay set an inert key and left the saved array in place.
  // The badge then ignored the edit entirely and showed a confidently wrong
  // grade: A+ 31.80 where the table would show B 24.36 once saved.
  const row = editableRow();
  const regraded = [{ evaluador: 'A', sanidad: 'Contaminado', madurez: 'No sobresaliente' }];
  const built = liveScoreMedicion(row, editFormShape(row, { evaluaciones: regraded }));

  assert.deepEqual(built.evaluaciones, regraded, 'the panel edit must reach the engine');
  const before = scoreFromMedicion(row, new Map());
  const after = scoreFromMedicion(built, new Map());
  assert.notEqual(after.score36, before.score36,
    'downgrading every evaluator must move the score');
  assert.ok(after.score36 < before.score36,
    `expected a lower score after downgrading the panel, got ${after.score36} vs ${before.score36}`);
});

it('MT.19 liveScoreMedicion: a form-only key never survives onto the medicion', () => {
  // Leaving evaluacionesJson on the object is what made the mismatch invisible:
  // the engine ignored it and read the stale sibling instead.
  const row = editableRow();
  const built = liveScoreMedicion(row, editFormShape(row));
  assert.ok(!('evaluacionesJson' in built), 'evaluacionesJson must be translated away');
  for (const key of Object.keys(built)) {
    assert.ok(!/Json$/.test(key), `${key} looks like a form-only key that leaked through`);
  }
});

it('MT.19 liveScoreMedicion: a malformed panel string degrades to empty, never throws', () => {
  const row = editableRow();
  for (const bad of ['', 'not json', '{"not":"an array"}', null]) {
    const built = liveScoreMedicion(row, { evaluacionesJson: bad });
    assert.ok(Array.isArray(built.evaluaciones), `${JSON.stringify(bad)} should yield an array`);
    assert.equal(built.evaluaciones.length, 0);
  }
});

it('MT.19 liveScoreMedicion: chemistry the form cannot touch still reaches the engine', () => {
  // The edit form has no chemistry inputs, so those fields must fall through
  // from the saved row rather than vanishing.
  const row = editableRow();
  const built = liveScoreMedicion(row, editFormShape(row, { raw: { tons: 9 } }));
  for (const f of ['brix', 'pH', 'ta', 'av', 'ag', 'am', 'polyphenols', 'catechins', 'anthocyanins']) {
    assert.equal(built[f], row[f], `${f} must survive an edit that did not touch it`);
  }
  assert.equal(built.tons, 9, 'the form still wins where it owns the field');
});

it('MT.19 liveScoreMedicion: clearing a form field is an edit, not a fallback', () => {
  // A blank input reads back as null. Nullish-coalescing to the snapshot would
  // resurrect the value the user just deleted and score a reading that is no
  // longer on the form.
  const row = editableRow();
  const built = liveScoreMedicion(row, editFormShape(row, { raw: { tons: null, berryWeight: null } }));
  assert.equal(built.tons, null);
  assert.equal(built.berryWeight, null);
  assert.equal(built.brix, 24.0, 'a field the form does not expose is untouched');
});

it('MT.19 liveScoreMedicion: a zero from the form is kept, not read as blank', () => {
  const row = editableRow();
  const built = liveScoreMedicion(row, editFormShape(row, { raw: { healthPicadura: 0 } }));
  assert.equal(built.healthPicadura, 0);
});

it('MT.19 liveScoreMedicion: never mutates the snapshot it was handed', () => {
  const row = editableRow();
  const snapshot = JSON.parse(JSON.stringify(row));
  liveScoreMedicion(row, editFormShape(row, { raw: { tons: 99 } }));
  assert.deepEqual(row, snapshot, '_editing must survive a live re-score untouched');
});
