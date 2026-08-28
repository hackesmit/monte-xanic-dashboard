// Persistent per-IP rate limiting for /api/login, with an in-memory fallback.
//
// Extracted from api/login.js so it can be unit-tested without pulling in
// bcryptjs (the test suite runs with no node_modules). fetch() does not throw
// on an HTTP error status, so every Supabase call here checks resp.ok and, on a
// non-2xx or network error, falls through to the in-memory limiter instead of
// mistaking an error body for "no rows" and allowing unconditionally.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// In-memory fallback if the Supabase rate_limits table is unavailable
// (per-instance, resets on cold start).
const localAttempts = new Map();

export async function checkRateLimit(ip) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  // Try persistent rate limiting via Supabase.
  if (supabaseUrl && serviceKey) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      };
      const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();

      // Sweep stale entries. Best-effort housekeeping: a failure here must not
      // abandon the working persistent limiter and drop to the per-instance
      // in-memory map (trivially reset by Vercel cold starts / multiple
      // instances). Log and carry on — only a failed read or increment of the
      // current IP below falls back.
      try {
        const delResp = await fetch(`${supabaseUrl}/rest/v1/rate_limits?window_start=lt.${cutoff}`, {
          method: 'DELETE', headers
        });
        if (!delResp.ok) {
          console.error(`[login] Rate limit stale-entry sweep failed (${delResp.status}); continuing`);
        }
      } catch (err) {
        console.error('[login] Rate limit stale-entry sweep error; continuing:', err.message);
      }

      // Check current attempts for this IP.
      const getResp = await fetch(
        `${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}&select=attempts,window_start`,
        { headers }
      );
      if (!getResp.ok) throw new Error(`rate_limits get ${getResp.status}`);
      const rows = await getResp.json();
      if (!Array.isArray(rows)) throw new Error('rate_limits get: unexpected body');

      if (!rows.length || new Date(rows[0].window_start).getTime() < Date.now() - WINDOW_MS) {
        // New window — upsert with count 1.
        const upResp = await fetch(`${supabaseUrl}/rest/v1/rate_limits?on_conflict=ip`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ ip, attempts: 1, window_start: new Date().toISOString() })
        });
        if (!upResp.ok) throw new Error(`rate_limits upsert ${upResp.status}`);
        return true;
      }

      const count = rows[0].attempts + 1;
      if (count > MAX_ATTEMPTS) return false;

      // Increment counter.
      const patchResp = await fetch(`${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ attempts: count })
      });
      if (!patchResp.ok) throw new Error(`rate_limits patch ${patchResp.status}`);
      return true;
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
