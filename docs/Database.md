# Database Schema

All tables live in Supabase (PostgreSQL). Schema defined in `sql/schema.sql` with incremental changes in `sql/migration_*.sql` files.

## wine_samples

Primary data table. Populated from WineXRay CSV exports. Contains both berry measurements and wine analysis, differentiated by `sample_type`.

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| id | bigint (auto) | no | Primary key |
| sample_id | text | no | Sample identifier, e.g. '25CFCC-1' |
| vessel_id | text | yes | Vessel/tank ID, e.g. 'B6', 'BCA' |
| sample_type | text | no | 'Berry', 'Aging Wine', 'Must', 'Young Wine', 'Control Wine' |
| sample_date | date | no | Date of sample |
| sample_seq | int | no (default 1) | Sequence for same (sample_id, sample_date) duplicates |
| crush_date | date | yes | Crush/harvest date |
| days_post_crush | int | yes | Days since crush |
| vintage_year | int | yes | 2022, 2023, 2024, 2025 |
| variety | text | yes | Normalized variety name |
| appellation | text | yes | Ranch-first format, e.g. 'Kompali (VON)' |
| tant | numeric | yes | Total anthocyanins (ppm ME) |
| fant | numeric | yes | Free anthocyanins (ppm ME) |
| bant | numeric | yes | Bound anthocyanins (ppm ME) |
| ptan | numeric | yes | pTAN (ppm CE) |
| irps | numeric | yes | iRPs (ppm CE) |
| ph | numeric | yes | pH |
| ta | numeric | yes | Titratable acidity (g/L) |
| ipt | numeric | yes | Total phenolics index |
| alcohol | numeric | yes | Alcohol (% v/v) |
| va | numeric | yes | Volatile acidity (g/L) |
| malic_acid | numeric | yes | Malic acid (g/L) |
| rs | numeric | yes | Residual sugars (g/L) |
| l_star | numeric | yes | Color L* |
| a_star | numeric | yes | Color a* |
| b_star | numeric | yes | Color b* |
| berry_weight | numeric | yes | Berry fresh weight (g) |
| berry_anthocyanins | numeric | yes | Berry extractable anthocyanins (mg/100b) |
| berry_sugars_mg | numeric | yes | Berry sugars (mg/b) |
| below_detection | boolean | yes | True if any value was below detection limit |
| notes | text | yes | Free text |
| uploaded_at | timestamptz | no (default now()) | Upload timestamp |

**Key constraints:**
- Unique: `(sample_id, sample_date, sample_seq)`

**Usage:** Berry data (sample_type = 'Berry'/'Berries') is loaded into `DataStore.berryData`. All other types go to `DataStore.wineRecepcion`.

## tank_receptions

Tank reception headers from Recepcion de Tanque Excel.

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| id | bigint (auto) | no | Primary key |
| report_code | text | no | Report ID, e.g. 'RRT-001' (unique) |
| reception_date | date | yes | Date of reception |
| batch_code | text | yes | Winery lot code, e.g. '25SBVDG-1' |
| tank_id | text | yes | Tank identifier |
| supplier | text | yes | Supplier/origin code |
| variety | text | yes | Grape variety |
| brix | numeric | yes | Degrees Brix |
| ph | numeric | yes | pH |
| ta | numeric | yes | Titratable acidity (g/L) |
| ag | numeric | yes | Gluconic acid (g/L) |
| am | numeric | yes | Malic acid (g/L) |
| av | numeric | yes | Volatile acidity (g/L) |
| so2 | numeric | yes | Free SO2 (mg/L) |
| nfa | numeric | yes | NFA |
| temperature | numeric | yes | Temperature (C) |
| solidos_pct | numeric | yes | Solids (%) |
| polifenoles_wx | numeric | yes | WineXRay polyphenols |
| antocianinas_wx | numeric | yes | WineXRay anthocyanins |
| poli_spica | numeric | yes | SPICA polyphenols |
| anto_spica | numeric | yes | SPICA anthocyanins |
| ipt_spica | numeric | yes | SPICA IPT |
| acidificado | boolean | yes | Acidified on reception |
| p010_kg | numeric | yes | P010 additive (kg) |
| vintage_year | int | yes | Extracted from batch_code prefix |
| uploaded_at | timestamptz | no | Upload timestamp |

**Key constraints:**
- Unique: `report_code`

## reception_lots

Links vineyard lots to tank receptions (up to 4 lots per reception).

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| id | bigint (auto) | no | Primary key |
| reception_id | bigint | no | FK to tank_receptions.id |
| lot_code | text | yes | Vineyard lot code, e.g. 'SBMX-3A' |
| lot_position | int | yes | Position 1-4 |

## prefermentativos

Pre-fermentation measurements from Excel sheet 2.

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| id | bigint (auto) | no | Primary key |
| report_code | text | no | Report ID |
| measurement_date | date | yes | Date of measurement |
| batch_code | text | yes | Winery lot code |
| tank_id | text | yes | Tank identifier |
| variety | text | yes | Grape variety |
| brix | numeric | yes | Degrees Brix |
| ph | numeric | yes | pH |
| ta | numeric | yes | Titratable acidity (g/L) |
| temperature | numeric | yes | Temperature (C) |
| tant | numeric | yes | Total anthocyanins |
| notes | text | yes | Free text |
| uploaded_at | timestamptz | no | Upload timestamp |

**Key constraints:**
- Unique: `(report_code, measurement_date)`

## meteorology

Weather data cache. Auto-populated from Open-Meteo API.

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| id | bigint (auto) | no | Primary key |
| date | date | no | Weather date |
| location | text | no (default 'VDG') | Valley: 'VDG', 'VON', or 'SV' |
| temp_max | numeric | yes | Max temperature (C) |
| temp_min | numeric | yes | Min temperature (C) |
| temp_avg | numeric | yes | Mean temperature (C) |
| rainfall_mm | numeric | yes | Precipitation (mm) |
| humidity_pct | numeric | yes | Relative humidity (%) |
| uv_index | numeric | yes | UV index |
| wind_speed | numeric | yes | Wind speed (km/h) |
| uploaded_at | timestamptz | no | Upload timestamp |

**Key constraints:**
- Unique: `(date, location)`

## mediciones_tecnicas

Physical berry field measurements. Populated via manual form entry.

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| id | bigint (auto) | no | Primary key |
| medicion_code | text | no | Unique code, e.g. 'MT-2025-001' |
| medicion_date | date | no | Date of measurement |
| vintage_year | int | no | Vintage year |
| variety | text | no | Normalized variety |
| appellation | text | no | Ranch-first format |
| lot_code | text | yes | Soft link to wine_samples.sample_id |
| tons_received | numeric(8,2) | yes | Tonnage received |
| berry_count_sample | int | yes | Berry count in health sort sample |
| berry_avg_weight_g | numeric(6,2) | yes | Average berry weight (g) |
| berry_diameter_mm | numeric(5,2) | yes | Average berry diameter (mm) |
| health_grade | text | yes | CHECK: 'Excelente', 'Bueno', 'Regular', 'Malo' |
| health_madura | int | yes (default 0) | Count: mature berries |
| health_inmadura | int | yes (default 0) | Count: immature berries |
| health_sobremadura | int | yes (default 0) | Count: overripe berries |
| health_picadura | int | yes (default 0) | Count: insect-damaged berries |
| health_enfermedad | int | yes (default 0) | Count: diseased berries |
| health_quemadura | int | yes (default 0) | Count: sunburned berries |
| measured_by | text | yes | Person who measured |
| notes | text | yes | Free text |
| uploaded_at | timestamptz | no | Upload timestamp |

**Key constraints:**
- Unique: `medicion_code`
- Indexes: `variety`, `medicion_date`, `vintage_year`

## rate_limits

Persistent login rate limiting. Used by /api/login.

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| id | bigint (auto) | no | Primary key |
| ip | text | no | Client IP address |
| attempts | int | no | Attempt count in window |
| window_start | timestamptz | no | Start of rate limit window |

## token_blacklist

Revoked session tokens.

| Column | Type | Nullable | Purpose |
|--------|------|----------|---------|
| id | bigint (auto) | no | Primary key |
| token_hash | text | no | SHA256 hash of revoked token |
| created_at | timestamptz | no | When the token was blacklisted |

## Recommended Future Improvements

- Add foreign key constraint: `reception_lots.reception_id` -> `tank_receptions.id`
- Add RLS policies for row-level security (currently bypassed via service key)
- Add TTL cleanup for `token_blacklist` (expired tokens are harmless but accumulate)
- Add TTL cleanup for `rate_limits` (stale entries accumulate)
- Consider partitioning `wine_samples` by `vintage_year` if table exceeds 50k rows
