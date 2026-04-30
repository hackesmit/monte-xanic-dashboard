# Mediciones Técnicas — Edit, Delete & Interactive Table

**Round:** 37 (pilot)
**Author:** danielfhack
**Date:** 2026-04-29
**Status:** Design — pending implementation plan

## 1. Goal

Let `lab` users **edit and delete** rows in the Mediciones Técnicas table from
the dashboard, and make the table itself **more interactive** (visible sort
arrows, hover affordance, text search, global-filter integration). This round
ships only the `mediciones_tecnicas` pilot; later rounds extend the same
pattern to other editable tables.

A coherent role-permission rework rides along, since editing without role
discipline would leave the permission matrix in a contradictory state.

## 2. Non-goals

- No edit/delete for other tables this round (recepciones, prefermentativos,
  wine_samples, berry_samples). Server endpoint is built generically; client
  UX stays bespoke until a second concrete consumer exists (Approach 3).
- No range bounds on numeric fields (e.g. "brix must be 0–35"). Today's
  parsers don't enforce range either; adding range bounds is a separate
  proposal that needs lab input on the right cutoffs.
- No soft delete. Hard delete with confirm dialog.
- No optimistic-concurrency / `version` column. Last-write-wins.
- No multi-column sort. No per-column filter dropdowns. No saved filter
  presets.
- No batch edit endpoint. One row per request.
- No full audit log table. Lightweight `last_edited_at` / `last_edited_by`
  stamp on the row.

## 3. Architectural choice

**Approach 3 — generic server, bespoke client.**

The `/api/row` endpoint is built generically from day one (the contract is
expensive to refactor later). Client-side, the modal/dirty-state code lives
in `mediciones.js`; we wait for a second concrete consumer (e.g. recepciones)
before extracting a shared `rowEditor.js`.

Shared infrastructure that genuinely benefits both parsers and the modal —
the column-type definitions in `js/validation.js` — is factored now.

## 4. Permission matrix

| Capability | viewer | lab | admin | Today |
|---|:-:|:-:|:-:|---|
| View any panel | ✓ | ✓ | ✓ | unchanged |
| Export PNG / PDF / XLSX | ✗ | ✓ | ✓ | gate is **new**; today export is open |
| Upload (`/api/upload`) | ✗ | ✓ | ✗ | admin **loses** upload |
| Edit / delete (`/api/row`) | ✗ | ✓ | ✗ | new |
| Migration-drift banner | ✗ | ✓ | ✗ | admin **loses** banner |

Server is the authoritative gate (`api/upload.js`, `api/row.js`, future
`api/migrations-status.js`). Client-side gates in `auth.js` (`canWrite()`,
`canExport()`) are cosmetic — they hide controls so users don't see things
they can't use.

## 5. Schema migration

**File:** `sql/migration_mediciones_audit.sql`

```sql
ALTER TABLE public.mediciones_tecnicas
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

INSERT INTO public.applied_migrations (name)
  VALUES ('migration_mediciones_audit')
  ON CONFLICT (name) DO NOTHING;
```

Both columns NULLable — historical rows have no edit history, which is
correct. Per the Round 36 guardrail, append `'migration_mediciones_audit'`
to the `MIGRATIONS` array in `js/migrations-manifest.js`. The audit columns
are written server-side from the verified session payload and ignored if
present in the request body.

## 6. Server: `/api/row.js`

One file, one endpoint, two actions (`update` and `delete`). Mirrors the
shape of `api/upload.js` so anyone who has read the existing code recognises
the structure.

### Request shape

```json
{
  "table":  "mediciones_tecnicas",
  "action": "update",
  "row":    { "medicion_code": "MT-2025-001", "berry_avg_weight_g": 1.92 }
}
```

- `update`: PATCH semantics. The body contains the conflict-key column(s)
  plus only the fields being changed. The dirty-state tracker on the client
  sends partial payloads, so we never accidentally clobber a field the user
  didn't touch.
- `delete`: body contains only the conflict-key column(s).

### Pipeline

1. Set `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Reject
   non-POST with 405.
2. `rateLimit(req, res, { maxRequests: 30 })` — same bucket as upload.
3. `verifyToken(token, { checkBlacklist: true })`. 401 on failure.
4. **Role gate: `lab` only.** 403 for viewer and admin.
5. Validate `table` is in the existing `ALLOWED_TABLES` whitelist (single
   source of truth — reused, not duplicated).
6. Strip unknown columns from `row` (same loop as upload).
7. Look up `ALLOWED_TABLES[table].conflict`, split on comma. For
   `mediciones_tecnicas` it's `medicion_code`; for future tables like
   `wine_samples` it's `sample_id,sample_date,sample_seq`. Build the
   Supabase REST filter `?col1=eq.<v1>&col2=eq.<v2>&...`. Reject 400 if any
   conflict-key column is missing from `row`.
8. `validateRow(table, row, { action })` — see §7. 400 on failure with the
   field-keyed Spanish error.
9. **For `update`:** server overwrites
   `last_edited_at = new Date().toISOString()`,
   `last_edited_by = result.payload.username`. The client cannot forge
   these values.
10. Send PATCH (or DELETE) to Supabase REST:
    - `PATCH ${SUPABASE_URL}/rest/v1/${table}?<filter>` with header
      `Prefer: return=representation` so the response carries the updated
      row.
    - `DELETE ${SUPABASE_URL}/rest/v1/${table}?<filter>` with
      `Prefer: return=minimal`.
11. Response envelope:
    - Update: `{ ok: true, row: <updated row> }`
    - Delete: `{ ok: true, deleted: <count> }`
    - Error: `{ ok: false, error: "<Spanish message>" }`

### What the endpoint does NOT do

- No batch operations. One row per request.
- No optimistic-concurrency check.
- No soft-delete.
- No demo-mode awareness — demo is a client-side overlay.

## 7. Validation module: `js/validation.js`

Pure ESM, runs in both Node (server) and browser (client). One source of
truth for which columns are INT vs NUMERIC, replacing inline definitions in
`js/upload/prerecepcion.js`, `winexray.js`, `recepcion.js`.

```js
import { validateColumnTypes } from './upload/normalize.js';

export const COLUMN_TYPES = {
  mediciones_tecnicas: {
    intCols: new Set([
      'vintage_year', 'berry_count_sample',
      'health_madura', 'health_inmadura', 'health_sobremadura',
      'health_picadura', 'health_enfermedad', 'health_quemadura',
      'total_bins', 'health_pasificada', 'health_aceptable',
      'health_no_aceptable',
    ]),
    numericCols: new Set([
      'tons_received', 'berry_avg_weight_g', 'berry_diameter_mm',
      'bin_temp_c', 'truck_temp_c', 'bunch_avg_weight_g',
      'berry_length_avg_cm', 'berries_200_weight_g',
      'brix', 'ph', 'at', 'ag', 'am',
      'polifenoles', 'catequinas', 'antocianos',
    ]),
    requiredOnInsert: new Set([
      'medicion_code', 'medicion_date', 'vintage_year',
      'variety', 'appellation',
    ]),
  },
  // future tables added in later rounds
};

export { validateColumnTypes };

export function validateRow(table, row, { action = 'update' } = {}) {
  const spec = COLUMN_TYPES[table];
  if (!spec) return { ok: false, error: `Tabla no soportada: ${table}` };

  const typeError = validateColumnTypes(row, spec);
  if (typeError) return { ok: false, error: typeError };

  if (action === 'insert') {
    for (const f of spec.requiredOnInsert) {
      if (row[f] === undefined || row[f] === null || row[f] === '') {
        return { ok: false, error: `Campo requerido: ${f}` };
      }
    }
  }
  return { ok: true };
}
```

Existing parsers refactor to import `COLUMN_TYPES.mediciones_tecnicas` (and
similar) instead of defining intCols / numericCols inline. Behaviour is
unchanged; the diff is mechanical.

The edit modal calls `validateRow()` before enabling Save, surfacing
field-keyed Spanish errors. The server calls the same function as the
authoritative gate.

Range bounds (e.g. brix 0–35) are NOT enforced — see §2 non-goals.

## 8. Client: edit/delete modal

### Trigger

`mediciones.js:renderTable()` adds `class="row-clickable"` to each `<tr>` iff
`Auth.canWrite() && !DemoMode.isActive()`. Click handler in `events.js`
calls `Mediciones.openEditModal(rowId)`. Without that class the row isn't
hoverable / clickable.

### Modal markup

`index.html` adds one `<dialog id="med-edit-modal">` block (~80 lines, mostly
a clone of the existing `#medicion-form` field markup). Field IDs are
prefixed `med-edit-` to avoid collision with the create form. Mobile: modal
fills the viewport at `≤720px`.

### Modal contents (top to bottom)

1. **Header** — `Editar medición · <medicion_code>`. Below the title, a
   one-line audit stamp:
   - If `last_edited_at` is set: `Última edición: 2026-04-29 14:23 por <user>`
   - Else: `Sin ediciones previas`
2. **Source banner** — visible only when `source === 'upload'`:
   *Esta medición fue importada desde Pre-recepción. Si el archivo origen
   se vuelve a subir, los cambios se sobrescribirán.*
3. **Form fields** — pre-populated. Same layout as the create form
   (codigo, fecha, vendimia, variedad, origen, lote, toneladas, peso baya,
   diámetro, sorteo sanitario × 6, grado, madurez fenólica, medido por,
   notas).
4. **Footer** — left: red `Eliminar`. Right: `Cancelar` + gold
   `Guardar cambios` (primary). Save disabled until at least one field is
   dirty AND `validateRow()` passes. Inline status text.

### Dirty-state tracking

Opening the modal deep-clones the row into `Mediciones._editInitial`. On
every input event, current values are compared to `_editInitial`. Dirty
fields get a subtle gold left-border (`.field-dirty`). Save is disabled
while clean.

Closing a dirty modal triggers a Spanish confirm:
*Hay cambios sin guardar. ¿Descartar?*

### Save flow — `Mediciones.submitEdit()`

1. Build `row = { medicion_code, ...changedFields }` (only dirty fields plus
   the conflict key).
2. Run `validateRow('mediciones_tecnicas', row, { action: 'update' })`. On
   failure, show the field-keyed error inline; don't submit.
3. POST `/api/row` with `{ table, action: 'update', row }`.
4. **On 200:** replace the matching entry in `DataStore.medicionesData`
   (matched by `medicion_code`) with `response.row`. Call
   `Mediciones.refresh()` to re-render KPIs / charts / table. Close modal.
   Toast: `Medición actualizada`.
5. **On non-200:** show server's Spanish error in the modal status; modal
   stays open; no data mutation.

### Delete flow — `Mediciones.submitDelete()`

1. Spanish confirm:
   *¿Eliminar medición `<medicion_code>`? Esta acción no se puede deshacer.*
2. POST `/api/row` with `{ table, action: 'delete', row: { medicion_code } }`.
3. **On 200:** remove the entry from `DataStore.medicionesData`. Refresh.
   Close modal. Toast: `Medición eliminada`.
4. **On non-200:** show error inline; modal stays open.

### Files touched

| File | Change |
|---|---|
| `index.html` | + `<dialog id="med-edit-modal">` block, + table toolbar with search input |
| `js/mediciones.js` | + `openEditModal`, `_collectDirty`, `submitEdit`, `submitDelete`, `_closeModal`, `_renderAuditLine`, `_renderSourceBanner`, `_applyGlobalFilters`, `_applySearch`, sort-arrow `aria-sort` toggle |
| `js/events.js` | + row-click, modal close (ESC / backdrop / X / Cancel), Eliminar binding, search-input listener, global-filter-change listener |
| `js/auth.js` | + `canWrite()`, `canExport()` helpers; remove `admin` from migration-banner gate |
| `api/row.js` | new file |
| `api/upload.js` | role gate becomes `lab`-only (admin loses upload) |
| `js/validation.js` | new file |
| `js/upload/{prerecepcion,winexray,recepcion}.js` | mechanical refactor — import `COLUMN_TYPES` from `validation.js` |
| `sql/migration_mediciones_audit.sql` | new |
| `js/migrations-manifest.js` | append `'migration_mediciones_audit'` |
| `css/styles.css` | + modal shell, `.field-dirty`, `.row-clickable`, source banner, sort arrows, hover row, table toolbar, mobile modal |

## 9. Table interactivity

### Sort arrows (`aria-sort`-driven)

After every `renderTable()`, `mediciones.js` clears `aria-sort` on every
`<th data-sort>` and sets it on the active column to `ascending` or
`descending`. CSS renders the arrow as `::after`. Free a11y bonus — screen
readers announce sort state.

### Hover + clickable affordance

```css
.data-table tbody tr.row-clickable { cursor: pointer; }
.data-table tbody tr:hover         { background: rgba(212, 175, 55, 0.08); }
```

`row-clickable` is added by `renderTable` only when `Auth.canWrite() &&
!DemoMode.isActive()`.

### Search box

Single `<input type="search" id="med-search">` above the table inside a
`.table-toolbar`. Debounced 200ms. Case-insensitive substring match against
`code`, `variety`, `appellation`, `lotCode`, `notes`, `measuredBy`.

**Search applies to the table only** — not to KPIs or charts. Rationale:
typing one code to find a row shouldn't collapse the page-wide aggregates
to N=1.

### Global filter wire-in

Today `mediciones.js:refresh()` reads raw `DataStore.medicionesData`. New
pipeline:

```
DataStore.medicionesData          (raw)
  → applyGlobalFilters             (variety / vintage / origen / dateRange)
  → updateKPIs(filtered)
  → renderCharts(filtered)
  → applySearch(filtered)          (table-only)
  → sort(filtered)
  → renderTable(filtered)
```

Global filters narrow the entire page consistently with the rest of the
dashboard. Search narrows only the table.

`mediciones.js` adds a small `_applyGlobalFilters(rows)` that reads from
`filters.js`. If the existing filters API doesn't expose a usable getter,
the implementation phase adds a 5-line one.

### Empty state

The existing `#med-no-data` message text becomes context-aware:

- No filters, no search → *No hay mediciones registradas. Use el formulario
  para agregar la primera.*
- Filters or search active → *No hay mediciones que coincidan con los
  filtros actuales.*

## 10. Demo-mode handling

`js/demoMode.js` already toggles `body.classList.add('demo-mode-active')`
and exposes `DemoMode.isActive()`.

**CSS hides write controls:**

```css
body.demo-mode-active #medicion-form,
body.demo-mode-active .row-clickable { display: none; cursor: default; }
```

**Runtime guard inside submit functions:**

```js
if (DemoMode.isActive()) {
  this._setStatus('Modo demo — no se pueden guardar cambios', 'error');
  return;
}
```

Goes in `submitForm`, `submitEdit`, `submitDelete`. Mirrors the existing
upload guard.

The server endpoint is not demo-aware; the runtime guard is the only
defense if some future code path bypasses the CSS hiding.

## 11. Testing

Test files follow the project convention `tests/mtNN-<desc>.test.mjs` and run
under Node's built-in test runner (`npm test`). Numbering picks up after
the highest existing `mt17-…`.

### Unit

- `tests/mt18-validation.test.mjs`
  - Accepts a valid row.
  - Rejects type-mismatched values (e.g. `brix: "foo"`).
  - On `action: 'insert'`, requires `medicion_code`, `medicion_date`,
    `vintage_year`, `variety`, `appellation`.
  - On `action: 'update'`, does NOT require non-key fields.
- `tests/mt19-mediciones-edit.test.mjs`
  - Dirty math: no edits → `changedFields` empty; one edit → exactly that
    field; reverting an edit clears it.
  - Source banner shown only when `source === 'upload'`.
  - Sort-arrow `aria-sort` toggles correctly across header clicks.

### API integration

- `tests/mt20-api-row.test.mjs`
  - 401 without token / blacklisted token.
  - 403 for `viewer` and `admin`.
  - 400 for unknown `table`, missing conflict key, type-invalid fields,
    unknown `action`.
  - 200 update returns the row with server-set
    `last_edited_at` / `last_edited_by`; client-supplied values for those
    columns are ignored.
  - 200 delete returns `{ ok: true, deleted: 1 }`. Deleting a non-existent
    code returns `{ ok: true, deleted: 0 }`.
- Existing `tests/mt16-upload-controller.test.mjs` (or whichever covers the
  upload role gate) updated: 403 for `admin` after the role-rework.

### End-to-end (Playwright)

- `tests/e2e/mediciones-edit.spec.mjs` — happy-path edit + delete flows for
  a `lab` user, plus the "no edit affordance" check for `admin` and
  `viewer`. Optional in this round if the e2e harness needs new fixtures;
  manual walkthrough below covers the same ground.

### Manual UI walkthrough

- As `lab`: edit a `form` row → save → table / KPIs / charts update without
  reload, audit line shows `Última edición: <today> por <username>`.
- As `lab`: edit an `upload` row → yellow source banner visible.
- As `lab`: delete a row → confirm dialog → confirm → row gone.
- As `lab`: open modal, change a field, hit Cancel → discard-confirm fires.
- As `lab`: type `foo` in brix → Save disabled, Spanish field error.
- As `admin`: page renders, no edit affordance, no upload form, no
  migration banner.
- As `viewer`: page renders, no export buttons.
- Activate demo mode as `lab`: write controls hide, search still works.
- Mobile (≤720px): modal full-screen, fields stack.

### Migration drill (Round 36 guardrail)

1. Run `migration_mediciones_audit.sql` in Supabase SQL editor before
   deploying.
2. Verify drift banner clears for `lab` users.
3. If a deploy precedes the migration, the existing drift banner names the
   missing file. The editor still works because the audit columns are
   NULLable and the parser sends them as part of the partial-payload
   `update`.

## 12. Rollout plan

1. Schema migration (Supabase SQL editor).
2. Deploy code change.
3. Smoke test as each of `lab`, `admin`, `viewer`.
4. Activate demo mode and verify write paths are sealed.
5. Announce to lab users (Spanish): editing instructions + warning about
   editing upload-source rows.

## 13. Future rounds (out of scope here)

- **Round 38:** port edit/delete to `tank_receptions` and `prefermentativos`
  (recepciones page). At this point we have two concrete consumers and can
  factor a frontend `js/rowEditor.js` framework.
- **Round 39:** port to `wine_samples` (Berries page). May need composite
  conflict-key UI (`sample_id` + `sample_date` + `sample_seq` are all part
  of the row identity).
- Range bounds for numeric fields, lab-defined.
- Soft delete, if accidental hard deletes become a real problem.
- Full audit-log table, if regulatory needs grow.
