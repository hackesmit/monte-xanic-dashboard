// api/_lib/monaUsage.js — the shared daily spend ceiling for /api/mona (xd-aiz).
// The counter lives in public.mona_uso (sql/migration_mona_uso.sql), so every
// Vercel instance sees the same count: a per-instance Map could not enforce a
// ceiling. Keyed by the verified username, not the session, so logging in again
// does not reset it. The provider-side backstop is the workspace spend limit in
// the Anthropic console; this file is the per-user limit in front of it.

const DEFAULT_MAX_PETICIONES = 300;      // per user per day; one question can take up to 9 (chat.js depth cap)
const DEFAULT_MAX_TOKENS = 3_000_000;    // per user per day, input + output as Anthropic reports them
const CAP_LIMIT = 1_000_000_000;         // an env typo like 1e300 must not become "no limit"
const RPC_TIMEOUT_MS = 3000;

function capFromEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? Math.min(n, CAP_LIMIT) : fallback;
}

export function usageCaps() {
  return {
    maxPeticiones: capFromEnv('MONA_MAX_PETICIONES_DIA', DEFAULT_MAX_PETICIONES),
    maxTokens: capFromEnv('MONA_MAX_TOKENS_DIA', DEFAULT_MAX_TOKENS),
  };
}

async function rpc(fn, args) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  const resp = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

// Reserve one request for `username` today. Fails CLOSED: if the counter cannot
// answer, the request is refused (ok: false, status 503), because "could not
// count" must not mean "free". Returns { ok: true, dia } or { ok: false, status, error }.
export async function reserveRequest(username) {
  const { maxPeticiones, maxTokens } = usageCaps();
  let r;
  try {
    r = await rpc('mona_uso_reservar', {
      p_username: username, p_max_peticiones: maxPeticiones, p_max_tokens: maxTokens,
    });
  } catch (err) {
    console.error('[mona] usage reservation failed, refusing:', err.message);
    return { ok: false, status: 503, error: 'No se pudo verificar el uso de Mona. Intenta más tarde.' };
  }
  if (!r || typeof r.permitido !== 'boolean' || typeof r.dia !== 'string') {
    console.error('[mona] usage reservation returned an unexpected shape, refusing');
    return { ok: false, status: 503, error: 'No se pudo verificar el uso de Mona. Intenta más tarde.' };
  }
  if (!r.permitido) {
    return { ok: false, status: 429, error: 'Límite diario de Mona alcanzado. Vuelve mañana.' };
  }
  return { ok: true, dia: r.dia };
}

// Charge the tokens one stream used to the day it was admitted on. Best effort:
// the request is already served, so a failure is logged, never thrown.
export async function recordTokens(username, dia, tokens) {
  if (!(tokens > 0)) return;
  try {
    await rpc('mona_uso_sumar_tokens', { p_username: username, p_dia: dia, p_tokens: Math.round(tokens) });
  } catch (err) {
    console.error('[mona] could not record token usage:', err.message);
  }
}

// Pure: reads the Anthropic SSE stream as it passes through and keeps the usage
// it reports. message_start carries the input side (plus cache tokens);
// message_delta carries the running output_tokens total. Events may be split
// across chunks, so partial lines are buffered.
export function createUsageMeter() {
  let buf = '';
  let input = 0;
  let output = 0;
  const take = (line) => {
    if (!line.startsWith('data:')) return;
    let d;
    try { d = JSON.parse(line.slice(5).trim()); } catch { return; }
    const u = d?.type === 'message_start' ? d.message?.usage : d?.type === 'message_delta' ? d.usage : null;
    if (!u) return;
    const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
    const inp = n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens);
    if (inp > input) input = inp;
    if (n(u.output_tokens) > output) output = n(u.output_tokens);
  };
  return {
    push(text) {
      buf += text;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) take(l.replace(/\r$/, ''));
    },
    total() { return input + output; },
  };
}
