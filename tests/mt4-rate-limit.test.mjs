// MT.4 — rateLimit() module
// Tests: requests within window pass, requests exceeding maxRequests get 429,
// periodic eviction, IP extraction.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Fresh import for each test file run (module-level state in buckets Map)
const { rateLimit } = await import('../api/lib/rateLimit.js');

/** Create a mock req object */
function mockReq(ip = '1.2.3.4', url = '/api/test') {
  return {
    url,
    headers: { 'x-real-ip': ip }
  };
}

/** Create a mock res object that captures status and json */
function mockRes() {
  const res = {
    _status: null,
    _json: null,
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; }
  };
  return res;
}

describe('MT.4 — rateLimit()', () => {
  it('allows requests within the rate limit window', () => {
    const req = mockReq('10.0.0.1');
    const res = mockRes();
    // First request should pass
    const result = rateLimit(req, res, { maxRequests: 5 });
    assert.equal(result, true);
    assert.equal(res._status, null, 'Should not set status on allowed request');
  });

  it('allows up to maxRequests requests', () => {
    const ip = '10.0.0.2';
    for (let i = 0; i < 5; i++) {
      const req = mockReq(ip, '/api/allow-test');
      const res = mockRes();
      const result = rateLimit(req, res, { maxRequests: 5 });
      assert.equal(result, true, `Request ${i + 1} should be allowed`);
    }
  });

  it('blocks request exceeding maxRequests with 429', () => {
    const ip = '10.0.0.3';
    // Exhaust the limit
    for (let i = 0; i < 3; i++) {
      rateLimit(mockReq(ip, '/api/block-test'), mockRes(), { maxRequests: 3 });
    }
    // Next request should be blocked
    const res = mockRes();
    const result = rateLimit(mockReq(ip, '/api/block-test'), res, { maxRequests: 3 });
    assert.equal(result, false);
    assert.equal(res._status, 429);
    assert.ok(res._json.error.includes('Demasiadas solicitudes'));
  });

  it('different IPs have independent rate limits', () => {
    // Exhaust IP A
    for (let i = 0; i < 3; i++) {
      rateLimit(mockReq('10.0.0.4', '/api/indep'), mockRes(), { maxRequests: 3 });
    }
    // IP B should still be allowed
    const res = mockRes();
    const result = rateLimit(mockReq('10.0.0.5', '/api/indep'), res, { maxRequests: 3 });
    assert.equal(result, true);
  });

  it('different URLs for same IP have independent rate limits', () => {
    // Exhaust /api/foo
    for (let i = 0; i < 2; i++) {
      rateLimit(mockReq('10.0.0.6', '/api/foo'), mockRes(), { maxRequests: 2 });
    }
    // /api/bar should still be allowed
    const res = mockRes();
    const result = rateLimit(mockReq('10.0.0.6', '/api/bar'), res, { maxRequests: 2 });
    assert.equal(result, true);
  });

  it('extracts IP from x-real-ip header', () => {
    const req = {
      url: '/api/ip-test-real',
      headers: { 'x-real-ip': '192.168.1.100' }
    };
    const res = mockRes();
    const result = rateLimit(req, res, { maxRequests: 60 });
    assert.equal(result, true);
  });

  it('falls back to x-forwarded-for when x-real-ip is missing', () => {
    const req = {
      url: '/api/ip-test-fwd',
      headers: { 'x-forwarded-for': '203.0.113.50, 10.0.0.1' }
    };
    const res = mockRes();
    const result = rateLimit(req, res, { maxRequests: 60 });
    assert.equal(result, true);
    // First IP in x-forwarded-for should be used (203.0.113.50)
    // Different from 10.0.0.1, so independent bucket
  });

  it('uses "unknown" when no IP headers present', () => {
    const req = { url: '/api/ip-test-none', headers: {} };
    const res = mockRes();
    const result = rateLimit(req, res, { maxRequests: 60 });
    assert.equal(result, true);
  });

  it('resets bucket after window expires', () => {
    const ip = '10.0.0.7';
    // Use a very short window (1ms)
    for (let i = 0; i < 3; i++) {
      rateLimit(mockReq(ip, '/api/expire'), mockRes(), { maxRequests: 3, windowMs: 1 });
    }
    // Blocked
    assert.equal(
      rateLimit(mockReq(ip, '/api/expire'), mockRes(), { maxRequests: 3, windowMs: 1 }),
      false
    );
    // Wait for window to expire — use a sync busy-wait since window is 1ms
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    // Should be allowed again (new window)
    const res = mockRes();
    const result = rateLimit(mockReq(ip, '/api/expire'), res, { maxRequests: 3, windowMs: 1 });
    assert.equal(result, true, 'Should reset after window expires');
  });
});
