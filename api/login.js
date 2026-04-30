import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// In-memory fallback if Supabase rate_limits table is unavailable
const localAttempts = new Map();

async function checkRateLimit(ip) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  // Try persistent rate limiting via Supabase
  if (supabaseUrl && serviceKey) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      };
      const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();

      // Sweep stale entries
      await fetch(`${supabaseUrl}/rest/v1/rate_limits?window_start=lt.${cutoff}`, {
        method: 'DELETE', headers
      });

      // Check current attempts for this IP
      const getResp = await fetch(
        `${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}&select=attempts,window_start`,
        { headers }
      );
      const rows = await getResp.json();

      if (!rows.length || new Date(rows[0].window_start).getTime() < Date.now() - WINDOW_MS) {
        // New window — upsert with count 1
        await fetch(`${supabaseUrl}/rest/v1/rate_limits?on_conflict=ip`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify({ ip, attempts: 1, window_start: new Date().toISOString() })
        });
        return true;
      }

      const count = rows[0].attempts + 1;
      if (count > MAX_ATTEMPTS) return false;

      // Increment counter
      await fetch(`${supabaseUrl}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ attempts: count })
      });
      return true;
    } catch (err) {
      console.error('[login] Rate limit DB error, falling back to in-memory:', err.message);
    }
  }

  // Fallback: in-memory rate limiting (per-instance, resets on cold start)
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

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const fwd = req.headers['x-forwarded-for'];
  const clientIp = req.headers['x-real-ip'] || (fwd ? fwd.split(',')[0].trim() : null) || 'unknown';
  if (!(await checkRateLimit(clientIp))) {
    res.status(429).json({ ok: false, error: 'Demasiados intentos. Intente de nuevo en 15 minutos.' });
    return;
  }

  const { username, password } = req.body || {};

  if (!username || !password || username.length > 128 || password.length > 1024) {
    await delay(300);
    res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    return;
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    await delay(300);
    res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    return;
  }

  // Check credentials against both roles
  const accounts = [
    { user: process.env.AUTH_USERNAME, hash: process.env.AUTH_PASSWORD_HASH, role: 'admin' },
    { user: process.env.LAB_USERNAME,  hash: process.env.LAB_PASSWORD_HASH,  role: 'lab' }
  ].filter(a => a.user && a.hash);

  if (!accounts.length) {
    await delay(300);
    res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    return;
  }

  let matchedAccount = null;
  for (const acct of accounts) {
    const userMatch = crypto.timingSafeEqual(
      Buffer.from(username.toLowerCase().padEnd(64, '\0')),
      Buffer.from(acct.user.toLowerCase().padEnd(64, '\0'))
    );
    const passMatch = await bcrypt.compare(password, acct.hash);
    if (userMatch && passMatch) { matchedAccount = acct; break; }
  }
  const matchedRole = matchedAccount?.role ?? null;

  if (!matchedRole) {
    // Always check all accounts to avoid timing leaks
    await delay(300);
    res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    return;
  }

  // Create signed session token with role
  const payload = JSON.stringify({
    exp: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
    user: matchedAccount.user,
    role: matchedRole,
    nonce: crypto.randomBytes(16).toString('hex')
  });

  const payloadB64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret).update(payloadB64).digest('base64url');
  const token = `${payloadB64}.${sig}`;

  res.status(200).json({ ok: true, token });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
