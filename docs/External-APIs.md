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

### The data app and the My Results request, mapped from an authenticated browser session

The data endpoints that serve berry samples are not in the `www` React bundle because they never were there. After login the user lands on `https://client.winexray.com/client-center`, which is a **separate AngularJS single-page app** (hash router, `#/`) served by **ASP.NET / IIS**. Its API base is `/api` on that same `client.winexray.com` origin. It is unrelated to the `www.winexray.com` React SPA and its `/v1` API documented above. Everything below was observed on 2026-08-12 by driving a real Chromium session against `client.winexray.com` with the Proton Pass login, per Daniel's authorization on `xd-01g`.

**Login is a server-side form POST that sets an httpOnly cookie, not a URL-argument credential.**

```
POST https://client.winexray.com/login?returnUrl=/client-center
Content-Type: application/x-www-form-urlencoded

username=<user>&password=<pass>
```

Returns `303 See Other` with `Location: /client-center` and a `Set-Cookie` for the session cookie named `_ncfa`. Its observed attributes (metadata, not the value) are `path=/` and `HttpOnly`, with **no** `Secure`, **no** `SameSite`, **no** `Domain` (so it is host-only to `client.winexray.com`), and **no** `Expires`/`Max-Age`, so it is a session cookie with no persistent expiry attribute to read a lifetime off. That is not the same as knowing when it dies: how long a client retains it is browser and client dependent (session restore can carry one across a restart), and the server can invalidate it on its own schedule regardless. The effective lifetime therefore remains unmeasured, as recorded below. A second, non-httpOnly `userName=` cookie is set empty with a past expiry in the same response. (The prior `405` came from POSTing to `/client-center` itself; the real login endpoint is `/login`.) The session then travels as that cookie, attached automatically by the browser. This is the important divergence from the `/v1` API: `client-center` does **not** carry its credential as a URL query argument. Verified three ways in-session: `document.cookie` is empty (the cookie is httpOnly), the `/api/results` and `/api/export` calls below carried no `Authorization` header and no `?cookie=` argument yet returned this account's own data, and a `fetch(..., {credentials:'include'})` for the export CSV returned `200` with the account's rows. `/logout` clears the session and redirects to `www.winexray.com/client-login/`.

**My Results loads its grid from a JSON endpoint.** Navigating to `#/my-results` fires:

```
POST https://client.winexray.com/api/results
Content-Type: application/json

{"orderBy":"sampleDate","reverse":true,"currentPage":0,"pageLimit":50,
 "search":"","searchField":"assayId","searchFieldMatchType":"Like",
 "dateStart":null,"dateEnd":null,"dateSearchField":"sampleDate",
 "seasonStart":"<iso>","seasonEnd":"<iso>","loadMaxBatchId":true}
```

Returns `application/json` shaped `{ "count": <n>, "results": [ ... ] }`. Each result is a rich per-sample object with camelCase keys: `id`, `assayId`, `name` (the Sample Id / batch code), `sampleType` (`"Berries"` marks berry samples), `sampleDate`, `crushDate`, `days`, `vintage`, `varietalName`, `appellation`, `totalAnthocyanins`, `freeAnthocyanins`, `boundAnthocyanins`, `precipTannins`, `ironReactivePhenols`, `totalPhenolicsIndex`, `brix`, `ph`, `titratableAcid`, `numberBerries`, `weightBerries`, and a nested `colorResult` with `l`/`a`/`b` and UV/Vis bands. Control Wine and California rows are present in the payload, not pre-filtered.

**It is date-filterable, and the server honours the bounds — verified, not inferred from the schema.** The request body carries `dateStart`, `dateEnd`, `dateSearchField:"sampleDate"` plus `seasonStart`/`seasonEnd` and `search`/`searchField`. Six authenticated queries were run against `POST /api/results` with different `dateStart`/`dateEnd` windows and their `count` and every returned `sampleDate` inspected. In every window the returned `count` equalled the number of rows returned, and every returned row's `sampleDate` fell inside the requested window: a July-only window returned only July rows, a `dateEnd`-bounded window returned only rows on or before that day, a window starting after the last sample returned zero rows, and a broad window returned the same set as an unbounded query. The bounds are inclusive at day granularity (a `dateStart == dateEnd` single-day window returned that day's rows across all their intraday times). One format caveat the implementer must respect: the endpoint expects a date-only string (`YYYY-MM-DD`); an ISO-8601 value carrying a time or a `Z` suffix trips a server-side `HTTP 500`. Incremental sync is therefore possible rather than full-only.

**The Export button produces the same CSV the manual upload already parses.** Export is a two-step flow keyed on the rows the user has checked:

1. `POST /api/export` with `{"keys":[{"id":<sampleId>,"expand":false}, ...], "orderBy":"sampleDate", "reverse":true}` returns a bare GUID token as `text/plain`.
2. That GUID builds three download URLs (from the export modal):
   - CSV: `GET /api/export/result.csv?guid=<guid>`  -> `text/csv`
   - XLS: `GET /excel-download?guid=<guid>`
   - PDF: `GET /pdf-download?download=true&guid=<guid>`

The export is keyed by explicit sample `id`s, not by date. To get a date-bounded export, query `/api/results` with `dateStart`/`dateEnd` first, collect the `id`s, then `POST /api/export` those ids. Both steps run under the session cookie. Note the limit of what was actually tested: the negative control below covers `POST /api/results` and the CSV download, so **`POST /api/export` creation is not itself negative-controlled** and whether an unauthenticated caller could create an export job is unverified.

**Negative control: the cookie is what authorizes these, and the GUID is not a standalone bearer token.** Round 1 only ever called these endpoints with a valid session, which does not by itself prove the cookie is the authorizer. So each was re-requested with no cookie at all, from a fresh context: `POST /api/results` with no cookie returned `303 See Other` to `/login?returnUrl=/api/results` and no data, and `GET /api/export/result.csv?guid=<guid>` with no cookie — using a GUID that was live and returned the CSV moments earlier in-session — returned `303` to `/login?returnUrl=...` with zero bytes, not the CSV. The same GUID URL with the session cookie returned `200 text/csv`. So possession of the export GUID alone does not retrieve winery data; the session cookie is required on the download request too. The current "cookie-authenticated" wording holds. (The GUID still travels in a URL and so can land in history or logs, so it is not something to log needlessly, but a leaked GUID without the cookie does not hand over data.) The same `303 → /login?returnUrl=...` shape is what an absent or expired session produces, which is the signal a sync job watches for to know it must re-login.

**The export header is a compatible superset of what the parser needs, not "the same CSV" — checked column by column.** The CSV at `/api/export/result.csv?guid=...` was fetched end to end in-session (`HTTP 200`, `text/csv`) and its header row parsed quote-aware (79 columns). It is a superset: `CONFIG.wxToBerry` in `js/config.js` (consumed by `js/upload/winexray.js`) declares 43 header keys, and 41 of them appear in the export header verbatim, with the export carrying many additional columns the parser does not map and ignores harmlessly. The two configured keys that are not present verbatim are accounted for below rather than being genuine gaps. The 41 present verbatim: `Sample Id`, `Sample Type`, `Sample Date`, `CrushDate (yyyy-mm-dd)`, `DaysPostCrush (number)`, `Vintage`, `Variety`, `Appellation`, `Batch Id`, `Notes...`, `Number Of Berries In Sample (number)`, `Weight Of Berries In Sample (gr)`, `Volume Of Extracted Juice (milliliters)`, `Weight Of Extracted Juice (gr)`, `Volume Of Extracted Phenolics (milliliters)`, `Berry Fresh Weight (gr)`, `Berry (extractable) Anthocyanins (mg/100b me)`, the `Berry Sugars/Acids/Water/Skins & Seeds` triplets in `(mg/b)`, `(wt.%)` and `(gr)`, `tANT (ppm ME)`, `fANT (ppm ME)`, `bANT (ppm ME)`, `pTAN (ppm CE)`, `iRPs (ppm CE)`, `L*`, `a*`, `b*`, `I`, `Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)`, `pH (pH units)`, `Titratable Acidity (TA gr/l)`. The `T` column is present and is intentionally left unmapped by the parser (config comment). The export also carries columns the parser simply does not map and therefore ignores harmlessly: `Sample Sequence Number`, `Filename`, `UploadDate`, `Sample Number`, `Vessel Id`, `Sample Time`, `AssayDate`, `Must`/`Cap Temperature` plus unit columns, four `Movement` blocks, `Residual Sugars`, `Volatile Acidity`, `Malic Acid`, `Alcohol`. Blank cells in the export use `-`, which `normalizeValue` already maps to null (its empty-marker set is `'', '-', '—', 'NA', 'N/A'`); the `<50`/`<10` below-detection markers are handled by the parser's separate regex, which also sets `below_detection=true`; none appeared in this particular export, and the exact below-detection semantics remain `xd-rgg`'s audit. The export also included the Control Wine / California rows the parser is designed to skip, which is consistent with the manual path: the human exports everything and the parser filters at parse time.

The two configured keys not present verbatim, and why neither is a gap. First, `Total Phenolics Index (IPT, d-less)` **is** in the export but is emitted unquoted with an embedded comma, so a strict CSV read splits it into `Total Phenolics Index (IPT` and ` d-less)` and the mapping misses. The manual path already handles exactly this: `dataLoader.loadFile` string-replaces the bare header with a quoted `"Total Phenolics Index (IPT, d-less)"` before handing the text to SheetJS. So this column is only reusable through that existing loader shim; a sync that fetches the CSV must run it through the same loader, not a naive CSV parser.

**The damage from getting this wrong is worse than losing one column.** The unquoted comma splits one header into two, so the header row has one more field than every data row. Depending on the parser that either rejects the file or, worse, shifts every column after `IPT` one position out of alignment, silently filing Brix under pH, pH under titratable acidity, and so on down the row. Wrong numbers that look plausible are the failure mode here, not an obvious crash. So: repair the raw text before any CSV parse, then assert that the header count matches each row's field count and that the required headers are present, and fail loudly rather than importing a misaligned row. This malformed header belongs in the test fixtures as a regression case before sync is built. Second, `Berry Extractable Anthocyanins (mg/100b)` is a second configured spelling that this export does not emit — the export uses `Berry (extractable) Anthocyanins (mg/100b me)` (present, in the list above), and both spellings map to the same `berry_anthocyanins_mg_100b` field, so the alias is tolerated coverage for an older export spelling, not a missing column.

Duplicate configured headers were checked, since a header the config expects twice would make it ambiguous which value wins. No configured header appears more than once in the export. The only repeated header names are the unmapped `Movement Date/Time/Time End/Type/Volume` block columns (each appears four times), all of which the parser ignores. The two anthocyanin spellings above are distinct strings and this export carries only one of them, so they cannot collide within a single file.

Conclusion: the sync should reuse the existing `winexrayParser` over the CSV at `/api/export/result.csv?guid=<guid>`, not build a second ingestion path. The `/api/results` JSON is a viable alternative source but its camelCase keys do not match `CONFIG.wxToBerry`, so consuming it would mean a new field-mapping layer plus a reimplementation of the skip and below-detection logic. The CSV route keeps one place where WineXRay semantics live, which is why `xd-rgg` (parser audit) and `xd-qub` (upsert audit) should land first.

**Session lifetime is unmeasured.** The login page offers a `Remember me` checkbox (left unchecked in these logins). No explicit token-refresh endpoint was observed; re-login via `POST /login` re-establishes the cookie and `/logout` clears it. Measuring the real cookie lifetime would take longer than a few minutes, so it is recorded as unmeasured rather than guessed.

Note on the section below: its framing that "WineXRay carries the credential in the URL" describes the `/v1` API, not the `client-center` app. The `client-center` session is an httpOnly cookie, so the "credential lands in browser history and access logs" concern is weaker there — but the export download URL still carries a GUID and login travels over the wire, so the server-side-only rule still holds.

### Design implication for the sync button

Because the export header is a compatible superset of what the manual path already handles (see the column check above), the sync button should reuse the existing parse and upsert code rather than introduce a second ingestion path. That keeps one place where WineXRay semantics live. Reuse specifically means routing the fetched CSV through `dataLoader.loadFile`, whose quote-injection shim for the unquoted `Total Phenolics Index (IPT, d-less)` header is what makes that one column survive parsing; a naive CSV parse would drop it. This is why the parser audit (`xd-rgg`) and the upsert audit (`xd-qub`) should land before the sync button is built on top of them.

Three constraints the implementation has to respect.

**Keep the login and the session cookie server-side.** The WineXRay adapter runs only in a serverless function or an hqbox job, never in the browser. The login is posted in an HTTPS form body and exchanged for the `_ncfa` cookie; neither the login nor the cookie is ever sent to the client, returned in a response body, or included in an error message that reaches the client or a log line. The sync button calls our own endpoint, and that endpoint talks to WineXRay.

(An earlier draft of this section justified the rule by saying WineXRay carries its credential in the URL. That is true of the `/v1` API documented at the top of this note and **not** of `client-center`, which uses a form post and a cookie. The rule stands, the reason was wrong, and anyone reasoning from the old wording could conclude a query-string credential is normal here. It is not.)

**Only the export GUID travels in a URL,** and the negative control above shows it is not a bearer token: without the cookie it yields a `303` to `/login`. Still treat it as sensitive, since it names an export of winery data, and keep it out of logs and out of anything client-visible.

**Transport rules the missing `Secure` flag forces.** `_ncfa` carries no `Secure` attribute, so nothing at the cookie layer stops a client from sending it in cleartext. The implementation supplies that guarantee instead: request `https://` URLs only, never follow a redirect that changes scheme or origin, and attach `_ncfa` only when the destination host is exactly `client.winexray.com`. A hand-built `Cookie` header bypasses whatever protection a jar would have offered, so this applies with or without a cookie jar.

**Authorize our own endpoint before it touches WineXRay.** The sync endpoint holds the winery's WineXRay login and writes to the database, so reaching it must require an authenticated dashboard session with rights to this winery, reject cross-site invocation, and serialize or rate-limit sync starts. "The sync button calls our own endpoint" describes the topology, not an access-control decision. Detailed design belongs to `xd-b0e`, but it cannot ship without this.

That function gets the WineXRay login from Vercel encrypted environment variables, not from `pp`, for the reason given at the top of this document: the Proton Pass CLI and its session do not exist in a deployed function. The two hosting options therefore differ, and the choice is not cosmetic. A Vercel function needs the login added to the project's environment variables, which puts a long-lived credential in Vercel. A job on hqbox can use `pp` and keeps the credential on Daniel's box. If keeping it out of Vercel matters, host the sync on hqbox and have the button call that instead.

**Carry the cookie yourself: the sync runs server-side, where there is no browser to attach it.** The recon above says the session is "attached automatically by the browser", which is true in Chromium and misleading for the sync, which runs in a serverless function or an hqbox job where most HTTP clients have no cookie jar at all. A client that follows the recon as written gets the `303 → /login` (or login HTML) back instead of data. So the implementation must: capture the `Set-Cookie` for `_ncfa` from the `POST /login` response; hold it in an in-memory jar for the life of the run; send it on every subsequent same-origin `client.winexray.com` request (`/api/results`, `/api/export`, `/api/export/result.csv`); treat the login's `303` deliberately — read the `Set-Cookie` off it rather than blindly following the redirect, since a naive client that auto-follows the `303` to `/client-center` can discard the header it needed; recognise a `303` to `/login?returnUrl=...` on any data request as an expired or absent session and re-login; and never log or persist the cookie value.

**Turn automatic redirect following off for every request, not just login.** Most HTTP clients follow a `303` by default, so an expired session does not surface as the `303` documented here. It surfaces as a `200` carrying the login page's HTML, which then gets fed into a JSON or CSV parser and fails somewhere far from the real cause, or parses into nothing and reads as an empty result set. Either handle redirects manually throughout, or inspect the final URL and content type on every response and treat any landing on `/login`, or any `text/html` where JSON or CSV was expected, as an authentication failure rather than as data. The date-only `YYYY-MM-DD` format for `dateStart`/`dateEnd` noted above is part of this same server-side contract.

**Make sync idempotent, not merely upserting.** Reusing the upsert code is not sufficient on its own. A double-clicked button, a retry after a timeout, and two overlapping syncs are all ordinary events here. The requirement is that the natural key is enforced by a database unique constraint rather than assumed by application code, that writes go through an atomic on-conflict upsert against that constraint, and that overlapping runs are collapsed so a second sync cannot interleave with a first. `xd-qub` is auditing whether the existing `(sample_id, sample_date, sample_seq)` key actually holds; the sync button must not ship before that answer is known.

### What shipped (xd-b0e, 2026-08-28)

The sync is a Vercel serverless function. Daniel chose that host over an hqbox job, accepting the consequence stated in the table at the top of this document: the WineXRay login lives in Vercel encrypted environment variables, so rotation has two places to touch.

| Piece | File | Responsibility |
| --- | --- | --- |
| Adapter | `api/_lib/winexrayClient.js` | login, `/api/results`, `/api/export`, CSV download. Holds the credential and the `_ncfa` cookie. Never returns either. |
| Write core | `api/_lib/upsertRows.js` | column whitelist, required fields, upsert-key integrity, Supabase upsert. Extracted from `api/upload.js` so the manual path and the sync path run one implementation. |
| Write whitelist | `api/_lib/allowedTables.js` | the per-table conflict key, row cap and column set, imported by both handlers. |
| Endpoint | `api/winexray-sync.js` | session gate (lab role only), rate limit, in-flight collapse, date defaulting, then parse and upsert. |
| Button | `index.html` `#sync-btn-winexray`, `js/events.js`, `UploadManager.syncWineXRay` in `js/upload.js` | calls our own endpoint, renders a Spanish result. The manual `.csv` button stays as the fallback. |

Environment variables the deployed function needs, set in the Vercel project (Production and Preview):

- `WINEXRAY_USERNAME`
- `WINEXRAY_PASSWORD`

Both already exist in Proton Pass as the item `www.winexray.com`. `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are already set for `/api/upload` and are reused unchanged.

Behaviour worth knowing:

- **Incremental by default.** With no body the endpoint reads the newest `sample_date` across `berry_samples` and `wine_samples`, re-fetches from seven days before it, and ends today in `America/Tijuana`. The overlap is free because re-fetched rows collapse onto the same natural key. With no history at all it pulls from July 1 of the current year. An explicit `{"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}` overrides both.
- **Idempotency is the database's job, not the button's.** Writes go through the composite unique constraint on `(sample_id, sample_date, sample_seq)` with `resolution=merge-duplicates`. The in-memory in-flight collapse in the handler is a latency guard for a double-clicked button on one warm instance; it is not a distributed lock and is not what makes a retry safe.
- **The parser is reused, not reimplemented.** The fetched CSV goes straight into `winexrayParser`, which owns the Windows-1252 fallback and the repair for the unquoted `Total Phenolics Index (IPT, d-less)` header. `dataLoader.loadFile` is browser-only (it pulls in the Supabase client), so the server path uses the parser directly; the parser carries its own copy of the same quote-injection repair, which is what makes that safe.
- **Failure is never a silent no-op.** Every adapter error is an authored Spanish message carrying no credential, cookie, URL or export GUID.

Live verification on 2026-08-28, through the shipped adapter rather than by hand: window 2026-08-01 to 2026-08-28 returned 39 samples and an 18250 byte CSV, which the parser split into 4 `wine_samples` and 25 `berry_samples` with 10 Control Wine excluded and 0 rejected, and the upsert issued `on_conflict=sample_id,sample_date,sample_seq` with `Prefer: resolution=merge-duplicates,missing=default` and every row carrying a complete natural key.

## FieldClimate (Pessl Instruments)

Weather station platform. The target is the station at Sector 3A, which maps to lot code `MX-3A` in `config.js`: Monte Xanic (VDG), Sauvignon Blanc, 2.17 ha.

There are two doors into the same `api.fieldclimate.com/v2` backend, and only one is open to us:

1. **The web app's own API — the path we use, verified end to end.** The `fieldclimate.com` dashboard authenticates with an OAuth2 password grant and then calls `api.fieldclimate.com/v2` carrying a short-lived bearer token. This is the same shape as WineXRay's `client.winexray.com`: the login we already hold in Proton Pass is enough, no subscription is involved, and every call below was replayed successfully from `curl` outside the browser.
2. **The official v2 HMAC API — not our path.** The same `/v2` routes are also sold as an HMAC-signed subscription. That subscription is not active on this account, so the HMAC door is closed. It is documented at the end of this section, parked, in case a subscription is ever bought.

Everything from here to the "Official v2 HMAC API" heading describes door 1, the one we use.

### Web app auth, verified working

The SPA authenticates against a separate OAuth host, not the API host:

```
POST https://oauth.fieldclimate.com/token
Content-Type: application/json

{"grant_type":"password","client_id":"FieldclimateNG","client_secret":"<static, embedded in the SPA bundle>","username":"<login>","password":"<login>"}
```

- `grant_type` is `password`. The `client_id` is `FieldclimateNG`; the `client_secret` is a static public value shipped inside the SPA JavaScript, recoverable from the login XHR or the bundle (it is not per-user and not the account password). The `username`/`password` are the ordinary web login held in Proton Pass — the same item used to sign in by hand.
- Returns `HTTP 200` with a JSON body: `access_token`, `token_type: "Bearer"`, `expires_in: 3600`, `scope: "basic"`, `refresh_token`, `wizard_status`.
- **The session is a bearer token, not a cookie.** There is no `Set-Cookie` for auth (only Google Analytics and a `SERVERID` load-balancer cookie). The SPA stores the token in `localStorage` under `currentUser` and replays it on every API call as `Authorization: Bearer <access_token>` against `https://api.fieldclimate.com/v2`. A third header, `Accept: application/json`, is sent but not required.
- **The token lives one hour** (`expires_in: 3600`). A `refresh_token` is issued alongside it; the refresh grant was not exercised. For a server-side job the simpler path, and the one proven here, is to mint a fresh token per run with the password grant above — it is a single stateless POST.

This is the single most important finding: because auth is a bearer token minted from a username/password POST, the whole flow replays server-side with no browser, exactly the property `js/weather.js`'s sync needs. Verified: a token minted by `curl` (no browser involved) then used as `Authorization: Bearer` returned the identical daily series the dashboard renders.

### Station list

```
GET https://api.fieldclimate.com/v2/user/stations?tags=true
Authorization: Bearer <access_token>
```

Returns an array of station objects. The fields that matter per station: `name.original` (the device id, e.g. the account's weather station id — recorded on bead xd-1f3, not here), `name.custom` (the account's editable label), `info.device_name` and `info.device_id` (hardware type), `position` (geo coordinates, altitude, `timezoneCode`), and `dates` (`min_date`, `max_date`, `last_communication`).

The account has **ten stations, but exactly one weather station.** Nine are `LoRa SOIL` (device_id 51) or `LoRAIN` (device_id 52). Exactly one is `LoRa CLIMA` (device_id 50) — the only device that reports air temperature, humidity, wind, solar radiation and rain. Its id is on the bead. This resolves the identity question inherited from prior recon: since there is only one weather-type device, there is no ambiguity about *which device* the Sector 3A weather view reads — the dashboard's temperature chart and grid both call that one id (confirmed from the dashboard's own load: `/station/<id>/sensors`, `/chart/highchart/<id>/...`, `/ag-grid/<id>/...`). The remaining ambiguity is only the *label*: the account's custom name for that device is a Sector 3A weather-station name, but a prior widget showed a conflicting sector name for the same id, and the `/data` response localizes sensor names too (see below), so the account's custom text is not authoritative. Confirming the physical device in Sector 3A still needs a serial read at the site or the owner's word; that gap is unclosed, not assumed away.

### Sensor inventory

```
GET https://api.fieldclimate.com/v2/station/<station_id>/sensors
Authorization: Bearer <access_token>
```

Returns the channel list. Each sensor carries `ch` (channel), `code`, `name`/`name_original` (English here), `unit`, `unit_default`, and `aggr` — the aggregation methods that channel supports. The weather station's channels relevant to the dashboard:

| Channel | Code | Sensor | Unit | Aggregations offered |
| --- | --- | --- | --- | --- |
| 13 | 506 | HC Air temperature | °C | avg, max, min |
| 15 | 0 | Air temperature (dry bulb) | °C | avg, max, min |
| 12 | 507 | HC Relative humidity | % | avg, max, min |
| 11 | 600 | Solar radiation | W/m² | avg |
| 10 | 5 | Wind speed | km/h | avg, max |
| 3 | 768 | Precipitation | mm | sum |

Others present: soil temperature, DeltaT, dew point, VPD, wind gust, ultrasonic wind, battery, solar panel. Channel 13 (HC Air temperature) is the primary air-temperature sensor; channel 15 is a separate dry-bulb thermometer.

**Match sensors by `ch`/`code`, never by name.** The `/sensors` endpoint returns English names, but the `/data` endpoint (below) returns the account's *custom Spanish* names for the same channels (`Temperatura del Aire`, `Humedad Relativa`, `Temperatura de Bulbo Seco`). The stable join key across both is the channel number and sensor code, not the label.

### Time-series data call, with date-range proof

```
GET https://api.fieldclimate.com/v2/data/<station_id>/<group>/from/<from>/to/<to>
Authorization: Bearer <access_token>
```

- `<group>` is the aggregation window: `raw`, `hourly`, or `daily`. `daily` is what `js/weather.js` needs.
- `<from>` and `<to>` are **Unix epoch seconds, and only that.** This is a real trap: a `YYYY-MM-DD` or ISO-8601 string does **not** error — it returns `HTTP 200` with `{"message":"No data for period: 1970-01-01 ..."}`, because the string is coerced to a small integer and read as an epoch near zero. Unlike WineXRay, which 500s on a bad date format, FieldClimate silently returns an empty-looking success. Any integration must build epoch seconds and must treat a `"No data for period"` message as a possible format bug, not as a genuine gap.
- Response shape: `{"dates": ["YYYY-MM-DD HH:MM:SS", ...], "data": [ {name, name_original, ch, code, unit, aggr, values:{ <aggr>: [...] }}, ... ]}`. The `dates` array is the shared time axis; each sensor's `values` object holds one parallel array per aggregation it supports (`values.avg`, `values.max`, `values.min`, `values.sum`, `values.last`). Dates are in the station's local timezone (`America/Tijuana`).

**Arbitrary date range: yes, proven on two windows** (all four calls replayed from `curl` outside the browser against the `daily` group):

| Window requested (UTC → epoch) | `dates` returned | In range? |
| --- | --- | --- |
| 2026-07-01 → 2026-07-07 | 2026-07-01 … 2026-07-07 (7 rows) | yes |
| 2026-06-10 → 2026-06-14 | 2026-06-10 … 2026-06-14 (5 rows) | yes |

### Aggregation: the API produces the dashboard's field shapes directly

For the `daily` group, the air-temperature and humidity channels return `avg`/`max`/`min` arrays natively, so the dashboard's fields need no client-side aggregation. **The channel choice below is provisional, not verified.** What a live window did establish is the shape and the units: daily `avg`, `max` and `min` arrays come back already in °C and %, so no unit conversion is needed. What it did not establish is which channel the dashboard should treat as *the* air temperature.

| `js/weather.js` field | Candidate source | Status |
| --- | --- | --- |
| `temp_max` | channel 13 (HC Air temperature), `values.max` | shape and unit verified, channel choice provisional |
| `temp_min` | channel 13, `values.min` | same |
| `temp_avg` | channel 13, `values.avg` | same |
| `humidity_pct` | channel 12 (HC Relative humidity), `values.avg` | shape and unit verified |

Channel 13 (HC Air temperature) and channel 15 (dry-bulb) are both candidates and this recon did not settle which the dashboard plots. Channel 13 is the labelled primary and the station backs the "Frost and temperature monitoring" chart, which is suggestive, not decisive. Settling it belongs to the `weather.js` bead and wants one concrete step: capture the request the dashboard chart itself issues, then compare channels 13 and 15 over the same window before committing. Do not prescribe channel 13 from this note alone.

One data-quality caveat seen in the sampled window: a single day returned `min` of `0` for both temperature and humidity, which is a sensor or gap artifact rather than a real reading, so a sync should sanity-check for it. (Actual readings are deliberately not reproduced here; this repository is public and they are the winery's operational data. The verification window and values are on bead `xd-1f3`.)

**Timestamps: decide the day boundary explicitly.** The range parameters are epoch seconds, while daily buckets come back keyed to the station's own timezone (`position.timezoneCode`, `America/Tijuana` for this one). Building a range from UTC midnight therefore does not line up with a local-calendar day, and the mismatch shifts by an hour across a DST transition. Whichever convention the sync adopts, it must construct the boundary in the station's timezone, convert that instant to epoch seconds, and state whether `to` is inclusive. This is untested and is a likely source of an off-by-one-day error.

The customized `POST` variants of the data routes (same paths, a body selecting specific sensors) exist and are worth using once a fixed channel set is committed, so we fetch only the channels we display rather than all 21.

### History depth

The weather station's `min_date` is 2020-09-23; `max_date` tracks the last communication (current). Roughly six years of history, comfortably longer than the dashboard's range, so history depth is not a constraint here.

### Replay and negative control

- **Replay outside the browser: succeeds.** A fresh bearer token minted by `curl` against `oauth.fieldclimate.com/token` (password grant, no browser), then used as `Authorization: Bearer`, returned byte-identical daily data to what the dashboard rendered. The integration is therefore feasible server-side.
- **Negative control: the endpoint is protected.** The same `GET /v2/data/<id>/daily/from/.../to/...` with no `Authorization` header returns `HTTP 401 {"message":"Unauthorized. ..."}`. The data is not served unauthenticated, so this is not a leaky-vendor finding, and the token must be kept server-side, never shipped to the browser client, exactly as the WineXRay login is. Note the precise limit of that control: it proves **authentication** is enforced, not **authorization**. Whether a token minted for a different FieldClimate account can read this station id was not tested, so no claim is made about cross-account isolation.

### Design implication

`js/weather.js` currently owns Open-Meteo (`_API_BASE` archive and `_FORECAST_API`). The station source slots in behind the same interface: mint a token, `GET /v2/data/<id>/daily/from/<epoch>/to/<epoch>`, read channels 13 and 12. Because the bearer token and the OAuth grant must stay server-side, this adapter runs in a serverless function or an hqbox job, never in the browser — the client calls our endpoint, and our endpoint talks to FieldClimate, same rule as WineXRay. On Vercel the login (and client secret) come from encrypted environment variables, not `pp`, per the hosting table at the top of this document.

**Fallback is decided, not open:** when the station is offline or has a gap, that range falls back to Open-Meteo rather than rendering an empty chart. The condition on it is labelling, not approval. Station data is point-measured and Open-Meteo is modelled, so a series that silently mixes them is not one measurement any more, and a winemaker reading a Brix or temperature curve has no way to know which points came from where. Every fallback point must therefore be distinguishable in both the data layer and the UI. A blended series with no marking is worse than an honest gap, because it looks authoritative and is not. Note the daily-`min`-of-`0` artifact above is exactly the kind of point that should be treated as a gap, not plotted.

## Official v2 HMAC API (parked — subscription-gated, not the path we use)

This is door 2. It is documented here only because it is the officially supported integration and would replace the web-app path if a subscription were ever bought. As of this recon it is **not available on this account**: at `fieldclimate.com` → user menu → API services → FieldClimate, the page states there is no active API subscription and offers only a paid registration form (VAT, billing address, Tier 1/2/3) routed to Pessl's subscriptions team. Submitting that form is a commercial commitment and is out of scope; no keys were generated. The account owning the Sector 3A station has no HMAC key pair, so none of the HMAC material below has been exercised.

| Property | Value |
| --- | --- |
| API base | `https://api.fieldclimate.com/v2` (same routes as door 1) |
| Verified | `GET /v2/system/status` returns 200 without auth. Authenticated routes require either a bearer token (door 1) or an HMAC signature (this door). |
| Auth | HMAC-SHA256 with an account-bound public/private key pair, or OAuth2 |
| Status | No key pair on the account; subscription-gated. Parked. |

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

None of this has been resolved because no key pair exists on the account. It is parked: it only becomes work if a subscription is ever bought, at which point the exact canonical string that works gets recorded here. The web-app path above needs none of it. Until a key pair exists, no HMAC form here is authoritative.

### Endpoints that matter for us (shared by both doors)

| Route | Purpose |
| --- | --- |
| `GET /v2/user/stations` | List the account's stations. This is how we find the Sector 3A station id. |
| `GET /v2/station/{station_id}` | Station metadata, including position and timezone |
| `GET /v2/station/{station_id}/sensors` | Sensor inventory, needed to map channels onto our weather fields |
| `GET /v2/data/{station_id}` | Min and max date of available data |
| `GET /v2/data/{station_id}/{group}/last/{period}` | Most recent data |
| `GET /v2/data/{station_id}/{group}/from/{from}/to/{to}` | Range query, Unix timestamps |
| `GET /v2/forecast/{station_id}/{option}` | Station forecast |

`{group}` selects the aggregation (raw, hourly, daily and similar). These are the same routes the web-app path uses; the difference is only the authentication header. The customized variants of the data routes are the same paths with `POST` and a body selecting specific sensors, worth using so we fetch only the channels we display (12 and 13).

### If the HMAC door is ever opened

- HMAC public and private key from the FieldClimate account, stored in Proton Pass, never in a file. Requires an active paid subscription first.
- The empirical canonical-string test above (candidate A vs B, `Date` vs `Request-Date` header, query-string handling), run once against a live signed request.

This is all moot while the web-app bearer-token path works, since it reaches the identical routes and data.

## Sources

- Web-app API (OAuth2 password grant, bearer token, station/sensor/data routes) mapped from a live authenticated session on `fieldclimate.com` on 2026-08-13 and replayed from `curl` outside the browser. Account, station id, and the OAuth `client_id`/`client_secret` location live on bead xd-1f3, not in this public repo.
- FieldClimate HMAC scheme and routes confirmed against the official Pessl client at https://github.com/SatAgro/fieldclimate (`fieldclimate/connection/hmac.py`, `fieldclimate/api.py`).
- FieldClimate API reference: https://api.fieldclimate.com/v2/docs (SwaggerHub, requires a login).
- WineXRay findings taken from `https://www.winexray.com/static/js/main.e1792df2.js` and one verified login round trip.
