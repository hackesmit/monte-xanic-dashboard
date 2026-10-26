// MT.46 - the seguimiento date-header recovery must not depend on the machine's
// time zone.
//
// Why this file exists (xd-3pm, found by the xd-5n9 red team and the adversarial
// reviewer, independently): the upload is parsed CLIENT SIDE, in the lab's
// browser in Baja California, never on Vercel's UTC box. sheet_to_json without
// UTC:true runs utc_to_local on every date cell, so an Excel serial is anchored
// at LOCAL midnight. The 1900 offsets are not whole hundredths of a day
// (Tijuana LMT -7:48:04, Mexico City LMT -6:36:36), so recoverSerialDate's
// exactness gate refused every header and the winery's real workbook stayed
// refused, while the suite was green because the box runs TZ=Etc/UTC. A
// whole-hour zone is worse than a refusal: America/Chicago is exactly 25
// hundredths, so a DIFFERENT serial lands on the grid.
//
// Two of the four zones below are chosen to hurt: America/Tijuana is where the
// file is actually opened, America/Chicago is the whole-hour case that shifts a
// value onto the grid rather than off it.
//
// This runs the check twice on purpose. The in-process loop is what caught the
// bug; the child-process run sets TZ before node starts, so the guard does not
// rest on Node honouring a mid-flight process.env.TZ change.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { seguimientoParser } from '../js/upload/seguimiento.js';
import { buildAoa } from './fixtures/make-seguimiento-fixture.mjs';

const execFileP = promisify(execFile);
const ZONES = ['UTC', 'America/Tijuana', 'America/Mexico_City', 'America/Chicago'];
const FIXTURE = new URL('./fixtures/seguimiento_maduracion_sample.xlsx', import.meta.url);

function asFakeFile(buffer, name) {
  return {
    name,
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

async function committedFixture() {
  return asFakeFile(await readFile(FIXTURE), 'seguimiento_maduracion_sample.xlsx');
}

describe('MT.46 - serial recovery is time-zone independent', () => {
  for (const tz of ZONES) {
    it(`recovers column 18 as 07.07 with TZ=${tz} (in process)`, async () => {
      const prev = process.env.TZ;
      process.env.TZ = tz;
      try {
        const res = await seguimientoParser.parse(await committedFixture());
        const warn = res.warnings.find(w => /Columna 18/.test(w));
        assert.ok(warn, `TZ=${tz}: column 18 must recover; got ${JSON.stringify(res.warnings)}`);
        assert.match(warn, /Se interpretó como 07\.07/, `TZ=${tz}: must read the header as 07.07`);
        // The cell as Excel shows it (1900-01-07T01:40:48Z) is 07.01 in every
        // zone only when read through UTC getters; local getters say 06.01 west
        // of UTC. Cosmetic, but it is the text the lab compares to its sheet.
        assert.match(warn, /"07\.01"/, `TZ=${tz}: the shown value must be read in UTC`);
      } finally {
        if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
      }
    });
  }

  // The same assertion, but with TZ set before the process starts. If Node ever
  // stops honouring a mid-flight process.env.TZ change, the loop above would go
  // quiet and keep passing; this one cannot.
  for (const tz of ZONES) {
    it(`recovers column 18 as 07.07 with TZ=${tz} (fresh process)`, async () => {
      const script = `
        import { readFile } from 'node:fs/promises';
        import { seguimientoParser } from ${JSON.stringify(new URL('../js/upload/seguimiento.js', import.meta.url).href)};
        const buf = await readFile(${JSON.stringify(fileURLToPath(FIXTURE))});
        const file = { name: 'f.xlsx', async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); } };
        const res = await seguimientoParser.parse(file);
        const warn = (res.warnings || []).find(w => /Columna 18/.test(w)) || '';
        process.stdout.write(/Se interpretó como 07\\.07/.test(warn) ? 'RECOVERED' : 'NOT-RECOVERED: ' + warn);
      `;
      const { stdout } = await execFileP(
        process.execPath,
        ['--input-type=module', '--eval', script],
        { env: { ...process.env, TZ: tz }, cwd: fileURLToPath(new URL('..', import.meta.url)) },
      );
      assert.equal(stdout.trim(), 'RECOVERED', `TZ=${tz}: a fresh process must also recover column 18`);
    });
  }

  it('the whole daily run reads identically under every zone', async () => {
    // Column 18 is the recovered one, but a zone shift would move every date
    // cell, so compare the full parsed output across zones, not just the warning.
    const results = [];
    for (const tz of ZONES) {
      const prev = process.env.TZ;
      process.env.TZ = tz;
      try {
        const res = await seguimientoParser.parse(await committedFixture());
        results.push([tz, res.targets.map(t => ({ table: t.table, rows: t.rows }))]);
      } finally {
        if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
      }
    }
    const [, baseline] = results[0];
    for (const [tz, got] of results.slice(1)) {
      assert.deepEqual(got, baseline, `TZ=${tz} must parse to the same rows as TZ=${results[0][0]}`);
    }
  });
});

// ── xd-6fc: the GENUINE-date branch of parseDateHeader. Everything above
// re-parses the committed fixture, whose only Date header is the recovered
// 1900 serial, so routing the genuine-date fallback (a real 2026 date cell)
// through local getters passed this file and was caught only by an mt44 case
// run under TZ=America/Tijuana. Here a real date sits in its correct slot: read
// in UTC it keeps the daily run intact, read in local time west of UTC it is
// the day before and the parser refuses the file.

const GENUINE_LABEL = '20.07'; // a column the fixture holds measurements in

function genuineDateWorkbook() {
  const aoa = buildAoa().map(r => (r ? [...r] : r));
  const hdr = aoa[5];
  hdr[hdr.findIndex(v => v instanceof Date)] = '07.07';
  const idx = hdr.indexOf(GENUINE_LABEL);
  assert.ok(idx > 0, `fixture must contain a ${GENUINE_LABEL} column`);
  hdr[idx] = new Date(Date.UTC(2026, 6, 20));
  // UTC:true, as the fixture builder writes: the cell stores 20 Jul 2026.
  const ws = XLSX.utils.aoa_to_sheet(aoa, { UTC: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Uva');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

describe('MT.46 - a genuine date header reads the same in every zone (xd-6fc)', () => {
  const buf = genuineDateWorkbook();

  for (const tz of ZONES) {
    it(`a real 2026 date header parses as ${GENUINE_LABEL} with TZ=${tz} (in process)`, async () => {
      const prev = process.env.TZ;
      process.env.TZ = tz;
      try {
        const res = await seguimientoParser.parse(asFakeFile(buf, 'seguimiento_genuino.xlsx'));
        const rows = res.targets.find(t => t.table === 'wine_samples').rows;
        assert.ok(rows.some(r => r.sample_date === '2026-07-20'),
          `TZ=${tz}: the genuine date column must land on 2026-07-20`);
        assert.ok(!res.warnings.some(w => /Se interpretó/.test(w)),
          `TZ=${tz}: a genuine date is not a recovered serial`);
      } finally {
        if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
      }
    });
  }

  it('the genuine-date workbook parses to the same rows in a fresh process per zone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mt46-'));
    try {
      const path = join(dir, 'genuino.xlsx');
      await writeFile(path, buf);
      const script = `
        import { readFile } from 'node:fs/promises';
        import { seguimientoParser } from ${JSON.stringify(new URL('../js/upload/seguimiento.js', import.meta.url).href)};
        const buf = await readFile(${JSON.stringify(path)});
        const file = { name: 'f.xlsx', async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); } };
        try {
          const res = await seguimientoParser.parse(file);
          process.stdout.write(JSON.stringify(res.targets.map(t => t.rows)));
        } catch (e) {
          process.stdout.write('REFUSED: ' + e.message);
        }
      `;
      const outs = [];
      for (const tz of ZONES) {
        const { stdout } = await execFileP(
          process.execPath,
          ['--input-type=module', '--eval', script],
          { env: { ...process.env, TZ: tz }, cwd: fileURLToPath(new URL('..', import.meta.url)), maxBuffer: 64 * 1024 * 1024 },
        );
        assert.ok(!stdout.startsWith('REFUSED'), `TZ=${tz}: ${stdout.slice(0, 300)}`);
        assert.match(stdout, /"sample_date":"2026-07-20"/, `TZ=${tz}: the genuine date must land on 2026-07-20`);
        outs.push([tz, stdout]);
      }
      for (const [tz, out] of outs.slice(1)) {
        assert.equal(out, outs[0][1], `TZ=${tz} must parse to the same rows as TZ=${outs[0][0]}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── xd-6fc item 1: the suite itself runs under the winery's zone. Every check
// above is only as strong as the zones the suite is run in.
describe('MT.46 - npm test runs under America/Tijuana as well as UTC (xd-6fc)', () => {
  it('package.json routes npm test through the per-zone runner', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.match(pkg.scripts.test, /scripts\/test-zones\.mjs/);
  });

  it('the runner covers Etc/UTC and America/Tijuana', async () => {
    const src = await readFile(new URL('../scripts/test-zones.mjs', import.meta.url), 'utf8');
    const zones = src.match(/TEST_ZONES\s*=\s*\[([^\]]*)\]/);
    assert.ok(zones, 'TEST_ZONES must be declared as a literal list');
    assert.match(zones[1], /'Etc\/UTC'/);
    assert.match(zones[1], /'America\/Tijuana'/);
  });

  // CI runs Node 20, whose --test does not expand globs, and the runner spawns
  // node with no shell: a literal pattern there runs zero tests (xd-6fc r2).
  it('the runner hands node real test files, never a glob', async () => {
    const { testTargets } = await import('../scripts/test-zones.mjs');
    const targets = testTargets([]);
    const onDisk = (await readdir(new URL('../tests/', import.meta.url)))
      .filter((name) => name.endsWith('.test.mjs'));
    assert.ok(targets.length > 0);
    for (const t of targets) assert.doesNotMatch(t, /[*?[{]/, `glob reached node: ${t}`);
    assert.deepEqual(targets, onDisk.sort().map((name) => `tests/${name}`));
    assert.ok(targets.includes('tests/mt46-seguimiento-timezone.test.mjs'));
  });

  it('files named on the command line pass through unchanged', async () => {
    const { testTargets } = await import('../scripts/test-zones.mjs');
    assert.deepEqual(testTargets(['tests/mt46-seguimiento-timezone.test.mjs']),
      ['tests/mt46-seguimiento-timezone.test.mjs']);
  });
});
