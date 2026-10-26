// GET /api/sweep-blacklist
//
// Daily token_blacklist housekeeping. Vercel cron (declared in vercel.json)
// invokes this once a day. It deletes revocations whose token has expired, in
// bounded batches (api/_lib/blacklistSweep.js, which calls
// public.token_blacklist_sweep). It is off the auth path on purpose: logout and
// verify never wait on it, and a failed run changes no auth decision; the rows
// simply wait for the next run.
//
// Auth: same as /api/ping. Vercel injects `Authorization: Bearer <CRON_SECRET>`
// on cron-triggered requests; any other caller gets 401 before any DB work.
//
// Response:
//   200 { ok: true, deleted, batches, done }   done=false: backlog left for tomorrow
//   500 { ok: false, deleted, batches, error } a batch failed; earlier batches stay deleted

import { sweepExpiredRevocations } from './_lib/blacklistSweep.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'];
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('[sweep-blacklist] missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var');
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  const { ok, deleted, batches, done } = await sweepExpiredRevocations(supabaseUrl, serviceKey);
  if (!ok) {
    console.error(`[sweep-blacklist] failed after deleted=${deleted} batches=${batches}`);
    return res.status(500).json({
      ok: false, deleted, batches, error: 'No se pudo limpiar la lista de sesiones revocadas',
    });
  }
  if (!done) console.warn(`[sweep-blacklist] backlog left for the next run, deleted=${deleted}`);
  console.log(`[sweep-blacklist] ok deleted=${deleted} batches=${batches} done=${done}`);
  return res.status(200).json({ ok: true, deleted, batches, done });
}
