// MT.81 — sql/migration_mona_uso.sql against a real Postgres (bead xd-aiz).
// Skipped unless XD_TEST_PG is a psql conninfo for a THROWAWAY database that
// has the Supabase roles (anon, authenticated, service_role) and
// public.applied_migrations. Example:
//   docker run -d --name pg -e POSTGRES_PASSWORD=pw -p 127.0.0.1:55432:5432 postgres:17-alpine
//   XD_TEST_PG='postgresql://postgres:pw@127.0.0.1:55432/postgres' node --test tests/mt81-mona-uso-pg.test.mjs
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const PG = process.env.XD_TEST_PG;
const MIGRATION = fileURLToPath(new URL('../sql/migration_mona_uso.sql', import.meta.url));
const psql = (sql) => execFileSync('psql', [PG, '-qtAX', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const psqlAsync = promisify(execFile);

describe('MT.81 — mona_uso shared counter', { skip: !PG && 'XD_TEST_PG not set' }, () => {
  before(() => {
    execFileSync('psql', [PG, '-qX', '-v', 'ON_ERROR_STOP=1', '-f', MIGRATION]);
    psql("delete from public.mona_uso where username like 'mt81-%'");
  });

  it('admits exactly the cap under 40 concurrent reservations', async () => {
    const one = () => psqlAsync('psql', [PG, '-qtAX', '-c',
      "set role service_role; select mona_uso_reservar('mt81-a', 25, 1000000)->>'permitido'"]);
    const out = await Promise.all(Array.from({ length: 40 }, one));
    const yes = out.filter(o => o.stdout.trim() === 'true').length;
    assert.equal(yes, 25);
    assert.equal(psql("select peticiones from public.mona_uso where username = 'mt81-a'"), '25');
  });

  it('refuses once the tokens spent reach the cap; negative charges are ignored', () => {
    const r1 = JSON.parse(psql("set role service_role; select mona_uso_reservar('mt81-b', 100, 5000)"));
    assert.equal(r1.permitido, true);
    psql(`set role service_role; select mona_uso_sumar_tokens('mt81-b', '${r1.dia}', -10)`);
    psql(`set role service_role; select mona_uso_sumar_tokens('mt81-b', '${r1.dia}', 5000)`);
    const r2 = JSON.parse(psql("set role service_role; select mona_uso_reservar('mt81-b', 100, 5000)"));
    assert.equal(r2.permitido, false);
    assert.equal(r2.tokens, 5000);
    assert.equal(r2.peticiones, 1);
  });

  it('anon and authenticated cannot call either function', () => {
    for (const role of ['anon', 'authenticated']) {
      assert.throws(() => psql(`set role ${role}; select mona_uso_reservar('mt81-c', 1, 1)`), /permission denied/);
      assert.throws(() => psql(`set role ${role}; select mona_uso_sumar_tokens('mt81-c', current_date, 1)`), /permission denied/);
    }
  });
});
