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

// ── Bayesian-style posterior slope (§5.4) ────────────────────────────
// Precision-weighted Gaussian combine. Handles V=0 (tau2=Infinity) and
// degenerate data variance gracefully.
export function bayesianCombine({ betaHat, sigmaBeta2, betaHist, tau2Hist }) {
  const dataPrec = sigmaBeta2 > 0 ? 1 / sigmaBeta2 : Infinity;
  const priorPrec = (betaHist != null && Number.isFinite(tau2Hist) && tau2Hist > 0)
    ? 1 / tau2Hist
    : 0;
  const totPrec = dataPrec + priorPrec;
  if (!Number.isFinite(totPrec) || totPrec === 0) {
    return { betaPost: betaHat, sigmaBeta2Post: sigmaBeta2 };
  }
  const sigmaBeta2Post = 1 / totPrec;
  const numerator = (Number.isFinite(dataPrec) ? betaHat * dataPrec : betaHat * 1e18)
                  + (priorPrec > 0 ? betaHist * priorPrec : 0);
  const denom    = Number.isFinite(dataPrec) ? (dataPrec + priorPrec) : (1e18 + priorPrec);
  const betaPost = numerator / denom;
  return { betaPost, sigmaBeta2Post };
}

// ── ETA solve (§5.5) ────────────────────────────────────────────────
// Returns days FROM t_today until the fitted line crosses `target`.
// Negative result is clamped to 0 (already past target); β≤0 returns Infinity.
export function etaDays({ alpha, beta, tToday, target }) {
  if (!Number.isFinite(beta) || beta <= 0) return Infinity;
  const yhatToday = alpha + beta * tToday;
  const days = (target - yhatToday) / beta;
  return days < 0 ? 0 : days;
}

// ── Confidence band (§5.6) ──────────────────────────────────────────
// σ_eta is RMS of (regression noise at today) and (extrapolation noise
// proportional to horizon). Returns ±days (1.96·σ_eta).
export function confidenceBand({
  sigma2, n, tToday, tBarW, sumWttBar2,
  betaPost, sigmaBeta2Post, horizonDays,
}) {
  if (!Number.isFinite(betaPost) || betaPost === 0) return Infinity;
  const sigmaYhat2 = sigma2 * (1 / n + ((tToday - tBarW) ** 2) / sumWttBar2);
  const noiseTerm = Math.sqrt(Math.max(0, sigmaYhat2)) / Math.abs(betaPost);
  const horizonTerm = (Math.abs(horizonDays) * Math.sqrt(sigmaBeta2Post))
                    / Math.abs(betaPost);
  const sigmaEta = Math.sqrt(noiseTerm ** 2 + horizonTerm ** 2);
  return 1.96 * sigmaEta;
}

// ── Confidence label (§5.7) ──────────────────────────────────────────
export function confidenceLabel({ V, nCurrent, horizonDays }) {
  const freshnessScore = Math.min(1, nCurrent / 6);
  const horizonPenalty = Math.max(0, 1 - horizonDays / 60);
  let score;
  if (V > 0) {
    const trainingScore = Math.min(1, V / 5);
    score = trainingScore * freshnessScore * horizonPenalty;
  } else {
    score = freshnessScore * horizonPenalty;
  }
  let label = score >= 0.66 ? 'Alta' : score >= 0.33 ? 'Media' : 'Baja';
  if (V === 0 && label === 'Alta') label = 'Media';
  return label;
}

// ── Effective target resolution (§5.1) ───────────────────────────────
// override fields are nullable; null/undefined falls back to the rubric.
// rubric is the per-(variety,valley) entry from CONFIG.rubrics.
export function resolveTarget({ rubric, override }) {
  const ovr = override || {};
  const rb = rubric?.params?.brix;
  const ra = rubric?.params?.anthocyanins;
  const brixLower  = ovr.brix_target_lower ?? rb?.a?.[0] ?? null;
  const brixUpper  = ovr.brix_upper        ?? rb?.a?.[1] ?? null;
  const brixTarget = ovr.brix_target
    ?? (rb?.a ? (rb.a[0] + rb.a[1]) / 2 : null);
  const antTarget  = ovr.anthocyanin_target ?? ra?.a ?? null;
  return { brixLower, brixUpper, brixTarget, antTarget };
}
