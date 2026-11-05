// MT.61f - the stage filter chips of the bodega plan (xd-3c2.3).
// Daniel 2026-11-05: light up only the tanks in crianza, fermentacion
// alcoholica or monitoreo FML. None on means every tank is lit; one or more on
// means only tanks in those stages stay lit; a tank with no stage goes dark.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FILTROS_ETAPA, FILTRO_ETIQUETAS, tanqueIluminado, alternarFiltro,
} from '../js/tanques/filtro.js';
import { ETAPAS } from '../js/tanques/estado.js';

const cri = { litros: 5000, etapa: 'cri' };
const fa = { litros: 3000, etapa: 'fa' };
const fml = { litros: 2000, etapa: 'fml' };
const mac = { litros: 1000, etapa: 'mac' };
const sinEtapa = { litros: 1500, etapa: null };
const vacio = { litros: 0, etapa: null };

describe('MT.61f - filtros por etapa del mapa', () => {
  it('the three chips are real estado.js stages with Spanish labels', () => {
    assert.deepEqual(FILTROS_ETAPA, ['cri', 'fa', 'fml']);
    for (const e of FILTROS_ETAPA) {
      assert.ok(ETAPAS.includes(e), e);
      assert.ok(FILTRO_ETIQUETAS[e], e);
    }
    assert.equal(FILTRO_ETIQUETAS.cri, 'Crianza');
    assert.equal(FILTRO_ETIQUETAS.fa, 'Fermentación alcohólica');
    assert.equal(FILTRO_ETIQUETAS.fml, 'Monitoreo FML');
  });

  it('none on: every tank is lit, empty and stageless ones too', () => {
    for (const est of [cri, fa, fml, mac, sinEtapa, vacio, undefined, null]) {
      assert.equal(tanqueIluminado(est, new Set()), true);
      assert.equal(tanqueIluminado(est, undefined), true);
      assert.equal(tanqueIluminado(est, []), true);
    }
  });

  it('one on: only tanks in that stage are lit', () => {
    const on = new Set(['cri']);
    assert.equal(tanqueIluminado(cri, on), true);
    assert.equal(tanqueIluminado(fa, on), false);
    assert.equal(tanqueIluminado(fml, on), false);
    assert.equal(tanqueIluminado(mac, on), false);
    assert.equal(tanqueIluminado(vacio, on), false);
  });

  it('two on: tanks in either stage are lit', () => {
    const on = new Set(['fa', 'fml']);
    assert.equal(tanqueIluminado(fa, on), true);
    assert.equal(tanqueIluminado(fml, on), true);
    assert.equal(tanqueIluminado(cri, on), false);
    assert.equal(tanqueIluminado(mac, on), false);
  });

  it('a tank with no stage, or no state at all, goes dark when a chip is on', () => {
    const on = new Set(['cri']);
    assert.equal(tanqueIluminado(sinEtapa, on), false);
    assert.equal(tanqueIluminado(undefined, on), false);
    assert.equal(tanqueIluminado(null, on), false);
  });

  it('an empty tank whose stage was left over is not lit', () => {
    assert.equal(tanqueIluminado({ litros: 0, etapa: 'cri' }, new Set(['cri'])), false);
  });

  it('an unknown code in the set counts as no chip', () => {
    assert.equal(tanqueIluminado(mac, new Set(['xyz'])), true);
  });

  it('alternarFiltro toggles one chip and keeps the others', () => {
    let s = alternarFiltro(new Set(), 'cri');
    assert.deepEqual([...s], ['cri']);
    s = alternarFiltro(s, 'fa');
    assert.deepEqual([...s].sort(), ['cri', 'fa']);
    const antes = s;
    s = alternarFiltro(s, 'cri');
    assert.deepEqual([...s], ['fa']);
    assert.deepEqual([...antes].sort(), ['cri', 'fa'], 'returns a new set');
    assert.deepEqual([...alternarFiltro(s, 'mac')], ['fa'], 'unknown code ignored');
  });
});
