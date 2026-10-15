// MT.52 - /api/tanques endpoint: read the catalog and the movement log, append a
// movement and annul one, for role `lab` (bead xd-qrn.3).
//
// The dim_tanque / dim_tanque_sinonimo / movimientos_tanque tables are
// server-only (RLS on, no policies, grants revoked from anon), so every read
// and write goes through this endpoint with the service key. Supabase is mocked
// the same way as MT.20 - /api/row: globalThis.fetch is replaced and routed by
// URL, so nothing in this file touches the network.

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const handler = (await import('../api/tanques.js')).default;
const { replayMovimientos } = await import('../js/tanques/estado.js');

function token(role, user = 'labuser') {
  const payloadB64 = Buffer.from(JSON.stringify({
    exp: Date.now() + 60_000, role, user, nonce: 'n',
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() {},
  };
}

let _url = 0;
function makeReq({ method = 'POST', body = {}, role = 'lab', user = 'labuser' } = {}) {
  // A unique url per request keeps the in-memory rate limiter (keyed on
  // `${url}:${ip}`) from leaking a bucket between tests in this file.
  return {
    method,
    url: `/api/tanques?t=${_url++}`,
    headers: { 'x-session-token': token(role, user) },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

// --- Supabase mock -----------------------------------------------------------

const TANQUES = [
  { codigo: 'A1', fila: 'A', posicion: 1, capacidad_l: 20000, tipo: 'TQ', area: 'fermentacion', activo: true, orden: 1 },
  { codigo: 'A2', fila: 'A', posicion: 2, capacidad_l: 20000, tipo: 'TQ', area: 'fermentacion', activo: true, orden: 2 },
  { codigo: 'A3', fila: 'A', posicion: 3, capacidad_l: 1000,  tipo: 'TQ', area: 'fermentacion', activo: true, orden: 3 },
  { codigo: 'TIBOR 13', fila: null, posicion: null, capacidad_l: 5000, tipo: 'TIBOR', area: 'otras', activo: true, orden: 4 },
];

const SINONIMOS = [
  { sinonimo: 'TIB13', codigo: 'TIBOR 13' },
  { sinonimo: 'TIB 13', codigo: 'TIBOR 13' },
];

// One recepcion of 10000 L into A1, as PostgREST hands it back: NUMERIC columns
// may arrive as strings, which the handler has to coerce before the pure module
// sees them (otherwise every volume reads as junk and the tank looks empty).
function logBase() {
  return [
    {
      id: 1, fecha: '2025-09-01', tipo: 'recepcion', origen: null, destino: 'A1',
      lot_code: 'CS-01', vintage_year: 2025, volumen_l: '10000.000000', merma_l: '0.000000',
      nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
      created_at: '2025-09-01T18:00:00+00:00',
    },
  ];
}

// Writes go through the tanques_escribir RPC (sql/migration_tanques_escritura.sql),
// which this mock plays: it keeps a version counter, answers `conflicto` when
// the caller's version is stale, and otherwise hands the row to the `insert`
// (crear) or `patch` (anular) hook, so a test can still shape what the
// database "stored". `rpc` replaces the whole function when a test needs to.
function mockSupabase({ tanques = TANQUES, sinonimos = SINONIMOS, movimientos = logBase(),
                        insert, patch, rpc, blacklisted = false, maxRows = Infinity } = {}) {
  const calls = [];
  const db = { v: 0, cola: Promise.resolve() };
  globalThis.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url, method, opts });
    const ok = (json, status = 200) => ({
      ok: status >= 200 && status < 300, status,
      json: async () => json, text: async () => JSON.stringify(json),
    });
    const primera = async (r) => {
      const rows = await r.json();
      return Array.isArray(rows) ? rows[0] : rows;
    };

    if (url.includes('token_blacklist')) return ok(blacklisted ? [{ token_hash: 'x' }] : []);

    // `maxRows` plays a PostgREST whose db-max-rows is below the page size the
    // endpoint asks for: every page comes back short, not only the last one.
    const page = (rows) => {
      const m = /[?&]offset=(\d+)/.exec(url);
      const l = /[?&]limit=(\d+)/.exec(url);
      const from = m ? Number(m[1]) : 0;
      const size = Math.min(l ? Number(l[1]) : rows.length, maxRows);
      return ok(rows.slice(from, from + size));
    };

    if (url.includes('/rpc/tanques_escribir')) {
      const args = JSON.parse(opts.body);
      if (rpc) return rpc(args, ok, db);
      // One call at a time, like the FOR UPDATE on the version row: the next
      // call starts only after this one has compared, written and bumped.
      const turno = db.cola.then(async () => {
        if (args.p_version !== db.v) return ok({ resultado: 'conflicto', version: db.v });
        if (args.p_accion === 'crear') {
          const r = insert
            ? await insert(url, { ...opts, body: JSON.stringify(args.p_fila) }, ok)
            : ok([{ id: 99, ...args.p_fila }]);
          if (!r.ok) return r;
          db.v++;
          return ok({ resultado: 'creado', fila: await primera(r) });
        }
        const r = patch ? await patch(url, opts, ok) : ok([{ ...movimientos[0], anulado: true }]);
        if (!r.ok) return r;
        const fila = await primera(r);
        if (!fila) return ok({ resultado: 'no_existe' });
        db.v++;
        return ok({ resultado: 'anulado', fila });
      });
      db.cola = turno.catch(() => {});
      return turno;
    }
    if (url.includes('/tanques_version')) return ok([{ v: db.v }]);
    if (url.includes('/dim_tanque_sinonimo')) return page(sinonimos);
    if (url.includes('/dim_tanque')) return page(tanques);
    if (url.includes('/movimientos_tanque')) {
      if (method !== 'GET') throw new Error(`direct table write: ${method} ${url}`);
      return page(movimientos);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return calls;
}

// Did the handler call the write RPC at all?
const escribio = (calls) => calls.some(c => c.url.includes('/rpc/tanques_escribir'));
const rpcArgs = (calls) => calls.filter(c => c.url.includes('/rpc/tanques_escribir'))
  .map(c => JSON.parse(c.opts.body));

const movimiento = (over = {}) => ({
  fecha: '2025-09-10', tipo: 'trasiego', origen: 'A1', destino: 'A2',
  lot_code: 'CS-01', vintage_year: 2025, volumen_l: 5000,
  client_id: crypto.randomUUID(), ...over,
});

// --- gates -------------------------------------------------------------------

describe('MT.52 - /api/tanques gates', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('rejects an unsupported method with 405', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE' }), res);
    assert.equal(res.statusCode, 405);
  });

  it('rejects a missing token with 401 on GET and on POST', async () => {
    mockSupabase();
    for (const method of ['GET', 'POST']) {
      const res = makeRes();
      await handler({ method, url: `/api/tanques?m=${method}`, headers: {}, body: {},
                      socket: { remoteAddress: '127.0.0.1' } }, res);
      assert.equal(res.statusCode, 401, method);
    }
  });

  it('rejects a revoked (blacklisted) token with 401', async () => {
    mockSupabase({ blacklisted: true });
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    assert.equal(res.statusCode, 401);
  });

  it('sets no-store so a tank map is never served from cache', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  });

  it('rejects an unknown POST action with 400', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'borrar', id: 1 } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Acci/);
  });
});

// --- GET ---------------------------------------------------------------------

describe('MT.52 - GET /api/tanques', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('returns catalog, synonyms and log to any valid token (viewer included)', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ method: 'GET', role: 'viewer' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.tanques.length, 4);
    assert.equal(res.body.movimientos.length, 1);
    // A null-prototype map, so a synonym named '__proto__' stays an ordinary key.
    assert.equal(Object.getPrototypeOf(res.body.sinonimos), null);
    assert.deepEqual({ ...res.body.sinonimos }, { TIB13: 'TIBOR 13', 'TIB 13': 'TIBOR 13' });
  });

  it('coerces NUMERIC columns to numbers and anulado to a strict boolean', async () => {
    mockSupabase({
      tanques: [{ ...TANQUES[0], capacidad_l: '20000.000000', posicion: '1', orden: '1', activo: 'true' }],
      movimientos: [{ ...logBase()[0], anulado: 'false', vintage_year: '2025' }],
    });
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    const t = res.body.tanques[0];
    const m = res.body.movimientos[0];
    assert.equal(t.capacidad_l, 20000);
    assert.equal(typeof t.capacidad_l, 'number');
    assert.equal(t.posicion, 1);
    assert.equal(t.activo, true);
    assert.equal(m.volumen_l, 10000);
    assert.equal(typeof m.volumen_l, 'number');
    assert.equal(m.merma_l, 0);
    assert.equal(m.vintage_year, 2025);
    assert.equal(m.anulado, false);
    assert.equal(typeof m.anulado, 'boolean');
  });

  it('pages past the PostgREST 1000-row ceiling', async () => {
    const many = [];
    for (let i = 1; i <= 2300; i++) {
      many.push({ ...logBase()[0], id: i, destino: 'A1', volumen_l: '1' });
    }
    mockSupabase({ movimientos: many });
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    assert.equal(res.body.movimientos.length, 2300);
    assert.equal(res.body.movimientos[2299].id, 2300);
  });

  it('keeps paging through SHORT pages until an empty one', async () => {
    // A PostgREST whose db-max-rows is below the page size answers every page
    // short. Stopping on the first short page returned 500 of 1200 rows.
    const many = [];
    for (let i = 1; i <= 1200; i++) {
      many.push({ ...logBase()[0], id: i, destino: 'A1', volumen_l: '1' });
    }
    mockSupabase({ movimientos: many, maxRows: 500 });
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body).slice(0, 200));
    assert.equal(res.body.movimientos.length, 1200);
    assert.deepEqual(res.body.movimientos.map(m => m.id), many.map(m => m.id));
  });

  it('returns annulled rows too, so history can show them', async () => {
    mockSupabase({ movimientos: [{ ...logBase()[0], anulado: true }] });
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    assert.equal(res.body.movimientos.length, 1);
    assert.equal(res.body.movimientos[0].anulado, true);
  });

  it('never leaks the service key into the response', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    assert.ok(!JSON.stringify(res.body).includes('test-service-key'));
  });

  it('reports 500 when the Supabase env vars are missing', async () => {
    mockSupabase();
    const saved = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      const res = makeRes();
      await handler(makeReq({ method: 'GET' }), res);
      assert.equal(res.statusCode, 500);
    } finally {
      process.env.SUPABASE_SERVICE_KEY = saved;
    }
  });

  it('reports 502 when PostgREST answers non-2xx instead of claiming an empty bodega', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('token_blacklist')) return { ok: true, status: 200, json: async () => [], text: async () => '[]' };
      return { ok: false, status: 503, json: async () => ({ message: 'upstream down' }), text: async () => '{"message":"upstream down"}' };
    };
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.ok, false);
  });
});

// --- POST crear --------------------------------------------------------------

describe('MT.52 - POST /api/tanques action crear', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('rejects a viewer with 403', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ role: 'viewer', body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 403);
  });

  it('rejects admin with 403 (writes are role lab, same as /api/row)', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ role: 'admin', body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 403);
  });

  it('inserts a valid trasiego and stamps creado_por from the token', async () => {
    let sent = null;
    const calls = mockSupabase({
      insert: (url, opts, ok) => { sent = JSON.parse(opts.body); return ok([{ id: 42, ...sent }]); },
    });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.movimiento.id, 42);
    assert.equal(sent.creado_por, 'labuser');
    assert.equal(sent.volumen_l, 5000);
    assert.equal(sent.merma_l, 0);
    assert.equal(sent.fuente, 'manual');            // default when the client omits it
    assert.equal('id' in sent, false);
    assert.equal('anulado' in sent, false);
    assert.equal('created_at' in sent, false);
    const [args] = rpcArgs(calls);
    assert.equal(args.p_accion, 'crear');
    assert.equal(args.p_version, 0);
    assert.equal(args.p_id, null);
    // the key is stored, so a lost acknowledgment can be recognised on retry
    assert.match(sent.client_id, /^[0-9a-f-]{36}$/);
  });

  it('accepts fuente lab for a confirmed inference', async () => {
    let sent = null;
    mockSupabase({ insert: (url, opts, ok) => { sent = JSON.parse(opts.body); return ok([{ id: 43, ...sent }]); } });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ fuente: 'lab' }) } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(sent.fuente, 'lab');
  });

  it('refuses a creado_por supplied by the client instead of silently ignoring it', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ creado_por: 'jefe' }) } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /creado_por/);
  });

  it('refuses id, created_at and anulado from the body', async () => {
    for (const campo of ['id', 'created_at', 'anulado']) {
      mockSupabase();
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ [campo]: 1 }) } }), res);
      assert.equal(res.statusCode, 400, campo);
      assert.ok(res.body.error.includes(campo), `${campo}: ${res.body.error}`);
    }
  });

  it('refuses a field the table does not have (etapa is derived, not stored)', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ etapa: 'fa' }) } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /etapa/);
  });

  it('refuses an overdraw with the module Spanish reason and writes nothing', async () => {
    const calls = mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ volumen_l: 15000 }) } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /excede el contenido del tanque A1/);
    assert.ok(Array.isArray(res.body.errores));
    assert.equal(escribio(calls), false);
  });

  it('refuses a move whose arrival overflows the destination', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ destino: 'A3', volumen_l: 5000 }) } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /espacio libre del tanque A3/);
  });

  it('judges a backdated row at its place in the log, not against current state', async () => {
    // The log holds the recepcion (01 Sep, 10000 L into A1) and a trasiego of
    // all 10000 L out of A1 on 05 Sep. A further 6000 L out of A1 dated 03 Sep
    // fits the state of 03 Sep but leaves the 05 Sep row overdrawn, so it is
    // refused: validarMovimientoEnLog, not validarMovimiento.
    mockSupabase({ movimientos: [
      ...logBase(),
      { id: 2, fecha: '2025-09-05', tipo: 'trasiego', origen: 'A1', destino: 'A2',
        lot_code: 'CS-01', vintage_year: 2025, volumen_l: '10000', merma_l: '0',
        nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
        created_at: '2025-09-05T18:00:00+00:00' },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear',
      movimiento: movimiento({ fecha: '2025-09-03', destino: 'A3', volumen_l: 600 }) } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /movimiento posterior/);
  });

  it('refuses a backdated row that DEEPENS an overdraw the log already had', async () => {
    // Round 1 red-team repro. A1 takes 10000 L on 01 Sep and gives 15000 L on
    // 20 Sep, so the 20 Sep salida already owes 5000 L. A 4000 L salida on
    // 10 Sep fits that day, and validarMovimientoEnLog lets it through because
    // the 20 Sep sobregiro was already PRESENT; but it takes that debt to
    // 9000 L. Same severity gate as anular.
    const calls = mockSupabase({ movimientos: [
      ...logBase(),
      { id: 2, fecha: '2025-09-20', tipo: 'salida', origen: 'A1', destino: null,
        lot_code: 'CS-01', vintage_year: 2025, volumen_l: '15000', merma_l: '0',
        nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
        created_at: '2025-09-20T18:00:00+00:00' },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({
      fecha: '2025-09-10', tipo: 'salida', destino: null, volumen_l: 4000 }) } }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /agrava un movimiento posterior/);
    assert.equal(escribio(calls), false);
  });

  it('refuses a backdated row that DEEPENS an overflow the log already had', async () => {
    // A3 (1000 L) is already overfull on 20 Sep by 500 L. A 300 L recepcion
    // into A3 on 10 Sep fits that day but leaves 800 L too many on 20 Sep.
    const calls = mockSupabase({ movimientos: [
      ...logBase(),
      { id: 2, fecha: '2025-09-20', tipo: 'recepcion', origen: null, destino: 'A3',
        lot_code: 'ME-02', vintage_year: 2025, volumen_l: '1500', merma_l: '0',
        nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
        created_at: '2025-09-20T18:00:00+00:00' },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({
      fecha: '2025-09-10', tipo: 'recepcion', origen: null, destino: 'A3', lot_code: 'ME-03', volumen_l: 300 }) } }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /agrava un movimiento posterior/);
    assert.equal(escribio(calls), false);
  });

  it('accepts a row that leaves an existing downstream overdraw exactly as it was', async () => {
    // A recepcion into A2 touches nothing A1 owes, so the existing debt is not
    // the new row's fault and does not block it.
    mockSupabase({ movimientos: [
      ...logBase(),
      { id: 2, fecha: '2025-09-20', tipo: 'salida', origen: 'A1', destino: null,
        lot_code: 'CS-01', vintage_year: 2025, volumen_l: '15000', merma_l: '0',
        nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
        created_at: '2025-09-20T18:00:00+00:00' },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({
      fecha: '2025-09-10', tipo: 'recepcion', origen: null, destino: 'A2', lot_code: 'ME-03', volumen_l: 300 }) } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  it('accepts a backdated row that breaks nothing after it', async () => {
    mockSupabase({ movimientos: [
      ...logBase(),
      { id: 2, fecha: '2025-09-05', tipo: 'trasiego', origen: 'A1', destino: 'A2',
        lot_code: 'CS-01', vintage_year: 2025, volumen_l: '4000', merma_l: '0',
        nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
        created_at: '2025-09-05T18:00:00+00:00' },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear',
      movimiento: movimiento({ fecha: '2025-09-03', destino: 'A3', volumen_l: 600 }) } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  it('validates against the log even when PostgREST returns numerics as strings', async () => {
    // volumen_l arrives as '10000.000000'. Read as a string the tank would look
    // empty and a 5000 L trasiego out of A1 would be refused as an overdraw.
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ volumen_l: 9999 }) } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  it('ignores annulled rows when deriving the state to validate against', async () => {
    mockSupabase({ movimientos: [{ ...logBase()[0], anulado: true }] });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /vac/);  // "El tanque origen A1 esta vacio."
  });

  it('coerces a client numeric string so validation and the insert agree', async () => {
    let sent = null;
    mockSupabase({ insert: (url, opts, ok) => { sent = JSON.parse(opts.body); return ok([{ id: 44, ...sent }]); } });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear',
      movimiento: movimiento({ volumen_l: '5000.5', merma_l: '12', vintage_year: '2025' }) } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(sent.volumen_l, 5000.5);
    assert.equal(sent.merma_l, 12);
    assert.equal(sent.vintage_year, 2025);
    assert.equal(typeof sent.vintage_year, 'number');
  });

  it('resolves a tank synonym the lab writes (TIB13 -> TIBOR 13)', async () => {
    let sent = null;
    mockSupabase({ insert: (url, opts, ok) => { sent = JSON.parse(opts.body); return ok([{ id: 45, ...sent }]); } });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear',
      movimiento: movimiento({ destino: 'TIB13', volumen_l: 4000 }) } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    // The canonical codigo is stored: destino has a FK to dim_tanque(codigo),
    // so an alias would be rejected by Postgres.
    assert.equal(sent.destino, 'TIBOR 13');
  });

  it('refuses a blank lot_code for every type, because the column is NOT NULL', async () => {
    mockSupabase();
    for (const lot_code of [undefined, '', '   ']) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ lot_code }) } }), res);
      assert.equal(res.statusCode, 400, String(lot_code));
      assert.match(res.body.error, /lote/);
    }
  });

  it('refuses a fecha that is not a plain AAAA-MM-DD business date', async () => {
    mockSupabase();
    // A full timestamp would be truncated by the DATE column, leaving the stored
    // row at a different place in the replay than the one just validated.
    for (const fecha of ['2025-09-10T12:00:00Z', '10/09/2025', '2025-9-10', '', undefined]) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ fecha }) } }), res);
      assert.equal(res.statusCode, 400, String(fecha));
      assert.match(res.body.error, /fecha/i);
    }
  });

  it('refuses a calendar date that does not exist', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ fecha: '2025-02-30' }) } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /fecha valida/);
  });

  it('refuses a vintage_year outside the table CHECK range', async () => {
    mockSupabase();
    for (const vintage_year of [1987, 2101, 2025.5, 'dos mil', null]) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ vintage_year }) } }), res);
      assert.equal(res.statusCode, 400, String(vintage_year));
      assert.match(res.body.error, /vendimia/);
    }
  });

  it('refuses a fuente outside manual|lab', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ fuente: 'inventada' }) } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /fuente/i);
  });

  it('refuses an unknown movement type and an unknown tank', async () => {
    mockSupabase();
    const res1 = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ tipo: 'bautizo' }) } }), res1);
    assert.equal(res1.statusCode, 400);
    const res2 = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ destino: 'ZZ9' }) } }), res2);
    assert.equal(res2.statusCode, 400);
    assert.match(res2.body.error, /no existe en el catalogo/);
  });

  it('refuses an oversized nota rather than letting Postgres take it', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ nota: 'x'.repeat(5000) }) } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /nota/i);
  });

  it('refuses an array or an object in a text field instead of String()-coercing it', async () => {
    const calls = mockSupabase();
    const casos = {
      fecha: ['2025-09-10'], lot_code: ['CS-01'], tipo: ['trasiego'], origen: ['A1'],
      destino: { codigo: 'A2' }, fuente: ['manual'], nota: ['hola'], client_id: [crypto.randomUUID()],
    };
    for (const [campo, valor] of Object.entries(casos)) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ [campo]: valor }) } }), res);
      assert.equal(res.statusCode, 400, campo);
      assert.ok(res.body.error.includes(campo), `${campo}: ${res.body.error}`);
    }
    assert.equal(escribio(calls), false);
  });

  it('reads only plain decimals as numbers: no hex, blanks, padding or exponents', async () => {
    const calls = mockSupabase();
    for (const volumen_l of ['0x10', '', '   ', ' 5000', '5000 ', '1e3', '5e400', '+5000', '.5', 'Infinity', [5000], true]) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ volumen_l }) } }), res);
      assert.equal(res.statusCode, 400, JSON.stringify(volumen_l));
    }
    for (const merma_l of ['0x1', '', '1e1']) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ merma_l }) } }), res);
      assert.equal(res.statusCode, 400, JSON.stringify(merma_l));
    }
    for (const vintage_year of ['0x7E9', ' 2025', '2.025e3']) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ vintage_year }) } }), res);
      assert.equal(res.statusCode, 400, JSON.stringify(vintage_year));
      assert.match(res.body.error, /vendimia/);
    }
    assert.equal(escribio(calls), false);
  });

  it('refuses a movimiento that is not an object', async () => {
    mockSupabase();
    for (const movimiento of [undefined, null, 'trasiego', 7, []]) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento } }), res);
      assert.equal(res.statusCode, 400, JSON.stringify(movimiento));
    }
  });

  it('reports 502 and no success when the insert itself fails', async () => {
    mockSupabase({ insert: (url, opts, ok) => ok({ message: 'violates check constraint' }, 400) });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.notEqual(res.statusCode, 200);
    assert.equal(res.body.ok, false);
  });
});

// --- POST anular -------------------------------------------------------------

describe('MT.52 - POST /api/tanques action anular', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('rejects a viewer with 403', async () => {
    mockSupabase();
    const res = makeRes();
    await handler(makeReq({ role: 'viewer', body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 403);
  });

  it('annuls one row by id through the write RPC, at the version it read', async () => {
    const calls = mockSupabase({
      movimientos: logBase(),
      patch: (url, opts, ok) => ok([{ ...logBase()[0], anulado: true }]),
    });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.movimiento.anulado, true);
    // tanques_escribir sets exactly anulado = true, the one change the
    // append-only trigger admits; nothing of the row travels.
    assert.deepEqual(rpcArgs(calls), [{ p_version: 0, p_accion: 'anular', p_fila: null, p_id: 1 }]);
  });

  it('refuses an id that is not a positive integer', async () => {
    mockSupabase();
    for (const id of [undefined, null, 0, -3, 1.5, '1; drop table', {}, Number.MAX_SAFE_INTEGER + 2]) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'anular', id } }), res);
      assert.equal(res.statusCode, 400, JSON.stringify(id));
    }
  });

  it('accepts an id sent as a digit string', async () => {
    mockSupabase({ patch: (url, opts, ok) => ok([{ ...logBase()[0], anulado: true }]) });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: '1' } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  it('returns 404 for an id that is not in the log', async () => {
    const calls = mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 777 } }), res);
    assert.equal(res.statusCode, 404);
    assert.equal(escribio(calls), false);
  });

  it('is idempotent on an already annulled row and writes nothing', async () => {
    const calls = mockSupabase({ movimientos: [{ ...logBase()[0], anulado: true }] });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ya_anulado, true);
    assert.equal(escribio(calls), false);
  });

  it('refuses an annulment that overdraws a later movement', async () => {
    // Annulling the recepcion leaves the 05 Sep trasiego taking 10000 L out of
    // an empty A1. estado.js does not check this; the endpoint has to.
    const calls = mockSupabase({ movimientos: [
      ...logBase(),
      { id: 2, fecha: '2025-09-05', tipo: 'trasiego', origen: 'A1', destino: 'A2',
        lot_code: 'CS-01', vintage_year: 2025, volumen_l: '10000', merma_l: '0',
        nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
        created_at: '2025-09-05T18:00:00+00:00' },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /posterior/);
    assert.equal(escribio(calls), false);
  });

  it('allows annulling the last movement, which breaks nothing after it', async () => {
    mockSupabase({
      movimientos: [
        ...logBase(),
        { id: 2, fecha: '2025-09-05', tipo: 'trasiego', origen: 'A1', destino: 'A2',
          lot_code: 'CS-01', vintage_year: 2025, volumen_l: '4000', merma_l: '0',
          nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
          created_at: '2025-09-05T18:00:00+00:00' },
      ],
      patch: (url, opts, ok) => ok([{ id: 2, anulado: true }]),
    });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 2 } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  it('does not report an inconsistency the log already had without this row', async () => {
    // A2 is overfilled by row 3 on its own; annulling row 2 must not be blamed
    // for an aviso that is already there.
    mockSupabase({
      movimientos: [
        ...logBase(),
        { id: 2, fecha: '2025-09-05', tipo: 'trasiego', origen: 'A1', destino: 'A3',
          lot_code: 'CS-01', vintage_year: 2025, volumen_l: '500', merma_l: '0',
          nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
          created_at: '2025-09-05T18:00:00+00:00' },
        { id: 3, fecha: '2025-09-06', tipo: 'recepcion', origen: null, destino: 'A3',
          lot_code: 'ME-02', vintage_year: 2025, volumen_l: '9000', merma_l: '0',
          nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
          created_at: '2025-09-06T18:00:00+00:00' },
      ],
      patch: (url, opts, ok) => ok([{ id: 2, anulado: true }]),
    });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 2 } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  });

  it('refuses an annulment that DEEPENS an overdraw the log already had', async () => {
    // A1 takes 9000 L then 1000 L. Two 6000 L withdrawals landed through the
    // known concurrency race, so the second already owes 2000 L and the replay
    // already says so. Annulling the 1000 L reception takes that debt to
    // 3000 L: an inconsistency that exists is not permission to worsen it
    // (lucy, 2026-10-15).
    const comun = { lot_code: 'CS-01', vintage_year: 2025, merma_l: '0', nota: null,
                    fuente: 'manual', creado_por: 'labuser', anulado: false };
    const calls = mockSupabase({ movimientos: [
      { id: 1, fecha: '2025-09-01', tipo: 'recepcion', origen: null, destino: 'A1',
        volumen_l: '9000', created_at: '2025-09-01T18:00:00+00:00', ...comun },
      { id: 2, fecha: '2025-09-02', tipo: 'recepcion', origen: null, destino: 'A1',
        volumen_l: '1000', created_at: '2025-09-02T18:00:00+00:00', ...comun },
      { id: 3, fecha: '2025-09-05', tipo: 'trasiego', origen: 'A1', destino: 'A2',
        volumen_l: '6000', created_at: '2025-09-05T18:00:00+00:00', ...comun },
      { id: 4, fecha: '2025-09-05', tipo: 'trasiego', origen: 'A1', destino: 'A2',
        volumen_l: '6000', created_at: '2025-09-05T18:00:01+00:00', ...comun },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 2 } }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /posterior/);
    assert.equal(escribio(calls), false);
  });

  it('allows an annulment that REDUCES an overflow the log already had', async () => {
    // A3 (1000 L) is already overfull by row 3 on its own. Annulling row 2
    // leaves it with 9000 L instead of 9500 L over the same capacity: still
    // wrong, but less wrong, so it is not the annulment's fault.
    const comun = { lot_code: 'CS-01', vintage_year: 2025, merma_l: '0', nota: null,
                    fuente: 'manual', creado_por: 'labuser', anulado: false };
    let patched = false;
    mockSupabase({
      movimientos: [
        ...logBase(),
        { id: 2, fecha: '2025-09-05', tipo: 'trasiego', origen: 'A1', destino: 'A3',
          volumen_l: '500', created_at: '2025-09-05T18:00:00+00:00', ...comun },
        { id: 3, fecha: '2025-09-06', tipo: 'recepcion', origen: null, destino: 'A3',
          volumen_l: '9000', created_at: '2025-09-06T18:00:00+00:00', ...comun, lot_code: 'ME-02' },
      ],
      patch: (url, opts, ok) => { patched = true; return ok([{ id: 2, anulado: true }]); },
    });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 2 } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(patched, true);
  });

  it('refuses an annulment that makes an existing overflow worse', async () => {
    // A2 is overfilled on 07 Sep. Annulling the 06 Sep salida out of A2 leaves
    // 3000 L more standing there when the 07 Sep arrival lands.
    const comun = { lot_code: 'CS-01', vintage_year: 2025, merma_l: '0', nota: null,
                    fuente: 'manual', creado_por: 'labuser', anulado: false };
    const calls = mockSupabase({ movimientos: [
      { id: 1, fecha: '2025-09-01', tipo: 'recepcion', origen: null, destino: 'A2',
        volumen_l: '19000', created_at: '2025-09-01T18:00:00+00:00', ...comun },
      { id: 2, fecha: '2025-09-06', tipo: 'salida', origen: 'A2', destino: null,
        volumen_l: '3000', created_at: '2025-09-06T18:00:00+00:00', ...comun },
      { id: 3, fecha: '2025-09-07', tipo: 'recepcion', origen: null, destino: 'A2',
        volumen_l: '5000', created_at: '2025-09-07T18:00:00+00:00', ...comun, lot_code: 'ME-02' },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 2 } }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(res.body));
    assert.match(res.body.error, /posterior/);
    assert.equal(escribio(calls), false);
  });

  it('returns 404 when the PATCH matches no row (annulled by someone else first)', async () => {
    mockSupabase({ patch: (url, opts, ok) => ok([]) });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 404);
  });
});

// --- concurrent writes (xd-qrn.8) ------------------------------------------

describe('MT.52 - concurrent writes are serialized by the version check', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  // A mock whose log GROWS with each insert, so a request that reads after
  // another one has written really does see that write.
  function mockLogQueVaCreciendo() {
    const log = logBase();
    const calls = mockSupabase({
      movimientos: log,
      insert: (url, opts, ok) => {
        const row = JSON.parse(opts.body);
        row.id = 100 + log.length;
        row.created_at = new Date().toISOString();
        row.anulado = false;
        log.push(row);
        return ok([row]);
      },
    });
    return { log, calls };
  }

  const saca6000 = () => makeReq({ body: { action: 'crear', movimiento: movimiento({ volumen_l: 6000 }) } });

  it('refuses the second of two SEQUENTIAL withdrawals that together overdraw', async () => {
    mockLogQueVaCreciendo();
    const resA = makeRes();
    await handler(saca6000(), resA);
    assert.equal(resA.statusCode, 200, JSON.stringify(resA.body));
    const resB = makeRes();
    await handler(saca6000(), resB);
    assert.equal(resB.statusCode, 400);
    assert.match(resB.body.error, /excede el contenido del tanque A1/);
  });

  it('refuses the second of two CONCURRENT withdrawals: it is retried against the new log', async () => {
    // Both requests read version 0 and a log holding 10000 L, and both judge
    // their 6000 L as fine. The first write bumps the version; the second gets
    // `conflicto`, re-reads the log with the first withdrawal in it, and is
    // refused. Before xd-qrn.8 both landed and the log owed 2000 L.
    const { log, calls } = mockLogQueVaCreciendo();
    const resA = makeRes(), resB = makeRes();
    await Promise.all([handler(saca6000(), resA), handler(saca6000(), resB)]);
    const codigos = [resA.statusCode, resB.statusCode].sort();
    assert.deepEqual(codigos, [200, 400], JSON.stringify([resA.body, resB.body]));
    const rechazo = resA.statusCode === 400 ? resA.body : resB.body;
    assert.match(rechazo.error, /excede el contenido del tanque A1/);
    assert.equal(log.length, 2, 'only one withdrawal landed');
    // the race really happened: both writes were sent at version 0
    assert.deepEqual(rpcArgs(calls).map(a => a.p_version), [0, 0]);

    const { avisos } = replayMovimientos(TANQUES, log.map(m => ({ ...m, volumen_l: Number(m.volumen_l), merma_l: Number(m.merma_l) })));
    assert.equal(avisos.some(a => a.codigo === 'sobregiro'), false, JSON.stringify(avisos));
  });

  it('gives up with 409 after three conflicts, writing nothing', async () => {
    let intentos = 0;
    mockSupabase({ rpc: (args, ok, db) => { intentos++; return ok({ resultado: 'conflicto', version: db.v + 1 }); } });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /cambi/);
    assert.equal(intentos, 3);
  });

  it('retries an annulment on conflict too', async () => {
    let intentos = 0;
    mockSupabase({ rpc: (args, ok, db) => { intentos++; return ok({ resultado: 'conflicto', version: 5 }); } });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(intentos, 3);
  });

  it('reads the version BEFORE the log, so a write between the two reads is a conflict', async () => {
    const calls = mockSupabase();
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const iVersion = calls.findIndex(c => c.url.includes('/tanques_version'));
    const iLog = calls.findIndex(c => c.url.includes('/movimientos_tanque'));
    assert.ok(iVersion >= 0 && iVersion < iLog, `version read at ${iVersion}, log read at ${iLog}`);
  });
});

// --- idempotency and unknown outcomes ----------------------------------------

describe('MT.52 - a lost acknowledgment never writes twice', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  it('requires a UUID client_id on crear', async () => {
    const calls = mockSupabase();
    for (const client_id of [undefined, null, '', 'abc', '1234', 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz', 7]) {
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ client_id }) } }), res);
      assert.equal(res.statusCode, 400, String(client_id));
      assert.match(res.body.error, /client_id|texto/);
    }
    assert.equal(escribio(calls), false);
  });

  it('answers a retry whose first attempt already landed with that row, without writing', async () => {
    // The first POST committed and its answer was lost. The retry carries the
    // same client_id; judging it again would count it twice.
    const cid = crypto.randomUUID();
    const calls = mockSupabase({ movimientos: [
      ...logBase(),
      { id: 2, fecha: '2025-09-10', tipo: 'trasiego', origen: 'A1', destino: 'A2',
        lot_code: 'CS-01', vintage_year: 2025, volumen_l: '6000', merma_l: '0',
        nota: null, fuente: 'manual', creado_por: 'labuser', anulado: false,
        created_at: '2025-09-10T18:00:00+00:00', client_id: cid },
    ]});
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear',
      movimiento: movimiento({ volumen_l: 6000, client_id: cid.toUpperCase() }) } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.duplicado, true);
    assert.equal(res.body.movimiento.id, 2);
    assert.equal(escribio(calls), false);
  });

  it('passes on the RPC duplicado as the existing row', async () => {
    const cid = crypto.randomUUID();
    mockSupabase({ rpc: (args, ok) => ok({ resultado: 'duplicado',
      fila: { ...logBase()[0], id: 5, client_id: cid, volumen_l: 5000 } }) });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento({ client_id: cid }) } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.duplicado, true);
    assert.equal(res.body.movimiento.id, 5);
  });

  it('reports a write whose fetch rejects as indeterminate (503), not as a refusal', async () => {
    mockSupabase({ rpc: () => { throw new TypeError('fetch failed'); } });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.indeterminado, true);
    assert.match(res.body.error, /confirmar/);
  });

  it('reports a timed-out write as indeterminate, and does give the RPC a timeout', async () => {
    let signal = null;
    const calls = mockSupabase();
    const base = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (url.includes('/rpc/tanques_escribir')) {
        signal = opts.signal;
        const e = new Error('This operation was aborted');
        e.name = 'AbortError';
        throw e;
      }
      return base(url, opts);
    };
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.ok(signal instanceof AbortSignal, 'the RPC fetch carries an AbortSignal');
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.indeterminado, true);
    assert.ok(calls.length > 0);
  });

  it('reports a 5xx from the RPC as indeterminate: a gateway can time out after the commit', async () => {
    for (const status of [500, 502, 504]) {
      mockSupabase({ rpc: (args, ok) => ok({ message: 'upstream timeout' }, status) });
      const res = makeRes();
      await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
      assert.equal(res.statusCode, 503, String(status));
      assert.equal(res.body.indeterminado, true);
    }
  });

  it('reports an unreadable 2xx from the RPC as indeterminate', async () => {
    mockSupabase({ rpc: () => ({ ok: true, status: 200, text: async () => '<html>' }) });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.indeterminado, true);
  });

  it('keeps a 4xx from the RPC a definite failure: the statement raised and rolled back', async () => {
    mockSupabase({ rpc: (args, ok) => ok({ message: 'violates check constraint' }, 400) });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.indeterminado, undefined);
  });

  it('keeps a failed READ a definite failure: nothing was sent yet', async () => {
    const calls = mockSupabase();
    const base = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      if (url.includes('/movimientos_tanque')) throw new TypeError('fetch failed');
      return base(url, opts);
    };
    const res = makeRes();
    await handler(makeReq({ body: { action: 'crear', movimiento: movimiento() } }), res);
    assert.notEqual(res.statusCode, 200);
    assert.notEqual(res.statusCode, 503);
    assert.equal(res.body.indeterminado, undefined);
    assert.equal(escribio(calls), false);
  });
});

// --- client side -------------------------------------------------------------

describe('MT.52 - DataStore.loadTanques / postMovimiento / anularMovimiento', () => {
  let originalFetch, originalLocalStorage, DataStore;

  before(async () => {
    // dataLoader reads localStorage for the session token at call time.
    globalThis.localStorage = {
      _s: { xanic_session_token: 'tok' },
      getItem(k) { return this._s[k] ?? null; },
      setItem(k, v) { this._s[k] = String(v); },
      removeItem(k) { delete this._s[k]; },
    };
    DataStore = (await import('../js/dataLoader.js')).DataStore;
  });

  beforeEach(() => { originalFetch = globalThis.fetch; originalLocalStorage = globalThis.localStorage; });
  afterEach(()  => { globalThis.fetch = originalFetch; globalThis.localStorage = originalLocalStorage; });

  const cuerpo = {
    ok: true,
    tanques: TANQUES,
    sinonimos: { TIB13: 'TIBOR 13' },
    movimientos: [{ ...logBase()[0], volumen_l: 10000, merma_l: 0, anulado: false }],
  };

  it('loadTanques sends the session token and fills the three stores', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => cuerpo };
    };
    assert.equal(await DataStore.loadTanques(), true);
    assert.equal(calls[0].url, '/api/tanques');
    assert.equal(calls[0].opts.headers['x-session-token'], 'tok');
    assert.equal(DataStore.tanquesCatalogo.length, 4);
    assert.equal(DataStore.movimientosTanque.length, 1);
    assert.deepEqual(DataStore.tanquesSinonimos, { TIB13: 'TIBOR 13' });
  });

  it('loadTanques reports false and keeps the old stores when the endpoint fails', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 502, json: async () => ({ ok: false, error: 'boom' }) });
    assert.equal(await DataStore.loadTanques(), false);
    assert.equal(DataStore.tanquesCatalogo.length, 4);  // untouched from the test above
  });

  it('postMovimiento posts the crear envelope and refreshes the log', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url, opts });
      if ((opts.method || 'GET') === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, movimiento: { id: 7 } }) };
      }
      return { ok: true, status: 200, json: async () => cuerpo };
    };
    const mov = movimiento();
    const out = await DataStore.postMovimiento(mov);
    assert.equal(out.movimiento.id, 7);
    assert.equal(out.actualizado, true);
    assert.equal(DataStore.tanquesDesactualizado, false);
    const sent = JSON.parse(calls[0].opts.body);
    assert.equal(sent.action, 'crear');
    assert.deepEqual(sent.movimiento, mov);
    assert.equal(calls[0].opts.headers['x-session-token'], 'tok');
    assert.equal(calls.length, 2, 'the log is re-read after a write');
  });

  it('postMovimiento throws the Spanish reason the server gave', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 400,
      json: async () => ({ ok: false, error: 'El tanque origen A1 esta vacio.' }),
    });
    await assert.rejects(() => DataStore.postMovimiento(movimiento()), /A1 esta vacio/);
  });

  it('reports a committed write whose refresh failed instead of hiding it', async () => {
    // The movement IS in the log; only the re-read failed. Reporting this as a
    // failed write would invite a duplicate POST.
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, movimiento: { id: 8 } }) };
      }
      return { ok: false, status: 502, json: async () => ({ ok: false, error: 'boom' }) };
    };
    const out = await DataStore.postMovimiento(movimiento());
    assert.equal(out.movimiento.id, 8);
    assert.equal(out.actualizado, false);
    assert.equal(DataStore.tanquesDesactualizado, true);
    DataStore.tanquesDesactualizado = false;
  });

  it('a cleanly refused write leaves the view marked current', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 400, json: async () => ({ ok: false, error: 'El tanque origen A1 esta vacio.' }),
    });
    await assert.rejects(() => DataStore.postMovimiento(movimiento()), /A1 esta vacio/);
    assert.equal(DataStore.tanquesDesactualizado, false);
  });

  it('reports an unconfirmed write as indeterminate, not as refused', async () => {
    // The request left and no answer came back, so the INSERT may well have
    // committed. Reporting it as refused is what makes someone press the
    // button again and record the movement twice.
    let gets = 0;
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') throw new TypeError('Failed to fetch');
      gets++;
      return { ok: true, status: 200, json: async () => cuerpo };
    };
    await assert.rejects(
      () => DataStore.postMovimiento(movimiento()),
      (e) => e.indeterminado === true && /Revise la bitacora/.test(e.message),
    );
    assert.equal(gets, 1, 'it re-reads what it can');
    // The re-read worked, so the log on screen is the answer to reconcile
    // against; it is the `indeterminado` flag, not a staleness badge, that says
    // the write outcome is unknown.
    assert.equal(DataStore.tanquesDesactualizado, false);
  });

  it('marks the view stale when the unconfirmed write cannot even be re-read', async () => {
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') throw new TypeError('Failed to fetch');
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(() => DataStore.postMovimiento(movimiento()), (e) => e.indeterminado === true);
    assert.equal(DataStore.tanquesDesactualizado, true);
    DataStore.tanquesDesactualizado = false;
  });

  it('an older in-flight load never overwrites a newer one', async () => {
    // A GET issued before a write resolves after that write's refresh. Letting
    // it land would put the pre-write log back and call the view current.
    const viejo = { ...cuerpo, movimientos: [] };
    let suelta;
    const esperando = new Promise(r => { suelta = r; });
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, movimiento: { id: 9 } }) };
      }
      if (!suelta._usado) { suelta._usado = true; await esperando; return { ok: true, status: 200, json: async () => viejo }; }
      return { ok: true, status: 200, json: async () => cuerpo };
    };
    const lento = DataStore.loadTanques();          // generation 1, still in flight
    const out = await DataStore.postMovimiento(movimiento());  // generation 2 lands
    assert.equal(out.actualizado, true);
    assert.equal(DataStore.movimientosTanque.length, 1);
    suelta();
    assert.equal(await lento, false, 'the superseded load reports no success');
    assert.equal(DataStore.movimientosTanque.length, 1, 'and it replaced nothing');
    assert.equal(DataStore.tanquesDesactualizado, false);
  });

  it('generates one client_id per intent when the movement has none', async () => {
    const enviados = [];
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') {
        enviados.push(JSON.parse(opts.body).movimiento);
        return { ok: true, status: 200, json: async () => ({ ok: true, movimiento: { id: 7 } }) };
      }
      return { ok: true, status: 200, json: async () => cuerpo };
    };
    const { client_id, ...sinClave } = movimiento();
    await DataStore.postMovimiento(sinClave);
    await DataStore.postMovimiento(sinClave);
    assert.match(enviados[0].client_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(enviados[0].client_id, enviados[1].client_id, 'two intents, two keys');
    assert.equal('client_id' in sinClave, false, 'the caller object is not mutated');
  });

  it('a retry of an unconfirmed intent reuses the same client_id', async () => {
    const enviados = [];
    let caido = true;
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') {
        enviados.push(JSON.parse(opts.body).movimiento.client_id);
        if (caido) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => ({ ok: true, duplicado: true, movimiento: { id: 7 } }) };
      }
      return { ok: true, status: 200, json: async () => cuerpo };
    };
    const { client_id, ...sinClave } = movimiento();
    let error = null;
    try { await DataStore.postMovimiento(sinClave); } catch (e) { error = e; }
    assert.equal(error && error.indeterminado, true);
    assert.match(enviados[0], /^[0-9a-f-]{36}$/);
    assert.equal(error.movimiento.client_id, enviados[0]);
    caido = false;
    const out = await DataStore.postMovimiento(error.movimiento);
    assert.equal(enviados[1], enviados[0], 'same intent, same key');
    assert.equal(out.duplicado, true);
  });

  it('routes the server indeterminado answer through the reconcile path', async () => {
    let gets = 0;
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') {
        return { ok: false, status: 503, json: async () => ({
          ok: false, indeterminado: true, error: 'No se pudo confirmar si la escritura quedó en la bitácora de tanques.' }) };
      }
      gets++;
      return { ok: true, status: 200, json: async () => cuerpo };
    };
    await assert.rejects(
      () => DataStore.postMovimiento(movimiento()),
      (e) => e.indeterminado === true && /confirmar/.test(e.message) && typeof e.movimiento?.client_id === 'string',
    );
    assert.equal(gets, 1, 'it re-reads the log to reconcile');
  });

  it('reconciles an unconfirmed write that IS in the re-read log into a success', async () => {
    const mov = movimiento();
    const conFila = { ...cuerpo, movimientos: [...cuerpo.movimientos,
      { id: 12, ...mov, client_id: mov.client_id.toUpperCase(), anulado: false }] };
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') {
        return { ok: false, status: 503, json: async () => ({ ok: false, indeterminado: true, error: 'x' }) };
      }
      return { ok: true, status: 200, json: async () => conFila };
    };
    const out = await DataStore.postMovimiento(mov);
    assert.equal(out.reconciliado, true);
    assert.equal(out.movimiento.id, 12);
    assert.equal(out.actualizado, true);
  });

  it('reconciles an unconfirmed annulment that the re-read log shows annulled', async () => {
    const anulada = { ...cuerpo, movimientos: [{ ...cuerpo.movimientos[0], id: 1, anulado: true }] };
    globalThis.fetch = async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'POST') throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => anulada };
    };
    const out = await DataStore.anularMovimiento(1);
    assert.equal(out.reconciliado, true);
    assert.equal(out.movimiento.anulado, true);
  });

  it('anularMovimiento posts the anular envelope', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url, opts });
      if ((opts.method || 'GET') === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, movimiento: { id: 1, anulado: true } }) };
      }
      return { ok: true, status: 200, json: async () => cuerpo };
    };
    const out = await DataStore.anularMovimiento(1);
    assert.equal(out.movimiento.anulado, true);
    assert.equal(out.actualizado, true);
    assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'anular', id: 1 });
  });
});
