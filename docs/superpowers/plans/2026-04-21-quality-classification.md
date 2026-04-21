# Quality Classification & True Quality Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every berry lot against the Monte Xanic quality rubric, render lot grades on the vineyard map (weighted-by-tonnage per section), and keep Brix/pH/AT/tANT views as selectable alternates.

**Architecture:** Pure scoring engine (`js/classification.js`) is TDD-first, fed by a new `DataStore.joinBerryWithMediciones()` that enriches berry rows with sanitary data. `maps.js` gains a `calidad` metric branch that calls the engine and renders discrete A+/A/B/C color buckets. Madurez fenólica is a new nullable column on `mediciones_tecnicas` entered via the existing mediciones form.

**Tech Stack:** Vanilla JS ES modules (Vite), `node:test` for unit tests, Supabase (PostgreSQL), Chart.js, SVG.

**Spec:** `docs/superpowers/specs/2026-04-21-quality-classification-design.md` (commit `36cd203`)

**Completion target:**
- `npm test` passes ≥ 170 tests (adds MT.11, ~30 cases)
- `npm run test:e2e` still 12/12
- `vite build` succeeds with bundle size delta < 20 KB
- Map loads with `Calidad` default and renders A+/A/B/C buckets for 2025 data

---

## File Structure

| File | Responsibility | Kind |
|---|---|---|
| `js/classification.js` | Pure scoring engine. `scoreLot(lot) → {grade, score36, rubricId, missing, reason}`. Percentile calc. No DOM, no queries. | New |
| `js/config.js` | Add `CONFIG.rubrics` (7 rubrics), `CONFIG.varietyRubricMap`, `CONFIG.gradeColors`. Data-only addition. | Modify |
| `js/dataLoader.js` | Add `DataStore.joinBerryWithMediciones()` + `enrichedBerry` cache. | Modify |
| `js/maps.js` | Add `calidad` branch in `getColor()`, tooltip grade list, detail-panel grade row + percentile, legend swap. | Modify |
| `js/mediciones.js` | Add `phenolic_maturity` `<select>` to form; surface value in mediciones table. | Modify |
| `index.html` | Add `<option value="calidad">` at top of `#map-metric-select`. Add `<select>` for Madurez in mediciones form. | Modify |
| `css/styles.css` | Grade color CSS variables + discrete-swatch legend styles. | Modify |
| `sql/migration_phenolic_maturity.sql` | `ALTER TABLE mediciones_tecnicas ADD COLUMN phenolic_maturity …`. | New |
| `tests/mt11-classification.test.mjs` | MT.11 — ~30 unit cases: bucketing, weighted sum, cutoffs, partial data, unknown variety, percentile, peso overrides. | New |

CLAUDE.md file-boundary reminders:
- `classification.js` is pure — no reads from Supabase, no DOM. It takes plain objects.
- All Supabase queries stay in `dataLoader.js`.
- `maps.js` renders — it does not score. It calls `Classification.scoreAll()`.

---

## Task 1: SQL Migration — `phenolic_maturity` Column

**Files:**
- Create: `sql/migration_phenolic_maturity.sql`

- [ ] **Step 1: Create migration file**

```sql
-- sql/migration_phenolic_maturity.sql
-- Adds optional winemaker-assessed phenolic maturity tier to mediciones_tecnicas.
-- Applied to the quality classification engine as a ±3 overlay on the 36-pt score.
-- NULL means "not assessed" and is treated as 0 adjustment by Classification.scoreLot().

ALTER TABLE mediciones_tecnicas
  ADD COLUMN IF NOT EXISTS phenolic_maturity TEXT
  CHECK (phenolic_maturity IN ('Sobresaliente','Parcial','No sobresaliente'));
```

- [ ] **Step 2: Apply migration to Supabase**

Run in the Supabase SQL editor (do NOT execute locally without confirmed DB target). Verify no error. Re-running is a no-op because of `IF NOT EXISTS`.

- [ ] **Step 3: Commit**

```bash
git add sql/migration_phenolic_maturity.sql
git commit -m "feat(sql): add phenolic_maturity column to mediciones_tecnicas

Winemaker-assessed phenolic maturity tier. Nullable. Consumed by the
quality classification engine as a +3/0/-3 overlay on the 36-pt score."
```

---

## Task 2: Rubric Config — `CONFIG.rubrics` and `CONFIG.varietyRubricMap`

**Files:**
- Modify: `js/config.js` (append after `mapMetrics`, around line 649)

Rubrics encode the A/B/C thresholds per parameter for each variety+valley group. Seven rubrics total. `peso_overrides` handles Tempranillo / Syrah / Grenache / Caladoc which have variety-specific peso-de-baya ranges within their group.

### Threshold encoding conventions

```
kind: 'le-a-le-b'  → value ≤ a → A (3pts); a < value ≤ b → B (2pts); value > b → C (1pt)
kind: 'ge-a-ge-b'  → value ≥ a → A; b ≤ value < a → B; value < b → C
kind: 'range'      → value in a_range → A;
                     value in any b_range → B;
                     else C
                     a_range = [lo, hi] (inclusive both ends)
                     b_ranges = [[lo, hi], [lo, hi], ...]
kind: 'sanitary-pct' → derived; same thresholds for all rubrics
kind: 'visual'       → derived from health_grade; same for all rubrics
```

- [ ] **Step 1: Add the rubric data**

Insert after the `mapMetrics` block in `js/config.js`:

```javascript
  // ── Grade color tokens (used by maps.js and legend) ─────────────────────
  gradeColors: {
    'A+': '#1a7f3e',
    'A':  '#7ac74f',
    'B':  '#f5c542',
    'C':  '#d94a3d',
    null: '#6b6b6b'   // "Sin clasificar"
  },

  // ── Quality rubrics ─────────────────────────────────────────────────────
  // Each rubric defines thresholds per parameter for one variety-group + valley.
  // Params not listed (sanitary-pct, visual, madurez) are derived identically
  // across all rubrics — logic lives in classification.js, not here.
  rubrics: {
    'PV-DUR-VON': {
      name: 'Petit Verdot y Durif — Valle de Ojos Negros',
      params: {
        brix:         { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.67, b: 3.80, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 2800, b: 2000, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 1000, b: 800, imp: 20 }
      }
    },

    'CS-SY-MAL-MRS-TEM-VON': {
      name: 'Cabernet Sauvignon, Syrah, Malbec, Marselan, Tempranillo — Valle de Ojos Negros',
      params: {
        brix:         { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.67, b: 3.80, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 1900, b: 1500, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700, imp: 20 }
      },
      peso_overrides: {
        // Tempranillo has a larger desirable berry — rubric annotation "1.3-1.5 Temp"
        'Tempranillo': { kind: 'range', a: [1.3, 1.5], b: [[1.0, 1.2],[1.51, 1.7]], imp: 5 }
      }
    },

    'CS-SY-VDG': {
      name: 'Cabernet Sauvignon, Syrah — Valle de Guadalupe',
      params: {
        brix:         { kind: 'range', a: [23.8, 24.5], b: [[22.1, 23.8],[24.6, 25.9]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.60, b: 3.73, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 2100, b: 1600, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 800, b: 600, imp: 20 }
      },
      peso_overrides: {
        // Rubric annotation "*1.2-1.4 Syrah"
        'Syrah': { kind: 'range', a: [1.2, 1.4], b: [[1.1, 1.2],[1.4, 1.5]], imp: 5 }
      }
    },

    'MER-CF-GRE-CALADOC-VON': {
      name: 'Merlot, Cabernet Franc, Grenache, Caladoc — Valle de Ojos Negros',
      params: {
        brix:         { kind: 'range', a: [22.8, 23.5], b: [[22.0, 22.7],[23.7, 24.4]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.67, b: 3.80, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 1500, b: 1200, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 900, b: 600, imp: 20 }
      },
      peso_overrides: {
        'Caladoc':  { kind: 'range', a: [1.3, 1.5], b: [[1.0, 1.19],[1.51, 1.7]], imp: 5 },
        'Grenache': { kind: 'range', a: [1.3, 1.5], b: [[1.0, 1.19],[1.51, 1.7]], imp: 5 }
      }
    },

    'GRE-CALADOC-VDG-VSV': {
      name: 'Grenache, Caladoc — Valle de Guadalupe / Valle de San Vicente',
      params: {
        brix:         { kind: 'range', a: [23.0, 23.7], b: [[22.1, 22.9],[23.8, 24.5]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.60, b: 3.73, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 1800, b: 1400, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 650, b: 450, imp: 20 }
      }
    },

    'SB-VDG-VON': {
      name: 'Sauvignon Blanc — Valle de Guadalupe / Valle de Ojos Negros',
      // Whites have a different Imp distribution than reds (95 base, not 100).
      // Engine normalizes via (3 * Σ imp_present); no special-case needed.
      params: {
        brix:         { kind: 'range', a: [19.0, 23.0], b: [[18.0, 19.0],[23.0, 24.5]], imp: 10 },
        pH:           { kind: 'le-a-le-b', a: 3.20, b: 3.40, imp: 20 },
        ta:           { kind: 'ge-a-ge-b', a: 6.60, b: 5.55, imp: 15 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 20 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 20 },
        berryFW:      { kind: 'range', a: [1.1, 1.35], b: [[0.95, 1.09],[1.36, 1.44]], imp: 5 }
        // polyphenols / anthocyanins not scored for whites
      },
      visualImp: 3   // whites weight visual 3, not 2
    },

    'CH-CB-SBGR-VDG-VON': {
      name: 'Chardonnay, Chenin Blanc, Sauvignon Blanc (Gran Ricardo) — VDG / VON',
      params: {
        brix:         { kind: 'range', a: [22.5, 23.5], b: [[21.5, 22.4],[23.6, 24.5]], imp: 10 },
        pH:           { kind: 'le-a-le-b', a: 3.35, b: 3.50, imp: 20 },
        ta:           { kind: 'ge-a-ge-b', a: 6.60, b: 5.55, imp: 15 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 20 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 20 },
        berryFW:      { kind: 'ge-a-ge-b', a: 1.4, b: 1.0, imp: 5 }
      },
      visualImp: 3
    }
  },

  // ── Global sanitary / visual scoring (same for all rubrics) ─────────────
  sanitaryThresholds: {
    // pct of unhealthy (picadura+enfermedad+quemadura) / total
    pct: { a: 0.5, b: 2.0 },          // ≤0.5 → A, 0.5 < pct ≤ 2 → B, > 2 → C
    visual: {                         // health_grade → pts
      'Excelente': 3,
      'Bueno':     3,
      'Regular':   2,
      'Malo':      1
    },
    defaultConteoImp: 2,              // 2 for reds, not overridden
    defaultVisualImp: 2               // overridden to 3 by whites via rubric.visualImp
  },

  // ── Madurez fenólica overlay (winemaker input on mediciones) ────────────
  madurezOverlay: {
    'Sobresaliente':  +3,
    'Parcial':         0,
    'No sobresaliente': -3
    // null / undefined → 0
  },

  // ── Variety × Valley → rubric ID lookup ─────────────────────────────────
  // Valley is derived from appellation (see resolveValley in classification.js).
  // Unknown combinations return null → "Sin rúbrica".
  varietyRubricMap: {
    'Valle de Ojos Negros': {
      'Petit Verdot':       'PV-DUR-VON',
      'Durif':              'PV-DUR-VON',
      'Cabernet Sauvignon': 'CS-SY-MAL-MRS-TEM-VON',
      'Syrah':              'CS-SY-MAL-MRS-TEM-VON',
      'Malbec':             'CS-SY-MAL-MRS-TEM-VON',
      'Marselan':           'CS-SY-MAL-MRS-TEM-VON',
      'Tempranillo':        'CS-SY-MAL-MRS-TEM-VON',
      'Merlot':             'MER-CF-GRE-CALADOC-VON',
      'Cabernet Franc':     'MER-CF-GRE-CALADOC-VON',
      'Grenache':           'MER-CF-GRE-CALADOC-VON',
      'Caladoc':            'MER-CF-GRE-CALADOC-VON',
      'Sauvignon Blanc':    'SB-VDG-VON',
      'Chardonnay':         'CH-CB-SBGR-VDG-VON',
      'Chenin Blanc':       'CH-CB-SBGR-VDG-VON'
    },
    'Valle de Guadalupe': {
      'Cabernet Sauvignon': 'CS-SY-VDG',
      'Syrah':              'CS-SY-VDG',
      'Grenache':           'GRE-CALADOC-VDG-VSV',
      'Caladoc':            'GRE-CALADOC-VDG-VSV',
      'Sauvignon Blanc':    'SB-VDG-VON',
      'Chardonnay':         'CH-CB-SBGR-VDG-VON',
      'Chenin Blanc':       'CH-CB-SBGR-VDG-VON'
    },
    'Valle de San Vicente': {
      'Grenache': 'GRE-CALADOC-VDG-VSV',
      'Caladoc':  'GRE-CALADOC-VDG-VSV'
    }
  },

  // Valley-name extraction from appellation strings — ordered, first match wins.
  // Uses appellation normalization already applied in _enrichData.
  valleyPatterns: [
    { re: /Valle de Ojos Negros/i,   valley: 'Valle de Ojos Negros' },
    { re: /Valle de Guadalupe|VDG/i, valley: 'Valle de Guadalupe' },
    { re: /San Vicente|VSV/i,        valley: 'Valle de San Vicente' }
  ],
```

- [ ] **Step 2: Verify file still parses**

Run: `node --check js/config.js`
Expected: exit 0, no output.

- [ ] **Step 3: Run existing test suite to confirm no regression**

Run: `npm test`
Expected: all existing tests (140) pass — this task adds only data, no code paths consume it yet.

- [ ] **Step 4: Commit**

```bash
git add js/config.js
git commit -m "feat(config): add quality rubrics + variety-rubric map

Seven rubrics (PV-DUR-VON, CS-SY-MAL-MRS-TEM-VON, CS-SY-VDG,
MER-CF-GRE-CALADOC-VON, GRE-CALADOC-VDG-VSV, SB-VDG-VON,
CH-CB-SBGR-VDG-VON) with A/B/C thresholds for brix, pH, ta,
av, ag, berryFW, polyphenols, anthocyanins. Per-variety peso
overrides for Tempranillo, Syrah, Grenache, Caladoc. Global
sanitary/visual thresholds and madurez overlay also defined."
```

---

## Task 3: MT.11 Failing Tests — Classification Engine

**Files:**
- Create: `tests/mt11-classification.test.mjs`

The engine doesn't exist yet. All tests fail at import time. We drive the implementation in Task 4.

- [ ] **Step 1: Write the failing test file**

```javascript
// tests/mt11-classification.test.mjs
// MT.11 — Quality classification engine: thresholds, scoring, percentile.
// Engine lives in js/classification.js (pure functions, no DOM, no queries).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreParam,
  scoreLot,
  scoreAll,
  resolveRubric,
  resolveValley,
  aggregateSection
} from '../js/classification.js';

// ── Helpers ──────────────────────────────────────────────────────────
const mkLot = (o = {}) => ({
  lotCode: o.lotCode ?? 'TEST-1',
  vintage: o.vintage ?? 2025,
  variety: o.variety ?? 'Cabernet Sauvignon',
  appellation: o.appellation ?? 'Valle de Ojos Negros',
  brix: 23.8, pH: 3.60, ta: 6.0, av: 0.0, ag: 0.02,
  berryFW: 1.0, polyphenols: 2000, anthocyanins: 1000,
  medicion: { health_grade: 'Excelente', health_madura: 100, health_inmadura: 0,
              health_sobremadura: 0, health_picadura: 0, health_enfermedad: 0,
              health_quemadura: 0, tons_received: 5, phenolic_maturity: null },
  ...o
});

// ── Valley resolution ────────────────────────────────────────────────
test('MT.11 resolveValley: VON appellation', () => {
  assert.equal(resolveValley('Valle de Ojos Negros'), 'Valle de Ojos Negros');
});
test('MT.11 resolveValley: VDG abbreviation', () => {
  assert.equal(resolveValley('Monte Xanic VDG'), 'Valle de Guadalupe');
});
test('MT.11 resolveValley: VSV abbreviation', () => {
  assert.equal(resolveValley('Dominio VSV SPOT'), 'Valle de San Vicente');
});
test('MT.11 resolveValley: unknown returns null', () => {
  assert.equal(resolveValley('Napa Valley'), null);
});
test('MT.11 resolveValley: null appellation', () => {
  assert.equal(resolveValley(null), null);
});

// ── Rubric resolution ────────────────────────────────────────────────
test('MT.11 resolveRubric: CS in VON → CS-SY-MAL-MRS-TEM-VON', () => {
  const r = resolveRubric('Cabernet Sauvignon', 'Valle de Ojos Negros');
  assert.equal(r?.id, 'CS-SY-MAL-MRS-TEM-VON');
});
test('MT.11 resolveRubric: CS in VDG → CS-SY-VDG (different thresholds)', () => {
  const r = resolveRubric('Cabernet Sauvignon', 'Valle de Guadalupe');
  assert.equal(r?.id, 'CS-SY-VDG');
});
test('MT.11 resolveRubric: unknown variety → null', () => {
  assert.equal(resolveRubric('Nebbiolo', 'Valle de Ojos Negros'), null);
});

// ── scoreParam — threshold bucketing ────────────────────────────────
test('MT.11 scoreParam le-a-le-b: pH=3.60 → A (≤3.67)', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, 3.60), 3);
});
test('MT.11 scoreParam le-a-le-b: pH=3.68 → B (boundary)', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, 3.68), 2);
});
test('MT.11 scoreParam le-a-le-b: pH=3.81 → C', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, 3.81), 1);
});
test('MT.11 scoreParam le-a-le-b: pH=3.67 exact → A (inclusive)', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, 3.67), 3);
});
test('MT.11 scoreParam ge-a-ge-b: ta=6.0 → A (≥5.85)', () => {
  assert.equal(scoreParam({ kind: 'ge-a-ge-b', a: 5.85, b: 5.40 }, 6.0), 3);
});
test('MT.11 scoreParam ge-a-ge-b: ta=5.60 → B', () => {
  assert.equal(scoreParam({ kind: 'ge-a-ge-b', a: 5.85, b: 5.40 }, 5.60), 2);
});
test('MT.11 scoreParam ge-a-ge-b: ta=5.39 → C', () => {
  assert.equal(scoreParam({ kind: 'ge-a-ge-b', a: 5.85, b: 5.40 }, 5.39), 1);
});
test('MT.11 scoreParam range: brix 23.7 → A (within A range)', () => {
  const p = { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]] };
  assert.equal(scoreParam(p, 23.7), 3);
});
test('MT.11 scoreParam range: brix 23.0 → B (within lower B range)', () => {
  const p = { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]] };
  assert.equal(scoreParam(p, 23.0), 2);
});
test('MT.11 scoreParam range: brix 25.0 → B (within upper B range)', () => {
  const p = { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]] };
  assert.equal(scoreParam(p, 25.0), 2);
});
test('MT.11 scoreParam range: brix 26.0 → C (outside all ranges)', () => {
  const p = { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]] };
  assert.equal(scoreParam(p, 26.0), 1);
});
test('MT.11 scoreParam: null value → null (drop from scoring)', () => {
  assert.equal(scoreParam({ kind: 'le-a-le-b', a: 3.67, b: 3.80 }, null), null);
});

// ── scoreLot — end-to-end ────────────────────────────────────────────
test('MT.11 scoreLot: perfect reds → A+ 36', () => {
  const lot = mkLot({ brix: 23.7, pH: 3.60, ta: 6.0, av: 0.0, ag: 0.02,
                      berryFW: 1.0, polyphenols: 2100, anthocyanins: 1000 });
  const r = scoreLot(lot);
  assert.equal(r.grade, 'A+');
  assert.equal(r.score36, 36);
  assert.equal(r.rubricId, 'CS-SY-MAL-MRS-TEM-VON');
});

test('MT.11 scoreLot: all-C reds → C 12', () => {
  const lot = mkLot({ brix: 26, pH: 3.90, ta: 5.0, av: 0.10, ag: 0.20,
                      berryFW: 0.5, polyphenols: 500, anthocyanins: 200,
                      medicion: { ...mkLot().medicion, health_grade: 'Malo',
                                  health_picadura: 10, health_madura: 90 } });
  const r = scoreLot(lot);
  assert.equal(r.grade, 'C');
  assert.equal(r.score36, 12);
});

test('MT.11 scoreLot: madurez Sobresaliente adds +3', () => {
  // Build a lot whose base36 = 27 exactly (on A/B boundary from above)
  // Brix A(3)*4 + pH A(3)*12 + ta A(3)*9 + av A(3)*13 + ag A(3)*13
  // + sanitary A(3)*2 + visual A(3)*2 + peso A(3)*5 + poly B(2)*20 + anthoc B(2)*20
  // = 12+36+27+39+39+6+6+15+40+40 = 260. base36 = 260/300*36 = 31.2 → A+
  // To get ~27, need one more B. Drop sanitary to B: +6 raw - 2 = +4. 258/300*36=30.96 → A+
  // Easier: use partial rounding boundary. Use madurez crossing A+/A boundary:
  const lot = mkLot({ brix: 23.0, pH: 3.60, ta: 6.0, av: 0.0, ag: 0.02,
                      berryFW: 1.0, polyphenols: 1900, anthocyanins: 950 });
  // Just check that overlay shifts score by 3
  const without = scoreLot({ ...lot, medicion: { ...lot.medicion, phenolic_maturity: null } });
  const with_ = scoreLot({ ...lot, medicion: { ...lot.medicion, phenolic_maturity: 'Sobresaliente' } });
  assert.equal(with_.score36 - without.score36, 3);
});

test('MT.11 scoreLot: madurez No sobresaliente subtracts 3, clamps at 0', () => {
  const lot = mkLot({ brix: 26, pH: 3.90, ta: 5.0, av: 0.10, ag: 0.20,
                      berryFW: 0.5, polyphenols: 500, anthocyanins: 200 });
  const r = scoreLot({ ...lot, medicion: { ...lot.medicion, phenolic_maturity: 'No sobresaliente' } });
  assert.equal(r.score36, 9); // 12 base - 3 = 9
  assert.equal(r.grade, 'C');
});

test('MT.11 scoreLot: unknown variety/valley → null rubric', () => {
  const lot = mkLot({ variety: 'Nebbiolo', appellation: 'Napa Valley' });
  const r = scoreLot(lot);
  assert.equal(r.grade, null);
  assert.equal(r.score36, null);
  assert.equal(r.reason, 'Sin rúbrica');
});

test('MT.11 scoreLot: partial data (3 params missing) still scores', () => {
  const lot = mkLot({ ag: null, polyphenols: null, anthocyanins: null });
  const r = scoreLot(lot);
  assert.ok(r.grade); // still scores
  assert.ok(r.missing.includes('ag'));
  assert.ok(r.missing.includes('polyphenols'));
  assert.ok(r.missing.includes('anthocyanins'));
});

test('MT.11 scoreLot: too little data (< 60 Imp) → null', () => {
  const lot = mkLot({
    brix: null, pH: null, ta: null, av: null, ag: null,
    polyphenols: null, anthocyanins: null,
    medicion: null
  });
  // Only berryFW (imp=5) remains → 5 < 60 → unscorable
  const r = scoreLot(lot);
  assert.equal(r.grade, null);
  assert.equal(r.reason, 'Datos insuficientes');
});

test('MT.11 scoreLot: peso override applies to Tempranillo', () => {
  const lot = mkLot({ variety: 'Tempranillo', berryFW: 1.4 });
  // Tempranillo gets override a:[1.3,1.5] → 1.4 is A (not C as default 0.9-1.1 would give)
  const r = scoreLot(lot);
  // With default thresholds, 1.4 would fall in the ">1.2" C bucket. With override → A.
  assert.ok(r.score36 > 30); // stays near A+
});

test('MT.11 scoreLot: peso override applies to Syrah in VDG', () => {
  const lot = mkLot({
    variety: 'Syrah', appellation: 'Valle de Guadalupe',
    berryFW: 1.3, brix: 24.0, pH: 3.55, ta: 6.0, av: 0.0, ag: 0.02,
    polyphenols: 2100, anthocyanins: 800
  });
  // Syrah in VDG gets peso override a:[1.2,1.4] → 1.3 is A
  const r = scoreLot(lot);
  assert.equal(r.rubricId, 'CS-SY-VDG');
  assert.ok(r.score36 >= 30); // should stay A+
});

test('MT.11 scoreLot: sanitary conteo=1% → B bucket', () => {
  const lot = mkLot({
    medicion: { ...mkLot().medicion,
                health_madura: 99, health_picadura: 1 } // 1% unhealthy
  });
  const r = scoreLot(lot);
  // Without this the lot would be A+ 36; with 1% → sanitary conteo drops to B
  // Raw: perfect 300 minus sanitary conteo which drops 3→2 on imp=2: -2
  // raw=298, base36 = 298/300*36 = 35.76 → A+ (still above 30)
  assert.equal(r.grade, 'A+');
  assert.ok(r.score36 < 36);
});

test('MT.11 scoreLot: sanitary conteo=5% → C bucket, knocks grade', () => {
  const lot = mkLot({
    brix: 23.0, pH: 3.70, ta: 5.60, av: 0.02, ag: 0.05,
    berryFW: 1.15, polyphenols: 1700, anthocyanins: 800,
    medicion: { ...mkLot().medicion,
                health_madura: 95, health_enfermedad: 5 } // 5% unhealthy
  });
  const r = scoreLot(lot);
  // Expected: mostly B (2pts), some A. Sanitary forced to C. Score should land in B range.
  assert.ok(['A', 'B'].includes(r.grade));
});

test('MT.11 scoreLot: visual Regular → B pts for visual param', () => {
  const lot = mkLot({
    medicion: { ...mkLot().medicion, health_grade: 'Regular' }
  });
  const r = scoreLot(lot);
  // visual drops from 3 to 2 on imp=2 → raw -= 2 → 298/300*36 = 35.76
  assert.equal(r.grade, 'A+');
  assert.equal(r.score36.toFixed(1), '35.8');
});

test('MT.11 scoreLot: visual Malo → C pts for visual param', () => {
  const lot = mkLot({
    medicion: { ...mkLot().medicion, health_grade: 'Malo' }
  });
  const r = scoreLot(lot);
  // visual drops 3→1 on imp=2 → raw -= 4 → 296/300*36 = 35.52
  assert.equal(r.grade, 'A+');
});

test('MT.11 scoreLot: medicion null → sanitary params dropped, not fail', () => {
  const lot = mkLot({ medicion: null });
  const r = scoreLot(lot);
  assert.ok(r.grade !== null);
  assert.ok(r.missing.includes('sanitary_pct'));
  assert.ok(r.missing.includes('visual'));
});

test('MT.11 scoreLot: white rubric (SB) normalizes correctly', () => {
  const lot = mkLot({
    variety: 'Sauvignon Blanc', appellation: 'Valle de Ojos Negros',
    brix: 22.0, pH: 3.15, ta: 7.0, av: 0.0, ag: 0.02, berryFW: 1.2,
    polyphenols: null, anthocyanins: null
  });
  const r = scoreLot(lot);
  assert.equal(r.rubricId, 'SB-VDG-VON');
  assert.equal(r.grade, 'A+');
});

// ── Percentile + aggregate ───────────────────────────────────────────
test('MT.11 scoreAll: percentile within same-variety same-vintage cohort', () => {
  const lots = [
    { ...mkLot({ lotCode: 'a' }), brix: 23.7 },  // high
    { ...mkLot({ lotCode: 'b' }), brix: 23.0 },  // mid
    { ...mkLot({ lotCode: 'c' }), brix: 22.5 }   // low
  ];
  const scored = scoreAll(lots, { cohort: 'vintage-variety' });
  const byCode = Object.fromEntries(scored.map(s => [s.lotCode, s]));
  assert.ok(byCode.a.percentile > byCode.b.percentile);
  assert.ok(byCode.b.percentile > byCode.c.percentile);
  assert.equal(byCode.a.percentile, 100); // top of cohort
});

test('MT.11 scoreAll: tied scores share higher percentile', () => {
  const lots = [
    { ...mkLot({ lotCode: 'a' }) },
    { ...mkLot({ lotCode: 'b' }) } // identical
  ];
  const scored = scoreAll(lots, { cohort: 'vintage-variety' });
  assert.equal(scored[0].percentile, scored[1].percentile);
});

test('MT.11 aggregateSection: tonnage-weighted average', () => {
  const lots = [
    { lotCode: 'a', score36: 30, grade: 'A+', tons: 10 },
    { lotCode: 'b', score36: 24, grade: 'B',  tons: 10 }
  ];
  const agg = aggregateSection(lots);
  assert.equal(agg.score36, 27);    // weighted avg
  assert.equal(agg.grade, 'A');     // 27 is the A bucket floor
  assert.equal(agg.lotCount, 2);
});

test('MT.11 aggregateSection: missing tons defaults to weight 1', () => {
  const lots = [
    { lotCode: 'a', score36: 30, grade: 'A+', tons: null },
    { lotCode: 'b', score36: 24, grade: 'B',  tons: null }
  ];
  const agg = aggregateSection(lots);
  assert.equal(agg.score36, 27);
});

test('MT.11 aggregateSection: all-null lots → grade null', () => {
  const lots = [
    { lotCode: 'a', score36: null, grade: null, tons: 10 },
    { lotCode: 'b', score36: null, grade: null, tons: 5 }
  ];
  const agg = aggregateSection(lots);
  assert.equal(agg.grade, null);
  assert.equal(agg.score36, null);
});

test('MT.11 aggregateSection: null lots excluded from numerator and denominator', () => {
  const lots = [
    { lotCode: 'a', score36: 32, grade: 'A+', tons: 10 },
    { lotCode: 'b', score36: null, grade: null, tons: 10 }
  ];
  const agg = aggregateSection(lots);
  assert.equal(agg.score36, 32); // only lot a counts
  assert.equal(agg.grade, 'A+');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --test-only 2>&1 | head -50`
Or to run just MT.11: `node --test tests/mt11-classification.test.mjs`

Expected: every test fails with `Cannot find module '../js/classification.js'` or similar import error. The whole file fails to load.

- [ ] **Step 3: Commit the failing suite**

```bash
git add tests/mt11-classification.test.mjs
git commit -m "test(mt11): add failing classification engine suite

Covers: valley + rubric resolution, scoreParam threshold bucketing
(le-a-le-b, ge-a-ge-b, range), scoreLot end-to-end including madurez
overlay + partial data + peso overrides, scoreAll percentile (cohort
+ ties), aggregateSection tonnage-weighted averaging. 30 cases.
Engine implementation in next commit."
```

---

## Task 4: Implement `js/classification.js`

**Files:**
- Create: `js/classification.js`

- [ ] **Step 1: Write the classification engine**

```javascript
// js/classification.js
// Pure scoring engine. No DOM, no network, no module-level side effects.
// See docs/superpowers/specs/2026-04-21-quality-classification-design.md

import { CONFIG } from './config.js';

// ── Valley resolution ────────────────────────────────────────────────

export function resolveValley(appellation) {
  if (!appellation) return null;
  const s = String(appellation);
  for (const { re, valley } of CONFIG.valleyPatterns) {
    if (re.test(s)) return valley;
  }
  return null;
}

// ── Rubric resolution ────────────────────────────────────────────────

export function resolveRubric(variety, appellationOrValley) {
  if (!variety) return null;
  const valley = CONFIG.varietyRubricMap[appellationOrValley]
    ? appellationOrValley
    : resolveValley(appellationOrValley);
  if (!valley) return null;
  const map = CONFIG.varietyRubricMap[valley];
  if (!map) return null;
  const rubricId = map[variety];
  if (!rubricId) return null;
  const rubric = CONFIG.rubrics[rubricId];
  if (!rubric) return null;
  return { id: rubricId, ...rubric };
}

// ── Threshold bucketing ──────────────────────────────────────────────

export function scoreParam(spec, value) {
  if (value === null || value === undefined) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;

  switch (spec.kind) {
    case 'le-a-le-b':
      if (v <= spec.a) return 3;
      if (v <= spec.b) return 2;
      return 1;
    case 'ge-a-ge-b':
      if (v >= spec.a) return 3;
      if (v >= spec.b) return 2;
      return 1;
    case 'range': {
      const [lo, hi] = spec.a;
      if (v >= lo && v <= hi) return 3;
      for (const [blo, bhi] of spec.b) {
        if (v >= blo && v <= bhi) return 2;
      }
      return 1;
    }
    default:
      return null;
  }
}

// ── Sanitary conteo + visual ─────────────────────────────────────────

function scoreSanitaryPct(medicion) {
  if (!medicion) return null;
  const unhealthy = (medicion.health_picadura || 0)
                  + (medicion.health_enfermedad || 0)
                  + (medicion.health_quemadura || 0);
  const total = (medicion.health_madura || 0)
              + (medicion.health_inmadura || 0)
              + (medicion.health_sobremadura || 0)
              + unhealthy;
  if (total === 0) return null;
  const pct = unhealthy / total * 100;
  const { a, b } = CONFIG.sanitaryThresholds.pct;
  if (pct <= a) return 3;
  if (pct <= b) return 2;
  return 1;
}

function scoreVisual(medicion) {
  if (!medicion || !medicion.health_grade) return null;
  return CONFIG.sanitaryThresholds.visual[medicion.health_grade] ?? null;
}

// ── Core: scoreLot ───────────────────────────────────────────────────

export function scoreLot(lot) {
  const rubric = resolveRubric(lot.variety, lot.appellation);
  if (!rubric) {
    return { grade: null, score36: null, rubricId: null, missing: [], reason: 'Sin rúbrica' };
  }

  // Build effective params with variety-level peso override applied
  const params = { ...rubric.params };
  if (rubric.peso_overrides && rubric.peso_overrides[lot.variety]) {
    params.berryFW = rubric.peso_overrides[lot.variety];
  }

  let raw = 0;
  let impSum = 0;
  const missing = [];
  const buckets = {};

  for (const [field, spec] of Object.entries(params)) {
    const pts = scoreParam(spec, lot[field]);
    if (pts === null) {
      missing.push(field);
      continue;
    }
    raw += pts * spec.imp;
    impSum += spec.imp;
    buckets[field] = pts;
  }

  // Sanitary (pct + visual) are derived from medicion, not the rubric
  const conteoImp = CONFIG.sanitaryThresholds.defaultConteoImp;
  const visualImp = rubric.visualImp ?? CONFIG.sanitaryThresholds.defaultVisualImp;

  const conteoPts = scoreSanitaryPct(lot.medicion);
  if (conteoPts === null) missing.push('sanitary_pct');
  else { raw += conteoPts * conteoImp; impSum += conteoImp; buckets.sanitary_pct = conteoPts; }

  const visualPts = scoreVisual(lot.medicion);
  if (visualPts === null) missing.push('visual');
  else { raw += visualPts * visualImp; impSum += visualImp; buckets.visual = visualPts; }

  // Partial-data guard
  if (impSum < 60) {
    return { grade: null, score36: null, rubricId: rubric.id, missing, reason: 'Datos insuficientes' };
  }

  const base36 = raw / (3 * impSum) * 36;

  // Madurez overlay (winemaker)
  const madurezKey = lot.medicion?.phenolic_maturity ?? null;
  const madurezAdj = CONFIG.madurezOverlay[madurezKey] ?? 0;

  const score36raw = base36 + madurezAdj;
  const score36 = Math.max(0, Math.min(36, score36raw));

  const grade = score36 >= 30 ? 'A+'
              : score36 >= 27 ? 'A'
              : score36 >= 23 ? 'B'
              :                 'C';

  return {
    grade,
    score36: Math.round(score36 * 100) / 100,
    rubricId: rubric.id,
    missing,
    buckets,
    madurezAdj,
    reason: null
  };
}

// ── scoreAll: adds percentile within cohort ──────────────────────────

export function scoreAll(lots, options = {}) {
  const cohortMode = options.cohort || 'vintage-variety';
  const scored = lots.map(l => ({ ...l, ...scoreLot(l) }));

  // Group by cohort
  const keyFn = cohortMode === 'variety-only'
    ? (l) => l.variety
    : (l) => `${l.variety}||${l.vintage}`;

  const groups = new Map();
  for (const s of scored) {
    if (s.score36 === null) continue;
    const k = keyFn(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }

  // Compute percentile per group (ties share higher)
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.score36 - b.score36);
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      // Find last index with same score → count of lots with score ≤ current
      let j = i;
      while (j + 1 < n && sorted[j + 1].score36 === sorted[i].score36) j++;
      const pct = n === 1 ? 100 : Math.round(((j + 1) / n) * 100);
      for (let k = i; k <= j; k++) sorted[k].percentile = pct;
      i = j;
    }
  }

  // Default percentile for unscored or singleton lots without group
  for (const s of scored) {
    if (s.percentile === undefined) s.percentile = null;
    s.percentileCohort = cohortMode;
  }

  return scored;
}

// ── aggregateSection: tonnage-weighted roll-up ───────────────────────

export function aggregateSection(lots) {
  let weightedSum = 0;
  let weightTotal = 0;
  let scoredLots = 0;
  for (const l of lots) {
    if (l.score36 === null || l.score36 === undefined) continue;
    const w = (l.tons && l.tons > 0) ? l.tons : 1;
    weightedSum += l.score36 * w;
    weightTotal += w;
    scoredLots++;
  }
  if (scoredLots === 0) {
    return { grade: null, score36: null, lotCount: lots.length };
  }
  const score36 = Math.round((weightedSum / weightTotal) * 100) / 100;
  const grade = score36 >= 30 ? 'A+'
              : score36 >= 27 ? 'A'
              : score36 >= 23 ? 'B'
              :                 'C';
  return { grade, score36, lotCount: lots.length };
}
```

- [ ] **Step 2: Run MT.11 and iterate to green**

Run: `node --test tests/mt11-classification.test.mjs`

Expected first pass: most pass, some edge cases fail. Fix the engine (never the tests — tests reflect the spec). Likely failure patterns and fixes:

- **Percentile for singleton cohort returns 100** — if any test expects a different value, the test is wrong; check spec §7.
- **Boundary rounding** — `score36` is rounded to 2 decimals, grade cutoffs use the rounded value. If a test expects `score36 >= 27` and the raw is `26.9999`, rounding handles it.
- **peso_overrides not picked up** — ensure variety key matches exactly (spec.value is CONFIG.varietyNormalization-normalized).

Iterate until all 30 tests pass.

- [ ] **Step 3: Run full test suite — zero regressions**

Run: `npm test`
Expected: 170/170 passing (140 prior + 30 new).

- [ ] **Step 4: Commit**

```bash
git add js/classification.js
git commit -m "feat(classification): pure quality scoring engine

Implements scoreParam/scoreLot/scoreAll/aggregateSection/resolveRubric/
resolveValley per docs/superpowers/specs/2026-04-21-quality-classification-design.md.
MT.11 (30 tests) green. 170/170 node tests passing."
```

---

## Task 5: `DataStore.joinBerryWithMediciones()`

**Files:**
- Modify: `js/dataLoader.js` (add method; do not disturb existing queries)

- [ ] **Step 1: Add the join method**

Locate the `DataStore` object in `js/dataLoader.js`. Add this method after `_enrichData` (search for `_enrichData` to find the right place):

```javascript
  // ── Join berry_samples with mediciones_tecnicas ──
  // Enriches each berry row with row.medicion = { health_*, tons_received,
  // phenolic_maturity } | null based on (lot_code, vintage_year) lookup.
  // Idempotent — running twice produces the same enrichedBerry array.
  joinBerryWithMediciones() {
    const medIndex = new Map();
    for (const m of (this.mediciones || [])) {
      const key = `${m.lot_code}||${m.vintage_year}`;
      medIndex.set(key, m);
    }
    this.enrichedBerry = (this.berryData || []).map(b => {
      const key = `${b.lotCode}||${b.vintage || b.vintage_year}`;
      const m = medIndex.get(key) || null;
      return { ...b, medicion: m };
    });
    return this.enrichedBerry;
  },
```

- [ ] **Step 2: Call it after load**

Find where `DataStore.berryData` and `DataStore.mediciones` are assigned after the Supabase fetch (search for `this.berryData =` in `loadAll` or similar). After both are set, add:

```javascript
    this.joinBerryWithMediciones();
```

Make sure it runs AFTER `_enrichData(this.berryData)` (which normalizes variety/appellation — classification depends on normalized variety names).

- [ ] **Step 3: Run existing tests — no regressions**

Run: `npm test`
Expected: 170/170 still pass (this method has no test coverage yet — it's a simple map-based join; MT.11 covers the scoring that consumes it).

- [ ] **Step 4: Commit**

```bash
git add js/dataLoader.js
git commit -m "feat(dataLoader): joinBerryWithMediciones() for quality scoring

Attaches row.medicion = { health_*, tons_received, phenolic_maturity }
to each berry row via (lot_code, vintage_year) lookup. Called after
_enrichData so classification.js receives normalized variety names."
```

---

## Task 6: `maps.js` — `Calidad` Branch, Tooltip, Detail Panel, Legend

**Files:**
- Modify: `js/maps.js`

- [ ] **Step 1: Import the classification module**

At the top of `js/maps.js` (after `import { CONFIG } from './config.js';`):

```javascript
import { scoreAll, aggregateSection } from './classification.js';
```

- [ ] **Step 2: Compute section grades alongside aggregate chem values**

Locate `MapStore.aggregateBySection()` (around line 49). At the end of that method (after the existing weighted-average loop), add:

```javascript
    // ── Quality scoring pass ───────────────────────────────────────
    // Build a flat list of all lots across all sections, score them
    // (percentile needs the full cohort to be correct), then assign
    // scored lots back to their sections and aggregate per-section grade.
    const allLots = [];
    for (const [sectionId, lots] of Object.entries(this.sectionLots)) {
      for (const lot of lots) allLots.push({ ...lot, _sectionId: sectionId });
    }
    const scoredLots = scoreAll(allLots, { cohort: 'vintage-variety' });

    // Rebuild per-section scored arrays
    const sectionScoredLots = {};
    for (const s of scoredLots) {
      const sid = s._sectionId;
      if (!sectionScoredLots[sid]) sectionScoredLots[sid] = [];
      sectionScoredLots[sid].push({
        lotCode: s.lotCode,
        score36: s.score36,
        grade: s.grade,
        percentile: s.percentile,
        tons: s.medicion?.tons_received ?? null,
        missing: s.missing,
        reason: s.reason
      });
    }
    this.sectionScoredLots = sectionScoredLots;

    // Per-section aggregate grade
    for (const sectionId of Object.keys(this.sectionData)) {
      const lots = sectionScoredLots[sectionId] || [];
      const agg = aggregateSection(lots);
      this.sectionData[sectionId].grade = agg.grade;
      this.sectionData[sectionId].score36 = agg.score36;
      this.sectionData[sectionId].gradedLotCount = agg.lotCount;
    }
```

- [ ] **Step 3: Extend `getColor()` to handle `calidad`**

Locate `MapStore.getColor()` (around line 92). Add a `calidad` branch at the top:

```javascript
  getColor(value, metricKey) {
    if (metricKey === 'calidad') {
      // value here is the section's grade letter, not a numeric score
      return CONFIG.gradeColors[value] ?? CONFIG.gradeColors[null];
    }
    const m = CONFIG.mapMetrics[metricKey];
    // … existing gradient logic unchanged
```

- [ ] **Step 4: Route metric value for `calidad` in the render loop**

Locate the render loop (around line 145, where `metricVal` is pulled from `data[this.currentMetric]`). Change:

```javascript
      const metricVal = data ? data[this.currentMetric] : null;
      const fillColor = this.getColor(metricVal, this.currentMetric);
```

to:

```javascript
      const metricVal = data
        ? (this.currentMetric === 'calidad' ? data.grade : data[this.currentMetric])
        : null;
      const fillColor = this.getColor(metricVal, this.currentMetric);
```

- [ ] **Step 5: Update the in-section label for `calidad` mode**

In the same render loop (around line 176, the `if (metricVal !== null && metricVal !== undefined)` block), special-case the grade label:

```javascript
      if (metricVal !== null && metricVal !== undefined) {
        const valStr = this.currentMetric === 'calidad'
          ? `${metricVal} (${data.score36?.toFixed(1) ?? '—'})`
          : (metricVal >= 100 ? Math.round(metricVal) : metricVal.toFixed(1));
        // … rest of label rendering unchanged
      }
```

- [ ] **Step 6: Tooltip grade list**

Find the tooltip build (search for `tooltip` or `title` SVG elements in `maps.js`; alternatively locate the hover handler). When `currentMetric === 'calidad'`, append a per-lot breakdown:

```javascript
  // Called from the existing tooltip composer when currentMetric === 'calidad'
  _tooltipGradeBreakdown(sectionId) {
    const lots = (this.sectionScoredLots || {})[sectionId] || [];
    if (lots.length === 0) return '';
    const rows = lots
      .filter(l => l.grade !== null)
      .slice(0, 6)  // cap for screen-space
      .map(l => `  • ${l.lotCode.padEnd(14)} ${l.grade.padEnd(3)} ${l.score36?.toFixed(1) ?? '—'}`)
      .join('\n');
    return rows ? '\n' + rows : '';
  },
```

Wire it into the tooltip assembly where the text is built (find the string that currently joins metric name + value). For calidad, render:

```
MX-5B — Cabernet Sauvignon
Grado: A (28.4 / 36) — 3 lotes
  • CSMX-5B-1   A+  31.2
  • CSMX-5B-2   A   27.9
  • CSMX-5B-3   B   24.1
```

- [ ] **Step 7: Detail panel — grade row + cohort percentile + breakdown expander**

Locate the detail panel HTML composer (search for `detail-metrics` or `detail-metric` — around lines 248–260 per the earlier read). Add a `calidad` row ABOVE the chem metrics block:

```javascript
  _detailGradeRow(sectionId, data) {
    if (data.grade === null || data.grade === undefined) {
      return `<div class="detail-grade-row detail-grade-unscored">Clasificación: Sin datos</div>`;
    }
    const lots = (this.sectionScoredLots || {})[sectionId] || [];
    const scoredLots = lots.filter(l => l.grade !== null);
    // Pick a representative percentile (mean of contributing lots)
    const pctSum = scoredLots.reduce((s, l) => s + (l.percentile ?? 0), 0);
    const pctAvg = scoredLots.length ? Math.round(pctSum / scoredLots.length) : null;

    const breakdown = scoredLots.map(l =>
      `<li><span class="grade-chip grade-${l.grade.replace('+', 'plus')}">${this._esc(l.grade)}</span>
           ${this._esc(l.lotCode)} — ${l.score36?.toFixed(1) ?? '—'}
           ${l.percentile != null ? ` · P${l.percentile}` : ''}</li>`
    ).join('');

    return `
      <div class="detail-grade-row">
        <div class="detail-grade-header">
          <span class="detail-grade-label">Clasificación</span>
          <span class="grade-chip grade-${data.grade.replace('+', 'plus')}">${this._esc(data.grade)}</span>
          <span class="detail-grade-score">(${data.score36.toFixed(1)} / 36)</span>
          ${pctAvg != null ? `<span class="detail-grade-pct">Percentil ${pctAvg}</span>` : ''}
        </div>
        <details class="detail-grade-breakdown">
          <summary>Ver desglose por lote</summary>
          <ul>${breakdown}</ul>
        </details>
      </div>
    `;
  },
```

Insert `${this._detailGradeRow(sectionId, data)}` before the `<div class="detail-metrics">` line in the detail-panel template.

- [ ] **Step 8: Legend swap — discrete swatches for `calidad`**

Find the legend renderer (search for `legend` in maps.js, or `mapMetrics[key].stops`). Add a branch:

```javascript
  _renderLegend(metricKey) {
    if (metricKey === 'calidad') {
      const grades = [
        { g: 'A+', label: 'A+ Sobresaliente' },
        { g: 'A',  label: 'A Alto' },
        { g: 'B',  label: 'B Medio' },
        { g: 'C',  label: 'C Bajo' },
        { g: null, label: 'Sin clasificar' }
      ];
      return `<div class="map-legend map-legend-discrete">
        ${grades.map(({ g, label }) => `
          <div class="legend-item">
            <span class="legend-swatch" style="background:${CONFIG.gradeColors[g]}"></span>
            <span class="legend-label">${label}</span>
          </div>
        `).join('')}
      </div>`;
    }
    // existing gradient legend logic
  },
```

- [ ] **Step 9: Default metric when view loads**

Locate the initial metric value (`currentMetric: 'brix'` at the top of MapStore). Change to:

```javascript
  currentMetric: 'calidad',
```

- [ ] **Step 10: Run tests**

Run: `npm test`
Expected: 170/170. No new tests in this task — behavior is covered by manual verification (Task 9) and by the engine tests.

Run: `npm run test:e2e`
Expected: 12/12. The mobile spec doesn't touch metric behavior, but regression-check anyway.

- [ ] **Step 11: Commit**

```bash
git add js/maps.js
git commit -m "feat(maps): Calidad metric — quality grade per section

- getColor() handles grade strings (A+/A/B/C/null → gradeColors)
- aggregateBySection() scores all lots then aggregates per section
- Tooltip lists per-lot grade breakdown when metric=calidad
- Detail panel shows aggregate grade, cohort percentile, and an
  expandable per-lot desglose with grade chips
- Legend swaps to discrete 4-swatch layout when metric=calidad
- Default metric is now calidad"
```

---

## Task 7: `index.html` and `css/styles.css`

**Files:**
- Modify: `index.html` (metric select option)
- Modify: `css/styles.css` (grade chips + discrete legend + detail-grade-row)

- [ ] **Step 1: Add the new option to `#map-metric-select`**

Find `<select id="map-metric-select">` in `index.html`. Prepend (first `<option>`):

```html
<option value="calidad">Calidad (Clasificación)</option>
```

- [ ] **Step 2: Add grade chip and discrete-legend styles**

Append to `css/styles.css` (near the existing map styles or at the end):

```css
/* ── Quality grade chips ─────────────────────────────────────────── */
.grade-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  text-align: center;
  min-width: 24px;
}
.grade-chip.grade-Aplus { background: #1a7f3e; }
.grade-chip.grade-A     { background: #7ac74f; color: #0d3a17; }
.grade-chip.grade-B     { background: #f5c542; color: #4a3c00; }
.grade-chip.grade-C     { background: #d94a3d; }

/* ── Discrete map legend (Calidad mode) ──────────────────────────── */
.map-legend-discrete {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 6px 8px;
  align-items: center;
}
.map-legend-discrete .legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
.map-legend-discrete .legend-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 2px;
  border: 1px solid rgba(0, 0, 0, 0.15);
}

/* ── Detail panel grade row ──────────────────────────────────────── */
.detail-grade-row {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color, #e0dcd0);
}
.detail-grade-row.detail-grade-unscored {
  color: var(--text-muted, #777);
  font-style: italic;
}
.detail-grade-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.detail-grade-label {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.5px;
}
.detail-grade-score {
  font-size: 12px;
  color: var(--text-muted, #777);
}
.detail-grade-pct {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(196, 160, 80, 0.15);
  border-radius: 3px;
  color: var(--accent-color, #a58240);
}
.detail-grade-breakdown summary {
  cursor: pointer;
  font-size: 11px;
  margin-top: 8px;
  user-select: none;
}
.detail-grade-breakdown ul {
  list-style: none;
  padding: 8px 0 0 0;
  margin: 0;
}
.detail-grade-breakdown li {
  padding: 3px 0;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev` (background).
Navigate to localhost:8080 with dev bypass token set (see CLAUDE.md or existing e2e spec for the bypass snippet).
Map view should show: `Calidad (Clasificación)` as default option, sections colored A+/A/B/C, legend showing four swatches.
Click a section: grade row appears above Muestras/Brix/pH with an expandable "Ver desglose por lote".

Kill the dev server after verification.

- [ ] **Step 4: Commit**

```bash
git add index.html css/styles.css
git commit -m "feat(ui): Calidad metric option + grade chips + discrete legend

- #map-metric-select: new 'calidad' option at top (default)
- .grade-chip (A+/A/B/C color tokens)
- .map-legend-discrete (4-swatch layout)
- .detail-grade-row (aggregate grade, percentile, breakdown expander)"
```

---

## Task 8: Mediciones Form — Madurez Fenólica Field

**Files:**
- Modify: `index.html` (form markup)
- Modify: `js/mediciones.js` (form state + upsert payload + table column)

- [ ] **Step 1: Add the `<select>` to the mediciones form**

Find the mediciones form (`<form id="mediciones-form">` or similar; check around the section with the `health_grade` select). After the `health_grade` select, add:

```html
<div class="form-group">
  <label for="med-phenolic-maturity">Madurez fenólica (opcional)</label>
  <select id="med-phenolic-maturity" name="phenolic_maturity">
    <option value="">—</option>
    <option value="Sobresaliente">Sobresaliente (+3)</option>
    <option value="Parcial">Parcial (0)</option>
    <option value="No sobresaliente">No sobresaliente (−3)</option>
  </select>
</div>
```

- [ ] **Step 2: Wire the field into the form submit**

In `js/mediciones.js`, find where the form payload is built (search for `health_grade`; the payload object assembly is near there). Add:

```javascript
    phenolic_maturity: document.getElementById('med-phenolic-maturity').value || null,
```

Send `null` instead of `''` so the DB `CHECK` constraint doesn't reject the empty string.

- [ ] **Step 3: Clear the field on form reset**

Find the form-reset helper in `mediciones.js` (search for `resetForm` or similar, or the submit-success handler that clears fields). Add:

```javascript
    document.getElementById('med-phenolic-maturity').value = '';
```

- [ ] **Step 4: Surface the field in the mediciones table**

Find the mediciones table render (search for the existing table column list). Add a column header:

```html
<th>Madurez</th>
```

And a cell render with a short label:

```javascript
  _madurezShort(v) {
    if (v === 'Sobresaliente')    return 'Sobr.';
    if (v === 'Parcial')          return 'Parc.';
    if (v === 'No sobresaliente') return 'No sobr.';
    return '—';
  },
```

Render the cell:

```javascript
<td>${this._madurezShort(row.phenolic_maturity)}</td>
```

- [ ] **Step 5: Load the column in SELECT**

Find the Supabase SELECT for mediciones in `dataLoader.js` (search for `mediciones_tecnicas`). Ensure `phenolic_maturity` is included. If the existing SELECT is `select('*')`, nothing needed. If it's a column list, add `phenolic_maturity`.

- [ ] **Step 6: Manual browser verification**

Run: `npm run dev` (background).
Navigate to Mediciones view. Fill a new medicion form with `Madurez fenólica = Sobresaliente` on a lot that has berry data. Submit. Check:
1. Form resets after submit.
2. Table row shows `Sobr.` in the Madurez column.
3. Navigate to Mapa view — if that lot's section contains this record, the grade should shift by +3 (if it wasn't already at 36).

Kill the dev server.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: 170/170 passing (MT.11 `madurez Sobresaliente adds +3` already covers the engine side).

- [ ] **Step 8: Commit**

```bash
git add index.html js/mediciones.js js/dataLoader.js
git commit -m "feat(mediciones): Madurez fenólica winemaker input

- Form select with Sobresaliente/Parcial/No sobresaliente/(empty)
- Empty submits as NULL (respects phenolic_maturity CHECK constraint)
- Table column 'Madurez' with short labels (Sobr./Parc./No sobr./—)
- SELECT includes phenolic_maturity so it round-trips via DataStore"
```

---

## Task 9: Full Verification + Documentation Sync

**Files:**
- Modify: `TASK.md` — mark F9 complete
- Modify: `PLAN.md` — mark Stage 4 F9 complete
- Modify: `CLAUDE.md` — add `classification.js` to the file-responsibilities table

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: ≥ 170 passing (17+ suites).

Run: `npm run test:e2e`
Expected: 12/12 passing in ~15s.

Run: `npm run build`
Expected: exit 0. Note the main bundle size — should not have grown by more than 20 KB.

- [ ] **Step 2: Browser smoke test — golden path**

Start dev server: `npm run dev` (background).
With the dev bypass token set:

1. Map view loads with `Calidad (Clasificación)` selected. Sections render in A+/A/B/C colors plus gray for any unknown variety/valley combos.
2. Hover a section — tooltip shows `Grado: <letter> (<score> / 36) — <N> lotes` and up to 6 per-lot entries.
3. Click a section — detail panel shows "Clasificación" row above Muestras/Brix/pH with grade chip, score, and "Percentil N". Expand "Ver desglose por lote" — each lot shows a grade chip + lot code + score + percentile.
4. Switch metric to `Brix (°Bx)` — map reverts to gradient coloring. Switch to `pH`, `A.T.`, `tANT` — each renders today's behavior unchanged.
5. Switch back to `Calidad` — state restores correctly.
6. Navigate to Mediciones view, add a test medicion with `Madurez fenólica = Sobresaliente` on an existing berry lot, submit. Return to Mapa — that lot's section grade should recompute on next data refresh.

Kill the dev server.

- [ ] **Step 3: Update `TASK.md`**

Find the Phase 9 features table (line 22–39). Change the F9 row:

```markdown
| F9 | Lot quality classification (A+/A/B/C + percentile) | Berry+mediciones → rubric-based grade per lot, weighted-aggregated per section on the map | **Done** (`<commit-hash>`) |
```

Find the "What Shipped" sections and add a new sub-section:

```markdown
### What Shipped (Sub-project 4: Quality Classification & True Quality Map)

Commits: <commit-list-from-this-plan>.

- `js/classification.js` (new) — pure scoring engine: rubric resolution, threshold bucketing (le-a-le-b / ge-a-ge-b / range kinds), weighted sum, madurez ±3 overlay, partial-data fallback at ≥60 Imp, per-variety peso overrides, percentile within cohort (vintage-variety by default).
- `CONFIG.rubrics` — seven rubrics extracted from `Clasificación Calidad Uva Revisión SL.xlsx`.
- `DataStore.joinBerryWithMediciones()` — attaches medicion row to each berry row by (lot_code, vintage_year).
- `maps.js` — `Calidad (Clasificación)` metric (new default), discrete A+/A/B/C coloring, tooltip per-lot breakdown, detail-panel grade row with cohort percentile and desglose expander.
- `mediciones.js` — new "Madurez fenólica (opcional)" select in form and table column.
- `sql/migration_phenolic_maturity.sql` — adds nullable `phenolic_maturity` column to `mediciones_tecnicas`.
- MT.11 (~30 tests) green. 170/170 node + 12/12 e2e passing.
```

- [ ] **Step 4: Update `PLAN.md`**

Update the Phase 9 status line and mark Stage 4 F9 complete. Add a "Stage 5 — Quality Classification" entry summarizing what shipped (references to commits + spec).

- [ ] **Step 5: Update `CLAUDE.md`**

In the "File Responsibilities" table, add a row:

```markdown
| `classification.js` | Quality rubric scoring and percentile only |
```

Also add the boundary reminder: "Do not add scoring logic to maps.js or dataLoader.js. Do not query Supabase from classification.js."

- [ ] **Step 6: Final commit + push**

```bash
git add TASK.md PLAN.md CLAUDE.md
git commit -m "docs: close F9 — quality classification complete

- TASK.md: F9 marked Done, sub-project 4 added to What Shipped
- PLAN.md: Stage 5 Quality Classification documented
- CLAUDE.md: classification.js added to file-responsibilities table

Spec: docs/superpowers/specs/2026-04-21-quality-classification-design.md
Plan: docs/superpowers/plans/2026-04-21-quality-classification.md"

git push
```

- [ ] **Step 7: Report final status**

```
Quality classification shipped.
- 170/170 node tests
- 12/12 e2e tests
- Default map view: Calidad
- Seven rubrics live (PV-DUR-VON, CS-SY-MAL-MRS-TEM-VON, CS-SY-VDG,
  MER-CF-GRE-CALADOC-VON, GRE-CALADOC-VDG-VSV, SB-VDG-VON,
  CH-CB-SBGR-VDG-VON)
- Madurez fenólica input surface: mediciones form + table column
- Partial-data guard at 60 Imp; unknown variety/valley → "Sin rúbrica"
```

---

## Self-Review

**Spec coverage:**

- §1 Goal — Tasks 4, 6 implement scoring + map rendering. ✓
- §2 Non-goals — No Leaflet / no historical back-fill / no tasting-notes import. ✓
- §3 Scoring engine — Task 4 implements `scoreLot`, §3.1 fields match Task 2 config, §3.2 overlay via `CONFIG.madurezOverlay`, §3.3 formula in `scoreLot`, §3.4 conteo derivation in `scoreSanitaryPct`, §3.5 visual mapping in `CONFIG.sanitaryThresholds.visual`, §3.6 variety-group mapping in Task 2, §3.7 partial-data threshold (60 Imp) in `scoreLot`. ✓
- §4 Data pipeline — Task 5 adds `joinBerryWithMediciones`; Task 6 calls `scoreAll` from `maps.js`. ✓
- §5 Map UX — Task 6 covers metric selector, section rendering, tooltip, detail panel. Task 7 covers CSS + option markup. ✓
- §6 Default map view — Task 6 Step 9 changes `currentMetric` default. ✓
- §7 Percentile ranking — Task 4 `scoreAll` + Task 6 Step 7 surfaces it in detail panel. Cohort toggle (Misma añada vs Todas las añadas) — **not explicitly covered**, deferred as an optional follow-up per spec §7.3 (it's a UI toggle; the engine already supports `{ cohort: 'variety-only' }` for future wiring). Adding a note.
- §8 Madurez input — Task 1 migration + Task 8 form. ✓
- §9 File responsibilities — Matches File Structure section. ✓
- §10 Testing — Task 3 writes MT.11 (30 cases). ✓
- §11 Deferred — explicit non-scope preserved. ✓
- §13 Acceptance criteria — Task 9 Step 2 exercises all 6 listed criteria plus test gates. ✓

**Gap flagged in review:** §7.3 cohort toggle (vintage-variety ↔ all-vintages) is supported at the engine level but not wired into the UI. This is cosmetic since the current dataset has one full vintage only; I've added a follow-up note below.

**Placeholder scan:** No TBDs, TODOs, or "add appropriate error handling" — every code block is complete and runnable. The only placeholder-like item is `<commit-hash>` in Task 9 Step 3, which the builder fills in after running the commits. That's standard.

**Type/signature consistency:**
- `scoreLot` returns `{ grade, score36, rubricId, missing, buckets, madurezAdj, reason }` — matches all callers (`maps.js` uses `grade`, `score36`, `rubricId`; MT.11 tests use `grade`, `score36`, `rubricId`, `missing`, `reason`).
- `scoreAll` returns array of lots with `{ percentile, percentileCohort }` added — `maps.js` reads `percentile` directly.
- `aggregateSection` returns `{ grade, score36, lotCount }` — matches `maps.js` consumer.
- `scoreParam(spec, value) → 1 | 2 | 3 | null` — tests assert this shape.
- `resolveRubric` returns `{ id, ...rubric } | null` — MT.11 uses `r?.id`.
- `resolveValley` returns valley string or null — MT.11 covers this.

---

## Follow-up items (out of scope for this plan)

- **Cohort toggle UI in detail panel** (spec §7.3) — engine supports it (`scoreAll(lots, { cohort: 'variety-only' })`) but the detail panel has no selector. Wire up when ≥2 vintages of data exist.
- **Export grade breakdown in "Exportar Vista"** — spec §11 defers this. Could be added after the map view has been in use for a full vintage.
- **Grade column on data tables (berry / recepción / extracción)** — spec §11 defers until the map view is validated in production.
- **Bulk-edit Madurez for already-imported lots** — spec §8.3. Today requires one-at-a-time edits.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-21-quality-classification.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
