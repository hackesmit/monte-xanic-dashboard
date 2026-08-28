// Simple in-memory rate limiter for authenticated endpoints.
// Resets on cold start (acceptable for Vercel serverless).

const buckets = new Map();
let _insertCount = 0;

const DEFAULTS = {
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 60             // per window
};

// Client IP for rate limiting. Trust only platform-set values: Vercel sets
// x-real-ip, and appends the true client IP as the RIGHT-most entry of
// x-forwarded-for. The left-most entry is attacker-supplied — keying on it
// would give a fresh bucket per spoofed header, nullifying the limiter.
export function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (real) return real;
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const parts = String(fwd).split(',');
    return parts[parts.length - 1].trim() || 'unknown';
  }
  return 'unknown';
}

export function rateLimit(req, res, opts = {}) {
  const { windowMs, maxRequests } = { ...DEFAULTS, ...opts };
  const ip = clientIp(req);
  const key = `${req.url}:${ip}`;
  const now = Date.now();

  // Sweep stale entries every 100 inserts
  _insertCount++;
  if (_insertCount >= 100) {
    _insertCount = 0;
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
