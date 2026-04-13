# Code Review — Monte Xanic Dashboard

> All findings from Rounds 1–10 have been resolved. Waves 1–7 merged to main. Phase 7 implemented 2026-04-08.
> See TASK.md for the complete resolution table.
> Read `CLAUDE.md` first for full project context.

---

## Round 10 — Branch `feature/wave3-wave4-fixes` (2026-04-07)

**Scope:** 4 commits (04cb435..54b63fc) — 20 files changed, +498 / −538 lines.
**Areas:** API refactor (shared verifyToken/rateLimit), weather multi-valley charts, GDD chart, sample_seq duplicate handling, extraction filter fix, login double-submit fix, radar chart removal, CSS cleanup.

---

### Priority 1 — Issues

**P1.1 — Harvest calendar weather overlay ignores valley selector**
`js/charts.js:1409` — `createHarvestCalendar` calls `WeatherStore.getRange()` without passing a `location` parameter, so it always uses `'VDG'` regardless of the valley selector (`Filters.state.weatherLocation`). Unlike the other weather charts which were updated to accept a `location` parameter, this one was missed.

**P1.2 — `clearAll()` does not reset `weatherLocation` or valley selector UI**
`js/filters.js:205-221` — `clearAll()` resets vintages, varieties, origins, lots, grapeType, and colorBy but never resets `state.weatherLocation` back to `'VDG'`. Nor does it reset the `#weather-valley-select` dropdown or the `#weather-section-title` text. After "Limpiar Todo", the valley selector shows VON/SV while state may drift from the displayed default.

**P1.3 — `logout.js` accepts any token for blacklisting without verifying identity**
`api/logout.js:14-16` — The endpoint accepts any arbitrary string in `req.body.token`, hashes it, and writes it to `token_blacklist`. An attacker could spray forged token hashes into the blacklist table. The rate limiter (60/15min) reduces but doesn't eliminate this. Consider verifying the token's HMAC signature before blacklisting.

**P1.4 — Untracked files should not be committed**
`RESUMEN_2026-04-06.txt` and `PROJECT_SUMMARY.md` are untracked and not in `.gitignore`. The RESUMEN file contains internal task details and planned next steps. `PROJECT_SUMMARY.md` (576 lines) is a full architecture overview including auth flow, API endpoints, and table schemas. If accidentally committed, both would be publicly accessible. Add `RESUMEN*.txt` and `PROJECT_SUMMARY.md` to `.gitignore` and `.vercelignore`.

---

### Priority 2 — Improvements

**P2.1 — Jitter logic duplicated in two places**
`js/charts.js:198-208` (scatter chart) and `js/charts.js:567-577` (vintage comparison) contain identical jitter code (sampleSeq offset + hash-based lot jitter). Extract to a shared helper like `_applyDaysJitter(x, d)` to avoid divergence.

**P2.2 — Rate limit applied before auth on all authenticated endpoints**
`api/config.js:12`, `api/upload.js:20`, `api/verify.js:12`, `api/logout.js:12` — All four endpoints run `rateLimit(req, res)` before `verifyToken()`. Unauthenticated garbage requests consume the IP's rate-limit bucket, potentially locking out legitimate users sharing the same IP (corporate NAT). Consider swapping the order: verify auth first, then rate-limit authenticated users. `api/config.js` is the most impactful since it's called on every page load.

**P2.3 — In-memory rate limiter never evicts unless bucket count exceeds 500**
`api/lib/rateLimit.js:19` — Stale entries are only swept when `buckets.size > 500`. Under normal traffic patterns this threshold is never reached. Since Vercel serverless functions have short lifetimes this is low-risk, but a periodic sweep (e.g., every 100 inserts) or a TTL-based Map would be cleaner.

**P2.4 — Weather sync re-renders charts even when no new data fetched**
`js/events.js:46-49` — When the selected valley has no cached data, `WeatherStore.sync(vintages).then(renderWeather)` fires. The sync guard (`_isSyncing`) prevents double-fetch, but `.then(renderWeather)` re-renders a second time even if sync found no new rows. Only triggers when switching to an un-cached valley, not on every dropdown change. Consider re-rendering only if sync actually fetched new rows (e.g., return a `changed` boolean from sync).

**P2.5 — `valleyVintage` fallback picks last known weather vintage, not last berry vintage**
`js/app.js:335` — When no vintage filters are active, `valleyVintage` falls back to `WeatherStore.getVintagesFromData().slice(-1)[0]`. This may differ from the berry data's latest vintage. Using `DataStore.berryData` to derive the latest vintage would be more intuitive.

**P2.6 — `.vercelignore` missing `RESUMEN*.txt` and `PROJECT_SUMMARY.md` patterns**
`.vercelignore:6` — Has `REPORTE_DASHBOARD.txt` but neither `RESUMEN*.txt` nor `PROJECT_SUMMARY.md`. Both would slip through to production if committed.

---

### Missing Tests

- **MT.1** — No test for `sample_seq` assignment in `upload.js`. Verify that multiple rows with the same `(sample_id, sample_date)` get incrementing `sample_seq` values (1, 2, 3...).
- **MT.2** — No test for the jitter function in `charts.js`. The hash-based jitter should be deterministic (same lot always produces same offset).
- **MT.3** — No test for `verifyToken()` shared module. Critical auth code — unit tests should cover: valid token, expired token, invalid signature, missing token, blacklisted token, fetch failure (fail-open behavior).
- **MT.4** — No test for `rateLimit()`. Should verify that requests within the window pass, and requests exceeding `maxRequests` get 429.
- **MT.5** — No test for the valley selector flow. Switching valleys should update `Filters.state.weatherLocation`, re-render charts, and sync if needed.

---

### Notes

- **Radar chart removal** (`charts.js`, `index.html`) — cleanly done, no orphaned references remain. CSS classes `brand-top`, `brand-name`, `brand-divider`, `brand-sub`, `extraction-grid`, `extraction-card`, `ext-bar*` were all unused in HTML/JS. Clean removal.
- **Token verification refactor** (`api/lib/verifyToken.js`, `api/lib/rateLimit.js`) — good DRY improvement. Three endpoints now share the same code path. The fail-open behavior on blacklist check failure is an intentional availability choice, documented in the code.
- **Migration script** (`sql/migration_sample_seq.sql`) — correct: adds column with default, drops old constraint, creates new composite unique. Note: the `DROP CONSTRAINT IF EXISTS` uses a guessed constraint name (`wine_samples_sample_id_sample_date_key`) — verify the actual constraint name in Supabase before running.
- **Login double-submit fix** (`js/auth.js`) — `_formBound` guard prevents duplicate event listeners. The `click` listener on `#login-btn` was redundant with the `submit` listener on `#login-form`, so removing it is correct.
- **Extraction table filter fix** (`js/app.js:582-593`) — now uses `Filters.getFiltered()` / `Filters.getFilteredWine()` instead of unfiltered `DataStore` arrays. Correct behavioral fix.
- **GDD chart** (`js/charts.js:1255-1351`) — correctly uses base-10 C, accumulates from Jul 1, caps at today for current year. No off-by-one issues.
- **Diff size** is reasonable (498+ / 538-) for the scope of changes. No unrelated file edits detected.

---

### Review of Uncommitted Documentation Changes (Round 10.1)

**Scope:** 3 modified files (PLAN.md, REVIEW.md, TASK.md), 2 untracked files (PROJECT_SUMMARY.md, RESUMEN_2026-04-06.txt). Documentation only — no source code changes.

**PLAN.md** — Rewritten from "all complete" status to a staged plan with Wave 6 (P1 fixes) and Wave 7 (P2 improvements), plus Stage 2 for Phase 7. Historical completed work collapsed into `<details>`. Structure is sound and tasks map correctly to REVIEW.md findings. Line references are accurate.

**REVIEW.md** — Replaced ~930 lines of historical rounds (1–18) with a compact 73-line Round 10 summary. All P1 and P2 findings verified against source code:
- P1.1: Confirmed — `charts.js:1409` has no location param.
- P1.2: Confirmed — `filters.js:205-221` never resets `weatherLocation`.
- P1.3: Confirmed — `logout.js:14-16` does no HMAC verification before blacklisting.
- P1.4: Confirmed — `RESUMEN_2026-04-06.txt` not in `.gitignore`. However, `PROJECT_SUMMARY.md` (also untracked, 576 lines, contains architecture details) was not mentioned — added as finding.
- P2.1: Confirmed — identical jitter code at lines 198-208 and 567-577.
- P2.2: Confirmed — `config.js:12` runs rateLimit before verifyToken on line 15. However, the same pattern exists in ALL four authenticated endpoints, not just `config.js` — expanded finding.
- P2.3: Confirmed — `rateLimit.js:19` checks `buckets.size > 500`.
- P2.4: Partially correct — the original wording "may fire on every dropdown toggle" is misleading. The sync+re-render only fires when `!hasData` for the selected valley (line 46-48), not on every toggle. Corrected wording.
- P2.5: Confirmed — `app.js:335` uses `WeatherStore.getVintagesFromData()`.
- P2.6: Confirmed — `.vercelignore` has no RESUMEN pattern.

**TASK.md** — Updated to "Round 10 Fixes Pending" with open items table matching REVIEW.md. Historical items collapsed into `<details>`. Cross-references are consistent.

**Untracked files:**
- `PROJECT_SUMMARY.md` (576 lines) — full architecture overview with auth flow, API endpoints, rate limit thresholds, table schemas. No credentials. Low risk but should be in `.gitignore` + `.vercelignore`.
- `RESUMEN_2026-04-06.txt` (26 lines) — Spanish work summary. No credentials. Already flagged in P1.4.

**No issues found in the documentation changes themselves.** The consolidation from ~930 lines to ~73 lines is clean — no information loss for actionable items. All historical context is preserved in git history (prior commits).

---

## Round 11 — Branch `main` (2026-04-13)

**Scope:** 5 recent commits (`82b1d1a..e5f5b03`) — all documentation/housekeeping. 1 uncommitted source change in `js/charts.js`.
**Uncommitted diff:** 2 files changed, +37 / −39 lines.

---

### Priority 1 — Issues

**P1.1 — `_lotLinePlugin` deleted from `js/charts.js` — lot-connecting lines feature silently removed**
- **File:** `js/charts.js:38-76` (deleted), `js/charts.js:257` (changed)
- The entire `_lotLinePlugin` object (39 lines) has been deleted, and the scatter chart's `plugins` array changed from `[this._lotLinePlugin]` to `[]`.
- This plugin drew thin lines connecting same-lot data points in scatter charts — a feature explicitly added in commit `a6d7ba8` ("feat: Wave 2 — lot-connecting lines, native legends, color redistribution, export error handling").
- **Impact:** All scatter charts (Brix vs Días, pH vs Días, etc.) will no longer show lot-connecting lines. This is a user-visible regression.
- **Orphaned comment:** Line 40 now reads `// Chart.js per-chart plugin: draw thin lines connecting same-lot points within each dataset` immediately followed by `_getThemeColor()`, which has nothing to do with lot lines. The comment is stale.
- **Recommendation:** If the removal is intentional (performance, visual clutter), commit it with an explicit message like `remove: lot-connecting line plugin`. If accidental, restore the plugin. Either way, don't leave the orphaned comment.

---

### Priority 2 — Improvements

**P2.1 — Untracked logo file with copy-number suffix in project root**
- **File:** `Logotipo_corporativo_MX_amarillo-01 (1).png` (64 KB)
- The filename contains a space and parenthesized copy number `(1)`, indicating a duplicate download. File is in the project root, not in `assets/` where other images live.
- This was previously untracked from git in commit `5eedc09` but the file was kept on disk. It remains untracked and should either be moved to `assets/` (renamed) or deleted.

**P2.2 — Recent commits are documentation-only — no source regression, but doc split should be verified**
- Commits `82b1d1a..e5f5b03` created 13 new docs under `docs/` and reduced `CLAUDE.md` from ~527 to ~97 lines.
- The `.vercelignore` correctly excludes `docs/` (added in `5eedc09`).
- No source code (`.js`, `.html`, `.css`) was touched in these 5 commits — confirmed clean.

---

### Missing Tests

- **MT.6** — No test verifies that scatter charts render with the `_lotLinePlugin` (or renders correctly without it). Since the plugin is being removed, this is a gap — there's no way to catch this regression automatically.

---

### Notes

- **Uncommitted REVIEW.md changes** are from a prior review session (Round 11 placeholder). These will be overwritten by this review — no data loss concern.
- **Prior Round 10 findings** (P1.1–P1.4, P2.1–P2.6, MT.1–MT.5) remain documented above. Their resolution status should be tracked in TASK.md.
- The `PROJECT_SUMMARY.md` and `RESUMEN_2026-04-06.txt` files flagged in P1.4 (Round 10) are no longer present — resolved.
- The 5 recent commits follow consistent conventions: descriptive messages, `Co-Authored-By` trailers, clean separation of docs from code changes. No issues with commit hygiene.
