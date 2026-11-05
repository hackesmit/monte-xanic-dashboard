// MT.63 - the 'Movimientos recientes' list under the bodega plan (xd-3c2.4).
// Daniel 2026-11-05: show the movements of the last few days, 3 by default,
// with a week and a month option. The window counts calendar days in the
// vineyard (the boundary day is in), newest first, and never changes the log.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { movimientosEnVentana } from '../js/tanques/estado.js';

const mov = (id, fecha, extra = {}) => ({
  id, fecha, tipo: 'trasiego', origen: 'TQ-1', destino: 'TQ-2', lot_code: 'L', volumen_l: 100, ...extra,
});

describe('MT.63 - movimientos en ventana', () => {
  const log = [
    mov(1, '2026-11-02'),
    mov(2, '2026-11-03'),
    mov(3, '2026-11-05'),
    mov(4, '2026-11-04'),
    mov(5, '2026-10-07'),
    mov(6, '2026-10-06'),
    mov(7, '2026-10-29'),
  ];
  const ids = (r) => r.map((m) => m.id);

  it('3 days keeps today and the two days before it, boundary included', () => {
    assert.deepEqual(ids(movimientosEnVentana(log, '2026-11-05', 3)), [3, 4, 2]);
  });

  it('7 and 30 days widen the window, boundary day in, the day before out', () => {
    assert.deepEqual(ids(movimientosEnVentana(log, '2026-11-05', 7)), [3, 4, 2, 1]);
    // On 2026-11-04 the 11-05 row is future-dated: it stays, on top (see below).
    assert.deepEqual(ids(movimientosEnVentana(log, '2026-11-04', 7)).slice(1), [4, 2, 1, 7]);
    assert.deepEqual(ids(movimientosEnVentana(log, '2026-11-05', 30)), [3, 4, 2, 1, 7, 5]);
  });

  it('the window crosses month and year ends', () => {
    const r = movimientosEnVentana([mov(1, '2025-12-30'), mov(2, '2025-12-29'), mov(3, '2026-01-01')], '2026-01-01', 3);
    assert.deepEqual(ids(r), [3, 1]);
  });

  it('same day: newest by created_at first, then by log position', () => {
    const r = movimientosEnVentana([
      mov('a', '2026-11-05', { created_at: '2026-11-05T10:00:00Z' }),
      mov('b', '2026-11-05', { created_at: '2026-11-05T18:00:00Z' }),
      mov('c', '2026-11-05', { created_at: '2026-11-05T18:00:00Z' }),
    ], '2026-11-05', 3);
    assert.deepEqual(ids(r), ['c', 'b', 'a']);
  });

  it('drops anulado rows, rows without a valid fecha and junk', () => {
    const r = movimientosEnVentana([
      mov(1, '2026-11-05', { anulado: true }),
      mov(2, ''),
      mov(3, 'ayer'),
      null,
      'x',
      mov(4, '2026-11-05T08:00:00Z'),
    ], '2026-11-05', 3);
    assert.deepEqual(ids(r), [4]);
  });

  it('keeps a future-dated row, on top', () => {
    assert.deepEqual(ids(movimientosEnVentana([mov(1, '2026-11-05'), mov(2, '2026-11-09')], '2026-11-05', 3)), [2, 1]);
  });

  it('a bad hoy or dias gives an empty list', () => {
    for (const [hoy, dias] of [['', 3], ['5/11/2026', 3], ['2026-11-05', 0], ['2026-11-05', -3], ['2026-11-05', 2.5], ['2026-11-05', 'x']]) {
      assert.deepEqual(movimientosEnVentana(log, hoy, dias), [], `${hoy} ${dias}`);
    }
    assert.deepEqual(movimientosEnVentana(undefined, '2026-11-05', 3), []);
  });

  it('returns the original rows and leaves the log untouched', () => {
    const copia = JSON.parse(JSON.stringify(log));
    const r = movimientosEnVentana(log, '2026-11-05', 3);
    assert.equal(r[0], log[2]);
    assert.deepEqual(log, copia);
  });
});
