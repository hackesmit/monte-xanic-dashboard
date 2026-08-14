#!/usr/bin/env node
// Generates sql/migration_dim_catalogs.sql from js/config.js.
//
// Why a generator: the ranch, parcel and variety catalogs are curated in
// config.js and used by the browser only. Power BI, dbt and any external
// vendor writing SQL cannot see them, so every consumer re-invents its own
// spelling of "Monte Xanic (VDG)" and the joins rot. Promoting the catalogs
// into dim_* tables fixes that, but a hand-transcribed seed would drift from
// config.js on the first edit. Generating it means drift is impossible and
// tests/mt43-dim-catalogs.test.mjs proves the checked-in file is current.
//
// config.js stays the source of truth this round. Run after editing any
// catalog in config.js:  node scripts/gen-dim-catalogs.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { CONFIG } from '../js/config.js';

export const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', 'migration_dim_catalogs.sql');

const q = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = v => (v === null || v === undefined || v === '' ? 'NULL' : String(v));

// --- Valleys ---
// Names spelled as the appellation suffix that appears in the data.
const VALLE_NOMBRES = {
  VDG: 'Valle de Guadalupe',
  VON: 'Valle de Ojos Negros',
  SV:  'San Vicente',
  VP:  'Valle de Parras'
};

const coords = CONFIG.valleyCoordinates || {};
export const valles = Object.keys(VALLE_NOMBRES).sort().map(code => ({
  code,
  nombre: VALLE_NOMBRES[code],
  lat: coords[code]?.lat ?? null,
  lon: coords[code]?.lon ?? null
}));

// --- Ranches ---
// The canonical ranch string is what fact rows actually carry in their
// `appellation` column, so it is the join key and therefore the primary key.
// Collected from every place config.js can emit one.
const suffixOf = name => (name.match(/\(([A-Z]{2,3})\)$/) || [])[1] || null;

const ranchNames = new Set();
for (const v of Object.values(CONFIG.appellationFixes || {})) ranchNames.add(v);
for (const v of Object.values(CONFIG._codeToRanch || {})) ranchNames.add(v);
for (const v of Object.values(CONFIG.originAbbr || {})) ranchNames.add(v);
for (const s of CONFIG.vineyardSections || []) ranchNames.add(s.ranch);

export const ranchos = [...ranchNames].filter(Boolean).sort().map(nombre => {
  const valle = suffixOf(nombre);
  if (valle && !VALLE_NOMBRES[valle]) throw new Error(`Unknown valley suffix in ranch "${nombre}"`);
  return { nombre, valle };
});

// --- Ranch synonyms ---
// Every legacy label and sample-code prefix that resolves to a canonical
// ranch. This is the part external consumers need most: it lets SQL redo the
// same normalization the app does, instead of guessing.
const ranchSyn = new Map(); // synonym -> canonical
const addSyn = (syn, canon) => {
  if (!syn || !canon || syn === canon) return;
  const prev = ranchSyn.get(syn);
  if (prev && prev !== canon) throw new Error(`Conflicting ranch synonym "${syn}": ${prev} vs ${canon}`);
  ranchSyn.set(syn, canon);
};
for (const [k, v] of Object.entries(CONFIG.appellationFixes || {})) addSyn(k, v);
for (const [k, v] of Object.entries(CONFIG._codeToRanch || {})) addSyn(k, v);
for (const [k, v] of Object.entries(CONFIG.originAbbr || {})) addSyn(k, v);

export const ranchSinonimos = [...ranchSyn.entries()]
  .filter(([, canon]) => ranchNames.has(canon))
  .sort((a, b) => a[0].localeCompare(b[0], 'es'))
  .map(([sinonimo, rancho]) => ({ sinonimo, rancho }));

// --- Varieties ---
// Canonical set = every full name the abbreviation table can produce, plus
// every colour-keyed varietal, run through normalizeVariety so the Petite
// Sirah to Durif rule is applied exactly once and in one place.
const varietyNames = new Set();
for (const v of Object.values(CONFIG.varietyAbbr || {})) varietyNames.add(CONFIG.normalizeVariety(v));
for (const v of Object.keys(CONFIG.varietyColors || {})) varietyNames.add(CONFIG.normalizeVariety(v));

export const variedades = [...varietyNames].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));

const varSyn = new Map();
for (const [code, name] of Object.entries(CONFIG.varietyAbbr || {})) {
  const canon = CONFIG.normalizeVariety(name);
  if (code !== canon) varSyn.set(code, canon);
}
// Spelling synonyms that normalizeVariety encodes as behaviour, not data.
for (const raw of ['Petite Sirah']) {
  const canon = CONFIG.normalizeVariety(raw);
  if (canon !== raw) varSyn.set(raw, canon);
}
export const variedadSinonimos = [...varSyn.entries()]
  .filter(([, canon]) => varietyNames.has(canon))
  .sort((a, b) => a[0].localeCompare(b[0], 'es'))
  .map(([sinonimo, variedad]) => ({ sinonimo, variedad }));

// --- Parcels ---
// `variedad_plantada` keeps the label exactly as curated, because a parcel can
// carry a two-variety planting ("Cab. Sauv. / Durif") or a nursery block
// ("Plantas Madre") that is not a varietal at all. `variedad` is the resolved
// FK and is NULL for those, which is the honest representation: a blended
// block cannot be attributed to one varietal without a split rule, and no
// split rule exists yet.
export const parcelas = (CONFIG.vineyardSections || [])
  .map(s => {
    const label = s.variety ?? null;
    const canon = label ? CONFIG.normalizeVariety(label) : null;
    return {
      code: s.sectionId,
      rancho: s.ranch,
      etiqueta: s.sectionLabel ?? null,
      variedadPlantada: label,
      variedad: canon && varietyNames.has(canon) ? canon : null,
      hectareas: s.hectares ?? null
    };
  })
  .sort((a, b) => a.code.localeCompare(b.code, 'es'));

for (const p of parcelas) {
  if (!ranchNames.has(p.rancho)) throw new Error(`Parcel ${p.code} references unknown ranch "${p.rancho}"`);
}
const dupes = parcelas.map(p => p.code).filter((c, i, a) => a.indexOf(c) !== i);
if (dupes.length) throw new Error(`Duplicate parcel codes: ${dupes.join(', ')}`);

// --- Emit ---
const values = (rows, fn) => rows.map(fn).join(',\n');

export const buildSql = () => `-- ==================================================================
-- migration_dim_catalogs
--
-- Conformed reference dimensions for Monte Xanic: valley, ranch, parcel and
-- varietal, plus the synonym tables that let SQL reproduce the same
-- normalization the dashboard performs in js/config.js.
--
-- Purpose: revenue and field cost can only be combined into margin if both
-- sides key on the same catalogs. Until now these catalogs existed only in
-- browser JavaScript, so Power BI, dbt and any external vendor had no way to
-- join on them. Additive migration: no existing table is altered and no
-- current read path depends on these tables yet.
--
-- GENERATED FILE. Do not edit by hand.
--   Source:    js/config.js
--   Generator: scripts/gen-dim-catalogs.mjs
--   Guard:     tests/mt43-dim-catalogs.test.mjs fails if this file drifts.
--
-- Idempotent and transactional: safe to re-run.
-- ==================================================================

BEGIN;

-- --- dim_valle ---
CREATE TABLE IF NOT EXISTS public.dim_valle (
  valle_code   TEXT PRIMARY KEY,
  valle_nombre TEXT NOT NULL,
  lat          NUMERIC,
  lon          NUMERIC
);
COMMENT ON TABLE public.dim_valle IS
  'Valles vitivinicolas. lat/lon solo para los valles con serie meteorologica.';

INSERT INTO public.dim_valle (valle_code, valle_nombre, lat, lon) VALUES
${values(valles, v => `  (${q(v.code)}, ${q(v.nombre)}, ${n(v.lat)}, ${n(v.lon)})`)}
ON CONFLICT (valle_code) DO UPDATE
  SET valle_nombre = EXCLUDED.valle_nombre,
      lat          = EXCLUDED.lat,
      lon          = EXCLUDED.lon;

-- --- dim_rancho ---
-- La llave es el nombre canonico en formato rancho-primero, porque es el
-- valor que las tablas de hechos ya guardan en su columna appellation.
CREATE TABLE IF NOT EXISTS public.dim_rancho (
  rancho       TEXT PRIMARY KEY,
  valle_code   TEXT REFERENCES public.dim_valle(valle_code)
);
COMMENT ON COLUMN public.dim_rancho.valle_code IS
  'NULL cuando el origen no pertenece a un valle catalogado (p. ej. California).';

INSERT INTO public.dim_rancho (rancho, valle_code) VALUES
${values(ranchos, r => `  (${q(r.nombre)}, ${q(r.valle)})`)}
ON CONFLICT (rancho) DO UPDATE SET valle_code = EXCLUDED.valle_code;

-- --- dim_rancho_sinonimo ---
-- Etiquetas historicas y prefijos de codigo de muestra que resuelven a un
-- rancho canonico. Permite que un consumidor SQL repita la normalizacion.
CREATE TABLE IF NOT EXISTS public.dim_rancho_sinonimo (
  sinonimo TEXT PRIMARY KEY,
  rancho   TEXT NOT NULL REFERENCES public.dim_rancho(rancho)
);

INSERT INTO public.dim_rancho_sinonimo (sinonimo, rancho) VALUES
${values(ranchSinonimos, s => `  (${q(s.sinonimo)}, ${q(s.rancho)})`)}
ON CONFLICT (sinonimo) DO UPDATE SET rancho = EXCLUDED.rancho;

-- --- dim_variedad ---
CREATE TABLE IF NOT EXISTS public.dim_variedad (
  variedad TEXT PRIMARY KEY
);

INSERT INTO public.dim_variedad (variedad) VALUES
${values(variedades, v => `  (${q(v)})`)}
ON CONFLICT (variedad) DO NOTHING;

-- --- dim_variedad_sinonimo ---
-- Abreviaturas de codigo de muestra y sinonimos de nombre (Petite Sirah es
-- Durif). Misma funcion que dim_rancho_sinonimo, para varietales.
CREATE TABLE IF NOT EXISTS public.dim_variedad_sinonimo (
  sinonimo TEXT PRIMARY KEY,
  variedad TEXT NOT NULL REFERENCES public.dim_variedad(variedad)
);

INSERT INTO public.dim_variedad_sinonimo (sinonimo, variedad) VALUES
${values(variedadSinonimos, s => `  (${q(s.sinonimo)}, ${q(s.variedad)})`)}
ON CONFLICT (sinonimo) DO UPDATE SET variedad = EXCLUDED.variedad;

-- --- dim_parcela ---
-- variedad_plantada conserva la etiqueta curada tal cual; variedad es la
-- resolucion a catalogo y queda NULL en bloques mixtos o de plantas madre,
-- porque repartir un bloque mixto entre varietales exige una regla de
-- prorrateo que todavia no existe.
CREATE TABLE IF NOT EXISTS public.dim_parcela (
  parcela_code      TEXT PRIMARY KEY,
  rancho            TEXT NOT NULL REFERENCES public.dim_rancho(rancho),
  etiqueta          TEXT,
  variedad_plantada TEXT,
  variedad          TEXT REFERENCES public.dim_variedad(variedad),
  hectareas         NUMERIC
);
COMMENT ON COLUMN public.dim_parcela.variedad IS
  'NULL en bloques mixtos (dos varietales) y en Plantas Madre.';

INSERT INTO public.dim_parcela (parcela_code, rancho, etiqueta, variedad_plantada, variedad, hectareas) VALUES
${values(parcelas, p => `  (${q(p.code)}, ${q(p.rancho)}, ${q(p.etiqueta)}, ${q(p.variedadPlantada)}, ${q(p.variedad)}, ${n(p.hectareas)})`)}
ON CONFLICT (parcela_code) DO UPDATE
  SET rancho            = EXCLUDED.rancho,
      etiqueta          = EXCLUDED.etiqueta,
      variedad_plantada = EXCLUDED.variedad_plantada,
      variedad          = EXCLUDED.variedad,
      hectareas         = EXCLUDED.hectareas;

CREATE INDEX IF NOT EXISTS dim_parcela_rancho_idx   ON public.dim_parcela (rancho);
CREATE INDEX IF NOT EXISTS dim_parcela_variedad_idx ON public.dim_parcela (variedad);
CREATE INDEX IF NOT EXISTS dim_rancho_valle_idx     ON public.dim_rancho (valle_code);

-- --- Lectura publica, escritura cerrada ---
-- Catalogos de referencia: se leen desde el dashboard con la llave anon y
-- solo se modifican corriendo esta migracion.
ALTER TABLE public.dim_valle             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_rancho            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_rancho_sinonimo   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_variedad          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_variedad_sinonimo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_parcela           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dim_valle_read             ON public.dim_valle;
DROP POLICY IF EXISTS dim_rancho_read            ON public.dim_rancho;
DROP POLICY IF EXISTS dim_rancho_sinonimo_read   ON public.dim_rancho_sinonimo;
DROP POLICY IF EXISTS dim_variedad_read          ON public.dim_variedad;
DROP POLICY IF EXISTS dim_variedad_sinonimo_read ON public.dim_variedad_sinonimo;
DROP POLICY IF EXISTS dim_parcela_read           ON public.dim_parcela;

CREATE POLICY dim_valle_read             ON public.dim_valle             FOR SELECT USING (true);
CREATE POLICY dim_rancho_read            ON public.dim_rancho            FOR SELECT USING (true);
CREATE POLICY dim_rancho_sinonimo_read   ON public.dim_rancho_sinonimo   FOR SELECT USING (true);
CREATE POLICY dim_variedad_read          ON public.dim_variedad          FOR SELECT USING (true);
CREATE POLICY dim_variedad_sinonimo_read ON public.dim_variedad_sinonimo FOR SELECT USING (true);
CREATE POLICY dim_parcela_read           ON public.dim_parcela           FOR SELECT USING (true);

INSERT INTO public.applied_migrations (name) VALUES ('migration_dim_catalogs')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
`;

// Importing this module is side-effect free so the parity test can rebuild the
// SQL in memory and compare. Only a direct `node scripts/gen-dim-catalogs.mjs`
// rewrites the file.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  writeFileSync(OUT, buildSql(), 'utf8');

  const withHa = parcelas.filter(p => p.hectareas != null);
  const ha = withHa.reduce((s, p) => s + Number(p.hectareas), 0);
  process.stdout.write(
    `wrote ${OUT}\n` +
    `  valles              ${valles.length}\n` +
    `  ranchos             ${ranchos.length} (${ranchos.filter(r => !r.valle).length} sin valle)\n` +
    `  rancho sinonimos    ${ranchSinonimos.length}\n` +
    `  variedades          ${variedades.length}\n` +
    `  variedad sinonimos  ${variedadSinonimos.length}\n` +
    `  parcelas            ${parcelas.length} (${parcelas.filter(p => !p.variedad).length} sin varietal resuelto)\n` +
    `  hectareas           ${ha.toFixed(2)} en ${withHa.length} parcelas, ${parcelas.length - withHa.length} sin superficie\n`
  );
}
