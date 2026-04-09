# Domain Model

## Conceptual Entities

```
Valley (VDG, VON, SV)
  └── Ranch / Appellation (Monte Xanic, Kompali, Dubacano, ...)
       └── Vineyard Lot (CSMX-1, SYON-3, ...)
            ├── Berry Sample (wine_samples where sample_type='Berry')
            │     └── Chemistry: Brix, pH, tANT, TA, weight, color
            ├── Medicion Tecnica (mediciones_tecnicas)
            │     ├── Physical: tonnage, berry weight, diameter
            │     └── Health Sort: madura, inmadura, sobremadura, ...
            └── Wine Sample (wine_samples where sample_type='Aging Wine'|'Must'|...)
                  └── Phenolics: tANT, fANT, pTAN, IPT, alcohol, color

Tank Reception (tank_receptions)
  ├── Reception Lots (reception_lots): 1-4 vineyard lots per reception
  └── Prefermentativos (prefermentativos): pre-fermentation measurements

Weather Record (meteorology)
  └── Daily: temp, rainfall, humidity, UV, wind per valley
```

## Entity Relationships

### Berry to Wine (soft link)
Berry measurements and wine measurements both live in `wine_samples`, differentiated by `sample_type`. There is no explicit foreign key linking a berry measurement to its resulting wine. The `berryToWine` mapping in `charts.js` uses lot code pattern matching to connect berry lots to wine lots for extraction calculations.

**Example:** Berry lot `25CSMX-1` (Cabernet Sauvignon, Monte Xanic) maps to wine lot `25CSMX` by stripping the trailing sequence number.

### Medicion to Wine Sample (soft link)
`mediciones_tecnicas.lot_code` can reference a `wine_samples.sample_id`, but this is not an enforced foreign key. The field is optional and used for cross-referencing only. No join queries depend on it.

### Reception to Lots (enforced)
`reception_lots.reception_id` references `tank_receptions.id`. However, no formal FK constraint exists in the schema. The relationship is maintained by application logic during upload (query reception IDs after insert, then insert lots).

### Weather to Samples (derived)
Weather data is linked to samples by extracting the valley abbreviation from the sample's appellation (e.g. `Kompali (VON)` -> `VON`) and matching against `meteorology.location`. This happens at chart render time, not stored as a relationship.

### Extraction Relationship
The extraction view calculates `berry_tANT -> wine_tANT` transfer rates:
1. Group berry data by lot (latest measurement per lot)
2. Match to wine data by lot code pattern
3. Calculate: `extraction_pct = (wine_tANT / berry_tANT) * 100`

This is entirely computed at render time. No stored extraction metrics exist.

## Key Identifiers

| Entity | Identifier | Format | Example |
|--------|-----------|--------|---------|
| Sample | sample_id | {YY}{VARIETY}{RANCH}-{SEQ} | 25CSMX-1 |
| Tank Reception | report_code | RRT-{NNN} | RRT-001 |
| Winery Batch | batch_code | {YY}{VARIETY}{VALLEY}-{SEQ} | 25SBVDG-1 |
| Vineyard Lot | lot_code | {VARIETY}{RANCH}-{BLOCK} | SBMX-3A |
| Medicion | medicion_code | MT-{YYYY}-{NNN} | MT-2025-001 |
| Weather | (date, location) | composite | (2025-08-15, VDG) |

## Vintage Model

A "vendimia" (vintage) corresponds to a harvest year. The harvest season runs from approximately July through October in Baja California. Weather data is fetched for Jul 1 - Oct 31 of each vintage year.

Vintage is extracted from:
- `vintage_year` column (explicit)
- `batch_code` prefix (e.g. `25` -> 2025)
- `sample_id` prefix (e.g. `25CSMX-1` -> 2025)

## Data Quality Notes

- Berry and wine data coexist in the same table (`wine_samples`), distinguished only by `sample_type`. This simplifies the schema but requires careful filtering.
- The `below_detection` flag indicates that at least one analyte value was below the instrument's detection limit. The actual value is stored as NULL, not as the detection threshold.
- Excluded samples (lab tests, experiments, California) are filtered during upload, not at query time. If such samples exist in the database from before the filter was added, they appear in the dashboard.
