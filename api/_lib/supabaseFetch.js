// api/_lib/supabaseFetch.js — the one place that bounds a server-side Supabase call.
//
// A Supabase that accepts the connection and never finishes the response used
// to hang the invocation until Vercel killed it: the caller got a platform
// timeout instead of the handler's own Spanish failure, and the login limiter
// never reached its in-memory fallback. Every server-side Supabase fetch goes
// through supabaseFetch, which attaches AbortSignal.timeout. The signal stays
// armed through the BODY read too (res.json()/res.text() reject when it
// fires), so headers that arrive promptly followed by a stalled body are
// bounded as well.
//
// When the budget runs out, fetch or the body read rejects with a
// DOMException named 'TimeoutError'. Each caller already routes a rejected
// fetch to its failure path; isTimeout() lets one name the cause.

const BUDGET_MS = {
  read: 8000,    // reads and single-row writes
  batch: 20000,  // /api/upload batches of up to a table's maxRows rows
  rpc: 8000,     // tanques_escribir; past this the write is reported as indeterminate
};

// SUPABASE_TIMEOUT_MS, when set to a positive number, replaces every budget.
// Read at call time so a test (or an incident) can shorten it without a deploy
// of new code.
export function supabaseTimeoutMs(kind = 'read') {
  const env = Number(process.env.SUPABASE_TIMEOUT_MS);
  if (Number.isFinite(env) && env > 0) return env;
  return BUDGET_MS[kind] ?? BUDGET_MS.read;
}

export function supabaseFetch(url, opts = {}, kind = 'read') {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(supabaseTimeoutMs(kind)) });
}

export const isTimeout = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';
