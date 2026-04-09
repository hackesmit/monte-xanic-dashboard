# Test Coverage

## Test Runner

Node.js built-in test runner (`node:test`). Run with `npm test` or `node --test tests/*.test.mjs`.

**Current: 47 tests across 5 suites. All passing.**

## Test Suites

### MT.1: sample_seq Assignment (7 tests)
**File:** `tests/mt1-sample-seq.test.mjs`
**Protects:** Correct assignment of sequence numbers when multiple measurements share the same (sample_id, sample_date).

| Test | Behavior Verified |
|------|-------------------|
| Single row per key | Gets seq=1 |
| Duplicate keys | Get incrementing seq (1, 2, 3) |
| Different dates | Treated as separate groups |
| Different sample_ids | Treated as separate groups |
| Null/missing date | Grouped together (null and undefined both become empty string) |
| Empty input | No error |
| Mixed groups | Independent counters per group |

**Note:** Tests an extracted copy of the logic, not the actual `upload.js` function (which depends on SheetJS globals).

### MT.2: Deterministic Jitter (8 tests)
**File:** `tests/mt2-jitter.test.mjs`
**Protects:** The `_applyDaysJitter()` function produces deterministic, bounded offsets for chart point separation.

| Test | Behavior Verified |
|------|-------------------|
| Same lot, same offset | Deterministic (no random component) |
| Different lots | Produce different offsets |
| Symmetric range | Jitter is within +/-0.2 days (fixed from prior asymmetry bug) |
| sampleSeq > 1 | Adds 0.15 * (seq-1) offset |
| sampleSeq = 1 | No seq offset (only hash jitter) |
| Fallback to sampleId | When lotCode is missing |
| No lot or sampleId | Zero jitter |
| 100 repeated calls | Exactly one unique result (proves no randomness) |

**Note:** Tests an extracted copy of the function, not the in-file version.

### MT.3: verifyToken Module (13 tests)
**File:** `tests/mt3-verify-token.test.mjs`
**Protects:** The shared `api/lib/verifyToken.js` module used by all authenticated endpoints.

| Test | Behavior Verified |
|------|-------------------|
| Valid non-expired token | Returns payload with user and role |
| Expired token | Returns 401 "Token expired" |
| Missing exp field | Returns 401 "Token expired" |
| Invalid HMAC signature | Returns 401 "Invalid token" |
| Tampered payload | Returns 401 "Invalid token" (signature mismatch) |
| Null/undefined/empty | Returns 401 "Unauthorized" |
| Wrong format (no dot) | Returns 401 "Invalid token" |
| Malformed base64 | Returns 401 "Invalid token" |
| Blacklisted token | Returns 401 "Token revoked" (mocked fetch) |
| Not blacklisted | Returns payload (mocked empty fetch) |
| Blacklist fetch failure | Fail-open: returns payload (mocked network error) |
| checkBlacklist=false | Does not call fetch at all |
| Missing SESSION_SECRET | Returns 401 "Unauthorized" |

**Tests the actual module** via dynamic import. Mocks `globalThis.fetch` for blacklist tests.

### MT.4: rateLimit Module (9 tests)
**File:** `tests/mt4-rate-limit.test.mjs`
**Protects:** The shared `api/lib/rateLimit.js` in-memory rate limiter.

| Test | Behavior Verified |
|------|-------------------|
| Within limit | Returns true, no status set |
| Up to maxRequests | All allowed |
| Exceeds maxRequests | Returns false, 429 status, Spanish error message |
| Different IPs | Independent buckets |
| Different URLs | Independent buckets for same IP |
| x-real-ip extraction | Correctly reads header |
| x-forwarded-for fallback | Uses first IP in comma-separated list |
| No IP headers | Falls back to 'unknown' |
| Window expiry | Bucket resets after windowMs (tested with 1ms window + busy-wait) |

**Tests the actual module** via dynamic import. Uses mock req/res objects.

### MT.5: Valley Selector Flow (10 tests)
**File:** `tests/mt5-valley-selector.test.mjs`
**Protects:** State management for the weather valley selector (VDG/VON/SV).

| Test | Behavior Verified |
|------|-------------------|
| Default location | VDG |
| Switch valley | Updates state.weatherLocation |
| Header text | Correct Spanish name per valley |
| Chart re-render | Triggered on switch |
| Sync trigger (no data) | Fires when no cached data for valley |
| No sync (data exists) | Does not fire when data already cached |
| No sync (no vintages) | Does not fire when vintage list empty |
| clearAll reset | Resets weatherLocation to VDG |
| All three valleys | Correct header text for VDG, VON, SV |
| Unknown valley | Falls back to raw code in header |

**Tests extracted logic** with lightweight mocks (no DOM dependencies).

## Coverage Gaps

| Area | Gap | Risk |
|------|-----|------|
| Upload parsing | No test for `parseWineXRay()` or `parseRecepcion()` end-to-end | Medium: complex normalization logic |
| API endpoints | No integration tests for /api/login, /api/upload | Medium: auth + upload are critical paths |
| Chart rendering | No tests for Chart.js output | Low: visual correctness is manually verified |
| Filter logic | No test for `Filters.getFiltered()` with combined state | Medium: AND logic across multiple filters |
| Mediciones form | No test for form validation or submission | Low: straightforward form-to-POST |
| Map aggregation | No test for `MapStore.aggregateBySection()` | Low: infrequently changed |
| CSP compliance | No automated check that no inline handlers exist | Low: covered by code review |

## Recommended Next Tests

1. Upload parsing tests (extract parsing logic from DOM dependencies)
2. Filter combination tests (mock DataStore, test AND logic)
3. API integration tests (using Playwright or supertest against `vercel dev`)
