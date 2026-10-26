-- Token blacklist for revocation on logout
CREATE TABLE IF NOT EXISTS token_blacklist (
  token_hash TEXT PRIMARY KEY,
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cleanup: the daily /api/sweep-blacklist cron deletes rows older than 3 h
-- in bounded batches via public.token_blacklist_sweep
-- (migration_token_blacklist_sweep). This index serves that delete.
CREATE INDEX IF NOT EXISTS idx_token_blacklist_time ON token_blacklist (invalidated_at);
