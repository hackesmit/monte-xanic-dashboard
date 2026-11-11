# Pronostico: fecha a Brix objetivo por lote

Bead xd-2ov.2 (epic xd-2ov), 2026-11-11. The Prediccion tab shows, for each
active lot of the season, the day it reaches its target Brix, with the error
band measured on Monte Xanic's own past seasons. No date with fewer than 3
samples, and none further than 3 weeks out.

## Brix date

| Part | File |
|---|---|
| Fit, forecast, backtest helpers (pure) | `js/pronostico/brix.js` |
| Measured band (generated, never hand-edited) | `js/pronostico/brixBanda.js` |
| Server: reads samples, fits, records | `api/pronostico.js` |
| View section | `js/pronostico/view.js`, `#pronostico-brix` in `index.html` |
| Forecast record | `public.pronosticos`, `sql/migration_pronosticos.sql` |
| Backtest | `scripts/pronostico-brix-backtest.mjs` |
| Tests | `tests/mt64-pronostico-brix.test.mjs` |

### Model

Ordinary least squares of Brix on days over the lot's samples of the season so
far. The forecast date is where the line crosses the lot's target. That date
is never before the newest sample. The target is the midpoint of the catalog
rubric's ideal Brix range for the variety and valley (`js/config.js`
`rubrics`), or the winemaker's override in `harvest_target_overrides`, both
resolved as the old predictor resolves them (`resolveTarget`).

A lot shows no date when:

- it has fewer than 3 samples (`pocas-muestras`, counted under the table);
- its last sample is already at or above target (`alcanzado`);
- the fitted line does not rise (`sin-tendencia`);
- the crossing is more than 21 days after the last sample (`fuera-de-rango`);
- there is no measured band for that horizon (`sin-banda`);
- it has a reception on or before the cutoff (`cosechado`), or no sample in
  the 14 days before the cutoff (`sin-muestra-reciente`; this catches lots
  harvested under a different reception code, about 40 percent of 2026).

The band is the 80th percentile of the absolute backtest error for forecasts
whose horizon (forecast date minus last sample) fell in the same week. A
displayed band of 9 days means 8 of 10 past forecasts at that horizon landed
within 9 days.

### Relation to js/prediction.js

`js/prediction.js` (the cards below the new section) is kept as it is and is
not this tool. It groups by variety and ranch, not by lot. It pools current
and past seasons through a Bayesian slope prior. Its band is a theoretical
1.96 sigma interval, never measured on real seasons (MT.26 runs on a synthetic
fixture). The per-lot tool is new code, `js/pronostico/brix.js`, and reuses only
`resolveTarget` and `resolveRubric`. Replacing or retiring the cards is a
separate decision.

### Data used (2026-11-11, read-only)

Pulled with psql under `default_transaction_read_only=on`:

```sql
-- brix.tsv
select 'ws' src, sample_id, sample_date, vintage_year, variety, appellation, brix
  from wine_samples where sample_type='Berries' and brix is not null
union all
select 'bs', sample_id, sample_date, vintage_year, variety, appellation, brix
  from berry_samples where brix is not null;
-- recep.tsv
select vintage_year, lot_code, variety, appellation, reception_date, brix, tons_received
  from mediciones_tecnicas;
```

Then `node scripts/pronostico-brix-backtest.mjs brix.tsv recep.tsv --json js/pronostico/brixBanda.js`.

| Vintage | Lots with Brix | Lots with 3 or more samples | Median samples | With 3+ and a catalog target |
|---|---|---|---|---|
| 2024 | 34 | 11 | 2 | 11 |
| 2025 | 90 | 80 | 8 | 71 |
| 2026 | 78 | 74 | 6 | 72 |

2024 sampling began at 22 to 26 Bx, after most lots had passed their target,
so 2024 gives no date case. The backtest cases come from 2025 and 2026.

### Backtest

Each lot's series is truncated at every sample from the third. Each truncation
is forecast and compared with the observed crossing. The observed crossing is
the linear interpolation between the two samples that bracket the target, at
most 14 days apart. Only cutoffs before the crossing count. 45 lots crossed
their target: 195 cutoffs. Error = forecast minus observed, in days.
"Adelanto" = observed crossing minus cutoff (the real lead time).

Shipped model, error by real lead time (weeks before the crossing). Within
the 3-week display limit, 133 of 195 cutoffs got a date:

| Lead | n | MAE d | RMSE d | Bias d | P80 abs d |
|---|---|---|---|---|---|
| 0 to 6 days | 60 | 4.2 | 5.8 | +2.5 | 6.0 |
| 1 week | 36 | 5.2 | 6.3 | -2.2 | 8.5 |
| 2 weeks | 16 | 6.9 | 8.6 | -5.8 | 11.7 |
| 3 weeks | 10 | 11.7 | 13.2 | -11.7 | 16.0 |
| 4 weeks or more | 11 | 20.3 | 21.2 | -20.3 | 24.9 |

At 2 weeks of real lead, 16 of 30 cutoffs got a date. At 4 weeks or more,
11 of 32 got one; the other 21 showed no date because the line put the
crossing more than 3 weeks out. With a 56-day limit instead, the same line
errs 10.0 days (MAE, n 26) at 2 weeks and 13.8 days (n 30) at 4 weeks or
more.

Shipped band, by forecast horizon (what the view can know when it draws):

| Horizon | n | MAE d | P80 abs d (the band) |
|---|---|---|---|
| 0 to 6 days | 61 | 5.1 | 8.2 |
| 1 week | 44 | 6.3 | 8.8 |
| 2 weeks | 28 | 10.9 | 16.0 |

Methods compared. The pooled rate uses only seasons before the lot's, as it
would in production. All rows use the 3-week display limit:

| Method | Cutoffs dated | MAE by horizon week 0 / 1 / 2 (d) | P80 week 0 / 1 / 2 (d) |
|---|---|---|---|
| Whole-season line (shipped) | 133 | 5.1 / 6.3 / 10.9 | 8.2 / 8.8 / 16.0 |
| Line on last 4 samples | 114 | 4.3 / 7.8 / 11.4 | 6.6 / 9.0 / 15.2 |
| Pooled past rate from the last reading | 190 | 8.4 / 14.3 / 12.6 | 14.9 / 26.8 / 16.4 |
| Lot slope shrunk toward the pooled rate | 148 | 5.5 / 8.8 / 10.7 | 8.4 / 11.2 / 17.3 |

With every other season as the pool (leave one season out), the pooled rate
was the best method at 0 to 2 weeks of real lead (MAE 3.3, 3.8, 7.3 days).
With only earlier seasons it was the worst. The 2024 rate, measured from 22
Bx up, does not describe a 2025 lot. The whole-season line needs no past
season and was steady under both rules, so it ships. Recheck the pooled rate
when 2027 adds a third full season.

Brix on the actual harvest day (first reception, tonnage-weighted Brix that
day; 113 lots joined to a reception, 413 cutoffs), shipped line versus the last
reading:

| Lead | n | MAE Bx line | MAE Bx last reading |
|---|---|---|---|
| 0 to 6 days | 112 | 1.30 | 1.40 |
| 1 week | 119 | 1.52 | 1.92 |
| 2 weeks | 85 | 2.22 | 2.59 |
| 3 weeks | 48 | 2.90 | 2.94 |
| 4 weeks or more | 49 | 3.67 | 3.14 |

### Forecast record

`GET /api/pronostico` (any session) records each forecast it issues in
`public.pronosticos`: one row per lot, cutoff (last sample day), model and
target, insert-or-ignore, so a reload writes nothing new. `GET
/api/pronostico?corte=YYYY-MM-DD` replays a past day and records nothing. The
"Al dia" date field uses it. Only the service key reaches the table: RLS is
on, there are no policies, and anon and authenticated have no grants. Score a
season with:

```sql
select p.lote, p.fecha_corte, p.fecha_pronostico, p.banda_dias, p.objetivo
  from pronosticos p where p.tipo = 'brix_objetivo' and p.vendimia = 2027
 order by p.lote, p.fecha_corte;
```

To refresh the band after a season: pull the two files again, rerun the
script with `--json js/pronostico/brixBanda.js` and commit. MT.64 fails if the
band lacks a week that a date can show.
