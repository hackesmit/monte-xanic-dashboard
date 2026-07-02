import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChartSpec, validateTableSpec } from '../js/mona/chartSpec.js';

const good = {
  type: 'line', title: 'Evolución °Bx', xLabel: 'Días', yLabel: '°Bx',
  series: [{ label: 'Viña Grande', points: [{ x: 0, y: 24.1 }, { x: 5, y: 25 }] }],
};

test('valid chart passes', () => {
  const r = validateChartSpec(good);
  assert.equal(r.ok, true);
  assert.equal(r.spec.series[0].points[1].y, 25);
});

test('bad type rejected', () => {
  assert.equal(validateChartSpec({ ...good, type: 'radar3d' }).ok, false);
});

test('too many series rejected', () => {
  const series = Array.from({ length: 13 }, (_, i) => ({ label: `s${i}`, points: [{ x: 0, y: 1 }] }));
  assert.equal(validateChartSpec({ ...good, series }).ok, false);
});

test('coerces numeric strings', () => {
  const r = validateChartSpec({ ...good, series: [{ label: 'a', points: [{ x: '1', y: '2.5' }] }] });
  assert.equal(r.spec.series[0].points[0].y, 2.5);
});

test('preserves categorical x labels for bar/line', () => {
  const r = validateChartSpec({
    type: 'bar', title: 'Por variedad',
    series: [{ label: 'Brix', points: [{ x: 'Cabernet Sauvignon', y: 24 }, { x: 'Durif', y: 22 }] }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.spec.series[0].points[0].x, 'Cabernet Sauvignon');
});

test('scatter drops points with non-numeric x', () => {
  const r = validateChartSpec({
    type: 'scatter', title: 'xy',
    series: [{ label: 'a', points: [{ x: 'no', y: 1 }, { x: 3, y: 2 }] }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.spec.series[0].points.length, 1);
  assert.equal(r.spec.series[0].points[0].x, 3);
});

test('table valid', () => {
  const r = validateTableSpec({ title: 'T', columns: [{ key: 'v', label: 'Variedad' }], rows: [{ v: 'Durif' }] });
  assert.equal(r.ok, true);
});

test('table too many columns rejected', () => {
  const columns = Array.from({ length: 21 }, (_, i) => ({ key: `c${i}`, label: `c${i}` }));
  assert.equal(validateTableSpec({ title: 'T', columns, rows: [] }).ok, false);
});
