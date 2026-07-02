// api/mona.js — stateless proxy to the Claude Messages API (SSE passthrough).
// Session-token gated, rate-limited, server-side system prompt + API key.
import { verifyToken } from './lib/verifyToken.js';
import { clientIp } from './lib/rateLimit.js';
import { validateChatRequest } from './lib/monaValidate.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX = 20;
const buckets = new Map(); // key → { count, windowStart } (best-effort per-instance)

const BASE_SYSTEM = `Eres Mona, la analista de vinos de Monte Xanic. Respondes SIEMPRE en español,
con tono cálido y profesional, y dominas la enología. Usas exclusivamente unidades métricas
(°C, g/L, mg/L, ppm, °Bx). Cuando el usuario pide una comparación, tendencia o distribución,
usa las herramientas de datos (query_data, aggregate_data, compute_kpis) y luego render_chart o
render_table en lugar de describir números en prosa. Propón hechos al conocimiento (propose_fact)
solo cuando el usuario confirme una observación duradera sobre la bodega. No inventes datos: si una
herramienta no devuelve filas, dilo con claridad.`;

function rateLimited(key) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart > RL_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  b.count += 1;
  return b.count > RL_MAX;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }

  const token = req.headers['x-session-token'];
  const result = await verifyToken(token);
  if (result.error) { res.status(result.status).json({ error: 'No autorizado' }); return; }
  const user = result.payload.user || clientIp(req);

  if (rateLimited(user)) {
    res.status(429).json({ error: 'Demasiados mensajes. Espera unos minutos.' });
    return;
  }

  const check = validateChatRequest(req.body);
  if (!check.ok) { res.status(400).json({ error: check.error }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'Mona no está configurada (falta API key)' }); return; }

  const system = [{ type: 'text', text: BASE_SYSTEM }];
  if (typeof req.body.system === 'string' && req.body.system.length > 0 && req.body.system.length < 20_000) {
    system.push({ type: 'text', text: req.body.system });
  }

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        system,
        tools: Array.isArray(req.body.tools) ? req.body.tools : undefined,
        messages: check.messages,
      }),
    });
  } catch (err) {
    res.status(502).json({ error: 'No se pudo contactar a Mona', detail: String(err).slice(0, 300) });
    return;
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    res.status(502).json({ error: 'Error al contactar a Mona', detail: detail.slice(0, 500) });
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err) })}\n\n`);
  } finally {
    res.end();
  }
}
