// MT.19 — Mediciones edit helpers (pure functions, no DOM).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { collectDirty, ariaSortFor, shouldShowSourceBanner } from '../js/mediciones.js';

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
