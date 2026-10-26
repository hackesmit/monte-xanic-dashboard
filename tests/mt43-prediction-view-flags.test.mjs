// tests/mt43-prediction-view-flags.test.mjs
// MT.43 — prediction.flags must reach the grower, not just the serializer.
// detectEdgeCase returns a single precedence-ordered reason for the card
// headline, so a lot that is BOTH over-ripe AND cannot reach its anthocyanin
// target before the window closes previously showed only riesgo-sobremadurez and
// hid the second warning. predictionView now renders each true flag as its own
// alert; this asserts BOTH Spanish messages appear in the rendered output for
// the model's actual output (visibility, not serialization).

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOne } from '../js/prediction.js';
import { renderFlagAlerts, flagAlertMessages, excludedVintagesMessage } from '../js/predictionView.js';

// Red mode: ŷ_brix ≈26.5 past the 25 upper limit (over-ripe), ANT climbs ~5/day
// from ≈900 and needs ~10 d to reach the 950 target, but the Brix window is
// already closed (0 d). Both flags must hold.
function overRipeUnreachablePrediction() {
  const current = [
    { sampleDate: '2026-08-06', tDays: 0, brix: 25.5, ant: 880 },
    { sampleDate: '2026-08-08', tDays: 2, brix: 26.0, ant: 890 },
    { sampleDate: '2026-08-10', tDays: 4, brix: 26.5, ant: 900 },
  ];
  return computeOne({
    current,
    historicalByVintage: [],
    target: { brixLower: 23.0, brixUpper: 25.0, brixTarget: 24.0, antTarget: 950 },
    today: new Date('2026-08-10'),
  });
}

test('MT.43 both flags render as independent alerts (over-ripe + no-alcanzar-A)', () => {
  const p = overRipeUnreachablePrediction();
  // Precondition: the model exposes both conditions, headline picks only one.
  assert.equal(p.reason, 'riesgo-sobremadurez');
  assert.equal(p.flags.brixOverRipe, true);
  assert.equal(p.flags.antTargetUnreachable, true);

  const html = renderFlagAlerts(p);
  // BOTH warnings are present in the rendered output — neither is hidden.
  assert.match(html, /sobremadurez/i,
    'over-ripe alert missing from rendered card');
  assert.match(html, /antocianinas no alcanzar/i,
    'won\'t-reach-anthocyanin alert hidden from the grower');
  assert.equal(flagAlertMessages(p).length, 2);
});

test('MT.43 no flags → no alert markup', () => {
  assert.equal(renderFlagAlerts({ flags: { brixOverRipe: false, antTargetUnreachable: false } }), '');
  assert.equal(renderFlagAlerts({}), '');
  assert.equal(flagAlertMessages({}).length, 0);
});

test('MT.43 a single flag renders only its own alert', () => {
  const html = renderFlagAlerts({ flags: { brixOverRipe: true, antTargetUnreachable: false } });
  assert.match(html, /sobremadurez/i);
  assert.doesNotMatch(html, /antocianinas no alcanzar/i);
});

// xd-e2y: historical vintages discarded as metric-impossible must reach the
// card. Before, computeOne dropped excludedSlopes and the card showed only V,
// so a lot whose history was thrown out looked like a lot with no history.
// End to end through computeOne, not only historicalSlopePrior.
function historical(slopeBrix, slopeAnt) {
  return [0, 5, 10, 15, 20].map(t => ({ tDays: t, brix: 18 + slopeBrix * t, ant: 600 + slopeAnt * t, pH: 3.3 }));
}
const redTarget = { brixLower: 23.0, brixUpper: 25.0, brixTarget: 24.0, antTarget: 950 };
const season = [
  { sampleDate: '2026-08-06', tDays: 0, brix: 20.0, ant: 700 },
  { sampleDate: '2026-08-10', tDays: 4, brix: 21.0, ant: 740 },
  { sampleDate: '2026-08-14', tDays: 8, brix: 22.0, ant: 780 },
];

test('MT.43 computeOne reports corrupt historical vintages per metric and the card shows them', () => {
  const p = computeOne({
    current: season,
    // One real vintage, one with a corrupt Brix slope (100 Bx/day), one with a
    // corrupt anthocyanin slope (1000 mg/L/day).
    historicalByVintage: [historical(0.2, 10), historical(100, 10), historical(0.2, 1000)],
    target: redTarget,
    today: new Date('2026-08-14'),
  });
  assert.equal(p.V, 2, 'only the corrupt Brix vintage leaves the Brix prior');
  assert.equal(p.excludedHistoricalSlopes.brix.length, 1);
  assert.equal(p.excludedHistoricalSlopes.ant.length, 1);
  assert.deepEqual(p.excludedHistoricalSlopes.pH, [], 'no pH target, no pH prior');

  const html = renderFlagAlerts(p);
  assert.match(html, /descartados por pendiente imposible/);
  assert.match(html, /Brix: 1, antocianinas: 1/);
});

test('MT.43 a card with too few current samples still reports a corrupt history', () => {
  const p = computeOne({
    current: season.slice(0, 1),
    historicalByVintage: [historical(100, 10)],
    target: redTarget,
    today: new Date('2026-08-06'),
  });
  assert.equal(p.reason, 'pocos-datos-temporada');
  assert.equal(p.V, 0);
  assert.equal(p.excludedHistoricalSlopes.brix.length, 1,
    'V=0 from discarded vintages must not look like V=0 from no history');
  assert.match(excludedVintagesMessage(p), /Brix: 1/);
});

test('MT.43 a clean history adds no data-quality line', () => {
  const p = computeOne({
    current: season,
    historicalByVintage: [historical(0.2, 10)],
    target: redTarget,
    today: new Date('2026-08-14'),
  });
  assert.equal(excludedVintagesMessage(p), '');
  assert.doesNotMatch(renderFlagAlerts(p), /descartados/);
});
