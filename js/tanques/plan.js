// js/tanques/plan.js - pure bodega-plan layout and colour mapping (no DOM, no I/O).
//
// Everything the Tanques tab needs to decide WHERE a vessel is drawn and WHICH
// token colours its band lives here, so the geometry can be unit-tested without
// a browser (like js/tanques/estado.js and js/mona/dataAccess.js). view.js turns
// these numbers into SVG; it never computes a position of its own.
//
// The plan is an oblique top-down view, north up (SPEC: Mapa de Tanques, and the
// approved mockup state/specs/xd-tanques/mapa-tanques.html):
//   - rows run east-west, A at the north and H at the south, with walkways
//     A | B C | D E | F G | H;
//   - a vessel's floor point is fixed and a taller tank rises toward the north,
//     so drawn height is proportional to capacity and never to contents;
//   - the west strip is the reception and crushing area: rows R (R1, R2) and
//     P (PD-1, PD-2), with the presses to the south;
//   - vessels with no row (area 'otras': CAVA, tibores, Domecq, kegs, VAR) have
//     no confirmed location yet and go to a tray instead of the floor.
//
// Positions come from dim_tanque.fila / dim_tanque.posicion, never from the
// code text: 'H11' is placed because the catalog says row H, position 11.

import { CONFIG } from '../config.js';
import { ETAPAS } from './estado.js';

// Which end of a row holds position 1. The spec records west as an ASSUMPTION
// that Daniel has not confirmed, so it stays one constant: flipping it to
// 'este' mirrors every row (and the reception strip) and nothing else.
export const POSICION_1_AL = 'oeste';

// Row order north to south; null is a walkway. Inner walkways carry no label.
export const FILAS_PLANO = ['A', null, 'B', 'C', null, 'D', 'E', null, 'F', 'G', null, 'H'];

// Reception rows sit beside the fermentation row they share a line with.
const FILA_RECEPCION_EN = { R: 'A', P: 'B' };

// Oblique-projection geometry, ported from the approved mockup.
export const GEOMETRIA = {
  R: 17,        // lid radius, east-west
  RY: 6.5,      // lid radius, north-south (the obliqueness)
  PX: 42,       // spacing between positions in a fermentation row
  PX_REC: 70,   // spacing in the reception strip (wider tanks, fewer of them)
  ROWH: 62,     // spacing between rows
  PASILLO_H: 24,
  H_MIN: 8,     // drawn height of the smallest vessel
  H_MAX: 36,    // drawn height of the largest located vessel
  REC_W: 170,   // width of the reception strip
  X0_REC: 56,   // centre of reception position 1
  MARGEN_SUP: 34,
  MARGEN_INF: 34,
  MARGEN_DER: 24,
};
GEOMETRIA.X0 = GEOMETRIA.REC_W + 58;   // centre of fermentation position 1

/**
 * Drawn height for a capacity. Linear from H_MIN to H_MAX over 0..referencia,
 * so it is monotonic in capacity: a bigger tank is never drawn shorter.
 * `referencia` is the largest located capacity, which keeps the tallest tank at
 * H_MAX without clamping anything below it to the same height.
 */
export function alturaDeCapacidad(capacidad_l, referencia) {
  const { H_MIN, H_MAX } = GEOMETRIA;
  const cap = Number(capacidad_l);
  const ref = Number(referencia);
  if (!Number.isFinite(cap) || cap <= 0) return H_MIN;
  if (!Number.isFinite(ref) || ref <= 0) return H_MIN;
  return H_MIN + (H_MAX - H_MIN) * Math.min(1, cap / ref);
}

function esFilaFermentacion(fila) {
  return typeof fila === 'string' && /^[A-H]$/.test(fila);
}

/**
 * Lay the catalog out on the floor.
 * @param {Array} tanques dim_tanque rows ({codigo, fila, posicion, capacidad_l, tipo, area, activo, orden})
 * @param {Object} [opciones] {direccion: 'oeste'|'este'}
 * @returns {{ancho:number, alto:number, filas:Array, pasillos:Array, ubicados:Array, otras:Array, sinUbicar:Array, referencia_l:number}}
 *   filas     - [{letra, y}] for the row letter gutter, north to south
 *   pasillos  - y of each inner walkway strip
 *   ubicados  - [{codigo, capacidad_l, fila, posicion, area, tipo, activo, x, y, altura}]
 *               y is the FLOOR point; the lid sits at y - altura
 *   otras     - catalog rows with no location, in catalog order (the tray)
 *   sinUbicar - codes the catalog claims are located but could not be placed
 */
export function construirPlano(tanques, opciones = {}) {
  const direccion = opciones.direccion === 'este' ? 'este' : 'oeste';
  const filas = Array.isArray(tanques) ? tanques : [];
  const G = GEOMETRIA;

  const y = Object.create(null);
  const pasillos = [];
  const orden = [];
  let cursor = G.MARGEN_SUP + G.PASILLO_H;
  for (const letra of FILAS_PLANO) {
    if (letra) {
      y[letra] = cursor + G.H_MAX + G.RY + 6;
      orden.push({ letra, y: y[letra] });
      cursor += G.ROWH;
    } else {
      pasillos.push(cursor);
      cursor += G.PASILLO_H;
    }
  }

  const colocables = [];
  const otras = [];
  const sinUbicar = [];
  for (const t of filas) {
    const codigo = typeof t?.codigo === 'string' ? t.codigo.trim() : '';
    if (!codigo) continue;
    const fila = typeof t.fila === 'string' ? t.fila.trim().toUpperCase() : null;
    const posicion = Number(t.posicion);
    const base = {
      codigo,
      capacidad_l: Number(t.capacidad_l) || 0,
      fila: fila || null,
      posicion: Number.isInteger(posicion) && posicion > 0 ? posicion : null,
      area: typeof t.area === 'string' ? t.area : null,
      tipo: typeof t.tipo === 'string' ? t.tipo : null,
      activo: t.activo !== false,
    };
    if (!base.fila || base.posicion === null) { otras.push(base); continue; }
    if (!esFilaFermentacion(base.fila) && !Object.hasOwn(FILA_RECEPCION_EN, base.fila)) {
      // The catalog CHECK allows A-H, R and P only; anything else is a schema
      // change the plan does not know how to draw. Reported, never dropped.
      sinUbicar.push(codigo);
      continue;
    }
    colocables.push(base);
  }

  // Height reference and row width come from what is actually on the floor, so
  // the plan neither flattens a tank bigger than the mockup's 18 700 L nor
  // reserves room for a column that does not exist.
  let referencia = 0;
  let maxFerm = 0;
  let maxRec = 0;
  for (const t of colocables) {
    if (t.capacidad_l > referencia) referencia = t.capacidad_l;
    if (esFilaFermentacion(t.fila)) { if (t.posicion > maxFerm) maxFerm = t.posicion; }
    else if (t.posicion > maxRec) maxRec = t.posicion;
  }
  if (referencia <= 0) referencia = 1;

  const ubicados = [];
  for (const t of colocables) {
    const ferm = esFilaFermentacion(t.fila);
    const x0 = ferm ? G.X0 : G.X0_REC;
    const paso = ferm ? G.PX : G.PX_REC;
    const max = ferm ? maxFerm : maxRec;
    const indice = direccion === 'este' ? (max - t.posicion) : (t.posicion - 1);
    const letra = ferm ? t.fila : FILA_RECEPCION_EN[t.fila];
    ubicados.push({
      ...t,
      x: x0 + indice * paso,
      y: y[letra],
      altura: alturaDeCapacidad(t.capacidad_l, referencia),
    });
  }

  return {
    ancho: G.X0 + Math.max(0, maxFerm - 1) * G.PX + G.R + G.MARGEN_DER,
    alto: cursor + G.MARGEN_INF,
    filas: orden,
    pasillos,
    ubicados,
    otras,
    sinUbicar,
    referencia_l: referencia,
  };
}

// --- lote route --------------------------------------------------------------

/**
 * A lote's route as a list of CHAINS, not one line.
 *
 * A lote does not always move along a single path: receive 6 000 L into A1,
 * send 2 000 to B1 and another 2 000 to C1, and the steps are A1 to B1 and A1
 * to C1. Stringing every endpoint together with only adjacent de-duplication
 * draws A1 > B1 > A1 > C1, which claims a B1 to C1 journey that never happened.
 * So a new chain starts whenever a step does not leave where the last one
 * arrived, and each chain is a true sequence of moves.
 *
 * @param {Array} pasos recorridoLote(...).pasos, oldest first
 * @returns {Array<{entrada: boolean, salida: boolean, codigos: string[]}>}
 *   entrada - the chain opens with a reception (the lote arrived from outside)
 *   salida  - the chain ends with the lote leaving the bodega
 */
export function cadenasRecorrido(pasos) {
  const cadenas = [];
  let actual = null;
  for (const paso of Array.isArray(pasos) ? pasos : []) {
    const desde = paso?.origen || null;
    const hasta = paso?.destino || null;
    const cola = actual && actual.codigos.length ? actual.codigos[actual.codigos.length - 1] : null;
    if (!actual || actual.salida || cola !== desde) {
      actual = { entrada: !desde, salida: false, codigos: [] };
      cadenas.push(actual);
      if (desde) actual.codigos.push(desde);
    }
    if (hasta) actual.codigos.push(hasta);
    else actual.salida = true;
  }
  return cadenas.filter((c) => c.codigos.length || c.salida);
}

// --- dates -------------------------------------------------------------------

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * A movement's `fecha` as '12 oct 25'.
 *
 * `fecha` is a DATE column and must never go through `new Date()`: that parses
 * 'YYYY-MM-DD' as UTC midnight, and the vineyard runs on America/Tijuana, where
 * UTC midnight is still the previous day for seven hours of every day. The same
 * trap already cost this repo a medicion filed under tomorrow (utils.js), so the
 * parts are read off the string and nothing here depends on the host timezone.
 * Returns '' for anything that is not a date.
 */
export function fechaCorta(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim().slice(0, 10));
  if (!m) return '';
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return '';
  return `${dia} ${MESES[mes - 1]} ${m[1].slice(2)}`;
}

// --- colour ------------------------------------------------------------------

export const MODOS = ['variedad', 'etapa', 'ocupacion'];

export const MODO_ETIQUETAS = {
  variedad: 'Variedad',
  etapa: 'Etapa',
  ocupacion: 'Ocupación',
};

// Stage labels, in the order js/tanques/estado.js replays them.
export const ETAPA_ETIQUETAS = {
  rec: 'Recepción',
  mac: 'Maceración',
  fa: 'Ferm. alcohólica',
  des: 'Descube',
  fml: 'FML',
  cri: 'Crianza',
  emb: 'Listo embot.',
};

// The seven-step bar in the side panel gets about 48px per step, which is not
// enough for 'Ferm. alcohólica'. The bar uses these; the full name stays on the
// step's title attribute and in the legend.
export const ETAPA_ABREV = {
  rec: 'Rec', mac: 'Mac', fa: 'FA', des: 'Desc', fml: 'FML', cri: 'Cri', emb: 'Emb',
};

// Variety colour tokens. The eleven Daniel approved on the mockup, plus the
// varieties CONFIG.varietyAbbr can produce that the mockup never showed; the
// design tokens live in css/styles.css and tests/mt53-tanques-plan.test.mjs
// asserts every abbreviation in the catalog resolves to one that exists.
// 'Rosado' has no lot-code abbreviation yet, so nothing maps to --tank-v-ro.
export const TOKEN_VARIEDAD = {
  'Cabernet Sauvignon': '--tank-v-cs',
  'Cabernet Franc': '--tank-v-cf',
  'Merlot': '--tank-v-me',
  'Syrah': '--tank-v-sy',
  'Durif': '--tank-v-du',
  'Tempranillo': '--tank-v-te',
  'Petit Verdot': '--tank-v-pv',
  'Malbec': '--tank-v-ma',
  'Sauvignon Blanc': '--tank-v-sb',
  'Chardonnay': '--tank-v-ch',
  'Rosado': '--tank-v-ro',
  'Grenache': '--tank-v-gr',
  'Caladoc': '--tank-v-ca',
  'Marselan': '--tank-v-ms',
  'Nebbiolo': '--tank-v-nb',
  'Mourvèdre': '--tank-v-mv',
  'Viognier': '--tank-v-vg',
  'Chenin Blanc': '--tank-v-cb',
};

export const TOKEN_VARIEDAD_OTRA = '--tank-v-otra';
export const TOKEN_VACIO = '--tank-steel-top';
// A tank that HOLDS wine whose stage the log cannot say must not be painted the
// same as an empty one. movimientos_tanque has no `etapa` column today, so only
// recepcion and descube name a stage (ETAPA_POR_TIPO) and everything else lands
// here: the colour has to read as "not recorded", not as "nothing in it".
export const TOKEN_ETAPA_ND = '--tank-s-nd';
export const ETAPA_ND_ETIQUETA = 'Etapa sin registrar';

// Each bucket's bound matches its own label exactly: 'Lleno (>95%)' is strict,
// '60 a 95%' includes 60. The mockup used `f > 0.6` for the middle bucket, which
// put a tank filled to exactly 60 percent in the '<60%' colour while the legend
// said otherwise; one of the two had to give, and the label is what a user reads.
export const NIVELES_OCUPACION = [
  { clave: 'lleno', etiqueta: 'Lleno (>95%)', token: '--tank-ocu-lleno', min: 0.95, inclusivo: false },
  { clave: 'medio', etiqueta: '60 a 95%', token: '--tank-ocu-medio', min: 0.60, inclusivo: true },
  { clave: 'bajo', etiqueta: '<60% (merma o espacio de cabeza)', token: '--tank-ocu-bajo', min: 0, inclusivo: true },
];

/** The variety abbreviations the dashboard knows, longest first. */
const ABREVIATURAS = Object.keys(CONFIG.varietyAbbr).sort((a, b) => b.length - a.length);

/**
 * The varietal a wine lot code names, or null when the code does not say.
 *
 * Wine lot codes are {vintage}{variedad}{rancho}-{sufijo} ('25CSKMP-5'), and
 * berry-dialect codes are K{variedad}-{sufijo} ('KCF-S1-PA'). Both are read
 * through CONFIG.varietyAbbr rather than a second parser, so a new abbreviation
 * is added in one place (CONFIG) and both dialects pick it up.
 * Returns the FULL varietal name CONFIG.varietyColors keys on.
 */
export function variedadDeLote(lot_code) {
  if (!lot_code) return null;
  let resto = String(lot_code).trim().toUpperCase().replace(/^\d{2}/, '');
  // Berry dialect: the K is the ranch (Kompali), the variety follows it.
  if (/^K[A-Z]{2,4}-/.test(resto)) resto = resto.slice(1);
  // Longest first, so 'MARVDG-1' reads as Marselan (MAR) and not Malbec (MA).
  for (const abr of ABREVIATURAS) {
    if (resto.startsWith(abr)) return CONFIG.normalizeVariety(CONFIG.varietyAbbr[abr]);
  }
  return null;
}

/** The design token that colours a variety's band ('--tank-v-otra' if unknown). */
export function tokenVariedad(nombre) {
  if (!nombre) return TOKEN_VARIEDAD_OTRA;
  return TOKEN_VARIEDAD[nombre] || TOKEN_VARIEDAD_OTRA;
}

/** The design token for a stage code, or the "not recorded" token if unset. */
export function tokenEtapa(etapa) {
  return ETAPAS.includes(etapa) ? `--tank-s-${etapa}` : TOKEN_ETAPA_ND;
}

/** Fill level bucket for the Ocupación mode. */
export function nivelOcupacion(litros, capacidad_l) {
  const cap = Number(capacidad_l);
  const l = Number(litros);
  const f = (Number.isFinite(cap) && cap > 0 && Number.isFinite(l)) ? l / cap : 0;
  return NIVELES_OCUPACION.find((n) => (n.inclusivo ? f >= n.min : f > n.min))
    || NIVELES_OCUPACION[NIVELES_OCUPACION.length - 1];
}

/**
 * The token that colours one part of one tank's liquid band.
 * @param {string} modo 'variedad' | 'etapa' | 'ocupacion'
 * @param {Object} tanque derived state ({litros, capacidad_l, etapa})
 * @param {Object} [parte] the {lot_code, litros} slice being drawn
 */
export function tokenBanda(modo, tanque, parte) {
  if (modo === 'etapa') return tokenEtapa(tanque?.etapa);
  if (modo === 'ocupacion') return nivelOcupacion(tanque?.litros, tanque?.capacidad_l).token;
  return tokenVariedad(variedadDeLote(parte?.lot_code));
}
