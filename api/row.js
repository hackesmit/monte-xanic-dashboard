import { verifyToken } from './lib/verifyToken.js';
import { rateLimit } from './lib/rateLimit.js';
import { ALLOWED_TABLES } from './upload.js';
import { validateRow } from '../js/validation.js';

const ALLOWED_ACTIONS = new Set(['update', 'delete']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!rateLimit(req, res, { maxRequests: 30 })) return;

  const token = req.headers['x-session-token'];
  const result = await verifyToken(token, { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: 'No autorizado' });
  }

  const role = result.payload.role || 'viewer';
  if (role !== 'lab') {
    return res.status(403).json({ ok: false, error: 'Sin permisos para editar datos' });
  }

  const { table, action, row } = req.body || {};

  if (!table || !ALLOWED_TABLES[table]) {
    return res.status(400).json({ ok: false, error: 'Tabla no válida' });
  }
  if (!ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ ok: false, error: 'Acción no válida' });
  }
  if (!row || typeof row !== 'object') {
    return res.status(400).json({ ok: false, error: 'Sin datos para actualizar' });
  }

  const tableConfig = ALLOWED_TABLES[table];
  const conflictCols = (tableConfig.conflict || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!conflictCols.length) {
    return res.status(400).json({ ok: false, error: 'Tabla no soportada para edición' });
  }

  // Strip unknown columns (same allowlist as upload)
  if (tableConfig.columns) {
    for (const k of Object.keys(row)) {
      if (!tableConfig.columns.has(k)) delete row[k];
    }
  }
  // Server-authoritative audit fields. Strip explicitly — even if a future
  // schema adds them to the whitelist, the server is the only writer.
  delete row.last_edited_at;
  delete row.last_edited_by;

  for (const col of conflictCols) {
    if (row[col] === undefined || row[col] === null || row[col] === '') {
      return res.status(400).json({ ok: false, error: `Falta llave: ${col}` });
    }
  }

  const validation = validateRow(table, row, { action: 'update' });
  if (!validation.ok) {
    return res.status(400).json({ ok: false, error: validation.error });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  const filter = conflictCols
    .map(c => `${c}=eq.${encodeURIComponent(row[c])}`)
    .join('&');
  const url = `${supabaseUrl}/rest/v1/${table}?${filter}`;

  if (action === 'update') {
    // Server-authoritative audit stamp (overrides anything the client sent)
    row.last_edited_at = new Date().toISOString();
    row.last_edited_by = result.payload.user || 'lab';

    try {
      const supaRes = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify(row),
      });
      const updated = await supaRes.json();
      if (!supaRes.ok) {
        return res.status(supaRes.status).json({
          ok: false, error: updated?.message || 'Error al actualizar',
        });
      }
      const updatedRow = Array.isArray(updated) ? updated[0] : updated;
      if (!updatedRow) {
        return res.status(404).json({ ok: false, error: 'Fila no encontrada' });
      }
      return res.status(200).json({ ok: true, row: updatedRow });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Error de red al actualizar' });
    }
  }

  if (action === 'delete') {
    try {
      const supaRes = await fetch(url, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'return=representation',
        },
      });
      const body = await supaRes.json();
      if (!supaRes.ok) {
        return res.status(supaRes.status).json({
          ok: false, error: body?.message || 'Error al eliminar',
        });
      }
      const count = Array.isArray(body) ? body.length : 0;
      return res.status(200).json({ ok: true, deleted: count });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Error de red al eliminar' });
    }
  }

  // Should be unreachable — ALLOWED_ACTIONS guards above.
  return res.status(400).json({ ok: false, error: 'Acción no válida' });
}
