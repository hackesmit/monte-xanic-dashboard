import crypto from 'crypto';

/**
 * Verify HMAC session token: signature + expiry + blacklist check.
 * Blacklist checking is ON by default so a new endpoint cannot silently forget it;
 * only /api/logout opts out explicitly (it blacklists the token it is verifying).
 * Returns { payload } on success, { error, status } on failure: 401 for a bad,
 * expired or revoked token, 503 when the blacklist cannot be checked.
 */
export async function verifyToken(token, { checkBlacklist = true } = {}) {
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return { error: 'Unauthorized', status: 401 };

  const parts = token.split('.');
  if (parts.length !== 2) return { error: 'Invalid token', status: 401 };

  const [payloadB64, sig] = parts;

  // Verify HMAC signature
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { error: 'Invalid token', status: 401 };
  }

  // Check expiry
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) {
      return { error: 'Token expired', status: 401 };
    }
  } catch (_) {
    return { error: 'Invalid token', status: 401 };
  }

  // Blacklist check (revoked tokens). Fails CLOSED: if the query cannot answer
  // (no config, non-2xx, a body that is not a row array, a network throw) the
  // token is refused with 503, because "could not check" is not "not revoked".
  // 503 rather than 401 so callers can tell an outage from a bad token.
  if (checkBlacklist) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    const unavailable = (why) => {
      console.error('[verifyToken] Blacklist check failed, refusing token:', why);
      return { error: 'Revocation check unavailable', status: 503 };
    };
    if (!supabaseUrl || !serviceKey) return unavailable('Supabase not configured');
    let rows;
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/token_blacklist?token_hash=eq.${tokenHash}&select=token_hash`,
        { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
      );
      if (!resp.ok) return unavailable(`HTTP ${resp.status}`);
      rows = await resp.json();
    } catch (err) {
      return unavailable(err.message);
    }
    if (!Array.isArray(rows)) return unavailable('response is not a row array');
    if (rows.length > 0) return { error: 'Token revoked', status: 401 };
  }

  return { payload };
}
