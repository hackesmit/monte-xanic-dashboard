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
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { seguimientoParser } from '../js/upload/seguimiento.js';

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
