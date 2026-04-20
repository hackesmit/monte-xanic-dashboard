> **ARCHIVED — PRIMARY FINDINGS RESOLVED in Phase 8 (commits up to `3c2b8e8`).**
> The berry-identity section of this handoff (non-deterministic `sample_seq`, weak
> `sample_id`, collapsed lots, `buildBerryIdentity()` recommendation) is already shipped
> as `js/identity.js` with MT.1–MT.7 test coverage; see `REVIEW.md` Rounds 13–16. Other
> sections (rate limiting, RLS, trust-model concerns) remain as separate ongoing security
> topics and are **not** picked up from this doc — they have their own tracking in current
> review rounds. Preserved here for historical context only.
> **Do not treat the berry-identity "must add" recommendations below as open items.**

---

# Codex Codebase Review Consolidated Handoff

## Purpose

This document consolidates the four Codex review outputs into one deduplicated handoff for Claude Code. It is optimized for execution, not discussion.

## Executive Summary

The primary defect is **not just** that some berry rows arrive with `sample_id = '25'`. The deeper problem is that berry identity in the upload pipeline is **non-deterministic** because the production upsert key includes `sample_seq`, and `sample_seq` is assigned from input row order in `parseWineXRay`. That makes uploads non-idempotent and can silently overwrite or remap records when the same file is re-uploaded in a different order.

The second major issue is architectural drift: the temporary client-side parse path and the server upload parse path do not share the same normalization and identity rules, so the same source file can behave differently depending on the path used.

The third major issue is server-side trust: `/api/upload` appears to validate table names and row counts, but not strict per-table row schema, which is too permissive for a service-key write path.

## Highest-Priority Findings

### 1) Berry upload identity is unstable
- **Severity:** Critical
- **Confidence:** High
- **Why it matters:** current berry identity is order-dependent, so re-uploads can silently mutate meaning or overwrite rows.
- **Evidence:**
  - server upserts `wine_samples` on `(sample_id, sample_date, sample_seq)`
  - `sample_seq` is assigned by parser row order within `(sample_id, sample_date)`
  - weak berry IDs such as `'25'` are not sufficient business identity on their own
- **Consequence:** row order changes can produce different keys for the same logical rows

### 2) Diagnosis is correct, but incomplete
- **Severity:** Critical
- **Confidence:** High
- **Why it matters:** the reported `sample_id='25'` issue is real, but the deeper defect is using row-order-derived `sample_seq` as identity.
- **Missing pieces in the original diagnosis:**
  - duplicate preview logic does not match the real conflict key
  - temp upload and server upload follow different parsing paths
  - null or weak identity fields create additional collision risk

### 3) Client and server parsing diverge
- **Severity:** High
- **Confidence:** High
- **Why it matters:** identical source files can produce different semantics depending on whether they go through temp parsing or DB upload parsing.
- **Evidence:**
  - temp path uses `parseBerrySheet` / `parseWineFromXRay`
  - upload path uses `parseWineXRay`
  - field mapping, normalization, and identity behavior differ across paths

### 4) Lot derivation collapses weak berry IDs
- **Severity:** High
- **Confidence:** High
- **Why it matters:** grouping and chart logic rely on `lotCode || sampleId`, and `extractLotCode('25')` can return an empty string.
- **Consequence:** lots can collapse into one pseudo-lot in the UI and time-series views

### 5) Upload endpoint lacks strict row schema validation
- **Severity:** High
- **Confidence:** High
- **Why it matters:** `/api/upload` appears to accept raw row objects for allowed tables and forwards them through a privileged write path without strict per-field validation.
- **Consequence:** malformed or unexpected payloads can cause integrity drift and widen the abuse surface

## Root Cause Analysis

### Confirmed flow
1. CSV is parsed in `UploadManager.parseWineXRay`
2. parser maps CSV fields and retains raw `sample_id`
3. parser assigns `sample_seq` by encounter order within `(sample_id, sample_date)`
4. client posts rows to `/api/upload`
5. server upserts using conflict key `(sample_id, sample_date, sample_seq)`
6. load path maps rows into berry objects and derives `lotCode` from `sampleId`
7. charts and grouping use `lotCode` or `sampleId`

### Where identity is lost
Identity is lost at the **normalization/parsing stage**, because berry rows may retain non-informative source IDs and then gain an order-derived `sample_seq`, which the server later treats as persistent identity.

### Practical consequence
The system is **non-idempotent** for berry uploads. Re-uploading the same semantic data in a different order can yield different DB identity mappings.

## Edge Cases That Need Explicit Coverage

- Re-uploading the same file with rows reordered
- Missing or null `sample_date`, which can collapse grouping buckets
- Mixed `Berry` vs `Berries` labeling across parser and loader paths
- Existing historical rows already stored with ambiguous berry IDs
- Preview counts showing “new vs updated” when the preview key does not match the real DB conflict key

## Best Fix

### Recommended approach
Implement **deterministic berry identity at normalization time**, and make all downstream logic use that identity consistently.

### What this means
- Build a canonical berry identity for berry rows when the raw `sample_id` is weak or ambiguous
- Stop using raw row order as business identity
- Use one shared normalizer for temp and server upload paths
- Align duplicate detection, lot derivation, and upsert semantics to the same identity contract

### Recommended canonical berry identity
For `sample_type in ('Berry', 'Berries')`, if the incoming `sample_id` is non-informative, derive a canonical ID from stable business fields, for example:

`{vintage}{variety_code}{appellation_code}-{lot_or_vessel_or_fallback}`

If no true lot token exists, use a deterministic fallback based on stable row attributes, not parser order. A stable hash of a normalized tuple is acceptable as a last resort.

### Why this is the best option
- fixes the bug at the point where corruption begins
- restores idempotency
- reduces conceptual debt
- avoids continuing to rely on positional sequencing as identity

### Alternatives considered worse
- Expanding uniqueness across more raw columns without canonical normalization is fragile
- Using `vessel_id` alone is not guaranteed to be stable or unique
- Keeping `sample_seq` as identity is fundamentally wrong for re-upload safety

## Recommended Code Changes

### A) `js/upload.js` / `parseWineXRay`
Implement a deterministic berry identity builder.

**Changes:**
- add `buildBerryIdentity(row)` or `deriveCanonicalBerryId(row)`
- detect weak `sample_id` values, especially numeric-only or otherwise non-informative values
- derive:
  - canonical `sample_id`
  - canonical `lot_code` or equivalent lot-bearing identity
- normalize sample types consistently for `Berry` and `Berries`
- if a source sequence column exists, map and validate it explicitly
- if no source sequence exists, compute deterministic ordering metadata after stable sorting, not raw parse order

**Important:** if `sample_seq` remains in the schema temporarily, it must become deterministic and non-positional. It should not be the source of business identity.

### B) `api/upload.js`
Harden the upload contract.

**Changes:**
- add strict per-table validation
- reject unknown keys
- validate required fields, types, ranges, and max lengths
- reject ambiguous berry IDs server-side if canonical identity generation did not occur upstream
- enforce body-size and payload-shape limits
- consider fail-closed auth behavior for privileged write endpoints

### C) `js/dataLoader.js`
Unify lot derivation with canonical identity rules.

**Changes:**
- stop relying on ad hoc `extractLotCode(sampleId)` heuristics as the authoritative lot source
- support canonical berry identity format directly
- prevent empty-lot fallthrough for berry samples
- keep chart grouping keyed to the same identity contract as ingestion

### D) New shared identity/normalization module
Create a shared module, for example:

`js/identity.js`

**Responsibilities:**
- `normalizeSampleType()`
- `buildBerrySampleId()`
- `deriveLotCode()`
- any shared stable sort key logic
- duplicate-key estimation logic if used client-side

This module should be used by both temp parsing and server upload flows.

### E) Duplicate preview logic
Fix `_detectDuplicates` or equivalent preview code.

**Changes:**
- preview identity must exactly match server conflict identity
- if that is not possible, remove “new vs updated” preview counts because they are misleading

### F) Schema and migration hygiene
Resolve schema drift.

**Changes:**
- align base schema and migrations
- ensure only one canonical uniqueness model exists
- add startup or CI checks that verify expected uniqueness constraints are present

## Security Findings

### 1) Unvalidated privileged upsert payload
- **Severity:** High
- **Issue:** service-key write path appears to trust row shape too much
- **Action:** strict allowlist schema validation per table

### 2) Potentially permissive RLS baseline
- **Severity:** High if active, otherwise Medium risk as documentation drift
- **Issue:** schema docs reportedly allow very broad anon behavior
- **Action:** verify deployed policies and lock writes behind least privilege

### 3) Fail-open token revocation behavior
- **Severity:** Medium
- **Issue:** blacklist or revocation lookup failures appear to allow token acceptance
- **Action:** fail closed for high-risk endpoints or add stronger compensating controls

### 4) Weak distributed rate limiting
- **Severity:** Medium
- **Issue:** in-memory rate limiting is per-instance and resets on cold starts
- **Action:** move write-path rate limits to durable shared storage

### 5) CSV injection risk downstream
- **Severity:** Low to Medium
- **Issue:** text fields may later be exported to CSV/Excel without formula neutralization
- **Action:** sanitize export-bound text fields that start with `=`, `+`, `-`, or `@`

## Data Integrity Risks

### Critical
- order-dependent identity via `sample_seq`
- silent overwrite or non-idempotent upsert behavior
- weak assumptions that raw berry `sample_id` is meaningful business identity

### High
- lot-code collapse from short or generic IDs
- path-dependent behavior between temp and server parsing
- historical records that remain ambiguous unless backfilled or re-uploaded

### Medium
- duplicate preview mismatch
- schema and migration drift
- non-atomic multi-table upload behavior if relevant flows exist

## Implementation Order

### Phase 1: stop further corruption
1. add canonical berry identity generation in upload normalization
2. make server reject ambiguous berry payloads if canonicalization is missing
3. fix duplicate preview so it stops lying, or remove it

### Phase 2: eliminate architectural drift
4. extract shared normalization/identity module
5. make temp and server flows use the same module
6. align lot derivation and chart grouping to canonical identity

### Phase 3: harden the backend
7. add strict per-table schema validation in `/api/upload`
8. tighten auth failure behavior for write endpoints
9. replace in-memory rate limiting for critical paths

### Phase 4: clean up existing risk
10. align schema and migrations
11. add remediation path for historical ambiguous berry rows
12. improve observability around upload merges, inserts, rejects, and conflicts

## Test Plan

### Must-add automated tests
- parser determinism for berry identity under row reorder
- end-to-end upload idempotency for the same file
- end-to-end upload idempotency for the same file with shuffled rows
- multiple berry lots on the same date stay distinct
- weak or malformed berry IDs cause deterministic fallback or explicit rejection
- mixed berry and non-berry sample types do not regress each other
- duplicate preview correctness against actual conflict key
- lot grouping and “last point per lot” behavior after upload
- schema validation rejects unknown keys and malformed payloads

### Concrete regression scenarios
1. **First upload baseline**
   - input: CSV with multiple berry lots and multiple dates
   - assert: all rows persist, distinct lots remain distinct

2. **Re-upload identical file**
   - assert: no row-count drift, no semantic changes

3. **Re-upload shuffled rows**
   - assert: exact same final DB state as baseline

4. **Generic source IDs**
   - input: berry rows with weak `sample_id` like `25`
   - assert: canonical identity is deterministic and non-empty

5. **Null or missing sample_date**
   - assert: no accidental identity collapse

6. **UI grouping validation**
   - assert: charts group by true lot identity, not empty or pseudo-lot fallback

## Nice-to-Have Improvements

- incremental post-upload refresh instead of full table reload
- stronger structured logging with upload correlation IDs
- runtime schema typing with Zod or equivalent
- transactional orchestration for multi-table ingest flows
- removal of dead legacy parsing code after shared normalizer is in place

## What Claude Code Should Do Next

1. Inspect current implementation of:
   - `parseWineXRay`
   - `/api/upload`
   - duplicate preview logic
   - `extractLotCode`
   - temp parsing path
   - schema and migration definitions for `wine_samples`

2. Produce a concrete patch plan with:
   - file-by-file changes
   - backward compatibility notes
   - migration decision on whether to keep or remove `sample_seq` from uniqueness semantics

3. Implement in this order:
   - canonical berry identity generation
   - shared normalizer
   - upload validation
   - duplicate preview fix
   - tests
   - historical data remediation strategy

4. Do not ship until the reorder/idempotency tests pass.

## Suggested Prompt for Claude Code

```md
Read this handoff and verify every claim against the current repository before changing code.

Your task is to implement the smallest correct architecture that fixes berry upload identity instability and hardens the upload path.

Goals:
1. Make berry upload identity deterministic and idempotent.
2. Unify temp and server parsing through one shared normalizer.
3. Fix lot derivation so weak IDs do not collapse chart grouping.
4. Add strict server-side upload validation.
5. Add regression tests that prove re-uploading shuffled rows produces the same DB state.

Constraints:
- Prefer minimal surface-area changes, but do not preserve broken identity semantics.
- If schema changes are needed, explain the migration and historical-data impact clearly.
- If `sample_seq` remains, treat it as deterministic metadata, not business identity.
- Remove or rewrite any preview logic that does not exactly match real conflict semantics.

Deliverables:
- concise implementation plan
- code changes
- tests
- migration/remediation notes
- final summary of what was fixed and what still needs follow-up
```

## Source Consolidation Note

This handoff is a deduplicated synthesis of four Codex review outputs that repeatedly converged on the same core findings:
- unstable berry identity
- row-order-derived `sample_seq`
- parsing divergence
- weak lot derivation
- insufficient upload validation
- security hardening gaps
- missing idempotency/reorder coverage

