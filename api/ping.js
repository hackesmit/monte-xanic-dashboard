// GET /api/ping
//
// Daily keep-alive ping for Supabase. Vercel cron (declared in vercel.json)
// invokes this endpoint once per day. The handler runs a single lightweight
// read against public.applied_migrations so Supabase sees real DB activity
// and does not pause the free-tier project after 7 idle days.
//
// Auth: Vercel injects `Authorization: Bearer <CRON_SECRET>` on cron-triggered
// requests when the CRON_SECRET env var is set. Any other caller (including
// unauthenticated external traffic) is rejected with 401 before any DB work.
//
// Response shape on success:
//   200 { ok: true, pinged_at: '<iso>', latency_ms: <int> }
// On Supabase failure:
//   500 { ok: false, error: '<message>' }

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
    console.error('[ping] missing SUPABASE_URL or SUPABASE_SERVICE_KEY env var');
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  const pingedAt = new Date().toISOString();
  const startedAt = Date.now();
  try {
    const url = `${supabaseUrl}/rest/v1/applied_migrations?select=name&limit=1`;
    const resp = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[ping] Supabase error:', resp.status, errText);
      return res.status(500).json({ ok: false, error: 'No se pudo consultar Supabase' });
    }

    await resp.text();
    const latency_ms = Date.now() - startedAt;
    console.log(`[ping] ok latency_ms=${latency_ms}`);
    return res.status(200).json({
      ok: true,
      pinged_at: pingedAt,
      latency_ms,
    });
  } catch (err) {
    console.error('[ping] Server error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}
