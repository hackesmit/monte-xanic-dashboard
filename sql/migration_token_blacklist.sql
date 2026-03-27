-- Token blacklist for revocation on logout
CREATE TABLE IF NOT EXISTS token_blacklist (
  token_hash TEXT PRIMARY KEY,
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup: tokens older than 2h are already expired, no need to keep
CREATE INDEX IF NOT EXISTS idx_token_blacklist_time ON token_blacklist (invalidated_at);
