# External APIs: WineXRay and FieldClimate

Recon notes for the two automation goals:

1. Make berry-sample ingestion from WineXRay automatic, behind a sync button, instead of manual file upload.
2. Pull weather for the Sector 3A vineyard from its own FieldClimate station instead of Open-Meteo.

No credential values appear in this document.

**Where secrets come from depends on where the code runs, and the two are not interchangeable.** `pp` is a local CLI backed by an interactive session on Daniel's box. It exists for agents and for jobs running on hqbox. It does **not** exist inside a deployed Vercel function, which has no Proton Pass binary and no session, so any design that calls `pp` at request time from a deployed endpoint does not work.

| Where the code runs | How it gets its secret |
| --- | --- |
| An agent or a human at a terminal on this box | `pp`, values used in place, never written to a file |
| A scheduled job on hqbox | `pp`, since hqbox has the session |
| A deployed Vercel function | Vercel encrypted environment variables, set at deploy time. Never `pp`. |

Rotation therefore has two places to touch for anything used by both, and a rotation that updates only Proton Pass will silently leave a deployed function on the old value until its environment variable is updated too.

## WineXRay

Public site and client app are one React SPA (`ssm-web-app`) served from `https://www.winexray.com`.

| Property | Value |
| --- | --- |
| API base | `/v1`, same origin (`https://www.winexray.com/v1`) |
| Source of truth | `REACT_APP_API_BASE:"/v1"` inlined in `/static/js/main.e1792df2.js` |
| Auth style | Session credential returned in the JSON body, then replayed as a query argument |
| Credentials | Held in Proton Pass for local and hqbox use. A deployed sync endpoint reads them from Vercel encrypted environment variables instead, per the table above. Neither the identifiers nor the values belong in this repo, which is public. |

### Login, verified working

```
POST https://www.winexray.com/v1/identity/login
Content-Type: application/json

{"username": "...", "password": "..."}
```

Returns `HTTP 200` with a JSON body containing exactly two keys:

- `cookie`: the session credential
- `redirect`: where the SPA sends the user after login

There is no `Set-Cookie` response header. The session value lives in the body and the client stores it itself.

### Identity endpoints found in the bundle

| Route | Method | Notes |
| --- | --- | --- |
| `/v1/identity/login` | POST | Verified working, see above |
| `/v1/identity/login-status?cookie=<urlencoded>` | GET | Session check. The credential travels as a query argument, not a header. |
| `/v1/identity/forgot-password` | POST | Not exercised |
| `/v1/identity/reset-password` | POST | Not exercised |
| `/v1/audit-log` | GET | Not exercised |
| `/v1/content/{page}` | GET | Marketing content |
| `/v1/content/knowledge-center` | GET | Marketing content |

### Status: authenticated surface not yet mapped

The public bundle contains only the marketing site plus the auth flow. The `/examples/music` and `/examples/restaurants` routes in it are unused boilerplate, not real endpoints. The data endpoints that serve berry samples are not in this bundle, so they have to be discovered from an authenticated session.

That step is currently blocked. WineXRay expects its session credential as a URL query argument rather than an HTTP header, and constructing that request trips the HQ exfil guard. Per invariant 9 no evasion was attempted. A P1 unblock request is with Daniel. Until it is resolved the following are unknown:

- the endpoint that lists or exports berry samples
- the export format, and whether it matches the CSV the manual upload already parses
- session lifetime and whether a refresh flow exists
- whether the export can be filtered by date, which decides incremental versus full sync

### Design implication for the sync button

If the export endpoint returns the same CSV shape the manual path already handles, the sync button should reuse the existing parse and upsert code rather than introduce a second ingestion path. That keeps one place where WineXRay semantics live. This is why the parser audit (`xd-rgg`) and the upsert audit (`xd-qub`) should land before the sync button is built on top of them.

Two constraints the implementation has to respect.

**Keep the session credential server-side.** Because WineXRay carries it in the URL rather than a header, it lands anywhere full URLs are retained: browser history, proxy and CDN access logs, error traces. The WineXRay adapter therefore runs only in a serverless function, never in the browser. The credential is never sent to the client, never returned in a response body, and never included in an error message that reaches the client or a log line. The sync button calls our own endpoint, and that endpoint talks to WineXRay.

That function gets the WineXRay login from Vercel encrypted environment variables, not from `pp`, for the reason given at the top of this document: the Proton Pass CLI and its session do not exist in a deployed function. The two hosting options therefore differ, and the choice is not cosmetic. A Vercel function needs the login added to the project's environment variables, which puts a long-lived credential in Vercel. A job on hqbox can use `pp` and keeps the credential on Daniel's box. If keeping it out of Vercel matters, host the sync on hqbox and have the button call that instead.

**Make sync idempotent, not merely upserting.** Reusing the upsert code is not sufficient on its own. A double-clicked button, a retry after a timeout, and two overlapping syncs are all ordinary events here. The requirement is that the natural key is enforced by a database unique constraint rather than assumed by application code, that writes go through an atomic on-conflict upsert against that constraint, and that overlapping runs are collapsed so a second sync cannot interleave with a first. `xd-qub` is auditing whether the existing `(sample_id, sample_date, sample_seq)` key actually holds; the sync button must not ship before that answer is known.

## FieldClimate (Pessl Instruments)

Weather station platform. The target is the station at Sector 3A, which maps to lot code `MX-3A` in `config.js`: Monte Xanic (VDG), Sauvignon Blanc, 2.17 ha.

| Property | Value |
| --- | --- |
| API base | `https://api.fieldclimate.com/v2` |
| Verified | `GET /v2/system/status` returns 200 without auth. `GET /v2/user/stations` returns 401, confirming auth is required. |
| Auth | HMAC-SHA256, or OAuth2 |
| Credentials | Not in Proton Pass yet. Needed from Daniel. |

### HMAC signing

Keys are a public/private pair generated in the FieldClimate account settings and bound permanently to that user account.

1. Build a UTC date stamp in HTTP-date form, `%a, %d %b %Y %H:%M:%S GMT`. Use a real HTTP-date formatter rather than assembling the string by hand: the weekday has to agree with the calendar date or strict validators reject it.
2. Build the canonical string by concatenating, with no separators and nothing else between them:

   ```
   METHOD + SIGNED_PATH + DATE_STAMP + PUBLIC_KEY
   ```

   `SIGNED_PATH` begins with exactly one `/`. Getting this wrong is the usual cause of a 401.
3. HMAC-SHA256 the canonical string keyed with the private key, hex digest.
4. Send two headers:
   - `Date: <the same date stamp>`
   - `Authorization: hmac <public key>:<signature>`

Compute the stamp once and use the same value in both the signature and the header.

Worked example, using the route table below and a route of `user/stations`:

```
canonical: GET/user/stationsWed, 12 Aug 2026 14:05:00 GMT<public key>
Date: Wed, 12 Aug 2026 14:05:00 GMT
Authorization: hmac <public key>:<hex hmac-sha256 of the canonical string>
```

**`SIGNED_PATH` is not yet determined for v2, and this document cannot tell you which form is correct.** The reference client above targets v1, and no live v2 request has been made from here because the account keys are not available yet. Treat the following as candidates to test, not as instructions to follow:

| Candidate | Form for `GET /v2/user/stations` | Basis |
| --- | --- | --- |
| A, version excluded | `/user/stations` | What the v1 reference client does: its base URI carries the version and the signed route does not |
| B, version included | `/v2/user/stations` | What a path-based signer would do if v2 changed to sign the full request path |

Try A first, since it is what the only reference implementation we have actually does. If it returns 401, try B before suspecting the key. A 401 here means an unexpected canonical string far more often than it means a bad key.

Three details are equally unresolved and must be settled by the same empirical test:

- whether the query string is included in `SIGNED_PATH` for routes that carry one, and if so whether parameters are ordered or percent-encoded in any particular way
- whether a doubled slash is tolerated. The concatenation already supplies the leading `/`, so a route written with its own leading slash yields `GET//user/stations`. Assume this fails.
- whether v2 accepts the same `hmac <public key>:<signature>` Authorization form

Resolving all of this is the first task of `xd-1f3`, before any integration code is written. The outcome, including the exact canonical string that worked, replaces this section. Until then no form here is authoritative.

### Endpoints that matter for us

| Route | Purpose |
| --- | --- |
| `GET /v2/user/stations` | List the account's stations. This is how we find the Sector 3A station id. |
| `GET /v2/station/{station_id}` | Station metadata, including position and timezone |
| `GET /v2/station/{station_id}/sensors` | Sensor inventory, needed to map channels onto our weather fields |
| `GET /v2/data/{station_id}` | Min and max date of available data |
| `GET /v2/data/{station_id}/{group}/last/{period}` | Most recent data |
| `GET /v2/data/{station_id}/{group}/from/{from}/to/{to}` | Range query, Unix timestamps |
| `GET /v2/forecast/{station_id}/{option}` | Station forecast |

`{group}` selects the aggregation (raw, hourly, daily and similar). The customized variants of the data routes are the same paths with `POST` and a body selecting specific sensors, which is worth using once the sensor inventory is known so we fetch only the channels we display.

### What is still needed

- HMAC public and private key from the FieldClimate account, stored in Proton Pass, never in a file.
- The station id for Sector 3A, read from `/v2/user/stations` once authenticated.
- A decision from Daniel on which fields the station replaces for this vineyard.

### Design implication

`js/weather.js` currently owns Open-Meteo (`_API_BASE` archive and `_FORECAST_API`). A station source should slot in behind the same interface so the rest of the app does not learn a second weather shape. Sector 3A reads from the station and every other origin keeps using Open-Meteo.

**Fallback is decided, not open:** when the station is offline or has a gap, that range falls back to Open-Meteo rather than rendering an empty chart. The condition on it is labelling, not approval. Station data is point-measured and Open-Meteo is modelled, so a series that silently mixes them is not one measurement any more, and a winemaker reading a Brix or temperature curve has no way to know which points came from where. Every fallback point must therefore be distinguishable in both the data layer and the UI. A blended series with no marking is worse than an honest gap, because it looks authoritative and is not.

The only thing still open here is the field-level question above: which measurements the station replaces. That does not block the fallback design.

## Sources

- FieldClimate scheme and routes confirmed against the official Pessl client at https://github.com/SatAgro/fieldclimate (`fieldclimate/connection/hmac.py`, `fieldclimate/api.py`).
- FieldClimate API reference: https://api.fieldclimate.com/v2/docs (SwaggerHub, requires a login).
- WineXRay findings taken from `https://www.winexray.com/static/js/main.e1792df2.js` and one verified login round trip.
