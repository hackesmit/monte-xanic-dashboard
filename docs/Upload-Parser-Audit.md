# Upload Parser Audit — WineXRay CSV & Recepción de Tanque XLSX

Audit of the parse paths under `js/upload/` against real export files, not just
fixtures. Scope: `winexray.js`, `recepcion.js`, `prerecepcion.js`,
`normalize.js`. Out of scope (separate owners): normalization tables in
`config.js` and upsert behavior in `dataLoader.js`.

Bead: **xd-rgg** (2026-08-13). Recon source for the headline finding: **xd-01g**
(branch `xanic-dashboard-wx01-winexray-my-results`, commit `43c84f1`).

Each silent assumption below names the file and line it lives on, and is either
covered by a test or filed as its own bead when the fix is a judgment call
beyond this audit.

---

## 1. FIXED — WineXRay's malformed IPT header shifted every column after it

**Where:** `js/upload/winexray.js`, `fileToRows` (was array-mode `XLSX.read`;
now `decodeCsv` + string-mode at lines 38–55).

**The bug.** WineXRay's export emits the phenolics header UNQUOTED with an
embedded comma:

```
...,Alcohol (% v/v),Total Phenolics Index (IPT, d-less),tANT (ppm ME),...
```

A CSV reader splits that one header cell into two (`Total Phenolics Index (IPT`
and ` d-less)`). SheetJS then pads every row out to the widest row, so the header
row and each data row end up with the **same** field count (59 == 59). That is
the trap: a header-vs-row field-count check — the obvious guard, and the one the
recon suggested — **cannot** see this, because the counts match after padding.

With the header split, every column *after* IPT reads its right-hand neighbour's
value. Measured on `tests/fixtures/winexray_mixed.csv`, row `25CSMX-1`
(true values IPT=55, tANT=623, fANT=420, bANT=212, pTAN=1529, iRPs=2935, L*=67.7):

| field | before fix (corrupt) | after fix (correct) |
|-------|----------------------|----------------------|
| ipt   | undefined (lost to the split) | 55 |
| tant  | 420 | 623 |
| fant  | 212 | 420 |
| bant  | 1529 | 212 |
| ptan  | 2935 | 1529 |
| irps  | 67.7 (this is L*!) | 2935 |

Plausible-but-wrong berry chemistry, no crash — the worst failure mode on this
surface.

**Why it was live.** The legacy path (`dataLoader.processWineXRayFile` →
`dataLoader.loadFile`, `js/dataLoader.js:389`) string-replaces the bare header
with a quoted version on the raw CSV text before handing it to SheetJS. That
shim is **load-bearing and was undocumented as such.** But the *current* manual
upload UI does not use `loadFile`: `UploadManager._startUploadWithParser`
(`js/upload.js:80`) calls `winexrayParser.parse(file)`, which read the bytes
directly in array mode and so **never went through the shim.** Every real WineXRay
upload through the current UI was silently mis-aligning phenolics/color/berry
columns.

**The fix.** `winexray.js` now decodes the CSV to text, strips the BOM, and
applies the same header-quoting repair (`IPT_MALFORMED_HEADER`, guarded against
double-quoting) before parsing in string mode — mirroring `loadFile`. The repair
must happen on the raw text, before SheetJS collapses the field counts.

**Covered by:** `tests/mt13-upload-winexray.test.mjs` —
"keeps every phenolics/berry column aligned despite the unquoted IPT header"
(asserts tANT=623 etc.), plus the corrected "shapes berry rows" test (see §2).

**Follow-up for any future sync:** the planned WineXRay sync (xd-b0e) that
fetches the CSV over HTTP must route through this same repaired parser (or
`loadFile`), never a naive CSV read, or it reintroduces the shift.

---

## 2. FIXED (test) — a pre-existing test was codifying the shift

**Where:** `tests/mt13-upload-winexray.test.mjs`, "shapes berry rows...".

The old assertion `berry.berry_count === 200` was asserting **corrupted** data.
In the fixture the berry row's "Number Of Berries In Sample" cell is empty; 200
is the neighbouring "Weight Of Berries In Sample" value that the IPT shift slid
into `berry_count`. After the repair the true alignment is
`berry_count = null`, `berries_weight_g = 200`,
`berry_anthocyanins_mg_100b = 1.3603`. The test now asserts those, so it proves
alignment instead of freezing the bug.

---

## 3. Confirmed benign — the duplicate anthocyanin header alias

**Where:** `js/config.js:555–556` (`wxToBerry`), also `457–458`.

`CONFIG.wxToBerry` maps BOTH `Berry Extractable Anthocyanins (mg/100b)` and
`Berry (extractable) Anthocyanins (mg/100b me)` to the same field
(`berry_anthocyanins_mg_100b`). The current export emits only the second; the
first is tolerated coverage for an older export spelling. This is **intentional
and harmless**: a real export never carries both columns, and if one somehow did,
the two keys resolve to the same destination field so no data is lost or
mis-routed. No change needed. (Confirming this was an explicit ask of the recon.)

---

## 4. Documented, accepted as-is — WineXRay value markers

- **`js/upload/winexray.js:16,66` — below-detection.** Only the `<N` form
  (`<50`, `<10`) sets `below_detection = true` and NULLs the value. This is a
  regex on the raw cell, so a valid measured number is never mistaken for it.
- **`js/upload/winexray.js:17,69` — above-detection.** `>N` is parsed to the
  bare threshold number (`>1000` → 1000). The "above" semantics and any flag are
  dropped. Accepted: the tool rarely emits `>N`, and a threshold value is a safer
  default than NULL for the downstream averages. Documented so it is not a
  surprise.
- **`js/upload/winexray.js:19,148` — lab-test exclusion.** `LAB_TEST_RE` matches
  the tokens (`WATER`, `CRUSH`, `BLUEBERRY`, …) as substrings, deliberately
  without a word boundary, so compound ids like `WATERBLUEBERRY` are caught. The
  trade-off: a legitimate `sample_id`/`sample_type` that happens to contain one
  of these tokens would be silently excluded. No real sample id in the corpus
  does; accepted, documented here as the known edge.

---

## 5. Filed as beads — latent, fix is a judgment call beyond this audit

### 5a. Recepción header detection is density-based, not content-scored (xd-55v)

**Where:** `js/upload/recepcion.js:25` `findHeaderRow(rows, minNonNull = 5)` —
picks the FIRST row in the first 10 with ≥5 non-null cells.

`prerecepcion.js` was hardened (Vendimia 2026) against exactly this: a dense
banner/title row above the real header now scores zero because its cells don't
resolve to known columns, so the *scored* `findHeaderRow` there ignores it. The
Recepción parser still uses the old **pure-density** rule for BOTH its sheets
(lines 67, 133). If a future Recepción or Prefermentativos workbook grows a dense
title/banner row (as the pre-recepción sheet did), density picks the wrong row
and the parse fails with every required header "missing," or worse, mis-maps.
The real fixtures don't trigger it today, so this is latent, not live — filed
rather than fixed here because porting the scored detector is its own change with
its own tests.

### 5b. `-` / `NA` do not set `below_detection`, contradicting the documented rule (xd-2ae)

**Where:** `js/upload/winexray.js:66–75` + `js/upload/normalize.js:14`.

CLAUDE.md's Upload Pipeline Rules say: *"values `<50`, `<10`, `-`, `NA` → NULL
with `below_detection = true`."* The code only sets `below_detection = true` for
the `<N` form; `-`, `—`, `NA`, `N/A` fall through to `normalizeValue`, which NULLs
them via `EMPTY_MARKERS` **without** setting the flag. Arguably the code is more
correct (a `-` means "not measured," not "below the detection limit"), but code
and the written rule disagree, which is a silent trap for the next agent. Filed
to reconcile the two — either fix the code or fix the rule — because it needs a
domain decision, not just an edit.

---

## Verification

- `npm test` — 544/544 pass (mt13–mt17: 93/93), after the parser fix and the
  corrected/added regression tests.
- Column-alignment claims in §1 were measured directly against
  `tests/fixtures/winexray_mixed.csv` (which carries the real unquoted IPT
  header), before and after the fix.
