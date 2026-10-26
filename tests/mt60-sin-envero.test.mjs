// MT.60 — the "Sin envero" column of the maturity timelines (xd-ayv).
// A 2026 lot whose Seguimiento workbook carries no Fecha de envero has
// days_post_crush null. It must stay visible in its own column, never get an
// invented day count, and never move the dated points.
// tests/e2e/sin-envero.spec.js proves the charts draw it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIN_ENVERO_LABEL, hasEnvero, sinEnveroRows, sinEnveroColumn,
  sinEnveroAxis, sinEnveroTicks, sinEnveroTickLabel, fechaMuestra,
} from '../js/sinEnvero.js';

describe('MT.60 — which readings go in the column', () => {
  it('a numeric day count has an envero, null/undefined/NaN do not', () => {
    assert.equal(hasEnvero({ daysPostCrush: 0 }), true);
    assert.equal(hasEnvero({ daysPostCrush: -7 }), true);
    assert.equal(hasEnvero({ daysPostCrush: null }), false);
    assert.equal(hasEnvero({}), false);
    assert.equal(hasEnvero({ daysPostCrush: NaN }), false);
    assert.equal(hasEnvero(null), false);
  });

  it('keeps undated readings that carry a value, and only those', () => {
    const rows = [
      { sampleId: 'A', daysPostCrush: 10, brix: 20 },
      { sampleId: 'B', daysPostCrush: null, brix: 19.4 },
      { sampleId: 'C', daysPostCrush: null, brix: null },
      { sampleId: 'D', brix: 21 },
    ];
    assert.deepEqual(sinEnveroRows(rows, 'brix').map(r => r.sampleId), ['B', 'D']);
    assert.deepEqual(sinEnveroRows(rows, 'pH'), []);
    assert.deepEqual(sinEnveroRows(undefined, 'brix'), []);
  });
});

describe('MT.60 — where the column sits', () => {
  it('stands left of the earliest dated point by at least five days', () => {
    // Production 2026 span is 6..65 days.
    const c = sinEnveroColumn([6, 30, 65]);
    assert.ok(c.gap >= 5);
    assert.ok(c.x <= 6 - 5);
    assert.equal(c.x, 6 - c.gap);
  });

  it('widens the gap with the span so it reads as separate', () => {
    const c = sinEnveroColumn([0, 200]);
    assert.equal(c.gap, 20);
    assert.equal(c.x, -20);
  });

  it('respects negative day counts (pre-veraison sampling is real)', () => {
    const c = sinEnveroColumn([-16, 40]);
    assert.ok(c.x < -16);
  });

  it('stands alone at 0 when no reading has an envero', () => {
    assert.deepEqual(sinEnveroColumn([]), { x: 0, gap: 5 });
    assert.deepEqual(sinEnveroColumn([null, NaN]), { x: 0, gap: 5 });
  });
});

describe('MT.60 — the axis', () => {
  const column = { x: -5, gap: 10 };

  it('puts one tick on the column and drops auto ticks inside the gap', () => {
    const ticks = [-10, -5, 0, 10, 20].map(value => ({ value }));
    assert.deepEqual(sinEnveroTicks(ticks, column).map(t => t.value), [-5, 0, 10, 20]);
  });

  it('labels the column tick and leaves day ticks as numbers', () => {
    assert.equal(sinEnveroTickLabel(-5, column), SIN_ENVERO_LABEL);
    assert.equal(sinEnveroTickLabel(10, column), 10);
    assert.equal(SIN_ENVERO_LABEL, 'Sin envero');
  });

  it('keeps the base axis styling and starts half a gap before the column', () => {
    const base = { title: { text: 'Días Post-Envero' }, ticks: { color: '#888', maxTicksLimit: 6 }, grid: { color: '#222' } };
    const ax = sinEnveroAxis(base, column);
    assert.equal(ax.min, -10);
    assert.equal(ax.title.text, 'Días Post-Envero');
    assert.equal(ax.ticks.color, '#888');
    assert.equal(ax.ticks.maxTicksLimit, 6);
    assert.equal(ax.grid.color, '#222');
    assert.equal(ax.ticks.callback(-5), 'Sin envero');
    const axis = { ticks: [{ value: -10 }, { value: 0 }, { value: 20 }] };
    ax.afterBuildTicks(axis);
    assert.deepEqual(axis.ticks.map(t => t.value), [-5, 0, 20]);
    assert.equal(ax.grid.lineWidth({ tick: { value: -5 } }), 1.5);
    assert.equal(ax.grid.lineWidth({ tick: { value: 0 } }), 1);
    // The base object is not mutated.
    assert.equal(base.min, undefined);
    assert.equal(base.ticks.callback, undefined);
  });
});

describe('MT.60 — tooltip date', () => {
  it('formats a string or a Date sample date, and nothing else', () => {
    assert.equal(fechaMuestra({ sampleDate: '2026-08-03' }), '2026-08-03');
    assert.equal(fechaMuestra({ sampleDate: '2026-08-03T00:00:00Z' }), '2026-08-03');
    assert.equal(fechaMuestra({ sampleDate: new Date(Date.UTC(2026, 7, 3)) }), '2026-08-03');
    assert.equal(fechaMuestra({ sampleDate: new Date('x') }), null);
    assert.equal(fechaMuestra({}), null);
  });
});
