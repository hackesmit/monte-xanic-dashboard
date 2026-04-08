import crypto from 'crypto';
import { verifyToken } from './lib/verifyToken.js';
import { rateLimit } from './lib/rateLimit.js';

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

  if (supabaseUrl && serviceKey) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/token_blacklist`, {
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
    }
  }

  res.status(200).json({ ok: true });
}
