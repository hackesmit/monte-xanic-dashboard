// MT.43 — config.js mapping + normalization audit (bead xd-3k4)
//
// Renamed from mt42 → mt43: main already carries two mt42-* files that merged
// ahead of this branch, so this one bumps the ordinal to keep it unique.
//
// Locks in the invariants verified during the config.js audit so future edits
// cannot silently reintroduce drift. Four enforcement layers:
//
//   (1) Fixture-driven header coverage — the audit's central claim is that
//       every real workbook/CSV header maps after the parser's trim (and, for
//       the Excel parsers, whitespace-collapse) normalization. This layer reads
//       the committed tests/fixtures, normalizes each header exactly the way
//       the production parser for that file does, and requires every header to
//       either resolve to a mapping/evaluator column or appear in an explicit
//       allowlist of intentionally-dropped columns. A new unmapped header fails.
//   (2) Schema-target coverage — every column a mapping writes must be a real
//       column in the committed sql/ schema. wine_samples.brix is the single
//       named exception (bead xd-ifx): confirmed present in prod, absent from
//       committed migrations, so this is fresh-install drift only. The exception
//       is asserted by equality, so it disappears (test fails, forcing cleanup)
//       the moment xd-ifx adds the column.
//   (3) Variety/appellation normalization is total + idempotent, and every
//       bare-valley appellation resolves to its specific expected ranch.
//   (4) Every ranch reachable through appellationFixes, _codeToRanch, or
//       originAbbr has BOTH a colour and a point style.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CONFIG } from '../js/config.js';

const originKeys = new Set(Object.keys(CONFIG.originColors));
const styleKeys = new Set(Object.keys(CONFIG.originPointStyles));
const varietyColorKeys = new Set(Object.keys(CONFIG.varietyColors));
// 'California' is a WineXRay skip-appellation (never reaches the map views);
// it is intentionally colourless and falls back to a hashed colour.
const COLORLESS_OK = new Set(['California']);

// Header normalizers, matched to the production parsers:
//   - WineXRay (js/upload/winexray.js): String(h||'').trim()          → trim only
//   - Recepción/Pre-recepción (js/upload/{recepcion,prerecepcion}.js): trim +
//     collapse internal whitespace runs to a single space.
const trimOnly = h => String(h ?? '').trim();
const collapse = h => String(h ?? '').trim().replace(/\s+/g, ' ');
const keyset = obj => new Set(Object.keys(obj).map(collapse));

// xlsx is only present when node_modules is installed. Import it dynamically so
// this file still loads (and the CSV + non-fixture suites still run) when it is
// absent; the workbook fixture cases skip in that case and run wherever deps
// are present.
let XLSX = null;
try { XLSX = await import('xlsx'); } catch { /* node_modules absent — workbook cases skip */ }

// ── (3) normalizeVariety ────────────────────────────────────────────
describe('MT.43 — normalizeVariety', () => {
  it("remaps the legacy alias 'Petite Sirah' → 'Durif'", () => {
    assert.equal(CONFIG.normalizeVariety('Petite Sirah'), 'Durif');
  });

  it('is idempotent on every known variety (pass-through by design)', () => {
    for (const v of [...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white]) {
      assert.equal(CONFIG.normalizeVariety(v), v, `variety ${v} changed`);
    }
    assert.equal(CONFIG.normalizeVariety('Durif'), 'Durif');
  });

  it('passes an unknown variety through unchanged (non-validating)', () => {
    assert.equal(CONFIG.normalizeVariety('Zinfandel'), 'Zinfandel');
  });
});

describe('MT.43 — variety colour/classification consistency', () => {
  it('grapeTypes and varietyColors describe the same variety set', () => {
    const gt = new Set([...CONFIG.grapeTypes.red, ...CONFIG.grapeTypes.white]);
    for (const v of gt) assert.ok(varietyColorKeys.has(v), `${v} has no varietyColor`);
    for (const v of varietyColorKeys) assert.ok(gt.has(v), `${v} colour has no grapeType`);
  });

  it('every varietyAbbr code resolves to a real variety colour', () => {
    for (const full of new Set(Object.values(CONFIG.varietyAbbr))) {
      assert.ok(varietyColorKeys.has(full), `varietyAbbr → ${full} has no colour`);
    }
  });
});

describe('MT.43 — normalizeAppellation idempotency', () => {
  it('returns every ranch-first name (originColors key) unchanged', () => {
    for (const k of originKeys) {
      assert.equal(CONFIG.normalizeAppellation(k), k, `appellation ${k} not idempotent`);
    }
  });

  it('returns every appellationFixes output unchanged on a second pass', () => {
    for (const out of new Set(Object.values(CONFIG.appellationFixes))) {
      assert.equal(CONFIG.normalizeAppellation(out), out, `output ${out} not idempotent`);
    }
  });
});

// ── (4) every reachable ranch has a colour AND a point style ─────────
describe('MT.43 — every normalized appellation has colour + style', () => {
  it('appellationFixes outputs each have an originColor and originPointStyle', () => {
    for (const out of new Set(Object.values(CONFIG.appellationFixes))) {
      if (COLORLESS_OK.has(out)) continue;
      assert.ok(originKeys.has(out), `${out} has no originColor`);
      assert.ok(styleKeys.has(out), `${out} has no originPointStyle`);
    }
  });

  // Fix (4): originKeys alone left a gap — a ranch reachable only through
  // _codeToRanch or originAbbr could carry a colour but no point style and
  // still pass. Assert BOTH maps for both reachability paths.
  it('_codeToRanch and originAbbr targets each have a colour AND a point style', () => {
    for (const r of new Set(Object.values(CONFIG._codeToRanch))) {
      assert.ok(originKeys.has(r), `_codeToRanch → ${r} has no originColor`);
      assert.ok(styleKeys.has(r), `_codeToRanch → ${r} has no originPointStyle`);
    }
    for (const r of new Set(Object.values(CONFIG.originAbbr))) {
      assert.ok(originKeys.has(r), `originAbbr → ${r} has no originColor`);
      assert.ok(styleKeys.has(r), `originAbbr → ${r} has no originPointStyle`);
    }
  });
});

// ── (3) bare-valley appellations resolve to their SPECIFIC ranch ─────
describe('MT.43 — bare-valley appellations resolve to the expected ranch', () => {
  // Each case pins the exact ranch the code resolver must return, not merely
  // "a real ranch": a mis-wired _codeToRanch entry that still points at some
  // valid ranch would slip past an is-it-real check but fails equality here.
  const cases = [
    ['25CSMX-1',   'Valle de Guadalupe',   'Monte Xanic (VDG)'],
    ['25CSOLE-1',  'Valle de Guadalupe',   'Olé (VDG)'],
    ['25SY7L-2',   'Valle de Guadalupe',   'Siete Leguas (VDG)'],
    ['25R14CS-1',  'Valle de Guadalupe',   'Rancho 14 (VDG)'],
    ['25CFVA-2B',  'Valle de Ojos Negros', 'Viña Alta (VON)'],
    ['25CSON-3',   'Valle de Ojos Negros', 'Ojos Negros (VON)'],
    ['25KCS-S8-1', 'Valle de Ojos Negros', 'Kompali (VON)'],
    ['25SYDA-L5',  'Valle de Ojos Negros', 'Dominio de las Abejas (VON)'],
    ['25MADUB-1',  'Valle de Ojos Negros', 'Dubacano (SV)'],
  ];
  for (const [id, valley, expected] of cases) {
    it(`${valley} + ${id} → ${expected}`, () => {
      const out = CONFIG.normalizeAppellation(valley, id);
      assert.equal(out, expected, `resolved to ${out}, expected ${expected}`);
      // Redundant given equality, but keeps the leak/colour invariants explicit.
      assert.ok(!/^Valle de/i.test(out), `leaked valley string: ${out}`);
      assert.ok(originKeys.has(out) && styleKeys.has(out), `${out} lacks colour or point style`);
    });
  }

  it('falls back to a valley default when the code is unresolvable', () => {
    assert.equal(CONFIG.normalizeAppellation('Valle de Guadalupe', '25ZZ-9'), 'Monte Xanic (VDG)');
    assert.equal(CONFIG.normalizeAppellation('Valle de Ojos Negros', '25ZZ-9'), 'Ojos Negros (VON)');
  });
});

// ── (1) fixture-driven header coverage ──────────────────────────────
//
// Splits a single CSV line honouring double-quoted fields. The WineXRay export
// ships the Total Phenolics Index header UNQUOTED with an embedded comma;
// js/upload/winexray.js repairs that by quoting the header cell before the
// split, so we replicate the same repair + a quote-aware splitter here.
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false; }
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function wineXRayHeaderRow() {
  const IPT = 'Total Phenolics Index (IPT, d-less)';
  let text = readFileSync(new URL('fixtures/winexray_mixed.csv', import.meta.url), 'utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM
  const nl = text.indexOf('\n');
  let head = (nl === -1 ? text : text.slice(0, nl)).replace(/\r$/, '');
  if (head.includes(IPT) && !head.includes(`"${IPT}"`)) head = head.replace(IPT, `"${IPT}"`);
  return splitCsvLine(head).map(trimOnly).filter(Boolean);
}

describe('MT.43 — WineXRay CSV: every header maps or is an allowlisted drop', () => {
  // WineXRay routes each row to wine_samples (wxToSupabase) or berry_samples
  // (wxToBerry) by Sample Type, so a header "maps" if it resolves in EITHER.
  const WX_MAPPED = new Set(
    [...Object.keys(CONFIG.wxToSupabase), ...Object.keys(CONFIG.wxToBerry)].map(trimOnly),
  );
  // Instrument/metadata columns with no storage target, plus the free-form 'T'
  // operator-notes column — all intentionally dropped (documented in config.js).
  const WX_DROPPED = new Set([
    'Sample Sequence Number', 'Filename', 'UploadDate (yyyy-mm-dd)', 'Sample Number',
    'Sample Time', 'AssayDate (yyyy-mm-dd)', 'Must Temperature', 'Temperature Unit',
    'Cap Temperature', 'Cap Temperature Unit', 'T',
  ]);

  it('reads the fixture and covers every real header', () => {
    const headers = wineXRayHeaderRow();
    assert.ok(headers.length > 20, `expected a full WineXRay header row, got ${headers.length}`);
    // The malformed IPT header must survive the repair as a single mapped field.
    assert.ok(headers.includes('Total Phenolics Index (IPT, d-less)'), 'IPT header not recovered as one field');
    const unmapped = [...new Set(headers.filter(h => !WX_MAPPED.has(h) && !WX_DROPPED.has(h)))];
    assert.deepEqual(unmapped, [], `unmapped WineXRay headers (add a mapping or allowlist them): ${JSON.stringify(unmapped)}`);
  });
});

// Excel header extraction, mirroring the production parsers exactly.
function sheetRows(path, pickSheet) {
  const buf = readFileSync(path);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const name = pickSheet(wb.SheetNames);
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
}

// js/upload/recepcion.js findHeaderRow: first of the top 10 rows with ≥5
// non-null cells (density-based; no banner merge).
function headerRowByDensity(rows, min = 5) {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const nn = (rows[i] || []).filter(v => v !== null && String(v).trim() !== '').length;
    if (nn >= min) return i;
  }
  return -1;
}

// js/upload/prerecepcion.js findHeaderRow: score top-10 rows by how many cells
// resolve to a known column (a wide banner row scores 0), fall back to density.
function headerRowByScore(rows, lookup, min = 5) {
  let best = -1, bestScore = 0, fallback = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] || [];
    const nn = row.filter(v => v !== null && String(v).trim() !== '').length;
    if (nn < min) continue;
    if (fallback < 0) fallback = i;
    const score = row.reduce((acc, cell) => {
      const h = collapse(cell);
      return acc + (h && lookup.has(h) ? 1 : 0);
    }, 0);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return bestScore >= min ? best : fallback;
}

// js/upload/prerecepcion.js mergeBannerHeaders: fill a blank main-header cell
// from the nearest non-blank cell in the rows above it (banner labels).
function mergeBannerHeaders(rows, headerIdx) {
  const width = Math.max(...rows.slice(0, headerIdx + 1).map(r => (r ? r.length : 0)), 0);
  const headers = [];
  for (let c = 0; c < width; c++) {
    let label = collapse(rows[headerIdx]?.[c]);
    for (let r = headerIdx - 1; r >= 0 && !label; r--) label = collapse(rows[r]?.[c]);
    headers.push(label);
  }
  return headers;
}

function assertHeadersCovered(headers, mapped, dropped, evalRegexes = []) {
  const unmapped = [...new Set(
    headers.filter(Boolean).filter(h =>
      !mapped.has(h) && !dropped.has(h) && !evalRegexes.some(re => re.test(h))),
  )];
  assert.deepEqual(unmapped, [], `unmapped headers (add a mapping or allowlist them): ${JSON.stringify(unmapped)}`);
}

describe('MT.43 — workbook fixtures: every header maps or is an allowlisted drop', () => {
  const skip = XLSX ? false : 'xlsx not installed (node_modules absent); runs where deps are present';

  it('recepcion_sample.xlsx — Recepción sheet', { skip }, () => {
    const rows = sheetRows(
      new URL('fixtures/recepcion_sample.xlsx', import.meta.url),
      names => names.find(n => !n.toLowerCase().includes('preferm') && n.toLowerCase().includes('recep')),
    );
    const hidx = headerRowByDensity(rows);
    assert.ok(hidx >= 0, 'no header row found in Recepción sheet');
    assertHeadersCovered(rows[hidx].map(collapse), keyset(CONFIG.recepcionToSupabase), new Set());
  });

  it('recepcion_sample.xlsx — Prefermentativos sheet', { skip }, () => {
    const rows = sheetRows(
      new URL('fixtures/recepcion_sample.xlsx', import.meta.url),
      names => names.find(n => n.toLowerCase().includes('preferm')),
    );
    const hidx = headerRowByDensity(rows);
    assert.ok(hidx >= 0, 'no header row found in Prefermentativos sheet');
    assertHeadersCovered(rows[hidx].map(collapse), keyset(CONFIG.prefermentToSupabase), new Set());
  });

  // Pre-recepción intentionally-dropped columns (all documented in config.js):
  //   - 'Longitud promedio de 10 bayas (cm)': the per-baya average carries it.
  //   - the two Vendimia-2026 derived-% columns: recomputable from health_*.
  //   - 'Calidad de uva': an empty summary/label banner column, no storage target.
  const PRE_DROP = new Set([
    'Longitud promedio de 10 bayas (cm)',
    '%Bayas Aceptable',
    '%Bayas con enfermedad/picadura',
    'Calidad de uva',
  ]);
  const EVAL_RE = [
    CONFIG.preReceptionEvaluatorHeaders.sanidad,
    CONFIG.preReceptionEvaluatorHeaders.madurez,
  ];

  for (const file of ['prerecepcion_sample.xlsx', 'prerecepcion_2026_sample.xlsx']) {
    it(`${file} — Pre-recepción sheet`, { skip }, () => {
      const lookup = keyset(CONFIG.preReceptionsToSupabase);
      const rows = sheetRows(
        new URL(`fixtures/${file}`, import.meta.url),
        names => names.find(n => n.toLowerCase().replace(/[^a-záéíóúñ]/g, '').includes('prerecep')),
      );
      const hidx = headerRowByScore(rows, lookup);
      assert.ok(hidx >= 0, 'no header row found in Pre-recepción sheet');
      assertHeadersCovered(mergeBannerHeaders(rows, hidx), lookup, PRE_DROP, EVAL_RE);
    });
  }
});

// ── (2) mapping targets vs the committed sql/ schema ────────────────
//
// Builds each table's column set from the committed CREATE TABLE / ALTER TABLE
// ADD COLUMN statements in sql/, so the check is against real committed schema
// rather than an in-test hardcoded list.
function loadCommittedSchema() {
  const dir = new URL('../sql/', import.meta.url);
  const tables = {};
  const add = (t, c) => { (tables[t] ??= new Set()).add(c.toLowerCase()); };
  for (const file of readdirSync(dir).filter(n => n.endsWith('.sql'))) {
    const sql = readFileSync(new URL(file, dir), 'utf8');
    // CREATE TABLE [IF NOT EXISTS] [public.]<name> ( ... );
    const create = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    let m;
    while ((m = create.exec(sql))) {
      const [, table, body] = m;
      for (let line of body.split('\n')) {
        line = line.trim().replace(/,$/, '');
        if (!line || line.startsWith('--')) continue;
        const w = line.match(/^"?([a-z_][a-z0-9_]*)"?\s/i);
        if (!w) continue;
        const col = w[1].toLowerCase();
        if (['primary', 'unique', 'constraint', 'foreign', 'check', 'references'].includes(col)) continue;
        add(table, col);
      }
    }
    // ALTER TABLE [public.]<name> ... ADD COLUMN [IF NOT EXISTS] <col> ... ;
    const alter = /ALTER TABLE\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
    while ((m = alter.exec(sql))) {
      const [, table, segment] = m;
      const addcol = /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?/gi;
      let c;
      while ((c = addcol.exec(segment))) add(table, c[1]);
    }
  }
  return tables;
}

describe('MT.43 — mapping targets exist in the committed sql/ schema', () => {
  // wine_samples.brix is written by three maps but has no committed migration.
  // Confirmed present in prod, so this is fresh-install drift only, tracked by
  // bead xd-ifx. Encoded as a single explicit exception: the equality assert
  // below fails the moment xd-ifx adds the column (the exception must then be
  // deleted) OR a NEW drift appears, so drift can never pass silently.
  const SCHEMA_EXCEPTIONS = new Set(['wine_samples.brix']);
  const TARGET_MAPS = [
    ['wxToSupabase',            Object.values(CONFIG.wxToSupabase),           'wine_samples'],
    ['supabaseToWineJS',        Object.keys(CONFIG.supabaseToWineJS),         'wine_samples'],
    ['supabaseToBerryJS',       Object.keys(CONFIG.supabaseToBerryJS),        'wine_samples'],
    ['wxToBerry',               Object.values(CONFIG.wxToBerry),              'berry_samples'],
    ['recepcionToSupabase',     Object.values(CONFIG.recepcionToSupabase),    'tank_receptions'],
    ['prefermentToSupabase',    Object.values(CONFIG.prefermentToSupabase),   'prefermentativos'],
    ['supabasePrefToWineJS',    Object.keys(CONFIG.supabasePrefToWineJS),     'prefermentativos'],
    ['preReceptionsToSupabase', Object.values(CONFIG.preReceptionsToSupabase), 'mediciones_tecnicas'],
  ];

  it('sanity: the schema parser found the core tables', () => {
    const schema = loadCommittedSchema();
    for (const t of ['wine_samples', 'berry_samples', 'tank_receptions', 'prefermentativos', 'mediciones_tecnicas']) {
      assert.ok((schema[t]?.size ?? 0) > 3, `schema parse found no columns for ${t}`);
    }
  });

  it('every mapping target is a committed column, except the named xd-ifx exception', () => {
    const schema = loadCommittedSchema();
    const missing = new Set();
    for (const [, targets, table] of TARGET_MAPS) {
      const cols = schema[table] || new Set();
      for (const t of new Set(targets)) {
        if (t.startsWith('_')) continue; // _lot1.._lot4 are temp keys, stripped before insert
        if (!cols.has(t)) missing.add(`${table}.${t}`);
      }
    }
    assert.deepEqual([...missing].sort(), [...SCHEMA_EXCEPTIONS].sort());
  });
});
