-- ==================================================================
-- migration_tanques
--
-- Catalogo de vasijas y bitacora de movimientos para la pestana "Mapa de
-- Tanques" (epic xd-qrn, spec docs/superpowers/specs/2026-10-14-mapa-tanques-design.md).
--
-- Tres tablas:
--   dim_tanque            una fila por vasija del inventario (121 vasijas)
--   dim_tanque_sinonimo   alias de captura -> codigo canonico
--   movimientos_tanque    bitacora append-only de movimientos de vino
--
-- El contenido actual de un tanque NO se guarda: se DERIVA de la bitacora
-- (suma de volumen_l con destino = tanque menos los que salen de el). Esa es
-- la decision de diseno central del epic: una sola fuente de verdad, y un
-- "deshacer" que marca anulado en lugar de borrar historia.
--
-- Fuente del catalogo: inventario-tanques.xlsx (121 vasijas, columnas TANQUE /
-- TQ-BCA / CAPACIDAD) que Daniel entrego con la spec el 2026-10-14. A
-- diferencia de migration_dim_catalogs.sql, este archivo NO es generado: el
-- inventario vive fuera del repo, asi que el .sql ES la fuente de verdad y
-- tests/mt50-tanques-schema.test.mjs es su guarda contra ediciones a mano.
--
-- Normalizacion de codigos: el codigo canonico va con espacios colapsados y
-- sin espacios al final ('TIBOR  1' y 'TIBOR 8 ' del inventario entran como
-- 'TIBOR 1' y 'TIBOR 8'). Quien resuelva un vessel_id debe colapsar espacios y
-- pasar a mayusculas ANTES de buscar, primero en dim_tanque.codigo y luego en
-- dim_tanque_sinonimo.sinonimo; por eso la tabla de sinonimos no guarda
-- variantes que solo difieren en espacios.
--
-- Vessel ids que aparecen en wine_samples y que a proposito NO se siembran
-- (medido en produccion el 2026-10-14):
--   BIN (120 muestras), BCA (145)  areas, no vasijas: bins y barricas.
--   C9 (2), FI (1), 200 (1)        sin resolver; la spec ordena no adivinar.
--   TIBOR 17 / TIB 17 (6), TIBOR 24 (3), F036 (2)
--                                  vasijas citadas por el laboratorio que el
--                                  inventario no tiene. Sembrarlas seria
--                                  inventar capacidad y area. Quedan como
--                                  "sin resolver" para la inferencia de
--                                  trasiegos (xd-qrn.4), que debe mostrarlas
--                                  en lugar de silenciarlas. Nota P2 en el bead.
--
-- Idempotente y transaccional: seguro de re-correr.
-- ==================================================================

BEGIN;

-- --- dim_tanque ---
-- fila/posicion son la rejilla del plano: filas A (norte) a H (sur) para la
-- sala de fermentacion, R y P para las dos filas del area de recepcion
-- (R1 R2 arriba, PD-1 PD-2 abajo). posicion 1 es el extremo OESTE, junto a
-- recepcion; es el supuesto de la spec, aun sin confirmar por Daniel, y la UI
-- lo lee de aqui para poder invertirlo con un solo UPDATE.
-- Las vasijas sin ubicacion conocida (CAVA, tibores, Domecq, kegs, VAR) van
-- con area 'otras' y fila/posicion NULL; la UI las dibuja en la bandeja
-- "Otras areas" ordenadas por `orden`.
CREATE TABLE IF NOT EXISTS public.dim_tanque (
  codigo      TEXT PRIMARY KEY,
  fila        TEXT,
  posicion    INT,
  capacidad_l NUMERIC NOT NULL,
  tipo        TEXT    NOT NULL,
  area        TEXT    NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT true,
  orden       INT     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT dim_tanque_tipo_chk      CHECK (tipo IN ('TQ', 'TIBOR', 'DOMECQ', 'KEG')),
  CONSTRAINT dim_tanque_area_chk      CHECK (area IN ('fermentacion', 'recepcion', 'otras')),
  CONSTRAINT dim_tanque_capacidad_chk CHECK (capacidad_l > 0),
  CONSTRAINT dim_tanque_fila_chk      CHECK (fila IS NULL OR fila IN ('A','B','C','D','E','F','G','H','R','P')),
  CONSTRAINT dim_tanque_posicion_chk  CHECK (posicion IS NULL OR posicion > 0),
  -- una vasija ubicada tiene fila Y posicion; una de 'otras areas' no tiene ninguna
  CONSTRAINT dim_tanque_layout_chk    CHECK (
    (area = 'otras'  AND fila IS NULL     AND posicion IS NULL)
    OR
    (area <> 'otras' AND fila IS NOT NULL AND posicion IS NOT NULL)
  )
);

COMMENT ON TABLE  public.dim_tanque IS
  'Catalogo de vasijas de la bodega. Sembrado de inventario-tanques.xlsx (2026-10-14).';
COMMENT ON COLUMN public.dim_tanque.posicion IS
  'Posicion en la fila, 1 = extremo oeste (supuesto de la spec, invertible).';
COMMENT ON COLUMN public.dim_tanque.capacidad_l IS 'Capacidad nominal en litros.';
COMMENT ON COLUMN public.dim_tanque.orden IS
  'Orden original del inventario; da un orden estable a la bandeja "Otras areas".';
COMMENT ON COLUMN public.dim_tanque.activo IS
  'false retira la vasija del mapa sin borrar su historia. Re-correr la migracion NO lo reactiva.';

-- Dos vasijas no pueden ocupar la misma casilla. DEFERRABLE para que un futuro
-- re-acomodo de una fila pueda moverlas dentro de una transaccion. No sirve de
-- arbitro de ON CONFLICT, y no hace falta: el arbitro es la llave primaria.
ALTER TABLE public.dim_tanque DROP CONSTRAINT IF EXISTS dim_tanque_casilla_uniq;
ALTER TABLE public.dim_tanque ADD  CONSTRAINT dim_tanque_casilla_uniq
  UNIQUE (fila, posicion) DEFERRABLE INITIALLY IMMEDIATE;

INSERT INTO public.dim_tanque (codigo, fila, posicion, capacidad_l, tipo, area, orden) VALUES
  ('R1', 'R', 1, 18000, 'TQ', 'recepcion', 1),
  ('R2', 'R', 2, 18000, 'TQ', 'recepcion', 2),
  ('PD-1', 'P', 1, 14500, 'TQ', 'recepcion', 3),
  ('PD-2', 'P', 2, 14500, 'TQ', 'recepcion', 4),
  ('A1', 'A', 1, 7400, 'TQ', 'fermentacion', 5),
  ('A2', 'A', 2, 7410, 'TQ', 'fermentacion', 6),
  ('A3', 'A', 3, 2150, 'TQ', 'fermentacion', 7),
  ('A4', 'A', 4, 7400, 'TQ', 'fermentacion', 8),
  ('A5', 'A', 5, 15000, 'TQ', 'fermentacion', 9),
  ('A6', 'A', 6, 15000, 'TQ', 'fermentacion', 10),
  ('A7', 'A', 7, 14900, 'TQ', 'fermentacion', 11),
  ('A8', 'A', 8, 15150, 'TQ', 'fermentacion', 12),
  ('B1', 'B', 1, 7400, 'TQ', 'fermentacion', 13),
  ('B2', 'B', 2, 7400, 'TQ', 'fermentacion', 14),
  ('B3', 'B', 3, 2150, 'TQ', 'fermentacion', 15),
  ('B4', 'B', 4, 3979, 'TQ', 'fermentacion', 16),
  ('B5', 'B', 5, 15000, 'TQ', 'fermentacion', 17),
  ('B6', 'B', 6, 15000, 'TQ', 'fermentacion', 18),
  ('B7', 'B', 7, 18700, 'TQ', 'fermentacion', 19),
  ('VAR A', NULL, NULL, 4000, 'TQ', 'otras', 20),
  ('C1', 'C', 1, 18700, 'TQ', 'fermentacion', 21),
  ('C2', 'C', 2, 18700, 'TQ', 'fermentacion', 22),
  ('C3', 'C', 3, 18700, 'TQ', 'fermentacion', 23),
  ('C4', 'C', 4, 18700, 'TQ', 'fermentacion', 24),
  ('C5', 'C', 5, 18700, 'TQ', 'fermentacion', 25),
  ('C6', 'C', 6, 18700, 'TQ', 'fermentacion', 26),
  ('C7', 'C', 7, 18700, 'TQ', 'fermentacion', 27),
  ('D1', 'D', 1, 10300, 'TQ', 'fermentacion', 28),
  ('D2', 'D', 2, 10300, 'TQ', 'fermentacion', 29),
  ('D3', 'D', 3, 13563, 'TQ', 'fermentacion', 30),
  ('D4', 'D', 4, 10300, 'TQ', 'fermentacion', 31),
  ('D5', 'D', 5, 10300, 'TQ', 'fermentacion', 32),
  ('D6', 'D', 6, 18700, 'TQ', 'fermentacion', 33),
  ('D7', 'D', 7, 18700, 'TQ', 'fermentacion', 34),
  ('D8', 'D', 8, 18700, 'TQ', 'fermentacion', 35),
  ('E1', 'E', 1, 8200, 'TQ', 'fermentacion', 36),
  ('E2', 'E', 2, 8200, 'TQ', 'fermentacion', 37),
  ('E3', 'E', 3, 8200, 'TQ', 'fermentacion', 38),
  ('E4', 'E', 4, 8200, 'TQ', 'fermentacion', 39),
  ('E5', 'E', 5, 8200, 'TQ', 'fermentacion', 40),
  ('E6', 'E', 6, 8200, 'TQ', 'fermentacion', 41),
  ('E7', 'E', 7, 1400, 'TQ', 'fermentacion', 42),
  ('E8', 'E', 8, 18700, 'TQ', 'fermentacion', 43),
  ('E9', 'E', 9, 18700, 'TQ', 'fermentacion', 44),
  ('F1', 'F', 1, 18700, 'TQ', 'fermentacion', 45),
  ('F2', 'F', 2, 8200, 'TQ', 'fermentacion', 46),
  ('F3', 'F', 3, 8200, 'TQ', 'fermentacion', 47),
  ('F4', 'F', 4, 8200, 'TQ', 'fermentacion', 48),
  ('F5', 'F', 5, 8200, 'TQ', 'fermentacion', 49),
  ('F6', 'F', 6, 8200, 'TQ', 'fermentacion', 50),
  ('F7', 'F', 7, 8200, 'TQ', 'fermentacion', 51),
  ('F8', 'F', 8, 8200, 'TQ', 'fermentacion', 52),
  ('F9', 'F', 9, 8200, 'TQ', 'fermentacion', 53),
  ('F10', 'F', 10, 18700, 'TQ', 'fermentacion', 54),
  ('G1', 'G', 1, 15157, 'TQ', 'fermentacion', 55),
  ('G2', 'G', 2, 15400, 'TQ', 'fermentacion', 56),
  ('G3', 'G', 3, 14479, 'TQ', 'fermentacion', 57),
  ('G4', 'G', 4, 15000, 'TQ', 'fermentacion', 58),
  ('G5', 'G', 5, 15000, 'TQ', 'fermentacion', 59),
  ('G6', 'G', 6, 15000, 'TQ', 'fermentacion', 60),
  ('G7', 'G', 7, 15157, 'TQ', 'fermentacion', 61),
  ('G8', 'G', 8, 18700, 'TQ', 'fermentacion', 62),
  ('H1', 'H', 1, 18700, 'TQ', 'fermentacion', 63),
  ('H2', 'H', 2, 18700, 'TQ', 'fermentacion', 64),
  ('H3', 'H', 3, 10366, 'TQ', 'fermentacion', 65),
  ('H4', 'H', 4, 10366, 'TQ', 'fermentacion', 66),
  ('H5', 'H', 5, 10366, 'TQ', 'fermentacion', 67),
  ('H6', 'H', 6, 10366, 'TQ', 'fermentacion', 68),
  ('H7', 'H', 7, 10366, 'TQ', 'fermentacion', 69),
  ('H8', 'H', 8, 10366, 'TQ', 'fermentacion', 70),
  ('H9', 'H', 9, 10366, 'TQ', 'fermentacion', 71),
  ('H10', 'H', 10, 10366, 'TQ', 'fermentacion', 72),
  ('H11', 'H', 11, 10366, 'TQ', 'fermentacion', 73),
  ('I-1 CAVA', NULL, NULL, 10000, 'TQ', 'otras', 74),
  ('I-2 CAVA', NULL, NULL, 10000, 'TQ', 'otras', 75),
  ('I-3 CAVA', NULL, NULL, 10000, 'TQ', 'otras', 76),
  ('I-4 CAVA', NULL, NULL, 10000, 'TQ', 'otras', 77),
  ('I-5 CAVA', NULL, NULL, 10000, 'TQ', 'otras', 78),
  ('I-6 CAVA', NULL, NULL, 10000, 'TQ', 'otras', 79),
  ('VAR B', NULL, NULL, 1000, 'TQ', 'otras', 80),
  ('VAR 1 CESAR', NULL, NULL, 300, 'TQ', 'otras', 81),
  ('VAR 2 CESAR', NULL, NULL, 300, 'TQ', 'otras', 82),
  ('TIBOR 1', NULL, NULL, 1000, 'TIBOR', 'otras', 83),
  ('TIBOR 2', NULL, NULL, 1000, 'TIBOR', 'otras', 84),
  ('TIBOR 3', NULL, NULL, 1000, 'TIBOR', 'otras', 85),
  ('TIBOR 4', NULL, NULL, 1000, 'TIBOR', 'otras', 86),
  ('TIBOR 5', NULL, NULL, 1000, 'TIBOR', 'otras', 87),
  ('TIBOR 6', NULL, NULL, 1000, 'TIBOR', 'otras', 88),
  ('TIBOR 7', NULL, NULL, 1000, 'TIBOR', 'otras', 89),
  ('TIBOR 8', NULL, NULL, 1000, 'TIBOR', 'otras', 90),
  ('TIBOR 9', NULL, NULL, 1000, 'TIBOR', 'otras', 91),
  ('TIBOR 10', NULL, NULL, 1000, 'TIBOR', 'otras', 92),
  ('TIBOR 11', NULL, NULL, 1000, 'TIBOR', 'otras', 93),
  ('TIBOR 12', NULL, NULL, 1000, 'TIBOR', 'otras', 94),
  ('TIBOR 14', NULL, NULL, 1000, 'TIBOR', 'otras', 95),
  ('TIBOR 13', NULL, NULL, 1000, 'TIBOR', 'otras', 96),
  ('TIBOR 15', NULL, NULL, 1000, 'TIBOR', 'otras', 97),
  ('TIBOR 16', NULL, NULL, 1000, 'TIBOR', 'otras', 98),
  ('TIBOR 18', NULL, NULL, 1000, 'TIBOR', 'otras', 99),
  ('TIBOR 21', NULL, NULL, 1000, 'TIBOR', 'otras', 100),
  ('TIBOR 22', NULL, NULL, 1000, 'TIBOR', 'otras', 101),
  ('TIBOR 28', NULL, NULL, 1000, 'TIBOR', 'otras', 102),
  ('TIBOR S/N', NULL, NULL, 1000, 'TIBOR', 'otras', 103),
  ('F026', NULL, NULL, 45000, 'DOMECQ', 'otras', 104),
  ('F028', NULL, NULL, 45000, 'DOMECQ', 'otras', 105),
  ('F029', NULL, NULL, 45000, 'DOMECQ', 'otras', 106),
  ('F030', NULL, NULL, 45000, 'DOMECQ', 'otras', 107),
  ('F031', NULL, NULL, 45000, 'DOMECQ', 'otras', 108),
  ('F038', NULL, NULL, 45000, 'DOMECQ', 'otras', 109),
  ('F039', NULL, NULL, 45000, 'DOMECQ', 'otras', 110),
  ('KEG 1', NULL, NULL, 60, 'KEG', 'otras', 111),
  ('KEG 2', NULL, NULL, 60, 'KEG', 'otras', 112),
  ('KEG 3', NULL, NULL, 60, 'KEG', 'otras', 113),
  ('KEG 4', NULL, NULL, 20, 'KEG', 'otras', 114),
  ('KEG 5', NULL, NULL, 60, 'KEG', 'otras', 115),
  ('KEG 6', NULL, NULL, 60, 'KEG', 'otras', 116),
  ('KEG 7', NULL, NULL, 60, 'KEG', 'otras', 117),
  ('KEG 11', NULL, NULL, 60, 'KEG', 'otras', 118),
  ('KEG 14', NULL, NULL, 60, 'KEG', 'otras', 119),
  ('KEG 16', NULL, NULL, 60, 'KEG', 'otras', 120),
  ('KEG 17', NULL, NULL, 60, 'KEG', 'otras', 121)
ON CONFLICT (codigo) DO UPDATE
  SET fila        = EXCLUDED.fila,
      posicion    = EXCLUDED.posicion,
      capacidad_l = EXCLUDED.capacidad_l,
      tipo        = EXCLUDED.tipo,
      area        = EXCLUDED.area,
      orden       = EXCLUDED.orden;
      -- activo queda intacto a proposito (ver COMMENT arriba)

CREATE INDEX IF NOT EXISTS dim_tanque_area_idx ON public.dim_tanque (area, fila, posicion);

-- --- dim_tanque_sinonimo ---
-- Alias de captura -> codigo canonico, con el mismo patron que
-- dim_rancho_sinonimo: un consumidor SQL (Power BI, dbt) puede repetir la
-- normalizacion sin re-implementarla.
-- Lo que de verdad escribe el laboratorio en wine_samples.vessel_id: 'PD1',
-- 'TIB 17', 'I4'. De ahi las tres familias sembradas, cada una completa para
-- todas sus vasijas y no solo para las que ya aparecieron:
--   TIBOR n  -> 'TIB n', 'TIBn', 'TIBORn'
--   I-n CAVA -> 'In', 'I-n', 'I n'
--   PD-n     -> 'PDn', 'PD n'
--   Rn       -> 'R-n'
-- Las variantes con guion de los tibores ('TIBOR-13') se dejan fuera a
-- proposito: nadie las ha escrito. Agregarlas es un INSERT de una linea.
CREATE TABLE IF NOT EXISTS public.dim_tanque_sinonimo (
  sinonimo TEXT PRIMARY KEY,
  codigo   TEXT NOT NULL REFERENCES public.dim_tanque(codigo) ON UPDATE CASCADE
);

COMMENT ON TABLE public.dim_tanque_sinonimo IS
  'Alias de captura a codigo canonico. Buscar con espacios colapsados y en mayusculas.';

INSERT INTO public.dim_tanque_sinonimo (sinonimo, codigo) VALUES
  ('I 1', 'I-1 CAVA'),
  ('I 2', 'I-2 CAVA'),
  ('I 3', 'I-3 CAVA'),
  ('I 4', 'I-4 CAVA'),
  ('I 5', 'I-5 CAVA'),
  ('I 6', 'I-6 CAVA'),
  ('I-1', 'I-1 CAVA'),
  ('I-2', 'I-2 CAVA'),
  ('I-3', 'I-3 CAVA'),
  ('I-4', 'I-4 CAVA'),
  ('I-5', 'I-5 CAVA'),
  ('I-6', 'I-6 CAVA'),
  ('I1', 'I-1 CAVA'),
  ('I2', 'I-2 CAVA'),
  ('I3', 'I-3 CAVA'),
  ('I4', 'I-4 CAVA'),
  ('I5', 'I-5 CAVA'),
  ('I6', 'I-6 CAVA'),
  ('PD 1', 'PD-1'),
  ('PD 2', 'PD-2'),
  ('PD1', 'PD-1'),
  ('PD2', 'PD-2'),
  ('R-1', 'R1'),
  ('R-2', 'R2'),
  ('TIB 1', 'TIBOR 1'),
  ('TIB 10', 'TIBOR 10'),
  ('TIB 11', 'TIBOR 11'),
  ('TIB 12', 'TIBOR 12'),
  ('TIB 13', 'TIBOR 13'),
  ('TIB 14', 'TIBOR 14'),
  ('TIB 15', 'TIBOR 15'),
  ('TIB 16', 'TIBOR 16'),
  ('TIB 18', 'TIBOR 18'),
  ('TIB 2', 'TIBOR 2'),
  ('TIB 21', 'TIBOR 21'),
  ('TIB 22', 'TIBOR 22'),
  ('TIB 28', 'TIBOR 28'),
  ('TIB 3', 'TIBOR 3'),
  ('TIB 4', 'TIBOR 4'),
  ('TIB 5', 'TIBOR 5'),
  ('TIB 6', 'TIBOR 6'),
  ('TIB 7', 'TIBOR 7'),
  ('TIB 8', 'TIBOR 8'),
  ('TIB 9', 'TIBOR 9'),
  ('TIB S/N', 'TIBOR S/N'),
  ('TIB SN', 'TIBOR S/N'),
  ('TIB1', 'TIBOR 1'),
  ('TIB10', 'TIBOR 10'),
  ('TIB11', 'TIBOR 11'),
  ('TIB12', 'TIBOR 12'),
  ('TIB13', 'TIBOR 13'),
  ('TIB14', 'TIBOR 14'),
  ('TIB15', 'TIBOR 15'),
  ('TIB16', 'TIBOR 16'),
  ('TIB18', 'TIBOR 18'),
  ('TIB2', 'TIBOR 2'),
  ('TIB21', 'TIBOR 21'),
  ('TIB22', 'TIBOR 22'),
  ('TIB28', 'TIBOR 28'),
  ('TIB3', 'TIBOR 3'),
  ('TIB4', 'TIBOR 4'),
  ('TIB5', 'TIBOR 5'),
  ('TIB6', 'TIBOR 6'),
  ('TIB7', 'TIBOR 7'),
  ('TIB8', 'TIBOR 8'),
  ('TIB9', 'TIBOR 9'),
  ('TIBOR SN', 'TIBOR S/N'),
  ('TIBOR1', 'TIBOR 1'),
  ('TIBOR10', 'TIBOR 10'),
  ('TIBOR11', 'TIBOR 11'),
  ('TIBOR12', 'TIBOR 12'),
  ('TIBOR13', 'TIBOR 13'),
  ('TIBOR14', 'TIBOR 14'),
  ('TIBOR15', 'TIBOR 15'),
  ('TIBOR16', 'TIBOR 16'),
  ('TIBOR18', 'TIBOR 18'),
  ('TIBOR2', 'TIBOR 2'),
  ('TIBOR21', 'TIBOR 21'),
  ('TIBOR22', 'TIBOR 22'),
  ('TIBOR28', 'TIBOR 28'),
  ('TIBOR3', 'TIBOR 3'),
  ('TIBOR4', 'TIBOR 4'),
  ('TIBOR5', 'TIBOR 5'),
  ('TIBOR6', 'TIBOR 6'),
  ('TIBOR7', 'TIBOR 7'),
  ('TIBOR8', 'TIBOR 8'),
  ('TIBOR9', 'TIBOR 9')
ON CONFLICT (sinonimo) DO UPDATE SET codigo = EXCLUDED.codigo;

CREATE INDEX IF NOT EXISTS dim_tanque_sinonimo_codigo_idx
  ON public.dim_tanque_sinonimo (codigo);

-- --- movimientos_tanque ---
-- Bitacora append-only. Un movimiento mueve volumen_l litros de un lote de
-- `origen` a `destino`. origen NULL = el vino entra a la bodega (recepcion);
-- destino NULL = sale de ella (embotellado o venta de granel). Por eso el
-- CHECK pide al menos uno de los dos, y los dos CHECK por tipo hacen explicito
-- que una recepcion sin destino y una salida sin origen no significan nada.
-- Los demas tipos (trasiego, descube, sangrado, prensa, ensamble) pueden tener
-- un extremo NULL: la prensa y el barril no son vasijas del catalogo.
CREATE TABLE IF NOT EXISTS public.movimientos_tanque (
  id           BIGSERIAL PRIMARY KEY,
  fecha        DATE    NOT NULL,
  tipo         TEXT    NOT NULL,
  origen       TEXT    REFERENCES public.dim_tanque(codigo) ON UPDATE CASCADE,
  destino      TEXT    REFERENCES public.dim_tanque(codigo) ON UPDATE CASCADE,
  lot_code     TEXT    NOT NULL,
  vintage_year INT     NOT NULL,
  volumen_l    NUMERIC NOT NULL,
  merma_l      NUMERIC NOT NULL DEFAULT 0,
  nota         TEXT,
  fuente       TEXT    NOT NULL,
  creado_por   TEXT,
  anulado      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT movimientos_tanque_tipo_chk CHECK (tipo IN (
    'recepcion', 'trasiego', 'descube', 'sangrado', 'prensa', 'ensamble', 'salida')),
  CONSTRAINT movimientos_tanque_fuente_chk  CHECK (fuente IN ('manual', 'lab')),
  CONSTRAINT movimientos_tanque_volumen_chk CHECK (volumen_l > 0),
  CONSTRAINT movimientos_tanque_merma_chk   CHECK (merma_l >= 0),
  CONSTRAINT movimientos_tanque_vintage_chk CHECK (vintage_year BETWEEN 1988 AND 2100),
  CONSTRAINT movimientos_tanque_lote_chk    CHECK (btrim(lot_code) <> ''),
  CONSTRAINT movimientos_tanque_extremos_chk CHECK (origen IS NOT NULL OR destino IS NOT NULL),
  CONSTRAINT movimientos_tanque_circular_chk CHECK (origen IS DISTINCT FROM destino),
  CONSTRAINT movimientos_tanque_recepcion_chk CHECK (tipo <> 'recepcion' OR destino IS NOT NULL),
  CONSTRAINT movimientos_tanque_salida_chk    CHECK (tipo <> 'salida'    OR origen  IS NOT NULL)
);

COMMENT ON TABLE public.movimientos_tanque IS
  'Bitacora append-only de movimientos de vino. Deshacer = anulado true, nunca DELETE.';
COMMENT ON COLUMN public.movimientos_tanque.fuente IS
  'manual = capturado por una persona; lab = propuesta de vessel_id confirmada.';
COMMENT ON COLUMN public.movimientos_tanque.merma_l IS
  'Litros perdidos en la operacion. Se resta del destino, no del origen.';

CREATE INDEX IF NOT EXISTS movimientos_tanque_fecha_idx   ON public.movimientos_tanque (fecha);
CREATE INDEX IF NOT EXISTS movimientos_tanque_origen_idx  ON public.movimientos_tanque (origen)  WHERE origen  IS NOT NULL;
CREATE INDEX IF NOT EXISTS movimientos_tanque_destino_idx ON public.movimientos_tanque (destino) WHERE destino IS NOT NULL;
CREATE INDEX IF NOT EXISTS movimientos_tanque_lote_idx    ON public.movimientos_tanque (lot_code, vintage_year);
CREATE INDEX IF NOT EXISTS movimientos_tanque_vivos_idx   ON public.movimientos_tanque (fecha, id) WHERE NOT anulado;

-- Append-only de verdad, no por costumbre. El contenido de cada tanque se
-- deriva de esta bitacora, asi que un UPDATE de volumen_l o un DELETE
-- reescribirian el inventario de la bodega sin dejar rastro. El trigger deja
-- pasar INSERT y exactamente un cambio: anulado de false a true.
-- Un trigger tambien frena a la service key y al SQL editor (RLS no lo hace),
-- que es justo el punto. Un segundo trigger, a nivel de sentencia, frena
-- TRUNCATE, que un trigger FOR EACH ROW no llega a ver. Para una correccion
-- deliberada: ALTER TABLE public.movimientos_tanque DISABLE TRIGGER USER.
CREATE OR REPLACE FUNCTION public.movimientos_tanque_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- TRUNCATE no dispara un trigger FOR EACH ROW, asi que se frena aparte (abajo).
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION
      'movimientos_tanque es append-only: TRUNCATE borraria la historia de la bodega';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'movimientos_tanque es append-only: usa anulado = true en lugar de DELETE (id %)', OLD.id;
  END IF;

  IF OLD.anulado AND NOT NEW.anulado THEN
    RAISE EXCEPTION 'un movimiento anulado no se puede reactivar (id %)', OLD.id;
  END IF;

  IF (NEW.id, NEW.fecha, NEW.tipo, NEW.origen, NEW.destino, NEW.lot_code,
      NEW.vintage_year, NEW.volumen_l, NEW.merma_l, NEW.nota, NEW.fuente,
      NEW.creado_por, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.fecha, OLD.tipo, OLD.origen, OLD.destino, OLD.lot_code,
      OLD.vintage_year, OLD.volumen_l, OLD.merma_l, OLD.nota, OLD.fuente,
      OLD.creado_por, OLD.created_at)
  THEN
    RAISE EXCEPTION
      'movimientos_tanque solo admite cambiar anulado: anula el id % e inserta el movimiento corregido', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS movimientos_tanque_append_only ON public.movimientos_tanque;
CREATE TRIGGER movimientos_tanque_append_only
  BEFORE UPDATE OR DELETE ON public.movimientos_tanque
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_tanque_append_only();

DROP TRIGGER IF EXISTS movimientos_tanque_no_truncate ON public.movimientos_tanque;
CREATE TRIGGER movimientos_tanque_no_truncate
  BEFORE TRUNCATE ON public.movimientos_tanque
  FOR EACH STATEMENT EXECUTE FUNCTION public.movimientos_tanque_append_only();

-- --- Seguridad: tablas solo de servidor (categoria 3 de migration_rls_lockdown) ---
-- La spec pide lectura para cualquier usuario con sesion y escritura para el
-- rol `lab`. Ninguno de esos dos roles existe en Postgres: la sesion del
-- dashboard es un token propio, no un JWT de Supabase Auth, asi que un
-- "authenticated" de RLS no distingue a nadie. Igual que las tablas mona_*,
-- todo pasa por un endpoint con la service key que valida el rol en el
-- servidor (xd-qrn.3). Entonces: RLS activo SIN politicas (deny por omision) y
-- revocados los grants que el schema public le regala a anon y authenticated.
-- Sin el REVOKE, cualquiera con la llave anon leeria y escribiria la bitacora.
ALTER TABLE public.dim_tanque          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_tanque_sinonimo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_tanque  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dim_tanque          FROM anon, authenticated;
REVOKE ALL ON public.dim_tanque_sinonimo FROM anon, authenticated;
REVOKE ALL ON public.movimientos_tanque  FROM anon, authenticated;

-- La secuencia de BIGSERIAL recibe su propio grant por omision (rwU para anon
-- y authenticated); migration_seguimiento_lotes lo dejo abierto. Aqui no.
REVOKE ALL ON SEQUENCE public.movimientos_tanque_id_seq FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.movimientos_tanque_append_only() FROM anon, authenticated;

INSERT INTO public.applied_migrations (name) VALUES ('migration_tanques')
  ON CONFLICT (name) DO NOTHING;

COMMIT;
