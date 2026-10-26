// Housekeeping for token_blacklist: delete revocations whose token has expired.
// A revoked token is refused by its own expiry once it is past api/login.js's
// 2 h life, so its row protects nothing. The window adds 1 h because the cutoff
// is computed on this host while invalidated_at is stamped by Postgres; skew
// between the two clocks must never drop a row early (tests/mt74 pins this
// against login.js).
export const BLACKLIST_RETENTION_MS = 3 * 60 * 60 * 1000;

// The sweep runs inside /api/logout after the revoke, so it gets a short
// deadline: a slow database delays logout by at most this, never more.
export const SWEEP_TIMEOUT_MS = 1500;

/**
 * Delete token_blacklist rows older than BLACKLIST_RETENTION_MS.
 * Never throws: returns true when the delete was accepted, false otherwise
 * (non-2xx, network error, timeout). Callers must not let the result change
 * any auth decision.
 */
export async function sweepExpiredRevocations(supabaseUrl, serviceKey, {
  fetchImpl = fetch, timeoutMs = SWEEP_TIMEOUT_MS, now = Date.now(), log = console.error,
} = {}) {
  const cutoff = new Date(now - BLACKLIST_RETENTION_MS).toISOString();
  try {
    const resp = await fetchImpl(
      `${supabaseUrl}/rest/v1/token_blacklist?invalidated_at=lt.${cutoff}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=minimal'
        },
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (!resp.ok) {
      log('[blacklistSweep] Sweep rejected:', resp.status);
      return false;
    }
    return true;
  } catch (err) {
    log('[blacklistSweep] Sweep failed:', err.message);
    return false;
  }
}
