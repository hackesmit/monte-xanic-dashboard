// api/tanques.js - token-gated access to the tank catalog and the movement log.
//
// dim_tanque, dim_tanque_sinonimo and movimientos_tanque are server-only
// (RLS on with no policies, and the grants the public schema hands anon and
// authenticated are revoked in sql/migration_tanques.sql), so the client never
// touches them with the anon key: every read and every write comes through here
// with the service key. Reads need any valid session; writes need role `lab`,
// the same gate as api/row.js.
//
// This file holds no tank semantics. What a movement does to a tank lives in
// js/tanques/estado.js and is called, never restated. What this file owns is
// the gate around it: the session, the role, the insert whitelist, and turning
// PostgREST's JSON back into the shapes that pure module expects.
import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';
import { replayMovimientos, validarMovimientoEnLog } from '../js/tanques/estado.js';

// Exactly the columns a client may put on a new movement. Anything else is
// refused by name rather than silently dropped: `creado_por` in a body is a
// client trying to sign someone else's work, an explicit `id` desyncs the
// BIGSERIAL, a `created_at` or a pre-set `anulado` backdates or pre-kills a row,
// and `etapa` is a field the pure module reads but the table does not have
// (the stage is derived from the log). A silent drop would turn each of those
// into a bug nobody can see from the response.
const CAMPOS_MOVIMIENTO = new Set([
  'fecha', 'tipo', 'origen', 'destino', 'lot_code',
  'vintage_year', 'volumen_l', 'merma_l', 'nota', 'fuente',
]);

const FUENTES = new Set(['manual', 'lab']);
const ACCIONES = new Set(['crear', 'anular']);
const MAX_NOTA = 2000;
const VINTAGE_MIN = 1988;   // same range as the movimientos_tanque CHECK
const VINTAGE_MAX = 2100;
const PAGINA = 1000;        // PostgREST caps a response at 1000 rows
// Half a microlitre, the same "this is nothing" threshold js/tanques/estado.js
// quantizes to, so a float-dust difference is not read as a deeper overdraw.
const TOLERANCIA_L = 5e-7;

// --- PostgREST to JS ----------------------------------------------------------

// A NUMERIC column can reach us as a JSON number (PostgREST) or as a string
// (node-postgres, and PostgREST too for values a double cannot hold). Read as a
// string every volume is junk to the pure module, which would then derive an
// empty bodega and refuse every movement. A value we cannot read as a finite
// number is passed through UNCHANGED so the module reports it instead of us
// inventing a zero.
function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return v;
    const n = Number(t);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

// `anulado` gates the whole replay, so it must be a strict boolean: the string
// 'false' is truthy, and a log read back that way would look entirely annulled.
function bool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === 't' || t === '1' || t === 'yes';
  }
  return v === 1;
}

// `fecha` stays a plain YYYY-MM-DD business date and `created_at` a full ISO
// timestamp with its zone: js/tanques/estado.js orders the replay on both and
// refuses a timestamp with no zone on purpose.
function filaMovimiento(r) {
  return {
    ...r,
    volumen_l: num(r.volumen_l),
    merma_l: num(r.merma_l),
    vintage_year: num(r.vintage_year),
    id: num(r.id),
    anulado: bool(r.anulado),
  };
}

function filaTanque(t) {
  return {
    ...t,
    capacidad_l: num(t.capacidad_l),
    posicion: t.posicion == null ? null : num(t.posicion),
    orden: num(t.orden),
    activo: bool(t.activo),
  };
}

// --- Supabase ----------------------------------------------------------------

function entorno() {
  return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
}

class ErrorSupabase extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.status = status;
  }
}

async function sb(path, opts = {}) {
  const { url, key } = entorno();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  // fetch() does not throw on an HTTP error status. Without this, a 503 on the
  // log read would be reported as an empty bodega and every movement after it
  // would be refused as an overdraw of a tank that is actually full.
  if (!res.ok) {
    const detalle = (json && (json.message || json.error)) || `HTTP ${res.status}`;
    throw new ErrorSupabase(String(detalle).slice(0, 200), res.status);
  }
  return json;
}

// Read a whole table past the 1000-row ceiling. The movement log is the history
// of the bodega: a silently truncated read would derive the wrong contents.
async function leerTodo(tabla, orden) {
  const filas = [];
  for (let offset = 0; ; offset += PAGINA) {
    const pagina = await sb(`${tabla}?select=*&order=${orden}&limit=${PAGINA}&offset=${offset}`);
    if (!Array.isArray(pagina) || pagina.length === 0) break;
    filas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return filas;
}

async function leerBodega() {
  const [tanques, sinonimos, movimientos] = await Promise.all([
    leerTodo('dim_tanque', 'orden.asc'),
    leerTodo('dim_tanque_sinonimo', 'sinonimo.asc'),
    leerTodo('movimientos_tanque', 'fecha.asc,id.asc'),
  ]);
  // A null prototype: `sinonimo` is a TEXT primary key, so a row could be named
  // '__proto__' and must stay an ordinary key instead of touching a prototype.
  const indice = Object.create(null);
  for (const s of sinonimos) {
    const alias = typeof s.sinonimo === 'string' ? s.sinonimo.trim() : '';
    if (alias) indice[alias] = s.codigo;
  }
  return {
    tanques: tanques.map(filaTanque),
    sinonimos: indice,
    // Annulled rows are returned as they are: the replay skips them, and the
    // history panel shows them struck through. Filtering here would hide an
    // undo from the only place a user can see it.
    movimientos: movimientos.map(filaMovimiento),
  };
}

// --- helpers -----------------------------------------------------------------

const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

// Resolve a tank reference the way js/tanques/estado.js does, so the stored
// `origen`/`destino` is the canonical codigo: both columns have a foreign key
// to dim_tanque(codigo), and an alias like 'TIB13' would be refused by Postgres
// even though the validator accepted it.
function canonico(ref, codigos, sinonimos) {
  const t = texto(ref);
  if (!t || codigos.has(t)) return t;
  const alias = Object.prototype.hasOwnProperty.call(sinonimos, t) ? texto(sinonimos[t]) : '';
  return alias && codigos.has(alias) ? alias : t;
}

// An id for `anular`. A digit string is accepted (a JSON body from a browser
// may carry a BIGSERIAL either way); anything else is refused before it can be
// interpolated into a PostgREST filter.
function idValido(v) {
  if (typeof v === 'number') {
    return Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER ? v : null;
  }
  if (typeof v === 'string' && /^\d{1,15}$/.test(v.trim())) {
    const n = Number(v.trim());
    return n > 0 ? n : null;
  }
  return null;
}

// Everything the table requires that the pure module does not judge: the module
// asks for a lot_code only on a recepcion (elsewhere it is a label), while the
// column is NOT NULL with a non-blank CHECK for every type.
function revisarCampos(m) {
  for (const k of Object.keys(m)) {
    if (!CAMPOS_MOVIMIENTO.has(k)) {
      return `Campo no permitido en un movimiento: "${k}".`;
    }
  }
  // `fecha` is a DATE column, so a full timestamp would be truncated on the way
  // in and the stored row would sit at a different place in the replay than the
  // one that was just validated. Only a plain business date is accepted; the
  // pure module still judges whether it is a real calendar day.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto(m.fecha))) {
    return 'La fecha del movimiento debe ser una fecha AAAA-MM-DD.';
  }
  if (!texto(m.lot_code)) return 'El movimiento necesita un codigo de lote.';
  const vintage = num(m.vintage_year);
  if (!Number.isInteger(vintage) || vintage < VINTAGE_MIN || vintage > VINTAGE_MAX) {
    return `La vendimia debe ser un año entre ${VINTAGE_MIN} y ${VINTAGE_MAX}.`;
  }
  if (m.fuente != null && !FUENTES.has(texto(m.fuente))) {
    return 'La fuente del movimiento debe ser "manual" o "lab".';
  }
  if (m.nota != null) {
    if (typeof m.nota !== 'string') return 'La nota debe ser texto.';
    if (m.nota.length > MAX_NOTA) return `La nota no puede pasar de ${MAX_NOTA} caracteres.`;
  }
  for (const extremo of ['origen', 'destino']) {
    const v = m[extremo];
    if (v != null && typeof v !== 'string') return `El tanque ${extremo} debe ser un codigo de texto.`;
  }
  return '';
}

// Key an aviso to the ROW it blames, not to its index: `orden` is the position
// in the array handed to the replay, so removing a row renumbers everything
// after it and an id-free diff would report avisos that did not change.
function filaDe(a) {
  return a.movimiento && a.movimiento.id != null ? a.movimiento.id : `i${a.orden}`;
}

// How BADLY one replay contradicts itself, per row and per kind. Presence is
// not enough: a log that already owes 2000 L on one withdrawal must not be read
// as permission to make that same withdrawal owe 3000 L, which is what a plain
// "was this warning already there" diff would do (lucy, 2026-10-15).
//
// Both numbers come out of the replay's own output, so no tank rule is restated
// here. A sobregiro is clamped by the replay, so `volumen_l - movido_l` is the
// litres the log owes, and a row skipped outright (an empty origin) moved
// nothing at all. A desbordado clamps nothing, so its severity is the litres
// standing in the destination right after that row, accumulated from the
// per-row deltas the replay reports. The capacity is deliberately left out of
// that figure: the two replays being compared share one catalog, so it cancels,
// and leaving it out cannot disagree with how estado.js read it.
function severidades(replay) {
  const sobra = new Map();   // row -> litres in the destination just after it
  const nivel = new Map();   // tank -> running litres
  const movido = new Map();  // row -> litres it actually moved
  for (const a of replay.aplicados) {
    const fila = filaDe(a);
    movido.set(fila, a.movido_l);
    if (a.origen) nivel.set(a.origen, (nivel.get(a.origen) || 0) - a.movido_l);
    if (a.destino) {
      const total = (nivel.get(a.destino) || 0) + a.llegado_l;
      nivel.set(a.destino, total);
      sobra.set(fila, total);
    }
  }

  const sev = new Map();
  for (const a of replay.avisos) {
    const fila = filaDe(a);
    if (a.codigo === 'sobregiro') {
      const pedido = num(a.movimiento && a.movimiento.volumen_l);
      const dado = movido.has(fila) ? movido.get(fila) : 0;
      const falta = typeof pedido === 'number' && Number.isFinite(pedido)
        ? Math.max(0, pedido - dado)
        : Infinity;
      sev.set(`${fila}|sobregiro`, { grave: falta, mensaje: a.mensaje });
    } else if (a.codigo === 'desbordado') {
      sev.set(`${fila}|desbordado`, {
        grave: sobra.has(fila) ? sobra.get(fila) : Infinity,
        mensaje: a.mensaje,
      });
    }
  }
  return sev;
}

// --- handler -----------------------------------------------------------------

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  if (!rateLimit(req, res, { maxRequests: 60 })) return;

  const sesion = await verifyToken(req.headers['x-session-token'], { checkBlacklist: true });
  if (sesion.error) {
    return res.status(sesion.status).json({ ok: false, error: 'No autorizado' });
  }

  const { url, key } = entorno();
  if (!url || !key) {
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  try {
    if (req.method === 'GET') {
      const bodega = await leerBodega();
      return res.status(200).json({ ok: true, ...bodega });
    }

    // Reads are open to any session; appending to the bodega log is role lab.
    // The role is checked before the action is even read, so a viewer learns
    // nothing about which actions exist.
    const role = sesion.payload.role || 'viewer';
    if (role !== 'lab') {
      return res.status(403).json({ ok: false, error: 'Sin permisos para registrar movimientos' });
    }
    const usuario = sesion.payload.user || 'lab';

    const { action } = req.body || {};
    if (!ACCIONES.has(action)) {
      return res.status(400).json({ ok: false, error: 'Acción no válida' });
    }

    if (action === 'crear') return await crear(req, res, usuario);
    return await anular(req, res);
  } catch (e) {
    if (e instanceof ErrorSupabase) {
      console.error('[tanques] supabase:', e.status, e.message);
      return res.status(502).json({ ok: false, error: 'Error de base de datos en la bitácora de tanques' });
    }
    console.error('[tanques] error:', e && e.message);
    return res.status(500).json({ ok: false, error: 'Error al procesar el movimiento' });
  }
}

async function crear(req, res, usuario) {
  const entrada = (req.body || {}).movimiento;
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return res.status(400).json({ ok: false, error: 'Falta el movimiento a registrar.' });
  }

  const problema = revisarCampos(entrada);
  if (problema) return res.status(400).json({ ok: false, error: problema, errores: [problema] });

  const { tanques, sinonimos, movimientos } = await leerBodega();
  const codigos = new Set(tanques.map(t => texto(t.codigo)).filter(Boolean));

  // The row as it will be stored. Built field by field from the whitelist, so a
  // column the client has no business setting cannot arrive by spread. The
  // numerics are coerced here, once, so the validator below and the INSERT
  // below it judge and store the same value.
  const movimiento = {
    fecha: texto(entrada.fecha),
    tipo: texto(entrada.tipo),
    origen: texto(entrada.origen) ? canonico(entrada.origen, codigos, sinonimos) : null,
    destino: texto(entrada.destino) ? canonico(entrada.destino, codigos, sinonimos) : null,
    lot_code: texto(entrada.lot_code),
    vintage_year: num(entrada.vintage_year),
    volumen_l: num(entrada.volumen_l),
    merma_l: entrada.merma_l == null ? 0 : num(entrada.merma_l),
    nota: entrada.nota == null || entrada.nota === '' ? null : entrada.nota,
    fuente: entrada.fuente == null ? 'manual' : texto(entrada.fuente),
    creado_por: usuario,   // from the verified token, never from the body
  };

  // `fecha` is a BUSINESS date, so a row written today can belong in the middle
  // of the replay: validarMovimientoEnLog judges it at its place in the log and
  // reports the later rows it breaks. validarMovimiento against current state
  // would accept a backdated withdrawal that leaves next week overdrawn.
  // No `created_at` on the candidate on purpose: the module then sorts it last
  // among rows sharing its fecha, which is exactly where NOW() will put it.
  const errores = validarMovimientoEnLog(tanques, movimientos, movimiento, { sinonimos });
  if (errores.length) {
    return res.status(400).json({ ok: false, error: errores[0], errores });
  }

  const filas = await sb('movimientos_tanque', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(movimiento),
  });
  const fila = Array.isArray(filas) ? filas[0] : filas;
  if (!fila) {
    return res.status(502).json({ ok: false, error: 'El movimiento no se pudo registrar.' });
  }
  return res.status(200).json({ ok: true, movimiento: filaMovimiento(fila) });
}

async function anular(req, res) {
  const id = idValido((req.body || {}).id);
  if (id === null) {
    return res.status(400).json({ ok: false, error: 'Identificador de movimiento no válido.' });
  }

  const { tanques, sinonimos, movimientos } = await leerBodega();
  const objetivo = movimientos.find(m => m.id === id);
  if (!objetivo) {
    return res.status(404).json({ ok: false, error: 'El movimiento no existe.' });
  }
  // The append-only trigger forbids re-activating a row, so an annulment is
  // final; answering 200 for one already annulled keeps a double click from
  // looking like a failure.
  if (objetivo.anulado) {
    return res.status(200).json({ ok: true, ya_anulado: true, movimiento: objetivo });
  }

  // js/tanques/estado.js validates an APPENDED row. An annulment is a removal,
  // and removing an early recepcion can leave every withdrawal after it
  // overdrawn, so the gate is here: replay the live log with and without this
  // row and refuse if taking it out creates a new sobregiro or desbordado.
  const vivos = movimientos.filter(m => !m.anulado);
  const con = severidades(replayMovimientos(tanques, vivos, { sinonimos }));
  const sin = severidades(replayMovimientos(tanques, vivos.filter(m => m.id !== id), { sinonimos }));
  for (const [clave, despues] of sin) {
    const antes = con.get(clave);
    // Allowed: an inconsistency the log already had, unchanged or smaller.
    // Refused: one this annulment introduces, or one it deepens.
    if (antes && despues.grave <= antes.grave + TOLERANCIA_L) continue;
    return res.status(400).json({
      ok: false,
      error: `No se puede anular: deja inconsistente un movimiento posterior: ${despues.mensaje}`,
    });
  }

  const filas = await sb(`movimientos_tanque?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    // Only `anulado`. The append-only trigger raises on any other change, and
    // sending the whole row back would hand it every reason to.
    body: JSON.stringify({ anulado: true }),
  });
  const fila = Array.isArray(filas) ? filas[0] : filas;
  if (!fila) {
    return res.status(404).json({ ok: false, error: 'El movimiento no existe.' });
  }
  return res.status(200).json({ ok: true, movimiento: filaMovimiento(fila) });
}
