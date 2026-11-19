import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';
import { ALLOWED_TABLES } from './upload.js';
import { sanitizeEvaluaciones, panelConsensus, panelRejectionReason } from '../js/quality-scale.js';
import { validateRow } from '../js/validation.js';
import {
  supabaseFetch, isIndeterminateStatus, indeterminado, INDETERMINADO_STATUS,
} from './_lib/supabaseFetch.js';

const ALLOWED_ACTIONS = new Set(['update', 'delete', 'upsert']);

const SIN_CONFIRMAR = {
  update: 'No se pudo confirmar si el cambio se guardó. Recargue los datos y revise la fila antes de repetirlo.',
  delete: 'No se pudo confirmar si la fila se eliminó. Recargue los datos y revise antes de repetirlo.',
  upsert: 'No se pudo confirmar si el cambio se guardó. Recargue los datos y revise antes de repetirlo.',
};

// One write to PostgREST, sorted into the three outcomes (xd-11a; see
// api/_lib/supabaseFetch.js). A timeout or a reset with no status, a gateway
// 502/504, or a 2xx whose body never finishes is INDETERMINATE: the write may
// have committed, so it is never answered as a failure. Any other status is
// definite. Returns { kind: 'ok', body } | { kind: 'rechazo', status, body }
// | { kind: 'indeterminado', motivo }.
async function escribir(url, init) {
  let supaRes;
  try {
    supaRes = await supabaseFetch(url, init);
  } catch (e) {
    return { kind: 'indeterminado', motivo: (e && e.name) || String(e) };
  }
  if (isIndeterminateStatus(supaRes.status)) {
    return { kind: 'indeterminado', motivo: `HTTP ${supaRes.status}` };
  }
  let body = null;
  try {
    body = await supaRes.json();
  } catch (e) {
    // The status already arrived. A 2xx committed and only its body is lost;
    // that is not a confirmed result we can show (which row, how many), so it
    // is indeterminate, never a failure. A rejection stays a rejection.
    if (supaRes.ok) return { kind: 'indeterminado', motivo: `HTTP ${supaRes.status}, cuerpo ilegible` };
    return { kind: 'rechazo', status: supaRes.status, body: null };
  }
  if (!supaRes.ok) return { kind: 'rechazo', status: supaRes.status, body };
  return { kind: 'ok', body };
}

function responderIndeterminado(res, action, motivo) {
  console.error(`[row] ${action} sin confirmar:`, motivo);
  return res.status(INDETERMINADO_STATUS).json(indeterminado(SIN_CONFIRMAR[action]));
}

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
  // Server-authoritative audit fields. Strip explicitly - even if a future
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
  const panelError = panelRejectionReason(row.evaluaciones);
  if (panelError) return res.status(400).json({ ok: false, error: panelError });

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

    const r = await escribir(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(row),
    });
    if (r.kind === 'indeterminado') return responderIndeterminado(res, action, r.motivo);
    if (r.kind === 'rechazo') {
      console.error('[row] update failed:', r.status, JSON.stringify(r.body));
      return res.status(r.status).json({
        ok: false, error: r.body?.message || 'Error al actualizar',
      });
    }
    const updatedRow = Array.isArray(r.body) ? r.body[0] : r.body;
    if (!updatedRow) {
      return res.status(404).json({ ok: false, error: 'Fila no encontrada' });
    }
    return res.status(200).json({ ok: true, row: updatedRow });
  }

  if (action === 'delete') {
    const r = await escribir(url, {
      method: 'DELETE',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=representation',
      },
    });
    if (r.kind === 'indeterminado') return responderIndeterminado(res, action, r.motivo);
    if (r.kind === 'rechazo') {
      console.error('[row] delete failed:', r.status, JSON.stringify(r.body));
      return res.status(r.status).json({
        ok: false, error: r.body?.message || 'Error al eliminar',
      });
    }
    const count = Array.isArray(r.body) ? r.body.length : 0;
    return res.status(200).json({ ok: true, deleted: count });
  }

  if (action === 'upsert') {
    row.updated_at = new Date().toISOString();
    row.updated_by = result.payload.user || 'lab';
    const upsertUrl = `${supabaseUrl}/rest/v1/${table}?on_conflict=${conflictCols.join(',')}`;
    const r = await escribir(upsertUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(row),
    });
    if (r.kind === 'indeterminado') return responderIndeterminado(res, action, r.motivo);
    if (r.kind === 'rechazo') {
      console.error('[row] upsert failed:', r.status, JSON.stringify(r.body));
      return res.status(r.status).json({
        ok: false, error: r.body?.message || 'Error al guardar',
      });
    }
    const upsertedRow = Array.isArray(r.body) ? r.body[0] : r.body;
    return res.status(200).json({ ok: true, row: upsertedRow });
  }

  // Should be unreachable - ALLOWED_ACTIONS guards above.
  return res.status(400).json({ ok: false, error: 'Acción no válida' });
}
