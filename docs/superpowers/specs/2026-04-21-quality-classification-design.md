# Design — Quality Classification & True Quality Map (F9)

**Date:** 2026-04-21
**Author:** Planner
**Status:** Draft — pending user review
**Phase:** 9 (Stage 4, formerly bookmarked as F9 in TASK.md)
**Reference inputs:** `Clasificación Calidad Uva Revisión SL.xlsx` (tracked in git at repo root, commit `660de79`)

---

## 1. Goal

Turn the vineyard quality map into a **true quality map**. Every berry lot is graded against the Monte Xanic rubric encoded in the classification xlsx, producing an `A+ / A / B / C` letter grade plus a 0–36 numeric score. Lot grades are aggregated to section level for map rendering. Existing `Brix / pH / A.T. / tANT` metric views stay as selectable alternates. Lots are additionally ranked as percentiles within a configurable cohort for cross-lot comparison.

## 2. Non-goals

- No change to the existing SVG section polygons or geometry.
- No Leaflet / satellite map work (that remains F7, Stage 3 — separate spec).
- No automated import of winemaker tasting notes from external systems.
- No historical back-fill pass on pre-2025 vintages in this spec. The engine must work on any year; we validate on 2025 data.
- No integration with the "monovarietal vs mix" axis originally drafted for F9 — superseded by this quality grading.
- No change to upload pipeline parsing or file formats.

## 3. Scoring engine

**Module:** `js/classification.js` (new). Pure functions. No DOM access, no network calls, no module-level side effects. Takes plain JS objects in, returns plain JS objects out — testable without a browser.

### 3.1 Base rubric (100 Imp-weighted units)

| Category         | Parameter              | Source field                                        | Imp  |
|------------------|------------------------|-----------------------------------------------------|------|
| Fisicoquímico    | Brix                   | `berry.brix`                                        | 4    |
|                  | pH                     | `berry.pH`                                          | 12   |
|                  | Acidez total           | `berry.ta`                                          | 9    |
| Sanidad          | Acidez volátil         | `berry.av`                                          | 13   |
|                  | Ácido glucónico        | `berry.ag`                                          | 13   |
|                  | Estado sanitario — %   | derived from `medicion.health_*` counts             | 2    |
|                  | Estado sanitario — vis | `medicion.health_grade`                             | 2    |
| Rendimiento      | Peso de baya           | `berry.berryFW`                                     | 5    |
| Fenólico         | Polifenoles            | `berry.polyphenols`                                 | 20   |
|                  | Antocianos             | `berry.anthocyanins`                                | 20   |

Total base Imp = 100. Each parameter assigns 1, 2, or 3 pts depending on which threshold bucket the value falls in (per the rubric for the lot's variety group and valley). Raw score = Σ (pts × Imp), range 100–300.

### 3.2 Madurez fenólica overlay (winemaker-assessed)

Not part of the 100-base. Applied as a final adjustment:

| Assessment         | Adjustment (36 axis) |
|--------------------|----------------------|
| Sobresaliente      | +3                   |
| Parcial            |  0                   |
| No sobresaliente   | −3                   |
| *(null / unset)*   |  0                   |

### 3.3 Final score and grade

```
raw     = Σ (pts_p × imp_p)                    // 100..300 when all inputs present
base    = raw / 300 * 36                       // 12..36 (12 = all-C, 36 = all-A+)
score36 = clamp(base + madurezAdj, 0, 36)
grade   = score36 >= 30 ? 'A+'
        : score36 >= 27 ? 'A'
        : score36 >= 23 ? 'B'
        :                 'C'
```

`score36` is the field name returned by `scoreLot()` (see §4.2).

With partial data the denominator is `3 × Σ imp_present` instead of the full `300`, keeping the 12–36 scale consistent as long as `Σ imp_present ≥ 60` (see §3.7).

### 3.4 Sanitary conteo derivation

```
unhealthy = health_picadura + health_enfermedad + health_quemadura
total     = health_madura + health_inmadura + health_sobremadura
          + health_picadura + health_enfermedad + health_quemadura
pct       = total > 0 ? (unhealthy / total * 100) : null
// pct ≤ 0.5  → 3 pts (A)
// 0.5 < pct ≤ 2 → 2 pts (B)
// pct > 2    → 1 pt  (C)
// pct null   → parameter flagged missing; Imp=2 dropped from denominator
```

### 3.5 Visual health mapping

Mediciones uses a 4-tier `health_grade`; the rubric is 3-tier. Mapping:

| `health_grade` | Rubric equivalent       | Pts |
|----------------|-------------------------|-----|
| `Excelente`    | Limpio                  | 3   |
| `Bueno`        | Limpio                  | 3   |
| `Regular`      | Parcialmente limpio     | 2   |
| `Malo`         | Contaminado             | 1   |
| *(null)*       | missing                 | —   |

### 3.6 Variety-group × valley → rubric key

Each variety + valley combo maps to one rubric set. These are defined once in `CONFIG.varietyRubricMap` and `CONFIG.rubrics`:

| rubricId                        | Varieties                                             | Valleys                 |
|---------------------------------|-------------------------------------------------------|-------------------------|
| `PV-DUR-VON`                    | Petit Verdot, Durif                                   | Valle de Ojos Negros    |
| `CS-SY-MAL-MRS-TEM-VON`         | Cabernet Sauvignon, Syrah, Malbec, Marselan, Tempranillo | Valle de Ojos Negros |
| `CS-SY-VDG`                     | Cabernet Sauvignon, Syrah                             | Valle de Guadalupe      |
| `MER-CF-GRE-CALADOC-VON`        | Merlot, Cabernet Franc, Grenache, Caladoc             | Valle de Ojos Negros    |
| `GRE-CALADOC-VDG-VSV`           | Grenache, Caladoc                                     | Valle de Guadalupe / Valle de San Vicente |
| `SB-VDG-VON`                    | Sauvignon Blanc                                       | Valle de Guadalupe / Valle de Ojos Negros |
| `CH-CB-SBGR-VDG-VON`            | Chardonnay, Chenin Blanc, Sauvignon Blanc (Gran Ricardo) | Valle de Guadalupe / Valle de Ojos Negros |

An unknown `(variety, valley)` combo yields `rubricId: null`. The scoring function returns `{ grade: null, score36: null, reason: 'Sin rúbrica' }` — no silent fallback. The map renders those sections neutral gray.

### 3.7 Partial-data behavior

If a parameter's source field is `null`, it drops from both numerator and denominator. The raw scale adjusts to the remaining Imp sum, still scaled to 36. The returned object carries `missing: ['ag', 'anthocyanins']` so the UI can badge partial scores. A lot is considered unscorable (returns `grade: null`) only when the total available Imp falls below 60 (i.e., less than 60% of inputs present).

## 4. Data pipeline

All reads stay in `dataLoader.js` per CLAUDE.md boundaries.

### 4.1 Join

New method `DataStore.joinBerryWithMediciones()`:

- Builds a map keyed on `(lot_code, vintage_year)` from `mediciones_tecnicas`.
- For each row in `berry_samples`, looks up the medicion by `(lotCode, vintage_year)` and attaches it as `berry.medicion = { health_grade, health_madura, …, phenolic_maturity } | null`.
- Runs once on initial load and after any upload. Result cached on `DataStore.enrichedBerry`.

No join-time filtering — unmatched berry rows are still returned with `medicion: null`.

### 4.2 Scoring call path

- `Classification.scoreLot(lot)` — synchronous, returns `{ grade, score36, rubricId, missing, reason }`.
- `Classification.scoreAll(lots, options)` — maps `scoreLot` over all lots, then computes `percentile` per lot within the cohort defined by `options.cohort` (see §7). Returns the same objects with `percentile` and `percentileCohort` added.

Callers: `maps.js` (for section color + tooltip), `mediciones.js` (for per-lot badge in the table, if trivial), `tables.js` (if we decide to surface grade as a column — flagged as optional in §10).

## 5. Map UX

### 5.1 Metric selector

`#map-metric-select` in `index.html` gets a new first option:

```html
<option value="calidad">Calidad (Clasificación)</option>
<option value="brix">Brix (°Bx)</option>
<option value="pH">pH</option>
<option value="ta">A.T. (g/L)</option>
<option value="tANT">tANT (ppm)</option>
```

The existing four options are unchanged in behavior. `Calidad` becomes the new default.

### 5.2 Section rendering with `metric === 'calidad'`

- Section color = discrete color by tonnage-weighted average of lot `score36` values, then bucketed:

| Bucket            | Hex       | Notes                              |
|-------------------|-----------|------------------------------------|
| A+                | `#1a7f3e` | Deep green                         |
| A                 | `#7ac74f` | Green                              |
| B                 | `#f5c542` | Gold                               |
| C                 | `#d94a3d` | Red                                |
| Sin clasificar    | `#6b6b6b` | Neutral gray; shown in legend only if present in vintage |

- Weighted average: `Σ (score36_lot × tons_lot) / Σ tons_lot`. Lots without `tons_received` use 1 as the weight (so they still contribute). Lots with `grade: null` are excluded from both numerator and denominator; if all lots in a section are null, the section renders gray.
- Legend swaps from the gradient bar to four discrete swatches (+ the gray swatch when applicable).
- `getColor(value, metricKey)` gains a `metricKey === 'calidad'` branch that ignores the min/max gradient logic.

### 5.3 Tooltip and detail panel

Tooltip (hover):

```
MX-5B — Cabernet Sauvignon
Grado: A (28.4 / 36) — 3 lotes
  • CSMX-5B-1   A+  31.2
  • CSMX-5B-2   A   27.9
  • CSMX-5B-3   B   24.1
```

Detail panel (click) gains a new row above the existing `Muestras/Brix/pH/…` block:

```
Clasificación:  A  (28.4 / 36)
Cohorte:        CS 2025  ·  Percentil 74
                [Ver desglose por lote]
```

"Ver desglose por lote" expands to a list showing each lot's grade plus per-param A/B/C chips derived from `scoreLot().buckets`. The existing lots list already renders in the panel; we extend it with grade + score columns.

### 5.4 Other metrics (`brix / pH / ta / tANT`)

Identical to today. The `calidad` branch is purely additive — zero regression path.

## 6. Default map view

`Calidad` is the new default when the user lands on the map view without prior state. State is still persisted via the existing selector; returning users see their last pick. First-time open after deploy: `Calidad`.

## 7. Percentile ranking

### 7.1 Placement

Percentile is **not** a separate map-level metric. It is rendered only in the detail panel and in the tooltip's per-lot breakdown.

### 7.2 Default cohort

- Same variety (normalized via `CONFIG.varietyNormalization`)
- Same vintage
- All ranches / all valleys
- Formula: lot's rank among cohort peers on `score36`, expressed as 0–100. Ties share the higher percentile.
- Label format: `Percentil 74` on the detail panel; tooltip omits the percentile (room constraint).

### 7.3 Cohort toggle

A small select in the detail panel lets the winemaker switch cohort:

- `Misma variedad · Misma añada` (default)
- `Misma variedad · Todas las añadas` (historical; requires ≥ 2 vintages of data, else disabled)

## 8. Madurez fenólica input

Smallest viable surface: one new column on `mediciones_tecnicas`, entered via the existing mediciones form.

### 8.1 Schema migration

`sql/migration_phenolic_maturity.sql` (new):

```sql
ALTER TABLE mediciones_tecnicas
  ADD COLUMN IF NOT EXISTS phenolic_maturity TEXT
  CHECK (phenolic_maturity IN ('Sobresaliente','Parcial','No sobresaliente'));
```

Nullable. Legacy rows keep `NULL`, which the scoring engine treats as `0` adjustment.

### 8.2 Mediciones form

A new optional field `Madurez fenólica (opcional)` in `mediciones.js` form — a `<select>` with empty / Sobresaliente / Parcial / No sobresaliente. Submits along with the rest of the form. The existing mediciones table view gets a new column showing the value (short: `Sobr.` / `Parc.` / `No sobr.` / `—`).

### 8.3 Out of scope for this spec

- No bulk-edit UI for already-imported lots.
- No separate Madurez dashboard.
- No import from the xlsx's `PRERECEPCIÓN 2025` / `RECEPCIÓN 2025` sheets.

## 9. File responsibilities

Respects CLAUDE.md file boundaries. Every change is additive except the `maps.js` `getColor` branch and the `mediciones.js` form addition.

| File                                          | Change                                                                 |
|-----------------------------------------------|------------------------------------------------------------------------|
| `js/classification.js` (new)                  | Scoring engine. Pure functions. ~200 LOC.                              |
| `js/config.js`                                | Add `CONFIG.rubrics` (threshold tables) and `CONFIG.varietyRubricMap`. |
| `js/dataLoader.js`                            | Add `joinBerryWithMediciones()` + `DataStore.enrichedBerry` cache.     |
| `js/maps.js`                                  | `calidad` branch in `getColor()`, new tooltip markup, new detail-panel row, legend swap. Calls `Classification` — no scoring logic lives here. |
| `js/mediciones.js`                            | Add `phenolic_maturity` select to form, new column in table view.      |
| `index.html`                                  | Add `<option value="calidad">` to `#map-metric-select`.                |
| `css/styles.css`                              | Discrete-swatch legend styles; grade color variables.                  |
| `sql/migration_phenolic_maturity.sql` (new)   | `ALTER TABLE mediciones_tecnicas ADD COLUMN phenolic_maturity ...`.    |
| `tests/mt11-classification.test.mjs` (new)    | MT.11 unit suite. Targets: threshold bucketing per rubric, weighted sum, grade cutoff, partial-data handling, unknown variety, percentile calculation, tie behavior. ~30 cases. |

## 10. Testing

### 10.1 Unit (MT.11)

- Every rubric / param combo hits its bucket boundaries (both edges).
- Raw → base36 → final math preserves bucket cutoffs.
- Madurez overlay: ±3 shift crosses one bucket boundary only.
- Partial data: dropping `ag` + `anthocyanins` scales the denominator correctly.
- Partial-data threshold: a lot with < 60 Imp available returns `grade: null`.
- Unknown `(variety, valley)` → `{ grade: null, reason: 'Sin rúbrica' }`.
- Sanitary `conteo %` derivation (zero totals, all-healthy, all-picadura).
- Visual `health_grade` → pts mapping (4-tier → 3-tier).
- Percentile: equal-spacing for 10-lot cohort, ties at boundary, single-lot cohort (= percentile 100).
- Weighted-by-tonnage section aggregation.

### 10.2 Manual browser check

- Load dashboard on 2025 data; confirm map renders with `Calidad` by default and the four grade buckets paint correctly.
- Switch to `Brix` → no regression.
- Click into a section with mixed-grade lots; confirm the tooltip + detail panel show per-lot grades and the cohort percentile.
- Add a new mediciones record with `Madurez fenólica = Sobresaliente`; confirm the lot's grade shifts by +3 and the grade bucket recalculates.
- Verify a lot with unknown variety/valley renders neutral gray in the section (not a false grade).

### 10.3 No e2e addition

The existing `tests/e2e/mobile-responsive.spec.js` does not need an update — quality rendering doesn't change layout. A follow-up spec could verify tooltip rendering at mobile width; flagged as optional.

## 11. Deferred / explicit non-scope

- Historical back-fill scoring and multi-vintage percentile tuning beyond the 2-vintage minimum.
- Winemaker bulk-entry UI for Madurez on already-imported lots (today requires one-at-a-time edits via the existing mediciones form).
- Exporting the grade breakdown as part of "Exportar Vista" (PNG / PDF).
- A grade column on the main data tables (berry / wine recepción / extracción). Decision deferred until the map view has been in use for one vintage.
- Monovarietal vs mix classification (originally F9). This spec supersedes that axis.

## 12. Risks and assumptions

| # | Item                                           | Call                                                                                     |
|---|------------------------------------------------|------------------------------------------------------------------------------------------|
| 1 | Madurez on 36 axis (not Imp × 3 = 60 raw)      | Xlsx says "Sobresaliente (3 pts)" on the same 36-pt axis as the bucket cutoffs. Safer.   |
| 2 | Visual `Bueno` → 3 pts (not 2)                 | Collapses 4-tier → 3-tier. If winemakers draw a sharper line at Bueno, we flip to 2.     |
| 3 | Percentile default = current vintage only      | Historical cohort requires stable data across years; 2026 has only one full year so far. |
| 4 | Tonnage weight falls back to 1 if missing      | Prevents silent drop of lots lacking `tons_received`.                                    |
| 5 | Default metric = `Calidad`                     | The explicit request is "make the map a true quality map," so this matches intent.        |
| 6 | Partial-data threshold at 60 Imp               | Arbitrary. Tests pin the behavior so regression is visible if we retune.                 |
| 7 | `rubricId` derivation at config-edit time      | If a new variety is planted, the code renders gray until `varietyRubricMap` is updated.  |
| 8 | Valley lookup reads `appellation`              | Depends on `CONFIG.appellationNormalization` — already canonical.                        |

## 13. Acceptance criteria

1. Loading the map at `/` on 2025 data defaults to `Calidad` and renders every section with a grade color or neutral gray.
2. Hovering a section shows aggregate grade, score, lot count, and per-lot grade list.
3. Clicking into a section shows the grade row above the chem metrics and the cohort percentile.
4. Switching to `Brix / pH / ta / tANT` produces today's behavior unchanged.
5. Adding a mediciones record with `Madurez fenólica = Sobresaliente` moves at least one boundary-of-bucket lot across its grade line.
6. `npm test` passes with ≥ 170 tests (adding MT.11).
7. `npm run test:e2e` still passes 12/12.
8. `vite build` produces output with no size regression > 20 KB.
