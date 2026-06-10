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

test('MT.32 demo: scoreAll grades ≥ 80% of lots', () => {
  resetDataStore();
  DemoMode.enable();
  const scored = scoreAll(DataStore.berryData, { cohort: 'vintage-variety' });
  const graded = scored.filter(s => s.grade !== null);
  const pct = scored.length > 0 ? graded.length / scored.length : 0;
  DemoMode.disable();
  assert.ok(pct >= 0.8, `Only ${graded.length}/${scored.length} (${(pct*100).toFixed(1)}%) lots graded; expected ≥ 80%`);
});

test('MT.32 demo: grade distribution covers at least 2 of A+/A/B/C', () => {
  resetDataStore();
  DemoMode.enable();
  const scored = scoreAll(DataStore.berryData, { cohort: 'vintage-variety' });
  const distinct = new Set(scored.map(s => s.grade).filter(g => g !== null));
  DemoMode.disable();
  assert.ok(distinct.size >= 2, `Only ${distinct.size} distinct grades: ${[...distinct].join(',')}`);
});

test('MT.32 demo: mediciones exist for all 3 vintages', () => {
  resetDataStore();
  DemoMode.enable();
  const currentYear = new Date().getFullYear();
  const medByVintage = v => DataStore.medicionesData.filter(m => m.vintage === v);
  const currentMed = medByVintage(currentYear);
  const warmMed = medByVintage(currentYear - 1);
  const coolMed = medByVintage(currentYear - 2);
  DemoMode.disable();
  assert.ok(currentMed.length > 0, `Expected current-vintage (${currentYear}) mediciones; got 0`);
  assert.ok(warmMed.length > 0, `Expected historical (${currentYear - 1}) mediciones; got 0`);
  assert.ok(coolMed.length > 0, `Expected historical (${currentYear - 2}) mediciones; got 0`);
});

test('MT.32 demo: berry data spans 3 vintages for vendimia comparisons', () => {
  resetDataStore();
  DemoMode.enable();
  const currentYear = new Date().getFullYear();
  const vintages = new Set(DataStore.berryData.map(b => b.vintage));
  // Vintage comparison charts need ≥4 points per vintage to draw trends.
  const countFor = v => DataStore.berryData.filter(b => b.vintage === v).length;
  const counts = [currentYear - 2, currentYear - 1, currentYear].map(countFor);
  DemoMode.disable();
  assert.ok(vintages.has(currentYear), 'missing current vintage berries');
  assert.ok(vintages.has(currentYear - 1), `missing ${currentYear - 1} berries`);
  assert.ok(vintages.has(currentYear - 2), `missing ${currentYear - 2} berries`);
  counts.forEach((c, i) => assert.ok(c >= 4, `vintage idx ${i} has only ${c} berry rows`));
});
