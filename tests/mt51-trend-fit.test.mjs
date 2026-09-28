// MT.51: least-squares fit behind the Explorador trend line (js/trend.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { linearFit, trendEndpoints, formatFit } from '../js/trend.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

describe('linearFit', () => {
  it('recovers an exact line with R2 = 1', () => {
    const fit = linearFit([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }, { x: 3, y: 7 }]);
    close(fit.slope, 2); close(fit.intercept, 1); close(fit.r2, 1);
    assert.equal(fit.n, 4); assert.equal(fit.xMin, 0); assert.equal(fit.xMax, 3);
  });

  it('matches a hand-computed noisy fit', () => {
    // x mean 2, y mean 3.2; Sxx = 10, Sxy = 8, Syy = 10.8
    const fit = linearFit([{ x: 0, y: 1 }, { x: 1, y: 4 }, { x: 2, y: 2 }, { x: 3, y: 4 }, { x: 4, y: 5 }]);
    close(fit.slope, 0.8); close(fit.intercept, 1.6); close(fit.r2, 64 / 108);
  });

  it('stays accurate for large x values such as vintages', () => {
    const fit = linearFit([{ x: 2020, y: 24.1 }, { x: 2021, y: 24.6 }, { x: 2022, y: 25.1 }]);
    close(fit.slope, 0.5, 1e-9); close(fit.slope * 2021 + fit.intercept, 24.6, 1e-9);
  });

  it('skips points without finite x or y', () => {
    const fit = linearFit([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: NaN, y: 9 }, { x: 5, y: null }, null, { x: Infinity, y: 2 }]);
    assert.equal(fit.n, 2); close(fit.slope, 1);
  });

  it('returns null when a line cannot be fitted', () => {
    assert.equal(linearFit([]), null);
    assert.equal(linearFit(undefined), null);
    assert.equal(linearFit([{ x: 1, y: 2 }]), null);
    assert.equal(linearFit([{ x: 3, y: 1 }, { x: 3, y: 9 }]), null);
  });

  it('treats a flat series as a perfect fit', () => {
    const fit = linearFit([{ x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }]);
    close(fit.slope, 0); close(fit.r2, 1);
  });
});

describe('trendEndpoints and formatFit', () => {
  it('spans the data x range', () => {
    const pts = trendEndpoints({ slope: 2, intercept: 1, xMin: -1, xMax: 4 });
    assert.deepEqual(pts, [{ x: -1, y: -1 }, { x: 4, y: 9 }]);
  });

  it('formats the equation, R2 and n', () => {
    assert.deepEqual(formatFit({ slope: 0.1239, intercept: -18.3, r2: 0.871, n: 42 }),
      ['y = 0.124x - 18.30', 'R² = 0.87, n = 42']);
    assert.match(formatFit({ slope: 0.00004, intercept: 1, r2: 0, n: 3 })[0], /^y = 4\.00e-5x \+ 1\.00$/);
  });
});
