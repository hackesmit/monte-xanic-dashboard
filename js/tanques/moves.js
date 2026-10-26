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

import { DataStore, mismaIntencion } from '../dataLoader.js';
import { DemoMode } from '../demoMode.js';
import { escapeHtml, todayInVineyard } from '../utils.js';
import { validarMovimientoEnLog, estadoEnPosicion, ETAPAS } from './estado.js';
import { variedadDeLote, tokenVariedad, fechaCorta, ETAPA_ETIQUETAS } from './plan.js';

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
  'vintage_year', 'volumen_l', 'merma_l', 'nota', 'fuente', 'etapa',
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
 * @param {Object} [opciones] {fecha}: the business date the movement will
 *   carry (today when omitted). The tanks are read AT THAT PLACE IN THE LOG,
 *   through the same estadoEnPosicion the server gate uses, so a backdated
 *   trasiego is labelled with the lote the origin held then, and its volume is
 *   bounded by what the tanks held and had free then, not today.
 * @returns {Object} the dialog model; `puedeRegistrar` false means the gesture
 *   cannot become a movement at all and the dialog only explains why.
 */
export function planearMovimiento(gesto = {}, bodega = {}, opciones = {}) {
  const hoy = bodega && bodega.estado && typeof bodega.estado === 'object' ? bodega.estado : {};
  const movimientos = Array.isArray(bodega.movimientos) ? bodega.movimientos : [];
  const sinonimos = bodega.sinonimos || {};
  // The date from the caller, else the one the gesture itself carries, else
  // today. A gesture can state a date because the Tanques inbox (bead xd-qrn.6)
  // opens this dialog for a trasiego the lab's samples place on a past day; a
  // re-plan then overrides it with whatever is on the form (see _replanear).
  const fecha = texto(opciones && opciones.fecha) || texto(gesto && gesto.fecha) || todayInVineyard();
  // Where the movement comes from, as movimientos_tanque.fuente records it:
  // 'manual' is a person at the plan, 'lab' is a proposal inferred from
  // wine_samples.vessel_id that a person confirmed. It rides on the GESTURE so
  // a re-plan keeps it; anything but 'lab' is manual, never a value from
  // outside the column's CHECK.
  const fuente = texto(gesto && gesto.fuente) === 'lab' ? 'lab' : 'manual';
  // Without a catalog there is no log to replay (a caller that hands only the
  // derived state), and today's state is all there is to read.
  const estado = Array.isArray(bodega.catalogo) && bodega.catalogo.length
    ? estadoEnPosicion(bodega.catalogo, movimientos, { fecha }, { sinonimos })
    : hoy;

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
    lote_en: [],
    lot_code: etiqueta.lot_code,
    vintage_year: etiqueta.vintage_year,
    mezcla_origen: etiqueta.mezcla,
    disponible_l: clase === 'recepcion' ? null : (origen ? mili(origen.litros) : null),
    libres_l: clase === 'salida' ? null : (destino ? Math.max(0, mili(destino.libres)) : null),
    // The stage the destination is in at this fecha. The dialog's Etapa field
    // proposes no change (null): the replay then keeps it, or carries the
    // origin's into an empty tank. Only a stage the user picks is stored.
    etapa_destino: destino ? destino.etapa || null : null,
    etapa: null,
    pideEtapa: clase !== 'salida',
    maximo_l: 0,
    volumen_l: null,
    merma_l: 0,
    pideMerma: clase !== 'salida',
    fuente,
    fecha,
    // A business date in the past is normal (recording yesterday's trasiego);
    // one in the future would be applied ahead of everything in the replay.
    fecha_maxima: todayInVineyard(),
    avisos,
    puedeRegistrar: false,
  };

  // Where the log says this lote is, computed BEFORE any early return: the
  // dialog reads an empty list as "sin tanque", so a model that gave up early
  // would claim the lote is unplaced when the state says otherwise.
  // "Hoy en": this one is about TODAY on purpose, whatever the fecha.
  if (clase === 'recepcion') modelo.lote_en = tanquesConLote(hoy, modelo.lot_code);

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
    avisar('vacio', 'error', `${origen.codigo} está vacío${fecha !== todayInVineyard() ? ` el ${fecha}` : ''}. `
      + 'No hay vino que mover.');
  }
  if (clase !== 'salida' && modelo.libres_l <= 0) {
    avisar('sin_espacio', 'error',
      `${destino.codigo} está lleno (${fmtL(destino.litros)} de ${fmtL(destino.capacidad_l)} L). `
      + 'No cabe más vino.');
  }
  if (avisos.length) {
    modelo.maximo_l = 0;
    // Empty or full AT THIS FECHA: another date may differ, so the dialog
    // keeps the date field and lets the user move it.
    modelo.cambiarFecha = true;
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

  // A lab proposal states the two tanks and the day, and nothing else: the
  // samples carry no volume, so the litres on the form are this planner's
  // ceiling (what the origin held that day), not a measurement. Say so, because
  // accepting it unread would file a guess as a reading.
  if (fuente === 'lab') {
    avisar('propuesta_lab', 'info', 'Propuesta del laboratorio, de los cambios de tanque en '
      + 'las muestras. El volumen es lo que el origen tenía ese día: revíselo antes de registrar.');
  }
  if (clase === 'movimiento' && modelo.destino_partes.length) {
    modelo.tipo = 'ensamble';
    modelo.titulo = 'Ensamble';
    avisar('mezcla', 'info', `${destino.codigo} ya tiene vino. Esto registra una mezcla `
      + 'y guarda la composición por volumen.');
  }
  if (clase === 'recepcion') {
    // The chip said this lote had no tank, and the log may have moved on since
    // (another session placed it, or this tab held the gesture open). Saying
    // "sin tanque" over a log that names it is a false claim, and recording
    // against it is how one delivery becomes two rows - but a lote CAN arrive
    // in two loads, so this names what the log says and leaves the call to the
    // user instead of blocking a legitimate second delivery (lucy, 2026-10-15).
    const nombrado = movimientos.some(
      (m) => m && !m.anulado && texto(m.lot_code) === modelo.lot_code);
    if (nombrado) {
      avisar('lote_en_bitacora', 'aviso', modelo.lote_en.length
        ? `La bitácora ya tiene ${modelo.lot_code} en `
          + `${modelo.lote_en.map((d) => `${d.codigo} (${fmtL(d.litros)} L)`).join(', ')}. `
          + 'Si esta es otra entrega del mismo lote, continúe; si no, cancele.'
        : `La bitácora ya registra movimientos de ${modelo.lot_code} y hoy no está en ningún `
          + 'tanque. Si esta es otra entrega del mismo lote, continúe; si no, cancele.');
    }
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

/** The tanks that hold a lote right now, straight out of the derived state. */
function tanquesConLote(estado, lot_code) {
  const codigo = texto(lot_code);
  const fuera = [];
  if (!codigo) return fuera;
  for (const t of Object.values(estado || {})) {
    const parte = (t && Array.isArray(t.partes) ? t.partes : []).find((p) => p.lot_code === codigo);
    if (parte && parte.litros > 0) fuera.push({ codigo: t.codigo, litros: parte.litros });
  }
  return fuera;
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
  // The vendimia field has three states and only one of them may fall back to
  // the year the dialog inferred: the field NOT being on the form at all. A
  // field that is on the form and blank, or holds '2024.5' or 'abc', is what
  // the user typed, and quietly replacing it with the inferred year would file
  // the movement under a vendimia nobody chose (lucy, 2026-10-15). Blank stays
  // null and junk stays as typed, and erroresDeFormulario names each in Spanish.
  let vintage_year;
  if (!propio(valores, 'vintage_year') || valores.vintage_year === undefined) {
    vintage_year = Number.isInteger(modelo.vintage_year) ? modelo.vintage_year : null;
  } else if (texto(valores.vintage_year) === '') {
    vintage_year = null;
  } else {
    // Only four digits as typed are a year. Number() would also read '2e3',
    // '0x7d0' and '2024.0' as one, and none of those is what anybody writes on
    // a barrel; they stay as typed so the gate repeats them back.
    const t = texto(valores.vintage_year);
    vintage_year = /^\d{4}$/.test(t) ? Number(t) : t;
  }
  const nota = texto(valores.nota);
  const mermaCampo = texto(valores.merma_l);
  return {
    fecha: texto(valores.fecha) || texto(modelo.fecha),
    tipo,
    origen: modelo.origen || null,
    destino: modelo.destino || null,
    lot_code: texto(modelo.lot_code),
    vintage_year,
    volumen_l: numeroDeCampo(valores.volumen_l),
    // A salida carries no merma of its own: the loss is already inside the
    // volume that left, and the column has a CHECK saying so.
    merma_l: tipo === 'salida' ? 0 : (mermaCampo === '' ? 0 : numeroDeCampo(valores.merma_l)),
    nota: nota || null,
    // Blank means "no change" and is sent as null. A value outside ETAPAS is a
    // stale or tampered form: it is sent as typed so the gate names it, never
    // quietly dropped into "no change". A salida has no destination to put a
    // stage on, so it never carries one.
    etapa: tipo === 'salida' ? null : (texto(valores.etapa) || null),
    // From the MODEL, never from the form: `fuente` says where the movement
    // came from (a person at the plan, or a lab proposal a person confirmed),
    // which is not something the user types and must not be something a stale
    // or tampered form can set. An unknown value falls back to 'manual' rather
    // than reaching the column's CHECK.
    fuente: modelo.fuente === 'lab' ? 'lab' : 'manual',
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
  // Blank and wrong are different mistakes and are named differently: a blank
  // field asks for the year, a wrong one repeats what was typed.
  const crudo = m.vintage_year;
  if (crudo == null || texto(crudo) === '') {
    errores.push('Escriba la vendimia: el año de la cosecha.');
  } else {
    const t = texto(crudo);
    const v = typeof crudo === 'number' ? crudo : (/^\d{4}$/.test(t) ? Number(t) : NaN);
    if (!Number.isInteger(v) || v < VENDIMIA_MIN || v > VENDIMIA_MAX) {
      errores.push(`La vendimia "${texto(crudo)}" no es válida. `
        + `La vendimia debe ser un año entre ${VENDIMIA_MIN} y ${VENDIMIA_MAX}.`);
    }
  }
  return errores;
}

/**
 * The unresolved intent this movement repeats, if any.
 *
 * A write with no definite outcome keeps its key in a pending entry. If the
 * user then makes the same gesture again and it is posted under a NEW key, the
 * server has no way to tell the two apart: one physical movement, two rows,
 * the moment someone presses Reintentar on the old entry (lucy, 2026-10-15).
 * Same movement means every field the row stores (mismaIntencion: tipo,
 * origen, destino, lot_code, volumen_l, merma_l, fecha, vintage_year, nota,
 * fuente, etapa), with tank synonyms resolved.
 * @returns {Object|null} the pending entry ({intento, mensaje, guardado})
 */
export function pendienteIgual(pendientes, mov, sinonimos = {}) {
  if (!mov) return null;
  for (const p of Array.isArray(pendientes) ? pendientes : []) {
    if (p && p.intento && mismaIntencion(p.intento, mov, sinonimos)) return p;
  }
  return null;
}

/**
 * A live row in the log that is the same movement as this intent but was
 * written under ANOTHER key. Retrying the intent blindly would add a second
 * row for what is probably one movement, so the retry has to ask first.
 * @returns {Object|null} the log row
 */
export function gemeloEnBitacora(movimientos, intento, sinonimos = {}) {
  if (!intento) return null;
  const clave = String(intento.client_id || '').toLowerCase();
  for (const m of Array.isArray(movimientos) ? movimientos : []) {
    if (!m || m.anulado) continue;
    if (typeof m.client_id === 'string' && m.client_id.toLowerCase() === clave) continue;
    if (mismaIntencion(m, intento, sinonimos)) return m;
  }
  return null;
}

// Enough of the log to tell "it moved" from "it is the same": the row count
// plus the greatest id, which is what an append or an annulment changes.
function firmaDeLog(movimientos) {
  const filas = Array.isArray(movimientos) ? movimientos : [];
  let mayor = 0;
  let anulados = 0;
  for (const m of filas) {
    const id = Number(m && m.id);
    if (Number.isFinite(id) && id > mayor) mayor = id;
    if (m && m.anulado) anulados += 1;
  }
  return `${filas.length}|${mayor}|${anulados}`;
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
// Where the unconfirmed writes survive a reload: one key per intent (see
// _anotarPendiente). The payload is a movement, never a credential.
const PREFIJO_PENDIENTE = 'xanic_tanques_pendiente:';
const PENDIENTES_MAX = 20;
// A request's in-flight marker older than this belongs to a tab that died
// mid-request; it stops blocking a discard.
const VUELO_MAX_MS = 120000;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
// What the user reads when the key cannot be written down: the first send and
// every retry stop on it in the same words.
const SIN_CLAVE_GUARDADA = 'Este navegador no pudo guardar el identificador del movimiento, '
  + 'así que no se envía: sin él, un reintento podría registrarlo dos veces. '
  + 'Resuelva los avisos pendientes de esta pestaña y vuelva a intentarlo.';

// What the dialog proposed for a field: the value it was drawn with.
function valorPropuesto(el) {
  if (!el) return null;
  if (el.tagName === 'SELECT') {
    const o = [...el.options].find((x) => x.defaultSelected) || el.options[0];
    return o ? o.value : '';
  }
  return typeof el.defaultValue === 'string' ? el.defaultValue : null;
}

function igualAPropuesto(el) {
  const a = texto(el.value);
  const b = texto(valorPropuesto(el));
  if (a === b) return true;
  // '6400' and '6400.0' are the same volume; '' and '0' are not compared as
  // numbers, because a blank volume is not zero litres.
  if (el.type === 'number' && a !== '' && b !== '') {
    const x = Number(a), y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && x === y;
  }
  return false;
}
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
  _claveEnVuelo: null,
  _firmaLog: '',        // the log the open dialog was planned against
  // Writes with no definite outcome, keyed by client_id and kept until they
  // get one. Three things make this a persisted LIST and not a variable:
  // the toast times out, a second unconfirmed write would overwrite the
  // first, and a reload would drop the key altogether - and every one of
  // those ends with the user retyping the movement under a NEW key, which
  // the server accepts as a second row (lucy, 2026-10-15).
  _pendientes: [],
  _temporizador: null,
  _trasDrag: false,     // a click is pending behind a drop; it is not a tap
  _distintoDe: null,    // the payload the user said is NOT the pending one
  _tocados: null,       // form fields the user changed in the open dialog
  _confirmarAnular: null, // the history row whose Anular is waiting for a yes
  _toastClave: null,    // the pending key the toast's action would retry

  /** Called by TanquesView.mount(). Idempotent. */
  mount(ctx) {
    if (ctx) this._ctx = ctx;
    if (!this._ctx || typeof document === 'undefined') return;
    this._wire();
  },

  /**
   * May this session draw write controls? Public because the Tanques inbox
   * (js/tanques/inbox.js) is a write surface too, and two modules answering
   * this question their own way would eventually disagree about who sees a
   * button. The server is still the authority (api/tanques.js, role lab).
   */
  puedeEscribir() {
    return this._puedeEscribir();
  },

  /**
   * The tab's toast, with an optional action. Public so the Tanques inbox can
   * speak in the same place rather than inventing a second status surface.
   */
  avisar(mensaje, accion) {
    this._avisar(mensaje, accion);
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
      this._confirmarAnular = null;
      this._quitarChrome();
      return;
    }
    // One replay for the whole repaint: _bodega() derives every tank from the
    // log, and render() has already paid for that once.
    const bodega = this._ctx.bodega();
    this._revisarPendientes();
    this._revisarArmado(bodega);
    this._revisarDialogo(bodega);
    this._chrome();
    this._pintarBoton();
    this._pintarPendiente();
    this._pintarDestino(bodega);
    this._pintarBandeja(bodega);
    this._pintarAcciones(bodega);
    this._pintarAnular();
  },

  // --- unconfirmed writes -----------------------------------------------------

  // ONE localStorage key per intent, never a list. localStorage makes each
  // operation atomic but not a read-modify-write cycle, so two tabs that both
  // read an empty list and both write their own copy leave only the second
  // one's key, and the first tab comes back with nothing to retry under
  // (lucy, 2026-10-15). Adding, updating and resolving touch only their own
  // key; the enumeration below is for painting and reconciling, never for
  // writing the collection back.
  _leerPendientes() {
    const fuera = [];
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return fuera;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(PREFIJO_PENDIENTE) !== 0) continue;
        try {
          const p = JSON.parse(localStorage.getItem(k) || 'null');
          if (p && p.intento && typeof p.intento.client_id === 'string') fuera.push(p);
        } catch (_) { /* a key we cannot read is left alone, not deleted */ }
      }
    } catch (_) { /* storage blocked: there is nothing to show */ }
    // Oldest first, so the banner reads in the order the writes were made.
    return fuera.sort((a, b) => (a.guardado || 0) - (b.guardado || 0));
  },

  _cargarPendientes() {
    this._pendientes = this._leerPendientes();
  },

  // Recorded BEFORE the request leaves, so a browser that dies mid-flight
  // still knows which key to retry with. Reports whether it is really stored:
  // a silent failure here would mean a movement sent under a key nothing
  // remembers, which is the duplicate this whole mechanism exists to prevent.
  _anotarPendiente(intento, mensaje, { enVuelo = false } = {}) {
    const clave = PREFIJO_PENDIENTE + String(intento.client_id).toLowerCase();
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return false;
      const previo = localStorage.getItem(clave);
      // An unresolved key is never evicted to make room for a new one: that
      // would throw away the only thing standing between a retry and a second
      // row. At the cap the answer is to stop writing, not to forget.
      if (!previo && this._leerPendientes().length >= PENDIENTES_MAX) return false;
      let guardado = Date.now();
      if (previo) {
        try { guardado = JSON.parse(previo).guardado || guardado; } catch (_) { /* keep now */ }
      }
      // `vuelo` marks a request under this key that is out right now, so no
      // tab may discard the key before that request has an answer.
      const texto_ = JSON.stringify(enVuelo ? { intento, mensaje, guardado, vuelo: Date.now() }
        : { intento, mensaje, guardado });
      localStorage.setItem(clave, texto_);
      const ok = localStorage.getItem(clave) === texto_;
      this._cargarPendientes();
      return ok;
    } catch (_) {
      return false;
    }
  },

  // Is a request under this key out right now, in this tab or another? A
  // marker older than VUELO_MAX_MS belongs to a tab that died mid-request and
  // no longer blocks a discard.
  _enVuelo(client_id) {
    const clave = String(client_id || '').toLowerCase();
    if (this._claveEnVuelo && String(this._claveEnVuelo).toLowerCase() === clave) return true;
    const e = this._entradaGuardada(clave);
    return !!(e && e.vuelo && Date.now() - e.vuelo < VUELO_MAX_MS);
  },

  // Check-the-pending-intents and write-down-a-new-key must be one step
  // ACROSS TABS: two tabs submitting the same movement at once would each find
  // no match and each mint a key (lucy, 2026-10-15). The Web Locks API makes
  // it one step per origin; without it (old browsers) it runs as before.
  async _enCandado(fn) {
    const locks = typeof navigator !== 'undefined' && navigator.locks;
    if (locks && typeof locks.request === 'function') {
      return locks.request('xanic-tanques-pendientes', { mode: 'exclusive' }, fn);
    }
    return fn();
  },

  // The stored entry for one key, read from storage itself rather than from
  // this tab's copy: another tab may have resolved or discarded it.
  _entradaGuardada(client_id) {
    try {
      if (typeof localStorage === 'undefined' || !localStorage) return null;
      const p = JSON.parse(localStorage.getItem(PREFIJO_PENDIENTE + String(client_id || '').toLowerCase())
        || 'null');
      return p && p.intento ? p : null;
    } catch (_) {
      return null;
    }
  },

  // Resolve ONE entry by its key: a retry's callback must never clear someone
  // else's pending write, in this tab or in another one.
  _resolverPendiente(client_id) {
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.removeItem(PREFIJO_PENDIENTE + String(client_id || '').toLowerCase());
      }
    } catch (_) { /* nothing else to do */ }
    this._cargarPendientes();
  },

  // A key that is now in the log landed after all: the log is the answer, so
  // the banner goes without anyone retrying anything.
  _revisarPendientes() {
    this._cargarPendientes();
    if (!this._pendientes.length) return;
    const log = Array.isArray(DataStore.movimientosTanque) ? DataStore.movimientosTanque : [];
    const vistos = new Set();
    for (const m of log) {
      if (m && typeof m.client_id === 'string') vistos.add(m.client_id.toLowerCase());
    }
    const confirmados = this._pendientes.filter(
      (p) => vistos.has(String(p.intento.client_id).toLowerCase()));
    if (!confirmados.length) return;
    for (const p of confirmados) this._resolverPendiente(p.intento.client_id);
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
    // The role can change under an open tab (the session is re-read and is no
    // longer lab). A Deshacer button or an open dialog left behind is a write
    // control in the hands of someone who may not write, so both leave the
    // DOM, and the toast's timer with them.
    const dlg = document.getElementById(ID.dialogo);
    if (dlg) {
      if (dlg.open) dlg.close();
      dlg.remove();
    }
    this._pendiente = null;
    const t = document.getElementById(ID.toast);
    if (t) t.remove();
    clearTimeout(this._temporizador);
    this._temporizador = null;
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
    const log = Array.isArray(DataStore.movimientosTanque) ? DataStore.movimientosTanque : [];
    caja.innerHTML = this._pendientes.map(({ intento, mensaje }) => {
      const clave = escapeHtml(intento.client_id);
      const donde = `${intento.origen || 'bandeja'} a ${intento.destino || 'fuera de bodega'}`;
      // The same movement is already in the log under another key (a repeat
      // that landed, or another pending entry whose retry did). A plain
      // Reintentar here would be the second row, so the button asks instead.
      const gemelo = gemeloEnBitacora(log, intento, DataStore.tanquesSinonimos || {});
      return '<div class="tanques-alert err">'
        + `<div>${escapeHtml(mensaje)}</div>`
        + `<div class="tanques-p-sub">${escapeHtml(etiquetaMovimiento(intento.tipo))} `
        + `${escapeHtml(intento.lot_code)}, ${fmtL(intento.volumen_l)} L, ${escapeHtml(donde)}, `
        + `${escapeHtml(fechaCorta(intento.fecha) || intento.fecha)}.</div>`
        + (gemelo
          ? '<div class="tanques-p-sub tanques-gemelo">La bitácora ya tiene un movimiento igual '
            + `(registro ${escapeHtml(String(gemelo.id))}). Si es el mismo, pulse "Ya la revisé".</div>`
          : '')
        + '<div class="tanques-acciones">'
        + (gemelo
          ? `<button type="button" class="tanques-btn" data-pendiente="distinto" data-clave="${clave}">`
            + 'Es un movimiento distinto, registrar de nuevo</button>'
          : `<button type="button" class="tanques-btn" data-pendiente="reintentar" data-clave="${clave}">`
            + 'Reintentar</button>')
        + `<button type="button" class="tanques-btn" data-pendiente="descartar" data-clave="${clave}">`
        + 'Ya la revisé</button>'
        + '</div></div>';
    }).join('');
    if (!previo) tarjeta.insertBefore(caja, tarjeta.firstChild);
  },

  // A dialog open while a read lands was planned against the PREVIOUS log, so
  // its boxes and its warnings describe a bodega that no longer exists: it
  // would still say "sin tanque" about a lote another session just received,
  // and the user would record that delivery a second time without being told
  // (lucy, 2026-10-15). Re-plan it in place, keep what the user typed, and say
  // out loud that the bitacora moved.
  _revisarDialogo(bodega) {
    const dlg = document.getElementById(ID.dialogo);
    if (!dlg || !dlg.open || !this._pendiente || this._enviando) return;
    const firma = firmaDeLog(bodega.movimientos);
    if (firma === this._firmaLog) return;
    this._firmaLog = firma;
    this._replanear(bodega);
    const form = dlg.querySelector('form');
    const nota = document.createElement('div');
    nota.className = 'tanques-alert err';
    nota.textContent = 'La bitácora cambió mientras este formulario estaba abierto. '
      + 'Revise los datos antes de registrar.';
    form.insertBefore(nota, form.querySelector('h2').nextSibling);
  },

  // Plan the open dialog again, at the fecha on the form, and keep only what
  // the USER changed. A value the dialog proposed (the type, the volume, the
  // lote, the vendimia) was a proposal about one log at one date: a new log
  // or a new date may propose something else. A trasiego into a tank that has
  // since been filled is now an ensamble, and a trasiego dated before the
  // tank was refilled carries the lote it held then (lucy, 2026-10-15).
  _replanear(bodega) {
    const dlg = document.getElementById(ID.dialogo);
    if (!dlg || !this._pendiente) return;
    const form = dlg.querySelector('form');
    const tocados = this._tocados || new Set();
    const escrito = {};
    for (const el of form.querySelectorAll('[name]')) {
      if (tocados.has(el.name)) escrito[el.name] = el.value;
    }
    const campoFecha = form.querySelector('[name="fecha"]');
    const fecha = campoFecha && FECHA_RE.test(campoFecha.value) ? campoFecha.value : this._pendiente.fecha;
    const activo = document.activeElement && form.contains(document.activeElement)
      ? document.activeElement.name : '';
    const modelo = planearMovimiento(this._pendiente.gesto, bodega, { fecha });
    this._pendiente = modelo;
    form.innerHTML = this._html(modelo);
    for (const el of form.querySelectorAll('[name]')) {
      if (escrito[el.name] === undefined) continue;
      // A chosen type the new gesture no longer allows is not restored.
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === escrito[el.name])) continue;
      el.value = escrito[el.name];
    }
    // The date is now the model's own, so it is no longer a change; anything
    // restored equal to the new proposal is not one either.
    this._tocados = new Set();
    for (const el of form.querySelectorAll('[name]')) this._anotarTocado(el);
    const merma = form.querySelector('[name="merma_l"]');
    const vol = form.querySelector('[name="volumen_l"]');
    if (merma && vol) vol.max = String(maximoVolumen(modelo, numeroDeCampo(merma.value)));
    const foco = activo && form.querySelector(`[name="${activo}"]`);
    if (foco) foco.focus();
  },

  // A field counts as changed only while it differs from what the dialog
  // proposed: typing a value and then typing the proposal back is no change,
  // and a re-plan must be free to propose anew for it.
  _anotarTocado(el) {
    if (!el || !el.name || !this._tocados) return;
    if (valorPropuesto(el) === null || igualAPropuesto(el)) this._tocados.delete(el.name);
    else this._tocados.add(el.name);
  },

  // The log is shared and the tray is a snapshot: a lote armed here can be
  // placed by another session before this tab lands it. Disarm it rather than
  // carry a stale gesture into the dialog.
  _revisarArmado(bodega) {
    const lote = this._armado && this._armado.lote;
    if (!lote) return;
    const sigue = lotesSinTanque(DataStore.wineRecepcion, bodega.movimientos)
      .some((l) => l.lot_code === lote.lot_code);
    if (sigue) return;
    this._desarmar();
    this._avisar(`El lote ${lote.lot_code} ya aparece en la bitácora, así que se desarmó.`);
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
      // Not "every lote is in a tank": this list is the lotes of the newest
      // vendimia that no live movement NAMES, which says nothing about where
      // a lote that already left the bodega is. Where the wine is comes from
      // estado.js, and nothing here is going to restate it.
      el.innerHTML = todos.length
        ? '<span class="tanques-hint">Ningún lote sin tanque coincide con la búsqueda.</span>'
        : '<span class="tanques-hint">No hay lotes pendientes de asignar.</span>';
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
      if (li.classList.contains('anulado')) continue;
      if (li.querySelector('[data-anular], .tanques-anular-confirma')) continue;
      const cuerpo = li.lastElementChild;
      if (!cuerpo) continue;
      // Anular is permanent in an append-only log (the row stays, marked), so
      // the history asks once before it sends anything.
      if (this._confirmarAnular != null && String(this._confirmarAnular) === li.dataset.mov) {
        const c = document.createElement('div');
        c.className = 'tanques-anular-confirma';
        c.setAttribute('role', 'alert');
        c.innerHTML = '<span>¿Anular este movimiento? No se puede deshacer.</span>'
          + `<button type="button" class="tanques-anular" data-anular-si="${escapeHtml(li.dataset.mov)}">`
          + 'Sí, anular</button>'
          + '<button type="button" class="tanques-anular" data-anular-no>No</button>';
        cuerpo.appendChild(c);
        continue;
      }
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
          // A request under this key is out (here or in another tab): its
          // answer may be the only proof it landed, so the key stays until
          // then (lucy, 2026-10-15).
          if (this._enVuelo(clave)) {
            this._avisar('Este movimiento se está enviando. Espere la respuesta antes de descartarlo.');
            return;
          }
          this._resolverPendiente(clave);
          // A toast still offering to retry this entry would retry nothing
          // now (see _reintentar), so it goes too rather than lie.
          const t = document.getElementById(ID.toast);
          if (t && this._toastClave === clave) { t.hidden = true; this._toastClave = null; }
          this._ctx.render();
        } else if (fila) {
          this._reintentar(fila.intento,
            { confirmado: pendiente.dataset.pendiente === 'distinto' });
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
      const si = e.target.closest('[data-anular-si]');
      if (si) {
        const id = this._confirmarAnular;
        this._confirmarAnular = null;
        if (id != null && String(id) === si.dataset.anularSi) this.anular(id);
        else this._ctx.render();
        return;
      }
      if (e.target.closest('[data-anular-no]')) {
        this._confirmarAnular = null;
        this._ctx.render();
        return;
      }
      const anular = e.target.closest('[data-anular]');
      if (anular) {
        if (this._enviando) {
          this._avisar('Hay un movimiento en curso. Espere a que el servidor conteste.');
          return;
        }
        this._confirmarAnular = anular.dataset.anular;
        this._ctx.render();
        return;
      }
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
    // Escape backs out of the inline Anular question exactly like "No". The
    // move dialog owns Escape while it is open.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this._confirmarAnular == null) return;
      const dlg = document.getElementById(ID.dialogo);
      if (dlg && dlg.open) return;
      this._confirmarAnular = null;
      this._ctx.render();
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
      const lote = lotesSinTanque(DataStore.wineRecepcion, this._ctx.bodega().movimientos)
        .find((l) => l.lot_code === armado.lote.lot_code);
      if (!lote) {
        this._ctx.render();
        this._avisar(`El lote ${armado.lote.lot_code} ya aparece en la bitácora. `
          + 'Revísela antes de registrarlo otra vez.');
        return;
      }
      this.abrir({ destino: codigo, lote });
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
    // The last write landed but its re-read did not, so the plan on screen is
    // older than the bitacora: it still shows the tank empty and the lote in
    // the tray. Recording against that picture is how one reception becomes
    // two (lucy, 2026-10-15). The way out is a read, not a second write.
    if (DataStore.tanquesDesactualizado) {
      this._avisar('La vista está desactualizada: el último movimiento se registró y no se pudo '
        + 'releer la bitácora. Relea antes de registrar otro.',
        { etiqueta: 'Releer', fn: () => this._releer() });
      return;
    }
    const dlg = this._dialogo();
    if (!dlg || dlg.open) return;    // never two dialogs over one gesture
    const bodega = this._ctx.bodega();
    const modelo = planearMovimiento(gesto, bodega);
    this._pendiente = modelo;
    this._tocados = new Set();
    this._distintoDe = null;
    this._firmaLog = firmaDeLog(bodega.movimientos);
    dlg.querySelector('form').innerHTML = this._html(modelo);
    dlg.showModal();
    const foco = dlg.querySelector('[name="volumen_l"]:not([disabled])')
      || dlg.querySelector('[data-cerrar]');
    if (foco) foco.focus();
    this._ctx.render();
  },

  async _releer() {
    const ok = await DataStore.loadTanques();
    this._ctx.render();
    this._avisar(ok
      ? 'Bitácora al día.'
      : 'No se pudo leer la bitácora. Revise su sesión e intente de nuevo.',
      ok ? null : { etiqueta: 'Releer', fn: () => this._releer() });
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
      const igual = e.target.closest('[data-igual]');
      if (igual) {
        e.preventDefault();
        if (this._enviando) return;
        if (igual.dataset.igual === 'distinto') {
          // The one way to give an identical payload a fresh key: the user
          // says, in so many words, that it is another movement.
          this._distintoDe = this._movimientoDelFormulario();
          this._enviar();
          return;
        }
        const clave = String(igual.dataset.clave || '').toLowerCase();
        const fila = this._pendientes.find(
          (p) => String(p.intento.client_id).toLowerCase() === clave);
        dlg.close();
        if (fila) this._reintentar(fila.intento);
        return;
      }
      if (!e.target.closest('[data-cerrar]')) return;
      e.preventDefault();
      if (this._enviando) return;    // the write is in flight; it owns the dialog
      dlg.close();
    });
    // What the user changed by hand, so a re-plan keeps it and recomputes the
    // rest (see _revisarDialogo).
    const tocar = (e) => this._anotarTocado(e.target);
    form.addEventListener('input', tocar);
    form.addEventListener('change', tocar);
    // A new fecha is a new place in the log: what the origin held, and so the
    // lote, the vendimia and the volume it can send, are read there again.
    form.addEventListener('change', (e) => {
      if (!e.target || e.target.name !== 'fecha' || this._enviando || !this._pendiente) return;
      if (!FECHA_RE.test(e.target.value) || e.target.value === this._pendiente.fecha) return;
      this._replanear(this._ctx.bodega());
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
    dlg.addEventListener('close', () => {
      this._pendiente = null;
      this._distintoDe = null;
      this._tocados = null;
    });
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
      ? caja(m.lot_code || 'Lote', [
        m.lote_en && m.lote_en.length
          ? `hoy en ${escapeHtml(m.lote_en.map((d) => d.codigo).join(', '))}`
          : 'sin tanque',
        m.vintage_year ? `vendimia ${m.vintage_year}` : 'sin vendimia',
      ])
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

    const campoFecha = '<label class="tanques-campo">Fecha<input name="fecha" type="date" required'
      + ` value="${escapeHtml(m.fecha)}" max="${escapeHtml(m.fecha_maxima)}"></label>`;
    if (!m.puedeRegistrar) {
      // Empty or full is a fact about ONE date: the field stays so the user
      // can move the movement to the date it really happened.
      return `${s}${m.cambiarFecha ? `<div class="tanques-row2">${campoFecha}</div>` : ''}`
        + '<div class="tanques-dialog-acciones">'
        + '<button type="button" class="tanques-btn" data-cerrar>Cerrar</button></div>';
    }

    const opciones = m.tipos.map((t) =>
      `<option value="${escapeHtml(t)}"${t === m.tipo ? ' selected' : ''}>`
      + `${escapeHtml(etiquetaMovimiento(t))}</option>`).join('');
    s += '<div class="tanques-row2">'
      + `<label class="tanques-campo">Tipo<select name="tipo"${m.tipos.length === 1 ? ' disabled' : ''}>`
      + `${opciones}</select></label>`
      + campoFecha
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
      // Text, not number: a number input hands back '2e3' as a value and
      // turns '0x7d0' into '', so the gate could not repeat what was typed.
      + '<label class="tanques-campo">Vendimia<input name="vintage_year" type="text" required'
      + ' inputmode="numeric" autocomplete="off"'
      + ` value="${m.vintage_year == null ? '' : m.vintage_year}"></label>`
      + '</div>';
    if (m.pideEtapa) {
      const actual = m.etapa_destino ? ETAPA_ETIQUETAS[m.etapa_destino] || m.etapa_destino : '';
      const etapas = ETAPAS.map((e) =>
        `<option value="${escapeHtml(e)}"${e === m.etapa ? ' selected' : ''}>`
        + `${escapeHtml(ETAPA_ETIQUETAS[e] || e)}</option>`).join('');
      s += '<label class="tanques-campo">Etapa del vino en el destino<select name="etapa">'
        + `<option value=""${m.etapa ? '' : ' selected'}>Sin cambio</option>${etapas}</select>`
        + `<small>${actual ? `Etapa de ${escapeHtml(m.destino || '')} en esa fecha: ${escapeHtml(actual)}`
          : 'Sin cambio: la etapa sale del movimiento o viaja con el vino.'}</small></label>`;
    }
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

  // The open dialog's form as the body it would post. A field missing from
  // the form is left out of `valores` (not sent as ''), so the planner can tell
  // an omitted field from one the user cleared.
  _movimientoDelFormulario() {
    const dlg = document.getElementById(ID.dialogo);
    const modelo = this._pendiente;
    if (!dlg || !modelo) return null;
    const form = dlg.querySelector('form');
    const valores = {};
    for (const n of ['tipo', 'fecha', 'volumen_l', 'merma_l', 'vintage_year', 'nota', 'etapa']) {
      const el = form.querySelector(`[name="${n}"]`);
      if (el) valores[n] = el.value;
    }
    return movimientoDesdeFormulario(modelo, valores);
  },

  // The movement on the form is the same as one whose write is still
  // unresolved. Minting a new key for it is how one physical movement becomes
  // two rows (lucy, 2026-10-15), so the dialog routes the user to the pending
  // intent instead: its own key, which the server answers with `duplicado` if
  // the first attempt did land.
  _ofrecerPendiente(p) {
    const dlg = document.getElementById(ID.dialogo);
    const caja = dlg && dlg.querySelector('.tanques-dialog-errores');
    if (!caja) return;
    const i = p.intento;
    const clave = escapeHtml(i.client_id);
    caja.innerHTML = '<div class="tanques-alert err tanques-igual">'
      + '<div>Este movimiento es igual a uno que quedó sin confirmar: '
      + `${escapeHtml(etiquetaMovimiento(i.tipo))} ${escapeHtml(i.lot_code)}, ${fmtL(i.volumen_l)} L, `
      + `${escapeHtml(i.origen || 'bandeja')} a ${escapeHtml(i.destino || 'fuera de bodega')}. `
      + 'Reintente ese, para no registrarlo dos veces.</div>'
      + '<div class="tanques-acciones">'
      + `<button type="button" class="tanques-btn primary" data-igual="pendiente" data-clave="${clave}">`
      + 'Reintentar el pendiente</button>'
      + '<button type="button" class="tanques-btn" data-igual="distinto">'
      + 'Es un movimiento distinto, registrar de nuevo</button>'
      + '</div></div>';
  },

  async _enviar() {
    // A fast double tap on Registrar must not post twice. The server would
    // recognise the repeat by client_id, but only the retry path reuses it.
    if (this._enviando) return;
    const dlg = document.getElementById(ID.dialogo);
    const modelo = this._pendiente;
    if (!dlg || !modelo || !modelo.puedeRegistrar) return;
    if (!this._puedeEscribir()) { dlg.close(); return; }
    const form = dlg.querySelector('form');
    // A date typed and submitted before its change event: the proposal on
    // screen belongs to another date, so plan again and let the user look.
    const campoFecha = form.querySelector('[name="fecha"]');
    if (campoFecha && FECHA_RE.test(campoFecha.value) && campoFecha.value !== modelo.fecha) {
      this._replanear(this._ctx.bodega());
      this._errores(['Se recalculó el movimiento para la fecha nueva. Revise los datos y registre.']);
      return;
    }
    const mov = this._movimientoDelFormulario();

    const errores = erroresDeMovimiento(this._ctx.bodega(), mov);
    if (errores.length) { this._errores(errores); return; }

    // From here until the request is answered this tab is busy, so a double
    // tap waiting on the lock below cannot start a second send.
    this._enviando = true;
    // Before a new key exists: is this the movement an unresolved intent
    // already carries? Only an explicit "es distinto" for THIS payload skips
    // it. The check and the write-down run under one cross-tab lock.
    const sinonimos = DataStore.tanquesSinonimos || {};
    let intento = null, igual = null, guardada = false;
    try {
      await this._enCandado(async () => {
        this._cargarPendientes();
        const yaDicho = this._distintoDe && mismaIntencion(this._distintoDe, mov, sinonimos);
        igual = yaDicho ? null : pendienteIgual(this._pendientes, mov, sinonimos);
        if (igual) return;
        // The key is minted here, not inside DataStore, so the intent can be
        // written down BEFORE the request leaves: a browser that dies mid-flight
        // still knows which key to retry under, and the server answers a repeat
        // of that key with the row it already has instead of a second one.
        intento = { ...mov, client_id: globalThis.crypto.randomUUID() };
        guardada = this._anotarPendiente(intento,
          'No se pudo confirmar el movimiento. Revise la bitácora antes de repetirlo.',
          { enVuelo: true });
      });
    } catch (_) {
      guardada = false;
    }
    if (igual) { this._enviando = false; this._ofrecerPendiente(igual); return; }
    if (!intento || !guardada) { this._enviando = false; this._errores([SIN_CLAVE_GUARDADA]); return; }
    this._claveEnVuelo = intento.client_id;

    const boton = form.querySelector('button[type="submit"]');
    const cancelar = form.querySelector('[data-cerrar]');
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
          clave: (err.movimiento || intento).client_id,
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
      this._claveEnVuelo = null;
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

  async _reintentar(intento, { confirmado = false } = {}) {
    if (this._enviando || !intento) return;
    if (!this._puedeEscribir()) return;
    // Its pending entry is the licence to retry. "Ya la revisé" took it away,
    // and a button that captured the intent earlier (a toast still on screen)
    // must not bring a discarded movement back to life.
    const guardada = this._entradaGuardada(intento.client_id);
    if (!guardada) return;
    // Reconcile against the log before anything leaves. Its own key in the
    // log is the answer (it landed). The same movement under ANOTHER key
    // (a repeat that landed, or a sibling entry's retry) means this retry
    // would most likely be the second row, so it waits for the user to say
    // it is a different movement.
    const log = Array.isArray(DataStore.movimientosTanque) ? DataStore.movimientosTanque : [];
    const clave = String(intento.client_id || '').toLowerCase();
    if (log.some((m) => m && typeof m.client_id === 'string' && m.client_id.toLowerCase() === clave)) {
      this._resolverPendiente(intento.client_id);
      this._avisar('Un movimiento sin confirmar sí quedó registrado. La bitácora ya lo muestra.');
      this._ctx.render();
      return;
    }
    const gemelo = confirmado ? null
      : gemeloEnBitacora(log, intento, DataStore.tanquesSinonimos || {});
    if (gemelo) {
      this._avisar(`La bitácora ya tiene un movimiento igual (registro ${gemelo.id}). `
        + 'Si es el mismo, descarte el aviso pendiente con "Ya la revisé".',
      { etiqueta: 'Es un movimiento distinto, registrar de nuevo',
        clave: intento.client_id,
        fn: () => this._reintentar(intento, { confirmado: true }) });
      this._ctx.render();
      return;
    }
    // The same gate the first send passes: the key is written down, and read
    // back, BEFORE the request leaves. Storage that is blocked or full means
    // nothing would remember this key, so nothing is sent.
    if (!this._anotarPendiente(intento, guardada.mensaje
      || 'No se pudo confirmar el movimiento. Revise la bitácora antes de repetirlo.',
    { enVuelo: true })) {
      this._avisar(SIN_CLAVE_GUARDADA);
      this._ctx.render();
      return;
    }
    this._enviando = true;
    this._claveEnVuelo = intento.client_id;
    let out;
    try {
      // The SAME intent, client_id included: if the first attempt did commit,
      // the server answers with that row instead of writing a second one.
      out = await DataStore.postMovimiento(intento);
    } catch (err) {
      // The entry stays either way. A refusal of THIS request (an expired
      // session, a 409) says nothing about whether the FIRST attempt under
      // this key committed, and dropping the key on that evidence is how the
      // original row gets written a second time later (lucy, 2026-10-15). An
      // entry leaves only on a confirmed write, on finding its key in the
      // bitacora, or when the user says they have checked.
      this._anotarPendiente(err.movimiento || intento,
        err && err.message ? err.message : 'No se pudo confirmar el movimiento.');
      this._avisar(err && err.message ? err.message : 'No se pudo registrar el movimiento.',
        err && err.indeterminado
          ? { etiqueta: 'Reintentar',
            clave: (err.movimiento || intento).client_id,
            fn: () => this._reintentar(err.movimiento || intento) }
          : null);
      this._ctx.render();
      return;
    } finally {
      this._enviando = false;
      this._claveEnVuelo = null;
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
    if (!this._puedeEscribir()) return;
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
    this._toastClave = accion && accion.clave ? String(accion.clave).toLowerCase() : null;
    // Every action a toast offers is a write (Deshacer, Reintentar), so a
    // session that may not write gets the message without the button.
    if (accion && this._puedeEscribir()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tanques-toast-accion';
      b.textContent = accion.etiqueta;
      b.addEventListener('click', () => {
        t.hidden = true;
        if (this._puedeEscribir()) accion.fn();
      });
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
