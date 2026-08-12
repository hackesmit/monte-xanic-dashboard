// MT.19 — Mediciones edit helpers (pure functions, no DOM).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDirty, ariaSortFor, shouldShowSourceBanner,
  normalizeEvaluadorPanel, compactEvaluadorPanel, evaluadorPanelSummary,
  evaluadorPanelOptions,
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
