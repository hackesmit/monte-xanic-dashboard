// MT.50 - Tank catalog and movement log (sql/migration_tanques.sql).
//
// Unlike migration_dim_catalogs.sql, this migration is NOT generated: the
// inventory workbook (inventario-tanques.xlsx, 121 vessels) lives outside the
// repo, so the .sql file IS the source of truth. These tests are its guard.
// They parse the seed out of the SQL text and assert the properties the Mapa
// de Tanques tab and the tanques API depend on:
//
//   - 121 vessels, codes unique, one vessel per grid cell
//   - the fermentation grid is contiguous (A1..A8 .. H1..H11, no holes)
//   - every synonym resolves to a seeded code and is not itself a code
//   - the append-only and endpoint constraints are present by name
//   - RLS on and anon/authenticated revoked on all three tables (and the
//     BIGSERIAL sequence, which migration_seguimiento_lotes left open)
//   - the migration is idempotent and registered in the manifest
//
// A hand edit to the seed that breaks any of those fails here instead of in
// production, where the tank map would silently lose or duplicate a vessel.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MIGRATIONS } from '../js/migrations-manifest.js';

const SQL = readFileSync(new URL('../sql/migration_tanques.sql', import.meta.url), 'utf8');

/** Pull the VALUES body of `INSERT INTO public.<table>` up to its ON CONFLICT. */
function valuesBlock(table) {
  const re = new RegExp(
    `INSERT INTO public\\.${table} \\([^)]*\\) VALUES\\n([\\s\\S]*?)\\nON CONFLICT`
  );
  const m = SQL.match(re);
  assert.ok(m, `no seed INSERT found for ${table}`);
  return m[1];
}

/**
 * Split a `(a, b, c)` tuple line into fields, honouring quoted commas.
 *
 * A quoted field is returned EXACTLY as written between the quotes: trimming it
 * would erase whitespace that Postgres stores, which is the one thing the
 * whitespace-normalization assertion below exists to catch. Only unquoted
 * fields (numbers, NULL) get their syntactic padding trimmed.
 */
export function tuple(line) {
  const body = line.trim().replace(/^\(/, '').replace(/\),?$/, '');
  const out = [];
  let lit = '';
  let bare = '';
  let quoted = false;
  let sawQuote = false;
  const push = () => {
    out.push(sawQuote ? lit : bare.trim());
    lit = '';
    bare = '';
    sawQuote = false;
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === "'") {
        if (body[i + 1] === "'") { lit += "'"; i++; continue; }
        quoted = false;
        continue;
      }
      lit += ch;
      continue;
    }
    if (ch === "'") { quoted = true; sawQuote = true; continue; }
    if (ch === ',') { push(); continue; }
    bare += ch;
  }
  push();
  return out;
}

const tanques = valuesBlock('dim_tanque').split('\n').filter(Boolean).map((line) => {
  const [codigo, fila, posicion, capacidad, tipo, area, orden] = tuple(line);
  return {
    codigo,
    fila: fila === 'NULL' ? null : fila,
    posicion: posicion === 'NULL' ? null : Number(posicion),
    capacidad_l: Number(capacidad),
    tipo,
    area,
    orden: Number(orden)
  };
});

const sinonimos = valuesBlock('dim_tanque_sinonimo').split('\n').filter(Boolean).map((line) => {
  const [sinonimo, codigo] = tuple(line);
  return { sinonimo, codigo };
});

const codes = new Set(tanques.map((t) => t.codigo));

describe('MT.50 - the seed parser itself', () => {
  // These assertions guard the guard. An earlier version trimmed quoted
  // literals, so a seed row written as 'KEG 17 ' parsed as 'KEG 17' and the
  // whitespace assertion below passed while Postgres stored the trailing space.
  it('keeps whitespace that lives inside a SQL literal', () => {
    assert.deepEqual(
      tuple("  ('KEG 17 ', NULL, NULL, 60, 'KEG', 'otras', 120),"),
      ['KEG 17 ', 'NULL', 'NULL', '60', 'KEG', 'otras', '120']
    );
    assert.deepEqual(
      tuple("  (' A1', 'A', 1, 7400, 'TQ', 'fermentacion', 5)"),
      [' A1', 'A', '1', '7400', 'TQ', 'fermentacion', '5']
    );
  });

  it('unescapes a doubled quote and splits on a comma inside a literal', () => {
    assert.deepEqual(
      tuple("  ('O''Hara, 2', 'A', 1, 10, 'TQ', 'fermentacion', 1)"),
      ["O'Hara, 2", 'A', '1', '10', 'TQ', 'fermentacion', '1']
    );
  });

  it('trims only the padding around an unquoted field', () => {
    assert.deepEqual(tuple("  ('X',  NULL ,  7 )"), ['X', 'NULL', '7']);
  });
});

describe('MT.50 - dim_tanque seed matches the inventory', () => {
  it('seeds all 121 vessels', () => {
    assert.equal(tanques.length, 121,
      'the inventory has 121 vessels; a different count means the seed drifted');
  });

  it('codes are unique and free of stray whitespace', () => {
    assert.equal(codes.size, tanques.length, 'duplicate codigo in the seed');
    for (const t of tanques) {
      assert.equal(t.codigo, t.codigo.trim().replace(/\s+/g, ' '),
        `codigo ${JSON.stringify(t.codigo)} is not whitespace-normalized`);
    }
  });

  it('splits into 68 fermentation, 4 recepcion and 49 other vessels', () => {
    const byArea = {};
    for (const t of tanques) byArea[t.area] = (byArea[t.area] || 0) + 1;
    assert.deepEqual(byArea, { recepcion: 4, fermentacion: 68, otras: 49 });
  });

  it('only uses the four inventory vessel types', () => {
    const byTipo = {};
    for (const t of tanques) byTipo[t.tipo] = (byTipo[t.tipo] || 0) + 1;
    assert.deepEqual(byTipo, { TQ: 82, TIBOR: 21, DOMECQ: 7, KEG: 11 });
  });

  it('every capacity is a positive number of litres', () => {
    for (const t of tanques) {
      assert.ok(Number.isFinite(t.capacidad_l) && t.capacidad_l > 0,
        `${t.codigo} has capacidad_l ${t.capacidad_l}`);
    }
    const total = tanques.reduce((s, t) => s + t.capacidad_l, 0);
    assert.equal(total, 1308609, 'total installed capacity changed; confirm against the inventory');
  });

  it('keeps the spot-checked capacities of the inventory', () => {
    const cap = (codigo) => tanques.find((t) => t.codigo === codigo)?.capacidad_l;
    assert.equal(cap('A1'), 7400);
    assert.equal(cap('C1'), 18700);
    assert.equal(cap('H11'), 10366);
    assert.equal(cap('F026'), 45000);
    assert.equal(cap('TIBOR 1'), 1000);
    assert.equal(cap('KEG 4'), 20, 'KEG 4 is the odd 20 L keg');
  });

  it('orden is the inventory order, 1..121 with no gaps', () => {
    const ordenes = tanques.map((t) => t.orden).sort((a, b) => a - b);
    assert.deepEqual(ordenes, Array.from({ length: 121 }, (_, i) => i + 1));
  });
});

describe('MT.50 - the grid is drawable', () => {
  it('no two vessels share a grid cell', () => {
    const cells = tanques.filter((t) => t.fila).map((t) => `${t.fila}${t.posicion}`);
    assert.equal(new Set(cells).size, cells.length, 'two vessels in one cell');
  });

  it('fermentation rows A..H are contiguous from position 1', () => {
    const expected = { A: 8, B: 7, C: 7, D: 8, E: 9, F: 10, G: 8, H: 11 };
    for (const [fila, count] of Object.entries(expected)) {
      const ps = tanques.filter((t) => t.fila === fila).map((t) => t.posicion).sort((a, b) => a - b);
      assert.deepEqual(ps, Array.from({ length: count }, (_, i) => i + 1),
        `row ${fila} is not 1..${count}`);
    }
  });

  it('the recepcion strip is the two rows of the floor plan', () => {
    const strip = tanques.filter((t) => t.area === 'recepcion')
      .map((t) => `${t.codigo}=${t.fila}${t.posicion}`).sort();
    assert.deepEqual(strip, ['PD-1=P1', 'PD-2=P2', 'R1=R1', 'R2=R2']);
  });

  it('a fermentation code always spells its own cell', () => {
    // This is the independent check on the canonical codes: renaming A2 to X2
    // in the seed leaves every count, capacity total and grid run intact, and
    // only this invariant notices.
    for (const t of tanques.filter((v) => v.area === 'fermentacion')) {
      assert.equal(t.codigo, `${t.fila}${t.posicion}`,
        `${t.codigo} sits at ${t.fila}${t.posicion}`);
    }
  });

  it('the tray holds exactly the 49 vessels the inventory has no place for', () => {
    // The tray has no structural rule to lean on (a code there encodes no
    // cell), so the expected set is spelled out. Edit the seed and this fails.
    const tray = tanques.filter((t) => t.area === 'otras').map((t) => t.codigo).sort();
    assert.deepEqual(tray, [
      'F026', 'F028', 'F029', 'F030', 'F031', 'F038', 'F039',
      'I-1 CAVA', 'I-2 CAVA', 'I-3 CAVA', 'I-4 CAVA', 'I-5 CAVA', 'I-6 CAVA',
      'KEG 1', 'KEG 11', 'KEG 14', 'KEG 16', 'KEG 17', 'KEG 2', 'KEG 3',
      'KEG 4', 'KEG 5', 'KEG 6', 'KEG 7',
      'TIBOR 1', 'TIBOR 10', 'TIBOR 11', 'TIBOR 12', 'TIBOR 13', 'TIBOR 14',
      'TIBOR 15', 'TIBOR 16', 'TIBOR 18', 'TIBOR 2', 'TIBOR 21', 'TIBOR 22',
      'TIBOR 28', 'TIBOR 3', 'TIBOR 4', 'TIBOR 5', 'TIBOR 6', 'TIBOR 7',
      'TIBOR 8', 'TIBOR 9', 'TIBOR S/N',
      'VAR 1 CESAR', 'VAR 2 CESAR', 'VAR A', 'VAR B'
    ]);
  });

  it('every located vessel has both fila and posicion, and the tray has neither', () => {
    for (const t of tanques) {
      if (t.area === 'otras') {
        assert.equal(t.fila, null, `${t.codigo} is in the tray but has a fila`);
        assert.equal(t.posicion, null, `${t.codigo} is in the tray but has a posicion`);
      } else {
        assert.ok(t.fila, `${t.codigo} has no fila`);
        assert.ok(Number.isInteger(t.posicion) && t.posicion > 0, `${t.codigo} has no posicion`);
      }
    }
  });
});

describe('MT.50 - synonyms resolve', () => {
  it('every synonym points at a seeded codigo', () => {
    for (const s of sinonimos) {
      assert.ok(codes.has(s.codigo), `synonym ${s.sinonimo} points at unknown codigo ${s.codigo}`);
    }
  });

  it('a synonym is never itself a codigo (that would be ambiguous)', () => {
    for (const s of sinonimos) {
      assert.ok(!codes.has(s.sinonimo), `${s.sinonimo} is both a codigo and a synonym`);
    }
  });

  it('synonyms are unique', () => {
    const keys = sinonimos.map((s) => s.sinonimo);
    assert.equal(new Set(keys).size, keys.length, 'duplicate sinonimo');
  });

  it('resolves the spellings the lab actually writes in wine_samples.vessel_id', () => {
    const resolve = (raw) => {
      const key = raw.trim().replace(/\s+/g, ' ').toUpperCase();
      if (codes.has(key)) return key;
      return sinonimos.find((s) => s.sinonimo === key)?.codigo ?? null;
    };
    assert.equal(resolve('PD1'), 'PD-1');
    assert.equal(resolve('PD2'), 'PD-2');
    assert.equal(resolve('TIB 13'), 'TIBOR 13');
    assert.equal(resolve('TIBOR  1'), 'TIBOR 1', 'whitespace is collapsed before lookup');
    assert.equal(resolve('TIBOR 8 '), 'TIBOR 8');
    assert.equal(resolve('I3'), 'I-3 CAVA');
    assert.equal(resolve('I4'), 'I-4 CAVA');
    assert.equal(resolve('I6'), 'I-6 CAVA');
    assert.equal(resolve('VAR A'), 'VAR A');
    assert.equal(resolve('H11'), 'H11');
  });

  it('covers each synonym family for every vessel in it, not just the seen ones', () => {
    const tibores = tanques.filter((t) => /^TIBOR \d+$/.test(t.codigo));
    assert.equal(tibores.length, 20, 'numbered tibores changed');
    for (const t of tibores) {
      const n = t.codigo.slice('TIBOR '.length);
      for (const alias of [`TIB ${n}`, `TIB${n}`, `TIBOR${n}`]) {
        assert.ok(sinonimos.some((s) => s.sinonimo === alias && s.codigo === t.codigo),
          `missing synonym ${alias} -> ${t.codigo}`);
      }
    }
    for (let n = 1; n <= 6; n++) {
      for (const alias of [`I${n}`, `I-${n}`, `I ${n}`]) {
        assert.ok(sinonimos.some((s) => s.sinonimo === alias && s.codigo === `I-${n} CAVA`),
          `missing synonym ${alias} -> I-${n} CAVA`);
      }
    }
  });

  it('leaves the unresolved and non-tank vessel ids unseeded', () => {
    // BIN/BCA are areas; C9, FI, 200 are unresolved; TIBOR 17, TIBOR 24 and
    // F036 are cited by the lab but absent from the inventory. Seeding any of
    // them would invent a capacity and an area. See the migration header.
    for (const raw of ['BIN', 'BCA', 'C9', 'FI', '200', 'TIBOR 17', 'TIB 17', 'TIBOR 24', 'F036']) {
      assert.ok(!codes.has(raw), `${raw} must not be a dim_tanque row`);
      assert.ok(!sinonimos.some((s) => s.sinonimo === raw), `${raw} must not be a synonym`);
    }
  });
});

describe('MT.50 - schema guards', () => {
  const hasConstraint = (name) =>
    new RegExp(`CONSTRAINT ${name}\\b`).test(SQL) || new RegExp(`ADD\\s+CONSTRAINT ${name}\\b`).test(SQL);

  it('constrains dim_tanque by name', () => {
    for (const c of ['dim_tanque_tipo_chk', 'dim_tanque_area_chk', 'dim_tanque_capacidad_chk',
      'dim_tanque_fila_chk', 'dim_tanque_posicion_chk', 'dim_tanque_layout_chk',
      'dim_tanque_casilla_uniq']) {
      assert.ok(hasConstraint(c), `missing constraint ${c}`);
    }
  });

  it('constrains movimientos_tanque by name', () => {
    for (const c of ['movimientos_tanque_tipo_chk', 'movimientos_tanque_fuente_chk',
      'movimientos_tanque_volumen_chk', 'movimientos_tanque_merma_chk',
      'movimientos_tanque_merma_tope_chk', 'movimientos_tanque_merma_destino_chk',
      'movimientos_tanque_extremos_chk', 'movimientos_tanque_circular_chk',
      'movimientos_tanque_recepcion_chk', 'movimientos_tanque_salida_chk']) {
      assert.ok(hasConstraint(c), `missing constraint ${c}`);
    }
  });

  it('allows exactly the seven movement types and two sources', () => {
    const tipos = SQL.match(/movimientos_tanque_tipo_chk\s+CHECK \(tipo IN \(([\s\S]*?)\)\)/);
    assert.ok(tipos, 'tipo CHECK not found');
    const list = tipos[1].match(/'([a-z]+)'/g).map((s) => s.replace(/'/g, ''));
    assert.deepEqual(list.sort(), ['descube', 'ensamble', 'prensa', 'recepcion',
      'salida', 'sangrado', 'trasiego']);
    assert.match(SQL, /movimientos_tanque_fuente_chk\s+CHECK \(fuente IN \('manual', 'lab'\)\)/);
  });

  it('rejects NaN and Infinity litres, which a bare > 0 lets through', () => {
    // NUMERIC accepts 'NaN' and 'Infinity', and Postgres orders NaN ABOVE every
    // finite number, so volumen_l > 0 alone admits both and the tank's derived
    // balance becomes NaN for good. < 'Infinity' rejects them (NaN < Infinity
    // is false); > 0 and >= 0 reject -Infinity.
    assert.match(SQL, /CHECK \(volumen_l > 0 AND volumen_l < 'Infinity'::numeric\)/);
    assert.match(SQL, /CHECK \(merma_l >= 0 AND merma_l < 'Infinity'::numeric\)/);
    assert.match(SQL, /CHECK \(capacidad_l > 0 AND capacidad_l < 'Infinity'::numeric\)/);
  });

  it('closes the layout CHECK against a NULL result', () => {
    // A CHECK that evaluates to NULL is SATISFIED. With fila NULL the
    // fermentacion branch's `fila IN (...)` is NULL, so without the outer
    // IS TRUE an UPDATE ... SET fila = NULL left a vessel neither on the grid
    // nor in the tray.
    assert.match(SQL, /\n  \) IS TRUE\);/);
  });

  it('reconciles every CHECK through ALTER, not inside CREATE TABLE', () => {
    // CREATE TABLE IF NOT EXISTS skips an existing table, so a CHECK written
    // inline never reaches an install that already has the table and a re-run
    // cannot restore one somebody dropped.
    const inlineChecks = SQL.match(/^ {2}CONSTRAINT \w+\s+CHECK/gm) ?? [];
    assert.deepEqual(inlineChecks, [],
      'move this CHECK to an ALTER TABLE DROP IF EXISTS / ADD pair');
    const adds = SQL.match(/ADD {2}CONSTRAINT (\w+)/g) ?? [];
    const drops = SQL.match(/DROP CONSTRAINT IF EXISTS (\w+)/g) ?? [];
    assert.equal(adds.length, 19, 'constraint count changed; confirm intentional');
    assert.equal(adds.length, drops.length,
      'every ADD CONSTRAINT needs its DROP CONSTRAINT IF EXISTS to stay re-runnable');
  });

  it('refuses a lot code made only of whitespace, tabs included', () => {
    // btrim() with no second argument strips spaces but not tabs or newlines,
    // so CHECK (btrim(lot_code) <> '') accepted E'\t\n' and assigned wine to a
    // visually blank lote.
    assert.match(SQL, /movimientos_tanque_lote_chk\s+CHECK \(lot_code ~ '\[\^\[:space:\]\]'\)/);
    assert.ok(!/btrim\(lot_code\)/.test(SQL), 'btrim does not see a tab');
  });

  it('cannot derive a negative volume from a single movement', () => {
    // merma_l comes out of volumen_l, so a merma larger than the volume would
    // hand the destination negative litres; with no destino there is nothing to
    // subtract it from.
    assert.match(SQL, /movimientos_tanque_merma_tope_chk\s+CHECK \(merma_l <= volumen_l\)/);
    assert.match(SQL, /movimientos_tanque_merma_destino_chk\s+CHECK \(destino IS NOT NULL OR merma_l = 0\)/);
  });

  it('binds each grid row to its own area', () => {
    const layout = SQL.match(/dim_tanque_layout_chk\s+CHECK \(([\s\S]*?)\n  \)/);
    assert.ok(layout, 'layout CHECK not found');
    assert.match(layout[1], /area = 'fermentacion' AND fila IN \('A','B','C','D','E','F','G','H'\)/);
    assert.match(layout[1], /area = 'recepcion'\s+AND fila IN \('R','P'\)/);
    assert.match(layout[1], /area = 'otras'\s+AND fila IS NULL/);
  });

  it('defaults merma_l to 0 and anulado to false', () => {
    assert.match(SQL, /merma_l\s+NUMERIC NOT NULL DEFAULT 0/);
    assert.match(SQL, /anulado\s+BOOLEAN NOT NULL DEFAULT false/);
    assert.match(SQL, /created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  });

  it('references dim_tanque from both movement endpoints', () => {
    assert.match(SQL, /origen\s+TEXT\s+REFERENCES public\.dim_tanque\(codigo\)/);
    assert.match(SQL, /destino\s+TEXT\s+REFERENCES public\.dim_tanque\(codigo\)/);
    assert.match(SQL, /codigo\s+TEXT NOT NULL REFERENCES public\.dim_tanque\(codigo\)/);
  });

  it('enforces append-only with a trigger, not just a comment', () => {
    assert.match(SQL, /CREATE OR REPLACE FUNCTION public\.movimientos_tanque_append_only\(\)/);
    assert.match(SQL, /BEFORE UPDATE OR DELETE ON public\.movimientos_tanque/);
    // a FOR EACH ROW trigger never sees TRUNCATE, so that needs its own
    assert.match(SQL, /BEFORE TRUNCATE ON public\.movimientos_tanque/);
    assert.match(SQL, /TRUNCATE borraria la historia de la bodega/);
    assert.match(SQL, /append-only: usa anulado = true en lugar de DELETE/);
    assert.match(SQL, /no se puede reactivar/);
    assert.match(SQL, /SET search_path = pg_catalog, public/);
  });

  it('the trigger compares EVERY movement column except anulado', () => {
    // The text assertions above cannot catch a trigger body that quietly stops
    // comparing volumen_l, so this one is structural: pull the column list out
    // of the CREATE TABLE and require each column other than anulado on both
    // sides of the IS DISTINCT FROM. That also catches the real future risk,
    // which is adding a column and forgetting the trigger.
    const create = SQL.match(
      /CREATE TABLE IF NOT EXISTS public\.movimientos_tanque \(\n([\s\S]*?)\n\);/
    );
    assert.ok(create, 'movimientos_tanque CREATE TABLE not found');
    const columns = create[1]
      .split('\n')
      .map((l) => l.match(/^ {2}(\w+)\s{2,}/)?.[1])
      .filter(Boolean);
    assert.ok(columns.length >= 13, `only parsed ${columns.length} columns`);
    assert.ok(columns.includes('anulado') && columns.includes('volumen_l'));

    const body = SQL.match(/(\(NEW\.id,[\s\S]*?)\n  THEN/);
    assert.ok(body, 'the immutability comparison was not found');
    for (const col of columns) {
      if (col === 'anulado') {
        assert.ok(!body[1].includes(`NEW.${col}`),
          'anulado is the one field an annul may change, so it must stay out of the comparison');
        continue;
      }
      assert.ok(body[1].includes(`NEW.${col}`), `trigger does not compare NEW.${col}`);
      assert.ok(body[1].includes(`OLD.${col}`), `trigger does not compare OLD.${col}`);
    }
  });
});

describe('MT.50 - security and idempotency', () => {
  it('enables RLS and revokes anon/authenticated on all three tables', () => {
    for (const t of ['dim_tanque', 'dim_tanque_sinonimo', 'movimientos_tanque']) {
      assert.match(SQL, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`));
      assert.match(SQL, new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon, authenticated`));
    }
  });

  it('grants no policy to anon (server-only tables)', () => {
    assert.equal(SQL.match(/CREATE POLICY/g), null,
      'these tables are server-only: a policy would expose them to the anon key');
  });

  it('revokes the BIGSERIAL sequence too', () => {
    assert.match(SQL,
      /REVOKE ALL ON SEQUENCE public\.movimientos_tanque_id_seq FROM anon, authenticated/);
  });

  it('runs as a single transaction', () => {
    assert.match(SQL, /^BEGIN;$/m);
    assert.match(SQL, /^COMMIT;$/m);
  });

  it('is re-runnable: no bare CREATE, every seed INSERT resolves its conflict', () => {
    // anchored to a statement: the comments legitimately name the bare clause
    assert.deepEqual(SQL.match(/^CREATE TABLE(?! IF NOT EXISTS)/gm) ?? [], [],
      'every CREATE TABLE must be IF NOT EXISTS');
    assert.deepEqual(SQL.match(/^CREATE INDEX(?! IF NOT EXISTS)/gm) ?? [], [],
      'every CREATE INDEX must be IF NOT EXISTS');
    const inserts = SQL.match(/INSERT INTO public\.\w+/g) || [];
    const conflicts = SQL.match(/ON CONFLICT \([\w, ]+\) DO (UPDATE|NOTHING)/g) || [];
    assert.equal(inserts.length, 3, 'expected dim_tanque, dim_tanque_sinonimo, applied_migrations');
    assert.equal(inserts.length, conflicts.length,
      'every INSERT needs an ON CONFLICT clause to stay re-runnable');
    assert.match(SQL, /ALTER TABLE public\.dim_tanque DROP CONSTRAINT IF EXISTS dim_tanque_casilla_uniq/);
    assert.match(SQL, /DROP TRIGGER IF EXISTS movimientos_tanque_append_only/);
    assert.match(SQL, /DROP TRIGGER IF EXISTS movimientos_tanque_no_truncate/);
  });

  it('re-running does not resurrect a deactivated tank', () => {
    const upsert = SQL.match(/ON CONFLICT \(codigo\) DO UPDATE([\s\S]*?);/)[1];
    assert.ok(!/\bactivo\s*=/.test(upsert),
      'the upsert must not reset activo; deactivating a tank is an operator decision');
  });

  it('registers itself in applied_migrations and in the manifest', () => {
    assert.match(SQL,
      /INSERT INTO public\.applied_migrations \(name\) VALUES \('migration_tanques'\)/);
    assert.ok(MIGRATIONS.includes('migration_tanques'),
      'js/migrations-manifest.js must list migration_tanques or the drift banner stays silent');
  });

  it('alters no existing table', () => {
    const altered = new Set((SQL.match(/ALTER TABLE public\.(\w+)/g) || [])
      .map((s) => s.replace('ALTER TABLE public.', '')));
    assert.deepEqual([...altered].sort(),
      ['dim_tanque', 'dim_tanque_sinonimo', 'movimientos_tanque']);
  });
});
