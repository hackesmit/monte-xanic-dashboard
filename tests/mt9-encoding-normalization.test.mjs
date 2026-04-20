// MT.9 — Appellation encoding normalization
// Tests CONFIG.normalizeAppellation handles U+FFFD replacement characters,
// double-encoded UTF-8 mojibake (Ã±, Ã©, …), and direct appellation mapping.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';

describe('MT.9 — normalizeAppellation: U+FFFD replacement characters', () => {
  it('Vi\uFFFDa → Viña (when inside ranch-first format)', () => {
    assert.equal(CONFIG.normalizeAppellation('Vi\uFFFDa Alta (VON)'), 'Viña Alta (VON)');
  });

  it('Ger\uFFFDnimo → Gerónimo', () => {
    assert.equal(CONFIG.normalizeAppellation('San Ger\uFFFDnimo'), 'San Gerónimo');
  });

  it('Coraz\uFFFDn → Corazón', () => {
    assert.equal(CONFIG.normalizeAppellation('Camino Coraz\uFFFDn (VP)'), 'Camino Corazón (VP)');
  });

  it('Ol\uFFFD → Olé (prefix match)', () => {
    assert.equal(CONFIG.normalizeAppellation('Ol\uFFFD (VDG)'), 'Olé (VDG)');
  });

  it('strips residual U+FFFD after known substitutions', () => {
    const out = CONFIG.normalizeAppellation('Algo\uFFFDRaro');
    assert.ok(!out.includes('\uFFFD'), 'residual replacement chars must be stripped');
    assert.equal(out, 'AlgoRaro');
  });
});

describe('MT.9 — normalizeAppellation: double-encoded UTF-8 mojibake', () => {
  it('Ã± → ñ', () => {
    assert.equal(CONFIG.normalizeAppellation('Vi\u00C3\u00B1a Alta (VON)'), 'Viña Alta (VON)');
  });

  it('Ã© → é', () => {
    assert.equal(CONFIG.normalizeAppellation('Ol\u00C3\u00A9 (VDG)'), 'Olé (VDG)');
  });

  it('Ã³ → ó (used in Gerónimo, Corazón)', () => {
    assert.equal(CONFIG.normalizeAppellation('San Ger\u00C3\u00B3nimo'), 'San Gerónimo');
  });

  it('Ã­ → í', () => {
    assert.equal(CONFIG.normalizeAppellation('Camino M\u00C3\u00ADo'), 'Camino Mío');
  });

  it('Ãº → ú', () => {
    assert.equal(CONFIG.normalizeAppellation('Jes\u00C3\u00BAs'), 'Jesús');
  });

  it('Ã‘ → Ñ (capital)', () => {
    assert.equal(CONFIG.normalizeAppellation('Vi\u00C3\u0091A'), 'ViÑA');
  });

  it('does not alter strings without U+00C3 trigger', () => {
    assert.equal(CONFIG.normalizeAppellation('Plain ASCII Text'), 'Plain ASCII Text');
  });
});

describe('MT.9 — normalizeAppellation: direct-mapping fixes', () => {
  it('old long form → ranch-first short form (Monte Xanic)', () => {
    assert.equal(
      CONFIG.normalizeAppellation('Valle de Guadalupe (Monte Xanic)'),
      'Monte Xanic (VDG)'
    );
  });

  it('unaccented Ole variant maps to accented canonical', () => {
    assert.equal(CONFIG.normalizeAppellation('Valle de Guadalupe (Ole)'), 'Olé (VDG)');
  });

  it('Vina Alta (unaccented) maps to Viña Alta (VON)', () => {
    assert.equal(CONFIG.normalizeAppellation('Valle de Ojos Negros (Vina Alta)'), 'Viña Alta (VON)');
  });

  it('San Geronimo maps to San Gerónimo', () => {
    assert.equal(CONFIG.normalizeAppellation('San Geronimo'), 'San Gerónimo');
  });
});

describe('MT.9 — normalizeAppellation: edge cases', () => {
  it('null input → null (no crash)', () => {
    assert.equal(CONFIG.normalizeAppellation(null), null);
  });

  it('empty string → empty string', () => {
    assert.equal(CONFIG.normalizeAppellation(''), '');
  });

  it('already-normalized input is idempotent', () => {
    const already = 'Viña Alta (VON)';
    assert.equal(CONFIG.normalizeAppellation(already), already);
  });

  it('bare "Valle de Guadalupe" resolves via sampleId ranch code', () => {
    // 25CSMX-1 → MX code → "Monte Xanic (VDG)" per _codeToRanch
    const out = CONFIG.normalizeAppellation('Valle de Guadalupe', '25CSMX-1');
    assert.ok(out && out !== 'Valle de Guadalupe', 'should resolve to a ranch-specific appellation');
  });

  it('bare "Valle de Guadalupe" without sampleId falls back to Monte Xanic (VDG)', () => {
    assert.equal(CONFIG.normalizeAppellation('Valle de Guadalupe'), 'Monte Xanic (VDG)');
  });

  it('bare "Valle de Ojos Negros" without sampleId falls back to Ojos Negros (VON)', () => {
    assert.equal(CONFIG.normalizeAppellation('Valle de Ojos Negros'), 'Ojos Negros (VON)');
  });
});
