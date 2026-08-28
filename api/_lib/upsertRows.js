// api/_lib/upsertRows.js
// Shared table-write core: column whitelist, required fields, upsert-key
// integrity, then the Supabase service-key upsert.
//
// Extracted verbatim from api/upload.js so the manual upload path and the
// WineXRay sync path (api/winexray-sync.js) run the SAME validation and the
// SAME on-conflict write. The bead's DoD requires the existing upsert code be
// reused rather than reimplemented, and a second copy of these guards is
// exactly the drift that would let one path lose the key-integrity check.
//
// Returns { status, body } instead of writing to a response, so both an HTTP
// handler and an unattended job can call it. Callers own auth, rate limiting
// and role checks — this module assumes the caller is already authorized.
import { sanitizeEvaluaciones, panelConsensus, panelRejectionReason } from '../../js/quality-scale.js';
import { ALLOWED_TABLES } from './allowedTables.js';

const reply = (status, body) => ({ status, body });

const UPSERT_TIMEOUT_MS = 20000;

export { ALLOWED_TABLES };

/**
 * Validate and upsert `rows` into `table`.
 * @returns {Promise<{status:number, body:object}>}
 */
export async function upsertRows({ table, rows }) {

  if (!table || !ALLOWED_TABLES[table]) {
    return reply(400, { ok: false, error: 'Tabla no válida' });
  }

  if (!Array.isArray(rows) || !rows.length) {
    return reply(400, { ok: false, error: 'Sin datos para insertar' });
  }

  const tableConfig = ALLOWED_TABLES[table];
  if (rows.length > tableConfig.maxRows) {
    return reply(400, { ok: false, error: `Máximo ${tableConfig.maxRows} filas por solicitud` });
  }

  // 4. Strip unknown columns and validate required fields
  // A null or array entry would make Object.keys throw and turn malformed
  // client input into a 500. Both callers share this core, so the guard has to
  // live here rather than in either handler.
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      return reply(400, { ok: false, error: `Fila ${i + 1}: formato inválido` });
    }
  }

  const { columns, required } = tableConfig;
  if (columns) {
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!columns.has(key)) delete row[key];
      }
      // A present-but-not-an-array panel is a malformed request, not an
      // instruction to erase: writing sanitizeEvaluaciones' null would wipe a
      // stored panel and both labels off a row that was fine.
      //
      // The evaluator panel is the only JSONB column this path writes, so it
      // is the only place a caller could put arbitrary structure into the
      // database. Reduce it to the shape the scoring engine expects, then
      // derive the two consensus labels here rather than trusting whatever
      // the caller sent for them. Client-side JavaScript is editable, and the
      // cap below is applied after sanitising, so a caller who computed a
      // consensus over more rows than survive would otherwise leave the panel
      // and its labels disagreeing about the same row (lucy, 2026-08-12).
      const panelError = panelRejectionReason(row.evaluaciones);
      if (panelError) return reply(400, { ok: false, error: panelError });
      if ('evaluaciones' in row) {
        row.evaluaciones = sanitizeEvaluaciones(row.evaluaciones);
        const consensus = panelConsensus(row.evaluaciones || []);
        row.health_grade      = consensus.health_grade;
        row.phenolic_maturity = consensus.phenolic_maturity;
      } else {
        // No panel, no opinion about the labels that describe one. Deriving
        // only when the panel is present left the invariant escapable by
        // simply omitting it: a payload carrying flattering labels and no
        // panel used to pass straight through and disagree with the stored
        // panel and the score (lucy, 2026-08-12). Both writers always send
        // the panel alongside, so nothing legitimate is dropped here.
        delete row.health_grade;
        delete row.phenolic_maturity;
      }
    }
  }
  if (required && required.length) {
    for (let i = 0; i < rows.length; i++) {
      for (const field of required) {
        if (rows[i][field] === undefined || rows[i][field] === null || rows[i][field] === '') {
          return reply(400, {
            ok: false,
            error: `Fila ${i + 1}: campo requerido '${field}' falta o está vacío`
          });
        }
      }
    }
  }

  // 4b. Upsert-key integrity. PostgREST resolves `on_conflict` against the
  // table's unique constraint, but Postgres treats NULL as distinct: a NULL in
  // any key column makes the constraint a no-op, so the row is INSERTed fresh on
  // every retry instead of merged. A sync button's double-clicks, timeout
  // retries, and overlapping runs would each leave a duplicate. Reject a row
  // whose natural key is not fully present — the same guard /api/row already
  // applies to its edit path. Columns with a deterministic non-null DB default
  // (keyDefault, e.g. sample_seq) may be omitted: the default still lets the
  // conflict arbiter match across retries.
  const keyCols = (tableConfig.conflict || '').split(',').map(s => s.trim()).filter(Boolean);
  if (keyCols.length) {
    const keyDefault = tableConfig.keyDefault;
    for (let i = 0; i < rows.length; i++) {
      for (const col of keyCols) {
        const present = col in rows[i];
        const empty = rows[i][col] === null || rows[i][col] === '';
        if (keyDefault && keyDefault.has(col)) {
          // Absent is fine (DB fills the default); an explicit null/'' is not —
          // it would either duplicate or fail the NOT NULL column for the whole
          // batch. Reject early with a clear per-row message.
          if (present && empty) {
            return reply(400, { ok: false,
              error: `Fila ${i + 1}: llave '${col}' no puede ser vacía` });
          }
          continue;
        }
        if (!present || rows[i][col] === undefined || empty) {
          return reply(400, { ok: false,
            error: `Fila ${i + 1}: llave de conflicto '${col}' falta o está vacía` });
        }
      }
    }
  }

  // 5. Insert via Supabase service key (server-side only)
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return reply(500, { ok: false, error: 'Configuración de base de datos incompleta' });
  }

  try {
    const conflictCol = tableConfig.conflict;
    // `missing=default` is what actually makes the keyDefault allowance above
    // true. PostgREST builds one INSERT for the whole batch from the UNION of
    // the keys present across rows, and without this preference a column that
    // some rows carry and others omit is sent as NULL for the omitting rows.
    // For sample_seq that means either failing its NOT NULL for the entire
    // batch, or writing a NULL that makes the composite unique constraint a
    // no-op and reintroduces duplicate-on-retry. Asking for the column default
    // instead is the documented fix, and it only affects absent keys.
    const prefer = [];
    if (conflictCol) {
      prefer.push('resolution=merge-duplicates');
      if (tableConfig.keyDefault && tableConfig.keyDefault.size) prefer.push('missing=default');
    } else {
      prefer.push('return=minimal');
    }
    const headers = {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': prefer.join(',')
    };

    // Supabase REST API upsert
    let url = `${supabaseUrl}/rest/v1/${table}`;
    if (conflictCol) {
      url += `?on_conflict=${encodeURIComponent(conflictCol)}`;
    }

    // A stalled Supabase leaves the serverless invocation hanging until the
    // platform kills it, with no Spanish error for the caller. The timer stays
    // armed through the error-body read for the same reason.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), UPSERT_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(rows),
        signal: ac.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`[upload] Supabase error for ${table}:`, errText);
        // Parse Supabase error for user-facing detail
        let detail = 'Error al insertar datos';
        try {
          const errObj = JSON.parse(errText);
          if (errObj.message) detail += ': ' + errObj.message;
        } catch (_) { /* ignore parse error */ }
        // Schema-cache errors → translate the opaque PostgREST message into
        // an actionable hint pointing at the missing migration (Round 36).
        if (/schema cache|column .+ does not exist/i.test(errText)) {
          detail += ' — la migración correspondiente parece no estar aplicada. ' +
            'Revisa /api/migrations-status o ejecuta los archivos pendientes en sql/.';
        }
        return reply(500, { ok: false, error: detail });
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return reply(504, { ok: false, error: 'La base de datos no respondió a tiempo.' });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    return reply(200, { ok: true, count: rows.length });
  } catch (err) {
    console.error('[upload] Server error:', err);
    return reply(500, { ok: false, error: 'Error interno del servidor' });
  }
}
