// MT.43 - Conformed dimension catalogs (dim_valle / dim_rancho / dim_parcela
// / dim_variedad and their synonym tables).
//
// sql/migration_dim_catalogs.sql is generated from js/config.js. These tests
// exist so the generated file can never silently fall behind the catalogs it
// was generated from: edit a ranch, a parcel or a varietal in config.js
// without re-running the generator and the first test fails by name.
//
// The rest assert the properties an external consumer (Power BI, dbt, a field
// cost vendor) actually depends on: referential closure, no duplicate keys,
// and that every legacy label the app can normalize is resolvable in SQL too.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG } from '../js/config.js';
import {
  OUT, buildSql, valles, ranchos, ranchSinonimos,
  variedades, variedadSinonimos, parcelas
} from '../scripts/gen-dim-catalogs.mjs';

const onDisk = readFileSync(OUT, 'utf8');

describe('MT.43 - generated migration is current', () => {
  it('sql/migration_dim_catalogs.sql matches a fresh generation from config.js', () => {
    assert.equal(
      onDisk,
      buildSql(),
      'sql/migration_dim_catalogs.sql is stale. Run: node scripts/gen-dim-catalogs.mjs'
    );
  });

  it('registers itself in applied_migrations', () => {
    assert.match(onDisk, /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_dim_catalogs'\)/);
  });

  it('runs as a single transaction', () => {
    assert.match(onDisk, /^BEGIN;$/m);
    assert.match(onDisk, /^COMMIT;$/m);
  });

  it('is idempotent: no bare CREATE TABLE and every INSERT resolves the conflict', () => {
    const creates = onDisk.match(/CREATE TABLE(?! IF NOT EXISTS)/g) || [];
    assert.deepEqual(creates, [], 'every CREATE TABLE must be IF NOT EXISTS');
    const inserts = onDisk.match(/INSERT INTO public\.\w+/g) || [];
    const conflicts = onDisk.match(/ON CONFLICT \([\w, ]+\) DO (UPDATE|NOTHING)/g) || [];
    assert.ok(inserts.length >= 7, 'expected a seed INSERT per dim table plus applied_migrations');
    assert.equal(inserts.length, conflicts.length,
      'every INSERT needs an ON CONFLICT clause to stay re-runnable');
  });
});

describe('MT.43 - catalog contents track config.js', () => {
  it('one parcel row per curated vineyard section', () => {
    assert.equal(parcelas.length, CONFIG.vineyardSections.length);
    assert.equal(parcelas.length, 67, 'section count changed; confirm intentional then update this number');
  });

  it('parcel codes are unique', () => {
    assert.equal(new Set(parcelas.map(p => p.code)).size, parcelas.length);
  });

  it('hectares are positive where recorded', () => {
    for (const p of parcelas.filter(x => x.hectareas != null)) {
      assert.ok(Number(p.hectareas) > 0, `${p.code} has non-positive hectares`);
    }
  });

  it('every valley carrying a weather series has coordinates', () => {
    for (const code of Object.keys(CONFIG.valleyCoordinates)) {
      const v = valles.find(x => x.code === code);
      assert.ok(v, `valley ${code} is fetched for weather but missing from dim_valle`);
      assert.ok(v.lat != null && v.lon != null, `valley ${code} has no coordinates`);
    }
  });
});

describe('MT.43 - referential closure', () => {
  const ranchSet = new Set(ranchos.map(r => r.nombre));
  const valleSet = new Set(valles.map(v => v.code));
  const varSet = new Set(variedades);

  it('every parcel points at a catalogued ranch', () => {
    for (const p of parcelas) assert.ok(ranchSet.has(p.rancho), `${p.code} -> unknown ranch ${p.rancho}`);
  });

  it('every resolved parcel varietal exists in dim_variedad', () => {
    for (const p of parcelas.filter(x => x.variedad)) {
      assert.ok(varSet.has(p.variedad), `${p.code} -> unknown varietal ${p.variedad}`);
    }
  });

  it('every ranch valley code exists in dim_valle when present', () => {
    for (const r of ranchos.filter(x => x.valle)) {
      assert.ok(valleSet.has(r.valle), `${r.nombre} -> unknown valley ${r.valle}`);
    }
  });

  it('every synonym resolves to a catalogued target', () => {
    for (const s of ranchSinonimos) assert.ok(ranchSet.has(s.rancho), `ranch synonym ${s.sinonimo} dangles`);
    for (const s of variedadSinonimos) assert.ok(varSet.has(s.variedad), `variety synonym ${s.sinonimo} dangles`);
  });

  it('no synonym collides with a canonical name', () => {
    for (const s of ranchSinonimos) assert.ok(!ranchSet.has(s.sinonimo), `${s.sinonimo} is both canonical and synonym`);
    for (const s of variedadSinonimos) assert.ok(!varSet.has(s.sinonimo), `${s.sinonimo} is both canonical and synonym`);
  });
});

describe('MT.43 - SQL reproduces the app normalization', () => {
  const resolveRanch = label => {
    if (ranchos.some(r => r.nombre === label)) return label;
    return ranchSinonimos.find(s => s.sinonimo === label)?.rancho ?? null;
  };

  it('every appellationFixes input is resolvable through the dim tables', () => {
    for (const legacy of Object.keys(CONFIG.appellationFixes)) {
      assert.equal(
        resolveRanch(legacy),
        CONFIG.appellationFixes[legacy],
        `SQL cannot reproduce normalizeAppellation("${legacy}")`
      );
    }
  });

  it('every variety abbreviation is resolvable through the dim tables', () => {
    for (const [code, name] of Object.entries(CONFIG.varietyAbbr)) {
      const canon = CONFIG.normalizeVariety(name);
      const viaSql = variedades.includes(code)
        ? code
        : variedadSinonimos.find(s => s.sinonimo === code)?.variedad ?? null;
      assert.equal(viaSql, canon, `SQL cannot resolve variety code ${code}`);
    }
  });

  it('Petite Sirah resolves to Durif, matching normalizeVariety', () => {
    assert.equal(variedadSinonimos.find(s => s.sinonimo === 'Petite Sirah')?.variedad, 'Durif');
    assert.ok(!variedades.includes('Petite Sirah'));
  });
});
