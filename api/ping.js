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

  // DB ping arrives in Task 3. For now, acknowledge so the auth layer is
  // independently testable on a preview deploy.
  return res.status(200).json({ ok: true, pinged_at: new Date().toISOString(), latency_ms: 0 });
}
