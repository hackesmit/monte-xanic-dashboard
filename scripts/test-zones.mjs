// Runs the unit suite once per time zone (xd-6fc). The box and CI run at
// Etc/UTC, which is exactly the configuration that hid the xd-3pm seguimiento
// bug for a full review round: uploads are parsed client side, in the lab's
// browser in Baja California. Running America/Tijuana as a standard pass makes
// a zone-dependent parser bug fail here instead of in the winery.
//
// TZ is set in the child's environment before node starts, so nothing rests on
// Node honouring a mid-flight process.env.TZ change. Extra arguments are passed
// through as test files: `npm test -- tests/mt46-seguimiento-timezone.test.mjs`.
import { spawnSync } from 'node:child_process';

export const TEST_ZONES = ['Etc/UTC', 'America/Tijuana'];

const files = process.argv.slice(2);
const targets = files.length ? files : ['tests/*.test.mjs'];

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
