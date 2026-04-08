-- Mediciones Tecnicas: physical berry field measurements
CREATE TABLE IF NOT EXISTS mediciones_tecnicas (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  medicion_code   TEXT NOT NULL UNIQUE,
  medicion_date   DATE NOT NULL,
  vintage_year    INT NOT NULL,
  variety         TEXT NOT NULL,
  appellation     TEXT NOT NULL,
  lot_code        TEXT,
  tons_received   NUMERIC(8,2),
  berry_count_sample INT,
  berry_avg_weight_g NUMERIC(6,2),
  berry_diameter_mm  NUMERIC(5,2),
  health_grade    TEXT CHECK (health_grade IN ('Excelente','Bueno','Regular','Malo')),
  health_madura   INT DEFAULT 0,
  health_inmadura INT DEFAULT 0,
  health_sobremadura INT DEFAULT 0,
  health_picadura INT DEFAULT 0,
  health_enfermedad INT DEFAULT 0,
  health_quemadura INT DEFAULT 0,
  measured_by     TEXT,
  notes           TEXT,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mediciones_variety ON mediciones_tecnicas(variety);
CREATE INDEX IF NOT EXISTS idx_mediciones_date ON mediciones_tecnicas(medicion_date);
CREATE INDEX IF NOT EXISTS idx_mediciones_vintage ON mediciones_tecnicas(vintage_year);
