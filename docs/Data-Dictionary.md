# Data Dictionary

## Chemistry and Phenolics

| Field | DB Column | UI Label (Spanish) | Unit | Meaning | Source |
|-------|-----------|-------------------|------|---------|--------|
| Brix | brix | Brix | Bx | Sugar content of grape juice. Higher = riper. | WineXRay, Recepcion |
| pH | ph | pH | (unitless) | Acidity level. Lower = more acidic. Wine grapes typically 3.0-4.0. | WineXRay, Recepcion |
| Titratable Acidity | ta | A.T. / Acidez Total | g/L | Total acid concentration measured by titration. | WineXRay, Recepcion |
| Total Anthocyanins | tant | tANT | ppm ME | Total color pigments (malvidin equivalents). Key quality marker for red wines. | WineXRay |
| Free Anthocyanins | fant | fANT | ppm ME | Unbound anthocyanins, extractable fraction. | WineXRay |
| Bound Anthocyanins | bant | bANT | ppm ME | Anthocyanins bound to tannins/polysaccharides. | WineXRay |
| Polymerized Tannins | ptan | pTAN | ppm CE | Polymerized tannin concentration (catechin equivalents). | WineXRay |
| Iron-Reactive Phenolics | irps | iRPs | ppm CE | Iron-reactive phenolic compounds. | WineXRay |
| Total Phenolics Index | ipt | IPT | (index) | Overall phenolic content. Measured by spectrophotometry. | WineXRay, SPICA |
| Gluconic Acid | ag | A.G. | g/L | Indicator of botrytis or bacterial activity. | Recepcion |
| Malic Acid | am | A.M. | g/L | Green-apple acid. Decreases during ripening and MLF. | WineXRay, Recepcion |
| Volatile Acidity | av / va | A.V. | g/L | Acetic acid content. High values indicate spoilage. | WineXRay, Recepcion |
| Alcohol | alcohol | Alcohol | % v/v | Ethanol content of wine. | WineXRay |
| Residual Sugars | rs | Azucares Residuales | g/L | Unfermented sugar remaining in wine. | WineXRay |

## Color Values (CIELab)

| Field | DB Column | Unit | Meaning |
|-------|-----------|------|---------|
| L* | l_star | (unitless) | Lightness. 0 = black, 100 = white. |
| a* | a_star | (unitless) | Red-green axis. Positive = red, negative = green. |
| b* | b_star | (unitless) | Yellow-blue axis. Positive = yellow, negative = blue. |

## Berry Physical Measurements

| Field | DB Column | UI Label | Unit | Meaning |
|-------|-----------|----------|------|---------|
| Berry Weight | berry_weight | Peso Baya | g | Fresh weight per berry |
| Berry Anthocyanins | berry_anthocyanins | Antocianinas Baya | mg/100b | Extractable anthocyanins per 100 berries |
| Berry Sugars | berry_sugars_mg | Azucares Baya | mg/b | Sugar content per berry |

## Mediciones Tecnicas Fields

| Field | DB Column | UI Label | Unit | Meaning |
|-------|-----------|----------|------|---------|
| Tonnage | tons_received | Toneladas | t | Weight of grape lot received |
| Berry Avg Weight | berry_avg_weight_g | Peso Prom. Baya | g | Average weight per berry in sample |
| Berry Diameter | berry_diameter_mm | Diametro Prom. | mm | Average berry diameter |
| Berry Count | berry_count_sample | (computed) | count | Total berries in health sort sample |
| Health Grade | health_grade | Grado Sanitario | (category) | Excelente, Bueno, Regular, Malo |

## Health Sort Categories (200-berry sort)

| Field | DB Column | UI Label | Meaning |
|-------|-----------|----------|---------|
| Mature | health_madura | Madura | Healthy, fully ripe berries |
| Immature | health_inmadura | Inmadura | Underripe, green berries |
| Overripe | health_sobremadura | Sobremadura | Overripe, desiccated berries |
| Insect Damage | health_picadura | Picadura | Berries with insect punctures |
| Disease | health_enfermedad | Enfermedad | Berries showing disease (botrytis, etc.) |
| Sunburn | health_quemadura | Quemadura | Sun-damaged berries |

## Extraction

| Concept | Meaning |
|---------|---------|
| Extraction % | `(wine_tANT / berry_tANT) * 100`. Percentage of berry anthocyanins transferred to wine. |
| Quality bands | <30% = poor (red), 30-50% = average (gold), >50% = good (green) |

## Naming Conventions

### Language Convention
- **Database columns:** English, snake_case (`sample_id`, `berry_weight`, `health_madura`)
- **JavaScript properties:** English, camelCase (`sampleId`, `berryWeight`, `healthMadura`)
- **UI labels:** Spanish (`Brix`, `Acidez Total`, `Peso Baya`, `Toneladas`)
- **Chart titles/subtitles:** Spanish
- **Error messages:** Spanish
- **Code comments:** English

### Appellation Format
Ranch-first with valley abbreviation in parentheses:
- `Monte Xanic (VDG)`, `Kompali (VON)`, `Dubacano (SV)`

### Valley Abbreviations

| Abbreviation | Full Name | Coordinates |
|-------------|-----------|-------------|
| VDG | Valle de Guadalupe | 32.08, -116.62 |
| VON | Valle de Ojos Negros | 32.00, -116.25 |
| SV | San Vicente | 32.05, -116.45 |
| VP | Valle de Parras | (external, no weather) |

### Sample ID Format
`{YY}{VARIETY_CODE}{RANCH_CODE}-{SEQ}`
- `25CSMX-1` = 2025, Cabernet Sauvignon, Monte Xanic, sequence 1

### Ranch Code Mapping
| Code | Ranch |
|------|-------|
| MX | Monte Xanic |
| OLE | Ole |
| 7L | Siete Leguas |
| R14 | Rancho 14 |
| K* | Kompali |
| VA | Vina Alta |
| ON | Ojos Negros |
| DA/DLA | Dominio de las Abejas |
| DUB | Dubacano |
| LLC | Llano Colorado |
