import { verifyToken } from './lib/verifyToken.js';
import { rateLimit } from './lib/rateLimit.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false });
  }

  if (!rateLimit(req, res)) return;

  const { token } = req.body || {};
  const result = await verifyToken(token, { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ valid: false });
  }

  res.status(200).json({ valid: true, role: result.payload.role || 'viewer' });
}
