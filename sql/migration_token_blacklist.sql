-- Token blacklist for revocation on logout
CREATE TABLE IF NOT EXISTS token_blacklist (
  token_hash TEXT PRIMARY KEY,
  invalidated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cleanup: /api/logout deletes rows older than 3 h (2 h token life plus 1 h
-- clock-skew margin) after each revoke, via api/_lib/blacklistSweep.js. This
-- index serves that invalidated_at range delete.
CREATE INDEX IF NOT EXISTS idx_token_blacklist_time ON token_blacklist (invalidated_at);
