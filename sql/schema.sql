-- ══════════════════════════════════════════════════════════════════
-- Monte Xanic Dashboard — Supabase Schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New Query)
-- ══════════════════════════════════════════════════════════════════

-- ── wine_samples ──────────────────────────────────────────────────
-- All rows from WineXRay exports (Berries, Must, Aging Wine, etc.)

CREATE TABLE IF NOT EXISTS wine_samples (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sample_id        text UNIQUE NOT NULL,
  vessel_id        text,
  sample_type      text,
  sample_date      date,
  crush_date       date,
  days_post_crush  integer,
  vintage_year     integer,
  variety          text,
  appellation      text,
  tant             numeric,
  fant             numeric,
  bant             numeric,
  ptan             numeric,
  irps             numeric,
  ph               numeric,
  ta               numeric,
  ipt              numeric,
  alcohol          numeric,
  va               numeric,
  malic_acid       numeric,
  rs               numeric,
  l_star           numeric,
  a_star           numeric,
  b_star           numeric,
  color_i          numeric,
  color_t          numeric,
  berry_weight     numeric,
  berry_anthocyanins numeric,
  berry_sugars_mg  numeric,
  below_detection  boolean DEFAULT false,
  notes            text,
  uploaded_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wine_samples_vintage_idx    ON wine_samples (vintage_year);
CREATE INDEX IF NOT EXISTS wine_samples_variety_idx    ON wine_samples (variety);
CREATE INDEX IF NOT EXISTS wine_samples_type_idx       ON wine_samples (sample_type);
CREATE INDEX IF NOT EXISTS wine_samples_appellation_idx ON wine_samples (appellation);

-- ── tank_receptions ───────────────────────────────────────────────
-- From Recepción de Tanque Excel — sheet: Recepción

CREATE TABLE IF NOT EXISTS tank_receptions (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  report_code      text UNIQUE NOT NULL,
  reception_date   date,
  batch_code       text,
  tank_id          text,
  supplier         text,
  variety          text,
  brix             numeric,
  ph               numeric,
  ta               numeric,
  ag               numeric,
  am               numeric,
  av               numeric,
  so2              numeric,
  nfa              numeric,
  temperature      numeric,
  solidos_pct      numeric,
  polifenoles_wx   numeric,
  antocianinas_wx  numeric,
  poli_spica       numeric,
  anto_spica       numeric,
  ipt_spica        numeric,
  acidificado      boolean,
  p010_kg          numeric,
  vintage_year     integer,
  uploaded_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tank_receptions_vintage_idx ON tank_receptions (vintage_year);
CREATE INDEX IF NOT EXISTS tank_receptions_variety_idx ON tank_receptions (variety);

-- ── reception_lots ────────────────────────────────────────────────
-- Up to 4 vineyard lots per tank reception (normalized from Excel)

CREATE TABLE IF NOT EXISTS reception_lots (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reception_id   uuid REFERENCES tank_receptions(id) ON DELETE CASCADE,
  lot_code       text NOT NULL,
  lot_position   integer,
  UNIQUE (reception_id, lot_code)
);

CREATE INDEX IF NOT EXISTS reception_lots_reception_idx ON reception_lots (reception_id);

-- ── prefermentativos ──────────────────────────────────────────────
-- From Recepción de Tanque Excel — sheet: Prefermentativos

CREATE TABLE IF NOT EXISTS prefermentativos (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  report_code      text UNIQUE NOT NULL,
  measurement_date date,
  batch_code       text,
  tank_id          text,
  variety          text,
  brix             numeric,
  ph               numeric,
  ta               numeric,
  temperature      numeric,
  tant             numeric,
  notes            text,
  vintage_year     integer,
  uploaded_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prefermentativos_variety_idx ON prefermentativos (variety);
CREATE INDEX IF NOT EXISTS prefermentativos_vintage_idx ON prefermentativos (vintage_year);

-- ── meteorology ───────────────────────────────────────────────────
-- Auto-populated from Open-Meteo API (Valle de Guadalupe 32.0°N 116.6°W)

CREATE TABLE IF NOT EXISTS meteorology (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date         date UNIQUE NOT NULL,
  temp_max     numeric,
  temp_min     numeric,
  temp_avg     numeric,
  rainfall_mm  numeric,
  humidity_pct numeric,
  uv_index     numeric,
  wind_speed   numeric,
  uploaded_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meteorology_date_idx ON meteorology (date);

-- ══════════════════════════════════════════════════════════════════
-- Row Level Security
-- Dashboard uses the anon key only; RLS controls access.
-- ══════════════════════════════════════════════════════════════════

ALTER TABLE wine_samples      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tank_receptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reception_lots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prefermentativos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE meteorology       ENABLE ROW LEVEL SECURITY;

-- Public read (staff access is enforced at the Vercel password layer)
CREATE POLICY "public_read" ON wine_samples      FOR SELECT USING (true);
CREATE POLICY "public_read" ON tank_receptions   FOR SELECT USING (true);
CREATE POLICY "public_read" ON reception_lots    FOR SELECT USING (true);
CREATE POLICY "public_read" ON prefermentativos  FOR SELECT USING (true);
CREATE POLICY "public_read" ON meteorology       FOR SELECT USING (true);

-- Anon inserts (upload pipeline uses the anon key)
CREATE POLICY "anon_insert" ON wine_samples      FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert" ON tank_receptions   FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert" ON reception_lots    FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert" ON prefermentativos  FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_insert" ON meteorology       FOR INSERT WITH CHECK (true);

-- Anon updates (needed for upsert on conflict)
CREATE POLICY "anon_update" ON wine_samples      FOR UPDATE USING (true);
CREATE POLICY "anon_update" ON tank_receptions   FOR UPDATE USING (true);
CREATE POLICY "anon_update" ON prefermentativos  FOR UPDATE USING (true);
CREATE POLICY "anon_update" ON meteorology       FOR UPDATE USING (true);
