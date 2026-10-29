// api/datos.js - session-checked reads of the confidential lab tables.
//
// wine_samples, tank_receptions, reception_lots, prefermentativos,
// berry_samples, mediciones_tecnicas and harvest_target_overrides used to be
// read straight from PostgREST with the anon key that /api/config hands a
// session. That key cannot be revoked by logout, the blacklist, a password
// change or a SESSION_SECRET rotation, so a session held once read these tables
// for good (security audit 2026-10, bead xd-0lt.1). The anon SELECT on them is
// dropped by sql/migration_lectura_por_sesion.sql, and every read comes through
// here instead: the session is checked against the blacklist on EVERY request
// and the table is read with the service key (the mona_* and tanques pattern).
//
// Two reads, both available to any valid session (the same audience the anon
// key had):
//   GET  ?tabla=<t>&desde=<n>   one page of up to PAGINA rows, ordered by the
//                               table's fixed column (the client loops pages).
//   POST { tabla, claves }      the upload preview's existence probe: the
//                               conflict-key columns of the rows whose first
//                               conflict column is one of `claves`.
//
// Nothing here writes. The order column and the probe columns are fixed per
// table on the server, so a client chooses neither a column nor a filter.
import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';
import { ALLOWED_TABLES } from './_lib/allowedTables.js';

// The tables this route serves and the column each is paged in. The orders are
// the ones js/dataLoader.js used against PostgREST before, unchanged.
export const LECTURA = {
  wine_samples:             'sample_date',
  prefermentativos:         'measurement_date',
  tank_receptions:          'reception_date',
  reception_lots:           'reception_id',
  mediciones_tecnicas:      'medicion_date',
  harvest_target_overrides: 'id',
  berry_samples:            'sample_date',
};

const PAGINA = 1000;       // PostgREST caps a response at 1000 rows
const MAX_CLAVES = 1000;   // the largest upload batch (berry_samples maxRows)
const LOTE_CLAVES = 200;   // keys per PostgREST request in the probe
// One dashboard load is a dozen pages; uploads reload too. The default 60 per
// window would cut a busy lab off its own data.
const LIMITE = { maxRequests: 600 };

const enc = encodeURIComponent;

// PostgREST in.(...) list: every value double-quoted, so a comma or a
// parenthesis inside a sample id cannot split or close the list.
const lista = (vals) => `(${vals.map(v => `"${String(v).replace(/["\\]/g, '\\$&')}"`).join(',')})`;

async function sb(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = undefined; }
  // fetch() does not throw on an HTTP error status: without this a failed read
  // would reach the client as an empty table.
  if (!res.ok || !Array.isArray(json)) {
    throw new Error(`Supabase ${res.status}`);
  }
  return json;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const result = await verifyToken(req.headers['x-session-token'], { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: 'No autorizado' });
  }

  if (!rateLimit(req, res, LIMITE)) return;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: 'Base de datos no configurada' });
  }

  try {
    if (req.method === 'GET') {
      // Parsed from the url rather than req.query, which only Vercel's helpers add.
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const tabla = q.get('tabla') ?? '';
      if (!Object.hasOwn(LECTURA, tabla)) {
        return res.status(400).json({ ok: false, error: 'Tabla no permitida' });
      }
      const desde = Number(q.get('desde') ?? 0);
      if (!Number.isSafeInteger(desde) || desde < 0) {
        return res.status(400).json({ ok: false, error: 'Parámetro desde inválido' });
      }
      const filas = await sb(`${tabla}?select=*&order=${LECTURA[tabla]}.asc&limit=${PAGINA}&offset=${desde}`);
      return res.status(200).json({ ok: true, filas });
    }

    const { tabla, claves } = req.body || {};
    if (!Object.hasOwn(LECTURA, tabla) || !ALLOWED_TABLES[tabla]?.conflict) {
      return res.status(400).json({ ok: false, error: 'Tabla no permitida' });
    }
    if (!Array.isArray(claves) || claves.length === 0 || claves.length > MAX_CLAVES
        || !claves.every(c => typeof c === 'string' || (typeof c === 'number' && Number.isFinite(c)))) {
      return res.status(400).json({ ok: false, error: 'Claves inválidas' });
    }
    const cols = ALLOWED_TABLES[tabla].conflict.split(',').map(s => s.trim());
    // In slices: each key is quoted and percent-encoded, and a thousand of them
    // in one in.(...) would run past the URL length a proxy accepts.
    const filas = [];
    for (let i = 0; i < claves.length; i += LOTE_CLAVES) {
      const parte = claves.slice(i, i + LOTE_CLAVES);
      filas.push(...await sb(`${tabla}?select=${cols.join(',')}&${cols[0]}=in.${enc(lista(parte))}`));
    }
    return res.status(200).json({ ok: true, filas });
  } catch (e) {
    console.error('[datos] lectura fallida:', e.message);
    return res.status(502).json({ ok: false, error: 'No se pudo leer la base de datos' });
  }
}
