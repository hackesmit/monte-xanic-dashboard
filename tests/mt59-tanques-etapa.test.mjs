// mt59 - la columna etapa de movimientos_tanque (xd-qrn.9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.equal(MIGRATIONS[MIGRATIONS.length - 1], 'migration_tanques_etapa_escritura');
});
