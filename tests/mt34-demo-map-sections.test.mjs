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

test('MT.34 demo: aggregateBySection populates a majority of CONFIG.vineyardSections', () => {
  // After the dedupe was removed, the demo emits one lot per section (not per
  // variety+appellation group), so most polygons across all ranches color.
  // We allow ~25% to stay grey to account for sections whose variety has no
  // recognized rubric (skipped in buildCurrentSeasonGroups).
  resetDataStore();
  DemoMode.enable();
  const cfgSectionIds = new Set(CONFIG.vineyardSections.map(s => s.sectionId));
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
  const target = Math.floor(cfgSectionIds.size * 0.75);
  assert.ok(
    realSections.length >= target,
    `Only ${realSections.length}/${cfgSectionIds.size} real sections populated; expected >= ${target} (75%)`
  );
});

test('MT.34 demo: per-ranch coverage — at least 7 of 8 ranches have ≥1 graded section', () => {
  // DUB (Dubacano) has a single Malbec/Syrah section with no defined demo
  // rubric, so its sole polygon stays grey. The other 7 ranches must each
  // surface at least one colored polygon — otherwise the map looks empty
  // for that ranch.
  resetDataStore();
  DemoMode.enable();
  const latestByLot = {};
  for (const d of DataStore.berryData) {
    if (!d.lotCode) continue;
    const prev = latestByLot[d.lotCode];
    if (!prev || (d.daysPostCrush || 0) > (prev.daysPostCrush || 0)) {
      latestByLot[d.lotCode] = { ...d, fieldLot: d.lotCode };
    }
  }
  MapStore.aggregateBySection(Object.values(latestByLot), null);
  const ranches = [...new Set(CONFIG.vineyardSections.map(s => s.ranchCode))];
  const gradedSectionsByRanch = {};
  for (const r of ranches) gradedSectionsByRanch[r] = 0;
  for (const s of CONFIG.vineyardSections) {
    const data = MapStore.sectionData[s.sectionId];
    if (data && data.grade) gradedSectionsByRanch[s.ranchCode]++;
  }
  DemoMode.disable();
  const ranchesWithGrade = Object.values(gradedSectionsByRanch).filter(n => n > 0).length;
  assert.ok(
    ranchesWithGrade >= 7,
    `Only ${ranchesWithGrade}/${ranches.length} ranches have a graded section: ${JSON.stringify(gradedSectionsByRanch)}`
  );
});
