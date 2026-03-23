import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function checkRateLimit(ip) {
  const now = Date.now();
  // Sweep stale entries to prevent unbounded growth
  for (const [key, rec] of attempts) {
    if (now - rec.start > WINDOW_MS) attempts.delete(key);
  }
  const record = attempts.get(ip);
  if (!record || now - record.start > WINDOW_MS) {
    attempts.set(ip, { start: now, count: 1 });
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
  if (!checkRateLimit(clientIp)) {
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

  let matchedRole = null;
  for (const acct of accounts) {
    const userMatch = crypto.timingSafeEqual(
      Buffer.from(username.toLowerCase().padEnd(64, '\0')),
      Buffer.from(acct.user.toLowerCase().padEnd(64, '\0'))
    );
    const passMatch = await bcrypt.compare(password, acct.hash);
    if (userMatch && passMatch) { matchedRole = acct.role; break; }
  }

  if (!matchedRole) {
    // Always check all accounts to avoid timing leaks
    await delay(300);
    res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    return;
  }

  // Create signed session token with role
  const payload = JSON.stringify({
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
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
