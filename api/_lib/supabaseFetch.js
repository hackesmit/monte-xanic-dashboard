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
  mona: 3000,    // the mona_uso counter RPCs (api/_lib/monaUsage.js), in front of every Mona call
};

// The override is clamped to this. AbortSignal.timeout needs an integer in the
// timer range, and a budget longer than a serverless invocation bounds nothing.
export const MAX_OVERRIDE_MS = 60000;

// SUPABASE_TIMEOUT_MS, when set to a whole number of ms >= 1, replaces every
// budget. A fraction is floored (AbortSignal.timeout(1000.5) throws RangeError,
// which would send every wrapped call down its error path), anything above
// MAX_OVERRIDE_MS is clamped to it, and NaN, 0 or a negative is ignored.
// Read at call time so a test (or an incident) can shorten it without a deploy
// of new code.
export function supabaseTimeoutMs(kind = 'read') {
  const env = Math.floor(Number(process.env.SUPABASE_TIMEOUT_MS));
  if (Number.isFinite(env) && env >= 1) return Math.min(env, MAX_OVERRIDE_MS);
  return BUDGET_MS[kind] ?? BUDGET_MS.read;
}

// A caller's own signal is combined with the budget, never dropped: whichever
// fires first aborts the call (xd-11a; the old spread silently overwrote it).
export function supabaseFetch(url, opts = {}, kind = 'read') {
  const budget = AbortSignal.timeout(supabaseTimeoutMs(kind));
  const signal = opts.signal ? AbortSignal.any([opts.signal, budget]) : budget;
  return fetch(url, { ...opts, signal });
}

export const isTimeout = (err) => err?.name === 'TimeoutError' || err?.name === 'AbortError';

// The outcome of a WRITE comes in three kinds, and only two are definite:
//   confirmed success    a 2xx status arrived (the body may still be lost)
//   confirmed rejection  a 4xx, or a 5xx PostgREST itself answered: the
//                        statement raised and the transaction rolled back
//   indeterminate        no status at all (timeout, reset after the request
//                        left), or a gateway 502/504 that can time out while
//                        Postgres commits
// An indeterminate write is never reported as a failure: a failure invites the
// user to redo a write that may already be in the database.
export const isIndeterminateStatus = (status) => status === 502 || status === 504;

export const INDETERMINADO_STATUS = 503;
export function indeterminado(error) {
  return { indeterminado: true, error };
}
