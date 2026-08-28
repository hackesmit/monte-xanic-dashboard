import crypto from 'crypto';
import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  if (!rateLimit(req, res)) return;

  const { token } = req.body || {};
  if (!token) {
    return res.status(400).json({ ok: false });
  }

  // Verify HMAC signature before blacklisting — prevents forged token spam
  const result = await verifyToken(token, { checkBlacklist: false });
  if (result.error) {
    return res.status(result.status).json({ ok: false });
  }

  // Hash the token for storage (don't store raw tokens)
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  // The token_blacklist is the only revocation mechanism, and SUPABASE_SERVICE_KEY
  // is a required env var for /api/logout (docs/Operations.md — "All required for
  // production"); a blacklist-free deployment is a misconfiguration, not a supported
  // mode. Without it we cannot revoke the token, so report failure rather than a
  // false { ok: true } that leaves the token usable for its remaining life.
  if (!supabaseUrl || !serviceKey) {
    console.error('[logout] SUPABASE_URL or SUPABASE_SERVICE_KEY not set; cannot revoke token');
    return res.status(500).json({ ok: false, error: 'No se pudo revocar la sesión' });
  }

  {
    // fetch() does not throw on an HTTP error status, so a rejected insert would
    // otherwise report success while the token was never actually revoked. Treat
    // any non-2xx (or network error) as failure so the caller sees a real error.
    let resp;
    try {
      resp = await fetch(`${supabaseUrl}/rest/v1/token_blacklist`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ token_hash: tokenHash })
      });
    } catch (err) {
      console.error('[logout] Blacklist insert failed:', err.message);
      return res.status(502).json({ ok: false, error: 'No se pudo revocar la sesión' });
    }
    if (!resp.ok) {
      console.error('[logout] Blacklist insert rejected:', resp.status);
      return res.status(502).json({ ok: false, error: 'No se pudo revocar la sesión' });
    }
  }

  res.status(200).json({ ok: true });
}
