# Test Fixtures

Synthetic, anonymized slices of the Monte Xanic data files used for parser tests.

- `winexray_mixed.csv` — 8 rows covering every classifier branch (wine, berry, excluded, rejected)
- `recepcion_sample.xlsx` — 2 receptions + 1 prefermentativo row
- `prerecepcion_sample.xlsx` — 4 rows including PENDIENTE and missing-reporte cases

If you regenerate these, keep the row counts and coverage intentions above — the parser tests assert exact counts per bucket.
