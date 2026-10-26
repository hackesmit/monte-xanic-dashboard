// Housekeeping for token_blacklist: delete revocations whose token has expired.
// The rule (which rows, the 3 h window) lives in Postgres, in
// public.token_blacklist_sweep (sql/migration_token_blacklist_sweep.sql). This
// helper only calls it batch after batch. Each RPC is its own transaction, so a
// backlog shrinks by BATCH_SIZE per call and a failure loses one batch, never
// the batches already committed. Called only by the /api/sweep-blacklist cron,
// never from logout or verify.

// Rows per call. With idx_token_blacklist_time a batch this size takes
// milliseconds, far below any statement timeout.
export const BATCH_SIZE = 1000;

// Calls per run. A run deletes at most BATCH_SIZE * MAX_BATCHES rows; whatever
// is left goes on the next day's run.
export const MAX_BATCHES = 20;

// Deadline for one call, and the wall-clock budget for a whole run. The run
// stops starting batches once the budget is spent, so the function always
// answers inside Vercel's limit.
export const BATCH_TIMEOUT_MS = 3000;
export const RUN_BUDGET_MS = 8000;

/**
 * Sweep expired token_blacklist rows in bounded batches.
 * Never throws. Returns { ok, deleted, batches, done }:
 *   done: a batch came back short, so nothing old enough is left.
 *   ok:   false when a call failed (non-2xx, network error, timeout, bad body);
 *         rows deleted before the failure stay deleted and are counted.
 */
export async function sweepExpiredRevocations(supabaseUrl, serviceKey, {
  fetchImpl = fetch,
  batchSize = BATCH_SIZE,
  maxBatches = MAX_BATCHES,
  batchTimeoutMs = BATCH_TIMEOUT_MS,
  budgetMs = RUN_BUDGET_MS,
  clock = Date.now,
  log = console.error,
} = {}) {
  const started = clock();
  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const remaining = budgetMs - (clock() - started);
    if (remaining <= 0) break;
    let n;
    try {
      const resp = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/token_blacklist_sweep`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ p_limit: batchSize }),
        signal: AbortSignal.timeout(Math.min(batchTimeoutMs, remaining)),
      });
      if (!resp.ok) {
        log('[blacklistSweep] Batch rejected:', resp.status, await resp.text().catch(() => ''));
        return { ok: false, deleted, batches, done: false };
      }
      n = await resp.json();
    } catch (err) {
      log('[blacklistSweep] Batch failed:', err.message);
      return { ok: false, deleted, batches, done: false };
    }
    if (!Number.isInteger(n) || n < 0 || n > batchSize) {
      log('[blacklistSweep] Unexpected batch result:', JSON.stringify(n));
      return { ok: false, deleted, batches, done: false };
    }
    batches += 1;
    deleted += n;
    if (n < batchSize) return { ok: true, deleted, batches, done: true };
  }
  return { ok: true, deleted, batches, done: false };
}
