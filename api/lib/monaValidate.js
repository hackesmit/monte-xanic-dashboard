// api/lib/monaValidate.js — pure validation for the Mona proxy (no I/O)
export const MAX_BODY_BYTES = 150_000;
export const MAX_MESSAGES = 40;
export const MAX_MSG_BYTES = 40_000;

const ROLES = new Set(['user', 'assistant']);

export function validateChatRequest(body) {
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, error: 'messages requerido' };
  }
  if (body.messages.length > MAX_MESSAGES) {
    return { ok: false, error: 'demasiados mensajes' };
  }
  let total = 0;
  for (const m of body.messages) {
    if (!m || !ROLES.has(m.role) || m.content == null) {
      return { ok: false, error: 'mensaje inválido' };
    }
    const size = Buffer.byteLength(JSON.stringify(m.content));
    if (size > MAX_MSG_BYTES) return { ok: false, error: 'mensaje demasiado grande' };
    total += size;
  }
  if (total > MAX_BODY_BYTES) return { ok: false, error: 'solicitud demasiado grande' };
  return { ok: true, messages: body.messages };
}
