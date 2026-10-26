// mt57 - recording a movement from the Tanques tab: what the dialog proposes and
// what gets posted. Bead xd-qrn.5. Spec: state/specs/xd-tanques/SPEC.md.
//
// Everything a user could get WRONG about a movement is decided here, in the
// pure planner, so it can be tested without a browser: the defaults the dialog
// opens with, the volume it refuses to exceed, the lote and vendimia it derives,
// and the exact payload /api/tanques receives. The gestures themselves (drag,
// two-tap, undo toast) are proven in tests/e2e/tanques-movimientos.spec.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planearMovimiento,
  movimientoDesdeFormulario,
  maximoVolumen,
  erroresDeMovimiento,
  erroresDeFormulario,
  loteDeOrigen,
  vendimiaDeLote,
  lotesSinTanque,
  pendienteIgual,
  gemeloEnBitacora,
  CAMPOS_ENVIADOS,
} from '../js/tanques/moves.js';
import { validarMovimientoEnLog, replayMovimientos } from '../js/tanques/estado.js';
import { todayInVineyard } from '../js/utils.js';

const TANQUES = [
  { codigo: 'A1', capacidad_l: 20000, fila: 'A', posicion: 1, tipo: 'TQ', activo: true },
  { codigo: 'A2', capacidad_l: 20000, fila: 'A', posicion: 2, tipo: 'TQ', activo: true },
  { codigo: 'B1', capacidad_l: 10000, fila: 'B', posicion: 1, tipo: 'TQ', activo: true },
  { codigo: 'B2', capacidad_l: 5000, fila: 'B', posicion: 2, tipo: 'TQ', activo: true },
  { codigo: 'I-4 CAVA', capacidad_l: 9000, tipo: 'TQ', activo: true },
];
const SINONIMOS = { I4: 'I-4 CAVA' };

let seq = 0;
function mv(o) {
  seq += 1;
  return {
    id: seq,
    fecha: '2025-09-01',
    tipo: 'trasiego',
    origen: null,
    destino: null,
    lot_code: 'sin lote',
    vintage_year: 2025,
    volumen_l: 0,
    merma_l: 0,
    nota: null,
    fuente: 'manual',
    creado_por: 'daniel',
    created_at: `2025-09-01T00:00:${String(seq).padStart(2, '0')}Z`,
    anulado: false,
    ...o,
  };
}

// The shape view.js._bodega() hands the planner.
function bodega(movimientos, tanques = TANQUES) {
  const { estado } = replayMovimientos(tanques, movimientos, { sinonimos: SINONIMOS });
  return { catalogo: tanques, movimientos, sinonimos: SINONIMOS, estado };
}

const LLENO = [
  mv({ tipo: 'recepcion', destino: 'A1', lot_code: '25CSKMP-1', volumen_l: 12000, fecha: '2025-09-02' }),
];

// --- defaults ----------------------------------------------------------------

test('a tank to tank gesture proposes a trasiego of everything the origin holds', () => {
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, bodega(LLENO));
  assert.equal(m.clase, 'movimiento');
  assert.equal(m.tipo, 'trasiego');
  assert.equal(m.titulo, 'Registrar trasiego');
  assert.equal(m.volumen_l, 12000);
  assert.equal(m.merma_l, 0);          // never an invented percentage
  assert.equal(m.disponible_l, 12000);
  assert.equal(m.libres_l, 20000);
  assert.equal(m.maximo_l, 12000);
  assert.equal(m.lot_code, '25CSKMP-1');
  assert.equal(m.vintage_year, 2025);
  assert.equal(m.fecha, todayInVineyard());
  assert.equal(m.fecha_maxima, todayInVineyard());
  assert.equal(m.puedeRegistrar, true);
  assert.deepEqual(m.avisos, []);
  assert.ok(m.tipos.includes('trasiego') && m.tipos.includes('descube'));
  assert.ok(!m.tipos.includes('recepcion') && !m.tipos.includes('salida'));
});

test('an occupied destination becomes an ensamble and says so', () => {
  const log = [
    ...LLENO,
    mv({ tipo: 'recepcion', destino: 'A2', lot_code: '25MEKMP-3', volumen_l: 4000, fecha: '2025-09-03' }),
  ];
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, bodega(log));
  assert.equal(m.tipo, 'ensamble');
  assert.equal(m.titulo, 'Ensamble');
  assert.equal(m.libres_l, 16000);
  assert.equal(m.volumen_l, 12000);
  assert.equal(m.puedeRegistrar, true);
  const mezcla = m.avisos.find((a) => a.clave === 'mezcla');
  assert.ok(mezcla, 'el aviso de mezcla falta');
  assert.match(mezcla.texto, /A2 ya tiene vino/);
  assert.match(mezcla.texto, /composición por volumen/);
});

test('the default volume is clamped to the free space and the clamp is announced', () => {
  // B2 holds 5 000 L of capacity; A1 has 12 000 L to send.
  const m = planearMovimiento({ origen: 'A1', destino: 'B2' }, bodega(LLENO));
  assert.equal(m.disponible_l, 12000);
  assert.equal(m.libres_l, 5000);
  assert.equal(m.volumen_l, 5000);
  assert.equal(m.maximo_l, 5000);
  const tope = m.avisos.find((a) => a.clave === 'excede');
  assert.ok(tope, 'el aviso de exceso falta');
  assert.match(tope.texto, /12,000 L/);
  assert.match(tope.texto, /5,000 L/);
  assert.match(tope.texto, /solo una parte/);
  // Clamped, not refused: moving part of the tank is a real operation.
  assert.equal(m.puedeRegistrar, true);
});

test('an empty origin cannot be registered at all', () => {
  const m = planearMovimiento({ origen: 'B1', destino: 'A2' }, bodega(LLENO));
  assert.equal(m.puedeRegistrar, false);
  assert.equal(m.volumen_l, null);
  assert.equal(m.maximo_l, 0);
  assert.match(m.avisos.find((a) => a.clave === 'vacio').texto, /B1 está vacío/);
});

test('a full destination cannot be registered either', () => {
  const log = [
    ...LLENO,
    mv({ tipo: 'recepcion', destino: 'B2', lot_code: '25MEKMP-3', volumen_l: 5000, fecha: '2025-09-03' }),
  ];
  const m = planearMovimiento({ origen: 'A1', destino: 'B2' }, bodega(log));
  assert.equal(m.libres_l, 0);
  assert.equal(m.puedeRegistrar, false);
  assert.match(m.avisos.find((a) => a.clave === 'sin_espacio').texto, /B2 está lleno/);
});

test('a tray lote proposes a recepcion with no volume of its own', () => {
  const m = planearMovimiento(
    { destino: 'B1', lote: { lot_code: '25SBVDG-1', vintage_year: 2025 } },
    bodega(LLENO),
  );
  assert.equal(m.clase, 'recepcion');
  assert.deepEqual(m.tipos, ['recepcion']);
  assert.equal(m.tipo, 'recepcion');
  assert.equal(m.titulo, 'Asignar lote a tanque');
  assert.equal(m.origen, null);
  assert.equal(m.lot_code, '25SBVDG-1');
  assert.equal(m.vintage_year, 2025);
  assert.equal(m.disponible_l, null);
  assert.equal(m.libres_l, 10000);
  assert.equal(m.maximo_l, 10000);
  // Nothing in the data says how many litres arrived, so the dialog asks
  // instead of proposing the tank's capacity as if it were a measurement.
  assert.equal(m.volumen_l, null);
  assert.equal(m.puedeRegistrar, true);
});

test('a recepcion of a lote the log already names says where it is', () => {
  const b = bodega(LLENO);
  // The chip said "sin tanque", but the log has had 25CSKMP-1 in A1 all along.
  const m = planearMovimiento(
    { destino: 'A2', lote: { lot_code: '25CSKMP-1', vintage_year: 2025 } }, b);
  assert.deepEqual(m.lote_en, [{ codigo: 'A1', litros: 12000 }]);
  const aviso = m.avisos.find((a) => a.clave === 'lote_en_bitacora');
  assert.ok(aviso, 'el aviso de lote ya en la bitacora falta');
  assert.match(aviso.texto, /A1 \(12,000 L\)/);
  assert.match(aviso.texto, /otra entrega/);
  // Named, not blocked: a lote can arrive in two loads.
  assert.equal(m.puedeRegistrar, true);

  // A lote that left the bodega is named too, and the message says so.
  const salio = bodega([
    ...LLENO,
    mv({ tipo: 'salida', origen: 'A1', lot_code: '25CSKMP-1', volumen_l: 12000, fecha: '2026-01-10' }),
  ]);
  const s2 = planearMovimiento(
    { destino: 'A2', lote: { lot_code: '25CSKMP-1', vintage_year: 2025 } }, salio);
  assert.deepEqual(s2.lote_en, []);
  assert.match(s2.avisos.find((a) => a.clave === 'lote_en_bitacora').texto, /no está en ningún tanque/);

  // And a lote the log has never named carries no such warning.
  const limpio = planearMovimiento(
    { destino: 'A2', lote: { lot_code: '25SBVDG-1', vintage_year: 2025 } }, b);
  assert.equal(limpio.avisos.find((a) => a.clave === 'lote_en_bitacora'), undefined);
  assert.deepEqual(limpio.lote_en, []);
});

test('where a lote is survives a model that gives up early', () => {
  // B2 is full, so the plan stops at sin_espacio. It must still know the lote
  // is in A1: the dialog reads an empty list as "sin tanque".
  const log = [
    ...LLENO,
    mv({ tipo: 'recepcion', destino: 'B2', lot_code: '25MEKMP-3', volumen_l: 5000, fecha: '2025-09-03' }),
  ];
  const m = planearMovimiento(
    { destino: 'B2', lote: { lot_code: '25CSKMP-1', vintage_year: 2025 } }, bodega(log));
  assert.equal(m.puedeRegistrar, false);
  assert.deepEqual(m.lote_en, [{ codigo: 'A1', litros: 12000 }]);
});

test('a salida takes the whole tank and carries no merma', () => {
  const m = planearMovimiento({ origen: 'A1', tipo: 'salida' }, bodega(LLENO));
  assert.equal(m.clase, 'salida');
  assert.deepEqual(m.tipos, ['salida']);
  assert.equal(m.titulo, 'Registrar salida');
  assert.equal(m.destino, null);
  assert.equal(m.libres_l, null);
  assert.equal(m.volumen_l, 12000);
  assert.equal(m.maximo_l, 12000);
  assert.equal(m.pideMerma, false);
  assert.equal(m.merma_l, 0);
});

test('merma widens the volume the destination can take, and only by its own litres', () => {
  const m = planearMovimiento({ origen: 'A1', destino: 'B2' }, bodega(LLENO));
  // 5 000 L free, so 5 000 L arrive; with 300 L of merma 5 300 L may leave.
  assert.equal(maximoVolumen(m, 0), 5000);
  assert.equal(maximoVolumen(m, 300), 5300);
  // Never more than the origin actually holds.
  assert.equal(maximoVolumen(m, 50000), 12000);
  // A salida is bounded by the origin alone.
  const s = planearMovimiento({ origen: 'A1', tipo: 'salida' }, bodega(LLENO));
  assert.equal(maximoVolumen(s, 0), 12000);
  assert.equal(maximoVolumen(s, 500), 12000);
});

test('an unknown or unreachable tank is reported, not drawn as a movement', () => {
  const m = planearMovimiento({ origen: 'A1', destino: 'ZZ9' }, bodega(LLENO));
  assert.equal(m.puedeRegistrar, false);
  assert.match(m.avisos[0].texto, /ZZ9/);
  const sin = planearMovimiento({}, bodega(LLENO));
  assert.equal(sin.puedeRegistrar, false);
});

test('a synonym resolves to the catalog code before anything else is decided', () => {
  const log = [mv({ tipo: 'recepcion', destino: 'I4', lot_code: '25CAVDG-1', volumen_l: 9000, fecha: '2025-09-02' })];
  const m = planearMovimiento({ origen: 'I4', destino: 'A1' }, bodega(log));
  assert.equal(m.origen, 'I-4 CAVA');
  assert.equal(m.disponible_l, 9000);
  assert.equal(m.lot_code, '25CAVDG-1');
});

test('the planner does not touch the log it was handed', () => {
  const log = [...LLENO];
  const antes = JSON.stringify(log);
  planearMovimiento({ origen: 'A1', destino: 'A2' }, bodega(log));
  assert.equal(JSON.stringify(log), antes);
});

// --- lote and vendimia -------------------------------------------------------

test('a blended origin is labelled with its majority lote and flagged as a blend', () => {
  const log = [
    ...LLENO,
    mv({ tipo: 'recepcion', destino: 'A2', lot_code: '25MEKMP-3', volumen_l: 4000, fecha: '2025-09-03' }),
    mv({ tipo: 'ensamble', origen: 'A1', destino: 'A2', lot_code: '25CSKMP-1', volumen_l: 12000, fecha: '2025-09-04' }),
  ];
  const b = bodega(log);
  const lote = loteDeOrigen(b.estado.A2, log);
  assert.equal(lote.lot_code, '25CSKMP-1');   // 12 000 L beats 4 000 L
  assert.equal(lote.mezcla, true);
  assert.deepEqual(lote.partes.map((p) => p.lot_code), ['25MEKMP-3', '25CSKMP-1']);

  const m = planearMovimiento({ origen: 'A2', destino: 'B1' }, b);
  assert.equal(m.lot_code, '25CSKMP-1');
  const aviso = m.avisos.find((a) => a.clave === 'proporcional');
  assert.ok(aviso, 'el aviso de reparto proporcional falta');
  assert.match(aviso.texto, /25MEKMP-3/);
  assert.match(aviso.texto, /en proporción a sus litros/);
});

test('the vendimia comes from the lot code, and from the log when the code is silent', () => {
  assert.equal(vendimiaDeLote('25CSKMP-1', []), 2025);
  assert.equal(vendimiaDeLote('26R14CS', []), 2026);
  // No two-digit prefix: the log is the other statement of record.
  const log = [mv({ lot_code: 'MARVDG-1', vintage_year: 2024 })];
  assert.equal(vendimiaDeLote('MARVDG-1', log), 2024);
  // An annulled row states nothing.
  assert.equal(vendimiaDeLote('MARVDG-1', [mv({ lot_code: 'MARVDG-1', vintage_year: 2024, anulado: true })]), null);
  assert.equal(vendimiaDeLote('MARVDG-1', []), null);
  assert.equal(vendimiaDeLote('', []), null);
  // Out of the range the column accepts: not a vendimia.
  assert.equal(vendimiaDeLote('99CSKMP-1', []), null);
});

// --- payload -----------------------------------------------------------------

test('the posted movement carries exactly the fields the API whitelists', () => {
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, bodega(LLENO));
  const mov = movimientoDesdeFormulario(m, {
    tipo: 'trasiego', fecha: '2026-02-04', volumen_l: '11500.5', merma_l: '120',
    nota: '  trasiego con aireación  ', vintage_year: '2025',
  });
  assert.deepEqual(Object.keys(mov).sort(), [...CAMPOS_ENVIADOS].sort());
  assert.deepEqual(mov, {
    fecha: '2026-02-04',
    tipo: 'trasiego',
    origen: 'A1',
    destino: 'A2',
    lot_code: '25CSKMP-1',
    vintage_year: 2025,
    volumen_l: 11500.5,
    merma_l: 120,
    nota: 'trasiego con aireación',
    fuente: 'manual',
    etapa: null,
  });
  // Nothing the client has no business setting: the server refuses these by
  // name, and a client_id belongs to DataStore.postMovimiento.
  for (const k of ['client_id', 'id', 'created_at', 'anulado', 'creado_por']) {
    assert.ok(!(k in mov), `${k} no debe viajar en el cuerpo`);
  }
});

test('a blank note is null, a blank merma is zero, and a salida never sends merma', () => {
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, bodega(LLENO));
  const mov = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 100, merma_l: '', nota: '   ' });
  assert.equal(mov.nota, null);
  assert.equal(mov.merma_l, 0);
  assert.equal(mov.vintage_year, 2025);   // the model's derivation when the form says nothing

  const s = planearMovimiento({ origen: 'A1', tipo: 'salida' }, bodega(LLENO));
  const salida = movimientoDesdeFormulario(s, { tipo: 'salida', fecha: '2026-02-04', volumen_l: 12000, merma_l: '400' });
  assert.equal(salida.destino, null);
  assert.equal(salida.merma_l, 0);   // the loss is already inside what left
});

test('a recepcion posts no origin and keeps the tray lote', () => {
  const m = planearMovimiento({ destino: 'B1', lote: { lot_code: '25SBVDG-1', vintage_year: 2025 } }, bodega(LLENO));
  const mov = movimientoDesdeFormulario(m, { tipo: 'recepcion', fecha: '2026-02-04', volumen_l: 6900, merma_l: 0 });
  assert.equal(mov.origen, null);
  assert.equal(mov.destino, 'B1');
  assert.equal(mov.tipo, 'recepcion');
  assert.equal(mov.lot_code, '25SBVDG-1');
});

test('a type the gesture does not allow is refused rather than posted', () => {
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, bodega(LLENO));
  // A tank to tank gesture cannot be a recepcion (the server would refuse it
  // for carrying an origin), so the model's own default is used instead.
  const mov = movimientoDesdeFormulario(m, { tipo: 'recepcion', fecha: '2026-02-04', volumen_l: 100 });
  assert.equal(mov.tipo, 'trasiego');
  const junk = movimientoDesdeFormulario(m, { tipo: 'nada', fecha: '2026-02-04', volumen_l: 100 });
  assert.equal(junk.tipo, 'trasiego');
});

test('a volume the form cannot read is sent as junk, not silently zeroed', () => {
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, bodega(LLENO));
  const mov = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 'abc' });
  assert.ok(Number.isNaN(mov.volumen_l));
  // and the client gate refuses it with the same words as the server
  const errores = erroresDeMovimiento(bodega(LLENO), mov);
  assert.ok(errores.length);
  assert.match(errores[0], /volumen/i);
});

// --- the client gate is the server's gate ------------------------------------

test('client validation is the same call the server makes', () => {
  const b = bodega(LLENO);
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, b);
  const mov = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 99999 });
  const mios = erroresDeMovimiento(b, mov);
  const suyos = validarMovimientoEnLog(b.catalogo, b.movimientos, mov, { sinonimos: SINONIMOS });
  assert.deepEqual(mios, suyos);
  assert.ok(mios.length, 'un retiro de 99 999 L de 12 000 L debe fallar');
});

test('an incomplete form is answered by the dialog, not by a round trip', () => {
  // The dialog carries novalidate, so these two are the checks the column needs
  // and the pure module does not make: api/tanques.js refuses both by name.
  assert.deepEqual(erroresDeFormulario({ lot_code: '25CSKMP-1', vintage_year: 2025 }), []);
  assert.deepEqual(erroresDeFormulario({ lot_code: '', vintage_year: 2025 }),
    ['El movimiento necesita un código de lote.']);
  // A plain decimal string is fine: api/tanques.js reads a numeric field that
  // way too (PostgREST prints NUMERIC as a string).
  assert.deepEqual(erroresDeFormulario({ lot_code: 'X', vintage_year: '2025' }), []);
  for (const v of [NaN, 2025.5, 1987, 2101, 'ayer', '2024.5']) {
    assert.match(erroresDeFormulario({ lot_code: 'X', vintage_year: v })[0] || '',
      /vendimia debe ser un año entre 1988 y 2100/, `vendimia ${String(v)}`);
  }
  // And the shared gate reports them alongside the tank rules.
  const b = bodega(LLENO);
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, b);
  const mov = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 100 });
  assert.deepEqual(erroresDeMovimiento(b, { ...mov, vintage_year: null }),
    ['Escriba la vendimia: el año de la cosecha.']);
});

test('a backdated movement is judged at its place in the log, not against today', () => {
  const log = [
    ...LLENO,
    mv({ tipo: 'salida', origen: 'A1', lot_code: '25CSKMP-1', volumen_l: 12000, fecha: '2025-09-20' }),
  ];
  const b = bodega(log);
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, b);
  // A1 is empty today, so the gesture itself is refused...
  assert.equal(m.puedeRegistrar, false);
  // ...and a row the user dates into the middle of the log is judged there:
  // taking 12 000 L out on the 10th leaves the salida on the 20th overdrawn.
  const errores = erroresDeMovimiento(b, {
    fecha: '2025-09-10', tipo: 'trasiego', origen: 'A1', destino: 'A2',
    lot_code: '25CSKMP-1', vintage_year: 2025, volumen_l: 12000, merma_l: 0,
    nota: null, fuente: 'manual',
  });
  assert.ok(errores.some((e) => /posterior/.test(e)), errores.join(' | '));
});

// --- the tray ----------------------------------------------------------------

const MUESTRAS = [
  { codigoBodega: '25CSKMP-1', vintage: 2025, fecha: '2025-10-01', sampleType: 'Must', variedad: 'Cabernet Sauvignon' },
  { codigoBodega: '25MEKMP-3', vintage: 2025, fecha: '2025-10-05', sampleType: 'Must', variedad: 'Merlot' },
  { codigoBodega: '25MEKMP-3', vintage: 2025, fecha: '2025-11-20', sampleType: 'Young Wine', variedad: 'Merlot' },
  { codigoBodega: '25SBVDG-1', vintage: 2025, fecha: '2025-09-28', sampleType: 'Must', variedad: 'Sauvignon Blanc' },
  { codigoBodega: '24CSKMP-9', vintage: 2024, fecha: '2024-10-01', sampleType: 'Must', variedad: 'Cabernet Sauvignon' },
  { codigoBodega: '25KCF-S1-PA', vintage: 2025, fecha: '2025-08-01', sampleType: 'Berries', variedad: 'Cabernet Franc' },
];

test('the tray lists the newest vintage lotes that the log does not place', () => {
  const tray = lotesSinTanque(MUESTRAS, LLENO);
  // 25CSKMP-1 is in A1 already; 2024 is an older vintage; berries are not wine.
  assert.deepEqual(tray.map((l) => l.lot_code), ['25MEKMP-3', '25SBVDG-1']);
  // Newest sample first, and each chip carries what the dialog needs.
  assert.deepEqual(tray[0], {
    lot_code: '25MEKMP-3',
    vintage_year: 2025,
    fecha: '2025-11-20',
    variedad: 'Merlot',
  });
});

test('an annulled movement does not place a lote', () => {
  const log = [mv({ tipo: 'recepcion', destino: 'A1', lot_code: '25CSKMP-1', volumen_l: 12000, anulado: true })];
  assert.ok(lotesSinTanque(MUESTRAS, log).some((l) => l.lot_code === '25CSKMP-1'));
});

test('a lote that left the bodega is not offered again', () => {
  // Placed and then bottled out: the log has named it, so it is not pending.
  const log = [
    ...LLENO,
    mv({ tipo: 'salida', origen: 'A1', lot_code: '25CSKMP-1', volumen_l: 12000, fecha: '2026-01-10' }),
  ];
  assert.ok(!lotesSinTanque(MUESTRAS, log).some((l) => l.lot_code === '25CSKMP-1'));
});

test('the tray is empty, not wrong, when there are no samples', () => {
  assert.deepEqual(lotesSinTanque([], LLENO), []);
  assert.deepEqual(lotesSinTanque(null, null), []);
});

// --- round 2: vendimia as typed, and one movement never under two keys --------

test('a vendimia typed wrong or cleared is an error, never the inferred year', () => {
  const b = bodega(LLENO);
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, b);
  assert.equal(m.vintage_year, 2025);
  const base = { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 100 };
  // Omitted: the field is not on the form, so the inferred year stands.
  assert.equal(movimientoDesdeFormulario(m, base).vintage_year, 2025);
  // Present and valid: what was typed.
  assert.equal(movimientoDesdeFormulario(m, { ...base, vintage_year: '2024' }).vintage_year, 2024);
  // Present and invalid: kept as typed, and the gate names it in Spanish.
  for (const v of ['2024.5', 'abc']) {
    const mov = movimientoDesdeFormulario(m, { ...base, vintage_year: v });
    assert.notEqual(mov.vintage_year, 2025, `vendimia ${v} no debe volverse 2025`);
    const errores = erroresDeMovimiento(b, mov);
    assert.ok(errores.some((e) => e.includes(`La vendimia "${v}" no es válida`)), errores.join(' | '));
  }
  // Present and blank: no value, and the column needs one.
  for (const v of ['', '   ']) {
    const mov = movimientoDesdeFormulario(m, { ...base, vintage_year: v });
    assert.equal(mov.vintage_year, null);
    assert.ok(erroresDeMovimiento(b, mov).includes('Escriba la vendimia: el año de la cosecha.'));
  }
});

test('a repeated gesture is matched to the unresolved intent it repeats', () => {
  const b = bodega(LLENO);
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, b);
  const mov = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 100, nota: 'x' });
  const viejo = { intento: { ...mov, client_id: 'AAAA' }, mensaje: 'sin confirmar', guardado: 1 };
  assert.equal(pendienteIgual([viejo], mov, SINONIMOS), viejo);
  // Each stored field makes it a different movement.
  for (const [k, v] of [['tipo', 'descube'], ['destino', 'B1'], ['volumen_l', 101], ['merma_l', 1],
    ['fecha', '2026-02-03'], ['vintage_year', 2024], ['nota', 'y'], ['lot_code', 'otro']]) {
    assert.equal(pendienteIgual([viejo], { ...mov, [k]: v }, SINONIMOS), null, k);
  }
  // A synonym is the same tank, and a blank note is no note.
  const sinNota = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 100 });
  const conNull = { intento: { ...sinNota, nota: null, client_id: 'B' }, guardado: 2 };
  assert.equal(pendienteIgual([conNull], { ...sinNota, nota: '' }, SINONIMOS), conNull);
  assert.equal(pendienteIgual([], mov, SINONIMOS), null);
});

test('a pending intent whose movement is already in the log under another key is found', () => {
  const intento = { fecha: '2026-02-04', tipo: 'trasiego', origen: 'A1', destino: 'A2',
    lot_code: '25CSKMP-1', vintage_year: 2025, volumen_l: 100, merma_l: 0, nota: null,
    fuente: 'manual', client_id: 'viejo' };
  const otro = mv({ ...intento, client_id: 'nuevo', volumen_l: '100.000' });
  assert.equal(gemeloEnBitacora([otro], intento, SINONIMOS), otro);
  // Its own key is not a twin: that row IS the intent and resolves it.
  assert.equal(gemeloEnBitacora([mv({ ...intento, client_id: 'VIEJO' })], intento, SINONIMOS), null);
  // An annulled row is not in the bodega.
  assert.equal(gemeloEnBitacora([{ ...otro, anulado: true }], intento, SINONIMOS), null);
  assert.equal(gemeloEnBitacora([mv({ ...intento, client_id: 'n', volumen_l: 99 })], intento, SINONIMOS), null);
});

test('the dialog scrim is a design token defined in both themes, not a literal', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  const regla = /\.tanques-dialog::backdrop\s*\{([^}]*)\}/.exec(css);
  assert.ok(regla, 'falta la regla del backdrop');
  assert.match(regla[1], /background:\s*var\(--scrim\)/);
  assert.doesNotMatch(regla[1], /rgba?\(|#[0-9a-f]{3,8}\b/i);
  const bloque = (sel) => {
    const i = css.indexOf(`${sel} {`);
    assert.ok(i >= 0, `falta el bloque ${sel}`);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.match(bloque(':root'), /--scrim:/);
  assert.match(bloque('[data-theme="light"]'), /--scrim:/);
});

// --- round 3 -----------------------------------------------------------------

test('a backdated movement is planned with the lote the origin held at that date', () => {
  // A1 takes 10 000 L of X, sends 8 000 L out, then takes 8 000 L of Y: today
  // Y is the majority. A trasiego dated before the refill moves X.
  const log = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: '24CSKMP-1', vintage_year: 2024,
      volumen_l: 10000, fecha: '2025-09-01' }),
    mv({ tipo: 'salida', origen: 'A1', lot_code: '24CSKMP-1', vintage_year: 2024,
      volumen_l: 8000, fecha: '2025-09-20' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: '25MEVDG-2', vintage_year: 2025,
      volumen_l: 8000, fecha: '2025-10-01' }),
  ];
  const b = bodega(log);
  const hoy = planearMovimiento({ origen: 'A1', destino: 'B1' }, b);
  assert.equal(hoy.lot_code, '25MEVDG-2');

  const m = planearMovimiento({ origen: 'A1', destino: 'B1' }, b, { fecha: '2025-09-10' });
  assert.equal(m.fecha, '2025-09-10');
  assert.equal(m.lot_code, '24CSKMP-1');
  assert.equal(m.vintage_year, 2024);
  assert.equal(m.mezcla_origen, false);
  assert.equal(m.disponible_l, 10000);
  assert.equal(m.puedeRegistrar, true);

  const mov = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2025-09-10', volumen_l: '1000' });
  assert.equal(mov.lot_code, '24CSKMP-1');
  assert.equal(mov.vintage_year, 2024);
  assert.deepEqual(erroresDeMovimiento(b, mov), []);
  // The stored row, replayed, is X leaving A1 on the 10th.
  const { estado } = replayMovimientos(TANQUES, [...log, { ...mov, id: 999 }], { sinonimos: SINONIMOS });
  assert.deepEqual(estado.B1.partes.map((p) => p.lot_code), ['24CSKMP-1']);

  // A date on which the origin was empty is refused for that date, and the
  // model says the date may be moved.
  const antes = planearMovimiento({ origen: 'A1', destino: 'B1' }, b, { fecha: '2025-08-01' });
  assert.equal(antes.puedeRegistrar, false);
  assert.equal(antes.cambiarFecha, true);
  assert.ok(antes.avisos.some((a) => a.clave === 'vacio' && a.texto.includes('2025-08-01')));
});

test('the vendimia is four digits as typed, never an exponent or hex', () => {
  const b = bodega(LLENO);
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, b);
  const base = { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 100 };
  for (const v of ['2e3', '0x7D0', '2024.0', '02024', '+2024', '20 24']) {
    const mov = movimientoDesdeFormulario(m, { ...base, vintage_year: v });
    assert.equal(mov.vintage_year, v, `vendimia ${v} se queda como se escribio`);
    const errores = erroresDeMovimiento(b, mov);
    assert.ok(errores.some((e) => e.includes(`La vendimia "${v}" no es válida`)), `${v}: ${errores.join(' | ')}`);
  }
  assert.equal(movimientoDesdeFormulario(m, { ...base, vintage_year: ' 2024 ' }).vintage_year, 2024);
  assert.deepEqual(erroresDeFormulario({ lot_code: 'x', vintage_year: '2e3' }).length, 1);
});

// --- etapa (xd-qrn.9) ----------------------------------------------------------

test('the etapa field: blank is no change, a chosen one travels, a salida never carries one', () => {
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, bodega(LLENO));
  assert.equal(m.pideEtapa, true);
  assert.equal(m.etapa, null, 'the dialog proposes no change');
  const base = { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 100 };
  assert.equal(movimientoDesdeFormulario(m, base).etapa, null, 'field absent');
  assert.equal(movimientoDesdeFormulario(m, { ...base, etapa: '' }).etapa, null, 'Sin cambio');
  assert.equal(movimientoDesdeFormulario(m, { ...base, etapa: 'fml' }).etapa, 'fml');
  // A value outside ETAPAS is sent as typed so the gate names it.
  const raro = movimientoDesdeFormulario(m, { ...base, etapa: 'barrica' });
  assert.equal(raro.etapa, 'barrica');
  assert.ok(erroresDeMovimiento(bodega(LLENO), raro).some((e) => /Etapa no reconocida/.test(e)));

  const s = planearMovimiento({ origen: 'A1', tipo: 'salida' }, bodega(LLENO));
  assert.equal(s.pideEtapa, false);
  const salida = movimientoDesdeFormulario(s, { tipo: 'salida', fecha: '2026-02-04', volumen_l: 100, etapa: 'emb' });
  assert.equal(salida.etapa, null);
});

test('a movement that declares an etapa passes the gate and sets the destination stage', () => {
  const b = bodega(LLENO);
  const m = planearMovimiento({ origen: 'A1', destino: 'A2' }, b);
  const mov = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 1000, etapa: 'fml' });
  assert.deepEqual(erroresDeMovimiento(b, mov), []);
  const { estado } = replayMovimientos(b.catalogo, [...b.movimientos, { ...mov, id: 999 }], { sinonimos: SINONIMOS });
  assert.equal(estado.A2.etapa, 'fml');
  // Without one the stage travels with the wine into the empty tank.
  const sin = movimientoDesdeFormulario(m, { tipo: 'trasiego', fecha: '2026-02-04', volumen_l: 1000 });
  assert.equal(replayMovimientos(b.catalogo, [...b.movimientos, { ...sin, id: 999 }], { sinonimos: SINONIMOS }).estado.A2.etapa, 'rec');
});
