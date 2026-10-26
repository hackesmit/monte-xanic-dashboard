// MT.73 — a failed stale sweep does not disable the persistent login limit
// (bead xd-tqx, round 2).
//
// login_rate_limit_hit increments the IP's row and then sweeps stale rows. In
// migration_login_rate_limit_atomic both ran in one block, so an error in the
// sweep (for example DELETE revoked from service_role) rolled back the
// increment as well; the client then fell back to its per-instance in-memory
// map. migration_login_rate_limit_sweep_isolated puts the sweep in its own
// BEGIN ... EXCEPTION block.
//
// The static part always runs. The Postgres part needs XD_TEST_PG, a libpq
// conninfo string, and psql on PATH. Everything happens in ONE transaction that
// ends in ROLLBACK: it loads the function from the repo file, revokes DELETE on
// rate_limits from service_role and calls the function 11 times as
// service_role. It is safe against production, and it creates the roles and
// the table when a scratch database lacks them.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (name) => fs.readFileSync(new URL(`../sql/${name}.sql`, import.meta.url), 'utf8');
const ATOMIC = read('migration_login_rate_limit_atomic');
const ISOLATED = read('migration_login_rate_limit_sweep_isolated');
const manifest = fs.readFileSync(new URL('../js/migrations-manifest.js', import.meta.url), 'utf8');

// The CREATE FUNCTION statement of a migration file, without its BEGIN/COMMIT
// or its applied_migrations row, so the test can load it into its own
// transaction.
function functionDdl(sql) {
  const m = sql.match(/CREATE OR REPLACE FUNCTION public\.login_rate_limit_hit\([\s\S]*?\n\$\$;\n/);
  assert.ok(m, 'migration has a complete CREATE FUNCTION ... $$; statement');
  return m[0];
}

const SWEEP = `    DELETE FROM public.rate_limits
     WHERE ip IN (SELECT s.ip FROM public.rate_limits s
                   WHERE s.window_start < v_cutoff AND s.ip <> p_ip
                   FOR UPDATE SKIP LOCKED);`;

describe('MT.73 — the sweep is isolated from the increment (migration text)', () => {
  it('the sweep sits in its own BEGIN ... EXCEPTION block after the upsert', () => {
    const fn = functionDdl(ISOLATED);
    const upsert = fn.indexOf('RETURNING r.attempts INTO v_attempts;');
    const block = fn.indexOf(`  BEGIN\n${SWEEP}\n  EXCEPTION WHEN OTHERS THEN\n`);
    assert.ok(upsert > 0, 'upsert present');
    assert.ok(block > upsert, 'sweep is wrapped in its own exception block, after the upsert');
  });

  it('apart from that block, the function is byte for byte the atomic one', () => {
    const isolated = functionDdl(ISOLATED);
    const atomic = functionDdl(ATOMIC);
    const start = isolated.indexOf('  -- Housekeeping only');
    const end = isolated.indexOf('  END;\n', start) + '  END;\n'.length;
    assert.ok(start > 0 && end > start, 'housekeeping block found');
    const unwrapped = isolated.slice(0, start)
      + SWEEP.split('\n').map(l => l.slice(2)).join('\n') + '\n'
      + isolated.slice(end);
    assert.equal(unwrapped, atomic);
  });

  it('keeps the grants and records itself in applied_migrations and the manifest', () => {
    assert.match(ISOLATED, /REVOKE EXECUTE ON FUNCTION public\.login_rate_limit_hit\(TEXT, INTEGER, INTEGER\) FROM PUBLIC, anon, authenticated;/);
    assert.match(ISOLATED, /GRANT\s+EXECUTE ON FUNCTION public\.login_rate_limit_hit\(TEXT, INTEGER, INTEGER\) TO service_role;/);
    assert.match(ISOLATED, /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_login_rate_limit_sweep_isolated'\)\s+ON CONFLICT \(name\) DO NOTHING;/);
    assert.match(manifest, /'migration_login_rate_limit_atomic',\n\s+'migration_login_rate_limit_sweep_isolated',/);
  });
});

const PG = process.env.XD_TEST_PG;
const IP = 'mt73-198.51.100.73';
const STALE = 'mt73-stale-198.51.100.74';

// One transaction, always rolled back. Prints one line per call: t or f.
function script(fnDdl, { revokeDelete }) {
  const calls = Array.from({ length: 11 }, () =>
    `SELECT public.login_rate_limit_hit('${IP}', 900, 10);`).join('\n');
  return `
\\set ON_ERROR_STOP 1
SET client_min_messages = error;
BEGIN;
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$;
CREATE TABLE IF NOT EXISTS public.rate_limits (
  ip TEXT PRIMARY KEY,
  attempts INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limits TO service_role;
${fnDdl}
GRANT EXECUTE ON FUNCTION public.login_rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;
DELETE FROM public.rate_limits WHERE ip IN ('${IP}', '${STALE}');
INSERT INTO public.rate_limits (ip, attempts, window_start) VALUES ('${STALE}', 3, now() - interval '1 hour');
${revokeDelete ? 'REVOKE DELETE ON public.rate_limits FROM service_role;' : ''}
SET LOCAL ROLE service_role;
${calls}
RESET ROLE;
SELECT 'stale_left=' || count(*) FROM public.rate_limits WHERE ip = '${STALE}';
SELECT 'attempts=' || attempts FROM public.rate_limits WHERE ip = '${IP}';
ROLLBACK;
`;
}

function runPsql(sql) {
  return execFileSync('psql', [PG, '-X', '-q', '-A', '-t'], {
    input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }).trim().split('\n');
}

describe('MT.73 — real Postgres: attempt 11 is refused even when the sweep fails', { skip: PG ? false : 'XD_TEST_PG not set' }, () => {
  it('DELETE revoked: 10 allowed, the 11th refused, the count persists', () => {
    const out = runPsql(script(functionDdl(ISOLATED), { revokeDelete: true }));
    assert.deepEqual(out.slice(0, 11), [...Array(10).fill('t'), 'f']);
    assert.equal(out[11], 'stale_left=1', 'the failed sweep left the stale row');
    assert.equal(out[12], 'attempts=11', 'the increment survived the failed sweep');
  });

  it('DELETE granted: same verdicts, and the sweep removes the stale row', () => {
    const out = runPsql(script(functionDdl(ISOLATED), { revokeDelete: false }));
    assert.deepEqual(out.slice(0, 11), [...Array(10).fill('t'), 'f']);
    assert.equal(out[11], 'stale_left=0');
    assert.equal(out[12], 'attempts=11');
  });

  it('control: the round-1 function raises on the first call when DELETE is revoked', () => {
    assert.throws(() => runPsql(script(functionDdl(ATOMIC), { revokeDelete: true })),
      (err) => /permission denied for table rate_limits/.test(String(err.stderr)));
  });
});
