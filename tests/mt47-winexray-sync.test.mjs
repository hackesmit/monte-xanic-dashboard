// MT.47 — WineXRay sync: adapter transport rules + handler gating.
//
// The adapter is the surface that holds the winery's WineXRay login, so these
// tests are mostly about what it REFUSES to do: talk to another origin, follow
// a redirect, accept login HTML as data, or leak a credential into an error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WineXRayClient, WineXRayError } from '../api/_lib/winexrayClient.js';

const CREDS = { username: 'lab-user', password: 'sup3r-s3cret-pw' };

// Minimal Response stand-in; `getSetCookie` mirrors undici's Headers.
function mkRes({ status = 200, headers = {}, body = '', setCookie = [] } = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: k => h.get(String(k).toLowerCase()) ?? null,
      getSetCookie: () => setCookie,
    },
    async text() { return body; },
    async json() { return JSON.parse(body); },
    async arrayBuffer() { return new TextEncoder().encode(body).buffer; },
  };
}

function recorder(responses) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[i++];
    if (typeof r === 'function') return r(url, opts);
    return r;
  };
  return { calls, fetchImpl };
}

const LOGIN_OK = mkRes({
  status: 303,
  headers: { location: '/client-center' },
  setCookie: ['_ncfa=session-value-abc; path=/; HttpOnly', 'userName=; expires=Thu, 01 Jan 1970 00:00:00 GMT'],
});

test('MT.47 — constructor rejects missing credentials', () => {
  assert.throws(() => new WineXRayClient({}), WineXRayError);
  assert.throws(() => new WineXRayClient({ username: 'u' }), WineXRayError);
});

test('MT.47 — login reads the 303 Set-Cookie and never follows it', async () => {
  const { calls, fetchImpl } = recorder([LOGIN_OK]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  assert.equal(calls.length, 1);
  // Following the redirect would discard the header we need.
  assert.equal(calls[0].opts.redirect, 'manual');
  assert.match(calls[0].url, /^https:\/\/client\.winexray\.com\/login/);
});

test('MT.47 — login sends credentials in a form body, not the URL', async () => {
  const { calls, fetchImpl } = recorder([LOGIN_OK]);
  await new WineXRayClient({ ...CREDS, fetchImpl }).login();
  assert.ok(!calls[0].url.includes(CREDS.password), 'password must not be in the URL');
  assert.ok(!calls[0].url.includes(CREDS.username), 'username must not be in the URL');
  assert.match(calls[0].opts.body, /username=lab-user/);
});

test('MT.47 — login without an _ncfa cookie is an auth failure', async () => {
  const { fetchImpl } = recorder([mkRes({ status: 303, setCookie: ['other=1; path=/'] })]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await assert.rejects(() => c.login(), e => e instanceof WineXRayError && e.code === 'winexray_auth');
});

test('MT.47 — the session cookie is attached to later requests, value only', async () => {
  const { calls, fetchImpl } = recorder([
    LOGIN_OK,
    mkRes({ headers: { 'content-type': 'application/json' }, body: '{"count":0,"results":[]}' }),
  ]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  await c.listResults({ from: '2026-08-01', to: '2026-08-28' });
  assert.equal(calls[1].opts.headers.Cookie, '_ncfa=session-value-abc');
  // Attributes must not ride along.
  assert.ok(!/HttpOnly|path=/i.test(calls[1].opts.headers.Cookie));
});

test('MT.47 — a 303 to /login on a data call is an expired session, not data', async () => {
  const { fetchImpl } = recorder([
    LOGIN_OK,
    mkRes({ status: 303, headers: { location: '/login?returnUrl=/api/results' } }),
  ]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  await assert.rejects(
    () => c.listResults({ from: '2026-08-01', to: '2026-08-28' }),
    e => e instanceof WineXRayError && e.code === 'winexray_auth'
  );
});

test('MT.47 — login HTML with a 200 is an auth failure, never parsed as data', async () => {
  const { fetchImpl } = recorder([
    LOGIN_OK,
    mkRes({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<html>login</html>' }),
  ]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  await assert.rejects(
    () => c.listResults({ from: '2026-08-01', to: '2026-08-28' }),
    e => e instanceof WineXRayError && e.code === 'winexray_auth'
  );
});

test('MT.47 — dates must be date-only; an ISO timestamp would 500 upstream', async () => {
  const { fetchImpl } = recorder([LOGIN_OK]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  for (const bad of ['2026-08-01T00:00:00Z', '2026-08-01T12:00:00', '08/01/2026', '']) {
    await assert.rejects(
      () => c.listResults({ from: bad, to: '2026-08-28' }),
      e => e instanceof WineXRayError && e.code === 'winexray_date',
      `expected rejection for ${JSON.stringify(bad)}`
    );
  }
});

test('MT.47 — listResults sends date-only bounds and the sampleDate field', async () => {
  const { calls, fetchImpl } = recorder([
    LOGIN_OK,
    mkRes({ headers: { 'content-type': 'application/json' }, body: '{"count":2,"results":[{"id":11},{"id":12}]}' }),
  ]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  const rows = await c.listResults({ from: '2026-07-01', to: '2026-07-31' });
  const sent = JSON.parse(calls[1].opts.body);
  assert.equal(sent.dateStart, '2026-07-01');
  assert.equal(sent.dateEnd, '2026-07-31');
  assert.equal(sent.dateSearchField, 'sampleDate');
  assert.deepEqual(rows.map(r => r.id), [11, 12]);
});

test('MT.47 — a non-GUID export response is rejected rather than downloaded', async () => {
  const { fetchImpl } = recorder([
    LOGIN_OK,
    mkRes({ headers: { 'content-type': 'text/plain' }, body: 'not-a-guid' }),
  ]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  await assert.rejects(
    () => c.createExport([1, 2]),
    e => e instanceof WineXRayError && e.code === 'winexray_guid'
  );
});

test('MT.47 — CSV is returned as bytes so the parser owns decoding', async () => {
  const { calls, fetchImpl } = recorder([
    LOGIN_OK,
    mkRes({ headers: { 'content-type': 'text/csv' }, body: 'Sample Id,Brix\n26MX-1,24.1\n' }),
  ]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  const buf = await c.downloadCsv('2f1c4e60-1111-2222-3333-444455556666');
  assert.ok(buf instanceof ArrayBuffer);
  assert.match(new TextDecoder().decode(buf), /Sample Id/);
  assert.match(calls[1].url, /guid=2f1c4e60/);
});

test('MT.47 — errors never carry the credential, cookie or export GUID', async () => {
  const guid = '2f1c4e60-1111-2222-3333-444455556666';
  const { fetchImpl } = recorder([
    LOGIN_OK,
    mkRes({ status: 500, headers: { 'content-type': 'text/plain' }, body: 'boom' }),
  ]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  await c.login();
  const err = await c.downloadCsv(guid).then(() => null, e => e);
  assert.ok(err instanceof WineXRayError);
  for (const secret of [CREDS.password, CREDS.username, 'session-value-abc', guid]) {
    assert.ok(!err.message.includes(secret), `error message leaked ${secret}`);
  }
});

test('MT.47 — a network failure is a Spanish adapter error, not a raw throw', async () => {
  const fetchImpl = async () => { throw new Error('connect ECONNREFUSED https://client.winexray.com/login?x=secret'); };
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  const err = await c.login().then(() => null, e => e);
  assert.ok(err instanceof WineXRayError);
  assert.equal(err.code, 'winexray_network');
  assert.ok(!err.message.includes('secret'));
});

test('MT.47 — an empty window short-circuits before creating an export', async () => {
  const { calls, fetchImpl } = recorder([
    LOGIN_OK,
    mkRes({ headers: { 'content-type': 'application/json' }, body: '{"count":0,"results":[]}' }),
  ]);
  const c = new WineXRayClient({ ...CREDS, fetchImpl });
  const out = await c.fetchExportCsv({ from: '2026-01-01', to: '2026-01-02' });
  assert.equal(out.sampleCount, 0);
  assert.equal(out.buffer, null);
  assert.equal(calls.length, 2, 'must not call /api/export for an empty window');
});
