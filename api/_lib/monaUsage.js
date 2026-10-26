// api/_lib/monaUsage.js — the shared daily spend ceiling for /api/mona (xd-aiz).
// The counter lives in public.mona_uso (sql/migration_mona_uso.sql and
// migration_mona_uso_reserva.sql), so every Vercel instance sees the same count: a per-instance Map could not enforce a
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

// Reserve one request and `tokens` of budget (the request's worst case) for
// `username` today, under reservation `id`. Fails CLOSED: if the counter cannot
// answer, the request is refused (ok: false, status 503), because "could not
// count" must not mean "free". Returns { ok: true } or { ok: false, status, error }.
export async function reserveBudget(id, username, tokens) {
  const { maxPeticiones, maxTokens } = usageCaps();
  let r;
  try {
    r = await rpc('mona_uso_reservar', {
      p_id: id, p_username: username, p_tokens: tokens,
      p_max_peticiones: maxPeticiones, p_max_tokens: maxTokens,
    });
  } catch (err) {
    console.error('[mona] usage reservation failed, refusing:', err.message);
    return { ok: false, status: 503, error: 'No se pudo verificar el uso de Mona. Intenta más tarde.' };
  }
  if (!r || typeof r.permitido !== 'boolean') {
    console.error('[mona] usage reservation returned an unexpected shape, refusing');
    return { ok: false, status: 503, error: 'No se pudo verificar el uso de Mona. Intenta más tarde.' };
  }
  if (!r.permitido) {
    return { ok: false, status: 429, error: 'Límite diario de Mona alcanzado. Vuelve mañana.' };
  }
  return { ok: true };
}

// Close reservation `id`: charge `tokens` and release what it held. The RPC is
// idempotent per id, so it is retried on any failure. If every attempt fails
// the reservation stays held in the database, which charges the user the full
// worst case for that day: a lost write over-charges, it never goes free.
// Never throws (the request is already served). Returns true once confirmed.
export const SETTLE_RETRY_MS = [0, 250, 1000];
export async function settleReservation(id, tokens, retryMs = SETTLE_RETRY_MS) {
  for (const wait of retryMs) {
    if (wait) await new Promise(r => setTimeout(r, wait));
    try {
      const r = await rpc('mona_uso_reconciliar', { p_id: id, p_tokens: Math.max(0, Math.round(tokens) || 0) });
      if (r && r.reconciliado === true) return true;
      console.error('[mona] reconciliation returned an unexpected shape');
    } catch (err) {
      console.error('[mona] reconciliation failed:', err.message);
    }
  }
  console.error(`[mona] reservation ${id} left held: charged its full estimate for the day`);
  return false;
}

// Upper bound on the input tokens of one request, from its JSON body. Every
// content block the validator admits is text (tool_result content included),
// and a text token is at least one byte, so the UTF-8 length of the body bounds
// the prompt; the margin covers what Anthropic adds around tools.
export const INPUT_MARGIN_TOKENS = 2000;
export function estimateInputTokens(payload) {
  return Buffer.byteLength(payload) + INPUT_MARGIN_TOKENS;
}

// Pure: reads the Anthropic SSE stream as it passes through and keeps the usage
// it reports. message_start carries the input side (plus cache tokens);
// message_delta carries the running output_tokens total. Events may be split
// across chunks, so partial lines are buffered.
export function createUsageMeter() {
  let buf = '';
  let input = 0;
  let output = 0;
  let sawStart = false;
  let stopped = false;
  const take = (line) => {
    if (!line.startsWith('data:')) return;
    let d;
    try { d = JSON.parse(line.slice(5).trim()); } catch { return; }
    if (d?.type === 'message_start') sawStart = true;
    if (d?.type === 'message_stop') stopped = true;
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
    // What to charge for this stream. A stream that reached message_stop is
    // charged what Anthropic reported. One that did not (client gone, upstream
    // cut) has no final output count, so it is charged the most it could have
    // generated, and the estimate for its input if message_start never came.
    charge(inputEstimate, maxOutput) {
      if (stopped) return input + output;
      return (sawStart ? input : inputEstimate) + Math.max(output, maxOutput);
    },
  };
}
