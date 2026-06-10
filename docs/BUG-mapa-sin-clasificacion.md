# Mapa Calidad "Sin datos" — diagnóstico (2026-06-10)

## Causa raíz #1 (GLOBAL — por esto el mapa lleva toda la temporada gris)
`joinBerryWithReceptions` (js/dataLoader.js) exige `rl.reception_id`:
```js
if (!rl || !rl.lot_code || !rl.reception_id) continue;
```
Pero desde `migration_reception_lots_upsert.sql`, los uploads escriben
`reception_lots` con **report_code** y `reception_id = NULL` ("the
reception_id path never worked"). Resultado: TODOS los lotes de recepción
subidos se descartan → av/ag/polifenoles nunca llegan a las bayas →
`impSum` máx ≈ 54 < 60 (guard en classification.js) → grade null en TODO
el mapa. La calificación REQUIERE la química de recepción (av 13 + ag 13 +
poli 20 pts de importancia).

**Fix (YA APLICADO en working tree, NO commiteado):** join por
`report_code` (primario) con fallback a `reception_id` (demo/legacy), en
`joinBerryWithReceptions`.

## Causa raíz #2 (Kompali/Dominio — ya en main, PR #33)
Dialectos de lote: mediciones escriben `TEKMP-S1`/`SYUC-L5`; bayas usan
`KTE-S1`/`SYDA-L5`. Resuelto con `CONFIG.normalizeFieldLotCode` aplicado
al leer y al ingerir. + claves duplicadas en config.js fusionadas.

## Causa raíz #3 (incluida en el fix #1, no commiteada)
Los lotes de recepción llevan prefijo de vendimia (`25TEKMP-S1`) y el
normalizador de dialecto ancla en letras → hay que aplicar
`_normalizeLotCode` (quita el `25`) ANTES de `normalizeFieldLotCode`.

## Estado
- PR #31, #32, #33 fusionados en main.
- Working tree: fix de #1 y #3 aplicado en js/dataLoader.js, SIN commit,
  SIN tests nuevos, SIN push.

## Pasos restantes
1. Test de regresión: reception_lots con `report_code` (sin reception_id)
   + lote `25TEKMP-S1` debe unir con baya `KTE-S1` vintage 2025 y
   producir grade (extender tests/mt36-lot-dialect.test.mjs).
2. `npm test` (447 deben pasar + nuevos) y `npm run build`.
3. Commit + push a `claude/zen-brahmagupta-u27qt4`, PR a main, merge.
4. Verificar en vivo: mapa Calidad 2025 debe colorear secciones que
   tengan medición + recepción. Si alguna sección sigue gris: revisar en
   Supabase que `reception_lots.report_code` no sea NULL y que
   `tank_receptions.vintage_year` esté poblado.
