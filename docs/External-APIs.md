# External APIs: WineXRay and FieldClimate

Recon notes for the two automation goals:

1. Make berry-sample ingestion from WineXRay automatic, behind a sync button, instead of manual file upload.
2. Pull weather for the Sector 3A vineyard from its own FieldClimate station instead of Open-Meteo.

No credential values appear in this document. Secrets are fetched at runtime from Proton Pass via `pp` and used in place.

## WineXRay

Public site and client app are one React SPA (`ssm-web-app`) served from `https://www.winexray.com`.

| Property | Value |
| --- | --- |
| API base | `/v1`, same origin (`https://www.winexray.com/v1`) |
| Source of truth | `REACT_APP_API_BASE:"/v1"` inlined in `/static/js/main.e1792df2.js` |
| Auth style | Session credential returned in the JSON body, then replayed as a query argument |
| Credentials | Proton Pass, vault `Imported on 2026-07-13 at 14.56.53`, item `www.winexray.com`. Username `Xaniclab`. |

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

## FieldClimate (Pessl Instruments)

Weather station platform. The target is the station at Sector 3A, which maps to lot code `MX-3A` in `config.js`: Monte Xanic (VDG), Sauvignon Blanc, 2.17 ha.

| Property | Value |
| --- | --- |
| API base | `https://api.fieldclimate.com/v2` |
| Verified | `GET /v2/system/status` returns 200 without auth. `GET /v2/user/stations` returns 401, confirming auth is required. |
| Auth | HMAC-SHA256, or OAuth2 |
| Credentials | Not in Proton Pass yet. Needed from Daniel. |

### HMAC signing

Keys are a public/private pair generated in the FieldClimate account settings and bound permanently to that user account. Signing, per the official Pessl client:

1. Build a UTC date stamp in the format `%a, %d %b %Y %H:%M:%S GMT`, for example `Tue, 12 Aug 2026 14:05:00 GMT`.
2. Concatenate, with no separators: HTTP method, then `/`, then the route, then the date stamp, then the public key.
3. HMAC-SHA256 that string using the private key, hex digest.
4. Send two headers:
   - `Date: <the same date stamp>`
   - `Authorization: hmac <public key>:<signature>`

The date stamp used in the signature and the one in the `Date` header must be identical, so compute it once.

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
- A decision on which fields replace Open-Meteo for this vineyard, and whether Open-Meteo stays as the fallback when the station is offline or has a gap.

### Design implication

`js/weather.js` currently owns Open-Meteo (`_API_BASE` archive and `_FORECAST_API`). A station source should slot in behind the same interface so the rest of the app does not learn a second weather shape. Sector 3A reads from the station, every other origin keeps using Open-Meteo, and a station gap falls back rather than showing an empty chart. Station data is also point-accurate rather than modelled, so historical series may not line up exactly with the Open-Meteo archive; that discontinuity should be visible in the UI rather than silently averaged.

## Sources

- FieldClimate scheme and routes confirmed against the official Pessl client at https://github.com/SatAgro/fieldclimate (`fieldclimate/connection/hmac.py`, `fieldclimate/api.py`).
- FieldClimate API reference: https://api.fieldclimate.com/v2/docs (SwaggerHub, requires a login).
- WineXRay findings taken from `https://www.winexray.com/static/js/main.e1792df2.js` and one verified login round trip.
