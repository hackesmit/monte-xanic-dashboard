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
import { CONFIG } from '../js/config.js';

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
    // The optional columns are simply absent, and nothing is invented for them.
    // They are OMITTED rather than written as explicit nulls, so a re-upload of
    // an archived pre-Origen file cannot erase data a newer one wrote (see the
    // R1 'legacy upload cannot erase' cases below).
    for (const l of lotRows(r)) {
      assert.ok(!('origen' in l));
      assert.ok(!('fecha_envero' in l));
    }
    for (const b of berryRows(r)) {
      assert.ok(!('appellation' in b));
      assert.ok(!('crush_date' in b));
      assert.ok(!('days_post_crush' in b));
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

// ── Round 1 adversarial review (cross-vendor) findings ──────────────────────
// Four defects were raised against the header-name rewrite. Each is pinned
// here by the exact trigger the reviewer gave.

describe('MT.50 R1 — a renamed or unknown metadata column refuses', () => {
  // BLOCKER. Making the two new headers merely "optional" reopened the exact
  // hole this rewrite closed: rename 'Origen' to 'Origin' and the column
  // resolves to -1, the file is accepted, and every lot's origin is silently
  // dropped. Absent may only mean "the column is not there".
  it('refuses when Origen is renamed rather than dropping the column', async () => {
    await assert.rejects(
      () => parse((aoa) => { aoa[5][5] = 'Origin'; }),
      /columna 6 "Origin" contiene datos pero no corresponde a ninguna columna conocida/,
    );
  });

  it('refuses when Fecha de envero is renamed', async () => {
    await assert.rejects(
      () => parse((aoa) => { aoa[5][6] = 'Fecha envero'; }),
      /contiene datos pero no corresponde a ninguna columna conocida/,
    );
  });

  // The general case that started the bead: a brand-new column the winery
  // inserts must surface at once, not be ignored until someone notices months
  // of missing data.
  it('refuses an entirely new populated column', async () => {
    await assert.rejects(
      () => parse((aoa) => {
        aoa[5].splice(7, 0, 'Nueva Columna');
        for (let r = 8; r < aoa.length; r++) if (aoa[r]) aoa[r].splice(7, 0, 'algo');
      }),
      /no corresponde a ninguna columna conocida/,
    );
  });

  // A header that is missing with no data under it is genuinely absent, which
  // is what keeps the pre-Origen workbooks parsing.
  it('accepts a truly absent optional column', async () => {
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
  });
});

describe('MT.50 R1 — an uncatalogued origin is surfaced, not written silently', () => {
  // MAJOR. normalizeAppellation is deliberately non-validating, so a genuinely
  // new ranch passes through as raw workbook text and creates an uncatalogued
  // origin group. A new supplier is normal business and must not block the
  // harvest's chemistry, so the file is accepted — but never silently.
  it('warns naming the lot and the unrecognised origin', async () => {
    const r = await parse((aoa) => {
      for (let i = 8; i < 15; i++) aoa[i][5] = 'Valle de Guadalupe (Nuevo Rancho)';
    });
    assert.ok(
      r.warnings.some(w => w.includes('26AAAA1A-C') && w.includes('Nuevo Rancho') && w.includes('catálogo')),
      `no warning for the uncatalogued origin: ${JSON.stringify(r.warnings)}`,
    );
    assert.equal(lotRows(r).length, 4, 'the file must still ingest');
  });

  it('does not warn for an origin that is in the catalog', async () => {
    const r = await parse();
    assert.ok(!r.warnings.some(w => w.includes('catálogo')), JSON.stringify(r.warnings));
  });
});

describe('MT.50 R1 — a legacy upload cannot erase newer origin/envero data', () => {
  // MAJOR. These targets upsert on (sample_id, sample_date, sample_seq) and
  // (lot_code, vintage_year). Emitting the optional fields as explicit nulls
  // from a pre-Origen workbook would overwrite origin and timeline data written
  // by a newer file, so re-uploading an archived copy would silently undo the
  // current vintage. Absent column means "says nothing", not "says empty".
  it('omits the keys entirely when the workbook has no such column', async () => {
    const aoa = buildAoa({ withOrigen: false }).map(r => (r ? [...r] : r));
    const hdr = aoa[5];
    hdr[hdr.findIndex(v => v instanceof Date)] = '07.07';
    const ws = XLSX.utils.aoa_to_sheet(aoa, { UTC: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Uva');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Flujo Tons');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const r = await seguimientoParser.parse(asFakeFile(Buffer.from(buf), 'seguimiento Vendimia 2026.xlsx'));

    for (const b of berryRows(r)) {
      for (const k of ['appellation', 'crush_date', 'days_post_crush']) {
        assert.ok(!(k in b), `${k} present as an explicit null would erase newer data`);
      }
    }
    for (const l of lotRows(r)) {
      assert.ok(!('origen' in l));
      assert.ok(!('fecha_envero' in l));
    }
  });

  // Round 33: PostgREST rejects mixed-shape batches, so whatever the decision,
  // every row in one file must carry the identical key set.
  it('keeps one uniform key set across every row of a file', async () => {
    for (const withOrigen of [false, true]) {
      const aoa = buildAoa({ withOrigen }).map(r => (r ? [...r] : r));
      const hdr = aoa[5];
      hdr[hdr.findIndex(v => v instanceof Date)] = '07.07';
      const ws = XLSX.utils.aoa_to_sheet(aoa, { UTC: true });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Uva');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Flujo Tons');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const r = await seguimientoParser.parse(asFakeFile(Buffer.from(buf), 'seguimiento Vendimia 2026.xlsx'));
      for (const target of r.targets) {
        const shapes = new Set(target.rows.map(row => Object.keys(row).sort().join(',')));
        assert.equal(shapes.size, 1,
          `${target.table} has ${shapes.size} row shapes (withOrigen=${withOrigen}); PostgREST rejects mixed batches`);
      }
    }
  });

  // A blank envero in a workbook that DOES have the column is the winery
  // saying "no envero yet", which is a real statement and must be written.
  it('still writes an explicit null when the column exists but the cell is blank', async () => {
    const r = await parse();
    const rows = berryRows(r).filter(b => b.sample_id === '26AAAA1B');
    assert.ok(rows.length > 0);
    for (const b of rows) {
      assert.ok('crush_date' in b);
      assert.equal(b.crush_date, null);
    }
  });
});

describe('MT.50 R1 — per-lot metadata is read from any row of the block', () => {
  // MAJOR. Origen repeats on all seven rows in the real file but Fecha de
  // envero appears only on the first, and nothing guarantees which row the
  // winery uses next time. Reading only row 0 loses the value the moment it
  // moves — and for envero that silently drops the lot off the timeline.
  it('finds an envero written on a later metric row', async () => {
    const r = await parse((aoa) => {
      aoa[8][6] = null;                              // clear the TONS row
      aoa[9][6] = new Date(Date.UTC(2026, 5, 17));   // put it on the Brix row
    });
    const b = berryRows(r).find(x => x.sample_id === '26AAAA1A-C' && x.sample_date === '2026-07-16');
    assert.equal(b.crush_date, '2026-06-17');
    assert.equal(b.days_post_crush, 29);
  });

  it('finds an Origen written on only one row of the block', async () => {
    const r = await parse((aoa) => {
      for (let i = 8; i < 15; i++) aoa[i][5] = null;
      aoa[11][5] = 'Valle de Guadalupe (Siete Leguas)';
    });
    assert.equal(lot(r, '26AAAA1A-C').origen, 'Siete Leguas (VDG)');
  });

  // A lot cannot have two origins or two envero dates. Guessing which row wins
  // would mis-attribute the whole lot, so the file is refused.
  it('refuses two different Origen values inside one block', async () => {
    await assert.rejects(
      () => parse((aoa) => { aoa[11][5] = 'Valle de Ojos Negros (Kompali)'; }),
      /El lote "26AAAA1A-C" tiene valores distintos de "Origen"/,
    );
  });

  it('refuses two different envero dates inside one block', async () => {
    await assert.rejects(
      () => parse((aoa) => { aoa[11][6] = new Date(Date.UTC(2026, 6, 1)); }),
      /valores distintos de "Fecha de envero"/,
    );
  });
});

// ── Round 2 adversarial review (cross-vendor) findings ──────────────────────
import { readFileSync } from 'node:fs';

describe('MT.50 R2 — the R14 synonyms reach an already-migrated database', () => {
  // MAJOR. sql/migration_dim_catalogs.sql is generated from config.js, so
  // regenerating it picked up the two new R14 aliases — but that migration is
  // already recorded in applied_migrations on any existing installation and
  // will never run again. Editing an applied migration is not a delivery
  // mechanism, so the new migration has to carry the rows too, or the SQL
  // catalog silently stays behind the JS one.
  it('backfills both aliases from the new migration', () => {
    const sql = readFileSync(new URL('../sql/migration_seguimiento_origen_envero.sql', import.meta.url), 'utf8');
    assert.match(sql, /INSERT INTO public\.dim_rancho_sinonimo/);
    assert.match(sql, /'Valle de Guadalupe \(R14\)'/);
    assert.match(sql, /'Valle de Guadalupe \(Rancho 14\)'/);
    // Guarded, because a fresh install may run this before dim_catalogs exists.
    assert.match(sql, /to_regclass\('public\.dim_rancho_sinonimo'\)/);
    assert.match(sql, /ON CONFLICT \(sinonimo\) DO UPDATE/);
  });

  // Every appellationFixes entry resolving to a ranch must be reproducible in
  // SQL, which is the whole point of the dim_* catalogs.
  it('keeps the JS and SQL rancho synonym catalogs in agreement', () => {
    const sql = readFileSync(new URL('../sql/migration_dim_catalogs.sql', import.meta.url), 'utf8');
    for (const k of ['Valle de Guadalupe (R14)', 'Valle de Guadalupe (Rancho 14)']) {
      assert.equal(CONFIG.appellationFixes[k], 'Rancho 14 (VDG)');
      assert.ok(sql.includes(`('${k}', 'Rancho 14 (VDG)')`), `${k} missing from the generated catalog`);
    }
  });
});

describe('MT.50 R2 — prototype keys are not mistaken for catalog entries', () => {
  // MINOR. `'constructor' in CONFIG.originColors` is true via the prototype
  // chain, so an origin literally named "constructor" would skip the
  // uncatalogued-origin warning and land silently.
  it('warns for an origin named after an Object.prototype member', async () => {
    for (const name of ['constructor', 'toString']) {
      const r = await parse((aoa) => {
        for (let i = 8; i < 15; i++) aoa[i][5] = name;
      });
      assert.ok(
        r.warnings.some(w => w.includes('26AAAA1A-C') && w.includes('catálogo')),
        `no uncatalogued-origin warning for ${name}: ${JSON.stringify(r.warnings)}`,
      );
    }
  });
});

describe('MT.50 R2 — the unclaimed-column check uses resolved indices', () => {
  // MINOR. assertNoUnclaimedMetaData identified the repeated header row with a
  // hard-coded row[0], inside the very function whose purpose is to stop
  // hard-coded indices. With Variedad moved, a repeated header label would be
  // misread as lot data and refuse a valid file.
  it('accepts a valid file when Variedad is not the first column', async () => {
    const r = await parse((aoa) => {
      // Swap Variedad and Status in the header and in every data row.
      for (const row of aoa) {
        if (!row || row.length < 2) continue;
        [row[0], row[1]] = [row[1], row[0]];
      }
    });
    assert.equal(lotRows(r).length, 4);
    assert.equal(lot(r, '26AAAA1A-C').variety, 'Sauvignon Blanc');
    assert.equal(lot(r, '26AAAA1A-C').status, 'Recibido');
  });
});
