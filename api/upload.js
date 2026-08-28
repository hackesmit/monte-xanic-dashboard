import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';
import { upsertRows } from './_lib/upsertRows.js';
import { ALLOWED_TABLES } from './_lib/allowedTables.js';

// The write whitelist and the validate-then-upsert core both moved to _lib so
// api/winexray-sync.js runs the identical path. Re-exported here because this
// module was their original home and callers/tests import them from it.
export { ALLOWED_TABLES };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!rateLimit(req, res, { maxRequests: 30 })) return;

  // 1. Validate auth token + blacklist
  const token = req.headers['x-session-token'];
  const result = await verifyToken(token, { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: 'No autorizado' });
  }

  // 2. Check role — only lab can upload (admin = view+export only, Round 37)
  const role = result.payload.role || 'viewer';
  if (role !== 'lab') {
    return res.status(403).json({ ok: false, error: 'Sin permisos para subir datos' });
  }

  // 3-5. Body validation, column whitelist, upsert-key integrity and the write.
  const { table, rows } = req.body || {};
  const { status, body } = await upsertRows({ table, rows });
  return res.status(status).json(body);
}
