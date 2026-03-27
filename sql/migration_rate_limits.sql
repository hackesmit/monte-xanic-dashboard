-- Rate limiting table for login attempts
-- Persists across serverless instances (replaces in-memory Map)
CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT PRIMARY KEY,
  attempts INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup stale entries (older than 15 minutes)
-- Run periodically or rely on the login handler's sweep
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits (window_start);
