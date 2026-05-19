// js/prediction.js
// Harvest-readiness predictor. Pure functions. No DOM, no network,
// no module-level side effects.
// See docs/superpowers/specs/2026-05-19-harvest-predictor-design.md

// ── Weighted linear regression (§5.2) ────────────────────────────────
// Input: array of { t, y, w }. Output: fit + diagnostics needed downstream.
// Weights are normalised so Σwᵢ = n, keeping (n - 2) as the σ̂² denominator.
export function weightedRegression(samples) {
  const n = samples.length;
  if (n < 2) {
    return { alpha: NaN, beta: NaN, sigma2: NaN, sigmaBeta2: NaN,
             n, tBarW: NaN, sumWttBar2: NaN };
  }
  const sumW = samples.reduce((s, p) => s + p.w, 0);
  if (sumW <= 0) {
    return { alpha: NaN, beta: NaN, sigma2: NaN, sigmaBeta2: NaN,
             n, tBarW: NaN, sumWttBar2: NaN };
  }
  // Normalise weights so Σw = n
  const norm = n / sumW;
  const w = samples.map(p => p.w * norm);

  let sumWt = 0, sumWy = 0;
  for (let i = 0; i < n; i++) {
    sumWt += w[i] * samples[i].t;
    sumWy += w[i] * samples[i].y;
  }
  const tBarW = sumWt / n;
  const yBarW = sumWy / n;

  let sumWttBar2 = 0, sumWtybar = 0;
  for (let i = 0; i < n; i++) {
    const dt = samples[i].t - tBarW;
    const dy = samples[i].y - yBarW;
    sumWttBar2 += w[i] * dt * dt;
    sumWtybar  += w[i] * dt * dy;
  }
  if (sumWttBar2 === 0) {
    return { alpha: NaN, beta: NaN, sigma2: NaN, sigmaBeta2: NaN,
             n, tBarW, sumWttBar2 };
  }
  const beta  = sumWtybar / sumWttBar2;
  const alpha = yBarW - beta * tBarW;

  // Residual variance
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const eHat = samples[i].y - (alpha + beta * samples[i].t);
    ssr += w[i] * eHat * eHat;
  }
  const denom = n - 2;
  const sigma2 = denom > 0 ? ssr / denom : 0;
  const sigmaBeta2 = sigma2 / sumWttBar2;

  return { alpha, beta, sigma2, sigmaBeta2, n, tBarW, sumWttBar2 };
}

// ── Historical slope prior (§5.3) ────────────────────────────────────
// Per prior vintage, fit OLS on the last 21 days before the vintage's
// max-y sample. Drop vintages with <3 samples in that window. Return
// mean slope (prior mean) and sample variance (prior variance, τ²).
export function historicalSlopePrior(vintages) {
  const slopes = [];
  for (const samples of vintages) {
    if (!samples || samples.length === 0) continue;
    const tMax = Math.max(...samples.map(s => s.t));
    const windowed = samples
      .filter(s => s.t >= tMax - 21 && s.t <= tMax)
      .map(s => ({ ...s, w: 1 }));
    if (windowed.length < 3) continue;
    const { beta } = weightedRegression(windowed);
    if (Number.isFinite(beta)) slopes.push(beta);
  }
  const V = slopes.length;
  if (V === 0) return { betaHist: null, tau2Hist: Infinity, V: 0 };
  const mean = slopes.reduce((a, b) => a + b, 0) / V;
  // Sample variance (Bessel-corrected when V > 1; tiny epsilon when V = 1)
  let varSum = 0;
  for (const s of slopes) varSum += (s - mean) ** 2;
  const tau2Hist = V > 1 ? varSum / (V - 1) : 1e-6;
  return { betaHist: mean, tau2Hist, V };
}
