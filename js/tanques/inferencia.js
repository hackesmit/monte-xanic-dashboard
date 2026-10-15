// js/tanques/inferencia.js - proposing trasiegos from what the lab wrote down.
//
// Bead xd-qrn.6, SPEC "Lab inference": wine_samples.vessel_id records which
// vessel each sample came from, so a lote that appears in D5 through November 11
// and in E1 from November 12 was moved. That is a PROPOSAL, never a movement:
// the samples give no volume, no merma and no movement type, and the lab writes
// vessel ids by hand. A human confirms it in the inbox and the dialog writes the
// row (fuente 'lab').
//
// Pure: plain data in, plain data out. No DOM, no imports, no I/O, so the whole
// inference is testable in node (tests/mt58-tanques-inferencia.test.mjs) against
// a fixture taken from production.
//
// No tank semantics live here either. This file does not know what a trasiego
// does to a tank (js/tanques/estado.js owns that) and proposes no volume: the
// dialog derives the volume from the origin's derived contents at the proposal's
// date. What this file owns is one question: which pairs of tanks does the
// sampling record name as a move, and which does it refuse to name.
//
// --- why windows and not consecutive samples ---------------------------------
//
// The obvious reading - "the vessel changed between two consecutive samples" -
// is wrong on this data, and wrong in a way that invents movements:
//
//   The lab does not sample every vessel every day. 23CSLLC-15 sits in E6 AND
//   F3 for five months; on 2025-02-26 only E6 was sampled and on 2025-02-27
//   only F3, which a consecutive reading calls a trasiego E6 to F3, and then
//   calls the next joint sample a trasiego back.
//
//   A lote can be in two vessels at once. 24CSCC-1 is in G3 and H10 together
//   from September on: there is no single pair of tanks to name.
//
// So the unit is the WINDOW each vessel was sampled in - its first and last
// sample date for that lote - and a move is proposed only between vessels whose
// windows do not overlap: `origen.hasta <= destino.desde`. Vessels whose windows
// overlap mean the lote was in both at the same time, which the samples cannot
// turn into one movement, and they are reported as `traslapes` instead of being
// guessed at. Windows that touch on a single day are a move ON that day: a
// trasiego is sampled in the old tank in the morning and the new one after.
//
// Equality is allowed at the boundary only, so the chain stays a chain.

const texto = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return String(v).trim();
};
const propio = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// A plain YYYY-MM-DD business date, which is what sample_date is and what
// movimientos_tanque.fecha stores. A string compare IS a date compare on this
// format, so nothing here parses a Date (see the ordering note in estado.js: a
// timestamp with no zone means a different instant per reader).
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// A sample's date, as a business day. Anything we cannot read as one is dropped
// rather than placed at an invented point in the timeline.
function dia(v) {
  const t = texto(v).slice(0, 10);
  if (!RE_FECHA.test(t)) return '';
  const [y, m, d] = t.split('-').map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return '';
  return t;
}

// Berry rows are grapes in the field, not wine in a vessel: their vessel_id is
// empty and a 'Berries' row with one would still not be a tank reading.
const esBerry = (fila) => {
  const t = texto(fila && fila.sampleType).toLowerCase();
  return t === 'berries' || t === 'berry';
};

// The vendimia a lot code states, with the house rule (CLAUDE.md: '25CSKMP-4' is
// 2025) and the same window js/tanques/moves.js reads a prefix in. This is also
// the test for whether a sample_id IS a lot code at all: 'DELETE PLEASE',
// 'DELETE PLEASER' and 'Control' are rows the lab left in wine_samples, and a
// proposal naming one of them is noise in an append-only ledger (DoD).
// Measured against production on 2026-10-15: those three ids are exactly the
// sample_ids with no two-digit prefix, and every real code has one.
const VENDIMIA_MIN = 2015;
const VENDIMIA_MAX = 2040;

export function vendimiaDeCodigo(lot_code) {
  const m = /^(\d{2})/.exec(texto(lot_code));
  if (!m) return null;
  const y = 2000 + Number(m[1]);
  return y >= VENDIMIA_MIN && y <= VENDIMIA_MAX ? y : null;
}

/**
 * A vessel reference as the lab writes it, normalized for lookup.
 *
 * sql/migration_tanques.sql states the rule for every consumer: collapse
 * whitespace and upper-case BEFORE looking in dim_tanque.codigo and then in
 * dim_tanque_sinonimo.sinonimo, which is why the synonym table carries no
 * variants that differ only in spacing. This is NOT a second copy of
 * estado.js's resolver: that one resolves a canonical column already stored in
 * the log, this one reads free text a human typed into a lab sheet ('tib 13',
 * 'PD1 ', 'i4').
 */
export function normalizarVasija(ref) {
  return texto(ref).replace(/\s+/g, ' ').toUpperCase();
}

/**
 * The canonical tank code a vessel_id names, or '' when nothing in the catalog
 * does. Never a guess: BIN and BCA are areas (bins, barricas), C9 and FI are
 * unresolved, and TIBOR 17 / TIBOR 24 / F036 are vessels the inventory does not
 * have. All of them come back '' and are reported, not invented (SPEC).
 */
export function resolverVasija(ref, codigos, sinonimos) {
  const n = normalizarVasija(ref);
  if (!n) return '';
  if (propio(codigos, n)) return codigos[n];
  if (sinonimos && propio(sinonimos, n)) {
    const alias = normalizarVasija(sinonimos[n]);
    if (propio(codigos, alias)) return codigos[alias];
  }
  return '';
}

// codigo lookup by NORMALIZED code, so 'tibor  13' finds 'TIBOR 13'. The
// catalog's own codes are already collapsed (migration_tanques.sql), so this
// only absorbs what the lab typed.
function indiceCodigos(catalogo) {
  const ix = Object.create(null);
  for (const t of Array.isArray(catalogo) ? catalogo : []) {
    const c = texto(t && t.codigo);
    if (c) ix[normalizarVasija(c)] = c;
  }
  return ix;
}

function indiceSinonimos(sinonimos) {
  const ix = Object.create(null);
  if (!sinonimos) return ix;
  const pares = sinonimos instanceof Map ? [...sinonimos] : Object.entries(sinonimos);
  for (const [alias, codigo] of pares) {
    const a = normalizarVasija(alias);
    if (a) ix[a] = texto(codigo);
  }
  return ix;
}

/**
 * The stable key of a proposal: lote, origin, destination and date.
 *
 * It is what a dismissal is remembered by (public.tanques_propuestas_descartadas
 * .clave) and so it must not change when anything else does. Only these four
 * fields go in: the samples behind a proposal can grow (another sample lands in
 * the destination) without turning the user's "no" back into a yes.
 * '|' cannot appear in a tank code or a lot code, so the parts cannot run
 * together into another proposal's key.
 */
export function clavePropuesta(p) {
  const d = p && typeof p === 'object' ? p : {};
  return [texto(d.lot_code), texto(d.origen), texto(d.destino), texto(d.fecha)].join('|');
}

// Does a live log row already record this proposal? Same lote out of the same
// tank into the same tank, whatever the type and whatever the DATE.
//
// Neither of those two is laxness. The samples cannot tell a trasiego from a
// descube or a prensa, so a recorded descube D5 to E1 is this movement by
// another name. And the date on the row is the one the user corrected in the
// dialog: the proposal's date is the first day the lote was SAMPLED in the new
// tank, which is at best the day of the move and often the day after, so a
// date-sensitive match would put the proposal straight back in the inbox and
// invite a second row for the move that was just recorded. A lote that really
// went D5 to E1 twice would be sampled in D5 again after E1, which makes the
// windows overlap and proposes nothing at all (see traslapes).
//
// An annulled row records nothing: the undo is the user saying it did not
// happen, so the proposal belongs back in the inbox.
function yaRegistrada(p, filas) {
  for (const m of filas) {
    if (m.lot_code !== p.lot_code) continue;
    if (m.origen === p.origen && m.destino === p.destino) return true;
  }
  return false;
}

// The live log, reduced to what a comparison needs and with tank references
// resolved the way the proposals are.
function filasVivas(movimientos, codigos, sinonimos) {
  const fuera = [];
  for (const m of Array.isArray(movimientos) ? movimientos : []) {
    if (!m || typeof m !== 'object' || m.anulado) continue;
    fuera.push({
      lot_code: texto(m.lot_code),
      origen: resolverVasija(m.origen, codigos, sinonimos) || texto(m.origen),
      destino: resolverVasija(m.destino, codigos, sinonimos) || texto(m.destino),
      fecha: texto(m.fecha).slice(0, 10),
    });
  }
  return fuera;
}

/**
 * Propose trasiegos from the vessel changes the lab recorded.
 *
 * @param {Array} muestras DataStore.wineRecepcion rows: {codigoBodega, fecha,
 *   tanque, vintage, sampleType}. `tanque` is wine_samples.vessel_id.
 * @param {Object} bodega the shape view.js._bodega() builds: {catalogo,
 *   sinonimos, movimientos}. The catalog is required - without it every vessel
 *   id would look like a tank and BIN would be proposed as one.
 * @param {Object} [opciones] {descartadas: iterable of claves to leave out,
 *   vendimia: only this vendimia (defaults to every one present)}
 * @returns {{propuestas: Array, traslapes: Array, sinResolver: Array,
 *   resumen: Object}}
 *   propuestas: {clave, lot_code, vintage_year, origen, destino, fecha,
 *     origen_desde, origen_hasta, destino_hasta, muestras_origen,
 *     muestras_destino} - oldest date first.
 *   traslapes: pairs of vessels whose sampling windows overlap, so no movement
 *     is named.
 *   sinResolver: one entry per vessel_id the catalog does not have, with the
 *     lotes and dates that named it.
 *   resumen: counts for the coverage check (SPEC stop-when).
 */
export function inferirMovimientos(muestras, bodega = {}, opciones = {}) {
  const codigos = indiceCodigos(bodega.catalogo);
  const sinonimos = indiceSinonimos(bodega.sinonimos);
  const filas = filasVivas(bodega.movimientos, codigos, sinonimos);
  const descartadas = new Set();
  for (const c of opciones.descartadas || []) descartadas.add(texto(c));
  const vendimiaPedida = Number.isInteger(opciones.vendimia) ? opciones.vendimia : null;

  // vessel_id -> {vessel_id, muestras, lotes:Set, desde, hasta}
  const sinResolver = new Map();
  // lot_code -> {vintage_year, vasijas: Map(codigo -> {desde, hasta, muestras})}
  const porLote = new Map();
  let total = 0, sinVasija = 0;

  for (const r of Array.isArray(muestras) ? muestras : []) {
    if (!r || typeof r !== 'object' || esBerry(r)) continue;
    const lot_code = texto(r.codigoBodega);
    const vintage_year = vendimiaDeCodigo(lot_code);
    // No vendimia prefix means it is not a lot code (DoD: 'DELETE PLEASE' and
    // friends are ignored, not proposed).
    if (!lot_code || vintage_year === null) continue;
    if (vendimiaPedida !== null && vintage_year !== vendimiaPedida) continue;
    const fecha = dia(r.fecha);
    const ref = texto(r.tanque);
    if (!fecha || !ref) continue;
    total += 1;

    const codigo = resolverVasija(ref, codigos, sinonimos);
    if (!codigo) {
      sinVasija += 1;
      const n = normalizarVasija(ref);
      const e = sinResolver.get(n)
        || { vessel_id: n, muestras: 0, lotes: new Set(), desde: fecha, hasta: fecha };
      e.muestras += 1;
      e.lotes.add(lot_code);
      if (fecha < e.desde) e.desde = fecha;
      if (fecha > e.hasta) e.hasta = fecha;
      sinResolver.set(n, e);
      continue;
    }

    const lote = porLote.get(lot_code) || { vintage_year, vasijas: new Map() };
    const v = lote.vasijas.get(codigo) || { codigo, desde: fecha, hasta: fecha, muestras: 0 };
    v.muestras += 1;
    if (fecha < v.desde) v.desde = fecha;
    if (fecha > v.hasta) v.hasta = fecha;
    lote.vasijas.set(codigo, v);
    porLote.set(lot_code, lote);
  }

  const propuestas = [];
  const traslapes = [];
  for (const [lot_code, lote] of porLote) {
    // Order by window: first sample, then last, then the code, so the chain is
    // the same whatever order the rows arrived in.
    const vasijas = [...lote.vasijas.values()].sort((a, b) =>
      (a.desde < b.desde ? -1 : a.desde > b.desde ? 1
        : a.hasta < b.hasta ? -1 : a.hasta > b.hasta ? 1
          : a.codigo.localeCompare(b.codigo, 'es')));
    for (let i = 1; i < vasijas.length; i++) {
      const origen = vasijas[i - 1];
      const destino = vasijas[i];
      if (origen.hasta > destino.desde) {
        // The lote was sampled in both vessels at once: a split, a blend, or a
        // vessel id somebody mistyped. Either way the samples name no single
        // movement, and guessing one would put litres in the ledger that no
        // measurement supports.
        traslapes.push({
          lot_code,
          vintage_year: lote.vintage_year,
          a: origen.codigo,
          b: destino.codigo,
          desde: destino.desde,
          hasta: origen.hasta,
        });
        continue;
      }
      const p = {
        lot_code,
        vintage_year: lote.vintage_year,
        origen: origen.codigo,
        destino: destino.codigo,
        // The day the lote is first seen in the new tank: the earliest date the
        // samples support, and never a date the origin was still sampled after.
        fecha: destino.desde,
        origen_desde: origen.desde,
        origen_hasta: origen.hasta,
        destino_hasta: destino.hasta,
        muestras_origen: origen.muestras,
        muestras_destino: destino.muestras,
      };
      p.clave = clavePropuesta(p);
      // Dismissed by a user, and remembered server-side by this exact clave. A
      // proposal whose date moves EARLIER (a sample lands in the destination
      // before the ones already there) gets a new clave and so comes back:
      // that is the conservative direction, asking again rather than staying
      // hidden behind a key nobody can see.
      if (descartadas.has(p.clave)) continue;
      if (yaRegistrada(p, filas)) continue;
      propuestas.push(p);
    }
  }

  propuestas.sort((a, b) =>
    (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.lot_code.localeCompare(b.lot_code, 'es')));
  traslapes.sort((a, b) =>
    (a.lot_code.localeCompare(b.lot_code, 'es') || a.a.localeCompare(b.a, 'es')));

  const lista = [...sinResolver.values()]
    .map((e) => ({ ...e, lotes: [...e.lotes].sort((a, b) => a.localeCompare(b, 'es')) }))
    .sort((a, b) => b.muestras - a.muestras || a.vessel_id.localeCompare(b.vessel_id, 'es'));

  return {
    propuestas,
    traslapes,
    sinResolver: lista,
    resumen: {
      muestras: total,
      muestras_sin_tanque: sinVasija,
      vasijas_sin_tanque: lista.length,
      // The SPEC's stop-when is a share of the samples that name a vessel the
      // catalog does not have. Reported rather than enforced: a module that
      // silently returned nothing would be worse than one that says how much
      // it could not place.
      fraccion_sin_tanque: total ? sinVasija / total : 0,
      lotes: porLote.size,
    },
  };
}
