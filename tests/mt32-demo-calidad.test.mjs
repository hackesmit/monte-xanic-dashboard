// tests/mt32-demo-calidad.test.mjs
// MT.32 — Demo mode produces enough data for the calidad map to color lots.
// Regression guard for the 2026-05-29 fix: demoMode must emit current-vintage
// mediciones + receptions so joinBerryWithMediciones / joinBerryWithReceptions
// find matches; scoreAll must then return non-null grades for most lots.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DataStore } from '../js/dataLoader.js';
import { DemoMode } from '../js/demoMode.js';
import { scoreAll } from '../js/classification.js';

function resetDataStore() {
  DataStore.berryData = [];
  DataStore.wineRecepcion = [];
  DataStore.winePreferment = [];
  DataStore.medicionesData = [];
  DataStore.receptionData = [];
  DataStore.receptionLotsData = [];
  DataStore.loaded = { berry: false, wine: false };
}

test('MT.32 demo: berries with attached medicion exceed 80%', () => {
  resetDataStore();
  DemoMode.enable();
  const total = DataStore.berryData.length;
  const withMed = DataStore.berryData.filter(b => b.medicion).length;
  const pct = total > 0 ? withMed / total : 0;
  DemoMode.disable();
  assert.ok(pct >= 0.8, `Only ${withMed}/${total} (${(pct*100).toFixed(1)}%) berries have a medicion; expected >= 80%`);
});

test('MT.32 demo: scoreAll returns >= 50 graded lots', () => {
  resetDataStore();
  DemoMode.enable();
  const scored = scoreAll(DataStore.berryData, { cohort: 'vintage-variety' });
  const graded = scored.filter(s => s.grade !== null);
  DemoMode.disable();
  assert.ok(graded.length >= 50, `Only ${graded.length} of ${scored.length} lots graded; expected >= 50`);
});

test('MT.32 demo: grade distribution covers at least 2 of A+/A/B/C', () => {
  resetDataStore();
  DemoMode.enable();
  const scored = scoreAll(DataStore.berryData, { cohort: 'vintage-variety' });
  const distinct = new Set(scored.map(s => s.grade).filter(g => g !== null));
  DemoMode.disable();
  assert.ok(distinct.size >= 2, `Only ${distinct.size} distinct grades: ${[...distinct].join(',')}`);
});

test('MT.32 demo: current-vintage mediciones exist', () => {
  resetDataStore();
  DemoMode.enable();
  const currentYear = new Date().getFullYear();
  const currentMed = DataStore.medicionesData.filter(m => m.vintage === currentYear);
  const historicalMed = DataStore.medicionesData.filter(m => m.vintage === 2025);
  DemoMode.disable();
  assert.ok(currentMed.length > 0, `Expected current-vintage (${currentYear}) mediciones; got 0`);
  assert.ok(historicalMed.length > 0, 'Historical 2025 mediciones still present (predictor needs them)');
});
