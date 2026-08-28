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
import { renderFlagAlerts, flagAlertMessages } from '../js/predictionView.js';

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
