// mt59 - la columna etapa de movimientos_tanque (xd-qrn.9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ETAPAS, replayMovimientos } from '../js/tanques/estado.js';
import { MIGRATIONS } from '../js/migrations-manifest.js';

const sql = readFileSync(new URL('../sql/migration_tanques_etapa.sql', import.meta.url), 'utf8');

test('el CHECK de la migracion lista exactamente las ETAPAS de estado.js', () => {
  const lista = sql.match(/etapa IN \(([^)]*)\)/)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(lista, ETAPAS);
});

test('la migracion se registra en el manifiesto', () => {
  assert.match(sql, /VALUES \('migration_tanques_etapa'\)/);
  assert.ok(MIGRATIONS.includes('migration_tanques_etapa'));
});

test('una recepcion con etapa explicita deja esa etapa, sin ella queda rec', () => {
  const tanques = [{ codigo: 'A1', capacidad_l: 1000 }, { codigo: 'A2', capacidad_l: 1000 }];
  const base = { fecha: '2026-10-12', tipo: 'recepcion', vintage_year: 2024, volumen_l: 500, merma_l: 0, anulado: false };
  const { estado } = replayMovimientos(tanques, [
    { ...base, id: 1, destino: 'A1', lot_code: '24GREVA-6', etapa: 'cri' },
    { ...base, id: 2, destino: 'A2', lot_code: '24ROSEMX-5', etapa: null },
  ]);
  assert.equal(estado.A1.etapa, 'cri');
  assert.equal(estado.A2.etapa, 'rec');
});

// --- la escritura acepta la etapa (migration_tanques_etapa_escritura) ---------

const esc = readFileSync(new URL('../sql/migration_tanques_etapa_escritura.sql', import.meta.url), 'utf8');
const original = readFileSync(new URL('../sql/migration_tanques_escritura.sql', import.meta.url), 'utf8');

// The body of one CREATE FUNCTION, from its header to the closing $$;
const funcion = (sqlTexto, nombre) => {
  const i = sqlTexto.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`);
  assert.ok(i >= 0, nombre);
  return sqlTexto.slice(i, sqlTexto.indexOf('\n$$;', i) + 4);
};

test('tanques_escribir inserta la etapa de p_fila', () => {
  const f = funcion(esc, 'tanques_escribir');
  assert.match(f, /nota, fuente, creado_por, client_id, etapa\)/);
  assert.match(f, /v_cliente,\s*p_fila ->> 'etapa'\)/);
});

test('tanques_misma_intencion compara la etapa, asi que otra etapa con la misma clave es otra intencion', () => {
  const f = funcion(esc, 'tanques_misma_intencion');
  assert.match(f, /p_guardada\.creado_por,\s*p_guardada\.etapa\)/);
  assert.match(f, /p_fila ->> 'creado_por',\s*p_fila ->> 'etapa'\)/);
});

test('fuera de la etapa, las dos funciones son las de migration_tanques_escritura', () => {
  const sinEtapa = (t) => t
    .replace(/,\s*p_guardada\.etapa\)/, ')')
    .replace(/,\s*p_fila ->> 'etapa'\)/g, ')')
    .replace(', etapa)', ')');
  for (const nombre of ['tanques_misma_intencion', 'tanques_escribir']) {
    assert.equal(sinEtapa(funcion(esc, nombre)), funcion(original, nombre), nombre);
  }
});

test('la migracion de escritura asegura la columna y el CHECK, repite permisos y es la ultima del manifiesto', () => {
  assert.match(esc, /ADD COLUMN IF NOT EXISTS etapa TEXT/);
  const lista = esc.match(/etapa IN \(([^)]*)\)/)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(lista, ETAPAS);
  assert.match(esc, /GRANT\s+EXECUTE ON FUNCTION public\.tanques_escribir\(BIGINT, TEXT, JSONB, BIGINT\) TO service_role/);
  assert.match(esc, /REVOKE EXECUTE ON FUNCTION public\.tanques_escribir\(BIGINT, TEXT, JSONB, BIGINT\) FROM PUBLIC, anon, authenticated/);
  assert.match(esc, /VALUES \('migration_tanques_etapa_escritura'\)/);
  assert.ok(MIGRATIONS.includes('migration_tanques_etapa_escritura'));
});

// --- la etapa queda congelada (migration_tanques_etapa_append_only) ----------

const congela = readFileSync(new URL('../sql/migration_tanques_etapa_append_only.sql', import.meta.url), 'utf8');
const tupla = (texto) => funcion(texto, 'movimientos_tanque_append_only').match(/IF (\(NEW\.id,[\s\S]*?)\n {2}THEN/)[1];

test('el trigger append-only congela todas las columnas de movimientos_tanque menos anulado', () => {
  // Every column of the original CREATE TABLE plus every column a later
  // migration adds, so the next new column fails here until it is frozen too.
  const base = readFileSync(new URL('../sql/migration_tanques.sql', import.meta.url), 'utf8');
  const columnas = base.match(/CREATE TABLE IF NOT EXISTS public\.movimientos_tanque \(\n([\s\S]*?)\n\);/)[1]
    .split('\n').map((l) => l.match(/^ {2}(\w+)\s{2,}/)?.[1]).filter(Boolean);
  const dir = new URL('../sql/', import.meta.url);
  const migraciones = readdirSync(dir).filter((f) => /^migration_tanques\w*\.sql$/.test(f));
  for (const texto of migraciones.map((f) => readFileSync(new URL(f, dir), 'utf8'))) {
    for (const [, col] of texto.matchAll(/ALTER TABLE public\.movimientos_tanque ADD COLUMN IF NOT EXISTS (\w+)/g)) {
      if (!columnas.includes(col)) columnas.push(col);
    }
  }
  assert.ok(columnas.includes('client_id') && columnas.includes('etapa'));
  const t = tupla(congela);
  for (const col of columnas) {
    if (col === 'anulado') {
      assert.ok(!t.includes('NEW.anulado'));
      continue;
    }
    assert.ok(t.includes(`NEW.${col}`), `el trigger no compara NEW.${col}`);
    assert.ok(t.includes(`OLD.${col}`), `el trigger no compara OLD.${col}`);
  }
});

test('fuera de la etapa, la funcion append-only es la de migration_tanques_escritura', () => {
  const sinEtapa = funcion(congela, 'movimientos_tanque_append_only')
    .replace(/, NEW\.etapa\)/, ')').replace(/, OLD\.etapa\)/, ')');
  assert.equal(sinEtapa, funcion(original, 'movimientos_tanque_append_only'));
});

test('la migracion exige la columna, recrea los dos triggers y es la ultima del manifiesto', () => {
  assert.match(congela, /attname = 'etapa' AND NOT attisdropped\n {2}\) THEN\n {4}RAISE EXCEPTION/);
  assert.match(congela, /DROP TRIGGER IF EXISTS movimientos_tanque_append_only ON public\.movimientos_tanque;\nCREATE TRIGGER movimientos_tanque_append_only\n {2}BEFORE UPDATE OR DELETE ON public\.movimientos_tanque\n {2}FOR EACH ROW EXECUTE FUNCTION public\.movimientos_tanque_append_only\(\);/);
  assert.match(congela, /DROP TRIGGER IF EXISTS movimientos_tanque_no_truncate ON public\.movimientos_tanque;\nCREATE TRIGGER movimientos_tanque_no_truncate\n {2}BEFORE TRUNCATE ON public\.movimientos_tanque\n {2}FOR EACH STATEMENT EXECUTE FUNCTION public\.movimientos_tanque_append_only\(\);/);
  assert.match(congela, /REVOKE ALL ON FUNCTION public\.movimientos_tanque_append_only\(\) FROM anon, authenticated;/);
  assert.match(congela, /^BEGIN;$/m);
  assert.match(congela, /^COMMIT;\n$/m);
  assert.match(congela, /VALUES \('migration_tanques_etapa_append_only'\)/);
  assert.equal(MIGRATIONS[MIGRATIONS.length - 1], 'migration_tanques_etapa_append_only');
});
