// Runs the unit suite once per time zone (xd-6fc). The box and CI run at
// Etc/UTC, which is exactly the configuration that hid the xd-3pm seguimiento
// bug for a full review round: uploads are parsed client side, in the lab's
// browser in Baja California. Running America/Tijuana as a standard pass makes
// a zone-dependent parser bug fail here instead of in the winery.
//
// TZ is set in the child's environment before node starts, so nothing rests on
// Node honouring a mid-flight process.env.TZ change. Extra arguments are passed
// through as test files: `npm test -- tests/mt46-seguimiento-timezone.test.mjs`.
//
// The default file list is expanded here, never handed to node as a glob: there
// is no shell in between, and CI's Node 20 `--test` does not expand globs (that
// arrived in Node 21), so a literal 'tests/*.test.mjs' ran zero tests there.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TEST_ZONES = ['Etc/UTC', 'America/Tijuana'];

const TESTS_DIR = fileURLToPath(new URL('../tests/', import.meta.url));

// The files node --test is given: the ones named on the command line, or else
// every tests/*.test.mjs, sorted as a shell glob would list them.
export function testTargets(args) {
  if (args.length) return args;
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => join('tests', name));
}

function main() {
  const targets = testTargets(process.argv.slice(2));
  const failed = [];
  for (const tz of TEST_ZONES) {
    console.log(`\n# TZ=${tz}`);
    const run = spawnSync(process.execPath, ['--test', ...targets], {
      stdio: 'inherit',
      env: { ...process.env, TZ: tz },
    });
    if (run.status !== 0) failed.push(tz);
  }

  if (failed.length) {
    console.error(`\n# unit suite failed under: ${failed.join(', ')}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
