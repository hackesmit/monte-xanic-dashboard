import { verifyToken } from './lib/verifyToken.js';
import { rateLimit } from './lib/rateLimit.js';
import { ALLOWED_TABLES } from './upload.js';
import {
  sanitizeEvaluaciones, panelConsensus, exceedsPanelLimit, MAX_EVALUADORES,
} from '../js/quality-scale.js';
import { validateRow } from '../js/validation.js';

const ALLOWED_ACTIONS = new Set(['update', 'delete', 'upsert']);

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

  // Same rule as the upload path: the evaluator panel is sanitised and the two
  // consensus labels are derived here, never taken from the caller, so the
  // panel and the labels describing it cannot disagree about one row.
  // A present-but-not-an-array panel is a malformed request, not an
  // instruction to erase. sanitizeEvaluaciones returns null for it, and
  // writing that null would wipe the stored panel and both labels off a row
  // that was fine (lucy, 2026-08-12). An empty array is the explicit clear.
  if (exceedsPanelLimit(row.evaluaciones)) {
    return res.status(400).json({ ok: false,
      error: `Maximo ${MAX_EVALUADORES} evaluadores por medicion` });
  }
  if ('evaluaciones' in row && !Array.isArray(row.evaluaciones)) {
    return res.status(400).json({ ok: false, error: 'Evaluaciones debe ser una lista' });
  }

  if ('evaluaciones' in row) {
    row.evaluaciones = sanitizeEvaluaciones(row.evaluaciones);
    const consensus = panelConsensus(row.evaluaciones || []);
    row.health_grade      = consensus.health_grade;
    row.phenolic_maturity = consensus.phenolic_maturity;
  } else {
    // No panel, no opinion about the labels that describe one. A partial
    // update carrying only the scalars used to slip past the derivation and
    // leave them contradicting the stored panel (lucy, 2026-08-12). The edit
    // modal derives both from the panel, so it always sends all three.
    delete row.health_grade;
    delete row.phenolic_maturity;
  }

  for (const col of conflictCols) {
    if (row[col] === undefined || row[col] === null || row[col] === '') {
      return res.status(400).json({ ok: false, error: `Falta llave: ${col}` });
    }
  }

  const validation = validateRow(table, row, { action });
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
        console.error('[row] update failed:', supaRes.status, JSON.stringify(updated));
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
        console.error('[row] delete failed:', supaRes.status, JSON.stringify(body));
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

  if (action === 'upsert') {
    row.updated_at = new Date().toISOString();
    row.updated_by = result.payload.user || 'lab';
    const upsertUrl = `${supabaseUrl}/rest/v1/${table}?on_conflict=${conflictCols.join(',')}`;
    try {
      const supaRes = await fetch(upsertUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'resolution=merge-duplicates,return=representation',
        },
        body: JSON.stringify(row),
      });
      const upserted = await supaRes.json();
      if (!supaRes.ok) {
        console.error('[row] upsert failed:', supaRes.status, JSON.stringify(upserted));
        return res.status(supaRes.status).json({
          ok: false, error: upserted?.message || 'Error al guardar',
        });
      }
      const upsertedRow = Array.isArray(upserted) ? upserted[0] : upserted;
      return res.status(200).json({ ok: true, row: upsertedRow });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'Error de red al guardar' });
    }
  }

  // Should be unreachable — ALLOWED_ACTIONS guards above.
  return res.status(400).json({ ok: false, error: 'Acción no válida' });
}
