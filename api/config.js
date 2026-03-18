import crypto from 'crypto';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['x-session-token'];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const [payloadB64, sig] = parts;

  // Verify HMAC signature BEFORE trusting payload
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  // Signature valid — now check expiry
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) {
      return res.status(401).json({ error: 'Token expired' });
    }
  } catch (_) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
  });
}
