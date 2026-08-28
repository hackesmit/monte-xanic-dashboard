// api/winexray-sync.js
// One-button WineXRay sync: logs in to client.winexray.com server-side, pulls a
// date-bounded export CSV, runs it through the SAME parser the manual upload
// uses, and writes it through the SAME validate-and-upsert core.
//
// Why this is a serverless function and not browser code: it holds the winery's
// WineXRay login. Neither the login nor the _ncfa session cookie nor the export
// GUID is ever returned to the client or written to a log line here.
//
// Credentials come from Vercel encrypted environment variables
// (WINEXRAY_USERNAME / WINEXRAY_PASSWORD), never from Proton Pass: a deployed
// function has no pp binary and no pp session. See docs/External-APIs.md.
import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';
import { upsertRows } from './_lib/upsertRows.js';
import { WineXRayClient, WineXRayError } from './_lib/winexrayClient.js';
import { winexrayParser } from '../js/upload/winexray.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A sync-side failure carrying a Spanish, user-safe message. */
class SyncError extends Error {
  constructor(message) { super(message); this.name = 'SyncError'; this.status = 502; }
}
const VINEYARD_TZ = 'America/Tijuana';

// Re-fetch this many days before the newest stored sample. WineXRay rows can be
// entered late, so resuming exactly at the last stored date would skip them.
// Re-fetched rows collapse onto the same natural key, so overlap is free.
const LOOKBACK_DAYS = 7;

// Collapse overlapping runs on one warm instance: { key, promise }, keyed by
// the requested window so a caller asking for a different range is refused
// rather than handed someone else's answer.
//
// This is per-instance and NOT a distributed lock. Two concurrent requests
// routed to different Vercel instances still interleave, and the later writer
// wins. Correctness of the DATA does not depend on this: writes go through the
// composite unique constraint with on-conflict merge, so a duplicate run
// converges rather than doubling. What is genuinely not covered is one run
// overwriting a marginally fresher snapshot from another; the next sync
// corrects it. A cross-instance lease is tracked as follow-up work.
let inFlight = null;

function todayInVineyard() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VINEYARD_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

// Harvest season runs July 1 to October 31. Before July 1 the season in
// progress started last year.
function seasonStartFor(isoToday) {
  const year = Number(isoToday.slice(0, 4));
  return isoToday >= `${year}-07-01` ? `${year}-07-01` : `${year - 1}-07-01`;
}

function shiftDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The resume cursor: the OLDEST of the per-table newest sample_date values.
//
// Taking the newest across both tables looked equivalent and was a data-loss
// bug. Targets are written sequentially and are not atomic together, so if
// wine_samples commits and berry_samples then fails, a max-across-tables cursor
// advances past the berry rows that were never written and the next run skips
// them permanently. Taking the minimum keeps the cursor pinned to whichever
// table is furthest behind, so a partial write is re-covered on the next run.
//
// A query error is NOT treated as "no history": that would silently turn a
// transient Supabase failure into a wrong sync window. It fails the run.
async function resumeCursor(supabaseUrl, serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  let oldest = null;
  for (const table of ['berry_samples', 'wine_samples']) {
    const url = `${supabaseUrl}/rest/v1/${table}?select=sample_date&order=sample_date.desc&limit=1`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15000);
    let res;
    try {
      res = await fetch(url, { headers, signal: ac.signal });
    } catch (err) {
      throw new SyncError(err?.name === 'AbortError'
        ? 'La base de datos no respondió a tiempo.'
        : 'No se pudo consultar la base de datos.');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new SyncError('No se pudo consultar la última muestra almacenada.');
    const rows = await res.json();
    const d = rows?.[0]?.sample_date;
    // A table with no rows at all cannot bound the cursor; a full-season pull
    // is the correct answer for it.
    if (!d) return null;
    if (!oldest || d < oldest) oldest = d;
  }
  return oldest;
}

// `deps` exists so tests can drive the real parse-and-upsert path with a stub
// adapter instead of reaching client.winexray.com. Production passes nothing.
async function runSync({ from, to }, deps = {}) {
  const makeClient = deps.makeClient || (opts => new WineXRayClient(opts));
  const upsert = deps.upsert || upsertRows;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { status: 500, body: { ok: false, error: 'Configuración de base de datos incompleta' } };
  }

  const today = todayInVineyard();
  let start = from;
  if (!start) {
    const newest = await resumeCursor(supabaseUrl, serviceKey);
    // No history at all: pull the whole current harvest season. Before July 1
    // the season in progress is the PREVIOUS year's, so anchoring on this
    // year's July 1 would ask for a window that has not happened yet and,
    // after clamping, sync a single day.
    start = newest ? shiftDays(newest, -LOOKBACK_DAYS) : seasonStartFor(today);
  }
  const end = to || today;
  // Only an inverted range is clamped, and only by moving the START back to
  // the end. Never move the end backwards: that would silently shrink a window
  // the caller asked for.
  if (start > end) start = end;

  const client = makeClient({
    username: process.env.WINEXRAY_USERNAME,
    password: process.env.WINEXRAY_PASSWORD,
  });

  const { buffer, sampleCount } = await client.fetchExportCsv({ from: start, to: end });
  if (!buffer || !sampleCount) {
    return { status: 200, body: {
      ok: true, count: 0, rango: { desde: start, hasta: end },
      mensaje: `Sin muestras nuevas en WineXRay entre ${start} y ${end}.`,
    } };
  }

  // Same parser as the manual upload: it owns the Windows-1252 fallback and the
  // repair for the unquoted "Total Phenolics Index (IPT, d-less)" header, whose
  // embedded comma otherwise shifts every later column one position.
  const parsed = await winexrayParser.parse({
    name: 'winexray-sync.csv',
    async arrayBuffer() { return buffer; },
  });

  const written = {};
  for (const target of parsed.targets) {
    if (!target.rows.length) continue;
    const { status, body } = await upsert({ table: target.table, rows: target.rows });
    if (status !== 200) {
      return { status, body: { ...body, tabla: target.table, rango: { desde: start, hasta: end } } };
    }
    written[target.table] = body.count;
  }

  const total = Object.values(written).reduce((a, b) => a + b, 0);
  return { status: 200, body: {
    ok: true,
    count: total,
    escritos: written,
    excluidos: parsed.excluded,
    rechazados: parsed.rejected.length,
    rango: { desde: start, hasta: end },
    mensaje: total
      ? `Se sincronizaron ${total} muestras de WineXRay (${start} a ${end}).`
      : `Sin muestras nuevas en WineXRay entre ${start} y ${end}.`,
  } };
}

// `deps` is a test seam forwarded to runSync; production callers pass nothing.
export default async function handler(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Tighter than /api/upload's 30: each call drives several upstream requests.
  if (!rateLimit(req, res, { maxRequests: 6 })) return;

  const token = req.headers['x-session-token'];
  const result = await verifyToken(token, { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: 'No autorizado' });
  }
  const role = result.payload.role || 'viewer';
  if (role !== 'lab') {
    return res.status(403).json({ ok: false, error: 'Sin permisos para sincronizar datos' });
  }

  const { from, to } = req.body || {};
  if ((from && !DATE_ONLY.test(from)) || (to && !DATE_ONLY.test(to))) {
    return res.status(400).json({ ok: false, error: 'Formato de fecha inválido (se espera AAAA-MM-DD)' });
  }

  // A second caller for the SAME window joins the run already in flight. A
  // caller asking for a DIFFERENT window must not be handed the first run's
  // answer: it would report success for a range that was never synced.
  const rangeKey = `${from || ''}..${to || ''}`;
  if (inFlight) {
    if (inFlight.key !== rangeKey) {
      return res.status(409).json({
        ok: false,
        error: 'Ya hay una sincronización en curso. Espera a que termine e intenta de nuevo.',
      });
    }
    try {
      const shared = await inFlight.promise;
      return res.status(shared.status).json(shared.body);
    } catch {
      return res.status(502).json({ ok: false, error: 'La sincronización anterior falló. Intenta de nuevo.' });
    }
  }

  inFlight = { key: rangeKey, promise: runSync({ from, to }, deps) };
  try {
    const { status, body } = await inFlight.promise;
    return res.status(status).json(body);
  } catch (err) {
    if (err instanceof SyncError) {
      console.error('[winexray-sync] sync error');
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    if (err instanceof WineXRayError) {
      // Message is authored Spanish and carries no credential, URL or GUID.
      console.error('[winexray-sync] adapter error:', err.code);
      return res.status(err.status).json({ ok: false, error: err.message });
    }
    console.error('[winexray-sync] Server error:', err?.message);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  } finally {
    inFlight = null;
  }
}

export { runSync };
