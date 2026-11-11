// MT.64 - Per-lot date at target Brix (xd-2ov.2): js/pronostico/brix.js, the
// api/pronostico.js core, the forecasts table migration and the view text.
// Synthetic series with a known answer; the real-season numbers come from
// scripts/pronostico-brix-backtest.mjs (docs/pronostico.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  diaDe, fechaDe, claveLote, seriesPorLote, ajusteLineal, pronosticar,
  diaObservado, backtestSerie, resumenPorSemana, bandaPara, semana,
  ritmoHistorico, pronosticosLotes, MIN_MUESTRAS, HORIZONTE_MAX, METODO, MAX_SIN_MUESTRA,
} from '../js/pronostico/brix.js';
import { BANDA_BRIX } from '../js/pronostico/brixBanda.js';
import { construir } from '../api/pronostico.js';
import { textoEstado, tablaHtml } from '../js/pronostico/view.js';
import { MIGRATIONS } from '../js/migrations-manifest.js';

const d0 = diaDe('2025-08-01');
// Brix = 18 + 0.25 * days from 2025-08-01, sampled every 5 days.
const recta = (n, paso = 5) => Array.from({ length: n }, (_, i) => ({ dia: d0 + i * paso, brix: 18 + 0.25 * i * paso }));

test('dates: ISO to day and back, invalid dates rejected', () => {
  assert.equal(fechaDe(diaDe('2025-09-14')), '2025-09-14');
  assert.ok(Number.isNaN(diaDe('2025-02-30')));
  assert.ok(Number.isNaN(diaDe('')));
  assert.ok(Number.isNaN(diaDe(null)));
});

test('lot key: vintage prefix and punctuation dropped, digits kept', () => {
  assert.equal(claveLote('25CSMX-5B'), 'CSMX5B');
  assert.equal(claveLote('26CSMX5B'), 'CSMX5B');
  assert.equal(claveLote('CSMX-5B'), 'CSMX5B');
  assert.equal(claveLote('MX-11A'), 'MX11A');
  assert.equal(claveLote('2501'), '2501');
});

test('series: per lot and vintage, same-day readings averaged, bad rows dropped', () => {
  const s = seriesPorLote([
    { sample_id: '25CSMX-5B', sample_date: '2025-08-02', vintage_year: 2025, brix: 20 },
    { sample_id: '25CSMX-5B', sample_date: '2025-08-02', vintage_year: 2025, brix: 21 },
    { sample_id: '25CSMX-5B', sample_date: '2025-08-01', vintage_year: '2025', brix: '19' },
    { sample_id: '25CSMX-5B', sample_date: '2025-08-03', vintage_year: 2025, brix: '' },
    { sample_id: '25CSMX-5B', sample_date: 'x', vintage_year: 2025, brix: 22 },
    { sample_id: '26CSMX-5B', sample_date: '2026-08-01', vintage_year: 2026, brix: 19 },
  ]);
  assert.equal(s.length, 2);
  const a = s.find(x => x.vendimia === 2025);
  assert.deepEqual(a.puntos.map(p => p.brix), [19, 20.5]);
});

test('line fit recovers a known slope', () => {
  const a = ajusteLineal(recta(5));
  assert.ok(Math.abs(a.b - 0.25) < 1e-9);
  assert.ok(a.varB < 1e-12);
  assert.equal(ajusteLineal([{ dia: 1, brix: 1 }, { dia: 1, brix: 2 }]), null);
});

test('never a forecast before 3 samples', () => {
  assert.equal(MIN_MUESTRAS, 3);
  assert.equal(pronosticar(recta(2), 24).estado, 'pocas-muestras');
  assert.equal(pronosticar([], 24).estado, 'pocas-muestras');
  assert.equal(pronosticar(recta(3), 24).estado, 'pronostico');
});

test('a straight series forecasts its exact crossing day', () => {
  // 18 + 0.25 t = 24 at t = 24 days; last sample at t = 10 (19 Bx... 20.5 Bx)
  const r = pronosticar(recta(3), 24);
  assert.equal(r.estado, 'pronostico');
  assert.ok(Math.abs(r.diaObjetivo - (d0 + 24)) < 1e-9);
  assert.ok(Math.abs(r.horizonte - 14) < 1e-9);
});

test('states: reached, no rise, beyond the horizon, no target', () => {
  assert.equal(pronosticar(recta(6), 24).estado, 'alcanzado'); // last = 24.25
  const plano = [0, 5, 10].map(i => ({ dia: d0 + i, brix: 21 }));
  assert.equal(pronosticar(plano, 24).estado, 'sin-tendencia');
  const bajando = [0, 5, 10].map(i => ({ dia: d0 + i, brix: 22 - i / 10 }));
  assert.equal(pronosticar(bajando, 24).estado, 'sin-tendencia');
  const lento = [0, 5, 10].map(i => ({ dia: d0 + i, brix: 18 + 0.05 * i }));
  const r = pronosticar(lento, 24);
  assert.equal(r.estado, 'fuera-de-rango');
  assert.ok(r.horizonte > HORIZONTE_MAX);
  assert.equal(pronosticar(recta(3), null).estado, 'sin-objetivo');
});

test('the forecast never lands before the newest sample', () => {
  // noisy series whose line sits above the last reading
  const p = [{ dia: d0, brix: 20 }, { dia: d0 + 5, brix: 23.5 }, { dia: d0 + 10, brix: 22 }];
  const r = pronosticar(p, 23);
  assert.equal(r.estado, 'pronostico');
  assert.ok(r.diaObjetivo >= d0 + 10);
});

test('observed crossing: interpolated, null when never bracketed or the gap is wide', () => {
  assert.ok(Math.abs(diaObservado(recta(8), 24) - (d0 + 24)) < 1e-9);
  assert.equal(diaObservado(recta(3), 24), null);
  assert.equal(diaObservado([{ dia: d0, brix: 25 }, { dia: d0 + 5, brix: 26 }], 24), null);
  assert.equal(diaObservado([{ dia: d0, brix: 20 }, { dia: d0 + 20, brix: 25 }], 24), null);
});

test('backtest truncates before the crossing only, and is exact on a straight line', () => {
  const f = backtestSerie(recta(8), 24, { metodo: 'temporada' });
  // samples at t = 0..35; crossing at t = 24: cutoffs at t = 10, 15, 20
  assert.deepEqual(f.map(x => x.n), [3, 4, 5]);
  assert.deepEqual(f.map(x => x.adelanto), [14, 9, 4]);
  for (const x of f) assert.ok(Math.abs(x.error) < 1e-9);
});

test('weekly summary and band lookup', () => {
  const filas = [
    { adelanto: 3, error: 2 }, { adelanto: 4, error: -4 }, { adelanto: 9, error: 10 },
    { adelanto: 40, error: null },
  ];
  const r = resumenPorSemana(filas);
  assert.deepEqual(r.map(x => x.semana), [0, 1]);
  assert.equal(r[0].n, 2);
  assert.equal(r[0].mae, 3);
  assert.equal(r[0].sesgo, -1);
  assert.equal(semana(6), 0); assert.equal(semana(7), 1); assert.equal(semana(99), 4);
  const tabla = { 0: { n: 12, p80: 5 }, 1: { n: 4, p80: 9 } };
  assert.equal(bandaPara(3, tabla), 5);
  assert.equal(bandaPara(8, tabla), null);   // too few cases
  assert.equal(bandaPara(15, tabla), null);  // no row
});

test('the shipped band is the measured one, for every week a date can show', () => {
  assert.equal(BANDA_BRIX.metodo, METODO);
  for (let w = 0; w <= semana(HORIZONTE_MAX - 1e-9); w++) {
    const b = BANDA_BRIX.banda[w];
    assert.ok(b && b.n >= 10 && b.p80 > 0, `semana ${w}`);
  }
});

test('pooled rate of past seasons', () => {
  const s = [{ puntos: recta(4) }, { puntos: recta(4).map(p => ({ ...p, brix: p.brix * 1 })) }, { puntos: recta(2) }];
  const r = ritmoHistorico(s);
  assert.equal(r.lotes, 2);
  assert.ok(Math.abs(r.ritmo - 0.25) < 1e-9);
  assert.equal(ritmoHistorico([]), null);
});

test('lots: harvested, too few samples, cutoff ignores later samples', () => {
  const series = [
    { lote: 'A', vendimia: 2025, codigo: '25A', puntos: recta(3) },
    { lote: 'B', vendimia: 2025, codigo: '25B', puntos: recta(2) },
    { lote: 'C', vendimia: 2025, codigo: '25C', puntos: recta(3) },
    { lote: 'D', vendimia: 2024, codigo: '24D', puntos: recta(3) },
  ];
  const banda = { 0: { n: 20, p80: 4 }, 1: { n: 20, p80: 6 }, 2: { n: 20, p80: 9 } };
  const { filas } = pronosticosLotes({
    series, objetivoDe: () => 24, vendimia: 2025, corteDia: d0 + 10, banda,
    recepciones: [{ lot_code: 'C', vintage_year: 2025, reception_date: '2025-08-05' },
      { lot_code: 'A', vintage_year: 2025, reception_date: '2025-09-30' }],
  });
  const by = Object.fromEntries(filas.map(f => [f.lote, f]));
  assert.equal(by.D, undefined);
  assert.equal(by.C.estado, 'cosechado');
  assert.equal(by.B.estado, 'pocas-muestras');
  assert.equal(by.A.estado, 'pronostico');
  assert.equal(by.A.fechaObjetivo, '2025-08-25');
  assert.equal(by.A.bandaDias, 9);       // horizon 14 d -> week 2
  // no sample in the last MAX_SIN_MUESTRA days: inactive, not a forecast
  const tarde = pronosticosLotes({ series, objetivoDe: () => 24, vendimia: 2025, corteDia: d0 + 10 + MAX_SIN_MUESTRA + 1, banda });
  assert.equal(tarde.filas.find(f => f.lote === 'A').estado, 'sin-muestra-reciente');
  assert.equal(pronosticosLotes({ series, objetivoDe: () => 24, vendimia: 2025, corteDia: d0 + 10 + MAX_SIN_MUESTRA, banda })
    .filas.find(f => f.lote === 'A').estado, 'pronostico');
  // cutoff before the third sample: no forecast
  const antes = pronosticosLotes({ series, objetivoDe: () => 24, vendimia: 2025, corteDia: d0 + 7, banda });
  assert.equal(antes.filas.find(f => f.lote === 'A').estado, 'pocas-muestras');
  // no measured band for the horizon: no date
  const sinBanda = pronosticosLotes({ series, objetivoDe: () => 24, vendimia: 2025, corteDia: d0 + 10, banda: {} });
  const a = sinBanda.filas.find(f => f.lote === 'A');
  assert.equal(a.estado, 'sin-banda');
  assert.equal(a.fechaObjetivo, null);
});

test('api core: catalog target, override, recorded rows', () => {
  const muestras = [0, 5, 10].map(i => ({ sample_id: '25CSMX-5B', sample_date: fechaDe(d0 + i),
    vintage_year: 2025, variety: 'Cabernet Sauvignon', appellation: 'Monte Xanic (VDG)', brix: 18 + 0.25 * i }));
  const r = construir({ muestras, recepciones: [], overrides: [], corte: '2025-08-11' });
  const f = r.filas[0];
  assert.equal(f.objetivo, (23.8 + 24.5) / 2);   // CS-SY-VDG ideal range midpoint
  assert.equal(r.registro.length, 1);
  const g = r.registro[0];
  assert.equal(g.tipo, 'brix_objetivo');
  assert.equal(g.lote, 'CSMX5B');
  assert.equal(g.fecha_corte, '2025-08-11');
  assert.equal(g.n_muestras, 3);
  assert.equal((g.fecha_pronostico === null), (g.banda_dias === null));
  const ov = construir({ muestras, recepciones: [], corte: '2025-08-11',
    overrides: [{ variety: 'Cabernet Sauvignon', valley: 'VDG', brix_target: 22 }] });
  assert.equal(ov.filas[0].objetivo, 22);
  // a stale lot is never recorded
  const viejo = construir({ muestras, recepciones: [], overrides: [], corte: '2025-09-30' });
  assert.equal(viejo.filas[0].estado, 'sin-muestra-reciente');
  assert.equal(viejo.registro.length, 0);
  // two samples: shown as missing samples, never recorded
  const pocas = construir({ muestras: muestras.slice(0, 2), recepciones: [], overrides: [], corte: '2025-08-11' });
  assert.equal(pocas.filas[0].estado, 'pocas-muestras');
  assert.equal(pocas.registro.length, 0);
});

test('view text: date with band only for a forecast, html escaped', () => {
  assert.equal(textoEstado({ estado: 'pronostico', fechaObjetivo: '2025-09-04', bandaDias: 9 }), '4 sep ± 9 d');
  assert.equal(textoEstado({ estado: 'pocas-muestras', n: 2 }), 'Faltan muestras (2 de 3)');
  const html = tablaHtml([{ estado: 'pronostico', lote: 'X', codigo: '<b>x</b>', variedad: 'Syrah', n: 3,
    brixUltimo: 21, fechaUltima: '2025-08-30', objetivo: 24, fechaObjetivo: '2025-09-04', bandaDias: 9 },
  { estado: 'cosechado', lote: 'Y', n: 5 }, { estado: 'sin-muestra-reciente', lote: 'Z', n: 5 }]);
  assert.ok(html.includes('1 lotes sin muestra en 14 días'));
  assert.ok(!html.includes('>Z<'));
  const pocas = tablaHtml([{ estado: 'pocas-muestras', lote: 'P', n: 2 }]);
  assert.ok(pocas.includes('1 lotes con menos de 3 muestras'));
  assert.ok(!pocas.includes('<table'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('1 lotes ya cosechados'));
  assert.ok(!html.includes('<b>x</b>'));
});

test('migration: forecasts table locked to the service key, registered', () => {
  const sql = readFileSync(new URL('../sql/migration_pronosticos.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.pronosticos/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.pronosticos FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON SEQUENCE public\.pronosticos_id_seq FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /UNIQUE \(tipo, lote, vendimia, fecha_corte, modelo, objetivo\)/);
  assert.doesNotMatch(sql, /CREATE POLICY/);
  assert.match(sql, /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_pronosticos'\)/);
  assert.ok(MIGRATIONS.includes('migration_pronosticos'));
});
