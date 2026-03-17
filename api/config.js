import crypto from 'crypto';

export default function handler(req, res) {
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
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const [payloadB64, sig] = parts;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) {
      return res.status(401).json({ error: 'Token expired' });
    }
  } catch (_) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null
  });
}
