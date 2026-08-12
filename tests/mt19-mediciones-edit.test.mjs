// MT.19 — Mediciones edit helpers (pure functions, no DOM).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDirty, ariaSortFor, shouldShowSourceBanner,
  normalizeEvaluadorPanel, compactEvaluadorPanel, evaluadorPanelSummary,
  evaluadorPanelOptions, seedEvaluadorPanel,
} from '../js/mediciones.js';

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
