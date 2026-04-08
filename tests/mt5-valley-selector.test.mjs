// MT.5 — Valley selector flow
// Tests the state management and rendering logic for valley selection.
// Since this is browser code with DOM dependencies, we test with lightweight mocks.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Minimal mock of Filters.state (extracted from js/filters.js:7-12).
 * The valley selector handler in events.js:31-50 sets this state.
 */
function createFiltersState() {
  return {
    vintages: new Set(),
    varieties: new Set(),
    origins: new Set(),
    lots: new Set(),
    grapeType: 'all',
    colorBy: 'variety',
    weatherLocation: 'VDG'
  };
}

/**
 * Simulates the valley change handler logic from events.js:31-50.
 * Extracted to test without DOM dependencies.
 */
function handleValleyChange(state, newLocation, weatherStore) {
  state.weatherLocation = newLocation;

  const names = { VDG: 'Valle de Guadalupe', VON: 'Valle de Ojos Negros', SV: 'San Vicente' };
  const titleText = `Clima durante la Vendimia — ${names[newLocation] || newLocation}`;

  const vintages = weatherStore.getVintagesFromData();
  const chartsRendered = [];

  const renderWeather = () => {
    chartsRendered.push({ action: 'render', location: newLocation, vintages: [...vintages] });
  };

  renderWeather();

  // Check if sync needed (no cached data for this valley)
  const hasData = vintages.some(y =>
    weatherStore.getRange(`${y}-07-01`, `${y}-10-31`, newLocation).length > 0
  );

  let syncTriggered = false;
  if (!hasData && vintages.length) {
    syncTriggered = true;
    // In real code: WeatherStore.sync(vintages).then(renderWeather)
  }

  return { titleText, chartsRendered, syncTriggered, hasData };
}

/**
 * Simulates clearAll logic from filters.js:205-221.
 * After P1.2 fix, this should also reset weatherLocation.
 */
function clearAll(state) {
  ['vintages', 'varieties', 'origins', 'lots'].forEach(f => state[f].clear());
  state.grapeType = 'all';
  state.colorBy = 'variety';
  state.weatherLocation = 'VDG'; // P1.2 fix
}

describe('MT.5 — Valley selector flow', () => {
  let state;

  beforeEach(() => {
    state = createFiltersState();
  });

  it('default weatherLocation is VDG', () => {
    assert.equal(state.weatherLocation, 'VDG');
  });

  it('switching valley updates state.weatherLocation', () => {
    const weatherStore = {
      getVintagesFromData: () => [2025],
      getRange: () => [{ date: '2025-08-01', temp_avg: 30 }]
    };
    handleValleyChange(state, 'VON', weatherStore);
    assert.equal(state.weatherLocation, 'VON');
  });

  it('switching valley updates header text', () => {
    const weatherStore = {
      getVintagesFromData: () => [2025],
      getRange: () => [{ date: '2025-08-01', temp_avg: 30 }]
    };
    const result = handleValleyChange(state, 'VON', weatherStore);
    assert.equal(result.titleText, 'Clima durante la Vendimia — Valle de Ojos Negros');
  });

  it('switching valley triggers chart re-render', () => {
    const weatherStore = {
      getVintagesFromData: () => [2025],
      getRange: () => [{ date: '2025-08-01', temp_avg: 30 }]
    };
    const result = handleValleyChange(state, 'SV', weatherStore);
    assert.equal(result.chartsRendered.length, 1);
    assert.equal(result.chartsRendered[0].location, 'SV');
  });

  it('triggers sync when no cached data for selected valley', () => {
    const weatherStore = {
      getVintagesFromData: () => [2025],
      getRange: () => [] // no cached data
    };
    const result = handleValleyChange(state, 'VON', weatherStore);
    assert.equal(result.syncTriggered, true);
    assert.equal(result.hasData, false);
  });

  it('does not trigger sync when data exists for selected valley', () => {
    const weatherStore = {
      getVintagesFromData: () => [2025],
      getRange: () => [{ date: '2025-08-01', temp_avg: 28 }]
    };
    const result = handleValleyChange(state, 'VON', weatherStore);
    assert.equal(result.syncTriggered, false);
    assert.equal(result.hasData, true);
  });

  it('does not trigger sync when no vintages available', () => {
    const weatherStore = {
      getVintagesFromData: () => [],
      getRange: () => []
    };
    const result = handleValleyChange(state, 'VON', weatherStore);
    assert.equal(result.syncTriggered, false);
  });

  it('clearAll resets weatherLocation to VDG', () => {
    state.weatherLocation = 'VON';
    state.vintages.add(2025);
    state.varieties.add('Syrah');
    clearAll(state);
    assert.equal(state.weatherLocation, 'VDG');
    assert.equal(state.vintages.size, 0);
    assert.equal(state.varieties.size, 0);
  });

  it('all three valleys produce correct header text', () => {
    const weatherStore = {
      getVintagesFromData: () => [2025],
      getRange: () => [{ date: '2025-08-01' }]
    };
    const vdg = handleValleyChange(state, 'VDG', weatherStore);
    assert.ok(vdg.titleText.includes('Valle de Guadalupe'));

    const von = handleValleyChange(state, 'VON', weatherStore);
    assert.ok(von.titleText.includes('Valle de Ojos Negros'));

    const sv = handleValleyChange(state, 'SV', weatherStore);
    assert.ok(sv.titleText.includes('San Vicente'));
  });

  it('unknown valley code falls back to raw code in header', () => {
    const weatherStore = {
      getVintagesFromData: () => [],
      getRange: () => []
    };
    const result = handleValleyChange(state, 'UNKNOWN', weatherStore);
    assert.ok(result.titleText.includes('UNKNOWN'));
  });
});
