// MT.85 — rateLimit(): the bucket ignores the query string, and the client IP
// comes from the header Vercel sets (x-vercel-forwarded-for), never from a
// header the caller can forge. Audit 2026-10, xd-0lt.3.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { rateLimit, clientIp } = await import('../api/_lib/rateLimit.js');

function mockRes() {
  const res = {
    _status: null,
    status(code) { res._status = code; return res; },
    json() { return res; }
  };
  return res;
}

describe('MT.85 — rateLimit() bucket key', () => {
  it('counts requests to one route together whatever the query string', () => {
    const headers = { 'x-vercel-forwarded-for': '203.0.113.50' };
    let last = true;
    for (let i = 0; i < 4; i++) {
      last = rateLimit({ url: `/api/row?nonce=${i}`, headers }, mockRes(), { maxRequests: 3 });
    }
    assert.equal(last, false, 'the 4th request must be refused despite a new query each time');
  });
});

describe('MT.85 — clientIp()', () => {
  it('prefers x-vercel-forwarded-for over a forged x-real-ip', () => {
    const req = { headers: { 'x-vercel-forwarded-for': '203.0.113.7', 'x-real-ip': '198.51.100.1' } };
    assert.equal(clientIp(req), '203.0.113.7');
  });

  it('rotating a forged x-real-ip does not escape the limit', () => {
    let last = true;
    for (let i = 1; i <= 4; i++) {
      const req = {
        url: '/api/login',
        headers: { 'x-vercel-forwarded-for': '203.0.113.8', 'x-real-ip': `198.51.100.${i}` }
      };
      last = rateLimit(req, mockRes(), { maxRequests: 3 });
    }
    assert.equal(last, false);
  });

  it('still falls back to x-real-ip when the platform header is absent', () => {
    assert.equal(clientIp({ headers: { 'x-real-ip': '10.0.0.9' } }), '10.0.0.9');
  });
});
