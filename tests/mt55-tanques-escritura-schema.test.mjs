// MT.55 - Serialized, idempotent tank writes (sql/migration_tanques_escritura.sql).
//
// The decision on bead xd-qrn.8: /api/tanques reads a version counter before
// the log, validates, and writes through public.tanques_escribir, which locks
// the version row and refuses with `conflicto` if the log moved. client_id
// makes a retried crear return the row already written. These tests guard the
// SQL text the endpoint depends on; the behaviour itself was rehearsed on a
// throwaway Postgres (see the bead).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIGRATIONS } from '../js/migrations-manifest.js';

const SQL = readFileSync(new URL('../sql/migration_tanques_escritura.sql', import.meta.url), 'utf8');
const BASE = readFileSync(new URL('../sql/migration_tanques.sql', import.meta.url), 'utf8');

/** The body of `CREATE OR REPLACE FUNCTION public.<name>(` up to its closing `$$;`. */
function funcion(sql, name) {
  const m = sql.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\(([\\s\\S]*?)\\nAS \\$\\$\\n([\\s\\S]*?)\\n\\$\\$;`));
  assert.ok(m, `function ${name} not found`);
  return { cabecera: m[1], cuerpo: m[2] };
}

describe('MT.55 - tanques_version', () => {
  it('is a single-row table, seeded once', () => {
    assert.match(SQL, /CREATE TABLE IF NOT EXISTS public\.tanques_version \(/);
    assert.match(SQL, /id INT\s+PRIMARY KEY DEFAULT 1/);
    assert.match(SQL, /v\s+BIGINT NOT NULL DEFAULT 0/);
    assert.match(SQL, /CONSTRAINT tanques_version_una_fila_chk CHECK \(id = 1\)/);
    assert.match(SQL, /INSERT INTO public\.tanques_version \(id, v\) VALUES \(1, 0\)\n\s+ON CONFLICT \(id\) DO NOTHING;/);
  });

  it('is bumped by every insert and update on the movement log', () => {
    assert.match(SQL, /AFTER INSERT OR UPDATE ON public\.movimientos_tanque\n\s+FOR EACH ROW EXECUTE FUNCTION public\.tanques_version_incrementar\(\)/);
    const { cuerpo } = funcion(SQL, 'tanques_version_incrementar');
    // an upsert, so a deleted row cannot freeze the counter silently
    assert.match(cuerpo, /ON CONFLICT \(id\) DO UPDATE SET v = tv\.v \+ 1/);
  });

  it('is server-only: RLS on, no policy, anon and authenticated revoked', () => {
    assert.match(SQL, /ALTER TABLE public\.tanques_version ENABLE ROW LEVEL SECURITY/);
    assert.match(SQL, /REVOKE ALL ON public\.tanques_version FROM anon, authenticated/);
    assert.equal(SQL.match(/CREATE POLICY/g), null);
  });
});

describe('MT.55 - client_id', () => {
  it('is a UUID column with a UNIQUE constraint', () => {
    assert.match(SQL, /ALTER TABLE public\.movimientos_tanque ADD COLUMN IF NOT EXISTS client_id UUID;/);
    assert.match(SQL, /ADD\s+CONSTRAINT movimientos_tanque_client_id_key UNIQUE \(client_id\)/);
  });

  it('is frozen by the append-only trigger along with every other column but anulado', () => {
    // Structural, like MT.50: every column of the original CREATE TABLE, plus
    // client_id, on both sides of the IS DISTINCT FROM, and anulado on neither.
    const create = BASE.match(/CREATE TABLE IF NOT EXISTS public\.movimientos_tanque \(\n([\s\S]*?)\n\);/);
    assert.ok(create);
    const columnas = create[1].split('\n')
      .map((l) => l.match(/^ {2}(\w+)\s{2,}/)?.[1]).filter(Boolean)
      .concat('client_id');
    const { cuerpo } = funcion(SQL, 'movimientos_tanque_append_only');
    const comparacion = cuerpo.match(/(\(NEW\.id,[\s\S]*?)\n  THEN/);
    assert.ok(comparacion);
    for (const col of columnas) {
      if (col === 'anulado') {
        assert.ok(!comparacion[1].includes('NEW.anulado'));
        continue;
      }
      assert.ok(comparacion[1].includes(`NEW.${col}`), `trigger does not compare NEW.${col}`);
      assert.ok(comparacion[1].includes(`OLD.${col}`), `trigger does not compare OLD.${col}`);
    }
  });

  it('keeps every other behaviour of the append-only function', () => {
    const viejo = funcion(BASE, 'movimientos_tanque_append_only').cuerpo;
    const nuevo = funcion(SQL, 'movimientos_tanque_append_only').cuerpo;
    const sinClave = nuevo.replace(/, NEW\.client_id\)/, ')').replace(/, OLD\.client_id\)/, ')');
    assert.equal(sinClave, viejo, 'the only change is client_id in the frozen columns');
  });
});

describe('MT.55 - tanques_escribir', () => {
  const { cabecera, cuerpo } = funcion(SQL, 'tanques_escribir');

  it('has the signature the endpoint calls', () => {
    assert.match(cabecera, /p_version BIGINT,\n\s+p_accion\s+TEXT,\n\s+p_fila\s+JSONB\s+DEFAULT NULL,\n\s+p_id\s+BIGINT DEFAULT NULL/);
    assert.match(cabecera, /RETURNS JSONB/);
  });

  it('runs as the caller with a pinned search_path', () => {
    assert.match(cabecera, /SECURITY INVOKER/);
    assert.ok(!/SECURITY DEFINER/.test(cabecera));
    assert.match(cabecera, /SET search_path = public/);
  });

  it('locks the version row and refuses a stale version with conflicto', () => {
    assert.match(cuerpo, /FROM public\.tanques_version tv WHERE tv\.id = 1 FOR UPDATE/);
    const conflictos = cuerpo.match(/IF p_version IS DISTINCT FROM v_actual THEN\n\s+RETURN jsonb_build_object\('resultado', 'conflicto', 'version', v_actual\);/g);
    assert.equal(conflictos && conflictos.length, 2, 'both crear and anular check the version');
    // the lock is taken before anything is read or written
    assert.ok(cuerpo.indexOf('FOR UPDATE') < cuerpo.indexOf('INSERT INTO'));
  });

  it('inserts only the whitelisted columns from p_fila', () => {
    const insert = cuerpo.match(/INSERT INTO public\.movimientos_tanque\n\s+\(([^)]*)\)/);
    assert.ok(insert);
    const cols = insert[1].split(',').map((c) => c.trim());
    assert.deepEqual(cols, ['fecha', 'tipo', 'origen', 'destino', 'lot_code', 'vintage_year',
      'volumen_l', 'merma_l', 'nota', 'fuente', 'creado_por', 'client_id']);
    for (const prohibida of ['id', 'anulado', 'created_at']) {
      assert.ok(!new RegExp(`p_fila ->> '${prohibida}'`).test(cuerpo), `${prohibida} must never come from p_fila`);
    }
  });

  it('answers every documented outcome', () => {
    for (const r of ['conflicto', 'creado', 'duplicado', 'anulado', 'ya_anulado', 'no_existe']) {
      assert.match(cuerpo, new RegExp(`'resultado', '${r}'`), r);
    }
    assert.match(cuerpo, /ON CONFLICT \(client_id\) DO NOTHING/);
    assert.match(cuerpo, /UPDATE public\.movimientos_tanque SET anulado = true WHERE id = p_id/);
  });

  it('can be executed by service_role only', () => {
    assert.match(SQL, /REVOKE EXECUTE ON FUNCTION public\.tanques_escribir\(BIGINT, TEXT, JSONB, BIGINT\) FROM PUBLIC, anon, authenticated;/);
    assert.match(SQL, /GRANT\s+EXECUTE ON FUNCTION public\.tanques_escribir\(BIGINT, TEXT, JSONB, BIGINT\) TO service_role;/);
  });
});

describe('MT.55 - idempotency and registration', () => {
  it('runs as a single transaction', () => {
    assert.match(SQL, /^BEGIN;$/m);
    assert.match(SQL, /^COMMIT;$/m);
  });

  it('is re-runnable', () => {
    assert.deepEqual(SQL.match(/^CREATE TABLE(?! IF NOT EXISTS)/gm) ?? [], []);
    assert.deepEqual(SQL.match(/^CREATE FUNCTION/gm) ?? [], [], 'functions are CREATE OR REPLACE');
    assert.match(SQL, /DROP TRIGGER IF EXISTS movimientos_tanque_version/);
    assert.match(SQL, /DROP CONSTRAINT IF EXISTS movimientos_tanque_client_id_key/);
    assert.match(SQL, /DROP CONSTRAINT IF EXISTS tanques_version_una_fila_chk/);
    const inserts = SQL.match(/^INSERT INTO public\.\w+/gm) || [];
    const conflicts = SQL.match(/^\s+ON CONFLICT \(\w+\) DO NOTHING;/gm) || [];
    assert.equal(inserts.length, 2);
    assert.equal(conflicts.length, inserts.length);
  });

  it('registers itself in applied_migrations and in the manifest, after migration_tanques', () => {
    assert.match(SQL,
      /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_tanques_escritura'\)/);
    const i = MIGRATIONS.indexOf('migration_tanques_escritura');
    assert.ok(i > MIGRATIONS.indexOf('migration_tanques') && MIGRATIONS.indexOf('migration_tanques') >= 0);
  });
});

describe('MT.55 - catalog edits move the same version (round 3)', () => {
  // The endpoint validates a movement against the capacity and the synonyms it
  // read. Editing either between that read and tanques_escribir must turn the
  // write into a conflicto, so both catalog tables bump tanques_version too,
  // through the same upsert (and so the same row lock) as the movement log.
  for (const [tabla, trigger] of [
    ['dim_tanque', 'dim_tanque_version'],
    ['dim_tanque_sinonimo', 'dim_tanque_sinonimo_version'],
  ]) {
    it(`${tabla} bumps the version on insert, update, delete and truncate`, () => {
      assert.match(SQL, new RegExp(`DROP TRIGGER IF EXISTS ${trigger} ON public\\.${tabla};\\n`
        + `CREATE TRIGGER ${trigger}\\n`
        + `\\s+AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON public\\.${tabla}\\n`
        + `\\s+FOR EACH STATEMENT EXECUTE FUNCTION public\\.tanques_version_incrementar\\(\\);`));
    });
  }
});

describe('MT.55 - a client_id reused with other data (round 3)', () => {
  const { cabecera, cuerpo } = funcion(SQL, 'tanques_misma_intencion');
  const escribir = funcion(SQL, 'tanques_escribir').cuerpo;

  it('compares every whitelisted column plus creado_por, with the table types', () => {
    for (const col of ['fecha', 'tipo', 'origen', 'destino', 'lot_code', 'vintage_year',
      'volumen_l', 'merma_l', 'nota', 'fuente', 'creado_por']) {
      assert.ok(cuerpo.includes(`p_guardada.${col}`), `stored ${col} not compared`);
      assert.ok(cuerpo.includes(`p_fila ->> '${col}'`), `requested ${col} not compared`);
    }
    assert.match(cuerpo, /\(p_fila ->> 'fecha'\)::date/);
    assert.match(cuerpo, /\(p_fila ->> 'vintage_year'\)::int/);
    assert.match(cuerpo, /\(p_fila ->> 'volumen_l'\)::numeric/);
    assert.match(cuerpo, /COALESCE\(\(p_fila ->> 'merma_l'\)::numeric, 0\)/);
    assert.match(cuerpo, /IS NOT DISTINCT FROM/);
    assert.match(cabecera, /SECURITY INVOKER/);
  });

  it('answers client_id_distinto instead of duplicado when the data differ', () => {
    const dup = escribir.match(/'resultado', 'duplicado'/g) || [];
    const distinto = escribir.match(/'resultado', 'client_id_distinto'/g) || [];
    const juicios = escribir.match(/IF public\.tanques_misma_intencion\(v_fila, p_fila\) THEN/g) || [];
    assert.equal(dup.length, 2);
    assert.equal(distinto.length, 2, 'both duplicate paths can refuse');
    assert.equal(juicios.length, 2, 'both duplicate paths compare first');
  });

  it('can be executed by service_role only', () => {
    assert.match(SQL, /REVOKE EXECUTE ON FUNCTION public\.tanques_misma_intencion\(public\.movimientos_tanque, JSONB\) FROM PUBLIC, anon, authenticated;/);
  });
});
