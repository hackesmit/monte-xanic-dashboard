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

  test('una ventana que termina DESPUES de que empieza la siguiente es traslape, no movimiento', () => {
    // A4 del 18 al 22, A2 solo el 20: el 20 esta dentro de la ventana de A4.
    const muestras = [
      ...dias('25TEKMP-2', '2025-10', 10, 16, 'E1'),
      m('25TEKMP-2', '2025-10-18', 'A4'),
      m('25TEKMP-2', '2025-10-19', 'A4'),
      m('25TEKMP-2', '2025-10-20', 'A2'),
      m('25TEKMP-2', '2025-10-21', 'A4'),
      m('25TEKMP-2', '2025-10-22', 'A4'),
    ];
    const r = inferirMovimientos(muestras, BODEGA);
    // E1 cierra el 18, que es el dia en que abre A4: ventanas que se tocan en un
    // solo dia SON el movimiento de ese dia.
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
        movimientos: [mov({ origen: 'D5', destino, lot_code: '25CSVDG-1' })],
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
    // '|' no aparece en un codigo de tanque ni de lote, asi que las partes no
    // pueden correrse de sitio y producir la clave de otra propuesta.
    const a = clavePropuesta({ lot_code: '25CS-1', origen: 'D5', destino: 'E1', fecha: '2025-11-12' });
    const b = clavePropuesta({ lot_code: '25CS-1|D5', origen: 'E1', destino: '2025-11-12', fecha: '' });
    assert.notEqual(a, b);
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
    const ultima = MIGRATIONS[MIGRATIONS.length - 1];
    assert.equal(ultima, 'migration_tanques_descartes',
      'la nueva migracion va al final del manifiesto, en orden de aplicacion');
  });
});
