// MT.42 — config.js mapping + normalization audit (bead xd-3k4)
//
// Locks in the invariants verified during the config.js audit so future
// edits cannot silently reintroduce drift:
//   - variety/appellation normalization is idempotent (no double-normalize bug)
//   - every normalized appellation output has a colour AND a point style
//   - grapeTypes ↔ varietyColors stay in sync; varietyAbbr codes stay valid
//   - bare-valley appellations always resolve to a real ranch, never leak
//     'Valle de ...' through to the UI
//
// Scope note: this file guards config-internal totality. The wine_samples
// `brix` schema-drift finding (config/validation/api reference a column with
// no committed migration) is tracked separately as its own bead.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';

const originKeys = new Set(Object.keys(CONFIG.originColors));
const styleKeys = new Set(Object.keys(CONFIG.originPointStyles));
const varietyColorKeys = new Set(Object.keys(CONFIG.varietyColors));
// 'California' is a WineXRay skip-appellation (never reaches the map views);
// it is intentionally colourless and falls back to a hashed colour.
const COLORLESS_OK = new Set(['California']);

describe('MT.42 — normalizeVariety', () => {
  it("remaps the legacy alias 'Petite Sirah' → 'Durif'", () => {
    assert.equal(CONFIG.normalizeVariety('Petite Sirah'), 'Durif');
  });

  it('is idempotent on every known variety (pass-through by design)', () => {
    for (const v of [...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white]) {
      assert.equal(CONFIG.normalizeVariety(v), v, `variety ${v} changed`);
    }
    assert.equal(CONFIG.normalizeVariety('Durif'), 'Durif');
  });

  it('passes an unknown variety through unchanged (non-validating)', () => {
    assert.equal(CONFIG.normalizeVariety('Zinfandel'), 'Zinfandel');
  });
});

describe('MT.42 — variety colour/classification consistency', () => {
  it('grapeTypes and varietyColors describe the same variety set', () => {
    const gt = new Set([...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white]);
    for (const v of gt) assert.ok(varietyColorKeys.has(v), `${v} has no varietyColor`);
    for (const v of varietyColorKeys) assert.ok(gt.has(v), `${v} colour has no grapeType`);
  });

  it('every varietyAbbr code resolves to a real variety colour', () => {
    for (const full of new Set(Object.values(CONFIG.varietyAbbr))) {
      assert.ok(varietyColorKeys.has(full), `varietyAbbr → ${full} has no colour`);
    }
  });
});

describe('MT.42 — normalizeAppellation idempotency', () => {
  it('returns every ranch-first name (originColors key) unchanged', () => {
    for (const k of originKeys) {
      assert.equal(CONFIG.normalizeAppellation(k), k, `appellation ${k} not idempotent`);
    }
  });

  it('returns every appellationFixes output unchanged on a second pass', () => {
    for (const out of new Set(Object.values(CONFIG.appellationFixes))) {
      assert.equal(CONFIG.normalizeAppellation(out), out, `output ${out} not idempotent`);
    }
  });
});

describe('MT.42 — every normalized appellation has colour + style', () => {
  it('appellationFixes outputs each have an originColor and originPointStyle', () => {
    for (const out of new Set(Object.values(CONFIG.appellationFixes))) {
      if (COLORLESS_OK.has(out)) continue;
      assert.ok(originKeys.has(out), `${out} has no originColor`);
      assert.ok(styleKeys.has(out), `${out} has no originPointStyle`);
    }
  });

  it('_codeToRanch and originAbbr targets are all real ranches', () => {
    for (const r of new Set(Object.values(CONFIG._codeToRanch))) {
      assert.ok(originKeys.has(r), `_codeToRanch → ${r} has no originColor`);
    }
    for (const r of new Set(Object.values(CONFIG.originAbbr))) {
      assert.ok(originKeys.has(r), `originAbbr → ${r} has no originColor`);
    }
  });
});

describe('MT.42 — bare-valley appellations always resolve to a real ranch', () => {
  // Representative sample ids for every ranch code the WineXRay/berry data
  // carries a bare 'Valle de ...' appellation for. None may leak the valley
  // string or an uncoloured ranch through to the UI.
  const cases = [
    ['25CSMX-1', 'Valle de Guadalupe'],
    ['25CSOLE-1', 'Valle de Guadalupe'],
    ['25SY7L-2', 'Valle de Guadalupe'],
    ['25R14CS-1', 'Valle de Guadalupe'],
    ['25CFVA-2B', 'Valle de Ojos Negros'],
    ['25CSON-3', 'Valle de Ojos Negros'],
    ['25KCS-S8-1', 'Valle de Ojos Negros'],
    ['25SYDA-L5', 'Valle de Ojos Negros'],
    ['25MADUB-1', 'Valle de Ojos Negros'],
  ];
  for (const [id, valley] of cases) {
    it(`${valley} + ${id} → a real ranch`, () => {
      const out = CONFIG.normalizeAppellation(valley, id);
      assert.ok(!/^Valle de/i.test(out), `leaked valley string: ${out}`);
      assert.ok(originKeys.has(out), `${out} is not a coloured ranch`);
    });
  }

  it('falls back to a valley default when the code is unresolvable', () => {
    assert.equal(CONFIG.normalizeAppellation('Valle de Guadalupe', '25ZZ-9'), 'Monte Xanic (VDG)');
    assert.equal(CONFIG.normalizeAppellation('Valle de Ojos Negros', '25ZZ-9'), 'Ojos Negros (VON)');
  });
});
