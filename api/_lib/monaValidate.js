// api/_lib/monaValidate.js — pure validation for the Mona proxy (no I/O)
export const MAX_BODY_BYTES = 150_000;
export const MAX_MESSAGES = 40;
export const MAX_MSG_BYTES = 40_000;

const ROLES = new Set(['user', 'assistant']);
// The only content blocks the Mona client ever sends (js/mona/chat.js).
const BLOCK_TYPES = new Set(['text', 'tool_use', 'tool_result']);

function contentOk(content) {
  if (typeof content === 'string') return true;
  return Array.isArray(content) && content.every(b => b && typeof b === 'object' && BLOCK_TYPES.has(b.type));
}

// The server owns the system prompt and the tool list (xd-aiz). A request that
// carries either is refused, whatever its shape: a client-supplied system could
// argue against the Guardarraíles block, and client-supplied tools would turn
// the endpoint into a general Claude proxy on the winery's key.
const SERVER_OWNED = ['system', 'tools', 'tool_choice', 'model', 'max_tokens'];

export function validateChatRequest(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, error: 'messages requerido' };
  }
  for (const k of SERVER_OWNED) {
    if (Object.hasOwn(body, k)) {
      return { ok: false, error: `${k} lo fija el servidor; recarga la página` };
    }
  }
  if (body.messages.length > MAX_MESSAGES) {
    return { ok: false, error: 'demasiados mensajes' };
  }
  let total = 0;
  for (const m of body.messages) {
    if (!m || !ROLES.has(m.role) || !contentOk(m.content)) {
      return { ok: false, error: 'mensaje inválido' };
    }
    const size = Buffer.byteLength(JSON.stringify(m.content));
    if (size > MAX_MSG_BYTES) return { ok: false, error: 'mensaje demasiado grande' };
    total += size;
  }
  if (total > MAX_BODY_BYTES) return { ok: false, error: 'solicitud demasiado grande' };
  return { ok: true, messages: body.messages };
}
