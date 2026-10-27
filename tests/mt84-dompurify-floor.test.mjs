// MT.84 — DOMPurify stays on a patched release (bead xd-af2)
//
// dompurify reaches the bundle only through jspdf (an optional dependency that
// jsPDF's html() path loads). dompurify <=3.4.16 carries a critical advisory:
// the IN_PLACE hook leaves event handlers armed on a detached subtree, an
// incomplete fix of GHSA-p98j-92pf-mc4p. 3.4.17 is the fixed release.
//
// jspdf asks for ^3.3.1, so the lockfile alone decides which copy ships. This
// pins that the locked copy is at or above the fix, so a lockfile regenerated
// from a stale cache or a hand merge cannot quietly bring the vulnerable one
// back.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LOCK = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const FIXED = [3, 4, 17];

function atLeast(version, floor) {
  const parts = version.split('-')[0].split('.').map(Number);
  for (let i = 0; i < floor.length; i++) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  // equal to the floor: a prerelease (3.4.17-rc.0) sorts below the release
  return !version.includes('-');
}

describe('MT.84 dompurify floor', () => {
  it('compares versions numerically', () => {
    assert.equal(atLeast('3.4.17', FIXED), true);
    assert.equal(atLeast('3.10.0', FIXED), true);
    assert.equal(atLeast('3.4.16', FIXED), false);
    assert.equal(atLeast('3.4.9', FIXED), false);
    assert.equal(atLeast('3.4.17-rc.0', FIXED), false);
    assert.equal(atLeast('3.4.18-rc.0', FIXED), true);
  });

  it('every locked dompurify is 3.4.17 or later', () => {
    const copies = Object.entries(LOCK.packages)
      .filter(([path]) => path === 'node_modules/dompurify' || path.endsWith('/node_modules/dompurify'));
    assert.ok(copies.length > 0, 'dompurify is no longer in the lockfile; drop this test with the dependency');
    for (const [path, entry] of copies) {
      assert.ok(atLeast(entry.version, FIXED), `${path} is ${entry.version}, below the fixed 3.4.17`);
    }
  });
});
