// mt53 - the bodega plan's layout and colour mapping (js/tanques/plan.js).
// Bead xd-qrn.4. Spec: state/specs/xd-tanques/SPEC.md and the approved mockup.
//
// This is the test the Tanques tab's geometry cannot be seen to pass without:
// a plan that drops a tank, stacks two lids on each other, or draws a 2 150 L
// tank taller than an 18 700 L one still renders happily in a browser and still
// looks like a floor plan. The real catalog is read out of the migration, so a
// seed edit that breaks the floor fails here instead of in production.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogoTanques } from './fixtures/tanques-catalogo.mjs';
import { CONFIG } from '../js/config.js';
import { ETAPAS } from '../js/tanques/estado.js';
import {
  POSICION_1_AL, GEOMETRIA, FILAS_PLANO,
  construirPlano, alturaDeCapacidad, fechaCorta, cadenasRecorrido,
  MODOS, ETAPA_ETIQUETAS, NIVELES_OCUPACION,
  TOKEN_VARIEDAD, TOKEN_VARIEDAD_OTRA, TOKEN_VACIO, TOKEN_ETAPA_ND,
  variedadDeLote, tokenVariedad, tokenEtapa, tokenBanda, nivelOcupacion,
} from '../js/tanques/plan.js';

const CATALOGO = catalogoTanques();
const PLAN = construirPlano(CATALOGO, { direccion: POSICION_1_AL });
const CSS = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');

const esFerm = (t) => /^[A-H]$/.test(t.fila || '');

describe('mt53 - the floor is complete', () => {
  test('every fermentation and reception vessel is placed, every other one trayed', () => {
    const ferm = PLAN.ubicados.filter(esFerm);
    const rec = PLAN.ubicados.filter((t) => !esFerm(t));
    assert.equal(ferm.length, 68, 'rows A-H hold 68 tanks in the inventory');
    assert.equal(rec.length, 4, 'the reception strip holds R1, R2, PD-1 and PD-2');
    assert.deepEqual(rec.map((t) => t.codigo).sort(), ['PD-1', 'PD-2', 'R1', 'R2']);
    assert.equal(PLAN.ubicados.length + PLAN.otras.length, CATALOGO.length,
      'no vessel is lost between the floor and the tray');
    assert.deepEqual(PLAN.sinUbicar, [], 'no located vessel failed to place');
  });

  test('the tray is exactly the vessels with no confirmed location', () => {
    const trayed = new Set(PLAN.otras.map((t) => t.codigo));
    for (const t of CATALOGO) {
      const located = t.fila !== null && t.posicion !== null;
      assert.equal(trayed.has(t.codigo), !located,
        `${t.codigo} is ${located ? 'located' : 'unlocated'} but ${trayed.has(t.codigo) ? 'trayed' : 'on the floor'}`);
    }
    assert.equal(PLAN.otras.length, 49);
  });

  test('a row letter the catalog could add but the plan cannot draw is reported, not dropped', () => {
    const p = construirPlano([
      { codigo: 'A1', fila: 'A', posicion: 1, capacidad_l: 7400, area: 'fermentacion', tipo: 'TQ' },
      { codigo: 'Z9', fila: 'Z', posicion: 1, capacidad_l: 1000, area: 'fermentacion', tipo: 'TQ' },
      { codigo: '', fila: 'A', posicion: 2, capacidad_l: 1000, area: 'fermentacion', tipo: 'TQ' },
    ]);
    assert.deepEqual(p.ubicados.map((t) => t.codigo), ['A1']);
    assert.deepEqual(p.sinUbicar, ['Z9']);
    assert.deepEqual(p.otras, [], 'a bad row is not quietly turned into a trayed vessel');
  });
});

describe('mt53 - no two lids overlap', () => {
  // The lid is the ellipse a user clicks and reads the code off. Two lids that
  // intersect make one tank unreachable, which is the one failure mode a
  // screenshot at a glance will not show.
  test('every pair of drawn lids is disjoint', () => {
    const { R, RY } = GEOMETRIA;
    const lids = PLAN.ubicados.map((t) => ({ codigo: t.codigo, cx: t.x, cy: t.y - t.altura }));
    const choques = [];
    for (let i = 0; i < lids.length; i++) {
      for (let j = i + 1; j < lids.length; j++) {
        const dx = (lids[i].cx - lids[j].cx) / (2 * R);
        const dy = (lids[i].cy - lids[j].cy) / (2 * RY);
        if (dx * dx + dy * dy < 1) choques.push(`${lids[i].codigo}/${lids[j].codigo}`);
      }
    }
    assert.deepEqual(choques, []);
  });

  test('every floor point is disjoint too, so the bases do not merge', () => {
    const { R, RY } = GEOMETRIA;
    const choques = [];
    const bases = PLAN.ubicados.map((t) => ({ codigo: t.codigo, x: t.x, y: t.y }));
    for (let i = 0; i < bases.length; i++) {
      for (let j = i + 1; j < bases.length; j++) {
        const dx = (bases[i].x - bases[j].x) / (2 * R);
        const dy = (bases[i].y - bases[j].y) / (2 * RY);
        if (dx * dx + dy * dy < 1) choques.push(`${bases[i].codigo}/${bases[j].codigo}`);
      }
    }
    assert.deepEqual(choques, []);
  });

  test('the whole drawing fits inside the viewBox it declares', () => {
    const { R, RY } = GEOMETRIA;
    for (const t of PLAN.ubicados) {
      assert.ok(t.x - R >= 0 && t.x + R <= PLAN.ancho, `${t.codigo} is outside the width`);
      assert.ok(t.y - t.altura - RY >= 0, `${t.codigo}'s lid is above the top edge`);
      assert.ok(t.y + RY + 12 <= PLAN.alto, `${t.codigo}'s base is below the bottom edge`);
    }
  });
});

describe('mt53 - height reads capacity', () => {
  test('drawn height is monotonic in capacity across the whole floor', () => {
    const porCap = [...PLAN.ubicados].sort((a, b) => a.capacidad_l - b.capacidad_l);
    for (let i = 1; i < porCap.length; i++) {
      const a = porCap[i - 1], b = porCap[i];
      if (a.capacidad_l === b.capacidad_l) {
        assert.equal(a.altura, b.altura, `${a.codigo} and ${b.codigo} share a capacity but not a height`);
      } else {
        assert.ok(b.altura > a.altura,
          `${b.codigo} (${b.capacidad_l} L) is not drawn taller than ${a.codigo} (${a.capacidad_l} L)`);
      }
    }
  });

  test('the tallest located tank reaches H_MAX and nothing exceeds it', () => {
    const alto = Math.max(...PLAN.ubicados.map((t) => t.altura));
    assert.equal(alto, GEOMETRIA.H_MAX);
    assert.equal(PLAN.referencia_l, Math.max(...PLAN.ubicados.map((t) => t.capacidad_l)));
    for (const t of PLAN.ubicados) {
      assert.ok(t.altura >= GEOMETRIA.H_MIN && t.altura <= GEOMETRIA.H_MAX, t.codigo);
    }
  });

  test('alturaDeCapacidad refuses to invent a height', () => {
    assert.equal(alturaDeCapacidad(0, 18700), GEOMETRIA.H_MIN);
    assert.equal(alturaDeCapacidad(-5, 18700), GEOMETRIA.H_MIN);
    assert.equal(alturaDeCapacidad(null, 18700), GEOMETRIA.H_MIN);
    assert.equal(alturaDeCapacidad(1000, 0), GEOMETRIA.H_MIN);
    assert.equal(alturaDeCapacidad(18700, 18700), GEOMETRIA.H_MAX);
    // Clamped, never taller than the reference.
    assert.equal(alturaDeCapacidad(45000, 18700), GEOMETRIA.H_MAX);
  });
});

describe('mt53 - rows, walkways and the numbering direction', () => {
  test('rows run A at the north to H at the south', () => {
    assert.deepEqual(PLAN.filas.map((f) => f.letra), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    for (let i = 1; i < PLAN.filas.length; i++) {
      assert.ok(PLAN.filas[i].y > PLAN.filas[i - 1].y,
        `${PLAN.filas[i].letra} must be south of ${PLAN.filas[i - 1].letra}`);
    }
  });

  test('the walkways are A | B C | D E | F G | H', () => {
    assert.equal(PLAN.pasillos.length, 4);
    const y = Object.fromEntries(PLAN.filas.map((f) => [f.letra, f.y]));
    const entre = (a, b) => PLAN.pasillos.some((p) => p > y[a] - GEOMETRIA.ROWH && p < y[b]);
    for (const [a, b] of [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H']]) {
      assert.ok(entre(a, b), `no walkway between rows ${a} and ${b}`);
    }
    // B/C, D/E and F/G touch: their gap is one row pitch and no walkway.
    for (const [a, b] of [['B', 'C'], ['D', 'E'], ['F', 'G']]) {
      assert.equal(y[b] - y[a], GEOMETRIA.ROWH, `rows ${a} and ${b} must touch`);
    }
    assert.deepEqual(FILAS_PLANO.filter((f) => f === null).length, 4);
  });

  test('position 1 sits at the west end and the direction is one flag', () => {
    assert.equal(POSICION_1_AL, 'oeste');
    const porFila = new Map();
    for (const t of PLAN.ubicados.filter(esFerm)) {
      if (!porFila.has(t.fila)) porFila.set(t.fila, []);
      porFila.get(t.fila).push(t);
    }
    const x1 = new Set();
    for (const [fila, ts] of porFila) {
      ts.sort((a, b) => a.posicion - b.posicion);
      for (let i = 1; i < ts.length; i++) {
        assert.ok(ts[i].x > ts[i - 1].x, `${fila}: position ${ts[i].posicion} is not east of ${ts[i - 1].posicion}`);
      }
      x1.add(ts[0].x);
    }
    assert.equal(x1.size, 1, 'tank 1 of every row shares one x, so the rows line up');

    // Flipping the assumption mirrors the floor and changes nothing else.
    const este = construirPlano(CATALOGO, { direccion: 'este' });
    assert.equal(este.ancho, PLAN.ancho);
    assert.equal(este.alto, PLAN.alto);
    const h11 = este.ubicados.find((t) => t.codigo === 'H11');
    const h1 = este.ubicados.find((t) => t.codigo === 'H1');
    assert.ok(h1.x > h11.x, 'with position 1 at the east, H1 is east of H11');
    assert.equal(h11.x, GEOMETRIA.X0);
  });

  test('the reception strip is west of every fermentation row', () => {
    const minFerm = Math.min(...PLAN.ubicados.filter(esFerm).map((t) => t.x));
    for (const t of PLAN.ubicados.filter((x) => !esFerm(x))) {
      assert.ok(t.x + GEOMETRIA.R < minFerm - GEOMETRIA.R,
        `${t.codigo} overlaps the fermentation columns`);
    }
    const y = Object.fromEntries(PLAN.filas.map((f) => [f.letra, f.y]));
    // R1/R2 share row A's line, PD-1/PD-2 share row B's (mockup, approved).
    assert.equal(PLAN.ubicados.find((t) => t.codigo === 'R1').y, y.A);
    assert.equal(PLAN.ubicados.find((t) => t.codigo === 'PD-2').y, y.B);
  });
});

describe('mt53 - lot code to variety', () => {
  test('the wine dialect resolves through CONFIG, not a new parser', () => {
    assert.equal(variedadDeLote('25CSKMP-5'), 'Cabernet Sauvignon');
    assert.equal(variedadDeLote('25SBVDG-1'), 'Sauvignon Blanc');
    assert.equal(variedadDeLote('24CSCC-1'), 'Cabernet Sauvignon');
    assert.equal(variedadDeLote('25SY7L-1'), 'Syrah');
    assert.equal(variedadDeLote('25PVVA-1'), 'Petit Verdot');
    assert.equal(variedadDeLote('25MADUB-2'), 'Malbec');
    // Longest abbreviation wins, or Marselan would read as Malbec.
    assert.equal(variedadDeLote('25MARVDG-1'), 'Marselan');
    assert.equal(variedadDeLote('25MRSKMP-1'), 'Marselan');
    // Petite Sirah is Durif, normalized in exactly one place.
    assert.equal(variedadDeLote('25PSVDG-1'), 'Durif');
    assert.equal(variedadDeLote('25DUKMP-1'), 'Durif');
    // No vintage prefix, and the berry dialect where K is the ranch.
    assert.equal(variedadDeLote('CSKMP-5'), 'Cabernet Sauvignon');
    assert.equal(variedadDeLote('KCF-S1-PA'), 'Cabernet Franc');
    assert.equal(variedadDeLote('kcf-s1-pa'), 'Cabernet Franc');
  });

  test('a code that names no variety says so instead of guessing', () => {
    assert.equal(variedadDeLote(''), null);
    assert.equal(variedadDeLote(null), null);
    assert.equal(variedadDeLote('25XXKMP-1'), null);
    assert.equal(tokenVariedad(variedadDeLote('25XXKMP-1')), TOKEN_VARIEDAD_OTRA);
  });

  test('every abbreviation the dashboard knows has a tank colour token', () => {
    for (const [code, nombre] of Object.entries(CONFIG.varietyAbbr)) {
      const full = CONFIG.normalizeVariety(nombre);
      assert.ok(TOKEN_VARIEDAD[full],
        `varietyAbbr ${code} -> ${full} has no --tank-v-* token, so its band would fall back to grey`);
    }
  });
});

describe('mt53 - every colour is a token that exists', () => {
  const definidos = new Set([...CSS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));

  test('the variety, stage, fill-level and steel tokens are all defined in both themes', () => {
    const tokens = [
      ...Object.values(TOKEN_VARIEDAD),
      TOKEN_VARIEDAD_OTRA,
      TOKEN_VACIO,
      ...ETAPAS.map((e) => tokenEtapa(e)),
      TOKEN_ETAPA_ND,
      ...NIVELES_OCUPACION.map((n) => n.token),
      '--tank-floor', '--tank-path', '--tank-path-text',
      '--tank-steel-top', '--tank-steel-side', '--tank-steel-edge',
      '--tank-shadow', '--tank-gloss',
    ];
    const faltan = tokens.filter((t) => !definidos.has(t));
    assert.deepEqual(faltan, [], `js/tanques/plan.js names tokens css/styles.css never defines: ${faltan}`);
    // The room changes ground between themes, so the steel must be redefined.
    const claro = /\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(CSS);
    assert.ok(claro, 'no light-theme block found');
    for (const t of ['--tank-floor', '--tank-path', '--tank-steel-top', '--tank-steel-side']) {
      assert.ok(claro[1].includes(`${t}:`), `${t} is not re-grounded for the light theme`);
    }
  });

  test('a stage the log cannot name is distinct from an empty tank', () => {
    assert.equal(tokenEtapa('cri'), '--tank-s-cri');
    // movimientos_tanque has no `etapa` column, so most rows leave the stage
    // unset. Painting those tanks with the empty-steel colour would say the
    // tank is empty when it is full.
    assert.equal(tokenEtapa(null), TOKEN_ETAPA_ND);
    assert.equal(tokenEtapa('inventada'), TOKEN_ETAPA_ND);
    assert.notEqual(TOKEN_ETAPA_ND, TOKEN_VACIO);
    for (const e of ETAPAS) assert.ok(ETAPA_ETIQUETAS[e], `stage ${e} has no Spanish label`);
  });
});

describe('mt53 - the colour modes', () => {
  const tanque = { codigo: 'C5', capacidad_l: 18700, litros: 18100, etapa: 'cri' };
  const parte = { lot_code: '25MEKMP-3', litros: 12700 };

  test('each mode colours the band from a different fact', () => {
    assert.deepEqual(MODOS, ['variedad', 'etapa', 'ocupacion']);
    assert.equal(tokenBanda('variedad', tanque, parte), '--tank-v-me');
    assert.equal(tokenBanda('etapa', tanque, parte), '--tank-s-cri');
    assert.equal(tokenBanda('ocupacion', tanque, parte), '--tank-ocu-lleno');
    // An unknown mode is read as the default rather than losing the colour.
    assert.equal(tokenBanda('otra', tanque, parte), '--tank-v-me');
  });

  test('the fill-level buckets are >95%, 60-95% and under 60%', () => {
    const nivel = (l, cap) => nivelOcupacion(l, cap).clave;
    assert.equal(nivel(18100, 18700), 'lleno');     // 96.8%
    assert.equal(nivel(17765, 18700), 'medio');     // exactly 95%
    assert.equal(nivel(11220, 18700), 'medio');     // exactly 60%
    assert.equal(nivel(11219, 18700), 'bajo');
    assert.equal(nivel(0, 18700), 'bajo');
    // A capacity the catalog never recorded must not divide by zero.
    assert.equal(nivel(100, 0), 'bajo');
    assert.equal(nivel(100, null), 'bajo');
  });
});

describe('mt53 - a lote route is chains, never one invented line', () => {
  const paso = (origen, destino) => ({ origen, destino });

  test('a lote that only ever moved on is one chain', () => {
    const c = cadenasRecorrido([paso(null, 'D5'), paso('D5', 'D1'), paso('D1', 'E5')]);
    assert.equal(c.length, 1);
    assert.deepEqual(c[0].codigos, ['D5', 'D1', 'E5']);
    assert.equal(c[0].entrada, true);
    assert.equal(c[0].salida, false);
  });

  test('a split lote does not grow a journey it never made', () => {
    // 6 000 L into A1, then 2 000 to B1 and 2 000 to C1. Concatenating the
    // endpoints with adjacent de-duplication would draw A1 > B1 > A1 > C1 and
    // claim a transfer out of B1 that never happened.
    const c = cadenasRecorrido([paso(null, 'A1'), paso('A1', 'B1'), paso('A1', 'C1')]);
    assert.equal(c.length, 2);
    assert.deepEqual(c[0].codigos, ['A1', 'B1']);
    assert.equal(c[0].entrada, true);
    assert.deepEqual(c[1].codigos, ['A1', 'C1']);
    assert.equal(c[1].entrada, false);
    for (const cadena of c) {
      assert.ok(!cadena.codigos.includes('B1') || !cadena.codigos.includes('C1'),
        'B1 and C1 must never land in the same chain');
    }
  });

  test('bottling closes a chain and anything after it starts a new one', () => {
    const c = cadenasRecorrido([paso(null, 'A1'), paso('A1', null), paso(null, 'B1')]);
    assert.equal(c.length, 2);
    assert.deepEqual(c[0].codigos, ['A1']);
    assert.equal(c[0].salida, true);
    assert.deepEqual(c[1].codigos, ['B1']);
    assert.equal(c[1].entrada, true);
  });

  test('two receptions of the same lote are two chains', () => {
    const c = cadenasRecorrido([paso(null, 'A1'), paso(null, 'B1')]);
    assert.deepEqual(c.map((x) => x.codigos), [['A1'], ['B1']]);
    assert.deepEqual(c.map((x) => x.entrada), [true, true]);
  });

  test('no steps, or junk steps, give no chains', () => {
    assert.deepEqual(cadenasRecorrido([]), []);
    assert.deepEqual(cadenasRecorrido(null), []);
    assert.deepEqual(cadenasRecorrido(undefined), []);
  });
});

describe('mt53 - a movement date never shifts by a day', () => {
  test('fecha is read off the string, not through new Date()', () => {
    assert.equal(fechaCorta('2025-10-12'), '12 oct 25');
    assert.equal(fechaCorta('2026-01-05'), '5 ene 26');
    assert.equal(fechaCorta('2025-12-31'), '31 dic 25');
    // A timestamp column trimmed to its date part formats the same.
    assert.equal(fechaCorta('2025-10-12T00:00:00Z'), '12 oct 25');
    assert.equal(fechaCorta(''), '');
    assert.equal(fechaCorta(null), '');
    assert.equal(fechaCorta('2025-13-01'), '');
    assert.equal(fechaCorta('ayer'), '');
  });
});
