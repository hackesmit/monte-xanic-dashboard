import crypto from 'crypto';

export default function handler(req, res) {
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
    res.status(200).json({ valid: true, role: payload.role || 'viewer' });
  } catch {
    res.status(400).json({ valid: false });
    return;
  }
}
