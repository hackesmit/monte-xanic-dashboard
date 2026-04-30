# Round 37 — Manual Smoke Checklist

After running `sql/migration_mediciones_audit.sql` in the Supabase SQL Editor and deploying the Vercel preview, verify each of the following:

## As `lab` user

- [ ] Mediciones page renders, table populated, KPIs / charts as expected.
- [ ] Click a `source='form'` row → modal opens. Audit line reads either "Última edición: …" or "Sin ediciones previas". No yellow source banner.
- [ ] Click a `source='upload'` row → modal opens with the yellow "Esta medición fue importada desde Pre-recepción…" banner.
- [ ] Open modal, change Notas → field gets gold left-border. Save button enables.
- [ ] Type "foo" into brix → Save remains disabled (validation), the modal status shows a Spanish error mentioning brix.
- [ ] Hit Cancel with unsaved changes → "Hay cambios sin guardar. ¿Descartar?" confirm fires.
- [ ] Edit a row, click Guardar cambios → modal closes, table updates without page reload, audit line on re-open shows today's date and the lab username.
- [ ] Delete a test row → "¿Eliminar medición …? Esta acción no se puede deshacer." confirm. Confirm → row gone from table; KPI count drops by 1.
- [ ] Type a code in the search input → table narrows to matching rows. KPIs / charts unchanged.
- [ ] Toggle a global Variedad chip → KPIs, charts, AND table all narrow.
- [ ] Click a column header → sort arrow appears, sorts. Click again → arrow inverts.
- [ ] Resize browser to ≤ 720px width → modal stretches to full screen, fields stack.

## As `admin` user

- [ ] Mediciones page renders. No edit form. Rows have no clickable cursor.
- [ ] Migration-drift banner does NOT appear, even if a migration is unrun.
- [ ] Page-export buttons (PNG/PDF) are visible and functional.
- [ ] Attempting POST `/api/upload` from DevTools returns 403.
- [ ] Attempting POST `/api/row` from DevTools returns 403.

## As `viewer` user

- [ ] Mediciones page renders. No edit form. No edit cursor on rows.
- [ ] Page-export buttons are hidden.

## Demo mode (as `lab`)

- [ ] Activate demo. Edit form is hidden. Rows lose clickable cursor.
- [ ] Forcing `Mediciones.openEditModal('SOMECODE')` from DevTools opens the modal.
- [ ] Editing a field and clicking Save → status shows "Modo demo — no se pueden guardar cambios". No network request fires.
- [ ] Deactivate demo → write paths return.

## Migration drill (Round 36 guardrail)

- [ ] Before the SQL migration is run, the lab account's drift banner names `migration_mediciones_audit` as missing.
- [ ] After running the migration in Supabase SQL Editor, the banner clears.
- [ ] If the deploy lands BEFORE the migration runs, edits still succeed but `last_edited_at` and `last_edited_by` are NULL — the columns are nullable. Re-edit after migration completes; the audit line populates.
