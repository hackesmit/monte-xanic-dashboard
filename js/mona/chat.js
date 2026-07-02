// js/mona/chat.js — conversation state and client-side agent loop.
// Runs the tool loop in the browser: streams from /api/mona, executes tool_use
// blocks locally via executeTool, resubmits until end_turn. Persists to /api/mona-data.
import { TOOL_DEFS, executeTool } from './tools.js';

const token = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('xanic_session_token') : null);

async function api(action, payload = {}) {
  const res = await fetch('/api/mona-data', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-token': token() },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

export const MonaChat = {
  messages: [],          // Anthropic-format message array
  conversationId: null,
  conversations: [],
  running: false,
  ctx: {},               // tool-effect callbacks + systemExtra (set by UI / knowledge)
  hooks: {},             // UI render callbacks

  reset() { this.messages = []; this.conversationId = null; },

  // ── Conversation lifecycle ──
  async listConversations() {
    try { this.conversations = await api('listConversations'); } catch { this.conversations = []; }
    return this.conversations;
  },

  async ensureConversation() {
    await this.listConversations();
    if (this.conversations.length) {
      await this.loadConversation(this.conversations[0].id);
    } else {
      await this.newConversation();
    }
  },

  async newConversation() {
    this.reset();
    try {
      const conv = await api('createConversation', { title: 'Conversación' });
      if (conv) { this.conversationId = conv.id; this.conversations.unshift(conv); }
    } catch { /* offline: run without persistence */ }
    this.hooks.onConversationChange?.();
  },

  async loadConversation(id) {
    this.conversationId = id;
    this.messages = [];
    try {
      const rows = await api('getMessages', { conversationId: id });
      this.messages = rows.map(r => ({ role: r.role, content: r.content }));
    } catch { /* keep empty */ }
    this.hooks.onConversationChange?.();
    this.hooks.onReplay?.(this.messages);
  },

  async deleteConversation(id) {
    try { await api('deleteConversation', { id }); } catch { /* noop */ }
    this.conversations = this.conversations.filter(c => c.id !== id);
    if (this.conversationId === id) await this.ensureConversation();
    else this.hooks.onConversationChange?.();
  },

  // ── Sending + agent loop ──
  async send(text) {
    if (this.running || !text.trim()) return;
    this.running = true;
    this.messages.push({ role: 'user', content: text });
    this.hooks.onUser?.(text);
    await this._persist('user', text);
    try {
      await this._loop();
    } catch (err) {
      this.hooks.onError?.(String(err && err.message ? err.message : err));
    } finally {
      this.running = false;
      this.hooks.onDone?.();
    }
  },

  async _loop(depth = 0) {
    if (depth > 8) { this.hooks.onError?.('Límite de pasos alcanzado.'); return; }

    const res = await fetch('/api/mona', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-token': token() },
      body: JSON.stringify({ messages: this.messages, tools: TOOL_DEFS, system: this.ctx.systemExtra || '' }),
    });
    if (!res.ok || !res.body) {
      this.hooks.onError?.((await res.json().catch(() => ({}))).error || 'Error de red');
      return;
    }

    this.hooks.onAssistantStart?.();
    const { assistantBlocks, stopReason } = await this._readStream(res.body);
    this.messages.push({ role: 'assistant', content: assistantBlocks });
    await this._persist('assistant', assistantBlocks);

    const toolUses = assistantBlocks.filter(b => b.type === 'tool_use');
    if (stopReason === 'tool_use' && toolUses.length) {
      const results = [];
      for (const tu of toolUses) {
        this.hooks.onToolStart?.(tu.name);
        const out = await executeTool(tu.name, tu.input, this.ctx);
        if (out.display) this.hooks.onDisplay?.(out.display);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: out.content });
      }
      this.messages.push({ role: 'user', content: results });
      await this._persist('user', results);
      await this._loop(depth + 1);
    }
  },

  // Parse Anthropic SSE into content blocks; stream text deltas to the UI.
  async _readStream(body) {
    const reader = body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const blocks = [];
    let stopReason = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const ev of parts) {
        const dataLine = ev.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) continue;
        let data; try { data = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
        if (data.type === 'content_block_start') {
          blocks[data.index] = data.content_block.type === 'tool_use'
            ? { type: 'tool_use', id: data.content_block.id, name: data.content_block.name, input: {}, _partial: '' }
            : { type: 'text', text: '' };
        } else if (data.type === 'content_block_delta') {
          const blk = blocks[data.index];
          if (!blk) continue;
          if (data.delta.type === 'text_delta') { blk.text += data.delta.text; this.hooks.onText?.(data.delta.text); }
          else if (data.delta.type === 'input_json_delta') blk._partial += data.delta.partial_json;
        } else if (data.type === 'content_block_stop') {
          const blk = blocks[data.index];
          if (blk?.type === 'tool_use') {
            try { blk.input = JSON.parse(blk._partial || '{}'); } catch { blk.input = {}; }
            delete blk._partial;
          }
        } else if (data.type === 'message_delta' && data.delta?.stop_reason) {
          stopReason = data.delta.stop_reason;
        } else if (data.type === 'error') {
          this.hooks.onError?.(data.error?.message || 'Error del modelo');
        }
      }
    }
    return { assistantBlocks: blocks.filter(Boolean), stopReason };
  },

  async _persist(role, content) {
    if (!this.conversationId) return;
    try { await api('appendMessage', { conversationId: this.conversationId, role, content }); }
    catch { /* non-blocking */ }
  },
};
