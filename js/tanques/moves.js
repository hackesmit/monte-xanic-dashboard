// js/tanques/moves.js - recording a movement from the Tanques tab.
//
// Bead xd-qrn.5. Two halves, and the split is the point:
//
//   PURE (exported, tested in tests/mt57-tanques-moves.test.mjs): what the
//   dialog proposes and what gets posted. Every decision a user could get wrong
//   about a movement - the default volume, the volume it will not exceed, the
//   lote and vendimia it derives, the exact body /api/tanques receives - is a
//   function of plain data here, so it is testable without a browser.
//
//   SHELL (TanquesMoves): the gestures and the DOM. Drag a tank onto another
//   tank, drag a lote from the tray onto a tank, or use "Modo mover" (two taps,
//   because dragging inside a plan that scrolls does not work on a phone). It
//   owns every write control it draws, so a viewer has none of them in the DOM
//   at all, and index.html needs no markup for a surface only role `lab` sees.
//
// No tank semantics live here. What a movement does to a tank is js/tanques/
// estado.js, and the client gate is literally the server's gate: the same
// validarMovimientoEnLog call api/tanques.js makes, so the dialog refuses what
// the server would refuse, in the same words, before the request leaves.
// The server is still the authority: this only saves a round trip.
//
// Writes go through DataStore.postMovimiento / anularMovimiento, which report
// THREE outcomes, not two (lucy, 2026-10-15): written, refused, and
// indeterminate. Treating the third as refused is what makes someone record the
// same trasiego twice, so it is shown as "no confirmado, revise la bitacora"
// with a retry that reuses the same client_id.

import { DataStore } from '../dataLoader.js';
import { DemoMode } from '../demoMode.js';
import { escapeHtml, todayInVineyard } from '../utils.js';
import { validarMovimientoEnLog } from './estado.js';
import { variedadDeLote, tokenVariedad, fechaCorta } from './plan.js';

// --- labels ------------------------------------------------------------------

// Spanish movement-type labels, shared with the read-only history in view.js so
// the timeline and the dialog cannot drift apart.
export const ETIQUETA_TIPO = {
  recepcion: 'Recepción',
  trasiego: 'Trasiego',
  descube: 'Descube',
  sangrado: 'Sangrado',
  prensa: 'Prensa',
  ensamble: 'Ensamble',
  salida: 'Salida',
};

/** A movement type's Spanish label; an unknown type is shown verbatim. */
export function etiquetaMovimiento(tipo) {
  const t = typeof tipo === 'string' ? tipo.trim() : '';
  return ETIQUETA_TIPO[t] || t || 'Movimiento';
}

// --- pure helpers ------------------------------------------------------------

// Exactly the fields a client may put on a new movement: api/tanques.js refuses
// anything else BY NAME rather than dropping it, and `client_id` belongs to
// DataStore.postMovimiento (one key per user intent, reused on a retry).
export const CAMPOS_ENVIADOS = [
  'fecha', 'tipo', 'origen', 'destino', 'lot_code',
  'vintage_year', 'volumen_l', 'merma_l', 'nota', 'fuente',
];

// A tank-to-tank gesture can be any of these. `recepcion` is excluded because
// it carries no origin and `salida` because it carries no destination: the
// server refuses both for a gesture that named two tanks.
const TIPOS_ENTRE_TANQUES = ['trasiego', 'ensamble', 'descube', 'sangrado', 'prensa'];

// The window the movimientos_tanque CHECK accepts.
const VENDIMIA_MIN = 1988;
const VENDIMIA_MAX = 2100;

const texto = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const propio = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Litres, truncated to the millilitre. Truncated and not rounded on purpose:
// every number this produces is a proposal bounded by what a tank holds or has
// free, and rounding up would propose a volume the server then refuses.
function mili(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v * 1000) / 1000;
}

const fmtL = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return (Math.round(v * 10) / 10).toLocaleString('es-MX');
};

// A form field as a number. A blank field is NOT zero (the caller decides what
// an empty volume means) and junk stays NaN so the validator reports it instead
// of a silent zero reaching the log.
function numeroDeCampo(v) {
  if (typeof v === 'number') return v;
  const t = texto(v);
  if (t === '') return NaN;
  return Number(t);
}

function enteroDeCampo(v) {
  const n = numeroDeCampo(v);
  return Number.isInteger(n) ? n : null;
}

// Resolve a tank reference against the derived state, then dim_tanque_sinonimo,
// the way js/tanques/estado.js does: production writes PD1 for PD-1 and I4 for
// I-4 CAVA, and both columns have a foreign key to the canonical codigo.
function canonico(ref, estado, sinonimos) {
  const t = texto(ref);
  if (!t || propio(estado, t)) return t;
  const alias = sinonimos && propio(sinonimos, t) ? texto(sinonimos[t]) : '';
  return alias && propio(estado, alias) ? alias : t;
}

/**
 * The vendimia a lot code belongs to.
 *
 * The code itself is the house rule ('25CSKMP-1' is 2025, see CLAUDE.md), and
 * it is tried first because it is the statement the bodega wrote on the barrel.
 * Only when the code is silent does the log answer, and then with the greatest
 * vendimia any live row gives that lote, so the answer does not depend on the
 * order the rows happen to arrive in. Returns null when neither says.
 */
export function vendimiaDeLote(lot_code, movimientos = []) {
  const codigo = texto(lot_code);
  if (!codigo) return null;
  const m = /^(\d{2})/.exec(codigo);
  if (m) {
    const y = 2000 + Number(m[1]);
    // The same window js/upload/seguimiento.js reads a prefix in: a two-digit
    // prefix cannot mean 2099, and a code starting '99' is not a vendimia.
    if (y >= 2015 && y <= 2040) return y;
  }
  let mejor = null;
  for (const mov of Array.isArray(movimientos) ? movimientos : []) {
    if (!mov || mov.anulado) continue;
    if (texto(mov.lot_code) !== codigo) continue;
    const y = Number(mov.vintage_year);
    if (!Number.isInteger(y) || y < VENDIMIA_MIN || y > VENDIMIA_MAX) continue;
    if (mejor === null || y > mejor) mejor = y;
  }
  return mejor;
}

/**
 * How to label a movement coming OUT of a tank.
 *
 * A move out of a tank takes every lote in it proportionally - you cannot pump
 * one lote out of a blend - so `lot_code` on a row with an origin is only a
 * label (js/tanques/estado.js). The label is the majority lote by litres, which
 * is one of the two answers SPEC open question 3 leaves open, and `mezcla` tells
 * the dialog to say out loud that the whole blend travels.
 * @returns {{lot_code:string, vintage_year:number|null, mezcla:boolean, partes:Array}}
 */
export function loteDeOrigen(tanque, movimientos = []) {
  const partes = (tanque && Array.isArray(tanque.partes) ? tanque.partes : [])
    .map((p) => ({ lot_code: texto(p && p.lot_code), litros: Number(p && p.litros) || 0 }));
  let mayor = null;
  for (const p of partes) if (!mayor || p.litros > mayor.litros) mayor = p;
  const lot_code = mayor ? mayor.lot_code : '';
  return {
    lot_code,
    vintage_year: lot_code ? vendimiaDeLote(lot_code, movimientos) : null,
    mezcla: partes.length > 1,
    partes,
  };
}

/**
 * Everything the move dialog opens with, derived from the gesture and the
 * bodega as the log currently derives it.
 *
 * @param {Object} gesto {origen, destino, lote:{lot_code,vintage_year}, tipo:'salida'}
 *   - origen + destino  : a movement between two tanks (drag, or two taps)
 *   - destino + lote    : a recepcion assigning a tray lote to a tank
 *   - origen + tipo salida: wine leaving the bodega (bottling)
 * @param {Object} bodega {catalogo, movimientos, sinonimos, estado} (view.js._bodega)
 * @returns {Object} the dialog model; `puedeRegistrar` false means the gesture
 *   cannot become a movement at all and the dialog only explains why.
 */
export function planearMovimiento(gesto = {}, bodega = {}) {
  const estado = bodega && bodega.estado && typeof bodega.estado === 'object' ? bodega.estado : {};
  const movimientos = Array.isArray(bodega.movimientos) ? bodega.movimientos : [];
  const sinonimos = bodega.sinonimos || {};

  const lote = gesto && gesto.lote ? gesto.lote : null;
  const refOrigen = texto(gesto && gesto.origen);
  const esSalida = texto(gesto && gesto.tipo) === 'salida';
  const refDestino = esSalida ? '' : texto(gesto && gesto.destino);
  const clase = esSalida ? 'salida' : (lote && !refOrigen ? 'recepcion' : 'movimiento');

  const codOrigen = refOrigen ? canonico(refOrigen, estado, sinonimos) : '';
  const codDestino = refDestino ? canonico(refDestino, estado, sinonimos) : '';
  const origen = codOrigen && propio(estado, codOrigen) ? estado[codOrigen] : null;
  const destino = codDestino && propio(estado, codDestino) ? estado[codDestino] : null;

  const avisos = [];
  const avisar = (clave, nivel, texto_) => avisos.push({ clave, nivel, texto: texto_ });

  const etiqueta = clase === 'recepcion' ? loteDeTray(lote, movimientos) : loteDeOrigen(origen, movimientos);
  const modelo = {
    clase,
    gesto,
    titulo: clase === 'recepcion' ? 'Asignar lote a tanque'
      : clase === 'salida' ? 'Registrar salida' : 'Registrar trasiego',
    tipos: clase === 'recepcion' ? ['recepcion'] : clase === 'salida' ? ['salida'] : [...TIPOS_ENTRE_TANQUES],
    tipo: clase === 'recepcion' ? 'recepcion' : clase === 'salida' ? 'salida' : 'trasiego',
    origen: origen ? origen.codigo : null,
    destino: destino ? destino.codigo : null,
    origen_partes: origen ? origen.partes.map((p) => ({ ...p })) : [],
    destino_partes: destino ? destino.partes.map((p) => ({ ...p })) : [],
    capacidad_destino_l: destino ? destino.capacidad_l : null,
    lot_code: etiqueta.lot_code,
    vintage_year: etiqueta.vintage_year,
    mezcla_origen: etiqueta.mezcla,
    disponible_l: clase === 'recepcion' ? null : (origen ? mili(origen.litros) : null),
    libres_l: clase === 'salida' ? null : (destino ? Math.max(0, mili(destino.libres)) : null),
    maximo_l: 0,
    volumen_l: null,
    merma_l: 0,
    pideMerma: clase !== 'salida',
    fecha: todayInVineyard(),
    // A business date in the past is normal (recording yesterday's trasiego);
    // one in the future would be applied ahead of everything in the replay.
    fecha_maxima: todayInVineyard(),
    avisos,
    puedeRegistrar: false,
  };

  // The gesture itself, before any volume: a reference that resolves to nothing
  // is reported by name rather than drawn as a movement.
  if (refOrigen && !origen) {
    avisar('desconocido', 'error', `El tanque origen "${refOrigen}" no existe en el catálogo.`);
  }
  if (refDestino && !destino) {
    avisar('desconocido', 'error', `El tanque destino "${refDestino}" no existe en el catálogo.`);
  }
  if (clase === 'recepcion' && !etiqueta.lot_code) {
    avisar('sin_lote', 'error', 'Una recepción necesita un código de lote.');
  }
  if (clase === 'recepcion' && !destino) {
    if (!refDestino) avisar('sin_destino', 'error', 'Elija el tanque que recibe el lote.');
  } else if (clase === 'salida') {
    if (!origen) avisar('sin_origen', 'error', 'Elija el tanque del que sale el vino.');
  } else if (clase === 'movimiento') {
    if (!refOrigen) avisar('sin_origen', 'error', 'Elija el tanque origen.');
    if (!refDestino) avisar('sin_destino', 'error', 'Elija el tanque destino.');
    if (origen && destino && origen.codigo === destino.codigo) {
      avisar('mismo_tanque', 'error', `El origen y el destino son el mismo tanque (${origen.codigo}).`);
    }
  }
  if (avisos.length) return modelo;

  // What the origin can send and what the destination can take.
  if (clase !== 'recepcion' && modelo.disponible_l <= 0) {
    avisar('vacio', 'error', `${origen.codigo} está vacío. No hay vino que mover.`);
  }
  if (clase !== 'salida' && modelo.libres_l <= 0) {
    avisar('sin_espacio', 'error',
      `${destino.codigo} está lleno (${fmtL(destino.litros)} de ${fmtL(destino.capacidad_l)} L). `
      + 'No cabe más vino.');
  }
  if (avisos.length) {
    modelo.maximo_l = 0;
    return modelo;
  }

  modelo.maximo_l = maximoVolumen(modelo, 0);
  modelo.volumen_l = clase === 'recepcion'
    // Nothing in the data says how many litres arrived: the Recepción de Tanque
    // sheet records kilos of grape, not litres of must, and a yield factor
    // invented here would enter the ledger as a measurement. The dialog asks.
    ? null
    : modelo.maximo_l;
  modelo.puedeRegistrar = true;

  if (clase === 'movimiento' && modelo.destino_partes.length) {
    modelo.tipo = 'ensamble';
    modelo.titulo = 'Ensamble';
    avisar('mezcla', 'info', `${destino.codigo} ya tiene vino. Esto registra una mezcla `
      + 'y guarda la composición por volumen.');
  }
  if (clase === 'recepcion' && modelo.destino_partes.length) {
    avisar('mezcla', 'info', `${destino.codigo} ya tiene vino. El lote se suma a lo que hay `
      + 'y la composición queda por volumen.');
  }
  if (clase === 'movimiento' && modelo.disponible_l > modelo.libres_l) {
    avisar('excede', 'aviso', `El volumen de origen (${fmtL(modelo.disponible_l)} L) excede el `
      + `espacio libre de ${destino.codigo} (${fmtL(modelo.libres_l)} L). Se moverá solo una parte.`);
  }
  if (modelo.mezcla_origen) {
    const otros = modelo.origen_partes.map((p) => p.lot_code).filter((c) => c !== modelo.lot_code);
    avisar('proporcional', 'info', `${origen.codigo} tiene una mezcla: el movimiento se lleva `
      + `${[modelo.lot_code, ...otros].join(' y ')} en proporción a sus litros. `
      + `Se registra con el lote mayoritario, ${modelo.lot_code}.`);
  }
  return modelo;
}

// A tray chip states its own lote and vendimia (it comes from the wine samples);
// the log is only the fallback for a code that carries no vintage of its own.
function loteDeTray(lote, movimientos) {
  const lot_code = texto(lote && lote.lot_code);
  const propia = Number(lote && lote.vintage_year);
  const vintage_year = Number.isInteger(propia) && propia >= VENDIMIA_MIN && propia <= VENDIMIA_MAX
    ? propia
    : vendimiaDeLote(lot_code, movimientos);
  return { lot_code, vintage_year, mezcla: false, partes: [] };
}

/**
 * The largest volume this movement may carry, given the merma typed into the
 * dialog. Merma is subtracted from what ARRIVES (estado.js), so 300 L of loss
 * lets 300 L more leave the origin without overflowing the destination; a fixed
 * `max` would refuse a legal move as soon as the user records a loss.
 */
export function maximoVolumen(modelo, merma_l) {
  const merma = Math.max(0, Number(merma_l) || 0);
  // null means "this end does not bound the volume" (a recepcion has no origin,
  // a salida no destination), and Number(null) is 0, which would bound it to
  // nothing at all.
  const cifra = (v) => (v == null ? null : Number(v));
  const disponible = cifra(modelo && modelo.disponible_l);
  const libres = cifra(modelo && modelo.libres_l);
  const topes = [];
  if (disponible !== null && Number.isFinite(disponible)) topes.push(disponible);
  if (libres !== null && Number.isFinite(libres)) topes.push(libres + merma);
  if (!topes.length) return 0;
  return mili(Math.min(...topes));
}

/**
 * The body /api/tanques receives: exactly CAMPOS_ENVIADOS, nothing else.
 * The dialog's inputs are strings, so every number is coerced here, once, and a
 * value that is not a number stays NaN for the validator to report.
 */
export function movimientoDesdeFormulario(modelo = {}, valores = {}) {
  const tipos = Array.isArray(modelo.tipos) && modelo.tipos.length ? modelo.tipos : ['trasiego'];
  const pedido = texto(valores.tipo);
  // A type outside what the gesture allows is not an instruction, it is a stale
  // or tampered form: fall back to what the model proposed.
  const tipo = tipos.includes(pedido) ? pedido : (tipos.includes(modelo.tipo) ? modelo.tipo : tipos[0]);
  const vendimia = enteroDeCampo(valores.vintage_year);
  const nota = texto(valores.nota);
  const mermaCampo = texto(valores.merma_l);
  return {
    fecha: texto(valores.fecha) || texto(modelo.fecha),
    tipo,
    origen: modelo.origen || null,
    destino: modelo.destino || null,
    lot_code: texto(modelo.lot_code),
    vintage_year: vendimia === null
      ? (Number.isInteger(modelo.vintage_year) ? modelo.vintage_year : null)
      : vendimia,
    volumen_l: numeroDeCampo(valores.volumen_l),
    // A salida carries no merma of its own: the loss is already inside the
    // volume that left, and the column has a CHECK saying so.
    merma_l: tipo === 'salida' ? 0 : (mermaCampo === '' ? 0 : numeroDeCampo(valores.merma_l)),
    nota: nota || null,
    fuente: 'manual',
  };
}

/**
 * The client gate, which is the server's gate: the same call api/tanques.js
 * makes, on the same pure module, so a movement refused here would have been
 * refused there, in the same Spanish words.
 * @returns {string[]} empty means the row can be appended.
 */
export function erroresDeMovimiento(bodega = {}, mov) {
  return [
    ...erroresDeFormulario(mov),
    ...validarMovimientoEnLog(
      bodega.catalogo || [],
      bodega.movimientos || [],
      mov,
      { sinonimos: bodega.sinonimos || {} },
    ),
  ];
}

/**
 * The completeness checks the pure module does not make because they belong to
 * the COLUMN rather than to the tank: movimientos_tanque has lot_code NOT NULL
 * with a non-blank CHECK and vintage_year NOT NULL between 1988 and 2100, and
 * api/tanques.js refuses a body that misses either (revisarCampos). Said here
 * in the same words so an incomplete form is answered by the dialog instead of
 * by a round trip. The dialog carries `novalidate`: the browser's own bubble
 * would speak the browser's language, not the bodega's.
 */
export function erroresDeFormulario(mov) {
  const m = mov && typeof mov === 'object' ? mov : {};
  const errores = [];
  if (!texto(m.lot_code)) errores.push('El movimiento necesita un código de lote.');
  const v = Number(m.vintage_year);
  if (!Number.isInteger(v) || v < VENDIMIA_MIN || v > VENDIMIA_MAX) {
    errores.push(`La vendimia debe ser un año entre ${VENDIMIA_MIN} y ${VENDIMIA_MAX}.`);
  }
  return errores;
}

const esBerry = (fila) => {
  const t = texto(fila && fila.sampleType).toLowerCase();
  return t === 'berries' || t === 'berry';
};

const diaDeMuestra = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  return texto(v).slice(0, 10);
};

/**
 * The lotes the bodega knows about and the log does not place: the tray a user
 * drags onto a tank.
 *
 * Source is the wine samples the dashboard already loaded (berry rows are
 * grapes in the field, not wine in a tank), narrowed to the NEWEST vendimia
 * present, because those are the lotes being moved right now and the full
 * history is 300 codes nobody can scan. A lote any live movement names is
 * already placed, even if it has since left the bodega; an annulled row names
 * nothing. This is not the lab inference of the SPEC (that proposes trasiegos
 * from vessel_id and is a bead of its own): nothing here proposes a tank.
 * @returns {Array<{lot_code, vintage_year, fecha, variedad}>} newest sample first
 */
export function lotesSinTanque(muestras, movimientos) {
  const filas = (Array.isArray(muestras) ? muestras : []).filter((r) => r && !esBerry(r));
  const colocados = new Set();
  for (const m of Array.isArray(movimientos) ? movimientos : []) {
    if (!m || m.anulado) continue;
    const c = texto(m.lot_code);
    if (c) colocados.add(c);
  }

  let vendimia = null;
  for (const r of filas) {
    const v = Number(r.vintage);
    if (Number.isInteger(v) && (vendimia === null || v > vendimia)) vendimia = v;
  }
  if (vendimia === null) return [];

  const porLote = new Map();
  for (const r of filas) {
    if (Number(r.vintage) !== vendimia) continue;
    const lot_code = texto(r.codigoBodega);
    if (!lot_code || colocados.has(lot_code)) continue;
    const fecha = diaDeMuestra(r.fecha);
    const previo = porLote.get(lot_code);
    // The most recent sample is what the chip shows: it is the last time anyone
    // reported on that lote, which is the only date the samples can give.
    if (previo && previo.fecha >= fecha) continue;
    porLote.set(lot_code, {
      lot_code,
      vintage_year: vendimia,
      fecha,
      variedad: texto(r.variedad) || null,
    });
  }
  // A plain YYYY-MM-DD business date, so a string compare IS a date compare
  // (unlike the timestamps the replay orders on, see estado.js).
  return [...porLote.values()].sort((a, b) =>
    (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.lot_code.localeCompare(b.lot_code, 'es')));
}

// --- the shell ---------------------------------------------------------------

const ID = {
  mover: 'tanques-mover',
  bandeja: 'tanques-lotes-bandeja',
  pendiente: 'tanques-pendiente',
  destino: 'tanques-destino',
  destinoSel: 'tanques-destino-sel',
  ayuda: 'tanques-ayuda',
  chips: 'tanques-lotes',
  dialogo: 'tanques-dialogo',
  toast: 'tanques-toast',
  titulo: 'tanques-dialogo-titulo',
};

// How many chips the tray draws before it collapses into a count. The search
// box filters the tray, so the rest stays reachable without a wall of chips.
const CHIPS_MAX = 12;
// Where the unconfirmed writes survive a reload. The payload is a movement,
// never a credential.
const CLAVE_PENDIENTES = 'xanic_tanques_pendientes';
const PENDIENTES_MAX = 20;
const TOAST_MS = 12_000;    // long enough to read it and press Deshacer
const ARRASTRE_PX = 6;      // below this a pointer gesture is a tap, not a drag

export const TanquesMoves = {
  modoMover: false,
  _ctx: null,
  _wired: false,
  _armado: null,        // {codigo} | {lote} - the origin a tap armed
  _arrastre: null,
  _fantasma: null,
  _pendiente: null,     // the open dialog's model
  _enviando: false,
  // Writes with no definite outcome, keyed by client_id and kept until they
  // get one. Three things make this a persisted LIST and not a variable:
  // the toast times out, a second unconfirmed write would overwrite the
  // first, and a reload would drop the key altogether - and every one of
  // those ends with the user retyping the movement under a NEW key, which
  // the server accepts as a second row (lucy, 2026-10-15).
  _pendientes: [],
  _pendientesLeidos: false,
  _temporizador: null,
  _trasDrag: false,     // a click is pending behind a drop; it is not a tap

  /** Called by TanquesView.mount(). Idempotent. */
  mount(ctx) {
    if (ctx) this._ctx = ctx;
    if (!this._ctx || typeof document === 'undefined') return;
    this._wire();
  },

  /** The tank armed as an origin, so view.js can mark it on the plan. */
  origenArmado() {
    return this._armado && this._armado.codigo ? this._armado.codigo : null;
  },

  /** Called at the end of every TanquesView.render(). */
  pintar() {
    if (!this._ctx) return;
    if (!this._puedeEscribir()) {
      this._desarmar();
      this.modoMover = false;
      this._quitarChrome();
      return;
    }
    // One replay for the whole repaint: _bodega() derives every tank from the
    // log, and render() has already paid for that once.
    const bodega = this._ctx.bodega();
    this._cargarPendientes();
    this._revisarPendientes();
    this._chrome();
    this._pintarBoton();
    this._pintarPendiente();
    this._pintarDestino(bodega);
    this._pintarBandeja(bodega);
    this._pintarAcciones(bodega);
    this._pintarAnular();
  },

  // --- unconfirmed writes -----------------------------------------------------

  _cargarPendientes() {
    if (this._pendientesLeidos) return;
    this._pendientesLeidos = true;
    try {
      const crudo = typeof localStorage !== 'undefined' && localStorage
        ? localStorage.getItem(CLAVE_PENDIENTES) : '';
      const lista = crudo ? JSON.parse(crudo) : [];
      this._pendientes = Array.isArray(lista)
        ? lista.filter((p) => p && p.intento && typeof p.intento.client_id === 'string')
          .slice(-PENDIENTES_MAX)
        : [];
    } catch (_) {
      this._pendientes = [];
    }
  },

  _guardarPendientes() {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return;
      if (this._pendientes.length) {
        localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(this._pendientes.slice(-PENDIENTES_MAX)));
      } else {
        localStorage.removeItem(CLAVE_PENDIENTES);
      }
    } catch (_) { /* a full or blocked store must not stop the write */ }
  },

  // Recorded BEFORE the request leaves, so a browser that dies mid-flight
  // still knows which key to retry with.
  _anotarPendiente(intento, mensaje) {
    const clave = String(intento.client_id).toLowerCase();
    const i = this._pendientes.findIndex((p) => String(p.intento.client_id).toLowerCase() === clave);
    if (i >= 0) this._pendientes[i] = { intento, mensaje };
    else this._pendientes.push({ intento, mensaje });
    this._guardarPendientes();
  },

  // Resolve ONE entry by its key: a retry's callback must never clear someone
  // else's pending write.
  _resolverPendiente(client_id) {
    const clave = String(client_id || '').toLowerCase();
    const quedan = this._pendientes.filter((p) => String(p.intento.client_id).toLowerCase() !== clave);
    if (quedan.length === this._pendientes.length) return;
    this._pendientes = quedan;
    this._guardarPendientes();
  },

  // A key that is now in the log landed after all: the log is the answer, so
  // the banner goes without anyone retrying anything.
  _revisarPendientes() {
    if (!this._pendientes.length) return;
    const log = Array.isArray(DataStore.movimientosTanque) ? DataStore.movimientosTanque : [];
    const vistos = new Set();
    for (const m of log) {
      if (m && typeof m.client_id === 'string') vistos.add(m.client_id.toLowerCase());
    }
    const quedan = this._pendientes.filter(
      (p) => !vistos.has(String(p.intento.client_id).toLowerCase()));
    if (quedan.length === this._pendientes.length) return;
    this._pendientes = quedan;
    this._guardarPendientes();
    this._avisar('Un movimiento sin confirmar sí quedó registrado. La bitácora ya lo muestra.');
  },

  // --- permissions ----------------------------------------------------------

  // Writes are role `lab` and api/tanques.js is the authority; this only decides
  // whether the controls are drawn. The role is read off the class Auth keeps on
  // <body> rather than by importing Auth, which would pull app.js and events.js
  // into this module's import graph and make it unloadable outside a browser.
  // Demo mode owns the data layer and refuses tank reads, so there is nothing
  // real to write against while it is on.
  _puedeEscribir() {
    if (typeof document === 'undefined' || !document.body) return false;
    if (DemoMode.isActive()) return false;
    return document.body.classList.contains('can-write');
  },

  // --- chrome ---------------------------------------------------------------

  _chrome() {
    const barra = document.querySelector('#view-tanques .tanques-toolbar');
    if (barra && !document.getElementById(ID.mover)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = ID.mover;
      b.className = 'tanques-mover';
      b.setAttribute('aria-pressed', 'false');
      b.textContent = 'Modo mover';
      b.title = 'Toque el tanque origen y luego el destino';
      barra.appendChild(b);
    }
    const tarjeta = document.querySelector('#view-tanques .tanques-plan-card');
    if (tarjeta && !document.getElementById(ID.ayuda)) {
      const p = document.createElement('p');
      p.className = 'tanques-hint';
      p.id = ID.ayuda;
      p.textContent = 'Arrastre un tanque sobre otro para registrar un trasiego, '
        + 'o un lote de la bandeja hasta un tanque para asignarlo. '
        + 'En el teléfono use Modo mover: toque el origen y luego el destino.';
      tarjeta.insertBefore(p, tarjeta.querySelector('.tanques-tray') || null);
    }
    if (tarjeta && !document.getElementById(ID.bandeja)) {
      const otras = tarjeta.querySelector('.tanques-tray');
      const caja = document.createElement('div');
      caja.className = 'tanques-tray';
      caja.id = ID.bandeja;
      caja.innerHTML = '<h3>Lotes sin tanque</h3>'
        + `<div class="tanques-chips" id="${ID.chips}"></div>`;
      tarjeta.insertBefore(caja, otras || null);
    }
  },

  _quitarChrome() {
    for (const id of [ID.mover, ID.bandeja, ID.ayuda, ID.pendiente, ID.destino]) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
    const dlg = document.getElementById(ID.dialogo);
    if (dlg && dlg.open) dlg.close();
  },

  _pintarBoton() {
    const b = document.getElementById(ID.mover);
    if (!b) return;
    b.setAttribute('aria-pressed', String(this.modoMover));
    b.classList.toggle('on', this.modoMover);
  },

  // The unconfirmed write, as a banner that survives a re-render and a toast
  // timeout. It is deliberately not blocking: another movement is a different
  // intent and must still be recordable.
  _pintarPendiente() {
    const tarjeta = document.querySelector('#view-tanques .tanques-plan-card');
    const previo = document.getElementById(ID.pendiente);
    if (!tarjeta || !this._pendientes.length) { if (previo) previo.remove(); return; }
    const caja = previo || document.createElement('div');
    caja.id = ID.pendiente;
    caja.className = 'tanques-pendiente';
    caja.setAttribute('role', 'status');
    caja.innerHTML = this._pendientes.map(({ intento, mensaje }) => {
      const clave = escapeHtml(intento.client_id);
      const donde = `${intento.origen || 'bandeja'} a ${intento.destino || 'fuera de bodega'}`;
      return '<div class="tanques-alert err">'
        + `<div>${escapeHtml(mensaje)}</div>`
        + `<div class="tanques-p-sub">${escapeHtml(etiquetaMovimiento(intento.tipo))} `
        + `${escapeHtml(intento.lot_code)}, ${fmtL(intento.volumen_l)} L, ${escapeHtml(donde)}, `
        + `${escapeHtml(intento.fecha)}.</div>`
        + '<div class="tanques-acciones">'
        + `<button type="button" class="tanques-btn" data-pendiente="reintentar" data-clave="${clave}">`
        + 'Reintentar</button>'
        + `<button type="button" class="tanques-btn" data-pendiente="descartar" data-clave="${clave}">`
        + 'Ya la revisé</button>'
        + '</div></div>';
    }).join('');
    if (!previo) tarjeta.insertBefore(caja, tarjeta.firstChild);
  },

  // Any vessel in the catalog as a destination, by name. The tray groups the
  // empty tibores, Domecq tanks and kegs into one chip each (there are 39 of
  // them and one chip per vessel would bury the plan), and a group chip names
  // no single vessel, so without this they could be read and never filled
  // (lucy, 2026-10-15). It doubles as the keyboard path to a far destination.
  _pintarDestino(bodega) {
    const tarjeta = document.querySelector('#view-tanques .tanques-plan-card');
    const previo = document.getElementById(ID.destino);
    const origen = this._armado;
    if (!tarjeta || !origen) { if (previo) previo.remove(); return; }
    const desde = origen.codigo || (origen.lote && origen.lote.lot_code) || '';
    const caja = previo || document.createElement('div');
    const mismo = previo && previo.dataset.desde === desde;
    caja.id = ID.destino;
    caja.className = 'tanques-destino';
    caja.dataset.desde = desde;
    if (mismo) return;   // keep what the user already picked in the select
    const opciones = (bodega.catalogo || [])
      .map((t) => (typeof t.codigo === 'string' ? t.codigo.trim() : ''))
      .filter((c) => c && c !== origen.codigo)
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)
      .join('');
    caja.innerHTML = `<label class="tanques-campo" for="${ID.destinoSel}">`
      + `Destino de ${escapeHtml(desde)}`
      + `<select id="${ID.destinoSel}">${opciones}</select></label>`
      + '<div class="tanques-acciones">'
      + '<button type="button" class="tanques-btn primary" data-destino="usar">Usar este destino</button>'
      + '<button type="button" class="tanques-btn" data-destino="cancelar">Cancelar</button>'
      + '</div>';
    if (!previo) tarjeta.insertBefore(caja, tarjeta.firstChild);
  },

  _pintarBandeja(bodega) {
    const el = document.getElementById(ID.chips);
    if (!el) return;
    const q = (this._ctx.busqueda && this._ctx.busqueda()) || '';
    const todos = lotesSinTanque(DataStore.wineRecepcion, bodega.movimientos);
    const lotes = q ? todos.filter((l) => l.lot_code.toLowerCase().includes(q)) : todos;
    if (!lotes.length) {
      el.innerHTML = todos.length
        ? '<span class="tanques-hint">Ningún lote sin tanque coincide con la búsqueda.</span>'
        : '<span class="tanques-hint">Todos los lotes conocidos están en un tanque.</span>';
      return;
    }
    const visibles = lotes.slice(0, CHIPS_MAX);
    const resto = lotes.length - visibles.length;
    el.innerHTML = visibles.map((l) => {
      const armado = !!(this._armado && this._armado.lote && this._armado.lote.lot_code === l.lot_code);
      const nombre = variedadDeLote(l.lot_code);
      return `<button type="button" class="tanques-chip tanques-lote${armado ? ' cur' : ''}"`
        + ` data-lote="${escapeHtml(l.lot_code)}" aria-pressed="${armado}">`
        + `<i style="width:8px;height:8px;border-radius:var(--radius-round);`
        + `background:var(${tokenVariedad(nombre)})"></i>`
        + `${escapeHtml(l.lot_code)} <small>${escapeHtml(fechaCorta(l.fecha) || 'sin fecha')}</small>`
        + '</button>';
    }).join('')
      + (resto > 0 ? `<span class="tanques-chip">y ${resto} más <small>use la búsqueda</small></span>` : '');
  },

  _pintarAcciones(bodega) {
    const panel = document.getElementById('tanques-panel');
    if (!panel) return;
    const previo = panel.querySelector('.tanques-acciones');
    if (previo) previo.remove();
    const cabeza = panel.querySelector('.tanques-p-head');
    if (!cabeza) return;   // the panel is a hint, not a vessel
    const codigo = this._ctx.seleccion();
    const est = bodega.estado[codigo];
    if (!est) return;
    const conVino = (est.litros || 0) > 0;
    const armado = this.origenArmado() === codigo;
    const caja = document.createElement('div');
    caja.className = 'tanques-acciones';
    if (conVino) {
      caja.innerHTML = `<button type="button" class="tanques-btn${armado ? ' on' : ''}"`
        + ` data-accion="mover" aria-pressed="${armado}">`
        + `${armado ? 'Toque el tanque destino' : 'Mover a otro tanque'}</button>`
        + '<button type="button" class="tanques-btn" data-accion="salida">Registrar salida</button>';
    } else {
      caja.innerHTML = '<p class="tanques-hint">Arrastre un lote de la bandeja hasta este tanque, '
        + 'o toque un lote y luego el tanque.</p>';
    }
    cabeza.insertAdjacentElement('afterend', caja);
  },

  _pintarAnular() {
    const panel = document.getElementById('tanques-panel');
    if (!panel) return;
    for (const li of panel.querySelectorAll('.tanques-timeline li[data-mov]')) {
      if (li.classList.contains('anulado') || li.querySelector('[data-anular]')) continue;
      const cuerpo = li.lastElementChild;
      if (!cuerpo) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tanques-anular';
      b.dataset.anular = li.dataset.mov;
      b.textContent = 'Anular';
      // Eight buttons reading "Anular" are one button to a screen reader: the
      // row's own text is what tells them apart.
      b.setAttribute('aria-label', `Anular: ${(cuerpo.textContent || '').trim().slice(0, 80)}`);
      cuerpo.appendChild(b);
    }
  },

  // --- wiring ---------------------------------------------------------------

  _wire() {
    if (this._wired) return;
    const vista = document.getElementById('view-tanques');
    const plano = document.getElementById('tanques-plano');
    if (!vista || !plano) return;

    // Capture, because TanquesView's own click listener on the same element
    // re-renders the plan: by the bubble phase the node that was clicked is
    // detached and the tap has nothing to read.
    plano.addEventListener('click', (e) => {
      // A drop is followed by a click on whatever the pointer came down on, so
      // that one click is consumed here. It is consumed whether or not Modo
      // mover is on: a drag made outside the mode would otherwise leave the
      // flag set and swallow the next real tap.
      const trasDrag = this._trasDrag;
      this._trasDrag = false;
      if (trasDrag || !this._puedeEscribir() || !this.modoMover) return;
      const g = e.target.closest('[data-tanque]');
      if (!g) return;
      this._tocar(g.dataset.tanque);
    }, true);

    plano.addEventListener('keydown', (e) => {
      if (!this._puedeEscribir() || !this.modoMover) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const g = e.target.closest('[data-tanque]');
      if (!g) return;
      e.preventDefault();
      this._tocar(g.dataset.tanque);
    }, true);

    vista.addEventListener('click', (e) => {
      // A drop outside the plan (onto a tray chip) is followed by a click on
      // that chip, and that click is not a tap. The plan's own listener
      // consumes the flag for a drop onto the floor.
      const trasDrag = this._trasDrag;
      this._trasDrag = false;
      if (!this._puedeEscribir()) return;
      if (e.target.closest(`#${ID.mover}`)) { this._alternarModo(); return; }
      const chip = e.target.closest('[data-lote]');
      if (chip) { if (!trasDrag) this._armarLote(chip.dataset.lote); return; }
      const pendiente = e.target.closest('[data-pendiente]');
      if (pendiente) {
        const clave = String(pendiente.dataset.clave || '').toLowerCase();
        const fila = this._pendientes.find(
          (p) => String(p.intento.client_id).toLowerCase() === clave);
        if (pendiente.dataset.pendiente === 'descartar') {
          this._resolverPendiente(clave);
          this._ctx.render();
        } else if (fila) {
          this._reintentar(fila.intento);
        }
        return;
      }
      const destino = e.target.closest('[data-destino]');
      if (destino) {
        if (destino.dataset.destino === 'cancelar') { this._desarmar(); this._ctx.render(); return; }
        const sel = document.getElementById(ID.destinoSel);
        if (sel && sel.value) this._tocar(sel.value);
        return;
      }
      const anular = e.target.closest('[data-anular]');
      if (anular) { this.anular(anular.dataset.anular); return; }
      const accion = e.target.closest('[data-accion]');
      if (accion) {
        if (accion.dataset.accion === 'mover') this._armarTanque(this._ctx.seleccion());
        if (accion.dataset.accion === 'salida') this.abrir({ origen: this._ctx.seleccion(), tipo: 'salida' });
        return;
      }
      // A vessel with no place on the plan (a CAVA tank, a tibor) is still a
      // vessel: its tray chip is a destination for an armed origin, exactly
      // like a tank on the floor. Without this, about forty of the catalog's
      // vessels could be read but never filled (lucy, 2026-10-15).
      const vasija = e.target.closest('[data-ir-tanque]');
      if (vasija && !trasDrag && this._armado) this._tocar(vasija.dataset.irTanque);
    });

    plano.addEventListener('pointerdown', (e) => {
      if (!this._puedeEscribir()) return;
      const g = e.target.closest('[data-tanque]');
      if (g) this._iniciarArrastre(e, { codigo: g.dataset.tanque });
    });
    vista.addEventListener('pointerdown', (e) => {
      if (!this._puedeEscribir()) return;
      const chip = e.target.closest('[data-lote]');
      const vasija = chip ? null : e.target.closest('#tanques-otras [data-ir-tanque]');
      if (!chip && !vasija) return;
      // The chip is a button: without this the browser starts a text/drag
      // selection and the pointer stream stops arriving mid-gesture.
      e.preventDefault();
      this._iniciarArrastre(e, chip
        ? { lote: chip.dataset.lote }
        : { codigo: vasija.dataset.irTanque });
    });
    window.addEventListener('pointermove', (e) => this._moverArrastre(e));
    window.addEventListener('pointerup', (e) => this._terminarArrastre(e));
    // A touch that turns into a scroll of the plan cancels the pointer stream.
    window.addEventListener('pointercancel', () => this._cancelarArrastre());

    this._wired = true;
  },

  // --- tap mode -------------------------------------------------------------

  _alternarModo() {
    this.modoMover = !this.modoMover;
    if (!this.modoMover) this._desarmar();
    this._ctx.render();
  },

  _armarTanque(codigo) {
    const est = this._ctx.bodega().estado[codigo];
    if (!est) return;
    this.modoMover = true;
    this._armado = { codigo };
    this._ctx.render();
    this._avisar(`Origen: ${codigo}. Ahora toque el tanque destino.`);
  },

  _armarLote(lot_code) {
    const ya = this._armado && this._armado.lote && this._armado.lote.lot_code === lot_code;
    if (ya) { this._desarmar(); this._ctx.render(); return; }
    const lote = lotesSinTanque(DataStore.wineRecepcion, this._ctx.bodega().movimientos)
      .find((l) => l.lot_code === lot_code);
    // The log is shared: another lab session can place a lote while this tab
    // is open, and then its chip is stale. Say so rather than ignore the tap.
    if (!lote) { this._ctx.render(); this._avisar(`El lote ${lot_code} ya está en un tanque.`); return; }
    this.modoMover = true;
    this._armado = { lote };
    this._ctx.render();
    this._avisar(`Lote ${lot_code}. Ahora toque el tanque que lo recibe.`);
  },

  _desarmar() {
    this._armado = null;
  },

  _tocar(codigo) {
    const dlg = document.getElementById(ID.dialogo);
    if (dlg && dlg.open) return;
    const armado = this._armado;
    if (!armado) { this._armarTanque(codigo); return; }
    if (armado.lote) {
      this._desarmar();
      this.abrir({ destino: codigo, lote: armado.lote });
      return;
    }
    if (armado.codigo === codigo) { this._desarmar(); this._ctx.render(); return; }
    this._desarmar();
    this.abrir({ origen: armado.codigo, destino: codigo });
  },

  // --- drag -----------------------------------------------------------------

  _iniciarArrastre(e, fuente) {
    // A new gesture starts: whatever click a previous drop was waiting to
    // swallow is never coming (it landed outside the plan, or not at all).
    this._trasDrag = false;
    this._arrastre = { fuente, x: e.clientX, y: e.clientY, movido: false };
  },

  _moverArrastre(e) {
    const d = this._arrastre;
    if (!d) return;
    if (!d.movido && Math.hypot(e.clientX - d.x, e.clientY - d.y) < ARRASTRE_PX) return;
    d.movido = true;
    if (!this._fantasma) {
      this._fantasma = document.createElement('div');
      this._fantasma.className = 'tanques-ghost';
      document.body.appendChild(this._fantasma);
    }
    const sobre = this._tanqueBajo(e);
    const desde = d.fuente.codigo || d.fuente.lote;
    this._fantasma.textContent = sobre && sobre !== d.fuente.codigo
      ? `${desde} a ${sobre}` : `${desde} a …`;
    this._fantasma.style.left = `${e.clientX + 12}px`;
    this._fantasma.style.top = `${e.clientY + 12}px`;
    this._marcarDestino(sobre === d.fuente.codigo ? null : sobre);
  },

  _terminarArrastre(e) {
    const d = this._arrastre;
    this._cancelarArrastre();
    if (!d || !d.movido) return;     // a tap: the click handlers own it
    this._trasDrag = true;
    const sobre = this._tanqueBajo(e);
    if (!sobre || sobre === d.fuente.codigo) return;
    this._desarmar();
    if (d.fuente.lote) {
      const lote = lotesSinTanque(DataStore.wineRecepcion, this._ctx.bodega().movimientos)
        .find((l) => l.lot_code === d.fuente.lote);
      if (lote) this.abrir({ destino: sobre, lote });
      else { this._ctx.render(); this._avisar(`El lote ${d.fuente.lote} ya está en un tanque.`); }
      return;
    }
    this.abrir({ origen: d.fuente.codigo, destino: sobre });
  },

  _cancelarArrastre() {
    this._arrastre = null;
    if (this._fantasma) { this._fantasma.remove(); this._fantasma = null; }
    this._marcarDestino(null);
  },

  _tanqueBajo(e) {
    // The ghost follows the pointer, so it must not be what is under it: it
    // carries pointer-events none in CSS for exactly this read. A tray chip
    // that names ONE vessel is a target too; a chip that groups several
    // (tibores, kegs) carries no data-ir-tanque and so is not one.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !el.closest) return null;
    const g = el.closest('[data-tanque]');
    if (g) return g.dataset.tanque;
    const chip = el.closest('#tanques-otras [data-ir-tanque]');
    return chip ? chip.dataset.irTanque : null;
  },

  _marcarDestino(codigo) {
    const vista = document.getElementById('view-tanques');
    if (!vista) return;
    for (const el of vista.querySelectorAll('.drop')) el.classList.remove('drop');
    if (!codigo) return;
    const sel = CSS.escape(codigo);
    const el = vista.querySelector(`#tanques-plano [data-tanque="${sel}"]`)
      || vista.querySelector(`#tanques-otras [data-ir-tanque="${sel}"]`);
    if (el) el.classList.add('drop');
  },

  // --- the dialog -----------------------------------------------------------

  /** Open the move dialog for a gesture. Public so view.js can too. */
  abrir(gesto) {
    if (!this._puedeEscribir()) return;
    // The lock belongs to the WRITE, not to the dialog. Cancelling a dialog
    // whose POST is still in flight and repeating the gesture would otherwise
    // send the same movement again under a new client_id, and the server would
    // accept both: two rows in an append-only ledger for one trasiego
    // (lucy, 2026-10-15).
    if (this._enviando) {
      this._avisar('Hay un movimiento en curso. Espere a que el servidor conteste.');
      return;
    }
    const dlg = this._dialogo();
    if (!dlg || dlg.open) return;    // never two dialogs over one gesture
    const modelo = planearMovimiento(gesto, this._ctx.bodega());
    this._pendiente = modelo;
    dlg.querySelector('form').innerHTML = this._html(modelo);
    dlg.showModal();
    const foco = dlg.querySelector('[name="volumen_l"]:not([disabled])')
      || dlg.querySelector('[data-cerrar]');
    if (foco) foco.focus();
    this._ctx.render();
  },

  _dialogo() {
    let dlg = document.getElementById(ID.dialogo);
    if (dlg) return dlg;
    if (!document.body) return null;
    dlg = document.createElement('dialog');
    dlg.id = ID.dialogo;
    dlg.className = 'tanques-dialog';
    dlg.setAttribute('aria-labelledby', ID.titulo);
    // novalidate: the gate that speaks is erroresDeMovimiento, in Spanish and
    // with the server's own words. The native bubble would pre-empt it in
    // whatever language the browser runs in.
    dlg.innerHTML = '<form novalidate></form>';
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    form.addEventListener('submit', (e) => { e.preventDefault(); this._enviar(); });
    form.addEventListener('click', (e) => {
      if (!e.target.closest('[data-cerrar]')) return;
      e.preventDefault();
      if (this._enviando) return;    // the write is in flight; it owns the dialog
      dlg.close();
    });
    // Escape is the other way out of a modal, and it must not escape the lock.
    dlg.addEventListener('cancel', (e) => { if (this._enviando) e.preventDefault(); });
    // Recompute the volume ceiling as merma is typed: merma comes off what
    // arrives, so it widens what may leave (see maximoVolumen).
    form.addEventListener('input', (e) => {
      if (e.target.name !== 'merma_l') return;
      const vol = form.querySelector('[name="volumen_l"]');
      if (!vol || !this._pendiente) return;
      vol.max = String(maximoVolumen(this._pendiente, numeroDeCampo(e.target.value)));
    });
    dlg.addEventListener('close', () => { this._pendiente = null; });
    return dlg;
  },

  _html(m) {
    // `lineas` arrive as HTML built below (escaped at the point it is built);
    // the title is escaped here because it is a tank code or a lot code.
    const caja = (titulo, lineas) => `<div class="tanques-mv-caja"><b>${escapeHtml(titulo)}</b>`
      + lineas.map((l) => `<small>${l}</small>`).join('') + '</div>';
    const partes = (lista) => (lista.length
      ? escapeHtml(lista.map((p) => p.lot_code).join(' + '))
      : 'vacío');

    let s = `<h2 id="${ID.titulo}">${escapeHtml(m.titulo)}</h2>`;
    s += '<div class="tanques-mv">';
    s += m.clase === 'recepcion'
      ? caja(m.lot_code || 'Lote', ['sin tanque', m.vintage_year ? `vendimia ${m.vintage_year}` : 'sin vendimia'])
      : caja(m.origen || '—', [partes(m.origen_partes), `${fmtL(m.disponible_l || 0)} L`]);
    s += '<span class="tanques-mv-chev"></span>';
    s += m.clase === 'salida'
      ? caja('Fuera de bodega', ['embotellado o salida', 'sin merma propia'])
      : caja(m.destino || '—', [
        partes(m.destino_partes),
        `libre ${fmtL(m.libres_l || 0)} de ${fmtL(m.capacidad_destino_l || 0)} L`,
      ]);
    s += '</div>';

    for (const a of m.avisos) {
      s += `<div class="tanques-alert${a.nivel === 'error' ? ' err' : ''}">${escapeHtml(a.texto)}</div>`;
    }

    if (!m.puedeRegistrar) {
      return `${s}<div class="tanques-dialog-acciones">`
        + '<button type="button" class="tanques-btn" data-cerrar>Cerrar</button></div>';
    }

    const opciones = m.tipos.map((t) =>
      `<option value="${escapeHtml(t)}"${t === m.tipo ? ' selected' : ''}>`
      + `${escapeHtml(etiquetaMovimiento(t))}</option>`).join('');
    s += '<div class="tanques-row2">'
      + `<label class="tanques-campo">Tipo<select name="tipo"${m.tipos.length === 1 ? ' disabled' : ''}>`
      + `${opciones}</select></label>`
      + '<label class="tanques-campo">Fecha<input name="fecha" type="date" required'
      + ` value="${escapeHtml(m.fecha)}" max="${escapeHtml(m.fecha_maxima)}"></label>`
      + '</div>';
    s += '<div class="tanques-row2">'
      + '<label class="tanques-campo">Volumen movido (L)<input name="volumen_l" type="number"'
      + ` min="0.001" step="any" max="${m.maximo_l}" required inputmode="decimal"`
      + ` value="${m.volumen_l == null ? '' : m.volumen_l}"></label>`
      + (m.pideMerma
        ? '<label class="tanques-campo">Merma estimada (L)<input name="merma_l" type="number"'
          + ' min="0" step="any" inputmode="decimal" value="" placeholder="0"></label>'
        : '<p class="tanques-hint">La merma de una salida ya está dentro de los litros que salen.</p>')
      + '</div>';
    s += '<div class="tanques-row2">'
      + `<p class="tanques-campo">Lote<b>${escapeHtml(m.lot_code || 'sin código')}</b>`
      + (m.mezcla_origen ? '<small>mayoritario de la mezcla</small>' : '<small>del origen</small>')
      + '</p>'
      + '<label class="tanques-campo">Vendimia<input name="vintage_year" type="number" required'
      + ` min="${VENDIMIA_MIN}" max="${VENDIMIA_MAX}" step="1" inputmode="numeric"`
      + ` value="${m.vintage_year == null ? '' : m.vintage_year}"></label>`
      + '</div>';
    s += '<label class="tanques-campo">Nota<input name="nota" type="text" maxlength="2000"'
      + ' placeholder="Ej. trasiego con aireación, lías gruesas"></label>';
    s += '<div class="tanques-dialog-errores" role="alert"></div>';
    s += '<div class="tanques-dialog-acciones">'
      + '<button type="button" class="tanques-btn" data-cerrar>Cancelar</button>'
      + '<button type="submit" class="tanques-btn primary">Registrar</button>'
      + '</div>';
    return s;
  },

  _errores(lista) {
    const dlg = document.getElementById(ID.dialogo);
    const caja = dlg && dlg.querySelector('.tanques-dialog-errores');
    if (!caja) return;
    caja.innerHTML = (lista || []).map((t) =>
      `<div class="tanques-alert err">${escapeHtml(t)}</div>`).join('');
  },

  // --- writes ---------------------------------------------------------------

  async _enviar() {
    // A fast double tap on Registrar must not post twice. The server would
    // recognise the repeat by client_id, but only the retry path reuses it.
    if (this._enviando) return;
    const dlg = document.getElementById(ID.dialogo);
    const modelo = this._pendiente;
    if (!dlg || !modelo || !modelo.puedeRegistrar) return;
    const form = dlg.querySelector('form');
    const valor = (n) => {
      const el = form.querySelector(`[name="${n}"]`);
      return el ? el.value : '';
    };
    const mov = movimientoDesdeFormulario(modelo, {
      tipo: valor('tipo'),
      fecha: valor('fecha'),
      volumen_l: valor('volumen_l'),
      merma_l: valor('merma_l'),
      vintage_year: valor('vintage_year'),
      nota: valor('nota'),
    });

    const errores = erroresDeMovimiento(this._ctx.bodega(), mov);
    if (errores.length) { this._errores(errores); return; }

    // The key is minted here, not inside DataStore, so the intent can be
    // written down BEFORE the request leaves: a browser that dies mid-flight
    // still knows which key to retry under, and the server answers a repeat
    // of that key with the row it already has instead of a second one.
    const intento = { ...mov, client_id: globalThis.crypto.randomUUID() };
    this._cargarPendientes();
    this._anotarPendiente(intento, 'No se pudo confirmar el movimiento. Revise la bitácora antes de repetirlo.');

    const boton = form.querySelector('button[type="submit"]');
    const cancelar = form.querySelector('[data-cerrar]');
    this._enviando = true;
    if (boton) { boton.disabled = true; boton.textContent = 'Registrando…'; }
    if (cancelar) cancelar.disabled = true;
    this._errores([]);

    // ONLY the write is inside the try. Anything after it (closing the dialog,
    // re-rendering, the toast) belongs to a movement that is already in the
    // log, and a throw from one of those must never be reported as a failed
    // write: the user would press Registrar again and the second attempt would
    // carry a fresh client_id, which is a second row in an append-only ledger.
    let out;
    try {
      out = await DataStore.postMovimiento(intento);
    } catch (err) {
      if (err && err.indeterminado) {
        // The request left and no answer came back, so the INSERT may have
        // committed: never call this refused. The entry stays, with its key.
        this._anotarPendiente(err.movimiento || intento, err.message);
        dlg.close();
        this._avisar(err.message, {
          etiqueta: 'Reintentar',
          fn: () => this._reintentar(err.movimiento || intento),
        });
        this._ctx.render();
      } else {
        // A definite refusal: the API wrote nothing under this key, so there
        // is nothing to reconcile and the form stays open to be corrected.
        this._resolverPendiente(intento.client_id);
        this._errores([err && err.message ? err.message : 'No se pudo registrar el movimiento.']);
      }
      return;
    } finally {
      this._enviando = false;
      if (boton) { boton.disabled = false; boton.textContent = 'Registrar'; }
      if (cancelar) cancelar.disabled = false;
    }

    this._resolverPendiente(intento.client_id);
    dlg.close();
    this._ctx.seleccionar(mov.destino || mov.origen);
    const donde = `${mov.origen || 'bandeja'} a ${mov.destino || 'fuera de bodega'}`;
    const cola = out.actualizado === false ? ' No se pudo actualizar la vista.' : '';
    const id = out.movimiento && out.movimiento.id;
    this._avisar(
      `${etiquetaMovimiento(mov.tipo)} ${out.duplicado ? 'ya estaba registrado' : 'registrado'}: `
      + `${donde}, ${fmtL(mov.volumen_l)} L.${cola}`,
      id ? { etiqueta: 'Deshacer', fn: () => this.anular(id) } : null,
    );
    this._ctx.render();
  },

  async _reintentar(intento) {
    if (this._enviando || !intento) return;
    this._enviando = true;
    let out;
    try {
      // The SAME intent, client_id included: if the first attempt did commit,
      // the server answers with that row instead of writing a second one.
      out = await DataStore.postMovimiento(intento);
    } catch (err) {
      if (err && err.indeterminado) {
        // Still unknown: KEEP this entry and its key. Dropping it here is what
        // would force a fresh form and a fresh client_id later.
        this._anotarPendiente(err.movimiento || intento, err.message);
      } else {
        // A definite refusal under this key: nothing was written under it, so
        // THIS entry is resolved. Another pending write is not.
        this._resolverPendiente(intento.client_id);
      }
      this._avisar(err && err.message ? err.message : 'No se pudo registrar el movimiento.',
        err && err.indeterminado
          ? { etiqueta: 'Reintentar', fn: () => this._reintentar(err.movimiento || intento) }
          : null);
      this._ctx.render();
      return;
    } finally {
      this._enviando = false;
    }
    this._resolverPendiente(intento.client_id);
    const id = out.movimiento && out.movimiento.id;
    this._avisar(`${etiquetaMovimiento(intento.tipo)} registrado.`,
      id ? { etiqueta: 'Deshacer', fn: () => this.anular(id) } : null);
    this._ctx.render();
  },

  /**
   * Undo: mark the row anulado, never delete it. The server refuses (400, with
   * a Spanish reason) when taking the row out would leave a later movement
   * overdrawn or overflowed, so that reason is what the user sees.
   */
  async anular(id) {
    if (this._enviando || !id) return;
    this._enviando = true;
    let out;
    try {
      out = await DataStore.anularMovimiento(id);
    } catch (err) {
      this._avisar(err && err.message ? err.message : 'No se pudo anular el movimiento.');
      this._ctx.render();
      return;
    } finally {
      this._enviando = false;
    }
    this._avisar(out.ya_anulado
      ? 'Ese movimiento ya estaba anulado.'
      : 'Movimiento anulado.'
        + (out.actualizado === false ? ' No se pudo actualizar la vista.' : ''));
    this._ctx.render();
  },

  // --- toast ----------------------------------------------------------------

  _avisar(mensaje, accion) {
    if (typeof document === 'undefined' || !document.body) return;
    let t = document.getElementById(ID.toast);
    if (!t) {
      t = document.createElement('div');
      t.id = ID.toast;
      t.className = 'tanques-toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      document.body.appendChild(t);
    }
    t.innerHTML = `<span>${escapeHtml(mensaje)}</span>`;
    if (accion) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tanques-toast-accion';
      b.textContent = accion.etiqueta;
      b.addEventListener('click', () => { t.hidden = true; accion.fn(); });
      t.appendChild(b);
    }
    const cerrar = document.createElement('button');
    cerrar.type = 'button';
    cerrar.className = 'tanques-toast-cerrar';
    cerrar.setAttribute('aria-label', 'Cerrar aviso');
    cerrar.textContent = '×';
    cerrar.addEventListener('click', () => { t.hidden = true; });
    t.appendChild(cerrar);
    t.hidden = false;
    clearTimeout(this._temporizador);
    this._temporizador = setTimeout(() => { t.hidden = true; }, TOAST_MS);
  },
};
