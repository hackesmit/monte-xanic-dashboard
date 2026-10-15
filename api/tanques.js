// api/tanques.js - token-gated access to the tank catalog and the movement log.
//
// dim_tanque, dim_tanque_sinonimo and movimientos_tanque are server-only
// (RLS on with no policies, and the grants the public schema hands anon and
// authenticated are revoked in sql/migration_tanques.sql), so the client never
// touches them with the anon key: every read and every write comes through here
// with the service key. Reads need any valid session; writes need role `lab`,
// the same gate as api/row.js.
//
// Writes are serialized and idempotent (decision on bead xd-qrn.8): the version
// counter is read before and after the catalog and the log (and the read is
// retried until it held still), the movement is validated against that log,
// and public.tanques_escribir writes only if the version has not moved, else
// the whole read and validation runs again (up to INTENTOS, then 409). Each
// crear carries a client_id, so repeating a POST whose answer was lost returns
// the row already written instead of a second one; the same key with other
// data is a 409, never "already saved". A write whose outcome is
// unknown answers 503 with `indeterminado: true`, never a refusal.
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
  'vintage_year', 'volumen_l', 'merma_l', 'nota', 'fuente', 'client_id',
]);

// Fields that must arrive as JSON strings. An array or an object would be
// String()-coerced into something like 'A1,A2' or '[object Object]' and then
// judged as if the client had meant it.
const CAMPOS_TEXTO = ['fecha', 'tipo', 'origen', 'destino', 'lot_code', 'nota', 'fuente', 'client_id'];
// Fields that must be a JSON number or a plain decimal string.
const CAMPOS_NUMERO = ['vintage_year', 'volumen_l', 'merma_l'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A plain decimal as Postgres prints a NUMERIC: optional minus, digits, an
// optional fraction. No hex, no exponent, no padding, no leading '+' or '.'.
const DECIMAL = /^-?\d+(\.\d+)?$/;

const FUENTES = new Set(['manual', 'lab']);
const ACCIONES = new Set(['crear', 'anular', 'descartar']);
const MAX_NOTA = 2000;
// The identity of an inferred trasiego proposal (js/tanques/inferencia.js
// clavePropuesta): lot_code|origen|destino|fecha. Same ceiling as the
// tanques_descartes_clave_chk CHECK, so the column answers what this answers.
const MAX_CLAVE = 200;
const VINTAGE_MIN = 1988;   // same range as the movimientos_tanque CHECK
const VINTAGE_MAX = 2100;
const PAGINA = 1000;        // PostgREST caps a response at 1000 rows
const INTENTOS = 3;         // read, validate and write attempts before a 409
const LECTURAS = 3;         // attempts at a read the version stays still across
const ESPERA_RPC_MS = 8000; // past this the write is abandoned as indeterminate
// One millilitre: the threshold below which a difference between two replays is
// not a real worsening. js/tanques/estado.js reports its balance totals to the
// same precision for the same reason, and the running destination level below
// accumulates up to half a microlitre of drift each time the module zeroes a
// tank it considers empty. Erring toward allowing, by a millilitre, beats
// refusing a legitimate annulment over float dust; a worsening anyone cares
// about is litres.
const TOLERANCIA_L = 1e-3;

// --- PostgREST to JS ----------------------------------------------------------

// A NUMERIC column can reach us as a JSON number (PostgREST) or as a string
// (node-postgres, and PostgREST too for values a double cannot hold). Read as a
// string every volume is junk to the pure module, which would then derive an
// empty bodega and refuse every movement. Only a plain decimal string is read
// as a number: Number() would also take '0x10', '1e400', '' and ' 5 ', none of
// which Postgres ever prints and none of which a client means as litres. A
// value we cannot read is passed through UNCHANGED so the caller or the module
// reports it instead of us inventing a number.
function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && DECIMAL.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}

const esNumero = (v) => typeof num(v) === 'number' && Number.isFinite(num(v));

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

// The bodega would not hold still: the version moved during every one of the
// LECTURAS attempts to read it. Nothing was written; answered 503 so the client
// simply tries again later. Distinct from ErrorIndeterminado, which is about a
// write that may have committed.
class ErrorInestable extends Error {}

// A write whose outcome we cannot know: the request may have reached Postgres
// and committed even though no answer came back. Reported as 503 with
// `indeterminado: true`, never as a refusal, because a refusal invites the
// user to repeat a movement that may already be in the log.
class ErrorIndeterminado extends Error {}

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

// The one write: public.tanques_escribir (sql/migration_tanques_escritura.sql)
// locks the version row, refuses with `conflicto` if the log changed since
// `version` was read, and is idempotent on client_id. Server-side only, with
// the service key; EXECUTE is revoked from anon and authenticated.
//
// Every way this can end without a definite answer is indeterminate: the fetch
// rejecting (network, or our own timeout firing after the request left), a 5xx
// (a gateway can time out while Postgres commits), or a 2xx we cannot read. A
// 4xx is definite: PostgREST answers it when the statement raised, and then the
// transaction rolled back.
async function escribir(version, accion, fila, id) {
  const { url, key } = entorno();
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_RPC_MS);
  let res, text;
  try {
    res = await fetch(`${url}/rest/v1/rpc/tanques_escribir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ p_version: version, p_accion: accion, p_fila: fila, p_id: id }),
      signal: control.signal,
    });
    text = await res.text();
  } catch (e) {
    throw new ErrorIndeterminado(e && e.message);
  } finally {
    clearTimeout(reloj);
  }
  if (res.status >= 500) throw new ErrorIndeterminado(`HTTP ${res.status}`);
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = undefined; }
  if (!res.ok) {
    const detalle = (json && (json.message || json.error)) || `HTTP ${res.status}`;
    throw new ErrorSupabase(String(detalle).slice(0, 200), res.status);
  }
  if (!json || typeof json !== 'object' || typeof json.resultado !== 'string') {
    throw new ErrorIndeterminado('respuesta ilegible de tanques_escribir');
  }
  return json;
}

// The version counter. leerEstable() reads it on both sides of the catalog and
// the log; a write that commits in between shows up as a moved version.
async function leerVersion() {
  const filas = await sb('tanques_version?select=v&id=eq.1');
  const v = Array.isArray(filas) && filas[0] ? num(filas[0].v) : undefined;
  if (!Number.isInteger(v)) {
    throw new ErrorSupabase('tanques_version sin fila (falta migration_tanques_escritura)', 500);
  }
  return v;
}

// Read a whole table past the 1000-row ceiling. The movement log is the history
// of the bodega: a silently truncated read would derive the wrong contents.
async function leerTodo(tabla, orden) {
  const filas = [];
  for (;;) {
    // The offset is the rows already read, not a multiple of PAGINA: a server
    // capping pages below PAGINA would otherwise have rows skipped between pages.
    const pagina = await sb(`${tabla}?select=*&order=${orden}&limit=${PAGINA}&offset=${filas.length}`);
    if (!Array.isArray(pagina)) {
      throw new ErrorSupabase(`${tabla}: respuesta que no es una lista`, 502);
    }
    // Only an EMPTY page ends the read. A short page is not proof of the end:
    // a server whose max-rows is set below PAGINA returns short pages all the
    // way through, and stopping on the first one would truncate the history.
    // The ordering always ends on a unique key (id, codigo, sinonimo), so
    // offset pages are stable between requests.
    if (pagina.length === 0) break;
    filas.push(...pagina);
  }
  return filas;
}

// One consistent snapshot: the version read before the catalog and the log and
// again after them. The pages of three tables are separate requests, so a write
// (or a catalog edit, which bumps the same version) landing between them would
// otherwise hand back a mix of before and after that never existed: a log with
// a row whose catalog is from before it, or half a page shifted by an insert.
// If the version moved, the whole read runs again; the version returned is the
// one that held across the read, so a write validated against this snapshot is
// refused as conflicto the moment anything in it changes.
async function leerEstable() {
  for (let i = 0; i < LECTURAS; i++) {
    const antes = await leerVersion();
    const bodega = await leerBodega();
    const despues = await leerVersion();
    if (antes === despues) return { version: antes, ...bodega };
  }
  throw new ErrorInestable(`la version cambio durante ${LECTURAS} lecturas`);
}

// The claves of the trasiego proposals somebody dismissed. Read on GET only,
// not inside leerEstable(): a dismissal changes no litres, so it is not part of
// the snapshot a write is validated against, and reading it there would cost a
// query on every write attempt for an answer no write looks at.
async function leerDescartadas() {
  const filas = await leerTodo('tanques_propuestas_descartadas', 'clave.asc');
  const fuera = [];
  for (const f of filas) {
    const c = typeof f.clave === 'string' ? f.clave : '';
    if (c) fuera.push(c);
  }
  return fuera;
}

async function leerBodega() {
  const [tanques, sinonimos, movimientos] = await Promise.all([
    leerTodo('dim_tanque', 'orden.asc,codigo.asc'),
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
  for (const k of CAMPOS_TEXTO) {
    if (m[k] != null && typeof m[k] !== 'string') return `El campo "${k}" debe ser texto.`;
  }
  // The idempotency key: one per user intent, reused when that intent is
  // retried, so a lost acknowledgment cannot record the movement twice.
  if (!UUID.test(m.client_id || '')) {
    return 'El movimiento necesita un client_id (UUID) para no registrarse dos veces.';
  }
  for (const k of ['volumen_l', 'merma_l']) {
    if (m[k] != null && !esNumero(m[k])) return `El campo "${k}" debe ser un numero decimal.`;
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
      sev.set(`${fila}|sobregiro`, { grave: falta, mensaje: a.mensaje, movimiento: a.movimiento });
    } else if (a.codigo === 'desbordado') {
      sev.set(`${fila}|desbordado`, {
        grave: sobra.has(fila) ? sobra.get(fila) : Infinity,
        mensaje: a.mensaje,
        movimiento: a.movimiento,
      });
    }
  }
  return sev;
}

// The first sobregiro or desbordado that `despues` has and `antes` did not, or
// has worse than `antes` had it. Allowed: an inconsistency the log already had,
// unchanged or smaller. Refused: one the change introduces or deepens. `propia`
// is a candidate row whose own avisos are skipped, because the point-in-time
// check in validarMovimientoEnLog is the authoritative report for it.
//
// Both writes go through this one comparison: an annulment compares the log
// with the row against the log without it, and a new row compares the log
// without it against the log with it. validarMovimientoEnLog alone only asks
// whether a downstream aviso is PRESENT, so a backdated withdrawal that takes
// an already overdrawn row from owing 5000 L to owing 9000 L would pass it.
function empeora(antes, despues, propia = null) {
  for (const [clave, d] of despues) {
    if (propia && d.movimiento === propia) continue;
    const a = antes.get(clave);
    if (a && d.grave <= a.grave + TOLERANCIA_L) continue;
    return d;
  }
  return null;
}

function vivos(movimientos) {
  return movimientos.filter(m => !m.anulado);
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
      const bodega = await leerEstable();
      // The dismissal list is read after the snapshot and outside its version
      // check on purpose (see leerDescartadas): the worst a dismissal landing
      // in between can do is show a proposal one render longer.
      const descartadas = await leerDescartadas();
      return res.status(200).json({ ok: true, ...bodega, descartadas });
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
    if (action === 'descartar') return await descartar(req, res, usuario);
    return await anular(req, res);
  } catch (e) {
    if (e instanceof ErrorInestable) {
      console.error('[tanques] lectura inestable:', e.message);
      return res.status(503).json({
        ok: false,
        error: 'La bitácora de tanques está cambiando en este momento; no se pudo leer completa. '
          + 'Intente de nuevo en unos segundos.',
      });
    }
    if (e instanceof ErrorIndeterminado) {
      console.error('[tanques] escritura sin confirmar:', e.message);
      return res.status(503).json({
        ok: false,
        indeterminado: true,
        error: 'No se pudo confirmar si la escritura quedó en la bitácora de tanques. '
          + 'Revise la bitácora antes de repetirla.',
      });
    }
    if (e instanceof ErrorSupabase) {
      console.error('[tanques] supabase:', e.status, e.message);
      return res.status(502).json({ ok: false, error: 'Error de base de datos en la bitácora de tanques' });
    }
    console.error('[tanques] error:', e && e.message);
    return res.status(500).json({ ok: false, error: 'Error al procesar el movimiento' });
  }
}

const CONFLICTO = 'La bitácora de tanques cambió mientras se registraba; no se escribió nada. Intente de nuevo.';
const CLIENT_ID_DISTINTO = 'El identificador del movimiento ya se usó con datos distintos; no se escribió nada.';

// Normalized forms for comparing a stored row with a request: numbers as
// numbers (so '10000.000000' from PostgREST equals 10000), a DATE as its plain
// YYYY-MM-DD, and an absent text as null.
const fechaPlana = (v) => {
  const t = texto(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : t;
};
const textoONulo = (v) => (v == null || v === '' ? null : v);
const extremo = (v) => texto(v) || null;
const litros = (v) => (v == null ? 0 : num(v));

// Is the stored row with this client_id the SAME intent as the movement being
// posted? Same fields public.tanques_misma_intencion compares in SQL: the
// whitelist plus creado_por (from the token). Different means the key is being
// reused for another movement, which must not be answered as "already saved".
function mismaIntencion(guardada, mov) {
  return fechaPlana(guardada.fecha) === fechaPlana(mov.fecha)
    && texto(guardada.tipo) === texto(mov.tipo)
    && extremo(guardada.origen) === extremo(mov.origen)
    && extremo(guardada.destino) === extremo(mov.destino)
    && texto(guardada.lot_code) === texto(mov.lot_code)
    && num(guardada.vintage_year) === num(mov.vintage_year)
    && num(guardada.volumen_l) === num(mov.volumen_l)
    && litros(guardada.merma_l) === litros(mov.merma_l)
    && textoONulo(guardada.nota) === textoONulo(mov.nota)
    && texto(guardada.fuente) === texto(mov.fuente)
    && textoONulo(guardada.creado_por) === textoONulo(mov.creado_por);
}

async function crear(req, res, usuario) {
  const entrada = (req.body || {}).movimiento;
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return res.status(400).json({ ok: false, error: 'Falta el movimiento a registrar.' });
  }

  const problema = revisarCampos(entrada);
  if (problema) return res.status(400).json({ ok: false, error: problema, errores: [problema] });
  const clientId = entrada.client_id.toLowerCase();

  // Read, validate, write; on `conflicto` the log changed under us, so read it
  // again and judge the movement against what is there now. Nothing is written
  // on a conflicto, so a retry can never duplicate.
  for (let intento = 0; intento < INTENTOS; intento++) {
    const { version, tanques, sinonimos, movimientos } = await leerEstable();

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
      client_id: clientId,
    };

    // The same key already landed (its acknowledgment was lost and the client
    // retried). Judging it again would count it twice and refuse it as an
    // overdraw of its own litres; the answer is the row that is there. But only
    // if it IS the same movement: a key reused with other data is a client bug
    // or a replay, and "already saved" would be a lie about what is saved.
    const previo = movimientos.find(m => typeof m.client_id === 'string'
      && m.client_id.toLowerCase() === clientId);
    if (previo) {
      if (!mismaIntencion(previo, movimiento)) {
        return res.status(409).json({ ok: false, error: CLIENT_ID_DISTINTO });
      }
      return res.status(200).json({ ok: true, duplicado: true, movimiento: previo });
    }

    // `fecha` is a BUSINESS date, so a row written today can belong in the middle
    // of the replay: validarMovimientoEnLog judges it at its place in the log and
    // reports the later rows it breaks. validarMovimiento against current state
    // would accept a backdated withdrawal that leaves next week overdrawn.
    // No `created_at` on the candidate on purpose: the module then sorts it last
    // among rows sharing its fecha, which is exactly where NOW() will put it.
    const errores = validarMovimientoEnLog(tanques, movimientos, movimiento, { sinonimos });
    if (!errores.length) {
      // validarMovimientoEnLog lets a row through when the downstream aviso it
      // touches was already there. Same severity gate as anular: an existing
      // inconsistency is not permission to deepen it.
      const log = vivos(movimientos);
      const peor = empeora(
        severidades(replayMovimientos(tanques, log, { sinonimos })),
        severidades(replayMovimientos(tanques, [...log, movimiento], { sinonimos })),
        movimiento,
      );
      if (peor) errores.push(`Este movimiento agrava un movimiento posterior: ${peor.mensaje}`);
    }
    if (errores.length) {
      return res.status(400).json({ ok: false, error: errores[0], errores });
    }

    const r = await escribir(version, 'crear', movimiento, null);
    if (r.resultado === 'conflicto') continue;
    if (r.resultado === 'client_id_distinto') {
      return res.status(409).json({ ok: false, error: CLIENT_ID_DISTINTO });
    }
    if ((r.resultado === 'creado' || r.resultado === 'duplicado') && r.fila && typeof r.fila === 'object') {
      const cuerpo = { ok: true, movimiento: filaMovimiento(r.fila) };
      if (r.resultado === 'duplicado') cuerpo.duplicado = true;
      return res.status(200).json(cuerpo);
    }
    throw new ErrorIndeterminado(`resultado inesperado: ${String(r.resultado).slice(0, 40)}`);
  }
  return res.status(409).json({ ok: false, error: CONFLICTO });
}

async function anular(req, res) {
  const id = idValido((req.body || {}).id);
  if (id === null) {
    return res.status(400).json({ ok: false, error: 'Identificador de movimiento no válido.' });
  }

  for (let intento = 0; intento < INTENTOS; intento++) {
    const { version, tanques, sinonimos, movimientos } = await leerEstable();
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
    // row and refuse if taking it out introduces or deepens a sobregiro or a
    // desbordado.
    const log = vivos(movimientos);
    const peor = empeora(
      severidades(replayMovimientos(tanques, log, { sinonimos })),
      severidades(replayMovimientos(tanques, log.filter(m => m.id !== id), { sinonimos })),
    );
    if (peor) {
      return res.status(400).json({
        ok: false,
        error: `No se puede anular: deja inconsistente un movimiento posterior: ${peor.mensaje}`,
      });
    }

    // tanques_escribir sends exactly anulado = true, the one change the
    // append-only trigger admits.
    const r = await escribir(version, 'anular', null, id);
    if (r.resultado === 'conflicto') continue;
    if (r.resultado === 'no_existe') {
      return res.status(404).json({ ok: false, error: 'El movimiento no existe.' });
    }
    if ((r.resultado === 'anulado' || r.resultado === 'ya_anulado') && r.fila && typeof r.fila === 'object') {
      const cuerpo = { ok: true, movimiento: filaMovimiento(r.fila) };
      if (r.resultado === 'ya_anulado') cuerpo.ya_anulado = true;
      return res.status(200).json(cuerpo);
    }
    throw new ErrorIndeterminado(`resultado inesperado: ${String(r.resultado).slice(0, 40)}`);
  }
  return res.status(409).json({ ok: false, error: CONFLICTO });
}

// Remember that somebody said NO to an inferred trasiego proposal.
//
// Nothing about the bodega changes: a dismissal writes no litres, so it skips
// the version counter, the replay and the validator entirely (the only three
// things the rest of this file exists to serialize). What it needs is to be
// idempotent on `clave`, which `on_conflict` plus `resolution=ignore-duplicates`
// gives: the FIRST dismissal keeps its author and its timestamp, and a repeat
// is a 201 with nothing written, so a lost answer costs a user nothing.
//
// Because a repeat is free, this write has no client_id and no indeterminate
// outcome to reconcile: pressing the button again is always safe.
async function descartar(req, res, usuario) {
  const clave = texto((req.body || {}).clave);
  if (!clave) {
    return res.status(400).json({ ok: false, error: 'Falta la clave de la propuesta a descartar.' });
  }
  if (clave.length > MAX_CLAVE) {
    return res.status(400).json({ ok: false, error: 'La clave de la propuesta no es válida.' });
  }
  // Four parts, the shape clavePropuesta() builds, so the table cannot become a
  // store for whatever a client feels like keying. The parts themselves are not
  // judged here: a proposal names tanks the catalog has, but a tank dropped
  // from the catalog later must not make an old dismissal unwritable.
  if (clave.split('|').length !== 4) {
    return res.status(400).json({ ok: false, error: 'La clave de la propuesta no es válida.' });
  }

  await sb('tanques_propuestas_descartadas?on_conflict=clave', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ clave, descartado_por: usuario }),  // usuario from the token
  });
  return res.status(200).json({ ok: true, clave });
}
