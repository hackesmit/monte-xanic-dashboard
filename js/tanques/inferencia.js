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
// --- why visits, and why not every vessel change -----------------------------
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
// But each vessel's whole sampling window is wrong too, because a lote can
// come BACK: D5, then E1, then D5 again is two movements, and one D5 window
// spanning the E1 day hid both (lucy, 2026-10-15).
//
// So the unit is the VISIT: a maximal run of the lote's sampling days, in date
// order, in one vessel. Visits that overlap (sampled on a shared day), or that
// alternate X, Y, X, Y, are grouped as parallel sampling and reported as
// `traslapes`, never guessed at. Everything else is a chain of visits, and each
// link is a proposal. Visits that touch on a single day are a move ON that day:
// a trasiego is sampled in the old tank in the morning and the new one after.

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
// 2025) and the same window js/tanques/moves.js reads a prefix in.
const VENDIMIA_MIN = 2015;
const VENDIMIA_MAX = 2040;

export function vendimiaDeCodigo(lot_code) {
  const m = /^(\d{2})/.exec(texto(lot_code));
  if (!m) return null;
  const y = 2000 + Number(m[1]);
  return y >= VENDIMIA_MIN && y <= VENDIMIA_MAX ? y : null;
}

// Is this sample_id a lot code at all? 'DELETE PLEASE', 'DELETE PLEASER' and
// 'Control' are rows the lab left in wine_samples, and a proposal naming one of
// them is noise in an append-only ledger (DoD). A vendimia prefix alone is not
// enough: '25 DELETE PLEASE' has one (lucy, 2026-10-15).
//
// The rule is structural: two vintage digits, then a letter, then no
// whitespace anywhere. js/tanques/plan.js variedadDeLote is the app's
// lot-dialect reader, but it is a VARIETY reader and refuses real lotes:
// the 2026 ranch-first codes ('26R14CS', '26R14GRE') are lotes it cannot
// colour, and a lote with no colour still moves between tanks. Measured against
// every distinct wine_samples.sample_id in production on 2026-10-15 (312): the
// rule refuses exactly 'Control', 'DELETE PLEASE', 'DELETE PLEASER' and
// '24MEKMP-2 PD1' / '24MEKMP-3 PD2' (a lote with its tank typed into the id,
// each sampled in one vessel only, so neither ever had a proposal to lose).
// Printable ASCII only and at most 36 characters (the longest production id
// is 18): with the tank codes and the date that keeps every encoded clave
// under the API's MAX_CLAVE of 200, so every proposal shown can be dismissed
// (lucy, 2026-10-15).
const RE_LOTE = /^\d{2}[A-Za-z][\x21-\x7E]{0,33}$/;

export function esCodigoDeLote(lot_code) {
  const t = texto(lot_code);
  return RE_LOTE.test(t) && vendimiaDeCodigo(t) !== null;
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
 *
 * Each part is percent-encoded before the parts are joined with '|'. A lot code
 * is typed by hand in a lab sheet and nothing stops it holding a '|', and a raw
 * join would then give five parts, which the server refuses: a proposal nobody
 * could dismiss. Encoded, any part round-trips and '|' only ever separates.
 * api/tanques.js checks the same shape (es la regla de claveValida alli).
 */
export function clavePropuesta(p) {
  const d = p && typeof p === 'object' ? p : {};
  return [d.lot_code, d.origen, d.destino, d.fecha]
    .map((v) => encodeURIComponent(texto(v))).join('|');
}

// Does a live log row already record THIS transition? Same lote out of the same
// tank into the same tank, dated inside the transition itself.
//
// The type is ignored: the samples cannot tell a trasiego from a descube or a
// prensa, so a recorded descube D5 to E1 is this movement by another name.
//
// The date window is the TRANSITION, not the two vessels' whole stays: from the
// last day the lote was seen in the origin before it left, to the first day it
// was seen in the destination, both inclusive. The first bound is inclusive
// because a trasiego is sampled in the old tank in the morning and done that
// afternoon, so a user correcting the proposal's date to the origin's last day
// has filed the same movement. Anything earlier is a different trip: a log that
// already holds D5 to E1 on 11-01 and E1 to D5 on 11-02 says nothing about a
// D5 to E1 the samples place on 11-12, and measuring against the whole stays
// hid it (lucy, 2026-10-15).
//
// A covering row must also not be undone inside the window: D5 to E1 and then
// E1 to D5 later in the same window leaves the lote where it started, so the
// transition the samples show is still unrecorded.
//
// Erring toward RE-PROPOSING, not toward hiding: a user who files the movement
// under a wildly wrong date sees the proposal again and can dismiss it, while
// a hidden movement leaves the ledger quietly incomplete.
//
// An annulled row records nothing: the undo is the user saying it did not
// happen, so the proposal belongs back in the inbox.
const despuesDe = (x, y) => x.fecha > y.fecha || (x.fecha === y.fecha && x.orden > y.orden);

function yaRegistrada(p, filas) {
  const lo = p.origen_hasta;
  const hi = p.fecha;
  const dentro = (m) => m.lot_code === p.lot_code && m.fecha >= lo && m.fecha <= hi;
  const ida = filas.filter((m) => dentro(m) && m.origen === p.origen && m.destino === p.destino);
  if (!ida.length) return false;
  const vuelta = filas.filter((m) => dentro(m) && m.origen === p.destino && m.destino === p.origen);
  return ida.some((m) => !vuelta.some((r) => despuesDe(r, m)));
}

// The live log, reduced to what a comparison needs and with tank references
// resolved the way the proposals are. `orden` breaks a same-day tie: the log
// arrives as api/tanques.js reads it, fecha then id, so position is log order.
function filasVivas(movimientos, codigos, sinonimos) {
  const fuera = [];
  const lista = Array.isArray(movimientos) ? movimientos : [];
  lista.forEach((m, i) => {
    if (!m || typeof m !== 'object' || m.anulado) return;
    fuera.push({
      lot_code: texto(m.lot_code),
      origen: resolverVasija(m.origen, codigos, sinonimos) || texto(m.origen),
      destino: resolverVasija(m.destino, codigos, sinonimos) || texto(m.destino),
      fecha: texto(m.fecha).slice(0, 10),
      orden: i,
    });
  });
  return fuera;
}

const porVentana = (a, b) =>
  (a.desde < b.desde ? -1 : a.desde > b.desde ? 1
    : a.hasta < b.hasta ? -1 : a.hasta > b.hasta ? 1
      : a.codigo.localeCompare(b.codigo, 'es'));

/**
 * The lote's VISITS: per vessel, each maximal run of consecutive sampling days
 * (the lote's own days, in date order) on which that vessel was sampled.
 *
 * A vessel's whole window is not the unit, because a lote can come back: D5 on
 * the 1st, E1 on the 2nd and D5 again on the 3rd is two movements, and one D5
 * window from the 1st to the 3rd swallowed E1 and both moves with it (lucy,
 * 2026-10-15). A day the lote was sampled only in vessels the catalog does not
 * have is not one of the lote's days here, so a barrel sample between two tank
 * readings does not split a stay in the tank.
 *
 * Several vessels on one day each keep their run going: that is how the
 * parallel case (the lote in two tanks at once) shows up, as visits whose
 * windows overlap.
 */
function visitas(dias) {
  const abiertas = new Map();
  const fuera = [];
  for (const f of [...dias.keys()].sort()) {
    const hoy = dias.get(f);
    for (const [codigo, v] of abiertas) {
      if (!hoy.has(codigo)) { fuera.push(v); abiertas.delete(codigo); }
    }
    for (const [codigo, n] of hoy) {
      const v = abiertas.get(codigo);
      if (v) { v.hasta = f; v.muestras += n; }
      else abiertas.set(codigo, { codigo, desde: f, hasta: f, muestras: n });
    }
  }
  fuera.push(...abiertas.values());
  return fuera.sort(porVentana);
}

const codigosDe = (g) => new Set(g.visitas.map((v) => v.codigo));

function unir(grupos, i, j) {
  const vs = grupos.slice(i, j + 1).flatMap((g) => g.visitas).sort(porVentana);
  const g = {
    visitas: vs,
    desde: vs.reduce((m, v) => (v.desde < m ? v.desde : m), vs[0].desde),
    hasta: vs.reduce((m, v) => (v.hasta > m ? v.hasta : m), vs[0].hasta),
  };
  grupos.splice(i, j - i + 1, g);
}

/**
 * The visits merged into GROUPS: stretches in which the samples place the lote
 * in exactly one vessel (a group of one) or cannot tell (a group of several).
 * Moves are read only between groups.
 *
 * Three things make a group of several, and they are the safeguard for
 * genuinely parallel sampling:
 *
 *  1. Visits whose windows overlap, meaning the lote was sampled in both on a
 *     shared day. Comparing neighbours alone is not enough: with D5 sampled
 *     every day from the 1st to the 10th and E1 and H8 also on the 2nd and 3rd,
 *     the lote was demonstrably in three tanks (lucy, 2026-10-15). Starting
 *     exactly ON the day a group ends does not overlap: that is the transfer
 *     day, sampled in the old tank and then in the new one - but only when the
 *     side being left has more than that one day to show. Two vessels whose
 *     whole record is "seen on the 2nd" are simultaneous, not sequential, and
 *     separating them let the alphabet pick between them (lucy, 2026-10-15).
 *
 *  2. A neighbour that shares a vessel with a group of several. 23CSLLC-15 is
 *     sampled in E6 on 02-26, in F3 on 02-27 and in both from 04-04 on: E6
 *     never left, F3 was added, and "E6 to F3 on 02-27" would be invented.
 *
 *  3. Two vessels alternating X, Y, X, Y with nothing between them: a lote in
 *     two tanks that the lab samples one at a time. One return (X, Y, X) is a
 *     return visit and proposes two moves; a second one is a pattern.
 */
function agrupar(vs) {
  const grupos = [];
  for (const v of vs) {
    const g = grupos[grupos.length - 1];
    const unDia = g && g.desde === g.hasta;
    if (g && (v.desde < g.hasta || (v.desde === g.hasta && unDia))) {
      g.visitas.push(v);
      if (v.hasta > g.hasta) g.hasta = v.hasta;
    } else {
      grupos.push({ visitas: [v], desde: v.desde, hasta: v.hasta });
    }
  }
  for (let cambio = true; cambio;) {
    cambio = false;
    for (let i = 1; i < grupos.length && !cambio; i++) {
      const a = codigosDe(grupos[i - 1]);
      const b = codigosDe(grupos[i]);
      if ((a.size > 1 || b.size > 1) && [...a].some((c) => b.has(c))) {
        unir(grupos, i - 1, i);
        cambio = true;
      } else if (i >= 3) {
        const cuatro = grupos.slice(i - 3, i + 1).map(codigosDe);
        if (cuatro.every((c) => c.size === 1)) {
          const [w, x, y, z] = cuatro.map((c) => [...c][0]);
          if (w !== x && w === y && x === z) {
            unir(grupos, i - 3, i);
            cambio = true;
          }
        }
      }
    }
  }
  return grupos;
}

/**
 * The traslapes a group of several reports: each vessel against one it REALLY
 * intersects, not against whichever sits before it in the sort. A group is
 * held open by one long window and its members need not touch each other:
 * with D5 from the 1st to the 10th, E1 on the 2nd and H8 on the 3rd, the pair
 * E1/H8 claims a simultaneity that never happened (lucy, 2026-10-15). The
 * partner is the earlier vessel whose window reaches furthest, and the dates
 * are the intersection of the two windows - or, for vessels a group joined by
 * alternation, the gap between them, never a backwards interval.
 */
function traslapesDe(g) {
  const porVasija = new Map();
  for (const v of g.visitas) {
    const w = porVasija.get(v.codigo) || { codigo: v.codigo, desde: v.desde, hasta: v.hasta };
    if (v.desde < w.desde) w.desde = v.desde;
    if (v.hasta > w.hasta) w.hasta = v.hasta;
    porVasija.set(v.codigo, w);
  }
  const ws = [...porVasija.values()].sort(porVentana);
  const fuera = [];
  for (let i = 1; i < ws.length; i++) {
    const b = ws[i];
    let a = ws[0];
    for (let k = 1; k < i; k++) if (ws[k].hasta > a.hasta) a = ws[k];
    const desde = a.desde > b.desde ? a.desde : b.desde;
    const hasta = a.hasta < b.hasta ? a.hasta : b.hasta;
    fuera.push({
      // Two windows that are the SAME single day are a different story from
      // two that overlap for weeks, and the inbox tells them apart.
      motivo: (a.desde === a.hasta && b.desde === b.hasta && a.desde === b.desde)
        ? 'mismo_dia' : 'simultaneo',
      a: a.codigo,
      b: b.codigo,
      desde: desde <= hasta ? desde : hasta,
      hasta: desde <= hasta ? hasta : desde,
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
  // Coverage per vendimia, because the spec's stop-when is about ONE vintage's
  // samples and a whole-table percentage can hide a bad year behind good ones
  // (lucy, 2026-10-15).
  const vendimias = new Map();
  const porVendimia = (y) => {
    const e = vendimias.get(y) || { vendimia: y, muestras: 0, sin_tanque: 0 };
    vendimias.set(y, e);
    return e;
  };
  // lot_code -> {vintage_year, dias: Map(fecha -> Map(codigo -> muestras)), sinTanque}
  const porLote = new Map();
  let total = 0, sinVasija = 0;

  for (const r of Array.isArray(muestras) ? muestras : []) {
    if (!r || typeof r !== 'object' || esBerry(r)) continue;
    const lot_code = texto(r.codigoBodega);
    // Not a lot code means not a proposal (DoD: 'DELETE PLEASE' and friends
    // are ignored, not proposed).
    if (!esCodigoDeLote(lot_code)) continue;
    const vintage_year = vendimiaDeCodigo(lot_code);
    if (vendimiaPedida !== null && vintage_year !== vendimiaPedida) continue;
    const fecha = dia(r.fecha);
    const ref = texto(r.tanque);
    if (!fecha || !ref) continue;
    total += 1;
    porVendimia(vintage_year).muestras += 1;

    const lote = porLote.get(lot_code)
      || { vintage_year, dias: new Map(), sinTanque: [] };
    porLote.set(lot_code, lote);

    const codigo = resolverVasija(ref, codigos, sinonimos);
    if (!codigo) {
      sinVasija += 1;
      // Kept against the LOTE too, not only against the vessel: a reading with
      // no tank inside the gap between two tank windows is what tells us the
      // route is not a straight line (see the `puente` check below).
      lote.sinTanque.push(fecha);
      porVendimia(vintage_year).sin_tanque += 1;
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

    const d = lote.dias.get(fecha) || new Map();
    d.set(codigo, (d.get(codigo) || 0) + 1);
    lote.dias.set(fecha, d);
  }

  const propuestas = [];
  const traslapes = [];
  for (const [lot_code, lote] of porLote) {
    const grupos = agrupar(visitas(lote.dias));

    // A group of more than one vessel is reported, never resolved: the lote was
    // in both (a split, a blend) or somebody mistyped a tank, and the samples
    // name no single movement either way.
    for (const g of grupos) {
      for (const t of traslapesDe(g)) traslapes.push({ lot_code, vintage_year: lote.vintage_year, ...t });
    }

    for (let i = 1; i < grupos.length; i++) {
      const antes = grupos[i - 1];
      const despues = grupos[i];
      // Leaving a group of two or more vessels says nothing about WHICH tank
      // the wine left, so there is no origin to name.
      if (codigosDe(antes).size !== 1) continue;
      const origen = antes.visitas[antes.visitas.length - 1];
      // Arriving is different: a group's first-sampled vessel IS where the lote
      // turned up, and whatever happens between the vessels of that group
      // afterwards is the traslape above. A tie for first says nothing.
      const entrada = [...despues.visitas].sort((x, y) =>
        (x.desde < y.desde ? -1 : x.desde > y.desde ? 1 : 0));
      if (entrada.length > 1 && entrada[0].desde === entrada[1].desde) continue;
      const destino = entrada[0];

      // A vessel the catalog does not have, sampled in the GAP between the two
      // visits, is the only thing known about where the wine was in between.
      // Proposing a direct trasiego across it asserts a route the samples
      // contradict (lucy, 2026-10-15). Inside either visit it is a parallel
      // reading instead - BCA is barrels and BIN is bins, and a lote lives in
      // F9 while somebody samples one of its barrels - so only the gap counts.
      const puente = (lote.sinTanque || []).some(
        (f) => f > origen.hasta && f < destino.desde);
      if (puente) {
        traslapes.push({
          lot_code,
          vintage_year: lote.vintage_year,
          motivo: 'sin_tanque_en_medio',
          a: origen.codigo,
          b: destino.codigo,
          desde: origen.hasta,
          hasta: destino.desde,
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
    (a.lot_code.localeCompare(b.lot_code, 'es')
      || a.desde.localeCompare(b.desde)
      || a.a.localeCompare(b.a, 'es')));

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
      // Newest vendimia first: that is the one being worked, and the one the
      // spec's 20 per cent stop-when is about.
      por_vendimia: [...vendimias.values()]
        .sort((a, b) => b.vendimia - a.vendimia)
        .map((e) => ({ ...e, fraccion: e.muestras ? e.sin_tanque / e.muestras : 0 })),
      // The SPEC's stop-when is a share of the samples that name a vessel the
      // catalog does not have. Reported rather than enforced: a module that
      // silently returned nothing would be worse than one that says how much
      // it could not place.
      fraccion_sin_tanque: total ? sinVasija / total : 0,
      lotes: porLote.size,
    },
  };
}
