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

  // White-mode checks (phTarget != null AND antTarget == null)
  if (phTarget != null && antTarget == null) {
    if (yhatPhToday > phTarget) return 'ph-excedido';
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
  if (nCurrent < 2) {
    return {
      reason: 'pocos-datos-temporada',
      recommendedDate: null, brixWindowCloses: null,
      bandDays: Infinity, label: 'Baja',
      nCurrent, V: 0,
      brixHoy: current[0]?.brix ?? null,
      antHoy:  current[0]?.ant ?? null,
      phHoy:   current[0]?.pH ?? null,
      samplesProjected: { brixEta: null, antEta: null, phEta: null },
    };
  }

  // Order by tDays asc; the last entry's tDays is "today's t"
  const sorted = [...current].sort((a, b) => a.tDays - b.tDays);
  const tToday = sorted[sorted.length - 1].tDays;

  // Per-sample weights: 1.5 if within recencyBoostWindow of t_today, else 1.0
  const wOf = s => (tToday - s.tDays) <= recencyBoostWindow ? 1.5 : 1.0;

  const brixSamples = sorted.map(s => ({ t: s.tDays, y: s.brix, w: wOf(s) }));
  const brixFit = weightedRegression(brixSamples);
  const brixPrior = historicalSlopePrior(
    historicalByVintage.map(v => v.map(s => ({ t: s.tDays, y: s.brix })))
  );
  const brixComb = bayesianCombine({
    betaHat: brixFit.beta, sigmaBeta2: brixFit.sigmaBeta2,
    betaHist: brixPrior.betaHist, tau2Hist: brixPrior.tau2Hist,
  });

  let antFit = null, antPrior = { V: 0, tau2Hist: Infinity, betaHist: null },
      antComb = { betaPost: NaN, sigmaBeta2Post: NaN };
  if (target.antTarget != null) {
    const antSamples = sorted.map(s => ({ t: s.tDays, y: s.ant, w: wOf(s) }));
    antFit = weightedRegression(antSamples);
    antPrior = historicalSlopePrior(
      historicalByVintage.map(v => v.map(s => ({ t: s.tDays, y: s.ant })))
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
      )
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
  const recommendedDate = (reason && reason !== 'ya-en-ventana' && !isSoftWhiteAlert)
    ? null
    : (reason === 'ya-en-ventana' ? today
       : new Date(today.getTime() + recommendedEtaDays * dayMs));
  const brixWindowCloses = Number.isFinite(brixWindowClosesDays)
    ? new Date(today.getTime() + brixWindowClosesDays * dayMs)
    : null;

  return {
    reason, recommendedDate, brixWindowCloses,
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
      brix: Number(row.brix),
      ant:  Number(row.tANT ?? row.tant ?? row.anthocyanins ?? row.ant),
      pH:   Number(row.pH ?? row.ph),
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
