import crypto from 'crypto';

// Reusable token verification (same logic as verify.js)
function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Allowed tables and their conflict columns for upsert
const ALLOWED_TABLES = {
  wine_samples:      { conflict: 'sample_id,sample_date', maxRows: 500 },
  tank_receptions:   { conflict: 'report_code',           maxRows: 200 },
  reception_lots:    { conflict: null,                     maxRows: 2000 },
  prefermentativos:  { conflict: 'report_code,measurement_date', maxRows: 200 }
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // 1. Validate auth token
  const token = req.headers['x-session-token'];
  const secret = process.env.SESSION_SECRET;
  const payload = verifyToken(token, secret);

  if (!payload) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  // 2. Check role — only lab and admin can upload
  const role = payload.role || 'viewer';
  if (role !== 'lab' && role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Sin permisos para subir datos' });
  }

  // 3. Validate request body
  const { table, rows, conflict } = req.body || {};

  if (!table || !ALLOWED_TABLES[table]) {
    return res.status(400).json({ ok: false, error: 'Tabla no válida' });
  }

  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ ok: false, error: 'Sin datos para insertar' });
  }

  const tableConfig = ALLOWED_TABLES[table];
  if (rows.length > tableConfig.maxRows) {
    return res.status(400).json({ ok: false, error: `Máximo ${tableConfig.maxRows} filas por solicitud` });
  }

  // 4. Insert via Supabase service key (server-side only)
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  try {
    const conflictCol = conflict || tableConfig.conflict;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': supabaseServiceKey,
      'Authorization': `Bearer ${supabaseServiceKey}`,
      'Prefer': conflictCol ? `resolution=merge-duplicates` : 'return=minimal'
    };

    // Supabase REST API upsert
    let url = `${supabaseUrl}/rest/v1/${table}`;
    if (conflictCol) {
      url += `?on_conflict=${encodeURIComponent(conflictCol)}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(rows)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[upload] Supabase error for ${table}:`, errText);
      return res.status(500).json({ ok: false, error: 'Error al insertar datos' });
    }

    return res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    console.error('[upload] Server error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}
