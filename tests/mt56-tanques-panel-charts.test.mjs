// mt56 - the selected lote's analyses in the tank panel. Bead xd-qrn.7.
// Spec: state/specs/xd-tanques/SPEC.md.
//
// Only the PURE spec-building is tested here: given a lote's stage and its lab
// samples, which picture does the panel choose? The render path (Chart.js, DOM,
// the view router) is proved by the e2e harness and the H8 screenshot, not by a
// node test; this file imports nothing that touches the DOM or Supabase.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  especificacionPanel,
  serieFermentacion,
  analisisVinoJoven,
  ETAPAS_FERMENTACION,
} from '../js/tanques/panelCharts.js';

// A Must sample as DataStore.winePreferment carries it: a bodega lot code, a
// day and the fermentation chemistry. Only `brix` and `temp` are read here.
function must(o) {
  return { codigoBodega: '25CSKMP-4', fecha: '2025-10-30', sampleType: 'Must', brix: null, temp: null, ...o };
}
// A Young Wine sample as DataStore.wineRecepcion carries it.
function joven(o) {
  return { codigoBodega: '25CSKMP-4', fecha: '2025-11-20', sampleType: 'Young Wine', pH: null, at: null, av: null, brix: null, ...o };
}

// The real 25CSKMP-4 fermentation: Brix falls from 26 to near zero at D5.
const FERMENTACION = [
  must({ fecha: '2025-11-02', brix: 20.3 }),
  must({ fecha: '2025-10-30', brix: 26 }),
  must({ fecha: '2025-11-05', brix: 3.5 }),
  must({ fecha: '2025-10-31', brix: 25.4 }),
];

test('a lote still fermenting shows the Brix time series, sorted by day', () => {
  const spec = especificacionPanel({
    etapa: 'fa', muestrasMust: FERMENTACION, muestrasVinoJoven: [], lote: '25CSKMP-4',
  });
  assert.equal(spec.modo, 'fermentacion');
  assert.equal(spec.lote, '25CSKMP-4');
  assert.equal(spec.chartSpec.type, 'line');
  const azucar = spec.chartSpec.series.find((s) => /Az[úu]car/.test(s.label));
  assert.ok(azucar, 'a sugar series is present');
  // Chronological, not log order: 26 -> 25.4 -> 20.3 -> 3.5.
  assert.deepEqual(azucar.points.map((p) => p.y), [26, 25.4, 20.3, 3.5]);
  // Only the fermentation picture; no young-wine analyses yet.
  assert.equal(spec.analisis, undefined);
});

test('every fermentation stage maps to the time series', () => {
  for (const etapa of ETAPAS_FERMENTACION) {
    const spec = especificacionPanel({
      etapa, muestrasMust: FERMENTACION, muestrasVinoJoven: [], lote: '25CSKMP-4',
    });
    assert.equal(spec.modo, 'fermentacion', `stage ${etapa}`);
  }
});

test('serieFermentacion drops a day with no numeric reading and merges temp into its day', () => {
  const serie = serieFermentacion([
    must({ fecha: '2025-10-30', brix: 26, temp: 18 }),
    must({ fecha: '2025-10-31', brix: null, temp: null }),  // no reading -> dropped
    must({ fecha: '2025-11-01', brix: 24.5, temp: 24 }),
  ]);
  assert.deepEqual(serie.map((p) => p.fecha), ['2025-10-30', '2025-11-01']);
  assert.deepEqual(serie.map((p) => p.brix), [26, 24.5]);
  assert.deepEqual(serie.map((p) => p.temp), [18, 24]);
});

test('the temperature series appears only when a reading carries it', () => {
  const sinTemp = especificacionPanel({
    etapa: 'fa', muestrasMust: FERMENTACION, muestrasVinoJoven: [], lote: 'L',
  });
  assert.equal(sinTemp.chartSpec.series.length, 1, 'only Brix when no temp');

  const conTemp = especificacionPanel({
    etapa: 'fa', lote: 'L', muestrasVinoJoven: [],
    muestrasMust: [must({ fecha: '2025-10-30', brix: 26, temp: 20 })],
  });
  assert.equal(conTemp.chartSpec.series.length, 2, 'Brix and Temperatura');
  assert.ok(conTemp.chartSpec.series.some((s) => /Temperatura/.test(s.label)));
});

test('a finished lote shows the latest Young Wine analyses that are present', () => {
  const spec = especificacionPanel({
    etapa: 'cri', lote: '25CSKMP-4', muestrasMust: [],
    muestrasVinoJoven: [
      joven({ fecha: '2025-11-20', pH: 3.6, at: 5.9 }),
      joven({ fecha: '2026-01-05', pH: 3.72, at: 5.5, av: 0.42 }),  // latest
    ],
  });
  assert.equal(spec.modo, 'vino-joven');
  assert.equal(spec.analisis.fecha, '2026-01-05');
  const campos = spec.analisis.valores.map((v) => v.campo);
  assert.deepEqual(campos, ['pH', 'at', 'av']);  // SO2 absent -> omitted
  const av = spec.analisis.valores.find((v) => v.campo === 'av');
  assert.equal(av.valor, 0.42);
});

test('analisisVinoJoven skips samples with no analysis and keeps the latest that has one', () => {
  const a = analisisVinoJoven([
    joven({ fecha: '2026-02-03' }),                    // all null -> skipped
    joven({ fecha: '2025-12-01', pH: 3.65 }),          // has one
    joven({ fecha: '2026-01-05', pH: 3.70, at: 5.5 }), // latest with data
  ]);
  assert.equal(a.fecha, '2026-01-05');
  assert.deepEqual(a.valores.map((v) => v.campo), ['pH', 'at']);
});

test('past fermentation with no young-wine chemistry falls back to the fermentation curve', () => {
  // This is the real 25CSKMP-4 in H8: moved on past fermentation, but every
  // Young Wine row is blank, so the Brix curve is the only real, lote-tied
  // series worth drawing.
  const spec = especificacionPanel({
    etapa: 'cri', lote: '25CSKMP-4', muestrasMust: FERMENTACION,
    muestrasVinoJoven: [joven({ fecha: '2026-02-03' })],  // all null
  });
  assert.equal(spec.modo, 'fermentacion');
  assert.ok(spec.chartSpec.series[0].points.length > 0);
});

test('a lote with no samples at all is reported empty, never a thrown error', () => {
  assert.equal(especificacionPanel({ etapa: 'cri', lote: 'L', muestrasMust: [], muestrasVinoJoven: [] }).modo, 'vacio');
  // Undefined arrays must not throw.
  assert.equal(especificacionPanel({ etapa: null, lote: 'L' }).modo, 'vacio');
  assert.deepEqual(serieFermentacion(undefined), []);
  assert.equal(analisisVinoJoven(undefined), null);
});

test('a non-numeric reading is ignored, not coerced to zero', () => {
  const serie = serieFermentacion([
    must({ fecha: '2025-10-30', brix: 'n/d' }),
    must({ fecha: '2025-10-31', brix: '24.5' }),  // numeric string is read
  ]);
  assert.deepEqual(serie.map((p) => p.brix), [24.5]);
  assert.deepEqual(serie.map((p) => p.fecha), ['2025-10-31']);
});
