// MT.60 - the WineXRay parser's dates must not depend on the machine's time
// zone (xd-a6i, xd-i40).
//
// SheetJS with cellDates built each date cell as a Date at LOCAL midnight and
// the parser read it back in UTC, so Madrid, Kolkata and Tokyo stored the day
// before, and Tijuana stored a timestamp after 16:00 as the day after. The
// suite could not see it because this box and CI run UTC. The manual upload
// parses in the lab's browser; the sync (api/winexray-sync.js) parses on
// Vercel; both go through this parser.
//
// Same shape as mt46: every case runs in a fresh process with TZ set before
// node starts, so the guard does not rest on Node honouring a mid-flight
// process.env.TZ change (mt13 covers the in-process switch). Both read
// branches are pinned: the CSV text the tool exports, and a binary workbook
// with a real date cell, which the parser also accepts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const ZONES = ['UTC', 'America/Tijuana', 'America/Chicago', 'Europe/Madrid', 'Asia/Kolkata', 'Asia/Tokyo'];
const PARSER = new URL('../js/upload/winexray.js', import.meta.url).href;
const FIXTURE = fileURLToPath(new URL('./fixtures/winexray_mixed.csv', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Prints one JSON line: the dated fields of every parsed row, for the
// committed fixture, an inline CSV with the shapes that used to move, and a
// workbook whose Sample Date is a real date cell (serial 46080, 2026-02-27).
const SCRIPT = `
  import { readFile } from 'node:fs/promises';
  import * as XLSX from 'xlsx';
  import { winexrayParser } from ${JSON.stringify(PARSER)};
  const asFile = (buf, name) => ({ name, size: buf.byteLength,
    async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); } });
  const dated = r => r.targets.flatMap(t => t.rows.map(x => [t.table, x.sample_id, x.sample_date, x.crush_date]));
  const fixture = await winexrayParser.parse(asFile(await readFile(${JSON.stringify(FIXTURE)}), 'f.csv'));
  const csv = [
    'Sample Id,Sample Type,Sample Date,CrushDate (yyyy-mm-dd),Vintage,Variety,Appellation',
    '25CSMX-100,Aging Wine,2/27/2026,2025-09-15,2025,Cabernet Sauvignon,Valle de Guadalupe',
    '25CSMX-101,Aging Wine,3/1/2026 20:30,9/15/2025,2025,Cabernet Sauvignon,Valle de Guadalupe',
    '25CSMX-102,Aging Wine,12/31/2025,2025-09-15,2025,Cabernet Sauvignon,Valle de Guadalupe',
  ].join('\\n');
  const inline = await winexrayParser.parse(asFile(Buffer.from(csv), 'i.csv'));
  const ws = XLSX.utils.aoa_to_sheet([
    ['Sample Id', 'Sample Type', 'Sample Date', 'Vintage', 'Variety', 'Appellation'],
    ['25CSMX-200', 'Aging Wine', 0, 2025, 'Cabernet Sauvignon', 'Valle de Guadalupe'],
  ]);
  ws.C2 = { t: 'n', v: 46080, z: 'm/d/yy' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');
  const book = await winexrayParser.parse(asFile(Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), 'b.csv'));
  process.stdout.write(JSON.stringify({ fixture: dated(fixture), inline: dated(inline), book: dated(book) }));
`;

async function runIn(tz) {
  const { stdout } = await execFileP(
    process.execPath,
    ['--input-type=module', '--eval', SCRIPT],
    { env: { ...process.env, TZ: tz }, cwd: ROOT },
  );
  return JSON.parse(stdout);
}

describe('MT.60 - WineXRay dates are time-zone independent (fresh process)', () => {
  const runs = new Map();
  for (const tz of ZONES) {
    it(`keeps every calendar day with TZ=${tz}`, async () => {
      const got = await runIn(tz);
      runs.set(tz, got);
      assert.deepEqual(got.inline, [
        ['wine_samples', '25CSMX-100', '2026-02-27', '2025-09-15'],
        ['wine_samples', '25CSMX-101', '2026-03-01', '2025-09-15'],
        ['wine_samples', '25CSMX-102', '2025-12-31', '2025-09-15'],
      ], `TZ=${tz}: inline CSV`);
      assert.deepEqual(got.book, [['wine_samples', '25CSMX-200', '2026-02-27', null]],
        `TZ=${tz}: a real date cell in a workbook`);
      assert.ok(got.fixture.length > 0, `TZ=${tz}: the fixture must parse rows`);
    });
  }

  it('the committed fixture parses to the same dates under every zone', () => {
    const baseline = runs.get('UTC');
    assert.ok(baseline, 'the UTC run must have completed');
    for (const tz of ZONES.slice(1)) {
      assert.deepEqual(runs.get(tz)?.fixture, baseline.fixture, `TZ=${tz} must match TZ=UTC`);
    }
  });
});
