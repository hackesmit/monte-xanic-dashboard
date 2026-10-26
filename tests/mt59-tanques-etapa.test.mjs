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

test('la migracion se registra en el manifiesto despues de la de escritura', () => {
  assert.match(sql, /VALUES \('migration_tanques_etapa'\)/);
  assert.ok(MIGRATIONS.includes('migration_tanques_etapa'));
  assert.ok(MIGRATIONS.indexOf('migration_tanques_etapa') > MIGRATIONS.indexOf('migration_tanques_escritura'));
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
