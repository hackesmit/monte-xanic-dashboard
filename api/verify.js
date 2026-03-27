import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.status(405).json({ valid: false });
    return;
  }

  const { token } = req.body || {};
  const sessionSecret = process.env.SESSION_SECRET;

  if (!token || !sessionSecret) {
    res.status(400).json({ valid: false });
    return;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    res.status(400).json({ valid: false });
    return;
  }

  const [payloadB64, sig] = parts;

  // Verify HMAC signature
  const expectedSig = crypto.createHmac('sha256', sessionSecret).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    res.status(401).json({ valid: false });
    return;
  }

  // Check expiry and extract role
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) {
      res.status(401).json({ valid: false });
      return;
    }

    // Check token blacklist (revoked on logout)
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (supabaseUrl && serviceKey) {
      try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const resp = await fetch(
          `${supabaseUrl}/rest/v1/token_blacklist?token_hash=eq.${tokenHash}&select=token_hash`,
          {
            headers: {
              'apikey': serviceKey,
              'Authorization': `Bearer ${serviceKey}`
            }
          }
        );
        const rows = await resp.json();
        if (Array.isArray(rows) && rows.length > 0) {
          res.status(401).json({ valid: false });
          return;
        }
      } catch (err) {
        // Blacklist check failed — allow token (fail-open for availability)
        console.error('[verify] Blacklist check failed:', err.message);
      }
    }

    res.status(200).json({ valid: true, role: payload.role || 'viewer' });
  } catch {
    res.status(400).json({ valid: false });
    return;
  }
}
