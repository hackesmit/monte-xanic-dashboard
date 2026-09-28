// Trend lines for the Explorador.
// Ordinary least-squares fit, pure and DOM-free so tests can import it directly.

function usable(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

// Fits y = slope * x + intercept over points shaped { x, y }. Points whose x
// or y is not a finite number are skipped. Returns null when there are fewer
// than 2 usable points or every point shares the same x (the line would be
// vertical and has no slope).
export function linearFit(points) {
  const pts = (points || []).filter(usable);
  const n = pts.length;
  if (n < 2) return null;

  let sx = 0, sy = 0, xMin = Infinity, xMax = -Infinity;
  for (const p of pts) {
    sx += p.x; sy += p.y;
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
  }
  // Centered sums keep the fit stable for large x values (e.g. vintages).
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  // All y equal: the flat line explains the data exactly.
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n, xMin, xMax };
}

// The two endpoints of the fitted line across the data's own x range.
export function trendEndpoints(fit) {
  return [
    { x: fit.xMin, y: fit.slope * fit.xMin + fit.intercept },
    { x: fit.xMax, y: fit.slope * fit.xMax + fit.intercept }
  ];
}

// Tooltip lines for a fit, e.g. "y = 0.124x + 18.30" and "R2 = 0.87, n = 42".
export function formatFit(fit) {
  const sign = fit.intercept < 0 ? '-' : '+';
  const slope = fit.slope !== 0 && Math.abs(fit.slope) < 0.001
    ? fit.slope.toExponential(2)
    : fit.slope.toFixed(3);
  return [
    `y = ${slope}x ${sign} ${Math.abs(fit.intercept).toFixed(2)}`,
    `R² = ${fit.r2.toFixed(2)}, n = ${fit.n}`
  ];
}
