// js/prediction.js
// Harvest-readiness predictor. Pure functions. No DOM, no network,
// no module-level side effects.
// See docs/superpowers/specs/2026-05-19-harvest-predictor-design.md

// Strict finite parse for berry-sample fields. Number(null), Number(undefined)
// and Number('') all return a *finite* 0, which would let a blank Brix/ant/pH
// reading survive the `Number.isFinite` guards as a fabricated 0 measurement
// and silently corrupt the regression. Reject nullish and blank/whitespace
// strings before coercion so a missing reading becomes NaN and is dropped.
function toFiniteReading(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'string' && v.trim() === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Pick the first alias that parses to a *finite* reading. The `??` operator only
// falls through on null/undefined, so a blank-string primary alias ('') would be
// selected over a valid numeric fallback, yielding NaN and silently discarding a
// real observation. Parse each alias strictly and take the first finite result.
function firstFiniteReading(...values) {
  for (const v of values) {
    const n = toFiniteReading(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

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

// A lone historical vintage gives no way to estimate between-vintage slope
// variability, so its prior variance cannot be a real sample variance. The old
// code used a tiny epsilon (1e-6) there — a prior precision of 1e6 that pinned
// the posterior to the single historical slope and discarded the current season
// entirely. Instead treat one vintage as a *weak* prior: its slope standard
// deviation is ~1.5× the slope magnitude itself (CV ≈ 150%). Because it scales
// with the slope, it is unit-invariant across Brix / ANT / pH and never
// dominates a real current-season fit.
const SINGLE_VINTAGE_SLOPE_CV = 1.5;
//
// FINDING 1 (variance floor still pinned the posterior). The earlier fix floored
// the ≥2-vintage variance at (0.05·mean)² — a 5 % CV, which is an *extremely
// strong* prior, not a robustness floor: two vintages that both fit to slope
// 0.05 gave τ²≈6.25e-6 (precision 160 000) and re-pinned the posterior to
// 0.050094, the very failure this bead exists to prevent. That floor is removed.
// The anti-pinning guarantee now lives in bayesianCombine, which BOUNDS the
// prior's precision by the current season's own precision (chosen option 3 of
// the three the reviewer offered: it preserves genuinely diverse multi-vintage
// information — a variance floor or dedup throws that away — while capping the
// degenerate case). With ≥2 vintages we now use the raw Bessel sample variance;
// a collapsed variance from near-duplicate vintages can no longer dominate.
//
// FINDING 2 (near-zero mean). Deriving a proportional prior variance from a
// near-zero mean slope makes prior precision arbitrarily large (a lone slope of
// 1e-6 → τ²≈2.25e-12 → precision ≈4e11) and pins the posterior to a meaningless
// ~0 slope; the old guard only caught an *exactly* zero mean. We now treat any
// mean below a metric-specific absolute slope scale as uninformative (prior
// precision 0). The scale is supplied per metric by the caller (see the
// *_SLOPE_SCALE constants in computeOne).
export function historicalSlopePrior(vintages, { slopeScale = 0, slopeMax = Infinity } = {}) {
  const slopes = [];
  // FINDING (round 2): metric-impossible corrupt vintages. A pair of historical
  // slopes like 100 and 100.000001 Bx/day are near-identical (tiny variance, so
  // the between-vintage precision cap does not flag them) yet each is orders of
  // magnitude beyond any real ripening rate. Left in, they take ~half the
  // posterior weight and drag it to a meaningless ~50 Bx/day. Reject any slope
  // whose magnitude exceeds the metric's plausible bound (slopeMax, supplied by
  // the caller — see the *_SLOPE_MAX constants) BEFORE it can inform the prior,
  // and report the rejected slopes so the exclusion is visible, not silent.
  const excludedSlopes = [];
  for (const rawSamples of vintages) {
    const samples = (rawSamples || []).filter(s => Number.isFinite(s.y));
    if (samples.length === 0) continue;
    // Anchor the window at the max-y sample (per spec §5.3), not the last
    // sample: vintages with a post-peak declining tail would otherwise fit
    // the prior over the wrong window and bias the slope low.
    let tMax = samples[0].t, yMax = samples[0].y;
    for (const s of samples) {
      if (s.y > yMax) { yMax = s.y; tMax = s.t; }
    }
    const windowed = samples
      .filter(s => s.t >= tMax - 21 && s.t <= tMax)
      .map(s => ({ ...s, w: 1 }));
    if (windowed.length < 3) continue;
    const { beta } = weightedRegression(windowed);
    if (!Number.isFinite(beta)) continue;
    if (Math.abs(beta) > slopeMax) { excludedSlopes.push(beta); continue; }
    slopes.push(beta);
  }
  const V = slopes.length;
  if (V === 0) return { betaHist: null, tau2Hist: Infinity, V: 0, excludedSlopes };
  const mean = slopes.reduce((a, b) => a + b, 0) / V;
  const magnitude = Math.abs(mean);
  // FINDING 2: a mean slope at or below the metric's meaningful scale is noise,
  // not a ripening trend. Return an uninformative prior (τ²=Infinity ⇒ prior
  // precision 0) instead of manufacturing an arbitrarily strong prior from it.
  if (!(magnitude > slopeScale)) {
    return { betaHist: mean, tau2Hist: Infinity, V, excludedSlopes };
  }
  let tau2Hist;
  if (V > 1) {
    // Raw Bessel-corrected between-vintage sample variance (FINDING 1: no
    // artificial floor). A collapsed variance from near-duplicate vintages
    // would imply a strong prior, but bayesianCombine caps the prior precision
    // at the current season's, so it can no longer pin the posterior.
    let varSum = 0;
    for (const s of slopes) varSum += (s - mean) ** 2;
    tau2Hist = varSum / (V - 1);
  } else {
    // V === 1: weak, scale-invariant prior (see SINGLE_VINTAGE_SLOPE_CV).
    tau2Hist = (SINGLE_VINTAGE_SLOPE_CV * magnitude) ** 2;
  }
  // Identical (copied) vintages give an exactly-zero sample variance and hence
  // an infinite prior precision; treat that as uninformative too.
  if (!(tau2Hist > 0)) tau2Hist = Infinity;
  return { betaHist: mean, tau2Hist, V, excludedSlopes };
}

// ── Bayesian-style posterior slope (§5.4) ────────────────────────────
// Precision-weighted Gaussian combine. Handles V=0 (tau2=Infinity) and
// degenerate data variance gracefully.
export function bayesianCombine({ betaHat, sigmaBeta2, betaHist, tau2Hist }) {
  const dataPrec = sigmaBeta2 > 0 ? 1 / sigmaBeta2 : Infinity;
  const rawPriorPrec = (betaHist != null && Number.isFinite(tau2Hist) && tau2Hist > 0)
    ? 1 / tau2Hist
    : 0;
  // FINDING 1: bound the prior's precision by the current season's own precision
  // so the historical prior can INFORM the posterior but never DOMINATE it. A
  // degenerate between-vintage variance (near-duplicate or copied vintages)
  // otherwise yields an arbitrarily large prior precision that pins the posterior
  // to the historical slope and discards the current season — exactly what this
  // bead prevents. Capping at dataPrec guarantees the current season keeps ≥50 %
  // of the posterior weight. When dataPrec is Infinity (a perfect current fit)
  // the data already dominates, so no cap is applied.
  const priorPrec = Number.isFinite(dataPrec)
    ? Math.min(rawPriorPrec, dataPrec)
    : rawPriorPrec;
  // Precision-sum overflow guard: both precisions are finite but so large that
  // their sum overflows to Infinity (e.g. ~1e308 each). The generic fallback
  // below would then treat totPrec as non-finite and silently return the raw
  // current fit, discarding a legitimate prior. Rescale by the larger precision
  // so the weighted mean stays finite and correct.
  if (Number.isFinite(dataPrec) && Number.isFinite(priorPrec)
      && dataPrec > 0 && priorPrec > 0 && !Number.isFinite(dataPrec + priorPrec)) {
    const s = Math.max(dataPrec, priorPrec);
    const dp = dataPrec / s, pp = priorPrec / s;
    return { betaPost: (betaHat * dp + betaHist * pp) / (dp + pp),
             sigmaBeta2Post: 1 / (dataPrec + priorPrec) };
  }
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
  const base = freshnessScore * horizonPenalty;
  let score;
  if (V > 0) {
    const trainingScore = Math.min(1, V / 5);
    // Monotonicity guard: a couple of historical vintages must never yield
    // a WORSE label than having none (the V=0 branch skips trainingScore
    // entirely and only caps the label at 'Media'). Floor the score at the
    // V=0 score, clamped just below the 'Alta' threshold so deep training
    // history is still required to reach 'Alta'.
    score = Math.max(trainingScore * base, Math.min(base, 0.65));
  } else {
    score = base;
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
  const rp = rubric?.params?.pH;
  const brixLower  = ovr.brix_target_lower ?? rb?.a?.[0] ?? null;
  const brixUpper  = ovr.brix_upper        ?? rb?.a?.[1] ?? null;
  const brixTarget = ovr.brix_target
    ?? (rb?.a ? (rb.a[0] + rb.a[1]) / 2 : null);
  const antTarget  = ovr.anthocyanin_target ?? ra?.a ?? null;
  // pH is only consumed by the predictor when the rubric has NO anthocyanins
  // (i.e., whites). Reds keep phTarget = null even though their rubric has pH.
  const phTarget   = ovr.ph_target ?? ((rp && !ra) ? rp.a : null);
  return { brixLower, brixUpper, brixTarget, antTarget, phTarget };
}

// ── Edge-case detection (§5.8) ───────────────────────────────────────
// Returns a reason string or null. Order matters: pocos-datos checked
// at the caller before regression runs (so n is real here).
export function detectEdgeCase({
  yhatBrixToday, yhatAntToday, yhatPhToday,
  betaPostBrix, betaPostAnt, betaPostPh,
  brixLower, brixUpper, antTarget, phTarget,
  brixMidEta, brixLowerEta, antEta, phEta, brixWindowCloses,
}) {
  if (betaPostBrix <= 0) return 'sin-tendencia-positiva';

  // Already past the upper Brix limit and still climbing ⇒ over-ripe. Without
  // this, etaDays clamps the negative ETA to 0, so both brixMidEta and
  // brixWindowCloses collapse to 0, the downstream `mid > closes` test is false,
  // and the lot renders as a normal in-window pick. Checked after each mode's
  // stalled-metric signal (ph-excedido / antocianinas-estancadas) so those keep
  // precedence, but before the in-window / window-close logic.
  const brixOverRipe = brixUpper != null && yhatBrixToday > brixUpper;

  // White-mode checks (phTarget != null AND antTarget == null)
  if (phTarget != null && antTarget == null) {
    if (yhatPhToday > phTarget) return 'ph-excedido';
    if (brixOverRipe) return 'riesgo-sobremadurez';
    const brixInWindow = yhatBrixToday >= brixLower && yhatBrixToday <= brixUpper;
    if (brixInWindow) return 'ya-en-ventana';
    if (Number.isFinite(phEta) && Number.isFinite(brixLowerEta)
        && phEta < brixLowerEta) return 'ph-temprano';
    const effectiveCloses = Math.min(
      Number.isFinite(brixWindowCloses) ? brixWindowCloses : Infinity,
      Number.isFinite(phEta) ? phEta : Infinity
    );
    if (Number.isFinite(effectiveCloses) && brixMidEta > effectiveCloses) {
      return 'riesgo-sobremadurez';
    }
    if (Number.isFinite(phEta) && phEta < brixMidEta) return 'riesgo-ph';
    return null;
  }

  // Red-mode checks (existing behavior)
  if (antTarget != null && betaPostAnt <= 0) return 'antocianinas-estancadas';
  if (brixOverRipe) return 'riesgo-sobremadurez';
  const brixInWindow = yhatBrixToday >= brixLower && yhatBrixToday <= brixUpper;
  const antOver      = antTarget == null || (yhatAntToday >= antTarget);
  if (brixInWindow && antOver) return 'ya-en-ventana';
  if (antEta != null && Number.isFinite(antEta)
      && Number.isFinite(brixWindowCloses)
      && antEta > brixWindowCloses) return 'no-alcanzar-A';
  const recommendedEta = antEta != null ? Math.max(brixMidEta, antEta) : brixMidEta;
  if (Number.isFinite(brixWindowCloses) && recommendedEta > brixWindowCloses) {
    return 'riesgo-sobremadurez';
  }
  return null;
}

// Per-metric absolute daily-slope scales (FINDING 2). A historical mean slope
// at or below these is numerical noise, not a ripening trend, and is passed to
// historicalSlopePrior as `slopeScale` so it becomes an uninformative prior
// rather than an arbitrarily strong one. Set an order of magnitude below the
// smallest genuine trend each metric shows, so real signals are never rejected.
const BRIX_SLOPE_SCALE = 0.01;    // Bx/day   (real ripening ≈ 0.1–0.3)
const ANT_SLOPE_SCALE  = 0.1;     // mg/L/day (real accrual ≈ 5–20)
const PH_SLOPE_SCALE   = 0.0005;  // pH/day   (real rise ≈ 0.005–0.02)

// Per-metric UPPER plausible daily-slope bounds (FINDING, round 2). A historical
// mean slope whose magnitude exceeds these is metric-impossible — a corrupt
// vintage, not a ripening trend — and is rejected in historicalSlopePrior before
// it can inform the prior (passed as `slopeMax`). Set several times above the
// fastest genuine trend each metric shows, so a real fast vintage is never
// dropped, but orders of magnitude below the corrupt values this guards against.
const BRIX_SLOPE_MAX = 2.0;       // Bx/day   (fastest real ripening ≲ 0.5)
const ANT_SLOPE_MAX  = 200;       // mg/L/day (fastest real accrual ≲ 20)
const PH_SLOPE_MAX   = 0.2;       // pH/day   (fastest real rise ≲ 0.02)

// ── computeOne orchestrator (§5.5) ───────────────────────────────────
// Inputs:
//   current:              [{ sampleDate (ISO string|Date), tDays, brix, ant }]
//   historicalByVintage:  [ [{ tDays, brix, ant }], ... ]
//   target:               { brixLower, brixUpper, brixTarget, antTarget|null }
//   today:                Date instance
//   recencyBoostWindow:   default 14 days, last-N samples get weight 1.5
// Output: { reason, recommendedDate|null, brixWindowCloses|null,
//           bandDays|Infinity, label, nCurrent, V, brixHoy, antHoy,
//           samplesProjected:{ brixEta, antEta } }
export function computeOne({
  current, historicalByVintage, target, today,
  recencyBoostWindow = 14,
}) {
  const nCurrent = current.length;
  // FINDING 4: the DISPLAYED current reading must be deterministic regardless of
  // input row order. The old fallback took `sorted[last]` and read its raw brix/
  // ant/pH, but a stable sort leaves same-timestamp rows in input order, so a
  // duplicate-date pair (22.0, 22.5) surfaced whichever row happened to be last —
  // 22.5 in one order, 22.0 in the other. Resolve every reading at the latest
  // timestamp by mean: order-independent and representative of the day.
  const latestReading = (samples) => {
    if (!samples || samples.length === 0) return { brix: null, ant: null, pH: null };
    let maxT = -Infinity;
    for (const s of samples) if (s.tDays > maxT) maxT = s.tDays;
    const atLatest = samples.filter(s => s.tDays === maxT);
    const meanOf = (key) => {
      const vals = atLatest.map(s => s[key]).filter(Number.isFinite);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    return { brix: meanOf('brix'), ant: meanOf('ant'), pH: meanOf('pH') };
  };
  const pocosDatos = (samples) => {
    const r = latestReading(samples);
    return {
      reason: 'pocos-datos-temporada',
      recommendedDate: null, brixWindowCloses: null,
      bandDays: Infinity, label: 'Baja',
      nCurrent, V: 0,
      brixHoy: r.brix, antHoy: r.ant, phHoy: r.pH,
      samplesProjected: { brixEta: null, antEta: null, phEta: null },
    };
  };
  if (nCurrent < 2) return pocosDatos(current);

  // Order by tDays asc; the last entry's tDays is "today's t"
  const sorted = [...current].sort((a, b) => a.tDays - b.tDays);
  const tToday = sorted[sorted.length - 1].tDays;

  // Per-sample weights: 1.5 if within recencyBoostWindow of t_today, else 1.0
  const wOf = s => (tToday - s.tDays) <= recencyBoostWindow ? 1.5 : 1.0;

  const brixSamples = sorted.map(s => ({ t: s.tDays, y: s.brix, w: wOf(s) }));
  const brixFit = weightedRegression(brixSamples);
  // Degenerate season: all samples share one timestamp (Σw(t−t̄)² = 0, e.g. two
  // readings on the same date) or the regression is otherwise non-finite. The
  // slope is then undefined and every downstream ETA/date becomes NaN/Infinity —
  // producing an 'Invalid Date' recommendation with nothing flagging it. Require
  // ≥2 distinct timestamps and a finite fit; otherwise treat as too-few-data.
  const distinctTimestamps = new Set(sorted.map(s => s.tDays)).size;
  if (distinctTimestamps < 2
      || !Number.isFinite(brixFit.beta)
      || !Number.isFinite(brixFit.sigmaBeta2)
      || !(brixFit.sumWttBar2 > 0)) {
    return pocosDatos(sorted);
  }
  const brixPrior = historicalSlopePrior(
    historicalByVintage.map(v => v.map(s => ({ t: s.tDays, y: s.brix }))),
    { slopeScale: BRIX_SLOPE_SCALE, slopeMax: BRIX_SLOPE_MAX }
  );
  const brixComb = bayesianCombine({
    betaHat: brixFit.beta, sigmaBeta2: brixFit.sigmaBeta2,
    betaHist: brixPrior.betaHist, tau2Hist: brixPrior.tau2Hist,
  });

  let antFit = null, antPrior = { V: 0, tau2Hist: Infinity, betaHist: null },
      antComb = { betaPost: NaN, sigmaBeta2Post: NaN };
  if (target.antTarget != null) {
    // Drop samples without an anthocyanin reading (mirrors the pH path) —
    // a single NaN otherwise poisons every regression sum.
    const antSamples = sorted
      .filter(s => Number.isFinite(s.ant))
      .map(s => ({ t: s.tDays, y: s.ant, w: wOf(s) }));
    antFit = weightedRegression(antSamples);
    antPrior = historicalSlopePrior(
      historicalByVintage.map(v => v.map(s => ({ t: s.tDays, y: s.ant }))),
      { slopeScale: ANT_SLOPE_SCALE, slopeMax: ANT_SLOPE_MAX }
    );
    antComb = bayesianCombine({
      betaHat: antFit.beta, sigmaBeta2: antFit.sigmaBeta2,
      betaHist: antPrior.betaHist, tau2Hist: antPrior.tau2Hist,
    });
  }

  let phFit = null, phPrior = { V: 0, tau2Hist: Infinity, betaHist: null },
      phComb = { betaPost: NaN, sigmaBeta2Post: NaN };
  if (target.phTarget != null) {
    const phSamples = sorted
      .filter(s => Number.isFinite(s.pH))
      .map(s => ({ t: s.tDays, y: s.pH, w: wOf(s) }));
    phFit = weightedRegression(phSamples);
    phPrior = historicalSlopePrior(
      historicalByVintage.map(v => v
        .filter(s => Number.isFinite(s.pH))
        .map(s => ({ t: s.tDays, y: s.pH }))
      ),
      { slopeScale: PH_SLOPE_SCALE, slopeMax: PH_SLOPE_MAX }
    );
    phComb = bayesianCombine({
      betaHat: phFit.beta, sigmaBeta2: phFit.sigmaBeta2,
      betaHist: phPrior.betaHist, tau2Hist: phPrior.tau2Hist,
    });
  }

  // ŷ at today using *this-season* fit
  const yhatBrixToday = brixFit.alpha + brixFit.beta * tToday;
  const yhatAntToday  = antFit ? antFit.alpha + antFit.beta * tToday : null;
  const yhatPhToday   = phFit  ? phFit.alpha  + phFit.beta  * tToday : null;

  // ETA in days from today using posterior slope
  const brixMidEta = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixTarget,
  });
  const brixLowerEta = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixLower,
  });
  const brixWindowOpensDays = brixLowerEta;
  const brixWindowClosesDays = etaDays({
    alpha: yhatBrixToday - brixComb.betaPost * tToday,
    beta: brixComb.betaPost, tToday, target: target.brixUpper,
  });
  const antEta = target.antTarget != null ? etaDays({
    alpha: yhatAntToday - antComb.betaPost * tToday,
    beta: antComb.betaPost, tToday, target: target.antTarget,
  }) : null;
  const phEta  = target.phTarget != null ? etaDays({
    alpha: yhatPhToday - phComb.betaPost * tToday,
    beta: phComb.betaPost, tToday, target: target.phTarget,
  }) : null;

  // Edge-case detection
  const reason = detectEdgeCase({
    yhatBrixToday, yhatAntToday, yhatPhToday,
    betaPostBrix: brixComb.betaPost,
    betaPostAnt: antComb.betaPost,
    betaPostPh: phComb.betaPost,
    brixLower: target.brixLower, brixUpper: target.brixUpper,
    antTarget: target.antTarget, phTarget: target.phTarget,
    brixMidEta, brixLowerEta, antEta, phEta,
    brixWindowCloses: brixWindowClosesDays,
  });

  // FINDING 3: detectEdgeCase returns a single precedence-ordered reason for the
  // card headline, but several alert conditions can hold at once. Over-ripe Brix
  // (riesgo-sobremadurez) now precedes the won't-reach-anthocyanin check, so in
  // red mode a lot past the upper Brix limit whose ANT target is also out of
  // reach before the window closes had its no-alcanzar-A warning hidden. Rather
  // than pick a winner, expose both conditions as independent structured flags so
  // the grower (and the view) can see every one; `reason` keeps its precedence.
  const brixOverRipe = target.brixUpper != null && yhatBrixToday > target.brixUpper;
  const antTargetUnreachable = target.antTarget != null
    && antEta != null && Number.isFinite(antEta)
    && Number.isFinite(brixWindowClosesDays)
    && antEta > brixWindowClosesDays;
  const flags = { brixOverRipe, antTargetUnreachable };

  const dayMs = 86_400_000;
  // White mode: recommendedEta = min(brixMidEta, effectiveWindowCloses)
  // Red mode: recommendedEta = max(brixMidEta, antEta)
  // Brix-only fallback: recommendedEta = brixMidEta
  const isWhite = target.phTarget != null && target.antTarget == null;
  let recommendedEtaDays;
  if (isWhite) {
    const phEffective = Number.isFinite(phEta) ? phEta : Infinity;
    const brixUpperEffective = Number.isFinite(brixWindowClosesDays)
      ? brixWindowClosesDays : Infinity;
    const effectiveCloses = Math.min(phEffective, brixUpperEffective);
    recommendedEtaDays = Math.min(brixMidEta, effectiveCloses);
  } else if (antEta != null) {
    recommendedEtaDays = Math.max(brixMidEta, antEta);
  } else {
    recommendedEtaDays = brixMidEta;
  }
  const horizonDays = Math.max(0, recommendedEtaDays);
  const bandDays = confidenceBand({
    sigma2: brixFit.sigma2, n: brixFit.n,
    tToday, tBarW: brixFit.tBarW, sumWttBar2: brixFit.sumWttBar2,
    betaPost: brixComb.betaPost, sigmaBeta2Post: brixComb.sigmaBeta2Post,
    horizonDays,
  });
  const label = confidenceLabel({
    V: brixPrior.V, nCurrent, horizonDays,
  });

  // White-mode recommended date set even when reason fires for soft alerts
  // (riesgo-ph, riesgo-sobremadurez): still useful to show "harvest by X".
  const isSoftWhiteAlert = isWhite
    && (reason === 'riesgo-ph' || reason === 'riesgo-sobremadurez');
  // ETAs are measured from the LAST SAMPLE's t (tToday), so calendar dates
  // must anchor there too — anchoring at actual `today` shifted every date
  // late by however stale the latest sample was.
  const lastSample = sorted[sorted.length - 1];
  const lastSampleMs = lastSample.sampleDate instanceof Date
    ? lastSample.sampleDate.getTime()
    : Date.parse(lastSample.sampleDate);
  const anchorMs = Number.isFinite(lastSampleMs) ? lastSampleMs : today.getTime();
  const recommendedDate = (reason && reason !== 'ya-en-ventana' && !isSoftWhiteAlert)
    ? null
    : (reason === 'ya-en-ventana' ? today
       : new Date(anchorMs + recommendedEtaDays * dayMs));
  const brixWindowCloses = Number.isFinite(brixWindowClosesDays)
    ? new Date(anchorMs + brixWindowClosesDays * dayMs)
    : null;

  return {
    reason, flags, recommendedDate, brixWindowCloses,
    bandDays, label,
    nCurrent, V: brixPrior.V,
    brixHoy: yhatBrixToday, antHoy: yhatAntToday, phHoy: yhatPhToday,
    samplesProjected: {
      brixEta: brixMidEta, antEta, phEta,
      brixWindowOpensDays, brixWindowClosesDays,
    },
    // Diagnostics passthrough — view needs these for the chart
    brixFit, brixComb, antFit, antComb, phFit, phComb,
  };
}

// ── computeAll grouping helper ───────────────────────────────────────
// Groups berryData by (variety, appellation), splits each group into
// current vintage vs historical vintages, resolves the effective target,
// and calls computeOne. Returns one object per group, ordered by
// recommendedDate ascending (cards in the view will use this order).
export function computeAll({
  berryData, today, currentVintage,
  overrides, rubricFor, valleyFor,
}) {
  const overrideByKey = new Map();
  for (const o of overrides) {
    overrideByKey.set(`${o.variety}|${o.valley}`, o);
  }
  const groups = new Map();
  for (const row of berryData) {
    if (!row.variety || !row.appellation) continue;
    const key = `${row.variety}|${row.appellation}`;
    if (!groups.has(key)) {
      groups.set(key, { variety: row.variety, appellation: row.appellation,
                        current: [], historicalByVintage: new Map() });
    }
    const g = groups.get(key);
    const sampleDate = row.sampleDate instanceof Date
      ? row.sampleDate
      : new Date(row.sampleDate);
    if (!Number.isFinite(sampleDate.getTime())) continue;
    const sample = {
      sampleDate,
      brix: toFiniteReading(row.brix),
      ant:  firstFiniteReading(row.tANT, row.tant, row.anthocyanins, row.ant),
      pH:   firstFiniteReading(row.pH, row.ph),
    };
    if (!Number.isFinite(sample.brix)) continue;
    if (row.vintage === currentVintage) {
      g.current.push(sample);
    } else {
      const arr = g.historicalByVintage.get(row.vintage) ?? [];
      arr.push(sample);
      g.historicalByVintage.set(row.vintage, arr);
    }
  }
  const results = [];
  for (const g of groups.values()) {
    // Normalise to tDays relative to first current sample
    g.current.sort((a, b) => a.sampleDate - b.sampleDate);
    const t0 = g.current[0]?.sampleDate?.getTime() ?? today.getTime();
    const dayMs = 86_400_000;
    const current = g.current.map(s => ({
      sampleDate: s.sampleDate,
      tDays: (s.sampleDate.getTime() - t0) / dayMs,
      brix: s.brix, ant: s.ant, pH: s.pH,
    }));
    const historicalByVintage = [];
    for (const arr of g.historicalByVintage.values()) {
      arr.sort((a, b) => a.sampleDate - b.sampleDate);
      const tv0 = arr[0].sampleDate.getTime();
      historicalByVintage.push(arr.map(s => ({
        tDays: (s.sampleDate.getTime() - tv0) / dayMs,
        brix: s.brix, ant: s.ant, pH: s.pH,
      })));
    }
    const valley = valleyFor({ appellation: g.appellation });
    const rubric = rubricFor({ variety: g.variety, appellation: g.appellation });
    const override = overrideByKey.get(`${g.variety}|${valley}`) ?? null;
    const target = resolveTarget({ rubric, override });
    const tToday = (today.getTime() - t0) / dayMs;
    // Re-stamp tDays so 'today' aligns to the last sample for the view
    const prediction = computeOne({
      current, historicalByVintage, target,
      today: new Date(today),
    });
    results.push({
      variety: g.variety, appellation: g.appellation, valley,
      target, prediction, tToday,
    });
  }
  // Sort: ya-en-ventana first, then by recommendedDate ascending, then by
  // appellation for stability. Cards with reason=pocos-datos-temporada go last.
  const rank = r => {
    if (r.prediction.reason === 'ya-en-ventana') return -1;
    if (r.prediction.reason === 'pocos-datos-temporada') return 1e15;
    return r.prediction.recommendedDate
      ? r.prediction.recommendedDate.getTime()
      : 1e14;
  };
  results.sort((a, b) => rank(a) - rank(b)
    || a.appellation.localeCompare(b.appellation));
  return results;
}
