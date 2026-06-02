// tests/mt34-demo-map-sections.test.mjs
// MT.34 — Demo lot codes resolve to REAL CONFIG.vineyardSections IDs so the
// calidad map can render colored polygons.
//
// Regression guard for the post-#19 grey-map bug: PR #19 made demo emit
// current-vintage mediciones so joinBerryWithMediciones produced grades,
// but buildCurrentSeasonGroups used the literal suffix `-G` for lot codes
// (e.g. `CSMX-G`). MapStore.resolveSection extracted ghost section IDs
// like `MX-G`, `DA-G`, `ON-G` that don't exist in CONFIG.vineyardSections.
// SVG polygons (which iterate CONFIG.vineyardSections) never found a
// matching sectionData entry → every polygon rendered grey.
//
// MT.32 confirmed grading worked; MT.34 confirms the resolved sections
// actually live on the map.

import test from 'node:test';
import assert from 'node:assert/strict';
import { DataStore } from '../js/dataLoader.js';
import { DemoMode } from '../js/demoMode.js';
import { MapStore } from '../js/maps.js';
import { CONFIG } from '../js/config.js';

function resetDataStore() {
  DataStore.berryData = [];
  DataStore.wineRecepcion = [];
  DataStore.winePreferment = [];
  DataStore.medicionesData = [];
  DataStore.receptionData = [];
  DataStore.receptionLotsData = [];
  DataStore.loaded = { berry: false, wine: false };
}

test('MT.34 demo: every berry lotCode resolves to a CONFIG.vineyardSections id', () => {
  resetDataStore();
  DemoMode.enable();
  const lots = [...new Set(DataStore.berryData.map(b => b.lotCode))];
  const cfgSectionIds = new Set(CONFIG.vineyardSections.map(s => s.sectionId));
  const unresolved = [];
  const ghosts = [];
  for (const lot of lots) {
    const sec = MapStore.resolveSection(lot);
    if (!sec) { unresolved.push(lot); continue; }
    if (!cfgSectionIds.has(sec)) ghosts.push({ lot, ghostSection: sec });
  }
  DemoMode.disable();
  assert.equal(
    unresolved.length, 0,
    `Demo emitted ${unresolved.length} lots that don't resolve to any section: ${unresolved.slice(0, 5).join(', ')}`
  );
  assert.equal(
    ghosts.length, 0,
    `Demo emitted ${ghosts.length} lots resolving to non-existent sections: ${ghosts.slice(0, 5).map(g => g.lot + '→' + g.ghostSection).join(', ')}`
  );
});

test('MT.34 demo: at least one Kompali lot exists AND its resolved section is real', () => {
  // Kompali has a quirky lot-code convention (K is the prefix, then variety
  // code: KCS-S8, not CSK-S8). The non-Kompali ranches share the convention
  // ${varietyPrefix}${ranchCode}-${sectionLabel}. The fix must handle both.
  resetDataStore();
  DemoMode.enable();
  const cfgSectionIds = new Set(CONFIG.vineyardSections.map(s => s.sectionId));
  const lots = [...new Set(DataStore.berryData.map(b => b.lotCode))];
  const kompaliLots = lots
    .map(lot => ({ lot, section: MapStore.resolveSection(lot) }))
    .filter(r => r.section && r.section.startsWith('K-'));
  DemoMode.disable();
  assert.ok(kompaliLots.length > 0, 'Expected at least one Kompali demo lot');
  for (const { lot, section } of kompaliLots) {
    assert.ok(
      cfgSectionIds.has(section),
      `Kompali lot ${lot} → section ${section} not in CONFIG.vineyardSections`
    );
  }
});

test('MT.34 demo: aggregateBySection populates at least 6 distinct real sections', () => {
  resetDataStore();
  DemoMode.enable();
  const cfgSectionIds = new Set(CONFIG.vineyardSections.map(s => s.sectionId));
  // Bridge berry → map-store row shape (mirrors app.js:395-407 latestByLot build).
  const latestByLot = {};
  for (const d of DataStore.berryData) {
    if (!d.lotCode) continue;
    const prev = latestByLot[d.lotCode];
    if (!prev || (d.daysPostCrush || 0) > (prev.daysPostCrush || 0)) {
      latestByLot[d.lotCode] = { ...d, fieldLot: d.lotCode };
    }
  }
  MapStore.aggregateBySection(Object.values(latestByLot), null);
  const realSections = Object.keys(MapStore.sectionData).filter(id => cfgSectionIds.has(id));
  DemoMode.disable();
  assert.ok(
    realSections.length >= 6,
    `Only ${realSections.length} real sections populated; expected >= 6`
  );
});
