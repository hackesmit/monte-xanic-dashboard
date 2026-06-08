// tests/mt35-map-year-filter.test.mjs
// MT.35 — Mapa view single-vintage filter.
// Filters.state.mapVintage is a single-number state slice (default null).
// Filters.initMapVintage picks the latest vintage from berryData; preserves
// a still-valid existing pick; resets when the pick disappears.
// MapStore.aggregateBySection's existing vintage filter must isolate the
// chosen year so a 2025 lot's quality doesn't bleed into 2026's section data.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Filters } from '../js/filters.js';
import { DataStore } from '../js/dataLoader.js';
import { MapStore } from '../js/maps.js';

function seedBerries(rows) {
  DataStore.berryData = rows;
}

function resetMapVintage() {
  Filters.state.mapVintage = null;
}

test('MT.35 initMapVintage picks max year when multiple vintages exist', () => {
  resetMapVintage();
  seedBerries([
    { vintage: 2024, lotCode: 'X-1' },
    { vintage: 2025, lotCode: 'X-2' },
    { vintage: 2026, lotCode: 'X-3' },
  ]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, 2026);
});

test('MT.35 initMapVintage picks the only year when one exists', () => {
  resetMapVintage();
  seedBerries([{ vintage: 2025, lotCode: 'X-1' }]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, 2025);
});

test('MT.35 initMapVintage sets null when no berry data', () => {
  resetMapVintage();
  seedBerries([]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, null);
});

test('MT.35 initMapVintage preserves a valid existing pick', () => {
  Filters.state.mapVintage = 2024;
  seedBerries([
    { vintage: 2024, lotCode: 'X-1' },
    { vintage: 2026, lotCode: 'X-2' },
  ]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, 2024,
    'A valid existing pick must NOT be overwritten — that would surprise users mid-session.');
});

test('MT.35 initMapVintage resets to latest when current pick disappears', () => {
  Filters.state.mapVintage = 2020;
  seedBerries([
    { vintage: 2024, lotCode: 'X-1' },
    { vintage: 2026, lotCode: 'X-2' },
  ]);
  Filters.initMapVintage();
  assert.equal(Filters.state.mapVintage, 2026);
});

test('MT.35 MapStore.aggregateBySection filters by the passed vintage', () => {
  const rows = [
    { lotCode: 'CSMX-5A', fieldLot: 'CSMX-5A', vintage: 2025, brix: 20, variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)' },
    { lotCode: 'CSMX-5A', fieldLot: 'CSMX-5A', vintage: 2026, brix: 24, variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)' },
  ];
  MapStore.aggregateBySection(rows, 2026);
  const mxData = MapStore.sectionData['MX-5A'];
  assert.ok(mxData, 'MX-5A should have section data');
  assert.equal(mxData.brix, 24, 'Only the 2026 row (brix=24) should contribute — not the average of 20 and 24.');
});
