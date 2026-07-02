// api/mona-data.js — token-gated persistence for Mona (service-key Supabase REST).
// All mona_* tables are server-only (RLS on, no anon policies), so every read/write
// goes through here. Username/role come from the verified token, never the body.
import { verifyToken } from './lib/verifyToken.js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const H = () => ({ 'content-type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` });

async function sb(path, opts = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { ...opts, headers: { ...H(), ...(opts.headers || {}) } });
  const text = await res.text();
  return { ok: res.ok, status: res.status, json: text ? JSON.parse(text) : null };
}

const enc = encodeURIComponent;
const isStaff = (role) => role === 'lab' || role === 'admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método no permitido' }); return; }
  const result = await verifyToken(req.headers['x-session-token']);
  if (result.error) { res.status(result.status).json({ error: 'No autorizado' }); return; }
  if (!URL || !KEY) { res.status(500).json({ error: 'Persistencia no configurada' }); return; }

  const user = result.payload.user;
  const role = result.payload.role || 'viewer';
  const b = req.body || {};
  const { action } = b;

  const ownsConversation = async (id) => {
    const own = await sb(`mona_conversations?id=eq.${enc(id)}&username=eq.${enc(user)}&select=id`);
    return !!own.json?.length;
  };
  const ownsView = async (id) => {
    const own = await sb(`mona_saved_views?id=eq.${enc(id)}&username=eq.${enc(user)}&select=id`);
    return !!own.json?.length;
  };

  try {
    switch (action) {
      // ── Conversations ──
      case 'listConversations': {
        const r = await sb(`mona_conversations?username=eq.${enc(user)}&order=updated_at.desc`);
        return res.status(200).json(r.json || []);
      }
      case 'createConversation': {
        const title = String(b.title || 'Conversación').slice(0, 120);
        const r = await sb('mona_conversations', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ username: user, title }),
        });
        return res.status(200).json(r.json?.[0] || null);
      }
      case 'renameConversation': {
        if (!(await ownsConversation(b.id))) return res.status(404).json({ error: 'No encontrada' });
        await sb(`mona_conversations?id=eq.${enc(b.id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: String(b.title || '').slice(0, 120), updated_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true });
      }
      case 'deleteConversation': {
        if (!(await ownsConversation(b.id))) return res.status(404).json({ error: 'No encontrada' });
        await sb(`mona_conversations?id=eq.${enc(b.id)}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }
      case 'getMessages': {
        if (!(await ownsConversation(b.conversationId))) return res.status(404).json({ error: 'No encontrada' });
        const r = await sb(`mona_messages?conversation_id=eq.${enc(b.conversationId)}&order=created_at.asc`);
        return res.status(200).json(r.json || []);
      }
      case 'appendMessage': {
        if (!(await ownsConversation(b.conversationId))) return res.status(404).json({ error: 'No encontrada' });
        await sb('mona_messages', {
          method: 'POST',
          body: JSON.stringify({ conversation_id: b.conversationId, role: b.role, content: b.content }),
        });
        await sb(`mona_conversations?id=eq.${enc(b.conversationId)}`, {
          method: 'PATCH', body: JSON.stringify({ updated_at: new Date().toISOString() }),
        });
        return res.status(200).json({ ok: true });
      }

      // ── Saved views ──
      case 'listSavedViews': {
        const r = await sb(`mona_saved_views?username=eq.${enc(user)}&order=created_at.desc`);
        return res.status(200).json(r.json || []);
      }
      case 'saveView': {
        const row = {
          username: user,
          title: String(b.title || 'Vista').slice(0, 120),
          view_type: b.view_type === 'table' ? 'table' : 'chart',
          spec: b.spec || {},
        };
        const r = await sb('mona_saved_views', {
          method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row),
        });
        return res.status(200).json(r.json?.[0] || null);
      }
      case 'renameView': {
        if (!(await ownsView(b.id))) return res.status(404).json({ error: 'No encontrada' });
        await sb(`mona_saved_views?id=eq.${enc(b.id)}`, {
          method: 'PATCH', body: JSON.stringify({ title: String(b.title || '').slice(0, 120) }),
        });
        return res.status(200).json({ ok: true });
      }
      case 'deleteView': {
        if (!(await ownsView(b.id))) return res.status(404).json({ error: 'No encontrada' });
        await sb(`mona_saved_views?id=eq.${enc(b.id)}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      // ── Knowledge base ──
      case 'listKnowledge': {
        const r = await sb('mona_knowledge?order=created_at.desc');
        return res.status(200).json(r.json || []);
      }
      case 'proposeFact': {
        const fact = String(b.fact || '').slice(0, 1000);
        if (!fact) return res.status(400).json({ error: 'Hecho vacío' });
        await sb('mona_knowledge', {
          method: 'POST',
          body: JSON.stringify({ fact, status: 'pending', proposed_by: user }),
        });
        return res.status(200).json({ ok: true });
      }
      case 'addFact': {
        if (!isStaff(role)) return res.status(403).json({ error: 'Sin permisos' });
        const fact = String(b.fact || '').slice(0, 1000);
        if (!fact) return res.status(400).json({ error: 'Hecho vacío' });
        await sb('mona_knowledge', {
          method: 'POST',
          body: JSON.stringify({ fact, status: 'approved', proposed_by: user, approved_by: user }),
        });
        return res.status(200).json({ ok: true });
      }
      case 'approveFact': {
        if (!isStaff(role)) return res.status(403).json({ error: 'Sin permisos' });
        await sb(`mona_knowledge?id=eq.${enc(b.id)}`, {
          method: 'PATCH', body: JSON.stringify({ status: 'approved', approved_by: user }),
        });
        return res.status(200).json({ ok: true });
      }
      case 'deleteFact': {
        if (!isStaff(role)) return res.status(403).json({ error: 'Sin permisos' });
        await sb(`mona_knowledge?id=eq.${enc(b.id)}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: 'Acción desconocida', action });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Error de persistencia', detail: String(err).slice(0, 300) });
  }
}
