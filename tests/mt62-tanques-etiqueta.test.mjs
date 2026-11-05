// MT.62 - the wine code drawn under each tank on the bodega plan (xd-3c2.1).
// Daniel 2026-11-05: show the wine code under the tank, not its capacity.
// The label names the largest lote, adds '+N' for the others, shows nothing
// for an empty tank, and fits the tank width (the full codes stay in the
// tank's aria label).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaTanque, ETIQUETA_MAX } from '../js/tanques/etiqueta.js';

describe('MT.62 - etiqueta bajo el tanque', () => {
  it('an empty tank has no label', () => {
    assert.equal(etiquetaTanque([]), '');
    assert.equal(etiquetaTanque(undefined), '');
    assert.equal(etiquetaTanque(null), '');
    assert.equal(etiquetaTanque([{ lot_code: '25CSKMP-1', litros: 0 }]), '');
  });

  it('one lote shows its code', () => {
    assert.equal(etiquetaTanque([{ lot_code: '25CSKMP-1', litros: 5000 }]), '25CSKMP-1');
  });

  it('three lotes show the largest and +2', () => {
    const partes = [
      { lot_code: '25MEKMP-3', litros: 800 },
      { lot_code: '25CSKMP-9', litros: 4200 },
      { lot_code: '25DUKMP-3', litros: 1000 },
    ];
    assert.equal(etiquetaTanque(partes), '25CSKMP-9 +2');
  });

  it('a tie keeps the first lote in the log order', () => {
    const partes = [{ lot_code: 'A', litros: 10 }, { lot_code: 'B', litros: 10 }];
    assert.equal(etiquetaTanque(partes), 'A +1');
  });

  it('a lote with no litres does not count toward +N', () => {
    const partes = [{ lot_code: 'A', litros: 10 }, { lot_code: 'B', litros: 0 }];
    assert.equal(etiquetaTanque(partes), 'A');
  });

  it('a long code is cut with an ellipsis to fit the tank width', () => {
    const solo = etiquetaTanque([{ lot_code: '25CSKMP-VDG-RESERVA-1', litros: 100 }]);
    assert.equal(solo.length, ETIQUETA_MAX);
    assert.ok(solo.endsWith('…'));
    assert.ok(solo.startsWith('25CSKMP-V'));

    const mezcla = etiquetaTanque([
      { lot_code: '25CSKMP-VDG-RESERVA-1', litros: 100 },
      { lot_code: 'B', litros: 1 },
    ]);
    assert.ok(mezcla.endsWith('… +1'), mezcla);
    assert.ok(mezcla.length <= ETIQUETA_MAX + 3, mezcla);
  });

  it('a code exactly at the limit is not cut', () => {
    const code = 'X'.repeat(ETIQUETA_MAX);
    assert.equal(etiquetaTanque([{ lot_code: code, litros: 1 }]), code);
  });
});
