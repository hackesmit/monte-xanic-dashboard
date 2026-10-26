// Persistent per-IP rate limiting for /api/login, with an in-memory fallback.
//
// Extracted from api/login.js so it can be unit-tested without pulling in
// bcryptjs (the test suite runs with no node_modules). fetch() does not throw
// on an HTTP error status, so every Supabase call here checks resp.ok and, on a
// non-2xx or network error, falls through to the in-memory limiter instead of
// mistaking an error body for "no rows" and allowing unconditionally.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// In-memory fallback if the atomic Supabase call is unavailable
// (per-instance, resets on cold start).
const localAttempts = new Map();

export async function checkRateLimit(ip) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  // Persistent rate limiting: one atomic Postgres call
  // (sql/migration_login_rate_limit_atomic.sql) creates or increments this
  // IP's row under its row lock and says whether the attempt is allowed. No
  // read-modify-write here: overlapping attempts used to all read the same
  // count and all pass (bead xd-tqx). Its answer, allow or deny, is final;
  // only a failed call falls through to the in-memory limiter below.
  if (supabaseUrl && serviceKey) {
    try {
      const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/login_rate_limit_hit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ p_ip: ip, p_window_seconds: WINDOW_MS / 1000, p_max: MAX_ATTEMPTS })
      });
      if (!resp.ok) throw new Error(`login_rate_limit_hit ${resp.status}`);
      const allowed = await resp.json();
      if (typeof allowed !== 'boolean') throw new Error('login_rate_limit_hit: unexpected body');
      return allowed;
    } catch (err) {
      console.error('[login] Rate limit DB error, falling back to in-memory:', err.message);
    }
  }

  // Fallback: in-memory rate limiting (per-instance, resets on cold start).
  const now = Date.now();
  for (const [key, rec] of localAttempts) {
    if (now - rec.start > WINDOW_MS) localAttempts.delete(key);
  }
  const record = localAttempts.get(ip);
  if (!record || now - record.start > WINDOW_MS) {
    localAttempts.set(ip, { start: now, count: 1 });
    return true;
  }
  record.count++;
  return record.count <= MAX_ATTEMPTS;
}
