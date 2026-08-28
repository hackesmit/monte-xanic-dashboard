import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { clientIp } from './_lib/rateLimit.js';
import { checkRateLimit } from './_lib/loginRateLimit.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  if (!(await checkRateLimit(clientIp(req)))) {
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

  // Compare SHA-256 digests: fixed 32-byte length means timingSafeEqual can
  // never throw on length mismatch (padEnd-based buffers blew up on >64-char
  // or multi-byte usernames), while staying constant-time.
  const digest = s => crypto.createHash('sha256').update(s).digest();
  let matchedAccount = null;
  for (const acct of accounts) {
    const userMatch = crypto.timingSafeEqual(
      digest(username.toLowerCase()),
      digest(acct.user.toLowerCase())
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
