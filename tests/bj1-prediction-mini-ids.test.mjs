// xd-bj1: every Prediccion mini-chart canvas id must be unique per card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { predMiniSlug } from '../js/predictionView.js';

const cards = [
  { variety: 'Syrah', appellation: 'Ojos Negros (VON)', valley: 'VON' },
  { variety: 'Syrah', appellation: 'Kompali (VON)', valley: 'VON' },
  { variety: 'Syrah', appellation: 'Viña Alta (VON)', valley: 'VON' },
  { variety: 'Syrah', appellation: 'Vina Alta (VON)', valley: 'VON' },
  { variety: 'Merlot', appellation: 'Kompali (VON)', valley: 'VON' },
];

test('xd-bj1 same variety and valley, different ranch: unique ids', () => {
  const used = new Set();
  const ids = cards.map(c => `pred-mini-brix-${predMiniSlug(c, used)}`);
  assert.equal(new Set(ids).size, cards.length);
});

test('xd-bj1 ids are deterministic across renders', () => {
  const a = cards.map(c => predMiniSlug(c, new Set()));
  const b = cards.map(c => predMiniSlug(c, new Set()));
  assert.deepEqual(a, b);
});
