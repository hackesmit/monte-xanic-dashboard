// js/tanques/estado.js — pure tank-state module (no DOM, no I/O, no imports).
// Tank contents are DERIVED from the append-only movement log (SPEC: Mapa de Tanques).
// Shared by the API (server-side validation) and the UI, so it stays Node-importable
// like js/mona/dataAccess.js: plain row arrays in, plain objects out.
//
// Semantics, fixed here so the API and the UI cannot drift apart:
//  - `anulado` rows are ignored entirely; undo never deletes a row.
//  - rows are applied in (fecha, created_at) order, ties broken by input order.
//  - the origin loses `volumen_l`; the destination receives `volumen_l - merma_l`
//    ("merma is subtracted from what arrives").
//  - a move out of a tank takes every lote in it PROPORTIONALLY to its litres: you
//    cannot pump one lote out of a blend. `lot_code` therefore only names the lote
//    on a row with no origin (a recepcion); on a row with an origin it is a label,
//    and the split follows the tank composition. Writing one row per lote of a blend
//    yields the same composition as one blended row, because proportional removal
//    commutes.
//  - a row with no destination (a salida) carries no merma of its own: the loss
//    is already inside the volume that left, so counting it again would double
//    count it.
//  - a row that cannot be applied (unknown tank, no tanks at all, junk volume) is
//    skipped and reported in `avisos`; nothing is invented.
//
// `fecha` is a BUSINESS date, so a row written today can be applied in the middle
// of the replay. A write gate must therefore use validarMovimientoEnLog, which
// judges the candidate at its place in the log and reports the later rows it
// breaks; validarMovimiento alone only judges it against the state you hand it.

export const TIPOS = ['recepcion', 'trasiego', 'descube', 'sangrado', 'prensa', 'ensamble', 'salida'];

// Stages of the mockup panel (state/specs/xd-tanques/mapa-tanques.html).
export const ETAPAS = ['rec', 'mac', 'fa', 'des', 'fml', 'cri', 'emb'];

// Only these movement types name a stage by themselves, and only for a tank that
// was empty. For the rest the stage travels with the wine: an occupied
// destination keeps its own stage, an empty one takes the origin's. Anything finer (maceracion, FML, crianza) is not
// derivable from the log and must come as `etapa` on the row.
export const ETAPA_POR_TIPO = { recepcion: 'rec', descube: 'des' };

export const LOTE_SIN_CODIGO = '(sin lote)';

const EPS = 1e-6;
const SIN_ORIGEN = new Set(['recepcion']);
const SIN_DESTINO = new Set(['salida']);

// --- helpers -----------------------------------------------------------------

function redondear(n) {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

// Balance totals are reported to the millilitre: proportional splits cannot be
// exact in floating point, and a sub-millilitre drift is not a real discrepancy.
function redondearTotal(n) {
  const r = Math.round(n * 1e3) / 1e3;
  return Object.is(r, -0) ? 0 : r;
}

// Split `total` across `pesos` so the shares sum to `total` EXACTLY at the
// rounding quantum: rounding each share on its own loses up to half a quantum
// per lote per movement, which accumulates into a real conservation gap over
// thousands of small withdrawals. The remainder goes to the largest share,
// deterministically (first one wins a tie).
function repartir(pesos, total) {
  if (!pesos.length) return [];
  let suma = 0;
  for (const p of pesos) suma += p;
  if (suma <= 0) return pesos.map(() => 0);
  const partes = pesos.map(p => redondear((p * total) / suma));
  let acumulado = 0;
  for (const x of partes) acumulado += x;
  const resto = redondear(total - acumulado);
  if (resto !== 0) {
    let k = 0;
    for (let j = 1; j < partes.length; j++) if (partes[j] > partes[k]) k = j;
    partes[k] = redondear(partes[k] + resto);
  }
  return partes;
}

function texto(v) {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v).trim();
}

function numero(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

function fmtL(n) {
  const r = Math.round(n * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

// A date must be a real calendar date in a format we can order: a plain
// YYYY-MM-DD business date, or a full ISO timestamp. '2025-02-30',
// '2025-09-01garbage' and '2025-09-01T09:30garbage' are all refused rather than
// carried into the log and into the replay order.
const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function fechaValida(v) {
  const t = texto(v);
  const m = RE_FECHA.exec(t);
  if (!m) return '';
  if (m[4] != null && (Number(m[4]) > 23 || Number(m[5]) > 59 || (m[6] != null && Number(m[6]) > 59))) return '';
  const [y, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mes - 1, dia));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return '';
  return t;
}

// The day a movement belongs to, for `desde` and `ultima_entrada`.
function fechaDia(v) {
  return fechaValida(v).slice(0, 10);
}

// Ordering key. A timestamp is compared as an INSTANT, not as text: lexical
// order puts '2025-09-01T09:00:00Z' before '2025-09-01T10:00:00+02:00' even
// though the second one happened two hours earlier. Keys we cannot place in
// time (missing, or a format we refuse) go in a second bucket that always sorts
// after the datable ones and is compared as text, so the comparator stays a
// total order instead of switching rule per pair and losing transitivity.
function clave(v) {
  const t = fechaValida(v);
  const n = t ? Date.parse(t) : NaN;
  return Number.isNaN(n) ? { bucket: 1, n: 0, t: texto(v) } : { bucket: 0, n, t };
}

function compararClaves(a, b) {
  if (a.bucket !== b.bucket) return a.bucket < b.bucket ? -1 : 1;
  if (a.bucket === 0) return a.n === b.n ? 0 : (a.n < b.n ? -1 : 1);
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  return 0;
}


// Resolve a tank reference against the catalog, then dim_tanque_sinonimo
// (production data writes PD1 for PD-1, TIB 13 for TIBOR 13, I4 for I-4 CAVA).
function resolver(ref, codigos, sinonimos) {
  const t = texto(ref);
  if (!t) return '';
  if (codigos.has(t)) return t;
  const alias = sinonimos && Object.prototype.hasOwnProperty.call(sinonimos, t) ? texto(sinonimos[t]) : '';
  if (alias && codigos.has(alias)) return alias;
  return t; // unresolved: the caller reports it as unknown
}

function indiceSinonimos(opciones) {
  const s = opciones && opciones.sinonimos;
  if (!s) return null;
  if (s instanceof Map) return Object.fromEntries(s);
  return s;
}

function tanqueVacio(codigo, capacidad_l) {
  return {
    codigo,
    capacidad_l,
    partes: [],
    litros: 0,
    libres: capacidad_l,
    etapa: null,
    desde: null,
    ultima_entrada: null,
  };
}

function recalcular(t) {
  let total = 0;
  for (const p of t.partes) total += p.litros;
  t.litros = redondear(total);
  t.libres = redondear(t.capacidad_l - t.litros);
  if (t.litros <= EPS) {
    t.partes = [];
    t.litros = 0;
    t.libres = t.capacidad_l;
    t.etapa = null;
    t.desde = null;
    t.ultima_entrada = null;
  }
}

function ordenar(movimientos) {
  return movimientos
    .map((mov, i) => ({ mov, i }))
    .sort((a, b) => {
      const ma = a.mov || {}, mb = b.mov || {};
      const porFecha = compararClaves(clave(ma.fecha), clave(mb.fecha));
      if (porFecha !== 0) return porFecha;
      const porAlta = compararClaves(clave(ma.created_at), clave(mb.created_at));
      if (porAlta !== 0) return porAlta;
      return a.i - b.i;
    });
}

// --- replay ------------------------------------------------------------------

/**
 * Replay the movement log over the tank catalog.
 * @returns {{estado: Object, aplicados: Array, avisos: Array, balance: Object}}
 *   estado    — per tank {codigo, capacidad_l, partes:[{lot_code, litros}], litros, libres, etapa, desde, ultima_entrada}
 *   aplicados — one entry per applied row, with the per-lote shares that actually moved
 *   avisos    — log inconsistencies (unknown tank, overdraw, overflow, junk row)
 *   balance   — {recibido_l, merma_l, salido_l, en_tanques_l, descuadre_l}; descuadre_l must be 0
 */
export function replayMovimientos(tanques, movimientos, opciones = {}) {
  const sinonimos = indiceSinonimos(opciones);
  const estado = {};
  for (const t of Array.isArray(tanques) ? tanques : []) {
    const codigo = texto(t && t.codigo);
    if (!codigo) continue;
    const cap = numero(t.capacidad_l);
    estado[codigo] = tanqueVacio(codigo, Number.isNaN(cap) ? 0 : cap);
  }
  const codigos = new Set(Object.keys(estado));
  const aplicados = [];
  const avisos = [];
  let recibido = 0, mermaTotal = 0, salido = 0;

  const avisar = (codigo, mensaje, mov, orden) => avisos.push({ codigo, mensaje, movimiento: mov, orden });

  for (const { mov, i } of ordenar(Array.isArray(movimientos) ? movimientos : [])) {
    if (!mov || typeof mov !== 'object') {
      avisar('fila_invalida', 'La fila del log no es un movimiento.', mov, i);
      continue;
    }
    if (mov.anulado) continue;

    const tipo = texto(mov.tipo);
    const refOrigen = texto(mov.origen);
    const refDestino = texto(mov.destino);
    const codOrigen = refOrigen ? resolver(refOrigen, codigos, sinonimos) : '';
    const codDestino = refDestino ? resolver(refDestino, codigos, sinonimos) : '';

    if (!codOrigen && !codDestino) {
      avisar('sin_tanques', 'El movimiento no indica tanque origen ni tanque destino.', mov, i);
      continue;
    }
    if (codOrigen && !estado[codOrigen]) {
      avisar('tanque_desconocido', `El tanque origen "${refOrigen}" no existe en el catalogo.`, mov, i);
      continue;
    }
    if (codDestino && !estado[codDestino]) {
      avisar('tanque_desconocido', `El tanque destino "${refDestino}" no existe en el catalogo.`, mov, i);
      continue;
    }
    if (codOrigen && codOrigen === codDestino) {
      avisar('mismo_tanque', `El origen y el destino son el mismo tanque (${codOrigen}).`, mov, i);
      continue;
    }
    const volumen = numero(mov.volumen_l);
    if (Number.isNaN(volumen) || volumen <= 0) {
      avisar('volumen_invalido', 'El volumen movido no es un numero mayor que cero.', mov, i);
      continue;
    }
    if (!fechaValida(mov.fecha)) avisar('sin_fecha', 'El movimiento no tiene una fecha valida (AAAA-MM-DD).', mov, i);

    const origen = codOrigen ? estado[codOrigen] : null;
    const destino = codDestino ? estado[codDestino] : null;

    // what leaves the origin, split proportionally over its lotes
    let movido = volumen;
    const salida = [];
    const etapaOrigen = origen ? origen.etapa : null; // recalcular() clears it when the tank empties
    if (origen) {
      const disponible = origen.litros;
      if (disponible <= EPS) {
        avisar('sobregiro', `El tanque origen ${codOrigen} esta vacio: no se puede mover ${fmtL(volumen)} L.`, mov, i);
        continue;
      }
      if (volumen > disponible + EPS) {
        avisar('sobregiro', `El movimiento saca ${fmtL(volumen)} L del tanque ${codOrigen}, que solo tiene ${fmtL(disponible)} L.`, mov, i);
        movido = disponible;
      }
      if (movido >= disponible - EPS) {
        movido = disponible;
        for (const p of origen.partes) salida.push({ lot_code: p.lot_code, litros: p.litros });
        origen.partes = [];
      } else {
        const cuotas = repartir(origen.partes.map(p => p.litros), movido);
        const quedan = [];
        origen.partes.forEach((p, k) => {
          const amt = cuotas[k];
          salida.push({ lot_code: p.lot_code, litros: amt });
          const resto = redondear(p.litros - amt);
          if (resto > EPS) quedan.push({ lot_code: p.lot_code, litros: resto });
        });
        origen.partes = quedan;
      }
      recalcular(origen);
    } else {
      salida.push({ lot_code: texto(mov.lot_code) || LOTE_SIN_CODIGO, litros: movido });
      if (!texto(mov.lot_code)) avisar('sin_lote', 'La entrada no indica codigo de lote.', mov, i);
    }

    // what arrives at the destination: the same split, less merma
    let merma = numero(mov.merma_l);
    merma = Number.isNaN(merma) ? 0 : Math.max(0, merma);
    if (merma > movido) {
      avisar('merma_excesiva', `La merma (${fmtL(merma)} L) es mayor que el volumen movido (${fmtL(movido)} L).`, mov, i);
      merma = movido;
    }
    const llegada = [];
    if (destino) {
      const antesVacio = destino.litros <= EPS;
      const etapaPrevia = destino.etapa;
      const cuotas = repartir(salida.map(p => p.litros), Math.max(0, redondear(movido - merma)));
      for (let k = 0; k < salida.length; k++) {
        const p = salida[k];
        const add = cuotas[k];
        if (add <= EPS) continue;
        llegada.push({ lot_code: p.lot_code, litros: add });
        const ex = destino.partes.find(x => x.lot_code === p.lot_code);
        if (ex) ex.litros = redondear(ex.litros + add);
        else destino.partes.push({ lot_code: p.lot_code, litros: add });
      }
      recalcular(destino);
      const fecha = fechaDia(mov.fecha) || null;
      if (llegada.length) {
        destino.ultima_entrada = fecha;
        if (antesVacio) destino.desde = fecha;
        const explicita = ETAPAS.includes(texto(mov.etapa)) ? texto(mov.etapa) : null;
        const porTipo = ETAPA_POR_TIPO[tipo] || null;
        // An occupied tank keeps its own stage: something arriving does not move the
        // wine already there back to recepcion. An empty one takes the stage the
        // movement type names, or the one that travels with the wine.
        if (explicita) destino.etapa = explicita;
        else if (antesVacio) destino.etapa = porTipo || etapaOrigen || null;
        else destino.etapa = etapaPrevia || porTipo || null;
      }
      if (destino.libres < -EPS) {
        avisar('desbordado', `El tanque ${codDestino} queda con ${fmtL(destino.litros)} L sobre una capacidad de ${fmtL(destino.capacidad_l)} L.`, mov, i);
      }
      mermaTotal += merma;
    } else if (merma > 0) {
      // Nothing arrives anywhere, so the merma is already inside the volume that
      // left: counting it again would double count the loss.
      avisar('merma_en_salida', `La merma (${fmtL(merma)} L) ya esta incluida en los ${fmtL(movido)} L que salen del tanque ${codOrigen}.`, mov, i);
      merma = 0;
    }

    if (!origen) recibido += movido;
    if (!destino) salido += movido;

    aplicados.push({
      orden: i,
      movimiento: mov,
      tipo,
      fecha: fechaDia(mov.fecha) || null,
      origen: codOrigen || null,
      destino: codDestino || null,
      movido_l: redondear(movido),
      merma_l: redondear(merma),
      llegado_l: redondear(llegada.reduce((a, p) => a + p.litros, 0)),
      salida_partes: salida.map(p => ({ lot_code: p.lot_code, litros: redondear(p.litros) })),
      llegada_partes: llegada.map(p => ({ lot_code: p.lot_code, litros: p.litros })),
    });
  }

  let enTanques = 0;
  for (const t of Object.values(estado)) enTanques += t.litros;
  const balance = {
    recibido_l: redondearTotal(recibido),
    merma_l: redondearTotal(mermaTotal),
    salido_l: redondearTotal(salido),
    en_tanques_l: redondearTotal(enTanques),
    descuadre_l: redondearTotal(recibido - mermaTotal - salido - enTanques),
  };
  return { estado, aplicados, avisos, balance };
}

/**
 * Current contents per tank, derived from the movement log.
 * @param {Array} tanques dim_tanque rows ({codigo, capacidad_l, ...})
 * @param {Array} movimientos movimientos_tanque rows
 * @param {Object} [opciones] {sinonimos: {alias: codigo}}
 * @returns {Object} keyed by codigo. Use replayMovimientos for avisos and balance.
 */
export function deriveEstado(tanques, movimientos, opciones = {}) {
  return replayMovimientos(tanques, movimientos, opciones).estado;
}

// --- validation --------------------------------------------------------------

/**
 * Validate a movement against the derived state. Returns Spanish error strings;
 * an empty array means the movement can be appended to the log.
 */
export function validarMovimiento(estado, mov, opciones = {}) {
  const errores = [];
  const tanques = estado && typeof estado === 'object' ? estado : {};
  const codigos = new Set(Object.keys(tanques));
  const sinonimos = indiceSinonimos(opciones);
  const m = mov && typeof mov === 'object' ? mov : {};

  const tipo = texto(m.tipo);
  if (!TIPOS.includes(tipo)) errores.push(`Tipo de movimiento no reconocido: "${tipo}".`);

  const refOrigen = texto(m.origen);
  const refDestino = texto(m.destino);
  const codOrigen = refOrigen ? resolver(refOrigen, codigos, sinonimos) : '';
  const codDestino = refDestino ? resolver(refDestino, codigos, sinonimos) : '';
  const origen = codOrigen && tanques[codOrigen] ? tanques[codOrigen] : null;
  const destino = codDestino && tanques[codDestino] ? tanques[codDestino] : null;

  if (refOrigen && !origen) errores.push(`El tanque origen "${refOrigen}" no existe en el catalogo.`);
  if (refDestino && !destino) errores.push(`El tanque destino "${refDestino}" no existe en el catalogo.`);
  if (codOrigen && codOrigen === codDestino) errores.push(`El origen y el destino son el mismo tanque (${codOrigen}).`);

  if (TIPOS.includes(tipo)) {
    if (SIN_ORIGEN.has(tipo)) {
      if (refOrigen) errores.push(`Una ${tipo} no lleva tanque origen.`);
      if (!refDestino) errores.push(`Una ${tipo} necesita un tanque destino.`);
      if (!texto(m.lot_code)) errores.push(`Una ${tipo} necesita un codigo de lote.`);
    } else if (SIN_DESTINO.has(tipo)) {
      if (refDestino) errores.push(`Una ${tipo} no lleva tanque destino.`);
      if (!refOrigen) errores.push(`Una ${tipo} necesita un tanque origen.`);
      if (numero(m.merma_l) > 0) errores.push(`Una ${tipo} no lleva merma: el volumen que sale ya la incluye.`);
    } else {
      if (!refOrigen) errores.push(`Un movimiento de tipo ${tipo} necesita un tanque origen.`);
      if (!refDestino) errores.push(`Un movimiento de tipo ${tipo} necesita un tanque destino.`);
    }
  }

  if (!fechaValida(m.fecha)) errores.push('El movimiento necesita una fecha valida (AAAA-MM-DD).');

  const etapa = texto(m.etapa);
  if (etapa && !ETAPAS.includes(etapa)) errores.push(`Etapa no reconocida: "${etapa}".`);

  const volumen = numero(m.volumen_l);
  const volumenOk = !Number.isNaN(volumen) && volumen > 0;
  if (!volumenOk) errores.push('El volumen movido debe ser mayor que cero.');

  let merma = numero(m.merma_l);
  if (Number.isNaN(merma)) merma = 0;
  if (merma < 0) errores.push('La merma no puede ser negativa.');
  else if (volumenOk && merma > volumen) {
    errores.push(`La merma (${fmtL(merma)} L) no puede ser mayor que el volumen movido (${fmtL(volumen)} L).`);
  }

  if (origen && volumenOk && codOrigen !== codDestino) {
    if (origen.litros <= EPS) errores.push(`El tanque origen ${codOrigen} esta vacio.`);
    else if (volumen > origen.litros + EPS) {
      errores.push(`El volumen a mover (${fmtL(volumen)} L) excede el contenido del tanque ${codOrigen} (${fmtL(origen.litros)} L).`);
    }
  }

  if (destino && volumenOk && codOrigen !== codDestino) {
    const llega = Math.max(0, volumen - Math.max(0, merma));
    const libres = redondear(destino.capacidad_l - destino.litros);
    if (!(destino.capacidad_l > 0)) {
      errores.push(`El tanque ${codDestino} no tiene capacidad registrada en el catalogo.`);
    } else if (llega > libres + EPS) {
      errores.push(`El volumen que llega (${fmtL(llega)} L) excede el espacio libre del tanque ${codDestino} (${fmtL(libres)} L).`);
    }
  }

  return errores;
}

/**
 * Validate a candidate movement AT ITS PLACE IN THE LOG, which is what the API
 * must use: `fecha` is a business date, so a backdated row is appended to the
 * table but applied in the middle of the replay. Checking it against the
 * current state would miss both its own effect at that moment and the rows
 * after it that it breaks.
 * @returns {string[]} Spanish error strings; empty means the row can be appended.
 */
export function validarMovimientoEnLog(tanques, movimientos, mov, opciones = {}) {
  const filas = (Array.isArray(movimientos) ? movimientos : [])
    .filter(m => m && typeof m === 'object' && !m.anulado);
  // the prefix is taken from the REPLAY order with the candidate in place, so a
  // row with the same fecha and created_at counts as before it exactly as the
  // replay will apply it. Filtering on a strict "happens before" test would drop
  // that row and judge the candidate against a tank that still looks empty.
  const orden = ordenar([...filas, mov]);
  const posicion = orden.findIndex(e => e.i === filas.length);
  const previas = orden.slice(0, posicion).map(e => e.mov);
  const errores = validarMovimiento(deriveEstado(tanques, previas, opciones), mov, opciones);

  // anything the candidate breaks downstream: compare the avisos of the log
  // without it against the avisos of the log with it appended
  const base = replayMovimientos(tanques, filas, opciones);
  const con = replayMovimientos(tanques, [...filas, mov], opciones);
  const previos = new Set(base.avisos.map(a => `${a.orden}|${a.codigo}`));
  for (const a of con.avisos) {
    if (a.movimiento === mov) {
      // the point-in-time check above is the authoritative report for the
      // candidate itself; this is the net that catches anything it misses
      if ((a.codigo === 'sobregiro' || a.codigo === 'desbordado') && !errores.length) errores.push(a.mensaje);
      continue;
    }
    if (previos.has(`${a.orden}|${a.codigo}`)) continue; // already inconsistent without this row
    const mensaje = `Este movimiento deja inconsistente un movimiento posterior: ${a.mensaje}`;
    if (!errores.includes(mensaje)) errores.push(mensaje);
  }
  return errores;
}

// --- history helpers ---------------------------------------------------------

/**
 * The movement rows that touch one tank, oldest first, each tagged with
 * direccion ('entrada' | 'salida') and delta_l (litres gained or lost).
 * Anulado rows are excluded unless opciones.incluirAnulados is true.
 */
export function historialTanque(movimientos, codigo, opciones = {}) {
  const sinonimos = indiceSinonimos(opciones);
  const objetivo = texto(codigo);
  if (!objetivo) return [];
  const alias = sinonimos && Object.prototype.hasOwnProperty.call(sinonimos, objetivo) ? texto(sinonimos[objetivo]) : '';
  const buscado = alias || objetivo;
  const codigos = new Set([buscado]);
  const filas = [];
  for (const { mov } of ordenar(Array.isArray(movimientos) ? movimientos : [])) {
    if (!mov || typeof mov !== 'object') continue;
    if (mov.anulado && !opciones.incluirAnulados) continue;
    const codOrigen = resolver(mov.origen, codigos, sinonimos);
    const codDestino = resolver(mov.destino, codigos, sinonimos);
    const esEntrada = codDestino === buscado;
    const esSalida = codOrigen === buscado;
    if (!esEntrada && !esSalida) continue;
    const volumen = numero(mov.volumen_l);
    const vol = Number.isNaN(volumen) ? 0 : volumen;
    let merma = numero(mov.merma_l);
    merma = Number.isNaN(merma) ? 0 : Math.max(0, merma);
    filas.push({
      ...mov,
      codigo: buscado,
      direccion: esEntrada ? 'entrada' : 'salida',
      delta_l: esEntrada ? redondear(Math.max(0, vol - merma)) : redondear(-vol),
    });
  }
  return filas;
}

/**
 * Where one lote has been and where its litres are now. Blended moves count the
 * lote's proportional share, so the steps add up to the litres in the tanks.
 */
export function recorridoLote(tanques, movimientos, lot_code, opciones = {}) {
  const lote = texto(lot_code);
  const { estado, aplicados } = replayMovimientos(tanques, movimientos, opciones);
  const pasos = [];
  let recibidos = 0;
  let merma = 0;
  let salidos = 0;
  for (const a of aplicados) {
    const parte = a.salida_partes.find(p => p.lot_code === lote);
    if (!parte || parte.litros <= EPS) continue;
    const llegada = a.llegada_partes.find(p => p.lot_code === lote);
    const llegado = llegada ? llegada.litros : 0;
    pasos.push({
      orden: a.orden,
      fecha: a.fecha,
      tipo: a.tipo,
      origen: a.origen,
      destino: a.destino,
      litros: parte.litros,
      llegado_l: redondear(llegado),
      merma_l: a.destino ? redondear(parte.litros - llegado) : 0,
      salido_l: a.destino ? 0 : parte.litros,
      fuente: a.movimiento.fuente ?? null,
      nota: a.movimiento.nota ?? null,
    });
    if (!a.origen) recibidos = redondear(recibidos + parte.litros);
    if (a.destino) merma = redondear(merma + (parte.litros - llegado));
    else salidos = redondear(salidos + parte.litros);
  }
  const tanques_actuales = [];
  let actuales = 0;
  for (const t of Object.values(estado)) {
    const p = t.partes.find(x => x.lot_code === lote);
    if (!p || p.litros <= EPS) continue;
    tanques_actuales.push({ codigo: t.codigo, litros: p.litros });
    actuales = redondear(actuales + p.litros);
  }
  return {
    lot_code: lote,
    pasos,
    tanques_actuales,
    litros_actuales: actuales,
    litros_recibidos: recibidos,
    litros_merma: merma,
    litros_salidos: salidos,
  };
}
