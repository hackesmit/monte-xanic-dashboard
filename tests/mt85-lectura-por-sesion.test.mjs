// MT.85 - the confidential lab tables are read through a session check, never
// with the anon key (security audit 2026-10, bead xd-0lt.1).
//
// The finding: /api/config hands a session the anon key, and RLS granted
// SELECT USING (true) on the lab tables, so a session held once kept reading
// them after logout, blacklisting or a secret rotation. The fix has three
// parts and each one is pinned here:
//   1. api/datos.js checks the token against the blacklist on EVERY read, so a
//      revoked or expired token reads nothing (the handler cases).
//   2. js/dataLoader.js reads the tables and runs the upload probe through
//      /api/datos with the session token, never through the anon client.
//   3. sql/migration_lectura_por_sesion.sql drops the anon public_read
//      policies and revokes the grants. The Postgres case (XD_TEST_PG, a
//      THROWAWAY database; it runs in one transaction that ends in ROLLBACK)
//      shows anon reading a row before the migration and refused after it.
//
// Supabase is mocked by replacing globalThis.fetch, as in MT.52.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const CONFIDENCIALES = [
  'wine_samples', 'tank_receptions', 'reception_lots', 'prefermentativos',
  'berry_samples', 'mediciones_tecnicas', 'harvest_target_overrides',
];

const exists = (rel) => fs.existsSync(new URL(rel, import.meta.url));
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

function token({ role = 'viewer', exp = Date.now() + 60_000 } = {}) {
  const payloadB64 = Buffer.from(JSON.stringify({ exp, role, user: 'u', nonce: 'n' })).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() {},
  };
}

let _n = 0;
function makeReq({ method = 'GET', query = '', body, tok = token() } = {}) {
  return {
    method,
    url: `/api/datos?${query}${query ? '&' : ''}r=${_n++}`,
    headers: { 'x-session-token': tok },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

const jsonRes = (status, data) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => JSON.stringify(data), json: async () => data,
});

// Routes the handler's Supabase calls. `revocados` is the blacklist content.
let llamadas, revocados, tablaRows;
const realFetch = globalThis.fetch;
function mockSupabase() {
  llamadas = []; revocados = []; tablaRows = [{ id: 1 }];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    llamadas.push({ url: u, headers: opts.headers || {} });
    if (u.includes('/rest/v1/token_blacklist')) return jsonRes(200, revocados);
    return jsonRes(200, tablaRows);
  };
}
const lecturas = () => llamadas.filter(c => !c.url.includes('token_blacklist'));

const cargarHandler = async () => {
  assert.ok(exists('../api/datos.js'), 'api/datos.js exists (the session-checked read route)');
  return (await import('../api/datos.js')).default;
};

describe('MT.85 - /api/datos checks the session on every read', () => {
  beforeEach(mockSupabase);
  afterEach(() => { globalThis.fetch = realFetch; });

  it('a valid session reads a page with the service key, in the fixed order', async () => {
    const handler = await cargarHandler();
    const res = makeRes();
    await handler(makeReq({ query: 'tabla=wine_samples&desde=1000' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, filas: [{ id: 1 }] });
    const [r] = lecturas();
    assert.match(r.url, /\/rest\/v1\/wine_samples\?select=\*&order=sample_date\.asc&limit=1000&offset=1000$/);
    assert.equal(r.headers.apikey, 'test-service-key');
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
  });

  it('every confidential table is served', async () => {
    const handler = await cargarHandler();
    for (const t of CONFIDENCIALES) {
      const res = makeRes();
      await handler(makeReq({ query: `tabla=${t}` }), res);
      assert.equal(res.statusCode, 200, t);
    }
  });

  it('a revoked (blacklisted) token reads nothing: logout ends access', async () => {
    const handler = await cargarHandler();
    revocados = [{ token_hash: 'x' }];
    const res = makeRes();
    await handler(makeReq({ query: 'tabla=wine_samples' }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(lecturas().length, 0, 'no table read after revocation');
  });

  it('an expired token, a token signed with a rotated secret, or none reads nothing', async () => {
    const handler = await cargarHandler();
    const viejo = token();
    for (const tok of [token({ exp: Date.now() - 1 }), null]) {
      const res = makeRes();
      await handler(makeReq({ query: 'tabla=wine_samples', tok }), res);
      assert.equal(res.statusCode, 401);
    }
    process.env.SESSION_SECRET = 'rotated-secret';
    try {
      const res = makeRes();
      await handler(makeReq({ query: 'tabla=wine_samples', tok: viejo }), res);
      assert.equal(res.statusCode, 401);
    } finally {
      process.env.SESSION_SECRET = TEST_SECRET;
    }
    assert.equal(lecturas().length, 0);
  });

  it('a table outside the list, or a bad offset, is a 400 with no read', async () => {
    const handler = await cargarHandler();
    for (const q of ['tabla=token_blacklist', 'tabla=mona_conversations', 'tabla=__proto__',
      'tabla=wine_samples&desde=-1', 'tabla=wine_samples&desde=1.5', 'tabla=wine_samples&desde=abc']) {
      const res = makeRes();
      await handler(makeReq({ query: q }), res);
      assert.equal(res.statusCode, 400, q);
    }
    assert.equal(lecturas().length, 0);
  });

  it('a failed Supabase read is a 502, never an empty table', async () => {
    const handler = await cargarHandler();
    globalThis.fetch = async (url) => String(url).includes('token_blacklist')
      ? jsonRes(200, []) : jsonRes(500, { message: 'boom' });
    const res = makeRes();
    await handler(makeReq({ query: 'tabla=wine_samples' }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.ok, false);
  });

  it('the probe reads only the conflict-key columns, values quoted', async () => {
    const handler = await cargarHandler();
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { tabla: 'wine_samples', claves: ['A,1', 'B"2'] } }), res);
    assert.equal(res.statusCode, 200);
    const u = decodeURIComponent(lecturas()[0].url);
    assert.match(u, /wine_samples\?select=sample_id,sample_date,sample_seq&sample_id=in\.\("A,1","B\\"2"\)$/);
  });

  it('the probe splits a long key list into requests of 200 and joins the rows', async () => {
    const handler = await cargarHandler();
    const res = makeRes();
    const claves = Array.from({ length: 450 }, (_, i) => `S${i}`);
    await handler(makeReq({ method: 'POST', body: { tabla: 'berry_samples', claves } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(lecturas().length, 3);
    assert.equal(res.body.filas.length, 3);
    const enviadas = lecturas().flatMap(c => decodeURIComponent(c.url).match(/"S\d+"/g));
    assert.deepEqual(enviadas, claves.map(c => `"${c}"`));
  });

  it('the probe refuses a revoked token, a table outside the list and bad keys', async () => {
    const handler = await cargarHandler();
    for (const body of [{ tabla: 'seguimiento_lotes', claves: ['x'] }, { tabla: 'wine_samples', claves: [] },
      { tabla: 'wine_samples', claves: [{}] }, { tabla: 'wine_samples', claves: Array(1001).fill('x') }]) {
      const res = makeRes();
      await handler(makeReq({ method: 'POST', body }), res);
      assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 60));
    }
    revocados = [{ token_hash: 'x' }];
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { tabla: 'wine_samples', claves: ['x'] } }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(lecturas().length, 0);
  });
});

describe('MT.85 - the dashboard reads the confidential tables through /api/datos', () => {
  let DataStore, pedidas, anonUsada;
  beforeEach(async () => {
    ({ DataStore } = await import('../js/dataLoader.js'));
    pedidas = []; anonUsada = [];
    globalThis.localStorage = { getItem: (k) => (k === 'xanic_session_token' ? 'tok-123' : null) };
    // The anon client must not be asked for any of these tables.
    DataStore.supabase = { from: (t) => { anonUsada.push(t); throw new Error(`anon read of ${t}`); } };
    DataStore._demoActive = false;
    globalThis.fetch = async (url, opts = {}) => {
      pedidas.push({ url: String(url), opts });
      const body = opts.body ? JSON.parse(opts.body) : null;
      return jsonRes(200, { ok: true, filas: body ? [{ sample_id: 'S1' }] : [] });
    };
  });
  afterEach(() => { globalThis.fetch = realFetch; delete globalThis.localStorage; DataStore.supabase = null; });

  it('loadFromSupabase, loadMediciones and loadHarvestTargetOverrides use the route with the token', async () => {
    await DataStore.loadFromSupabase();
    await DataStore.loadMediciones();
    await DataStore.loadHarvestTargetOverrides();
    assert.deepEqual(anonUsada, []);
    const tablas = pedidas.map(p => new URL(p.url, 'http://x').searchParams.get('tabla')).sort();
    assert.deepEqual(tablas, ['harvest_target_overrides', 'mediciones_tecnicas', 'prefermentativos',
      'reception_lots', 'tank_receptions', 'wine_samples']);
    for (const p of pedidas) {
      assert.ok(p.url.startsWith('/api/datos?'), p.url);
      assert.equal(p.opts.headers['x-session-token'], 'tok-123');
    }
  });

  it('the upload probe goes through the route too', async () => {
    const filas = await DataStore.fetchExistingKeys('berry_samples', ['sample_id', 'sample_date', 'sample_seq'], ['S1']);
    assert.deepEqual(anonUsada, []);
    assert.deepEqual(filas, [{ sample_id: 'S1' }]);
    assert.equal(pedidas[0].url, '/api/datos');
    assert.deepEqual(JSON.parse(pedidas[0].opts.body), { tabla: 'berry_samples', claves: ['S1'] });
  });

  it('pages until a short page, advancing the offset by the rows read', async () => {
    globalThis.fetch = async (url) => {
      pedidas.push({ url: String(url) });
      const desde = Number(new URL(String(url), 'http://x').searchParams.get('desde'));
      return jsonRes(200, { ok: true, filas: desde === 0 ? Array(1000).fill({ id: 1 }) : [{ id: 2 }] });
    };
    const rows = await DataStore._fetchAll('mediciones_tecnicas');
    assert.equal(rows.length, 1001);
    assert.deepEqual(pedidas.map(p => new URL(p.url, 'http://x').searchParams.get('desde')), ['0', '1000']);
  });
});

describe('MT.85 - the migration drops the anon read on every confidential table', () => {
  it('drops public_read, keeps RLS on and revokes anon and authenticated', () => {
    assert.ok(exists('../sql/migration_lectura_por_sesion.sql'), 'sql/migration_lectura_por_sesion.sql exists');
    const sql = read('../sql/migration_lectura_por_sesion.sql');
    for (const t of CONFIDENCIALES) {
      assert.match(sql, new RegExp(`DROP POLICY IF EXISTS "public_read" ON public\\.${t};`), t);
      assert.match(sql, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`), t);
      assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon, authenticated;`), t);
    }
    assert.match(sql, /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_lectura_por_sesion'\)\s+ON CONFLICT \(name\) DO NOTHING;/);
  });

  it('is in the manifest, and no later migration grants a read back', async () => {
    const { MIGRATIONS } = await import('../js/migrations-manifest.js');
    const i = MIGRATIONS.indexOf('migration_lectura_por_sesion');
    assert.ok(i >= 0, 'manifest lists migration_lectura_por_sesion');
    for (const m of MIGRATIONS.slice(i + 1)) {
      const sql = read(`../sql/${m}.sql`);
      for (const t of CONFIDENCIALES) {
        assert.doesNotMatch(sql, new RegExp(`CREATE POLICY[^;]*ON\\s+(public\\.)?${t}\\b[^;]*FOR\\s+(SELECT|ALL)`, 'i'), `${m} re-opens ${t}`);
        assert.doesNotMatch(sql, new RegExp(`GRANT[^;]*ON\\s+(TABLE\\s+)?(public\\.)?${t}\\b[^;]*TO[^;]*\\b(anon|authenticated)\\b`, 'i'), `${m} re-grants ${t}`);
      }
    }
  });
});

const PG = process.env.XD_TEST_PG;

describe('MT.85 - anon reads a row before the migration and is refused after (Postgres)', { skip: !PG && 'XD_TEST_PG not set' }, () => {
  it('runs in one transaction that rolls back', () => {
    const migracion = read('../sql/migration_lectura_por_sesion.sql');
    // The pre-fix state, built only where the scratch database lacks it: the
    // Supabase roles, the tables, the schema-wide grant Supabase gives anon,
    // and the USING (true) policies from schema.sql and migration_rls_lockdown.
    const preparar = CONFIDENCIALES.map(t => `
CREATE TABLE IF NOT EXISTS public.${t} (mt85 int);
INSERT INTO public.${t} (mt85) VALUES (85);
ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read" ON public.${t};
CREATE POLICY "public_read" ON public.${t} FOR SELECT USING (true);
GRANT SELECT ON public.${t} TO anon, authenticated;`).join('\n');
    const leer = (fase) => CONFIDENCIALES.map(t => `
SET LOCAL ROLE anon;
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.${t};
  RAISE NOTICE 'MT85 ${fase} ${t} filas=%', n;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'MT85 ${fase} ${t} denegado';
END $$;
RESET ROLE;`).join('\n');
    const script = `
\\set ON_ERROR_STOP 1
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE IF NOT EXISTS public.applied_migrations (name text PRIMARY KEY);
${preparar}
${leer('antes')}
${migracion}
${leer('despues')}
ROLLBACK;
`;
    // The NOTICEs are on stderr; ON_ERROR_STOP makes any SQL error a non-zero exit.
    const run = spawnSync('psql', [PG, '-qX'], { input: script, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const err = run.stderr;
    for (const t of CONFIDENCIALES) {
      assert.match(err, new RegExp(`MT85 antes ${t} filas=[1-9]`), `anon reads ${t} before`);
      assert.match(err, new RegExp(`MT85 despues ${t} denegado`), `anon refused on ${t} after`);
    }
  });
});
