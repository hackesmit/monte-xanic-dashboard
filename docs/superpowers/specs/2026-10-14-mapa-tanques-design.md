# Design: Mapa de Tanques

**Date:** 2026-10-14
**Author:** Daniel (spec) + Claude (data model)
**Status:** Data layer shipped (bead xd-qrn.1). API, UI and lab inference pending (xd-qrn.3, xd-qrn.4).
**Epic:** xd-qrn
**Reference inputs:** `inventario-tanques.xlsx` (121 vasijas), `plano-bodega.jpeg` (architectural floor plan, north up), approved mockup `mockups/mapa-tanques.html` (version 3).

---

## 1. Goal

A new dashboard tab **Tanques**: a top-down plan of the bodega. Users assign lotes to
tanks, record trasiegos by drag and drop, and read the movement history per tank and per
lote. Clicking a tank opens its lote, its stage and its charts.

The mockup in `mockups/mapa-tanques.html` is authoritative for the look: Daniel approved
the layout, the slight 3D view and the variety colours. Port the look and behaviour and
replace its example data with real data.

## 2. Non-goals (v1)

- Barrel (`BCA`) and bin (`BIN`) tracking. Those are areas, not vessels.
- Naming a blend. Two or more lotes in one tank form a blend whose composition is by
  volume; it gets no new lot code in v1 (open question 3).
- Automatic trasiego creation. Lab inference only ever *proposes*; a person confirms.

## 3. Layout (authoritative)

Rows run east to west, A at the north and H at the south. Walkways: `A | B C | D E | F G | H`
(B and C touch, D and E touch, F and G touch). Position 1 of each row is at the **west**
end, beside recepcion. That is an assumption, not confirmed by Daniel, so it is a value in
`dim_tanque.posicion` rather than a rule in code: inverting it is one UPDATE.

The west strip is the "Area de recepcion y molienda" with R1 and R2 on the top row and
PD-1 and PD-2 on the second, plus a "Prensas" area near the south. A service walkway runs
along the north and an exterior walkway along the south; the inner walkways carry no label.

Tanks all have roughly the same diameter, so drawn height is proportional to capacity. The
side band shows the fill level, coloured by variety (or by stage, or by fill level, from a
toggle).

Vessels with no confirmed location (VAR A/B, VAR 1/2 CESAR, I-1..I-6 CAVA, the tibores, the
Domecq tanks, the kegs) sit in an "Otras areas" tray, ordered by `dim_tanque.orden`, until
Daniel gives their positions (open question 4).

## 4. Data model: event sourced

`sql/migration_tanques.sql`. Three tables, all server-only.

| Table | Role |
|-------|------|
| `dim_tanque` | one row per vessel from the inventory (121) |
| `dim_tanque_sinonimo` | capture alias to canonical codigo |
| `movimientos_tanque` | append-only log of wine movements |

**A tank's current contents are never stored.** They are derived from the log: litres in
with `destino = codigo`, minus litres out with `origen = codigo`, minus `merma_l`, over the
rows where `anulado = false`. One source of truth, and an undo that marks `anulado = true`
instead of deleting history.

Append-only is enforced by two triggers on `movimientos_tanque`, not by convention:
a `FOR EACH ROW BEFORE UPDATE OR DELETE` trigger that allows exactly one change (`anulado`
false to true) and refuses every DELETE, and a `FOR EACH STATEMENT BEFORE TRUNCATE` trigger,
because a row-level trigger never sees a TRUNCATE. Triggers also bind the service key and
the Supabase SQL editor, which RLS does not. A deliberate correction is
`ALTER TABLE public.movimientos_tanque DISABLE TRIGGER USER`, run on purpose.

Movement types: `recepcion`, `trasiego`, `descube`, `sangrado`, `prensa`, `ensamble`,
`salida`. `origen` NULL means the wine enters the bodega (recepcion); `destino` NULL means
it leaves (bottling or bulk sale). CHECK constraints require at least one endpoint, forbid
`origen = destino`, and make explicit that a `recepcion` needs a `destino` and a `salida`
needs an `origen`. The other types may have one NULL endpoint: a press and a barrel are not
catalog vessels.

## 5. Code normalization

The canonical codigo has its whitespace collapsed and trimmed, so the inventory's
`'TIBOR  1'` and `'TIBOR 8 '` are seeded as `TIBOR 1` and `TIBOR 8`.

Anything resolving a `vessel_id` must collapse whitespace and uppercase **before** looking
up `dim_tanque.codigo` and then `dim_tanque_sinonimo.sinonimo`. Because of that rule the
synonym table holds no variants that differ only in whitespace.

What the lab actually writes in `wine_samples.vessel_id` is `PD1`, `TIB 17`, `I4`. Three
families are seeded, each complete for every vessel in it rather than only for the ones
already seen:

| Canonical | Synonyms |
|-----------|----------|
| `TIBOR n` | `TIB n`, `TIBn`, `TIBORn` |
| `I-n CAVA` | `In`, `I-n`, `I n` |
| `PD-n` | `PDn`, `PD n` |
| `Rn` | `R-n` |

Hyphenated tibor forms (`TIBOR-13`) are deliberately left out: nobody has written one.
Adding them is a one-line INSERT.

### Unresolved vessel ids

Measured against production on 2026-10-14, these appear in `wine_samples.vessel_id` and are
deliberately **not** seeded:

| vessel_id | Samples | Why not |
|-----------|---------|---------|
| `BCA` | 145 | Barricas: an area, not a vessel |
| `BIN` | 120 | Bins: an area, not a vessel |
| `TIBOR 17` / `TIB 17` | 6 | Cited by the lab, absent from the inventory |
| `TIBOR 24` | 3 | Same |
| `F036` | 2 | Same (the inventory has F026, F028..F031, F038, F039) |
| `C9` | 2 | Unresolved; the spec says do not guess |
| `FI` | 1 | Unresolved |
| `200` | 1 | Unresolved |

Seeding any of them would mean inventing a capacity and an area. The trasiego inference
(xd-qrn.4) must therefore **show** an unresolved vessel rather than silently drop the
sample, which is the failure mode `groupScatterData` already taught this project.

## 6. Lab inference (xd-qrn.4)

`wine_samples.vessel_id` records which tank each sample came from. In 2025, 52 of 65 lotes
appear in more than one vessel. When a lote's vessel changes between two consecutive
samples, propose a trasiego (from, to, date). Users confirm or dismiss. A confirmed proposal
becomes a `movimientos_tanque` row with `fuente = 'lab'`. Resolve `vessel_id` through
`dim_tanque_sinonimo` per section 5.

## 7. Permissions

Reads: any logged-in user. Writes: role `lab`, same as `api/row.js`.

Neither of those is a Postgres role. The dashboard session is a token this app issues, not a
Supabase Auth JWT, so an RLS `authenticated` check distinguishes nobody. So the three tables
follow the `mona_*` pattern and category 3 of `migration_rls_lockdown`: RLS enabled with
**no policies** (deny by default), and the grants the public schema hands `anon` and
`authenticated` revoked, including on the `BIGSERIAL` sequence. Every read and write goes
through an endpoint holding the service key that checks the role server-side (xd-qrn.3).

## 8. Open questions (do not block v1)

1. Numbering direction (assumed west = 1).
2. The floor plan says 72 fermentation tanks; inventory rows A to H total 68.
3. How a blend is named (new code, or the majority lote's code).
4. Physical locations of the CAVA tanks, tibores, Domecq tanks, kegs and VAR A/B.
5. Whether cellar staff need their own write role.
