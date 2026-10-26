// MT.81 — the mona_uso counter and its token reservations against a real
// Postgres (bead xd-aiz). Skipped unless XD_TEST_PG is a psql conninfo for a
// THROWAWAY database that has the Supabase roles (anon, authenticated,
// service_role WITH BYPASSRLS, as on Supabase) and public.applied_migrations.
// Example:
//   docker run -d --name pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:17-alpine
//   XD_TEST_PG='postgresql://postgres:pw@127.0.0.1:55432/postgres' node --test tests/mt81-mona-uso-pg.test.mjs
//
// The last case runs the REAL /api/mona handler with its two RPCs executed by
// psql against these functions and Anthropic stubbed (no provider spend), so
// the cap is proven with streams held open, not with bare reservations.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import http from 'node:http';

const PG = process.env.XD_TEST_PG;
const MIGRATIONS = ['migration_mona_uso', 'migration_mona_uso_reserva']
  .map(n => fileURLToPath(new URL(`../sql/${n}.sql`, import.meta.url)));
const psql = (sql) => execFileSync('psql', [PG, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const psqlAsync = promisify(execFile);
const asService = (sql) => psql(`set role service_role; ${sql}`);
const uuid = () => crypto.randomUUID();
const reservar = (id, user, tokens, maxPet, maxTok) =>
  JSON.parse(asService(`select mona_uso_reservar('${id}', '${user}', ${tokens}, ${maxPet}, ${maxTok})`));
const fila = (user) => psql(`select peticiones || ' ' || tokens || ' ' || tokens_reservados from public.mona_uso
  where username = '${user}' and dia = (now() at time zone 'America/Tijuana')::date`);

describe('MT.81 — mona_uso reservations', { skip: !PG && 'XD_TEST_PG not set' }, () => {
  before(() => {
    for (const f of MIGRATIONS) execFileSync('psql', [PG, '-qX', '-v', 'ON_ERROR_STOP=1', '-f', f]);
    psql("delete from public.mona_uso_reserva where username like 'mt81-%'; delete from public.mona_uso where username like 'mt81-%'");
  });

  it('40 concurrent reservations that are never reconciled admit exactly the token budget', async () => {
    // Request cap is not the binding one: 25 x 1000 tokens fill the 25000 cap.
    const one = () => psqlAsync('psql', [PG, '-qtAX', '-c',
      `set role service_role; select mona_uso_reservar('${uuid()}', 'mt81-a', 1000, 1000, 25000)->>'permitido'`]);
    const out = await Promise.all(Array.from({ length: 40 }, one));
    assert.equal(out.filter(o => o.stdout.trim() === 'true').length, 25);
    assert.equal(fila('mt81-a'), '25 0 25000');
  });

  it('the request cap still binds on its own', async () => {
    const one = () => psqlAsync('psql', [PG, '-qtAX', '-c',
      `set role service_role; select mona_uso_reservar('${uuid()}', 'mt81-r', 1, 7, 1000000)->>'permitido'`]);
    const out = await Promise.all(Array.from({ length: 20 }, one));
    assert.equal(out.filter(o => o.stdout.trim() === 'true').length, 7);
  });

  it('reconciling charges the real usage and releases the hold, once per id', () => {
    const id = uuid();
    assert.equal(reservar(id, 'mt81-b', 4000, 100, 5000).permitido, true);
    assert.equal(reservar(uuid(), 'mt81-b', 4000, 100, 5000).permitido, false, 'the held 4000 counts');
    assert.equal(fila('mt81-b'), '1 0 4000');
    assert.deepEqual(JSON.parse(asService(`select mona_uso_reconciliar('${id}', 1500)`)), { reconciliado: true, nuevo: true });
    assert.deepEqual(JSON.parse(asService(`select mona_uso_reconciliar('${id}', 1500)`)), { reconciliado: true, nuevo: false });
    assert.equal(fila('mt81-b'), '1 1500 0');
    assert.equal(reservar(uuid(), 'mt81-b', 3500, 100, 5000).permitido, true);
    assert.equal(reservar(uuid(), 'mt81-b', 1, 100, 5000).permitido, false);
  });

  it('a retried reservation with the same id reserves nothing more; another user cannot reuse it', () => {
    const id = uuid();
    assert.equal(reservar(id, 'mt81-c', 700, 100, 10000).permitido, true);
    assert.equal(reservar(id, 'mt81-c', 700, 100, 10000).permitido, true);
    assert.equal(fila('mt81-c'), '1 0 700');
    assert.throws(() => reservar(id, 'mt81-d', 700, 100, 10000), /otra cuenta/);
  });

  it('negative charges count as 0, an unknown id is an error, bad input is refused', () => {
    const id = uuid();
    reservar(id, 'mt81-e', 100, 10, 1000);
    asService(`select mona_uso_reconciliar('${id}', -50)`);
    assert.equal(fila('mt81-e'), '1 0 0');
    assert.throws(() => asService(`select mona_uso_reconciliar('${uuid()}', 1)`), /reserva desconocida/);
    assert.throws(() => reservar(uuid(), 'mt81-e', -1, 10, 1000), /tokens invalidos/);
    assert.throws(() => reservar(uuid(), '', 1, 10, 1000), /requeridos/);
  });

  it('a reservation held on an earlier day does not count today', () => {
    psql(`insert into public.mona_uso (username, dia, tokens_reservados)
      values ('mt81-f', (now() at time zone 'America/Tijuana')::date - 1, 999999)`);
    assert.equal(reservar(uuid(), 'mt81-f', 100, 10, 1000).permitido, true);
  });

  it('anon and authenticated cannot call either function or read the tables', () => {
    for (const role of ['anon', 'authenticated']) {
      assert.throws(() => psql(`set role ${role}; select mona_uso_reservar('${uuid()}', 'mt81-x', 1, 1, 1)`), /permission denied/);
      assert.throws(() => psql(`set role ${role}; select mona_uso_reconciliar('${uuid()}', 1)`), /permission denied/);
      assert.throws(() => psql(`set role ${role}; select * from public.mona_uso_reserva`), /permission denied/);
    }
  });

  it('the real handler: with streams held open, only the worst cases that fit get through', async () => {
    const SECRET = 'mt81-secret';
    process.env.SESSION_SECRET = SECRET;
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'k';
    process.env.ANTHROPIC_API_KEY = 'a';
    const handler = (await import('../api/mona.js')).default;
    const p = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000, role: 'lab', user: 'mt81-h', nonce: 'n' })).toString('base64url');
    const tok = `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`;
    const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

    const fetchReal = globalThis.fetch;
    const signals = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('token_blacklist')) return { ok: true, json: async () => [] };
      if (u.includes('mona_knowledge')) return { ok: true, json: async () => [] };
      const rpc = u.match(/\/rest\/v1\/rpc\/(mona_uso_\w+)$/);
      if (rpc) {
        const args = Object.entries(JSON.parse(opts.body)).map(([k, v]) => `${k} => ${lit(v)}`).join(', ');
        const { stdout } = await psqlAsync('psql', [PG, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c',
          `set role service_role; select ${rpc[1]}(${args})`]);
        return { ok: true, text: async () => stdout.trim() };
      }
      if (u.startsWith('https://api.anthropic.com')) {
        signals.push(opts.signal);
        const body = new ReadableStream({ start(c) {
          c.enqueue(new TextEncoder().encode(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 900, output_tokens: 1 } } })}\n\n`));
          opts.signal.addEventListener('abort', () => c.error(opts.signal.reason));
        } });
        return { ok: true, status: 200, body };
      }
      throw new Error('unexpected ' + u);
    };

    const server = http.createServer(async (req, res) => {
      let raw = ''; for await (const c of req) raw += c;
      req.body = JSON.parse(raw);
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (b) => { res.end(JSON.stringify(b)); return res; };
      await handler(req, res);
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const { port } = server.address();
    const open = (body) => new Promise((resolve) => {
      const req = http.request({ port, host: '127.0.0.1', method: 'POST', path: '/api/mona',
        headers: { 'content-type': 'application/json', 'x-session-token': tok } },
      (resp) => resolve({ status: resp.statusCode, req, resp }));
      req.on('error', () => {});
      req.end(JSON.stringify(body));
    });

    const keep = process.env.MONA_MAX_TOKENS_DIA;
    try {
      const body = { messages: [{ role: 'user', content: '¿Cómo va el °Bx del Cabernet?' }] };
      // Size the cap from one real reservation: room for exactly 3 worst cases.
      const probe = await open(body);
      const hold = Number(psql("select tokens_reservados from public.mona_uso where username = 'mt81-h'"));
      assert.ok(hold > 4096, `worst case includes max_tokens (${hold})`);
      process.env.MONA_MAX_TOKENS_DIA = String(Math.floor(hold * 3.5));

      const rest = await Promise.all(Array.from({ length: 9 }, () => open(body)));
      const all = [probe, ...rest];
      const admitted = all.filter(r => r.status === 200);
      assert.equal(admitted.length, 3, all.map(r => r.status).join(','));
      assert.ok(all.filter(r => r.status !== 200).every(r => r.status === 429));
      assert.equal(signals.length, 3, 'only the admitted requests reached Anthropic');
      assert.equal(fila('mt81-h'), `3 0 ${hold * 3}`);

      // The tabs close: each stream is aborted and reconciled at its worst output.
      for (const r of admitted) r.req.destroy();
      for (let i = 0; i < 50 && psql("select count(*) from public.mona_uso_reserva where username = 'mt81-h' and cobrado is null") !== '0'; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      assert.ok(signals.every(s => s.aborted));
      assert.equal(fila('mt81-h'), `3 ${3 * (900 + 4096)} 0`);
    } finally {
      if (keep === undefined) delete process.env.MONA_MAX_TOKENS_DIA; else process.env.MONA_MAX_TOKENS_DIA = keep;
      globalThis.fetch = fetchReal;
      server.closeAllConnections();
      await new Promise(r => server.close(r));
    }
  });
});
