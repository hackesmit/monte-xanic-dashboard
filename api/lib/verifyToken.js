import crypto from 'crypto';

/**
 * Verify HMAC session token: signature + expiry + optional blacklist check.
 * Returns { payload } on success, { error, status } on failure.
 */
export async function verifyToken(token, { checkBlacklist = false } = {}) {
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

  // Blacklist check (revoked tokens)
  if (checkBlacklist) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (supabaseUrl && serviceKey) {
      try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const resp = await fetch(
          `${supabaseUrl}/rest/v1/token_blacklist?token_hash=eq.${tokenHash}&select=token_hash`,
          { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
        );
        const rows = await resp.json();
        if (Array.isArray(rows) && rows.length > 0) {
          return { error: 'Token revoked', status: 401 };
        }
      } catch (err) {
        // Fail-open for availability
        console.error('[verifyToken] Blacklist check failed:', err.message);
      }
    }
  }

  return { payload };
}
