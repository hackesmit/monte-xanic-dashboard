import { verifyToken } from './lib/verifyToken.js';
import { rateLimit } from './lib/rateLimit.js';
import { MIGRATIONS } from '../js/migrations-manifest.js';

// GET /api/migrations-status
//
// Returns the diff between the deployed code's expected migrations
// (js/migrations-manifest.js) and what's actually been applied on the live
// Supabase DB (public.applied_migrations). Used by the dashboard to warn
// lab/admin users when code references schema that hasn't been migrated —
// the recurring failure mode behind Round 35's "Could not find the 'ag'
// column of 'mediciones_tecnicas' in the schema cache".
//
// Response shape:
//   {
//     ok: true,
//     expected: ['migration_overhaul', ...],
//     applied:  ['migration_overhaul', ...],
//     missing:  ['migration_unify_mediciones'],
//     bootstrapped: true,    // false → applied_migrations table doesn't exist
//   }
//
// On a fresh DB without the bootstrap migration run yet, `bootstrapped` is
// false and the frontend shows a different banner pointing at
// migration_applied_log.sql.

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!rateLimit(req, res, { maxRequests: 60 })) return;

  const token = req.headers['x-session-token'];
  const result = await verifyToken(token, { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: 'No autorizado' });
  }

  const role = result.payload.role || 'viewer';
  if (role !== 'lab' && role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Sin permisos' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  try {
    const url = `${supabaseUrl}/rest/v1/applied_migrations?select=name`;
    const resp = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });

    if (resp.status === 404 || resp.status === 400) {
      // Table doesn't exist — bootstrap migration not yet run.
      const errText = await resp.text();
      if (/applied_migrations/.test(errText) || resp.status === 404) {
        return res.status(200).json({
          ok: true,
          expected: MIGRATIONS,
          applied: [],
          missing: MIGRATIONS,
          bootstrapped: false,
        });
      }
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[migrations-status] Supabase error:', errText);
      return res.status(500).json({ ok: false, error: 'No se pudo consultar applied_migrations' });
    }

    const rows = await resp.json();
    const applied = rows.map(r => r.name);
    const appliedSet = new Set(applied);
    const missing = MIGRATIONS.filter(m => !appliedSet.has(m));

    return res.status(200).json({
      ok: true,
      expected: MIGRATIONS,
      applied,
      missing,
      bootstrapped: true,
    });
  } catch (err) {
    console.error('[migrations-status] Server error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}
