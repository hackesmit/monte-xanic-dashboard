# Roadmap

## Completed Phases

| Phase | Description | Completed |
|-------|-------------|-----------|
| 1 | Deploy Online (Vercel + GitHub) | Yes |
| 2 | Database Migration (Supabase, upload pipeline) | Yes |
| 3 | Meteorology Integration (Open-Meteo, weather charts) | Yes |
| 4 | Authentication (bcrypt, HMAC tokens, rate limiting) | Yes |
| 4b | Data and Visualization Overhaul (normalization, evolution chart) | Yes |
| 4c | Stability and Security Improvements (XSS, CSP, refresh guards) | Yes |
| 5 | Vineyard Quality Map (SVG, color-coded metrics) | Yes |
| 6 | Polish (PDF/PNG export, mobile filters, vintage trends, harvest calendar) | Yes |
| -- | Security Hardening (server upload, token blacklist, persistent rate limits) | Yes |
| 7 | Mediciones Tecnicas (form entry, table, charts) | Yes |

## Deferred: Phase 7b -- Photographic Evidence

Not yet implemented. Original design included photo attachments for mediciones tecnicas using Cloudflare R2 storage.

**Scope:**
- Cloudflare R2 bucket (`montexanic-mediciones`) with CORS config
- `medicion_fotos` Supabase table (FK to mediciones_tecnicas)
- `api/photo-url.js` presigned PUT URL generator (auth-gated)
- Photo upload UI + gallery display in mediciones view
- CSP update: add R2 domain to `img-src` and `connect-src`
- `@aws-sdk/client-s3` dependency for presigned URLs
- Mobile: thumbnail grid reflow, touch/swipe lightbox

**Why deferred:** Core mediciones functionality (tonnage, berry measurements, health sort) was prioritized. Photos add complexity (R2 setup, presigned URLs, CSP changes, mobile gallery) without blocking the primary data capture workflow.

## Recommended Future Improvements

### Security
- Supabase RLS policies (defense-in-depth beyond service key)
- Token blacklist TTL cleanup
- Audit logging for data modifications
- Evaluate migration from custom HMAC tokens to Supabase Auth

### Data Quality
- Server-side row validation (type checking, range constraints)
- Upload preview/confirmation step
- Data export functionality (CSV download from dashboard)

### Testing
- Upload parsing unit tests (extract from DOM dependencies)
- Filter combination tests
- API integration tests

### Operations
- Structured logging for API endpoints
- Uptime monitoring
- Automated backup exports

### Frontend
- Service worker for offline capability (PWA manifest exists but no SW)
- Accessibility audit (keyboard navigation, screen readers)
- Internationalization framework if English UI is ever needed
