// MT.45 — a Seguimiento forecast (cantidad_proyectada) or running total
// (tons_seguimiento) must NEVER become a tonnage weight for the weighted means
// fixed under xd-eg4. Weights come ONLY from mediciones_tecnicas.tons_received
// (pre-recepción), tagged as _weight. The workbook's provisional tonnage is not
// the authoritative harvested figure and must not leak into the weighting path.
// (Reviewer-authored guard for xd-6r7, adapted for the wine_samples target.)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DataStore } from '../js/dataLoader.js';
import { weightedMean } from '../js/aggregations.js';
import { seguimientoParser } from '../js/upload/seguimiento.js';
import * as XLSX from 'xlsx';
import { buildAoa } from './fixtures/make-seguimiento-fixture.mjs';

const SEG_FIELDS = ['cantidad_proyectada', 'tons_seguimiento', 'tons_seguimiento_cached', 'tons_mismatch', 'seguimiento_lotes'];

describe('MT.45 — seguimiento tonnage can never act as a weight', () => {
  it('no consumer of _weight / weighted means references seguimiento tonnage fields', () => {
    for (const f of ['js/dataLoader.js', 'js/aggregations.js', 'js/kpis.js', 'js/maps.js', 'js/classification.js', 'js/charts.js']) {
      const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
      for (const k of SEG_FIELDS) assert.ok(!src.includes(k), `${f} must not reference ${k}`);
    }
  });

  it('_tagSampleWeights ignores seguimiento data: a lot with a forecast but no medicion gets _weight null', () => {
    const lot = '26AAAA1B';
    // Simulate what a future "seguimiento" load might put on the store, under
    // every plausible property name, and a berry row for that lot.
    DataStore.medicionesData = [];
    DataStore.wineRecepcion = [];
    DataStore.seguimientoLotes = [{ lotCode: lot, lot_code: lot, vintage: 2026, vintage_year: 2026, cantidad_proyectada: 12, tons_seguimiento: 7, tons: 12 }];
    DataStore.berryData = [{ lotCode: lot, vintage: 2026, brix: 20, cantidad_proyectada: 12, tons_seguimiento: 7 }];
    DataStore._tagSampleWeights();
    assert.equal(DataStore.berryData[0]._weight, null, 'forecast/seguimiento tonnage must not become _weight');
    // and weightedMean therefore falls back to weight=1, not 12 or 7
    const rows = [
      DataStore.berryData[0],
      { lotCode: 'OTHER', vintage: 2026, brix: 10, _weight: null },
    ];
    assert.equal(weightedMean(rows, 'brix'), 15, 'unweighted fallback (1:1), not forecast-weighted');
  });

  it('_tagSampleWeights uses ONLY mediciones.tons_received even when seguimiento says otherwise', () => {
    const lot = '26AAAA1B';
    DataStore.medicionesData = [{ lotCode: lot, vintage: 2026, tons: 3 }];
    DataStore.wineRecepcion = [];
    DataStore.berryData = [{ lotCode: lot, vintage: 2026, brix: 20, cantidad_proyectada: 12, tons_seguimiento: 7 }];
    DataStore._tagSampleWeights();
    assert.equal(DataStore.berryData[0]._weight, 3);
  });

  it('parser berry rows carry no tonnage or forecast key under any name', async () => {
    const aoa = buildAoa().map(r => (r ? [...r] : r));
    const hdr = aoa[5]; hdr[hdr.findIndex(v => v instanceof Date)] = '07.07';
    const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Uva');
    const b = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const res = await seguimientoParser.parse({ name: 'x.xlsx', size: b.byteLength, async arrayBuffer() { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
    // Chemistry now targets wine_samples (sample_type='Berries').
    const berry = res.targets.find(t => t.table === 'wine_samples').rows;
    assert.ok(berry.length > 0);
    for (const r of berry) for (const k of Object.keys(r)) assert.ok(!/ton|proyect|^_?weight$/i.test(k), `berry row key ${k} looks like tonnage`);
  });
});
