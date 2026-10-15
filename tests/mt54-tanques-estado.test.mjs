// mt54 - pure tank-state module: derive contents from the movement log, validate a move.
// Bead xd-qrn.2. Spec: state/specs/xd-tanques/SPEC.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveEstado,
  replayMovimientos,
  validarMovimiento,
  validarMovimientoEnLog,
  historialTanque,
  recorridoLote,
  TIPOS,
  ETAPAS,
} from '../js/tanques/estado.js';

const TANQUES = [
  { codigo: 'A1', capacidad_l: 20000, fila: 'A', posicion: 1, tipo: 'TQ', activo: true },
  { codigo: 'A2', capacidad_l: 20000, fila: 'A', posicion: 2, tipo: 'TQ', activo: true },
  { codigo: 'B1', capacidad_l: 10000, fila: 'B', posicion: 1, tipo: 'TQ', activo: true },
  { codigo: 'B2', capacidad_l: 5000, fila: 'B', posicion: 2, tipo: 'TQ', activo: true },
  { codigo: 'TIBOR 1', capacidad_l: 1000, tipo: 'TIBOR', activo: true },
];

let seq = 0;
function mv(o) {
  seq += 1;
  return {
    fecha: '2025-09-01',
    tipo: 'trasiego',
    origen: null,
    destino: null,
    lot_code: null,
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

const cerca = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

test('recepcion fills the destination minus merma and stamps stage and date', () => {
  const estado = deriveEstado(TANQUES, [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: '25CSKMP-1', volumen_l: 12000, merma_l: 100, fecha: '2025-09-02' }),
  ]);
  const a1 = estado.A1;
  assert.equal(a1.litros, 11900);
  assert.equal(a1.libres, 8100);
  assert.deepEqual(a1.partes, [{ lot_code: '25CSKMP-1', litros: 11900 }]);
  assert.equal(a1.etapa, 'rec');
  assert.equal(a1.desde, '2025-09-02');
  assert.equal(a1.ultima_entrada, '2025-09-02');
  assert.equal(a1.capacidad_l, 20000);
});

test('every catalog tank is present, empty ones included', () => {
  const estado = deriveEstado(TANQUES, []);
  assert.deepEqual(Object.keys(estado).sort(), ['A1', 'A2', 'B1', 'B2', 'TIBOR 1']);
  assert.equal(estado.B2.litros, 0);
  assert.deepEqual(estado.B2.partes, []);
  assert.equal(estado.B2.etapa, null);
  assert.equal(estado.B2.desde, null);
  assert.equal(estado.B2.libres, 5000);
});

test('anulado rows are ignored', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000 }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L2', volumen_l: 3000, anulado: true }),
    mv({ tipo: 'recepcion', destino: 'A2', lot_code: 'L3', volumen_l: 1000, anulado: '2025-09-03T10:00:00Z' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.equal(estado.A1.litros, 5000);
  assert.deepEqual(estado.A1.partes.map(p => p.lot_code), ['L1']);
  assert.equal(estado.A2.litros, 0);
});

test('a full trasiego empties the origin exactly and carries the stage over', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 10000, fecha: '2025-09-01' }),
    mv({ tipo: 'descube', origen: 'A1', destino: 'B1', volumen_l: 10000, merma_l: 250, fecha: '2025-09-20' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.equal(estado.A1.litros, 0);
  assert.deepEqual(estado.A1.partes, []);
  assert.equal(estado.A1.etapa, null);
  assert.equal(estado.A1.desde, null);
  assert.equal(estado.B1.litros, 9750);
  assert.equal(estado.B1.etapa, 'des');
  assert.equal(estado.B1.desde, '2025-09-20');
});

test('a trasiego into an empty tank inherits the origin stage', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 8000, fecha: '2025-09-01' }),
    mv({ tipo: 'descube', origen: 'A1', destino: 'B1', volumen_l: 8000, fecha: '2025-09-15' }),
    mv({ tipo: 'trasiego', origen: 'B1', destino: 'B2', volumen_l: 4000, fecha: '2025-10-01' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.equal(estado.B2.etapa, 'des');
  assert.equal(estado.B1.etapa, 'des');
});

test('ensamble into an occupied tank merges parts and keeps the destination stage', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 6000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'A2', lot_code: 'L2', volumen_l: 4000, fecha: '2025-09-02' }),
    mv({ tipo: 'descube', origen: 'A1', destino: 'B1', volumen_l: 6000, fecha: '2025-09-10' }),
    mv({ tipo: 'ensamble', origen: 'A2', destino: 'B1', volumen_l: 4000, fecha: '2025-09-12' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.equal(estado.B1.litros, 10000);
  assert.deepEqual(estado.B1.partes, [
    { lot_code: 'L1', litros: 6000 },
    { lot_code: 'L2', litros: 4000 },
  ]);
  assert.equal(estado.B1.etapa, 'des', 'the destination keeps its own stage on a blend');
  assert.equal(estado.B1.desde, '2025-09-10', 'desde is when the tank last became non-empty');
  assert.equal(estado.B1.ultima_entrada, '2025-09-12');
});

test('an occupied destination keeps its own stage, an empty one takes the type or the origin', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01' }),
    mv({ tipo: 'descube', origen: 'A1', destino: 'B1', volumen_l: 5000, fecha: '2025-09-20' }),
    // fresh must poured into a tank that already holds descubed wine: B1 stays 'des'
    mv({ tipo: 'recepcion', destino: 'B1', lot_code: 'L2', volumen_l: 2000, fecha: '2025-09-25' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.equal(estado.B1.etapa, 'des');
  assert.equal(estado.B1.desde, '2025-09-20');
});

test('an explicit etapa on the row wins over the derived one', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 5000, fecha: '2025-10-01', etapa: 'fml' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.equal(estado.B1.etapa, 'fml');
  // an unknown etapa is ignored by the replay and rejected by the validator
  const otro = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 100, etapa: 'barrica' })]);
  assert.equal(otro.A1.etapa, 'rec');
  assert.ok(validarMovimiento(otro, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 50, etapa: 'barrica' }))
    .some(e => /Etapa no reconocida/.test(e)));
});

test('a tank emptied by a movement forgets its stage, desde and last arrival', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01' }),
    mv({ tipo: 'salida', origen: 'A1', volumen_l: 5000, fecha: '2025-10-01' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.deepEqual(
    { litros: estado.A1.litros, partes: estado.A1.partes, etapa: estado.A1.etapa, desde: estado.A1.desde, ultima_entrada: estado.A1.ultima_entrada },
    { litros: 0, partes: [], etapa: null, desde: null, ultima_entrada: null },
  );
});

test('validarMovimiento refuses to fill a tank with no capacity in the catalog', () => {
  const estado = deriveEstado([{ codigo: 'A1', capacidad_l: 20000 }, { codigo: 'X9', capacidad_l: null }], [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000 }),
  ]);
  const errs = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'X9', volumen_l: 100 }));
  assert.deepEqual(errs, ['El tanque X9 no tiene capacidad registrada en el catalogo.']);
});

test('the same lote arriving twice collapses into one part', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 3000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 2000, fecha: '2025-09-02' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.deepEqual(estado.A1.partes, [{ lot_code: 'L1', litros: 5000 }]);
});

test('a partial move out of a blend splits every lote proportionally', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'B1', lot_code: 'L1', volumen_l: 6000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'B1', lot_code: 'L2', volumen_l: 4000, fecha: '2025-09-02' }),
    // lot_code on a row that has an origin is a label: the split follows the tank composition.
    mv({ tipo: 'trasiego', origen: 'B1', destino: 'B2', lot_code: 'L2', volumen_l: 5000, fecha: '2025-09-10' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.deepEqual(estado.B2.partes, [
    { lot_code: 'L1', litros: 3000 },
    { lot_code: 'L2', litros: 2000 },
  ]);
  assert.deepEqual(estado.B1.partes, [
    { lot_code: 'L1', litros: 3000 },
    { lot_code: 'L2', litros: 2000 },
  ]);
  cerca(estado.B1.litros, 5000);
  cerca(estado.B2.litros, 5000);
});

test('a partial move with merma splits the merma proportionally too', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'B1', lot_code: 'L1', volumen_l: 6000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'B1', lot_code: 'L2', volumen_l: 4000, fecha: '2025-09-02' }),
    mv({ tipo: 'trasiego', origen: 'B1', destino: 'B2', volumen_l: 5000, merma_l: 100, fecha: '2025-09-10' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  cerca(estado.B2.litros, 4900);
  assert.deepEqual(estado.B2.partes, [
    { lot_code: 'L1', litros: 2940 },
    { lot_code: 'L2', litros: 1960 },
  ]);
  cerca(estado.B1.litros, 5000);
});

test('per-lote rows and one blended row give the same composition', () => {
  const base = [
    mv({ tipo: 'recepcion', destino: 'B1', lot_code: 'L1', volumen_l: 6000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'B1', lot_code: 'L2', volumen_l: 4000, fecha: '2025-09-02' }),
  ];
  const unaFila = deriveEstado(TANQUES, [
    ...base,
    mv({ tipo: 'trasiego', origen: 'B1', destino: 'B2', volumen_l: 5000, fecha: '2025-09-10' }),
  ]);
  const porLote = deriveEstado(TANQUES, [
    ...base,
    mv({ tipo: 'trasiego', origen: 'B1', destino: 'B2', lot_code: 'L1', volumen_l: 3000, fecha: '2025-09-10' }),
    mv({ tipo: 'trasiego', origen: 'B1', destino: 'B2', lot_code: 'L2', volumen_l: 2000, fecha: '2025-09-10' }),
  ]);
  assert.deepEqual(porLote.B2.partes, unaFila.B2.partes);
  assert.deepEqual(porLote.B1.partes, unaFila.B1.partes);
});

test('salida takes litres out of the system', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 9000, fecha: '2025-09-01' }),
    mv({ tipo: 'salida', origen: 'A1', volumen_l: 4000, fecha: '2026-02-01', nota: 'embotellado' }),
  ];
  const { estado, balance } = replayMovimientos(TANQUES, movs);
  assert.equal(estado.A1.litros, 5000);
  assert.equal(balance.salido_l, 4000);
  assert.equal(balance.descuadre_l, 0);
});

test('movements are applied in (fecha, created_at) order, not array order', () => {
  const movs = [
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 5000, fecha: '2025-09-10', created_at: '2025-09-10T12:00:00Z' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01', created_at: '2025-09-01T08:00:00Z' }),
  ];
  const { estado, avisos } = replayMovimientos(TANQUES, movs);
  assert.deepEqual(avisos, []);
  assert.equal(estado.A1.litros, 0);
  assert.equal(estado.B1.litros, 5000);
});

test('two movements on the same date break the tie on created_at', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01', created_at: '2025-09-01T18:00:00Z' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 5000, fecha: '2025-09-01', created_at: '2025-09-01T19:00:00Z' }),
  ];
  const { estado, avisos } = replayMovimientos(TANQUES, [movs[1], movs[0]]);
  assert.deepEqual(avisos, []);
  assert.equal(estado.B1.litros, 5000);
});

test('an overdrawn origin moves only what it holds and files an aviso', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-01' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 4000, fecha: '2025-09-05' }),
  ];
  const { estado, avisos } = replayMovimientos(TANQUES, movs);
  assert.equal(estado.A1.litros, 0);
  assert.equal(estado.B1.litros, 1000);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].codigo, 'sobregiro');
});

test('a movement on a tank outside the catalog is skipped with an aviso', () => {
  const movs = [mv({ tipo: 'recepcion', destino: 'ZZ9', lot_code: 'L1', volumen_l: 1000 })];
  const { estado, avisos } = replayMovimientos(TANQUES, movs);
  assert.equal(avisos[0].codigo, 'tanque_desconocido');
  assert.equal(Object.values(estado).reduce((a, t) => a + t.litros, 0), 0);
});

test('an arrival past capacity still applies and files an aviso', () => {
  const movs = [mv({ tipo: 'recepcion', destino: 'B2', lot_code: 'L1', volumen_l: 6000 })];
  const { estado, avisos } = replayMovimientos(TANQUES, movs);
  assert.equal(estado.B2.litros, 6000);
  assert.equal(estado.B2.libres, -1000);
  assert.equal(avisos[0].codigo, 'desbordado');
});

test('synonyms resolve a tank reference from production data', () => {
  const tanques = [...TANQUES, { codigo: 'PD-1', capacidad_l: 2000 }];
  const sinonimos = { PD1: 'PD-1', 'TIB 1': 'TIBOR 1' };
  const movs = [
    mv({ tipo: 'recepcion', destino: 'PD1', lot_code: 'L1', volumen_l: 1500 }),
    mv({ tipo: 'recepcion', destino: 'TIB 1', lot_code: 'L2', volumen_l: 500 }),
  ];
  const { estado, avisos } = replayMovimientos(tanques, movs, { sinonimos });
  assert.deepEqual(avisos, []);
  assert.equal(estado['PD-1'].litros, 1500);
  assert.equal(estado['TIBOR 1'].litros, 500);
});

test('litre conservation over a 20-move fixture', () => {
  const movs = fixture20();
  const vivos = movs.filter(m => !m.anulado);
  assert.equal(movs.length, 20);
  const recibido = vivos.filter(m => !m.origen).reduce((a, m) => a + m.volumen_l, 0);
  const merma = vivos.filter(m => m.destino).reduce((a, m) => a + m.merma_l, 0);
  const salido = vivos.filter(m => !m.destino).reduce((a, m) => a + m.volumen_l, 0);

  const { estado, balance, avisos } = replayMovimientos(TANQUES, movs);
  assert.deepEqual(avisos, [], 'the fixture must apply cleanly or conservation proves nothing');
  const enTanques = Object.values(estado).reduce((a, t) => a + t.litros, 0);
  cerca(enTanques, recibido - merma - salido);
  cerca(balance.recibido_l, recibido);
  cerca(balance.merma_l, merma);
  cerca(balance.salido_l, salido);
  cerca(balance.en_tanques_l, enTanques);
  assert.equal(balance.descuadre_l, 0);
  // every part is positive and no tank is left with float dust
  for (const t of Object.values(estado)) {
    for (const p of t.partes) assert.ok(p.litros > 0, `${t.codigo} ${p.lot_code} = ${p.litros}`);
    cerca(t.litros, t.partes.reduce((a, p) => a + p.litros, 0));
  }
});

test('validarMovimiento accepts a sound move', () => {
  const estado = deriveEstado(TANQUES, [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 10000 }),
  ]);
  assert.deepEqual(validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 9000, merma_l: 50 })), []);
});

test('validarMovimiento rejects an unknown tank', () => {
  const estado = deriveEstado(TANQUES, []);
  const errsOrigen = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'ZZ9', destino: 'B1', volumen_l: 100 }));
  assert.ok(errsOrigen.some(e => e.includes('ZZ9') && /no existe/.test(e)), errsOrigen.join(' | '));
  const errsDestino = validarMovimiento(estado, mv({ tipo: 'recepcion', destino: 'ZZ9', lot_code: 'L1', volumen_l: 100 }));
  assert.ok(errsDestino.some(e => e.includes('ZZ9') && /no existe/.test(e)), errsDestino.join(' | '));
});

test('validarMovimiento rejects an empty origin', () => {
  const estado = deriveEstado(TANQUES, []);
  const errs = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100 }));
  assert.ok(errs.some(e => /vac[ií]o/.test(e)), errs.join(' | '));
});

test('validarMovimiento rejects a volume above the origin contents', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000 })]);
  const errs = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 1001 }));
  assert.ok(errs.some(e => /excede el contenido/.test(e)), errs.join(' | '));
  assert.deepEqual(validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 1000 })), []);
});

test('validarMovimiento rejects an arrival above the destination free space', () => {
  const estado = deriveEstado(TANQUES, [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 20000 }),
    mv({ tipo: 'recepcion', destino: 'B2', lot_code: 'L2', volumen_l: 4000 }),
  ]);
  const errs = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B2', volumen_l: 1200 }));
  assert.ok(errs.some(e => /espacio libre/.test(e)), errs.join(' | '));
  // merma makes the same move fit
  assert.deepEqual(validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B2', volumen_l: 1200, merma_l: 200 })), []);
});

test('validarMovimiento rejects a zero or negative volume', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000 })]);
  for (const v of [0, -10, null, 'mucho', NaN]) {
    const errs = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: v }));
    assert.ok(errs.some(e => /mayor que cero/.test(e)), `${v}: ${errs.join(' | ')}`);
  }
});

test('validarMovimiento rejects the same origin and destination', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000 })]);
  const errs = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'A1', volumen_l: 1000 }));
  assert.ok(errs.some(e => /mismo tanque/.test(e)), errs.join(' | '));
});

test('validarMovimiento checks merma, fecha, tipo and the shape of each type', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000 })]);
  const errs = (o) => validarMovimiento(estado, mv(o));
  assert.ok(errs({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100, merma_l: -1 }).some(e => /merma/.test(e)));
  assert.ok(errs({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100, merma_l: 200 }).some(e => /merma/.test(e)));
  assert.ok(errs({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100, fecha: null }).some(e => /fecha/.test(e)));
  assert.ok(errs({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100, fecha: '01/09/2025' }).some(e => /fecha/.test(e)));
  assert.ok(errs({ tipo: 'bautizo', origen: 'A1', destino: 'B1', volumen_l: 100 }).some(e => /tipo/i.test(e)));
  assert.ok(errs({ tipo: 'recepcion', destino: 'B1', volumen_l: 100 }).some(e => /lote/.test(e)));
  assert.ok(errs({ tipo: 'recepcion', origen: 'A1', destino: 'B1', lot_code: 'L9', volumen_l: 100 }).some(e => /recepci[oó]n no lleva/.test(e)));
  assert.ok(errs({ tipo: 'recepcion', lot_code: 'L9', volumen_l: 100 }).some(e => /necesita un tanque destino/.test(e)));
  assert.ok(errs({ tipo: 'salida', origen: 'A1', destino: 'B1', volumen_l: 100 }).some(e => /salida no lleva/.test(e)));
  assert.ok(errs({ tipo: 'salida', volumen_l: 100 }).some(e => /necesita un tanque origen/.test(e)));
  assert.ok(errs({ tipo: 'trasiego', origen: 'A1', volumen_l: 100 }).some(e => /necesita un tanque destino/.test(e)));
  assert.ok(errs({ tipo: 'trasiego', destino: 'B1', volumen_l: 100 }).some(e => /necesita un tanque origen/.test(e)));
  assert.deepEqual(errs({ tipo: 'salida', origen: 'A1', volumen_l: 100 }), []);
});

test('validarMovimiento messages are in Spanish and name the tank and the litres', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000 })]);
  const errs = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 1500 }));
  assert.equal(errs.length, 1);
  assert.match(errs[0], /^El volumen a mover \(1500 L\) excede el contenido del tanque A1 \(1000 L\)\.$/);
});

test('validarMovimiento resolves synonyms before validating', () => {
  const estado = deriveEstado([...TANQUES, { codigo: 'PD-1', capacidad_l: 2000 }], []);
  const errs = validarMovimiento(estado, mv({ tipo: 'recepcion', destino: 'PD1', lot_code: 'L1', volumen_l: 100 }), { sinonimos: { PD1: 'PD-1' } });
  assert.deepEqual(errs, []);
});

test('historialTanque returns the rows that touch a tank, in order, with direction', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'A2', lot_code: 'L2', volumen_l: 5000, fecha: '2025-09-02' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 2000, merma_l: 20, fecha: '2025-09-10' }),
    mv({ tipo: 'salida', origen: 'A1', volumen_l: 1000, fecha: '2025-09-20', anulado: true }),
  ];
  const h = historialTanque(TANQUES, movs, 'A1');
  assert.deepEqual(h.map(r => [r.fecha, r.tipo, r.direccion]), [
    ['2025-09-01', 'recepcion', 'entrada'],
    ['2025-09-10', 'trasiego', 'salida'],
  ]);
  assert.equal(h[0].delta_l, 5000);
  assert.equal(h[1].delta_l, -2000);
  assert.equal(historialTanque(TANQUES, movs, 'A1', { incluirAnulados: true }).length, 3);
  assert.equal(historialTanque(TANQUES, movs, 'TIBOR 1').length, 0);
});

test('recorridoLote follows one lote across tanks, including its blended share', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 6000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L2', volumen_l: 4000, fecha: '2025-09-02' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 5000, fecha: '2025-09-10' }),
    mv({ tipo: 'salida', origen: 'B1', volumen_l: 1000, fecha: '2025-10-01' }),
  ];
  const r = recorridoLote(TANQUES, movs, 'L1');
  assert.equal(r.lot_code, 'L1');
  assert.deepEqual(r.pasos.map(p => [p.fecha, p.tipo, p.origen, p.destino, p.litros]), [
    ['2025-09-01', 'recepcion', null, 'A1', 6000],
    ['2025-09-10', 'trasiego', 'A1', 'B1', 3000],
    ['2025-10-01', 'salida', 'B1', null, 600],
  ]);
  assert.deepEqual(r.tanques_actuales, [
    { codigo: 'A1', litros: 3000 },
    { codigo: 'B1', litros: 2400 },
  ]);
  cerca(r.litros_actuales, 5400);
  cerca(r.litros_recibidos, 6000);
  assert.deepEqual(recorridoLote(TANQUES, movs, 'NOPE').pasos, []);
});

// --- cross-vendor review round 1 (gpt-6.1-sol, 2026-10-14) ------------------

test('a full trasiego carries the origin stage over to an empty destination', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 10000, fecha: '2025-09-01', etapa: 'fml' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 10000, fecha: '2025-10-01' }),
  ];
  const estado = deriveEstado(TANQUES, movs);
  assert.equal(estado.A1.etapa, null);
  assert.equal(estado.B1.etapa, 'fml', 'emptying the origin must not erase the stage before it is inherited');
});

test('created_at is ordered as an instant, not as text', () => {
  const movs = [
    // 09:00Z happens AFTER 10:00+02:00 (08:00Z), so the recepcion comes first
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 5000, fecha: '2025-09-01', created_at: '2025-09-01T09:00:00Z' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01', created_at: '2025-09-01T10:00:00+02:00' }),
  ];
  const { estado, avisos } = replayMovimientos(TANQUES, movs);
  assert.deepEqual(avisos, []);
  assert.equal(estado.A1.litros, 0);
  assert.equal(estado.B1.litros, 5000);
});

test('a salida carries no merma of its own: it is inside the volume that leaves', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000 })]);
  const errs = validarMovimiento(estado, mv({ tipo: 'salida', origen: 'A1', volumen_l: 100, merma_l: 10 }));
  assert.ok(errs.some(e => /salida no lleva merma/.test(e)), errs.join(' | '));

  // a legacy row that carries one is folded into the exit volume, never counted twice
  const { estado: e2, balance, avisos, aplicados } = replayMovimientos(TANQUES, [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-01' }),
    mv({ tipo: 'salida', origen: 'A1', volumen_l: 1000, merma_l: 100, fecha: '2025-09-02' }),
  ]);
  assert.equal(e2.A1.litros, 0);
  assert.equal(balance.merma_l, 0);
  assert.equal(balance.salido_l, 1000);
  assert.equal(balance.descuadre_l, 0);
  assert.equal(aplicados[1].merma_l, 0);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].codigo, 'merma_en_salida');
});

test('recorridoLote does not report an ordinary salida as merma', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-01' }),
    mv({ tipo: 'salida', origen: 'A1', volumen_l: 400, fecha: '2025-10-01' }),
  ];
  const r = recorridoLote(TANQUES, movs, 'L1');
  const salida = r.pasos.find(p => p.tipo === 'salida');
  assert.equal(salida.merma_l, 0);
  assert.equal(salida.salido_l, 400);
  assert.equal(r.litros_merma, 0);
  assert.equal(r.litros_salidos, 400);
  assert.equal(r.litros_actuales, 600);
});

test('an impossible calendar date is refused', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000 })]);
  for (const f of ['2025-02-30', '2025-13-01', '2025-09-01garbage', '2025-9-1', '20250901']) {
    const errs = validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100, fecha: f }));
    assert.ok(errs.some(e => /fecha valida/.test(e)), `${f}: ${errs.join(' | ')}`);
  }
  assert.deepEqual(validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100, fecha: '2024-02-29' })), []);
});

test('validarMovimientoEnLog judges a backdated row at its place in the log', () => {
  const log = [
    mv({ tipo: 'recepcion', destino: 'B2', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01' }),
    mv({ tipo: 'salida', origen: 'B2', volumen_l: 5000, fecha: '2025-09-03' }),
  ];
  const estado = deriveEstado(TANQUES, log);
  assert.equal(estado.B2.litros, 0);
  const atrasado = mv({ tipo: 'recepcion', destino: 'B2', lot_code: 'L2', volumen_l: 5000, fecha: '2025-09-02' });
  // against today's state the tank looks empty, so the plain gate lets it through
  assert.deepEqual(validarMovimiento(estado, atrasado), []);
  const errs = validarMovimientoEnLog(TANQUES, log, atrasado);
  assert.ok(errs.some(e => /espacio libre/.test(e)), errs.join(' | '));
});

test('validarMovimientoEnLog reports the later movement a backdated row breaks', () => {
  const log = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 10000, fecha: '2025-09-01' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 8000, fecha: '2025-09-10' }),
  ];
  // taking 5000 L out on the 5th leaves the 8000 L trasiego of the 10th short
  const errs = validarMovimientoEnLog(TANQUES, log, mv({ tipo: 'salida', origen: 'A1', volumen_l: 5000, fecha: '2025-09-05' }));
  assert.ok(errs.some(e => /movimiento posterior/.test(e) && /solo tiene/.test(e)), errs.join(' | '));
  // the same row at the end of the log is fine
  assert.deepEqual(validarMovimientoEnLog(TANQUES, log, mv({ tipo: 'salida', origen: 'A1', volumen_l: 2000, fecha: '2025-09-20' })), []);
});

test('validarMovimientoEnLog ignores anulado rows and does not blame rows already inconsistent', () => {
  const log = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 10000, fecha: '2025-09-01' }),
    mv({ tipo: 'salida', origen: 'A1', volumen_l: 9000, fecha: '2025-09-05', anulado: true }),
    // already impossible without the candidate: only 10000 L ever arrived
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'A2', volumen_l: 10500, fecha: '2025-09-10' }),
  ];
  assert.equal(replayMovimientos(TANQUES, log).avisos[0].codigo, 'sobregiro');
  const errs = validarMovimientoEnLog(TANQUES, log, mv({ tipo: 'salida', origen: 'A1', volumen_l: 400, fecha: '2025-09-05' }));
  assert.deepEqual(errs, []);
});

// --- cross-vendor review round 2 (gpt-6.1-sol, 2026-10-14) ------------------

test('validarMovimientoEnLog counts a row with the same timestamps as already applied', () => {
  const log = [mv({ tipo: 'recepcion', destino: 'B2', lot_code: 'L1', volumen_l: 5000, fecha: '2025-09-01', created_at: '2025-09-01T12:00:00Z' })];
  const gemelo = mv({ tipo: 'recepcion', destino: 'B2', lot_code: 'L2', volumen_l: 5000, fecha: '2025-09-01', created_at: '2025-09-01T12:00:00Z' });
  const errs = validarMovimientoEnLog(TANQUES, log, gemelo);
  assert.ok(errs.length, 'the second 5000 L into a 5000 L tank must not pass the gate');
  assert.ok(errs.some(e => /espacio libre|sobre una capacidad/.test(e)), errs.join(' | '));
  // and the replay agrees that it would overflow
  assert.equal(replayMovimientos(TANQUES, [...log, gemelo]).avisos[0].codigo, 'desbordado');
});

test('proportional splits conserve litres exactly over 2000 small withdrawals', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L2', volumen_l: 1000, fecha: '2025-09-02' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L3', volumen_l: 1000, fecha: '2025-09-03' }),
  ];
  for (let i = 0; i < 2000; i++) {
    movs.push(mv({ tipo: 'salida', origen: 'A1', volumen_l: 1, fecha: '2025-10-01', created_at: `2025-10-01T00:00:00.${String(i).padStart(4, '0')}Z` }));
  }
  const { estado, balance, avisos } = replayMovimientos(TANQUES, movs);
  assert.deepEqual(avisos, []);
  assert.equal(balance.recibido_l, 3000);
  assert.equal(balance.salido_l, 2000);
  assert.equal(balance.en_tanques_l, 1000);
  assert.equal(balance.descuadre_l, 0);
  cerca(estado.A1.litros, 1000, 1e-6);
  cerca(estado.A1.partes.reduce((a, p) => a + p.litros, 0), 1000, 1e-6);
});

test('a movement split across lotes arrives with the litres that left, to the microlitre', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L2', volumen_l: 1000, fecha: '2025-09-02' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L3', volumen_l: 1000, fecha: '2025-09-03' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 1000, merma_l: 1, fecha: '2025-09-10' }),
  ];
  const { estado, aplicados } = replayMovimientos(TANQUES, movs);
  const t = aplicados[3];
  assert.equal(t.salida_partes.reduce((a, p) => a + p.litros, 0), 1000);
  assert.equal(t.llegada_partes.reduce((a, p) => a + p.litros, 0), 999);
  assert.equal(estado.A1.litros, 2000);
  assert.equal(estado.B1.litros, 999);
});

test('an unorderable fecha is refused by the gate and replayed last', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000 })]);
  for (const f of ['2025-09-01T09:30garbage', '2025-09-01 ayer', '2025-09-01T25:00:00Z', '2025-09-01T10:61:00Z']) {
    assert.ok(
      validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100, fecha: f })).some(e => /fecha valida/.test(e)),
      f,
    );
  }
  // a full ISO timestamp is a valid business date and keeps the day in `desde`
  const conHora = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-04T07:30:00Z' })]);
  assert.equal(conHora.A1.desde, '2025-09-04');

  // a row we cannot place in time is applied after the datable ones, not before
  const movs = [
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 1000, fecha: 'cuando se pueda' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-01' }),
  ];
  const { estado: e2, avisos } = replayMovimientos(TANQUES, movs);
  assert.equal(e2.B1.litros, 1000, 'the dateless trasiego must run after the recepcion');
  assert.deepEqual(avisos.map(a => a.codigo), ['sin_fecha']);
});

// --- cross-vendor review round 3 (gpt-6.1-sol, 2026-10-14) ------------------

test('a timestamp without a zone is refused, because it means two different instants', () => {
  const estado = deriveEstado(TANQUES, [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000 })]);
  const errs = (f) => validarMovimiento(estado, mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 100, fecha: f }));
  for (const f of ['2025-08-31T23:30:00', '2025-09-01T10:00:00+99:99', '2025-09-01T10:00:00+1500']) {
    assert.ok(errs(f).some(e => /fecha valida/.test(e)), `${f}: ${errs(f).join(' | ')}`);
  }
  for (const f of ['2025-09-01', '2025-09-01T10:00:00Z', '2025-09-01T10:00:00.123+00:00', '2025-09-01 10:00:00-07:00']) {
    assert.deepEqual(errs(f), [], f);
  }
  // the same log derives the same contents whatever the machine timezone says
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-01' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 1000, fecha: '2025-09-01T06:30:00Z' }),
  ];
  const e = deriveEstado(TANQUES, movs);
  assert.equal(e.A1.litros, 0, 'UTC midnight on the 1st comes before 06:30Z, so the trasiego finds the wine');
  assert.equal(e.B1.litros, 1000);
});

test('a lote never arrives with more litres than it sent', () => {
  const movs = [mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L0', volumen_l: 2, fecha: '2025-09-01' })];
  for (let i = 1; i <= 10; i++) {
    movs.push(mv({ tipo: 'recepcion', destino: 'A1', lot_code: `L${i}`, volumen_l: 1, fecha: '2025-09-02' }));
  }
  movs.push(mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 12, merma_l: 0.000007, fecha: '2025-09-10' }));
  const { estado, aplicados } = replayMovimientos(TANQUES, movs);
  const t = aplicados[aplicados.length - 1];
  for (const p of t.llegada_partes) {
    const enviado = t.salida_partes.find(x => x.lot_code === p.lot_code);
    assert.ok(p.litros <= enviado.litros, `${p.lot_code}: llego ${p.litros} y salio ${enviado.litros}`);
  }
  assert.equal(t.salida_partes.reduce((a, p) => a + p.litros, 0), 12);
  cerca(t.llegada_partes.reduce((a, p) => a + p.litros, 0), 11.999993, 1e-9);
  assert.equal(estado.A1.litros, 0);
  for (const lote of ['L0', 'L5']) {
    const r = recorridoLote(TANQUES, movs, lote);
    assert.ok(r.litros_merma >= 0, `${lote}: merma ${r.litros_merma}`);
    for (const paso of r.pasos) assert.ok(paso.merma_l >= 0, `${lote}: paso con merma ${paso.merma_l}`);
  }
});

test('historialTanque reports the litres the tank really moved, not the ones asked for', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 1000, fecha: '2025-09-01' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 4000, merma_l: 100, fecha: '2025-09-05' }),
    mv({ tipo: 'salida', origen: 'A1', volumen_l: 50, fecha: '2025-09-06', anulado: true }),
    mv({ tipo: 'trasiego', origen: 'ZZ9', destino: 'A1', volumen_l: 500, fecha: '2025-09-07' }),
  ];
  const h = historialTanque(TANQUES, movs, 'A1', { incluirAnulados: true });
  assert.deepEqual(h.map(r => [r.tipo, r.direccion, r.volumen_l, r.delta_l, r.aplicado]), [
    ['recepcion', 'entrada', 1000, 1000, true],
    ['trasiego', 'salida', 4000, -1000, true],   // clamped to what A1 held
    ['salida', 'salida', 50, 0, false],          // anulado
    ['trasiego', 'entrada', 500, 0, false],      // origin outside the catalog
  ]);
  const b1 = historialTanque(TANQUES, movs, 'B1');
  assert.equal(b1[0].delta_l, 900, 'B1 received the clamped 1000 L less the 100 L merma');
  assert.equal(deriveEstado(TANQUES, movs).B1.litros, 900);
});

// --- cross-vendor review round 4 (gpt-6.1-sol, 2026-10-14) ------------------

test('a one-microlitre share of a blend is moved, not dropped', () => {
  const movs = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L1', volumen_l: 9999.99, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: 'L2', volumen_l: 0.01, fecha: '2025-09-02' }),
  ];
  for (let i = 0; i < 1000; i++) {
    movs.push(mv({ tipo: 'trasiego', origen: 'A1', destino: 'A2', volumen_l: 1, fecha: '2025-09-10', created_at: `2025-09-10T00:00:00.${String(i).padStart(4, '0')}Z` }));
  }
  const { estado, balance, avisos } = replayMovimientos(TANQUES, movs);
  assert.deepEqual(avisos, []);
  assert.equal(balance.descuadre_l, 0, 'litres cannot disappear without a merma');
  assert.equal(balance.merma_l, 0);
  cerca(estado.A2.litros, 1000, 1e-6);
  cerca(estado.A1.litros, 9000, 1e-6);
  cerca(estado.A1.litros + estado.A2.litros, 10000, 1e-6);
  // the small lote travelled with the big one instead of evaporating
  const l2 = recorridoLote(TANQUES, movs, 'L2');
  assert.ok(l2.tanques_actuales.some(t => t.codigo === 'A2'), 'L2 must appear in A2');
  cerca(l2.litros_actuales, 0.01, 1e-6);
  assert.equal(l2.litros_merma, 0);
});

test('two timestamps inside the same millisecond keep their order', () => {
  const tanques = [{ codigo: 'A', capacidad_l: 100 }, { codigo: 'B', capacidad_l: 100 }];
  const movs = [
    { tipo: 'trasiego', origen: 'A', destino: 'B', volumen_l: 100, merma_l: 0, fecha: '2025-09-01', created_at: '2025-09-01T12:00:00.000200Z' },
    { tipo: 'recepcion', destino: 'A', lot_code: 'L1', volumen_l: 100, merma_l: 0, fecha: '2025-09-01', created_at: '2025-09-01T12:00:00.000100Z' },
  ];
  const { estado, avisos } = replayMovimientos(tanques, movs);
  assert.deepEqual(avisos, []);
  assert.equal(estado.A.litros, 0);
  assert.equal(estado.B.litros, 100);
  // and the same two rows in the other array order derive the same state
  const otro = replayMovimientos(tanques, [movs[1], movs[0]]).estado;
  assert.equal(otro.B.litros, 100);
});

test('the module stays pure: no imports, no DOM, no network', () => {
  const src = readFileSync(new URL('../js/tanques/estado.js', import.meta.url), 'utf8');
  for (const bad of [/^\s*import\s/m, /\brequire\s*\(/, /\bdocument\./, /\bwindow\./, /\bfetch\s*\(/, /\blocalStorage\b/, /\bprocess\./]) {
    assert.ok(!bad.test(src), `estado.js must not contain ${bad}`);
  }
  assert.deepEqual(TIPOS, ['recepcion', 'trasiego', 'descube', 'sangrado', 'prensa', 'ensamble', 'salida']);
  assert.deepEqual(ETAPAS, ['rec', 'mac', 'fa', 'des', 'fml', 'cri', 'emb']);
});

test('deriveEstado does not mutate its inputs', () => {
  const tanques = JSON.parse(JSON.stringify(TANQUES));
  const movs = fixture20();
  const antesT = JSON.stringify(tanques);
  const antesM = JSON.stringify(movs);
  deriveEstado(tanques, movs);
  assert.equal(JSON.stringify(tanques), antesT);
  assert.equal(JSON.stringify(movs), antesM);
});

test('deriveEstado tolerates missing or junk inputs', () => {
  assert.deepEqual(Object.keys(deriveEstado(null, null)), []);
  assert.deepEqual(Object.keys(deriveEstado(undefined, undefined)), []);
  const estado = deriveEstado([{ codigo: 'A1', capacidad_l: null }, { codigo: null }], [null, 42]);
  assert.equal(estado.A1.capacidad_l, 0);
  assert.equal(Object.keys(estado).length, 1);
});

// 20 movements: recepciones, descubes, a blend, partial moves out of the blend,
// a salida, an anulado row, and one row out of chronological order.
function fixture20() {
  const filas = [
    mv({ tipo: 'recepcion', destino: 'A1', lot_code: '25CS-1', volumen_l: 18000, merma_l: 120, fecha: '2025-09-01' }),
    mv({ tipo: 'recepcion', destino: 'A2', lot_code: '25ME-1', volumen_l: 15000, merma_l: 80, fecha: '2025-09-02' }),
    mv({ tipo: 'recepcion', destino: 'B1', lot_code: '25CH-1', volumen_l: 9000, merma_l: 40, fecha: '2025-09-03' }),
    mv({ tipo: 'sangrado', origen: 'A1', destino: 'B2', volumen_l: 1500, merma_l: 10, fecha: '2025-09-05' }),
    mv({ tipo: 'trasiego', origen: 'B1', destino: 'TIBOR 1', volumen_l: 800, merma_l: 5, fecha: '2025-09-06' }),
    mv({ tipo: 'descube', origen: 'A1', destino: 'A2', volumen_l: 4000, merma_l: 60, fecha: '2025-09-20' }),
    mv({ tipo: 'descube', origen: 'A1', destino: 'B1', volumen_l: 1000, merma_l: 30, fecha: '2025-09-21' }),
    mv({ tipo: 'trasiego', origen: 'B1', destino: 'B2', volumen_l: 3000, merma_l: 25, fecha: '2025-09-25' }),
    mv({ tipo: 'salida', origen: 'B2', volumen_l: 1200, fecha: '2025-09-28', nota: 'prueba de embotellado' }),
    mv({ tipo: 'trasiego', origen: 'A2', destino: 'B1', volumen_l: 3000, merma_l: 45, fecha: '2025-10-01' }),
    mv({ tipo: 'prensa', origen: 'A1', destino: 'TIBOR 1', volumen_l: 150, merma_l: 3, fecha: '2025-10-03' }),
    mv({ tipo: 'ensamble', origen: 'B2', destino: 'A1', volumen_l: 2500, merma_l: 20, fecha: '2025-10-10' }),
    mv({ tipo: 'recepcion', destino: 'B2', lot_code: '25SY-1', volumen_l: 2000, merma_l: 15, fecha: '2025-10-12' }),
    mv({ tipo: 'trasiego', origen: 'B2', destino: 'B1', volumen_l: 800, merma_l: 8, fecha: '2025-10-20' }),
    mv({ tipo: 'trasiego', origen: 'A2', destino: 'A1', volumen_l: 3000, merma_l: 30, fecha: '2025-11-01', anulado: true }),
    mv({ tipo: 'salida', origen: 'A2', volumen_l: 2000, merma_l: 0, fecha: '2025-11-05' }),
    mv({ tipo: 'trasiego', origen: 'TIBOR 1', destino: 'B2', volumen_l: 400, merma_l: 4, fecha: '2025-11-10' }),
    mv({ tipo: 'descube', origen: 'B1', destino: 'A2', volumen_l: 6000, merma_l: 50, fecha: '2025-12-01' }),
    mv({ tipo: 'trasiego', origen: 'A1', destino: 'B1', volumen_l: 2500, merma_l: 22, fecha: '2026-01-15' }),
    mv({ tipo: 'salida', origen: 'A2', volumen_l: 3500, fecha: '2026-01-20' }),
  ];
  // the newest row comes first in the array on purpose: the replay must sort, not trust input order
  return [filas[filas.length - 1], ...filas.slice(0, -1)];
}

// Cross-vendor review 2026-10-15: three holes in what the validator accepts and
// what the replay does with it.
test('a withdrawal that rounds to zero microlitres is refused, so salido never grows while nothing leaves', () => {
  const cat = [{ codigo: 'A', capacidad_l: 200 }];
  const filas = [{ tipo: 'recepcion', destino: 'A', lot_code: 'L', fecha: '2025-09-01', volumen_l: 1 }];
  const tiny = { tipo: 'salida', origen: 'A', fecha: '2025-09-02', volumen_l: 0.0000004 };
  assert.ok(validarMovimientoEnLog(cat, filas, tiny).length > 0);
  for (let k = 0; k < 3000; k++) filas.push({ ...tiny });
  const r = replayMovimientos(cat, filas);
  assert.equal(r.balance.salido_l, 0);
  assert.equal(r.balance.en_tanques_l, 1);
  assert.equal(r.balance.descuadre_l, 0);
  assert.ok(r.avisos.every(a => a.codigo === 'volumen_invalido'));
});

test('a supplied merma that is not a finite number is an error, never a silent zero', () => {
  const cat = [{ codigo: 'A', capacidad_l: 200 }];
  for (const merma_l of ['10', true, NaN, Infinity, {}, -1]) {
    const mov = { tipo: 'recepcion', destino: 'A', lot_code: 'L', fecha: '2025-09-01', volumen_l: 100, merma_l };
    assert.ok(validarMovimientoEnLog(cat, [], mov).length > 0, `validation accepted merma ${String(merma_l)}`);
    const r = replayMovimientos(cat, [mov]);
    assert.equal(r.estado.A.litros, 0, `replay applied a row with merma ${String(merma_l)}`);
    assert.ok(r.avisos.some(a => a.codigo === 'merma_invalida'));
  }
  // absent merma still means zero
  const ok = { tipo: 'recepcion', destino: 'A', lot_code: 'L', fecha: '2025-09-01', volumen_l: 100, merma_l: null };
  assert.deepEqual(validarMovimientoEnLog(cat, [], ok), []);
  assert.equal(replayMovimientos(cat, [ok]).estado.A.litros, 100);
});

test('inherited property names are unknown tanks, and __proto__ works as a real catalog code', () => {
  const cat = [{ codigo: 'A', capacidad_l: 200 }];
  for (const ref of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
    const mov = { tipo: 'recepcion', destino: ref, lot_code: 'L', fecha: '2025-09-01', volumen_l: 100 };
    const r = replayMovimientos(cat, [mov]);
    assert.ok(r.avisos.some(a => a.codigo === 'tanque_desconocido'), ref);
    assert.ok(validarMovimientoEnLog(cat, [], mov).length > 0, ref);
  }
  const raro = [{ codigo: '__proto__', capacidad_l: 200 }];
  const r = replayMovimientos(raro, [{ tipo: 'recepcion', destino: '__proto__', lot_code: 'L', fecha: '2025-09-01', volumen_l: 50 }]);
  assert.equal(r.estado.__proto__.litros, 50);
  assert.equal(r.balance.descuadre_l, 0);
});

test('amounts too large to count in whole microlitres are refused, not turned into Infinity', () => {
  const cat = [{ codigo: 'A', capacidad_l: 200 }];
  const mov = { tipo: 'recepcion', destino: 'A', lot_code: 'L', fecha: '2025-09-01', volumen_l: Number.MAX_VALUE, merma_l: Number.MAX_VALUE };
  assert.ok(validarMovimientoEnLog(cat, [], mov).length > 0);
  const r = replayMovimientos(cat, [mov]);
  assert.equal(r.estado.A.litros, 0);
  assert.ok(Number.isFinite(r.balance.descuadre_l) && r.balance.descuadre_l === 0);
  const sinMerma = { ...mov, merma_l: undefined, volumen_l: 1e300 };
  assert.ok(validarMovimientoEnLog(cat, [], sinMerma).length > 0);
});

test('historialTanque keeps each occurrence apart when the same row object appears twice', () => {
  const cat = [{ codigo: 'A', capacidad_l: 200 }];
  const rec = { tipo: 'recepcion', destino: 'A', lot_code: 'L', fecha: '2025-09-01', volumen_l: 100 };
  const sal = { tipo: 'salida', origen: 'A', fecha: '2025-09-02', volumen_l: 60 };
  const h = historialTanque(cat, [rec, sal, sal], 'A');
  const salidas = h.filter(f => f.direccion === 'salida').map(f => f.movido_l).sort((a, b) => b - a);
  assert.deepEqual(salidas, [60, 40]);
});

test('one movement cannot carry more than a million litres, where microlitres stop being exact', () => {
  const cat = [{ codigo: 'A', capacidad_l: 1e6 }];
  // a capacity past the cap is treated as unregistered, so nothing can fill it
  const gigante = [{ codigo: 'G', capacidad_l: 1e10 }];
  assert.equal(replayMovimientos(gigante, []).estado.G.capacidad_l, 0);
  assert.ok(validarMovimientoEnLog(gigante, [], { tipo: 'recepcion', destino: 'G', lot_code: 'L', fecha: '2025-09-01', volumen_l: 10 }).length > 0);
  const enorme = { tipo: 'recepcion', destino: 'A', lot_code: 'L', fecha: '2025-09-01', volumen_l: 9e9 };
  assert.ok(validarMovimientoEnLog(cat, [], enorme).length > 0);
  assert.equal(replayMovimientos(cat, [enorme]).estado.A.litros, 0);
  // at the cap, a thousand one-microlitre withdrawals still balance exactly
  const filas = [{ ...enorme, volumen_l: 1e6 }];
  for (let k = 0; k < 1000; k++) filas.push({ tipo: 'salida', origen: 'A', fecha: '2025-09-02', volumen_l: 0.000001 });
  const r = replayMovimientos(cat, filas);
  assert.equal(r.avisos.length, 0);
  assert.equal(r.estado.A.litros, 999999.999);
  assert.equal(r.balance.descuadre_l, 0);
});
