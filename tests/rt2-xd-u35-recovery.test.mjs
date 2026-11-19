// RT2 xd-u35 / xd-vqe: does a reconnect restore EVERYTHING the boot loaded?
//
// Adopted from the xd-u35 round 2 red-team attack file (state/review/xd-62o).
// Its finding: a recovery that reruns only loadFromSupabase leaves mediciones,
// harvest target overrides and meteorology empty until F5 while the banner
// says all is well. Ported to main's API: the real DataStore.initSupabase
// runs (createClient does no I/O), and the banner is shown or hidden with the
// `hidden` attribute, as in index.html.
//
// It drives the real App.init / _recuperarDatos against a stubbed DOM,
// network and clock.
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM so app.js imports and the banner/badge can be observed ----
function el(id) {
  return {
    id, style: {}, children: [], _text: '', className: '', title: '', disabled: false, hidden: false,
    listeners: {},
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v); this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
    querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}
const DOM = {};
const docListeners = {};
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.document = {
  visibilityState: 'visible',
  getElementById: (id) => DOM[id] || null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: (tag) => el(tag),
  addEventListener(t, fn) { (docListeners[t] ||= []).push(fn); },
  body: el('body'), documentElement: el('html'),
};
const winListeners = {};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { App } = await import('../js/app.js');
const { DataStore } = await import('../js/dataLoader.js');
const { Filters } = await import('../js/filters.js');
const { WeatherStore } = await import('../js/weather.js');

// window did not exist at import (jspdf needs it absent); provide it now for the triggers
globalThis.window = { addEventListener(t, fn) { (winListeners[t] ||= []).push(fn); } };
const fireOnline = () => Promise.all((winListeners.online || []).map(fn => fn({ type: 'online' })));
const fireVisible = () => Promise.all((docListeners.visibilitychange || []).map(fn => fn({ type: 'visibilitychange' })));

// neuter rendering
App.restoreTheme = () => {}; App.restoreSidebar = () => {}; App.hideDataLoader = () => {};
App.bindGlobalEvents = () => {}; App.refresh = () => {};
Filters.buildMapVintageOptions = () => {}; Filters.initMapVintage = () => {};
DataStore.loadFromJSON = async () => false;
WeatherStore.sync = async () => {}; WeatherStore.getVintagesFromData = () => [];

// ---- network stub: /api/config only; the table layer is faked below ----
const net = { configMode: 'ok', queryMode: 'ok', queryCalls: 0 };
globalThis.fetch = async (url) => {
  if (String(url).includes('/api/config')) {
    if (net.configMode === 'fail') throw new Error('network down');
    return { ok: true, json: async () => ({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'anon-test-value' }) };
  }
  throw new Error('unexpected fetch ' + url);
};
DataStore._fetchAll = async function (table) {
  net.queryCalls++;
  if (net.queryMode === 'fail') throw new Error('query failed: ' + table);
  if (table === 'wine_samples') return [
    { sample_id: '26AAAA1A-C', sample_date: '2026-07-07', sample_type: 'Berries', vintage_year: 2026, variety: 'Malbec', brix: 21.5 },
  ];
  return [];
};

const now = 1_000_000_000_000;
Date.now = () => now;

function seedCache(ageMs = 60_000) {
  store.set('xanic_data_cache', JSON.stringify({
    berry: [{ sampleId: '26AAAA1A-C', variety: 'Malbec', sampleDate: '2026-07-07', brix: 20.0, vintageYear: 2026 }],
    wineR: [], wineP: [], recs: [], recL: [], ts: now - ageMs,
  }));
}

// Spies: record whether each secondary loader ran with a live client, and let
// a test hold one open to see what the banner does meanwhile.
const live = { med: 0, ovr: 0, wx: 0 };
let holdMed = null;
DataStore.loadMediciones = async () => {
  if (!DataStore.supabase) return;
  if (holdMed) await holdMed.promise;
  live.med++;
};
DataStore.loadHarvestTargetOverrides = async () => {
  if (DataStore.supabase) { live.ovr++; DataStore.harvestTargetOverrides = [{ id: 1 }]; }
  else DataStore.harvestTargetOverrides = [];
};
WeatherStore.load = async () => { if (DataStore.supabase) live.wx++; return false; };
// The real onDataLoaded also calls WeatherStore.load; keep that bit.
App.onDataLoaded = function () { this.initialized = true; WeatherStore.load(); };

// A real supabase-js client, seeing the window/document stubs, believes it is
// in a browser: it starts a token-refresh timer and opens a BroadcastChannel
// for cross-tab sync. Close both on every client a test made, or the process
// never exits.
async function dropClient() {
  const auth = DataStore.supabase?.auth;
  if (!auth) return;
  await auth.stopAutoRefresh?.();
  auth.broadcastChannel?.close?.();
}
after(dropClient);

async function reset() {
  await dropClient();
  store.clear();
  net.configMode = 'ok'; net.queryMode = 'ok'; net.queryCalls = 0;
  DataStore.supabase = null; DataStore._supabaseReady = false;
  DataStore.lastFetch = null; DataStore.dataTs = null; DataStore._demoActive = false;
  DataStore.loaded = { berry: false, wine: false };
  DataStore.berryData = []; DataStore.wineRecepcion = []; DataStore.winePreferment = [];
  DataStore.harvestTargetOverrides = []; DataStore.medicionesData = [];
  App.initialized = false; App._recovering = false; App._lastRecoveryAt = -Infinity; App._recoveryBound = false;
  for (const k of Object.keys(winListeners)) delete winListeners[k];
  for (const k of Object.keys(docListeners)) delete docListeners[k];
  DOM['stale-banner'] = el('stale-banner'); DOM['stale-banner'].hidden = true;
  DOM['db-status-badge'] = el('db-status-badge');
  live.med = 0; live.ovr = 0; live.wx = 0; holdMed = null;
}
const settle = () => new Promise(r => setTimeout(r, 30));
const bannerShown = () => DOM['stale-banner'].hidden === false;

describe('RT2 xd-u35: recovery restores the secondary loads', () => {
  beforeEach(reset);

  it('R1 case B (no cache): after recovery, mediciones, harvest overrides and weather load from the live DB', async () => {
    net.configMode = 'fail';
    await App.init(); await settle();
    assert.equal(DataStore.supabase, null, 'precondition: boot failed');
    assert.equal(DataStore.lastFetch.outcome, 'error', 'precondition: boot fetch failed');
    net.configMode = 'ok';
    await fireOnline(); await settle();
    assert.ok(DataStore.supabase, 'precondition: reconnected');
    assert.equal(DataStore.lastFetch.outcome, 'ok', 'precondition: live load OK');
    assert.equal(bannerShown(), false, 'precondition: banner says all is well');
    assert.ok(live.med >= 1, 'mediciones never reloaded after recovery: Calidad map stays "Sin clasificar"');
    assert.ok(live.ovr >= 1, 'harvest_target_overrides never reloaded: prediction uses default targets, no banner');
    assert.ok(live.wx >= 1, 'meteorology never reloaded after recovery');
    assert.equal(DOM['db-status-badge'].className, 'db-badge db-badge-ok');
  });

  it('R2 case C (cache): after recovery, mediciones, harvest overrides and weather load from the live DB', async () => {
    seedCache();
    net.configMode = 'fail';
    await App.init(); await settle();
    assert.equal(bannerShown(), true, 'precondition: stale banner up after the failed boot');
    net.configMode = 'ok';
    await fireOnline(); await settle();
    assert.ok(DataStore.supabase, 'precondition: reconnected');
    assert.equal(bannerShown(), false, 'precondition: banner cleared');
    assert.ok(live.med >= 1, 'mediciones never reloaded after recovery');
    assert.ok(live.ovr >= 1, 'harvest_target_overrides never reloaded after recovery');
    assert.ok(live.wx >= 1, 'meteorology never reloaded after recovery');
  });
});

describe('xd-vqe: the banner and the triggers', () => {
  beforeEach(reset);

  it('R3 the banner stays up until every secondary loader has finished', async () => {
    seedCache();
    net.configMode = 'fail';
    await App.init(); await settle();
    net.configMode = 'ok';
    let release; holdMed = { promise: new Promise(r => { release = r; }) };
    const recovering = fireOnline(); await settle();
    assert.equal(DataStore.lastFetch.outcome, 'ok', 'precondition: wine_samples answered');
    App._updateDbStatus(); // a refresh from anywhere else must not clear it early
    assert.equal(bannerShown(), true, 'banner cleared while mediciones were still loading');
    release(); await recovering; await settle();
    assert.equal(bannerShown(), false, 'banner did not clear once all loaders finished');
  });

  it('R4 a failed reconnect keeps the banner and allows the next attempt', async () => {
    seedCache();
    net.configMode = 'fail';
    await App.init(); await settle();
    await fireOnline(); await settle();
    assert.equal(DataStore.supabase, null);
    assert.equal(bannerShown(), true, 'banner hidden after a failed reconnect');
    assert.equal(App._recovering, false, 'a failed attempt left the lock held');
    net.configMode = 'ok';
    await fireOnline(); await settle();
    assert.equal(bannerShown(), false, 'second attempt did not recover');
  });

  it('R5 a live dashboard is left alone, and a visible tab waits out the cooldown', async () => {
    await App.init(); await settle();
    assert.equal(DataStore.lastFetch.outcome, 'ok', 'precondition: boot was live');
    const calls = net.queryCalls;
    await fireOnline(); await fireVisible(); await settle();
    assert.equal(net.queryCalls, calls, 'a live dashboard refetched on online/visibility');

    await reset();
    seedCache();
    net.configMode = 'fail';
    await App.init(); await settle();
    await fireVisible(); await settle();          // attempt 1, fails
    net.configMode = 'ok';
    await fireVisible(); await settle();          // same instant: inside the cooldown
    assert.equal(bannerShown(), true, 'visibility retried inside the cooldown');
    await fireOnline(); await settle();           // network event skips the cooldown
    assert.equal(bannerShown(), false);
  });
});
