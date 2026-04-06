// Simple in-memory rate limiter for authenticated endpoints.
// Resets on cold start (acceptable for Vercel serverless).

const buckets = new Map();

const DEFAULTS = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 60             // per window
};

export function rateLimit(req, res, opts = {}) {
  const { windowMs, maxRequests } = { ...DEFAULTS, ...opts };
  const fwd = req.headers['x-forwarded-for'];
  const ip = req.headers['x-real-ip'] || (fwd ? fwd.split(',')[0].trim() : null) || 'unknown';
  const key = `${req.url}:${ip}`;
  const now = Date.now();

  // Sweep stale entries periodically
  if (buckets.size > 500) {
    for (const [k, v] of buckets) {
      if (now - v.start > windowMs) buckets.delete(k);
    }
  }

  const record = buckets.get(key);
  if (!record || now - record.start > windowMs) {
    buckets.set(key, { start: now, count: 1 });
    return true;
  }

  record.count++;
  if (record.count > maxRequests) {
    res.status(429).json({ error: 'Demasiadas solicitudes. Intente de nuevo más tarde.' });
    return false;
  }
  return true;
}
