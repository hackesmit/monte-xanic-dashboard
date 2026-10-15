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

function mockSupabase({ tanques = TANQUES, sinonimos = SINONIMOS, movimientos = logBase(),
                        insert, patch, blacklisted = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    calls.push({ url, method, opts });
    const ok = (json, status = 200) => ({
      ok: status >= 200 && status < 300, status,
      json: async () => json, text: async () => JSON.stringify(json),
    });

    if (url.includes('token_blacklist')) return ok(blacklisted ? [{ token_hash: 'x' }] : []);

    const page = (rows) => {
      const m = /[?&]offset=(\d+)/.exec(url);
      const l = /[?&]limit=(\d+)/.exec(url);
      const from = m ? Number(m[1]) : 0;
      const size = l ? Number(l[1]) : rows.length;
      return ok(rows.slice(from, from + size));
    };

    if (url.includes('/dim_tanque_sinonimo')) return page(sinonimos);
    if (url.includes('/dim_tanque')) return page(tanques);
    if (url.includes('/movimientos_tanque')) {
      if (method === 'POST')  return insert ? insert(url, opts, ok) : ok([{ id: 99, ...JSON.parse(opts.body) }]);
      if (method === 'PATCH') return patch  ? patch(url, opts, ok)  : ok([{ ...movimientos[0], anulado: true }]);
      return page(movimientos);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return calls;
}

const movimiento = (over = {}) => ({
  fecha: '2025-09-10', tipo: 'trasiego', origen: 'A1', destino: 'A2',
  lot_code: 'CS-01', vintage_year: 2025, volumen_l: 5000, ...over,
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
    const insert = calls.find(c => c.method === 'POST' && c.url.includes('/movimientos_tanque'));
    assert.equal(insert.opts.headers.Prefer, 'return=representation');
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
    assert.equal(calls.some(c => c.method === 'POST' && c.url.includes('/movimientos_tanque')), false);
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

  it('annulls one row by id, patching only anulado', async () => {
    let sent = null;
    const calls = mockSupabase({
      movimientos: logBase(),
      patch: (url, opts, ok) => { sent = JSON.parse(opts.body); return ok([{ ...logBase()[0], anulado: true }]); },
    });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.movimiento.anulado, true);
    assert.deepEqual(sent, { anulado: true });  // the append-only trigger rejects anything else
    const patch = calls.find(c => c.method === 'PATCH');
    assert.match(patch.url, /\/movimientos_tanque\?id=eq\.1/);
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
    assert.equal(calls.some(c => c.method === 'PATCH'), false);
  });

  it('is idempotent on an already annulled row and writes nothing', async () => {
    const calls = mockSupabase({ movimientos: [{ ...logBase()[0], anulado: true }] });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ya_anulado, true);
    assert.equal(calls.some(c => c.method === 'PATCH'), false);
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
    assert.equal(calls.some(c => c.method === 'PATCH'), false);
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

  it('returns 404 when the PATCH matches no row (annulled by someone else first)', async () => {
    mockSupabase({ patch: (url, opts, ok) => ok([]) });
    const res = makeRes();
    await handler(makeReq({ body: { action: 'anular', id: 1 } }), res);
    assert.equal(res.statusCode, 404);
  });
});

// --- known limitation --------------------------------------------------------

describe('MT.52 - concurrent writes (known limitation)', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(()  => { globalThis.fetch = originalFetch; });

  // A mock whose log GROWS with each insert, so a request that reads after
  // another one has written really does see that write.
  function mockLogQueVaCreciendo() {
    const log = logBase();
    mockSupabase({
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
    return log;
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

  it('lets both land when they run CONCURRENTLY, and the overdraw shows up as an aviso', async () => {
    // Deliberate proof, not a wish. Validation is read-then-insert with no lock
    // and no DB-side constraint that can see the derived state, so two requests
    // in flight at once each take 6000 L of the 10000 L in A1. Documented in
    // docs/API.md and escalated as a design question rather than patched with
    // ad-hoc locking: the bead DoD stop-when says escalate, do not improvise,
    // so the design question is bead xd-qrn.8.
    const log = mockLogQueVaCreciendo();
    const resA = makeRes(), resB = makeRes();
    await Promise.all([handler(saca6000(), resA), handler(saca6000(), resB)]);
    assert.equal(resA.statusCode, 200, JSON.stringify(resA.body));
    assert.equal(resB.statusCode, 200, JSON.stringify(resB.body));
    assert.equal(log.length, 3);

    // The failure mode is a visible warning on an honest append-only log, not
    // silent corruption: the replay clamps the second withdrawal and says so.
    const { avisos } = replayMovimientos(TANQUES, log);
    assert.ok(avisos.some(a => a.codigo === 'sobregiro'), JSON.stringify(avisos));
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
    assert.equal(out.id, 7);
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
    assert.equal(out.anulado, true);
    assert.deepEqual(JSON.parse(calls[0].opts.body), { action: 'anular', id: 1 });
  });
});
