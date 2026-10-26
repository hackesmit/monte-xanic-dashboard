// MT.60 — loadFromSupabase has three outcomes, and the header reads them.
//
// Before xd-eb2 loadFromSupabase returned this.loaded.berry: a database with
// wine rows and no berry rows looked exactly like a hard failure, and a hard
// failure was swallowed so the caller's .catch never fired. The badge then
// measured whether a client OBJECT existed, so a returning user saw a week-old
// cache under a green "DB" badge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataStore, estadoDatos } from '../js/dataLoader.js';

// A chainable stand-in for the supabase-js query builder. `tables` maps a
// table name to its rows, or to an Error the query answers with.
function fakeClient(tables) {
  return {
    from(table) {
      const q = {
        select: () => q,
        order: () => q,
        range: (from, to) => {
          const t = tables[table];
          if (t instanceof Error) return Promise.resolve({ data: null, error: t });
          return Promise.resolve({ data: (t || []).slice(from, to + 1), error: null });
        },
      };
      return q;
    },
  };
}

function reset(client) {
  DataStore.supabase = client;
  DataStore.lastFetch = null;
  DataStore.dataTs = null;
  DataStore.berryData = [];
  DataStore.wineRecepcion = [];
  DataStore.winePreferment = [];
  DataStore._demoActive = false;
}

const wineRow = { id: 1, sample_id: '25CSKMP-4', sample_type: 'Must', sample_date: '2025-09-01', variety: 'Cabernet Sauvignon', appellation: 'Kompali' };
const berryRow = { id: 2, sample_id: '25CSKMP-4', sample_type: 'Berries', sample_date: '2025-08-20', variety: 'Cabernet Sauvignon', appellation: 'Kompali' };

test("rows come back: 'ok', and memory is replaced", async () => {
  reset(fakeClient({ wine_samples: [berryRow, wineRow] }));
  const out = await DataStore.loadFromSupabase();
  assert.equal(out, 'ok');
  assert.equal(DataStore.lastFetch.outcome, 'ok');
  assert.equal(DataStore.berryData.length, 1);
  assert.equal(DataStore.wineRecepcion.length, 1);
});

test("wine rows with zero berry rows are 'ok', not a failure", async () => {
  reset(fakeClient({ wine_samples: [wineRow] }));
  const out = await DataStore.loadFromSupabase();
  assert.equal(out, 'ok');
  assert.equal(DataStore.berryData.length, 0);
  assert.equal(estadoDatos({ lastFetch: DataStore.lastFetch, dataTs: DataStore.dataTs, hayDatos: true }).estado, 'live');
});

test("a reachable, empty wine_samples is 'empty', and reads as live", async () => {
  reset(fakeClient({ wine_samples: [] }));
  const out = await DataStore.loadFromSupabase();
  assert.equal(out, 'empty');
  assert.equal(estadoDatos({ lastFetch: DataStore.lastFetch, dataTs: DataStore.dataTs, hayDatos: false }).estado, 'live');
});

test("a failing query is 'error', resolves (never rejects), and keeps the cached rows", async () => {
  reset(fakeClient({ wine_samples: Object.assign(new Error('JWT expired'), { code: 'PGRST301' }) }));
  const cached = [{ sampleId: 'CACHED' }];
  DataStore.berryData = cached;
  DataStore.dataTs = 1_700_000_000_000;
  const out = await DataStore.loadFromSupabase();
  assert.equal(out, 'error');
  assert.equal(DataStore.lastFetch.outcome, 'error');
  assert.equal(DataStore.berryData, cached, 'a failed fetch must not clear what is on screen');
  assert.equal(DataStore.dataTs, 1_700_000_000_000, 'a failed fetch must not re-date the cache');
});

test("no client at all is 'error'", async () => {
  reset(null);
  assert.equal(await DataStore.loadFromSupabase(), 'error');
  assert.equal(DataStore.lastFetch.outcome, 'error');
});

test('a failed fetch over cached rows is "cached" and carries the cache timestamp', () => {
  const ts = Date.UTC(2026, 9, 19, 14, 5);
  assert.deepEqual(
    estadoDatos({ lastFetch: { outcome: 'error', at: Date.now() }, dataTs: ts, hayDatos: true }),
    { estado: 'cached', ts });
});

test('a failed fetch with nothing on screen is "none"', () => {
  assert.equal(estadoDatos({ lastFetch: { outcome: 'error', at: 1 }, dataTs: null, hayDatos: false }).estado, 'none');
  // Bundled JSON fallback rows have no fetch date: nothing honest to show as an age.
  assert.equal(estadoDatos({ lastFetch: { outcome: 'error', at: 1 }, dataTs: null, hayDatos: true }).estado, 'none');
});

test('the green badge needs a fetch that answered, not a client object', () => {
  assert.notEqual(estadoDatos({ lastFetch: null, dataTs: null, hayDatos: false }).estado, 'live');
  assert.notEqual(estadoDatos({ lastFetch: { outcome: 'error', at: 1 }, dataTs: 5, hayDatos: true }).estado, 'live');
});
