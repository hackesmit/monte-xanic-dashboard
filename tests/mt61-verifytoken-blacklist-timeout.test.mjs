// MT.61 — the token_blacklist query has a deadline (xd-5ua round 2)
// MT.60 covers every answer the blacklist can give. This covers the one it can
// fail to give: Supabase accepts the connection and then stalls, either before
// the headers or halfway through the body. Without a deadline verifyToken waits
// forever and /api/verify never sends the 503 the fail-closed rule promises.
// The tests stand up a real local HTTP server and drive the real fetch, so the
// abort has to reach the socket and the pending body read, not a stub.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import http from 'http';

const TEST_SECRET = 'test-session-secret-for-unit-tests';
process.env.SESSION_SECRET = TEST_SECRET;
process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

const { verifyToken } = await import('../api/_lib/verifyToken.js');
const { default: verifyHandler } = await import('../api/verify.js');

function createToken(payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

const liveToken = () => createToken({ user: 'admin', role: 'admin', exp: Date.now() + 60000 });

let ipSeq = 0;
function makeReq(token) {
  // A fresh IP per request keeps the in-memory rate limiter out of the way.
  return { method: 'POST', url: '/api/verify', headers: { 'x-real-ip': `10.61.0.${++ipSeq}` }, body: { token } };
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

// Fails the test instead of hanging the runner if the deadline does not fire.
function withinMs(promise, ms) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function callVerify(token) {
  const res = makeRes();
  await withinMs(verifyHandler(makeReq(token), res), 3000);
  return res;
}

// mode decides how the fake Supabase answers the next blacklist query.
let mode = 'empty';
let delayMs = 0;
const server = http.createServer((req, res) => {
  if (mode === 'hang') return; // connection accepted, nothing ever sent
  if (mode === 'stall-body') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('['); // headers and one byte of body, then silence
    return;
  }
  const body = mode === 'revoked' ? '[{"token_hash":"x"}]' : '[]';
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
  }, delayMs);
});

describe('MT.61 — verifyToken() blacklist query times out to 503', () => {
  let originalError, logged;

  before(async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  beforeEach(() => {
    mode = 'empty';
    delayMs = 0;
    process.env.TOKEN_BLACKLIST_TIMEOUT_MS = '200';
    originalError = console.error;
    logged = [];
    console.error = (...args) => { logged.push(args.join(' ')); };
  });

  afterEach(() => {
    console.error = originalError;
    delete process.env.TOKEN_BLACKLIST_TIMEOUT_MS;
    server.closeAllConnections();
  });

  it('/api/verify answers 503 when Supabase accepts the connection and never responds', async () => {
    mode = 'hang';
    const started = Date.now();
    const res = await callVerify(liveToken());
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { valid: false });
    assert.ok(Date.now() - started >= 150, 'should wait for the deadline, not fail early');
    assert.equal(logged.length, 1);
    assert.match(logged[0], /no answer within 200 ms/);
  });

  it('/api/verify answers 503 when Supabase sends headers and then stalls the body', async () => {
    mode = 'stall-body';
    const res = await callVerify(liveToken());
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { valid: false });
    assert.match(logged[0], /no answer within 200 ms/);
  });

  it('the helper returns the same 503 shape as every other fail-closed path', async () => {
    mode = 'stall-body';
    const result = await withinMs(verifyToken(liveToken()), 3000);
    assert.equal(result.payload, undefined);
    assert.equal(result.status, 503);
    assert.equal(result.error, 'Revocation check unavailable');
  });

  it('the deadline is configurable: a slow answer inside a longer timeout still validates', async () => {
    mode = 'empty';
    delayMs = 400;
    process.env.TOKEN_BLACKLIST_TIMEOUT_MS = '200';
    assert.equal((await callVerify(liveToken())).statusCode, 503);
    process.env.TOKEN_BLACKLIST_TIMEOUT_MS = '2000';
    const res = await callVerify(liveToken());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { valid: true, role: 'admin' });
  });

  it('a nonsense timeout setting falls back to the default instead of disabling the deadline', async () => {
    mode = 'empty';
    delayMs = 400;
    for (const bad of ['0', '-5', 'abc', '']) {
      process.env.TOKEN_BLACKLIST_TIMEOUT_MS = bad;
      const res = await callVerify(liveToken());
      assert.equal(res.statusCode, 200, `TOKEN_BLACKLIST_TIMEOUT_MS=${JSON.stringify(bad)}`);
    }
  });

  it('a prompt answer is unaffected: no rows validates, a row revokes with 401', async () => {
    mode = 'empty';
    assert.equal((await callVerify(liveToken())).statusCode, 200);
    mode = 'revoked';
    const res = await callVerify(liveToken());
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { valid: false });
  });
});
