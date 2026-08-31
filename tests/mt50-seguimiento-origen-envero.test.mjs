// MT.50 — Seguimiento de Maduración: the 2026-08-31 workbook revision.
//
// That revision inserted two columns, "Origen" and "Fecha de envero", at
// positions 5 and 6, shifting Código, Cantidad proyectada, TONS, Análisis and
// the entire 133-column date run two to the right. The parser bound every
// column by fixed index, so the whole file was refused at the header assertion
// and all 1526 chemistry readings across 76 lots bounced.
//
// These cases pin the three things that fix has to get right:
//   1. columns are resolved BY HEADER NAME, so a future reshuffle cannot
//      silently mis-bind a column (a mis-bind is worse than a refusal: it
//      lands chemistry under the wrong metric or the wrong date);
//   2. Origen reaches wine_samples.appellation as a NORMALIZED ranch-first
//      name, never the raw workbook string;
//   3. Fecha de envero produces a NUMERIC days_post_crush, which is the sole
//      thing that puts a reading on the maturity timeline charts
//      (charts.groupScatterData drops any row whose daysPostCrush is not a
//      number), while a lot with no readable envero still ingests its
//      chemistry rather than being dropped.
//
// mt44 keeps exercising the PRE-Origen shape, so both layouts stay covered.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { seguimientoParser } from '../js/upload/seguimiento.js';
import { buildAoa } from './fixtures/make-seguimiento-fixture.mjs';
import { ALLOWED_TABLES } from '../api/upload.js';

function asFakeFile(buffer, name) {
  return {
    name,
    size: buffer.byteLength,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

// Build the new-shape workbook with the 07.07 header typo corrected, so these
// cases test the layout change rather than the (separately covered) recovery.
function newShapeFile(mutate) {
  const aoa = buildAoa({ withOrigen: true }).map(r => (r ? [...r] : r));
  const hdr = aoa[5];
  const typoIdx = hdr.findIndex(v => v instanceof Date);
  hdr[typoIdx] = '07.07';
  if (mutate) mutate(aoa, typoIdx);
  const ws = XLSX.utils.aoa_to_sheet(aoa, { UTC: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Uva');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Flujo Tons');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return asFakeFile(Buffer.from(buf), 'seguimiento Vendimia 2026.xlsx');
}

const parse = (mutate) => seguimientoParser.parse(newShapeFile(mutate));
const berryRows = r => r.targets.find(t => t.table === 'wine_samples').rows;
const lotRows   = r => r.targets.find(t => t.table === 'seguimiento_lotes').rows;
const lot       = (r, code) => lotRows(r).find(l => l.lot_code === code);

describe('MT.50 — the shifted (Origen + Fecha de envero) layout parses', () => {
  it('reads the revision without refusing it', async () => {
    const r = await parse();
    assert.equal(lotRows(r).length, 4);
    assert.equal(berryRows(r).length, 8);
    assert.deepEqual(r.rejected, []);
  });

  // The regression that started all this: the date run must be found AFTER
  // Análisis wherever that lands, not at a hard-coded column 9. If the date
  // columns were still read from 9, chemistry would be attributed to the wrong
  // dates (or to metadata columns) instead of failing loudly.
  it('anchors the date run after Análisis, not at a fixed index', async () => {
    const r = await parse();
    const dates = berryRows(r).map(b => b.sample_date).sort();
    assert.equal(dates[0], '2026-07-16');
    assert.equal(dates[dates.length - 1], '2026-07-25');
    for (const b of berryRows(r)) {
      assert.match(b.sample_date, /^2026-\d{2}-\d{2}$/);
    }
  });

  it('still reads a pre-Origen workbook unchanged', async () => {
    const aoa = buildAoa({ withOrigen: false }).map(r => (r ? [...r] : r));
    const hdr = aoa[5];
    hdr[hdr.findIndex(v => v instanceof Date)] = '07.07';
    const ws = XLSX.utils.aoa_to_sheet(aoa, { UTC: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Uva');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Flujo Tons');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const r = await seguimientoParser.parse(asFakeFile(Buffer.from(buf), 'seguimiento Vendimia 2026.xlsx'));

    assert.equal(lotRows(r).length, 4);
    assert.equal(berryRows(r).length, 8);
    // The optional columns are simply absent; nothing is invented for them.
    for (const l of lotRows(r)) {
      assert.equal(l.origen, null);
      assert.equal(l.fecha_envero, null);
    }
    for (const b of berryRows(r)) {
      assert.equal(b.appellation, null);
      assert.equal(b.crush_date, null);
      assert.equal(b.days_post_crush, null);
    }
  });
});

describe('MT.50 — a missing or ambiguous header refuses, never mis-binds', () => {
  it('refuses by name when a required header is missing', async () => {
    await assert.rejects(
      () => parse((aoa) => { aoa[5][10] = 'Analisiss'; }),   // Análisis misspelt
      /falta la columna "Análisis"/,
    );
  });

  // A duplicate is the dangerous case: first-wins would bind a column that may
  // not be the one carrying the data, and every reading in the file would be
  // mis-attributed with no error at all.
  it('refuses a duplicated header rather than picking one', async () => {
    await assert.rejects(
      () => parse((aoa) => { aoa[5][3] = 'Lote'; aoa[5][7] = 'Lote'; }),
      /El encabezado "Lote" aparece 2 veces/,
    );
  });

  // Header text in this workbook is not stable: the real revision ships
  // 'Origen ' and 'Fecha de envero ' with trailing spaces. Cosmetic edits must
  // not unbind a column and silently drop its data.
  it('matches headers despite case, accent and whitespace drift', async () => {
    const r = await parse((aoa) => {
      aoa[5][5]  = '  ORIGEN  ';
      aoa[5][6]  = 'fecha de ENVERO';
      aoa[5][10] = 'ANALISIS';
    });
    assert.equal(lot(r, '26AAAA1A-C').origen, 'Monte Xanic (VDG)');
    assert.equal(lot(r, '26AAAA1A-C').fecha_envero, '2026-06-17');
  });
});

describe('MT.50 — Origen lands as a normalized ranch, not raw workbook text', () => {
  it('normalizes every Origen onto wine_samples.appellation', async () => {
    const r = await parse();
    const byLot = Object.fromEntries(berryRows(r).map(b => [b.sample_id, b.appellation]));
    // The trailing space on this one used to make it miss appellationFixes.
    assert.equal(byLot['26AAAA1A-C'], 'Monte Xanic (VDG)');
    assert.equal(byLot['26AAAA1B'],   'Viña Alta (VON)');
    // R14 was absent from the map entirely before xd-49p.1.
    assert.equal(byLot['26BBBB2A'],   'Rancho 14 (VDG)');
    assert.equal(byLot['26CCCC3A'],   'Olé (VDG)');
  });

  it('never lets a raw workbook origin string reach the row', async () => {
    const r = await parse();
    for (const b of berryRows(r)) {
      assert.ok(!/^Valle de /.test(b.appellation ?? ''),
        `raw workbook origin leaked: ${JSON.stringify(b.appellation)}`);
      assert.equal(b.appellation, (b.appellation ?? '').trim());
    }
    assert.equal(lot(r, '26AAAA1A-C').origen, 'Monte Xanic (VDG)');
  });
});

describe('MT.50 — Fecha de envero puts readings on the maturity timeline', () => {
  // The whole point of the change. charts.groupScatterData rejects any row
  // whose daysPostCrush is not a number, so this assertion is what stands
  // between the 2026 vintage and an empty timeline chart.
  it('emits a NUMERIC days_post_crush for a lot with an envero', async () => {
    const r = await parse();
    const rows = berryRows(r).filter(b => b.sample_id === '26AAAA1A-C');
    assert.ok(rows.length >= 3);
    for (const b of rows) {
      assert.equal(b.crush_date, '2026-06-17');
      assert.equal(typeof b.days_post_crush, 'number',
        'a non-number here is silently dropped by every timeline chart');
      assert.ok(Number.isInteger(b.days_post_crush));
      assert.ok(b.days_post_crush > 0);
    }
    // 17 June -> 16 July is 29 days.
    assert.equal(rows.find(b => b.sample_date === '2026-07-16').days_post_crush, 29);
  });

  it('computes the day count independently of the host timezone', async () => {
    const saved = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Tijuana', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        const r = await parse();
        const b = berryRows(r).find(x => x.sample_id === '26AAAA1A-C' && x.sample_date === '2026-07-16');
        assert.equal(b.days_post_crush, 29, `days_post_crush drifted in ${tz}`);
      }
    } finally {
      if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
    }
  });
});

describe('MT.50 — an unreadable envero is refused, never guessed', () => {
  // The real file ships lot 26CALMX1E with the text '30/6/269', a fat-fingered
  // '30/6/26'. Reading it as 30 June 2026 would be a guess, and a wrong envero
  // shifts a whole lot's series onto days nobody recorded.
  it('drops the envero and names the lot in a warning', async () => {
    const r = await parse();
    const l = lot(r, '26CCCC3A');
    assert.equal(l.fecha_envero, null);
    assert.ok(r.warnings.some(w => w.includes('26CCCC3A') && w.includes('30/6/269')),
      `no warning named the lot: ${JSON.stringify(r.warnings)}`);
  });

  it('still ingests that lot\'s chemistry rather than dropping it', async () => {
    const r = await parse();
    const rows = berryRows(r).filter(b => b.sample_id === '26CCCC3A');
    assert.ok(rows.length > 0, 'the lot lost all of its readings');
    for (const b of rows) {
      assert.equal(b.crush_date, null);
      assert.equal(b.days_post_crush, null);
    }
    assert.equal(rows.find(b => b.sample_date === '2026-07-25').brix, 22.9);
    assert.deepEqual(r.rejected, []);
  });

  // A lot the winery has not received yet legitimately has no envero. That is
  // silent, not a warning, and must not cost the lot its chemistry.
  it('accepts a blank envero silently and keeps the chemistry', async () => {
    const r = await parse();
    const rows = berryRows(r).filter(b => b.sample_id === '26AAAA1B');
    assert.ok(rows.length > 0);
    assert.equal(lot(r, '26AAAA1B').fecha_envero, null);
    for (const b of rows) assert.equal(b.days_post_crush, null);
    assert.ok(!r.warnings.some(w => w.includes('26AAAA1B') && w.includes('envero')));
  });
});

// The parser producing a field is only half of "it has a home". api/upload.js
// and api/row.js both SILENTLY DELETE any column missing from the table's
// allowlist (upsertRows.js: `if (!columns.has(key)) delete row[key]`). A field
// absent there looks perfectly ingested in the browser and never reaches
// Postgres, which is the exact failure this epic exists to prevent — so pin the
// allowlist against what the parser actually emits.
describe('MT.50 — every emitted column survives the API write allowlist', () => {
  it('allows the columns the parser writes to each target', async () => {
    const r = await parse();
    for (const target of r.targets) {
      const allowed = ALLOWED_TABLES[target.table]?.columns;
      assert.ok(allowed, `no allowlist entry for ${target.table}`);
      for (const row of target.rows) {
        for (const key of Object.keys(row)) {
          assert.ok(allowed.has(key),
            `${target.table}.${key} is emitted by the parser but would be silently stripped by the API`);
        }
      }
    }
  });

  it('names the two new per-lot columns explicitly', () => {
    const cols = ALLOWED_TABLES.seguimiento_lotes.columns;
    assert.ok(cols.has('origen'));
    assert.ok(cols.has('fecha_envero'));
    const berry = ALLOWED_TABLES.wine_samples.columns;
    for (const k of ['appellation', 'crush_date', 'days_post_crush']) {
      assert.ok(berry.has(k), `wine_samples.${k} missing from the allowlist`);
    }
  });
});
