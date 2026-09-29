// MT.53: appellations outside Baja California are hidden (CONFIG.isForeignAppellation).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';

describe('isForeignAppellation', () => {
  it('flags California, Napa and Chile in any spelling', () => {
    for (const a of ['California', 'Napa', 'Napa Valley', 'NAPA VALLEY (Oakville)', 'Chile',
                     'Valle Central, Chile', 'Maipo (Chile)', 'Sonoma, California', 'chile ']) {
      assert.equal(CONFIG.isForeignAppellation(a), true, a);
    }
  });

  it('keeps Baja California and every Monte Xanic origin', () => {
    const keep = ['Baja California', 'Baja-California', 'Valle de Guadalupe, Baja California', ...Object.keys(CONFIG.originColors)];
    for (const a of keep) assert.equal(CONFIG.isForeignAppellation(a), false, a);
  });

  it('does not match inside other words and tolerates empty input', () => {
    for (const a of ['Chilecito', 'Napanee', 'Californiana', '', null, undefined]) {
      assert.equal(CONFIG.isForeignAppellation(a), false, String(a));
    }
  });

  it('agrees with normalizeAppellation output for the existing California entry', () => {
    assert.equal(CONFIG.isForeignAppellation(CONFIG.normalizeAppellation('California')), true);
    assert.equal(CONFIG.isForeignAppellation(CONFIG.normalizeAppellation('Valle de Guadalupe (Monte Xanic) ')), false);
  });
});
