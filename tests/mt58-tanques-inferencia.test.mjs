// mt58 - the lab inference: trasiegos proposed from wine_samples.vessel_id.
// Bead xd-qrn.6. Spec: state/specs/xd-tanques/SPEC.md, "Lab inference".
//
// The fixture is production data, copied out of wine_samples on 2026-10-15 for
// the two lotes the bead's DoD names (25CSKMP-4 and 25DUKMP-3) plus the three
// shapes that make a naive reading of the same data invent movements:
//
//   23CSLLC-15  one lote in E6 AND F3 for five months, with only one of the two
//               sampled on most days: "the vessel changed between consecutive
//               samples" reads that as a trasiego, and then as one back.
//   24CFVA-1    F9 the whole time, with the occasional barrel sample (BCA)
//               in between: BCA is not a tank, and a day that names no tank
//               must say nothing about tanks.
//   DELETE PLEASE  a row the lab left in the table. Not a lot code, so not a
//               proposal (DoD).
//
// Everything here is pure data in and data out: no DOM, no network, no clock.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIGRATIONS } from '../js/migrations-manifest.js';
import {
  inferirMovimientos,
  clavePropuesta,
  normalizarVasija,
  resolverVasija,
  vendimiaDeCodigo,
  esCodigoDeLote,
} from '../js/tanques/inferencia.js';

// --- the bodega ---------------------------------------------------------------

const CODIGOS = ['A2', 'A4', 'B4', 'D1', 'D5', 'E1', 'E5', 'E6', 'F3', 'F9', 'H8', 'PD-1', 'TIBOR 13'];
const CATALOGO = CODIGOS.map((codigo, i) => ({
  codigo, capacidad_l: 20000, tipo: 'TQ', area: 'fermentacion', activo: true, orden: i + 1,
}));
// The three alias families production actually writes (migration_tanques.sql).
const SINONIMOS = { PD1: 'PD-1', 'PD 1': 'PD-1', TIB13: 'TIBOR 13', 'TIB 13': 'TIBOR 13' };

const BODEGA = { catalogo: CATALOGO, sinonimos: SINONIMOS, movimientos: [] };

// A wine_samples row as DataStore.wineRecepcion carries it: `tanque` is
// vessel_id and `fecha` is sample_date (a plain YYYY-MM-DD string from
// Supabase, see dataLoader._rowToWine).
function m(codigoBodega, fecha, tanque, extra = {}) {
  return { codigoBodega, fecha, tanque, vintage: 2025, sampleType: 'Must', ...extra };
}

/** One row per day over an inclusive range of days in one month. */
function dias(codigoBodega, mes, desde, hasta, tanque, extra) {
  const out = [];
  for (let d = desde; d <= hasta; d++) {
    out.push(m(codigoBodega, `${mes}-${String(d).padStart(2, '0')}`, tanque, extra));
  }
  return out;
}

// --- the production fixture ---------------------------------------------------

// 25CSKMP-4: D5 to 2025-11-11, E1 from 2025-11-12 to 11-21, H8 from 2025-12-01.
const CSKMP4 = [
  ...dias('25CSKMP-4', '2025-10', 30, 31, 'D5'),
  ...dias('25CSKMP-4', '2025-11', 1, 11, 'D5'),
  ...dias('25CSKMP-4', '2025-11', 12, 21, 'E1', { sampleType: 'Young Wine' }),
  m('25CSKMP-4', '2025-12-01', 'H8', { sampleType: 'Young Wine' }),
  m('25CSKMP-4', '2026-01-05', 'H8', { sampleType: 'Young Wine' }),
  m('25CSKMP-4', '2026-02-03', 'H8', { sampleType: 'Young Wine' }),
];

// 25DUKMP-3: D5, D1, E5, B4 - four vessels, four clean windows.
const DUKMP3 = [
  ...dias('25DUKMP-3', '2025-10', 12, 17, 'D5'),
  m('25DUKMP-3', '2025-10-18', 'D1'),
  ...dias('25DUKMP-3', '2025-10', 19, 20, 'D1', { sampleType: 'Young Wine' }),
  ...dias('25DUKMP-3', '2025-10', 21, 22, 'E5', { sampleType: 'Young Wine' }),
  ...dias('25DUKMP-3', '2025-10', 23, 25, 'B4', { sampleType: 'Young Wine' }),
  m('25DUKMP-3', '2025-12-01', 'B4', { sampleType: 'Young Wine' }),
];

// 23CSLLC-15: in E6 and F3 at the same time, sampled one at a time.
const CSLLC15 = [
  m('23CSLLC-15', '2025-02-26', 'E6', { vintage: 2023, sampleType: 'Aging Wine' }),
  m('23CSLLC-15', '2025-02-27', 'F3', { vintage: 2023, sampleType: 'Aging Wine' }),
  m('23CSLLC-15', '2025-04-04', 'E6', { vintage: 2023, sampleType: 'Aging Wine' }),
  m('23CSLLC-15', '2025-04-04', 'F3', { vintage: 2023, sampleType: 'Aging Wine' }),
  m('23CSLLC-15', '2025-06-20', 'BCA', { vintage: 2023, sampleType: 'Aging Wine' }),
  m('23CSLLC-15', '2025-07-10', 'E6', { vintage: 2023, sampleType: 'Aging Wine' }),
  m('23CSLLC-15', '2025-07-10', 'F3', { vintage: 2023, sampleType: 'Aging Wine' }),
];

// 24CFVA-1: F9 throughout, with barrel samples on two days in between.
const CFVA1 = [
  m('24CFVA-1', '2025-02-27', 'F9', { vintage: 2024, sampleType: 'Aging Wine' }),
  m('24CFVA-1', '2025-06-04', 'F9', { vintage: 2024, sampleType: 'Aging Wine' }),
  m('24CFVA-1', '2025-06-20', 'BCA', { vintage: 2024, sampleType: 'Aging Wine' }),
  m('24CFVA-1', '2025-07-10', 'F9', { vintage: 2024, sampleType: 'Aging Wine' }),
  m('24CFVA-1', '2025-07-20', 'BCA', { vintage: 2024, sampleType: 'Aging Wine' }),
  m('24CFVA-1', '2025-09-01', 'F9', { vintage: 2024, sampleType: 'Aging Wine' }),
];

// Rows the lab left in wine_samples. Real ids, real vessels, no lot code.
const BASURA = [
  m('DELETE PLEASE', '2025-10-04', 'E1'),
  m('DELETE PLEASE', '2025-10-05', 'F8'),
  m('DELETE PLEASER', '2025-10-06', 'H8'),
  m('Control', '2025-09-11', 'D5'),
];

const MUESTRAS = [...CSKMP4, ...DUKMP3, ...CSLLC15, ...CFVA1, ...BASURA];

const ruta = (propuestas) => propuestas.map((p) => `${p.origen}>${p.destino}@${p.fecha}`);
const deLote = (out, lote) => out.propuestas.filter((p) => p.lot_code === lote);

// --- the DoD outcome ----------------------------------------------------------

describe('mt58 - propuestas sobre datos de produccion', () => {
  const out = inferirMovimientos(MUESTRAS, BODEGA);

  test('25CSKMP-4: D5 a E1 el 2025-11-12 y E1 a H8 el 2025-12-01', () => {
    assert.deepEqual(ruta(deLote(out, '25CSKMP-4')), ['D5>E1@2025-11-12', 'E1>H8@2025-12-01']);
  });

  test('25DUKMP-3: la ruta D5, D1, E5, B4', () => {
    assert.deepEqual(ruta(deLote(out, '25DUKMP-3')),
      ['D5>D1@2025-10-18', 'D1>E5@2025-10-21', 'E5>B4@2025-10-23']);
  });

  test('cada propuesta lleva la vendimia del codigo y su clave estable', () => {
    const p = deLote(out, '25CSKMP-4')[0];
    assert.equal(p.vintage_year, 2025);
    assert.equal(p.clave, '25CSKMP-4|D5|E1|2025-11-12');
    assert.equal(p.clave, clavePropuesta(p));
  });

  test('la propuesta lleva la evidencia: cuantas muestras y hasta cuando', () => {
    const p = deLote(out, '25CSKMP-4')[0];
    assert.equal(p.muestras_origen, 13);   // 10-30, 10-31 y 11-01 a 11-11
    assert.equal(p.muestras_destino, 10);  // 11-12 a 11-21
    assert.equal(p.origen_desde, '2025-10-30');
    assert.equal(p.origen_hasta, '2025-11-11');
    assert.equal(p.destino_hasta, '2025-11-21');
  });

  test('las propuestas salen en orden de fecha: un trasiego no se registra antes del que lo lleno', () => {
    const fechas = out.propuestas.map((p) => p.fecha);
    assert.deepEqual(fechas, [...fechas].sort());
  });

  test('los ids que no son codigo de lote se ignoran, no se proponen', () => {
    for (const id of ['DELETE PLEASE', 'DELETE PLEASER', 'Control']) {
      assert.equal(deLote(out, id).length, 0, id);
    }
    assert.equal(vendimiaDeCodigo('DELETE PLEASE'), null);
    assert.equal(vendimiaDeCodigo('Control'), null);
    assert.equal(vendimiaDeCodigo('25CSKMP-4'), 2025);
    // A two-digit prefix outside the vendimia window is not a vendimia either.
    assert.equal(vendimiaDeCodigo('99XX-1'), null);
  });

  test('un prefijo numerico no basta: "25 DELETE PLEASE" no es un lote', () => {
    for (const id of ['25 DELETE PLEASE', '25', 'DELETE PLEASE', 'DELETE PLEASER', 'Control',
      '25-1', '2', '', null, '25CS KMP-4', '99CS-1']) {
      assert.equal(esCodigoDeLote(id), false, JSON.stringify(id));
    }
    const basura = [m('25 DELETE PLEASE', '2025-10-01', 'D5'), m('25 DELETE PLEASE', '2025-10-02', 'E1')];
    const r = inferirMovimientos(basura, BODEGA);
    assert.deepEqual(r.propuestas, []);
    assert.equal(r.resumen.muestras, 0, 'ni siquiera cuenta para la cobertura');
  });

  test('los codigos reales de produccion siguen siendo lotes', () => {
    // Los ids del fixture, el corpus de produccion de mt53 (incluidos los que
    // variedadDeLote no puede colorear: los 2026 con el rancho primero) y las
    // formas raras que la tabla de verdad trae.
    const reales = [
      '25CSKMP-4', '25DUKMP-3', '23CSLLC-15', '24CFVA-1',
      '25CSKMP-5', '24CSVDG-1', '25SY7L-1', '25SYDA-13', '25MADUB-1', '23CSLLC-11',
      '23CSMX-1B', '23CSOLE-1', '24CSON-1', '24CSCC-1', '24MEUVA-1',
      '23MALBECMX-1', '23MERLOTMX-1', '26TEMPON5', '26GRENON6',
      '26SBMX1A-C', '26CSOLE1', '26SYVA1B', '26CALMX1E', '26CB7L1', '26GRENVA3A', '26MERVA1A',
      '22CSCORTE1', '22cscorte2', '24SYUCORG-1', '25CFKMPP-1',
      '25KCS-S2B-ALIVIO', '26KCH-S5SALT', '25KMS-S5A+', '25KDU-S7',
      '26R14CS', '26R14GRE', '26R14ME', '26R14SB', '26R14TE',
      '24MEVA-1?', '25SYVA-1D,2C,3C,4C',
    ];
    for (const id of reales) assert.equal(esCodigoDeLote(id), true, id);
  });
});

// --- what the samples refuse to name ------------------------------------------

describe('mt58 - lo que las muestras NO convierten en movimiento', () => {
  const out = inferirMovimientos(MUESTRAS, BODEGA);

  test('un lote en dos tanques a la vez no propone nada: es traslape', () => {
    assert.equal(deLote(out, '23CSLLC-15').length, 0);
    const t = out.traslapes.filter((x) => x.lot_code === '23CSLLC-15');
    assert.equal(t.length, 1);
    assert.deepEqual([t[0].a, t[0].b], ['E6', 'F3']);
  });

  test('un dia que solo nombra una vasija sin tanque no dice nada de los tanques', () => {
    // 24CFVA-1 esta en F9 todo el tiempo, con muestras de barrica en medio.
    assert.equal(deLote(out, '24CFVA-1').length, 0);
    assert.equal(out.traslapes.filter((x) => x.lot_code === '24CFVA-1').length, 0);
  });

  test('BCA se reporta aparte, con sus lotes y fechas, y nunca se adivina', () => {
    const bca = out.sinResolver.find((e) => e.vessel_id === 'BCA');
    assert.ok(bca, 'BCA tiene que aparecer en sinResolver');
    assert.equal(bca.muestras, 3);
    assert.deepEqual(bca.lotes, ['23CSLLC-15', '24CFVA-1']);
    assert.equal(bca.desde, '2025-06-20');
    assert.equal(bca.hasta, '2025-07-20');
    // y ninguna propuesta la nombra
    for (const p of out.propuestas) {
      assert.notEqual(p.origen, 'BCA');
      assert.notEqual(p.destino, 'BCA');
    }
  });

  test('el resumen mide la cobertura que pide el stop-when de la spec', () => {
    assert.equal(out.resumen.muestras_sin_tanque, 3);
    assert.ok(out.resumen.muestras > 50);
    assert.ok(out.resumen.fraccion_sin_tanque < 0.2,
      `${out.resumen.fraccion_sin_tanque} de las muestras no resuelve a un tanque`);
  });

  test('una vasija muestreada el MISMO dia que otra dentro de su estancia es traslape', () => {
    // A4 del 18 al 22, A2 el 20 junto con A4: el lote estuvo en las dos ese dia.
    const muestras = [
      ...dias('25TEKMP-2', '2025-10', 10, 16, 'E1'),
      m('25TEKMP-2', '2025-10-18', 'A4'),
      m('25TEKMP-2', '2025-10-19', 'A4'),
      m('25TEKMP-2', '2025-10-20', 'A4'),
      m('25TEKMP-2', '2025-10-20', 'A2'),
      m('25TEKMP-2', '2025-10-21', 'A4'),
      m('25TEKMP-2', '2025-10-22', 'A4'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), ['E1>A4@2025-10-18']);
    assert.deepEqual(r.traslapes.map((t) => [t.a, t.b]), [['A4', 'A2']]);
  });
});

// --- already recorded ---------------------------------------------------------

describe('mt58 - propuestas que la bitacora ya cubre', () => {
  let seq = 0;
  const mov = (o) => ({
    id: ++seq,
    fecha: '2025-11-12',
    tipo: 'trasiego',
    origen: 'D5',
    destino: 'E1',
    lot_code: '25CSKMP-4',
    vintage_year: 2025,
    volumen_l: 6400,
    merma_l: 0,
    nota: null,
    fuente: 'lab',
    anulado: false,
    ...o,
  });

  const con = (movimientos) =>
    inferirMovimientos(MUESTRAS, { ...BODEGA, movimientos });

  test('un movimiento registrado quita su propuesta y deja las demas', () => {
    const r = con([mov()]);
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['E1>H8@2025-12-01']);
  });

  test('la fecha corregida en el dialogo sigue cubriendo la propuesta', () => {
    // La propuesta es del 12 (primer dia muestreado en E1); el trasiego real
    // fue el 11. Si la fecha contara, la propuesta volveria a la bandeja y
    // alguien registraria el mismo trasiego dos veces.
    const r = con([mov({ fecha: '2025-11-11' })]);
    assert.equal(deLote(r, '25CSKMP-4').length, 1);
    assert.equal(deLote(r, '25CSKMP-4')[0].origen, 'E1');
  });

  test('un descube o una prensa entre los mismos tanques tambien la cubre', () => {
    const r = con([mov({ tipo: 'descube' })]);
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['E1>H8@2025-12-01']);
  });

  test('un movimiento anulado no cubre nada: vuelve a la bandeja', () => {
    const r = con([mov({ anulado: true })]);
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['D5>E1@2025-11-12', 'E1>H8@2025-12-01']);
  });

  test('un viaje ANTERIOR por la misma ruta no tapa el de ahora', () => {
    // El lote fue D5 a E1 en septiembre, volvio, y en noviembre lo hizo otra
    // vez. Las dos filas de septiembre estan en la bitacora y ninguna muestra
    // de septiembre existe, asi que las ventanas de muestreo no se traslapan:
    // la propuesta de noviembre es un movimiento de verdad sin registrar, y
    // comparar sin fecha lo escondia (lucy, 2026-10-15).
    const r = con([
      mov({ fecha: '2025-09-01' }),
      mov({ fecha: '2025-09-02', origen: 'E1', destino: 'D5' }),
    ]);
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['D5>E1@2025-11-12', 'E1>H8@2025-12-01']);
  });

  test('una fila posterior a toda la evidencia tampoco la cubre', () => {
    // La ultima muestra en E1 es del 21 de noviembre; un trasiego registrado en
    // 2026 es otro viaje, no este.
    const r = con([mov({ fecha: '2026-03-01' })]);
    assert.ok(deLote(r, '25CSKMP-4').some((p) => p.destino === 'E1'));
  });

  test('solo una fecha DENTRO de la transicion la cubre', () => {
    // La transicion va de la ultima muestra en el origen (11-11) a la primera
    // en el destino (11-12), las dos incluidas.
    for (const fecha of ['2025-11-11', '2025-11-12']) {
      const r = con([mov({ fecha })]);
      assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['E1>H8@2025-12-01'], fecha);
    }
    // Antes, el lote seguia en D5; despues, ya estaba en E1: otro viaje.
    for (const fecha of ['2025-10-29', '2025-10-30', '2025-11-10', '2025-11-13', '2025-11-21']) {
      const r = con([mov({ fecha })]);
      assert.equal(deLote(r, '25CSKMP-4').length, 2, fecha);
    }
  });

  test('un viaje de ida y vuelta DENTRO de las estancias no tapa el trasiego sin registrar', () => {
    // D5 de 10-30 a 11-11 y E1 de 11-12 a 11-21. La bitacora tiene D5 a E1 el
    // 11-01 y E1 a D5 el 11-02: un viaje redondo que termina en D5, asi que el
    // trasiego del 11-12 sigue sin registrar. Medir contra las estancias
    // completas lo escondia (lucy, 2026-10-15).
    const r = con([
      mov({ fecha: '2025-11-01' }),
      mov({ fecha: '2025-11-02', origen: 'E1', destino: 'D5' }),
    ]);
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['D5>E1@2025-11-12', 'E1>H8@2025-12-01']);
  });

  test('un movimiento deshecho DENTRO de la transicion no la cubre', () => {
    const deshecho = con([
      mov({ fecha: '2025-11-11' }),
      mov({ fecha: '2025-11-12', origen: 'E1', destino: 'D5' }),
    ]);
    assert.equal(deLote(deshecho, '25CSKMP-4').length, 2);
    // El mismo dia cuenta el orden de la bitacora: ida y luego vuelta deshace,
    assert.equal(deLote(con([
      mov({ fecha: '2025-11-12' }),
      mov({ fecha: '2025-11-12', origen: 'E1', destino: 'D5' }),
    ]), '25CSKMP-4').length, 2);
    // vuelta y luego ida no.
    assert.equal(deLote(con([
      mov({ fecha: '2025-11-12', origen: 'E1', destino: 'D5' }),
      mov({ fecha: '2025-11-12' }),
    ]), '25CSKMP-4').length, 1);
    // y una vuelta FUERA de la transicion no deshace nada
    assert.equal(deLote(con([
      mov({ fecha: '2025-11-12' }),
      mov({ fecha: '2025-11-20', origen: 'E1', destino: 'D5' }),
    ]), '25CSKMP-4').length, 1);
  });

  test('un movimiento con los mismos tanques y OTRO lote no cubre la propuesta', () => {
    const r = con([mov({ lot_code: '25DUKMP-9' })]);
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['D5>E1@2025-11-12', 'E1>H8@2025-12-01']);
  });

  test('una recepcion en el origen no cubre nada: no es el trasiego', () => {
    const r = con([mov({ tipo: 'recepcion', origen: null, destino: 'D5' })]);
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['D5>E1@2025-11-12', 'E1>H8@2025-12-01']);
  });

  test('la bitacora se compara con los alias resueltos', () => {
    const muestras = [
      ...dias('25CSVDG-1', '2025-09', 20, 25, 'D5'),
      ...dias('25CSVDG-1', '2025-09', 26, 30, 'PD1'),
    ];
    const sin = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(sin.propuestas), ['D5>PD-1@2025-09-26']);
    // La bitacora guarda el codigo canonico; un cliente viejo pudo guardar el
    // alias. Las dos formas cubren la propuesta.
    for (const destino of ['PD-1', 'PD1']) {
      const r = inferirMovimientos(muestras, {
        ...BODEGA,
        movimientos: [mov({
          origen: 'D5', destino, lot_code: '25CSVDG-1', fecha: '2025-09-26',
        })],
      });
      assert.equal(r.propuestas.length, 0, destino);
    }
  });
});

// --- dismissals ---------------------------------------------------------------

describe('mt58 - descartes', () => {
  test('una propuesta descartada no vuelve', () => {
    const r = inferirMovimientos(MUESTRAS, BODEGA,
      { descartadas: ['25CSKMP-4|D5|E1|2025-11-12'] });
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['E1>H8@2025-12-01']);
  });

  test('un descarte solo calla su propia propuesta', () => {
    const r = inferirMovimientos(MUESTRAS, BODEGA,
      { descartadas: ['25CSKMP-4|D5|E1|2025-11-12'] });
    assert.equal(deLote(r, '25DUKMP-3').length, 3);
  });

  test('una clave de otra propuesta no calla esta', () => {
    const r = inferirMovimientos(MUESTRAS, BODEGA,
      { descartadas: ['25CSKMP-4|D5|E1|2025-11-13', '25CSKMP-4|D5|E2|2025-11-12'] });
    assert.equal(deLote(r, '25CSKMP-4').length, 2);
  });

  test('la clave no deja que dos propuestas se confundan al unirse sus partes', () => {
    const a = clavePropuesta({ lot_code: '25CS-1', origen: 'D5', destino: 'E1', fecha: '2025-11-12' });
    const b = clavePropuesta({ lot_code: '25CS-1|D5', origen: 'E1', destino: '2025-11-12', fecha: '' });
    assert.notEqual(a, b);
  });

  test('un | en el codigo de lote da una clave de cuatro partes que se puede descartar', () => {
    // Un codigo escrito a mano puede traer '|'. Unido sin codificar daba cinco
    // partes, el servidor la rechazaba y la propuesta no se podia descartar.
    const p = { lot_code: '25CS|1', origen: 'TIBOR 13', destino: 'E1', fecha: '2025-11-12' };
    const c = clavePropuesta(p);
    const partes = c.split('|');
    assert.equal(partes.length, 4);
    assert.deepEqual(partes.map(decodeURIComponent), ['25CS|1', 'TIBOR 13', 'E1', '2025-11-12']);
    // Cada parte es su propia forma canonica: la regla que aplica api/tanques.js.
    for (const x of partes) assert.equal(encodeURIComponent(decodeURIComponent(x)), x);

    const muestras = [...dias('25CS|1', '2025-11', 1, 3, 'D5'), ...dias('25CS|1', '2025-11', 4, 6, 'E1')];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.equal(r.propuestas.length, 1);
    assert.equal(r.propuestas[0].clave.split('|').length, 4);
    const otra = inferirMovimientos(muestras, BODEGA, { descartadas: [r.propuestas[0].clave] });
    assert.equal(otra.propuestas.length, 0);
  });
});

// --- resolving a vessel id the lab typed --------------------------------------

describe('mt58 - resolver un vessel_id', () => {
  const codigos = Object.create(null);
  for (const c of CODIGOS) codigos[c.toUpperCase()] = c;

  test('colapsa espacios y pasa a mayusculas antes de buscar', () => {
    assert.equal(normalizarVasija('  tibor   13 '), 'TIBOR 13');
    assert.equal(resolverVasija('tibor  13', codigos, SINONIMOS), 'TIBOR 13');
    assert.equal(resolverVasija('tib 13', codigos, SINONIMOS), 'TIBOR 13');
    assert.equal(resolverVasija('TIB13', codigos, SINONIMOS), 'TIBOR 13');
    assert.equal(resolverVasija('pd1', codigos, SINONIMOS), 'PD-1');
  });

  test('lo que el catalogo no tiene devuelve vacio, nunca una suposicion', () => {
    for (const ref of ['BIN', 'BCA', 'C9', 'FI', 'TIBOR 17', 'F036', '200', '']) {
      assert.equal(resolverVasija(ref, codigos, SINONIMOS), '', ref);
    }
  });

  test('un sinonimo que apunta a un codigo que ya no existe no resuelve', () => {
    assert.equal(resolverVasija('TIB99', codigos, { TIB99: 'TIBOR 99' }), '');
  });

  test('una referencia con nombre de propiedad de Object no toca el prototipo', () => {
    for (const ref of ['__proto__', 'toString', 'constructor']) {
      assert.equal(resolverVasija(ref, codigos, SINONIMOS), '', ref);
    }
  });
});

// --- junk in, nothing out -----------------------------------------------------

describe('mt58 - entradas que no se pueden leer', () => {
  test('sin catalogo no se propone nada: todo vessel_id pareceria un tanque', () => {
    const r = inferirMovimientos(MUESTRAS, { sinonimos: SINONIMOS, movimientos: [] });
    assert.equal(r.propuestas.length, 0);
    assert.equal(r.resumen.muestras_sin_tanque, r.resumen.muestras);
  });

  test('una fecha que no es un dia del calendario se descarta, no se coloca', () => {
    const muestras = [
      ...dias('25CSKMP-9', '2025-10', 1, 3, 'D5'),
      m('25CSKMP-9', '2025-02-30', 'E1'),      // no existe
      m('25CSKMP-9', '', 'E1'),
      m('25CSKMP-9', '2025-13-01', 'E1'),
      m('25CSKMP-9', '2025-10-05', 'E1'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), ['D5>E1@2025-10-05']);
    assert.equal(r.propuestas[0].muestras_destino, 1);
  });

  test('una fila de bayas no habla de tanques aunque traiga vessel_id', () => {
    const muestras = [
      ...dias('25CSKMP-8', '2025-10', 1, 3, 'D5'),
      m('25CSKMP-8', '2025-10-04', 'E1', { sampleType: 'Berries' }),
      m('25CSKMP-8', '2025-10-05', 'E1', { sampleType: 'Berry' }),
    ];
    assert.equal(inferirMovimientos(muestras, BODEGA).propuestas.length, 0);
  });

  test('entradas que no son listas ni objetos no rompen nada', () => {
    for (const malas of [null, undefined, 'x', 42, {}]) {
      const r = inferirMovimientos(malas, BODEGA);
      assert.deepEqual(r.propuestas, []);
      assert.deepEqual(r.sinResolver, []);
    }
    const r = inferirMovimientos([null, 7, 'x', {}, { codigoBodega: '25CS-1' }], BODEGA);
    assert.deepEqual(r.propuestas, []);
  });

  test('una fecha Date se lee como su dia UTC', () => {
    const muestras = [
      m('25CSKMP-7', new Date('2025-10-01T00:00:00Z'), 'D5'),
      m('25CSKMP-7', new Date('2025-10-02T00:00:00Z'), 'E1'),
    ];
    assert.deepEqual(ruta(inferirMovimientos(muestras, BODEGA).propuestas), ['D5>E1@2025-10-02']);
  });

  test('el mismo lote y el mismo dia en el mismo tanque cuenta las muestras, no los tanques', () => {
    const muestras = [
      m('25CSKMP-6', '2025-10-01', 'D5'),
      m('25CSKMP-6', '2025-10-01', 'D5'),     // dos seq el mismo dia
      m('25CSKMP-6', '2025-10-02', 'E1'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), ['D5>E1@2025-10-02']);
    assert.equal(r.propuestas[0].muestras_origen, 2);
  });

  test('el orden de las filas no cambia el resultado', () => {
    const al = [...MUESTRAS].reverse();
    const a = inferirMovimientos(MUESTRAS, BODEGA);
    const b = inferirMovimientos(al, BODEGA);
    assert.deepEqual(ruta(a.propuestas), ruta(b.propuestas));
    assert.deepEqual(a.propuestas.map((p) => p.clave), b.propuestas.map((p) => p.clave));
    assert.deepEqual(a.sinResolver, b.sinResolver);
  });

  test('se puede pedir una sola vendimia', () => {
    const r = inferirMovimientos(MUESTRAS, BODEGA, { vendimia: 2025 });
    assert.ok(r.propuestas.length > 0);
    for (const p of r.propuestas) assert.equal(p.vintage_year, 2025);
    assert.equal(r.traslapes.filter((t) => t.lot_code === '23CSLLC-15').length, 0);
  });
});

// --- the dismissal table ------------------------------------------------------
//
// sql/migration_tanques_descartes.sql is the only new table this bead adds, and
// it holds the user's "no". The guard is the same shape as MT.50's over
// migration_tanques.sql: the properties api/tanques.js depends on, asserted
// here instead of discovered in production.

describe('mt58 - sql/migration_tanques_descartes.sql', () => {
  const SQL = readFileSync(new URL('../sql/migration_tanques_descartes.sql', import.meta.url), 'utf8');
  const TABLA = 'tanques_propuestas_descartadas';

  test('crea la tabla con la clave como primary key', () => {
    assert.match(SQL, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${TABLA}`));
    assert.match(SQL, /clave\s+TEXT\s+PRIMARY KEY/);
    assert.match(SQL, /descartado_por\s+TEXT/);
    assert.match(SQL, /created_at\s+TIMESTAMPTZ/);
  });

  test('RLS activo, sin politicas y sin grants para anon ni authenticated', () => {
    assert.match(SQL, new RegExp(`ALTER TABLE public\\.${TABLA} ENABLE ROW LEVEL SECURITY`));
    assert.match(SQL, new RegExp(`REVOKE ALL ON public\\.${TABLA} FROM anon, authenticated`));
    assert.equal(SQL.match(/CREATE POLICY/g), null,
      'tabla de solo servidor: una politica la abriria a la llave anon');
  });

  test('service_role puede leer y agregar, nunca borrar', () => {
    const grant = SQL.match(/GRANT ([A-Z, ]+) ON public\.tanques_propuestas_descartadas TO service_role/);
    assert.ok(grant, 'falta el GRANT a service_role');
    assert.deepEqual(grant[1].split(',').map((s) => s.trim()).sort(), ['INSERT', 'SELECT']);
  });

  test('una clave en blanco o enorme la rechaza un CHECK', () => {
    assert.match(SQL, /CHECK \(btrim\(clave\) <> '' AND length\(clave\) <= 200\)/);
    assert.match(SQL, /CHECK \(btrim\(descartado_por\) <> ''/);
  });

  test('es una sola transaccion y se puede re-correr', () => {
    assert.match(SQL, /^BEGIN;$/m);
    assert.match(SQL, /^COMMIT;$/m);
    assert.deepEqual(SQL.match(/^CREATE TABLE(?! IF NOT EXISTS)/gm) ?? [], []);
    const inserts = SQL.match(/INSERT INTO public\.\w+/g) || [];
    const conflictos = SQL.match(/ON CONFLICT \([\w, ]+\) DO (UPDATE|NOTHING)/g) || [];
    assert.equal(inserts.length, 1, 'solo el registro en applied_migrations');
    assert.equal(inserts.length, conflictos.length);
    // Los CHECK se re-aplican, que es lo que una instalacion previa necesita.
    for (const c of ['tanques_descartes_clave_chk', 'tanques_descartes_por_chk']) {
      assert.match(SQL, new RegExp(`DROP CONSTRAINT IF EXISTS ${c}`));
      assert.match(SQL, new RegExp(`ADD\\s+CONSTRAINT\\s+${c}`));
    }
  });

  test('no toca ninguna tabla que ya existe', () => {
    const tocadas = new Set((SQL.match(/ALTER TABLE public\.(\w+)/g) || [])
      .map((s) => s.replace('ALTER TABLE public.', '')));
    assert.deepEqual([...tocadas], [TABLA]);
  });

  test('queda registrada en applied_migrations y en el manifiesto', () => {
    assert.match(SQL,
      /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_tanques_descartes'\)/);
    assert.ok(MIGRATIONS.includes('migration_tanques_descartes'),
      'js/migrations-manifest.js tiene que listarla o el banner de drift se queda callado');
  });

  test('el nombre del archivo y el del registro coinciden', () => {
    assert.ok(MIGRATIONS.indexOf('migration_tanques_descartes') > MIGRATIONS.indexOf('migration_tanques_escritura'),
      'la migracion va despues de la de escritura, en orden de aplicacion');
  });
});

// --- what "the windows do not overlap" has to mean ----------------------------
//
// Three findings from the cross-vendor review (lucy, 2026-10-15), each of which
// turned ambiguous sampling into a specific route an append-only ledger would
// have had to carry.

describe('mt58 - evidencia ambigua no se convierte en ruta', () => {
  const motivos = (r) => r.traslapes.map((t) => `${t.motivo}:${t.a}/${t.b}`).sort();

  test('una estancia que abarca a otras dos bloquea TODO el tramo, no solo su par', () => {
    // D5 todos los dias del 1 al 10, E1 tambien el 2, H8 tambien el 3: el lote
    // estuvo en los tres a la vez. Mirar solo pares vecinos descarta D5 y E1 y
    // luego ve E1 y H8 como un par limpio, que propone un trasiego preciso
    // entre dos tanques que el lote ocupaba al mismo tiempo.
    const muestras = [
      ...dias('25CSKMP-4', '2025-10', 1, 10, 'D5'),
      m('25CSKMP-4', '2025-10-02', 'E1'),
      m('25CSKMP-4', '2025-10-03', 'H8'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), []);
    // Cada vasija se reporta contra una con la que DE VERDAD se cruza: E1 y H8
    // no se tocan entre si, las dos se cruzan con D5.
    assert.deepEqual(motivos(r), ['simultaneo:D5/E1', 'simultaneo:D5/H8']);
    assert.deepEqual(r.traslapes.map((t) => `${t.desde}..${t.hasta}`),
      ['2025-10-02..2025-10-02', '2025-10-03..2025-10-03']);
  });

  test('salir de un grupo de dos no nombra origen; entrar a uno si nombra destino', () => {
    // E1 cierra el 16, A4 abre el 18 y A2 aparece el 20 junto con A4. La
    // entrada a A4 sigue siendo clara.
    const muestras = [
      ...dias('25TEKMP-2', '2025-10', 10, 16, 'E1'),
      m('25TEKMP-2', '2025-10-18', 'A4'),
      m('25TEKMP-2', '2025-10-20', 'A4'),
      m('25TEKMP-2', '2025-10-20', 'A2'),
      m('25TEKMP-2', '2025-10-22', 'A4'),
      // y despues un grupo de dos del que no se puede salir
      m('25TEKMP-2', '2025-11-01', 'B4'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), ['E1>A4@2025-10-18']);
    assert.ok(r.traslapes.some((t) => t.motivo === 'simultaneo' && t.a === 'A4' && t.b === 'A2'));
    // B4 abre despues del grupo {A4, A2}, pero no se sabe de cual de los dos salio
    assert.ok(!r.propuestas.some((p) => p.destino === 'B4'));
  });

  test('un empate en el primer dia de un grupo no nombra destino', () => {
    const muestras = [
      ...dias('25CSKMP-4', '2025-10', 1, 5, 'D5'),
      m('25CSKMP-4', '2025-10-10', 'E1'),
      m('25CSKMP-4', '2025-10-10', 'H8'),
      m('25CSKMP-4', '2025-10-12', 'E1'),
      m('25CSKMP-4', '2025-10-12', 'H8'),
    ];
    assert.deepEqual(ruta(inferirMovimientos(muestras, BODEGA).propuestas), []);
  });

  test('dos vasijas el mismo unico dia no ponen direccion: el alfabeto no es un flujo', () => {
    const muestras = [
      m('25CSKMP-4', '2025-11-12', 'D5'),
      m('25CSKMP-4', '2025-11-12', 'E1'),
      m('25CSKMP-4', '2025-11-12', 'H8'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), []);
    // Un solo grupo de tres: el lote estuvo en los tres ese dia.
    assert.deepEqual(motivos(r), ['mismo_dia:D5/E1', 'mismo_dia:D5/H8']);
  });

  test('todo traslape reportado es un intervalo real, nunca uno al reves', () => {
    const casos = [MUESTRAS, [
      m('25CSKMP-4', '2025-10-01', 'D5'), m('25CSKMP-4', '2025-10-10', 'D5'),
      m('25CSKMP-4', '2025-10-02', 'E1'), m('25CSKMP-4', '2025-10-03', 'H8'),
      ...dias('25DUKMP-3', '2025-10', 1, 9, 'E6'), ...dias('25DUKMP-3', '2025-10', 2, 9, 'F3'),
    ]];
    for (const muestras of casos) {
      const r = inferirMovimientos(muestras, BODEGA);
      for (const t of r.traslapes) {
        assert.ok(t.desde <= t.hasta, `${t.lot_code} ${t.a}/${t.b}: ${t.desde} > ${t.hasta}`);
        assert.notEqual(t.a, t.b);
      }
    }
  });

  test('un origen de un solo dia que comparte ese dia con el destino tampoco pone direccion', () => {
    // D5 solo el 12; E1 el 12 y hasta el 21. El lote acabo en E1, pero todo lo
    // que se sabe de D5 es "visto el 12", el mismo dia que E1: pudo ser un
    // trasiego ese dia o una division con una sola muestra de la otra parte.
    // En produccion (2026-10-15) ninguna propuesta depende de este caso, asi
    // que la regla estricta no cuesta nada real.
    const muestras = [
      m('25CSKMP-4', '2025-11-12', 'D5'),
      ...dias('25CSKMP-4', '2025-11', 12, 21, 'E1'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), []);
    assert.deepEqual(r.traslapes.map((t) => t.motivo), ['simultaneo']);
  });

  test('un dia compartido SI pone direccion cuando el origen tiene mas que ese dia', () => {
    // D5 del 1 al 12 y E1 del 12 al 21: el 12 es el dia del trasiego, muestreado
    // en el tanque viejo y luego en el nuevo. Este es el caso real de 25TEKMP-2.
    const muestras = [
      ...dias('25CSKMP-4', '2025-11', 1, 12, 'D5'),
      ...dias('25CSKMP-4', '2025-11', 12, 21, 'E1'),
    ];
    assert.deepEqual(ruta(inferirMovimientos(muestras, BODEGA).propuestas), ['D5>E1@2025-11-12']);
  });

  test('dos vasijas de un solo dia entre otras dos no dejan que el alfabeto elija', () => {
    // D5 el 1, E1 y H8 el 2, B4 el 3. Antes se proponia D5>E1 y H8>B4: dos
    // elecciones entre E1 y H8 sin una sola muestra que las respalde.
    const muestras = [
      m('25CSKMP-4', '2025-11-01', 'D5'),
      m('25CSKMP-4', '2025-11-02', 'E1'),
      m('25CSKMP-4', '2025-11-02', 'H8'),
      m('25CSKMP-4', '2025-11-03', 'B4'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), []);
    assert.deepEqual(r.traslapes.map((t) => `${t.motivo}:${t.a}/${t.b}`), ['mismo_dia:E1/H8']);
  });

  test('una vasija sin tanque EN EL HUECO bloquea el trasiego directo', () => {
    const muestras = [
      m('25CSKMP-4', '2025-10-01', 'D5'),
      m('25CSKMP-4', '2025-10-02', 'C9'),    // el catalogo no la tiene
      m('25CSKMP-4', '2025-10-03', 'E1'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), []);
    assert.deepEqual(motivos(r), ['sin_tanque_en_medio:D5/E1']);
    // y la vasija sigue reportandose aparte
    assert.ok(r.sinResolver.some((e) => e.vessel_id === 'C9'));
  });

  test('una vasija sin tanque DENTRO de una ventana no bloquea nada', () => {
    // Una barrica muestreada mientras el lote vive en D5 es una lectura
    // paralela, no una escala del viaje.
    const muestras = [
      ...dias('25CSKMP-4', '2025-10', 1, 5, 'D5'),
      m('25CSKMP-4', '2025-10-03', 'BCA'),
      ...dias('25CSKMP-4', '2025-10', 8, 12, 'E1'),
      m('25CSKMP-4', '2025-10-10', 'BCA'),
    ];
    assert.deepEqual(ruta(inferirMovimientos(muestras, BODEGA).propuestas), ['D5>E1@2025-10-08']);
  });

  test('el hueco se mide por lote: la barrica de OTRO lote no bloquea este', () => {
    const muestras = [
      m('25CSKMP-4', '2025-10-01', 'D5'),
      m('25DUKMP-3', '2025-10-02', 'BCA'),
      m('25CSKMP-4', '2025-10-03', 'E1'),
    ];
    assert.deepEqual(ruta(inferirMovimientos(muestras, BODEGA).propuestas), ['D5>E1@2025-10-03']);
  });

  test('la cobertura se reporta por vendimia, no promediada sobre toda la tabla', () => {
    // Un 2023 que vive en barricas no debe esconder como esta cubierto el 2025.
    const muestras = [
      ...dias('25CSKMP-4', '2025-10', 1, 5, 'D5'),
      ...dias('25CSKMP-4', '2025-10', 8, 12, 'E1'),
      ...dias('23CSLLC-9', '2025-06', 1, 9, 'BCA', { vintage: 2023 }),
      m('23CSLLC-9', '2025-06-20', 'E6', { vintage: 2023 }),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    const v = Object.fromEntries(r.resumen.por_vendimia.map((e) => [e.vendimia, e]));
    assert.equal(v[2025].muestras, 10);
    assert.equal(v[2025].sin_tanque, 0);
    assert.equal(v[2023].sin_tanque, 9);
    assert.ok(v[2023].fraccion > 0.8);
    // la vendimia mas nueva primero: es la que se esta trabajando
    assert.equal(r.resumen.por_vendimia[0].vendimia, 2025);
    // y el total sigue ahi, diluido, que es justo por lo que no se muestra solo
    assert.ok(r.resumen.fraccion_sin_tanque < v[2023].fraccion);
  });
});

// --- visits: a lote can come back ---------------------------------------------
//
// lucy, 2026-10-15: one window per vessel merged D5 on 11-01 and D5 on 11-03
// into one stay that swallowed E1 on 11-02, and both real moves vanished into
// a traslape. The unit is now the visit: a run of consecutive sampling days in
// one vessel.

describe('mt58 - visitas de regreso', () => {
  const motivos = (r) => r.traslapes.map((t) => `${t.motivo}:${t.a}/${t.b}`).sort();

  test('A, B, A propone la ida y la vuelta', () => {
    const muestras = [
      m('25CSKMP-4', '2025-11-01', 'D5'),
      m('25CSKMP-4', '2025-11-02', 'E1'),
      m('25CSKMP-4', '2025-11-03', 'D5'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas), ['D5>E1@2025-11-02', 'E1>D5@2025-11-03']);
    assert.deepEqual(r.traslapes, []);
    // cada propuesta lleva la evidencia de SU visita, no de toda la estancia en D5
    assert.equal(r.propuestas[0].origen_hasta, '2025-11-01');
    assert.equal(r.propuestas[1].origen_desde, '2025-11-02');
    assert.equal(r.propuestas[1].muestras_destino, 1);
  });

  test('A, B, A con dias de trasiego compartidos tambien', () => {
    const muestras = [
      ...dias('25CSKMP-4', '2025-10', 1, 6, 'D5'),
      ...dias('25CSKMP-4', '2025-10', 6, 10, 'E1'),
      ...dias('25CSKMP-4', '2025-10', 10, 14, 'D5'),
    ];
    assert.deepEqual(ruta(inferirMovimientos(muestras, BODEGA).propuestas),
      ['D5>E1@2025-10-06', 'E1>D5@2025-10-10']);
  });

  test('A, B, C, A es una cadena, no un traslape', () => {
    const muestras = [
      m('25CSKMP-4', '2025-10-01', 'D5'),
      m('25CSKMP-4', '2025-10-02', 'E1'),
      m('25CSKMP-4', '2025-10-03', 'H8'),
      m('25CSKMP-4', '2025-10-10', 'D5'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    assert.deepEqual(ruta(r.propuestas),
      ['D5>E1@2025-10-02', 'E1>H8@2025-10-03', 'H8>D5@2025-10-10']);
  });

  test('con visitas, las rutas de la DoD siguen saliendo exactas', () => {
    const r = inferirMovimientos(MUESTRAS, BODEGA);
    assert.deepEqual(ruta(deLote(r, '25CSKMP-4')), ['D5>E1@2025-11-12', 'E1>H8@2025-12-01']);
    assert.deepEqual(ruta(deLote(r, '25DUKMP-3')),
      ['D5>D1@2025-10-18', 'D1>E5@2025-10-21', 'E5>B4@2025-10-23']);
  });

  test('X, Y, X, Y alternando es muestreo en paralelo, no tres trasiegos', () => {
    // Un lote en dos tanques que el laboratorio muestrea de uno en uno.
    const muestras = [
      ...dias('25CSKMP-4', '2025-10', 1, 4, 'B4'),
      m('25CSKMP-4', '2025-10-10', 'E6'),
      m('25CSKMP-4', '2025-10-11', 'F3'),
      m('25CSKMP-4', '2025-10-12', 'E6'),
      m('25CSKMP-4', '2025-10-13', 'F3'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    // Entrar al grupo si nombra destino: E6 fue la primera muestra.
    assert.deepEqual(ruta(r.propuestas), ['B4>E6@2025-10-10']);
    assert.deepEqual(motivos(r), ['simultaneo:E6/F3']);
    for (const t of r.traslapes) assert.ok(t.desde <= t.hasta);
  });

  test('volver a una vasija que estaba en paralelo no es un trasiego', () => {
    // 23CSLLC-15: E6 el 02-26, F3 el 02-27 y las dos desde el 04-04. E6 nunca
    // salio; F3 se agrego. "E6 a F3 el 02-27" seria inventado.
    const r = inferirMovimientos(CSLLC15, BODEGA);
    assert.deepEqual(r.propuestas, []);
    assert.deepEqual(motivos(r), ['simultaneo:E6/F3']);
  });
});

// Coordinator round, 2026-10-15 (lucy round 2): every proposal the inbox can
// show must be dismissable, so its clave has to fit the API's MAX_CLAVE (200).
describe('MT.58 - proposal claves stay dismissable', () => {
  test('a lot code longer than 36 characters, or with non-ASCII, is not a lote', () => {
    assert.equal(esCodigoDeLote('25A' + 'x'.repeat(33)), true);
    assert.equal(esCodigoDeLote('25A' + 'x'.repeat(34)), false);
    assert.equal(esCodigoDeLote('25A' + 'x'.repeat(181)), false);
    assert.equal(esCodigoDeLote('25Aé'), false);
  });

  test('the worst clave the rule allows fits MAX_CLAVE with the longest real tank codes', () => {
    const peor = '25A' + '%'.repeat(33);  // every character percent-encodes
    assert.equal(esCodigoDeLote(peor), true);
    const clave = clavePropuesta({ lot_code: peor, origen: 'VAR 1 CESAR', destino: 'VAR 2 CESAR', fecha: '2025-11-02' });
    assert.ok(clave.length <= 200, `clave of ${clave.length} characters`);
    const api = readFileSync(new URL('../api/tanques.js', import.meta.url), 'utf8');
    assert.match(api, /const MAX_CLAVE = 200;/);
  });
});
