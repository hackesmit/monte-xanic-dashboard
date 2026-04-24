#!/usr/bin/env node
// scripts/import-mostos-2024.js
// ONE-TIME import of MOSTOS PHENOLICS 24-25 (1).xlsx → tank_receptions.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//   node scripts/import-mostos-2024.js "Xanic info/MOSTOS PHENOLICS 24-25 (1).xlsx"
//
// Reads the 'PHENOLICS 2024' sheet only. Other sheets (BERRIES, pivots,
// per-variety) are ignored.
//
// Each row is mapped to a partial tank_receptions row and upserted on
// report_code. The report_code is synthesized as:
//   MOSTOS-<tank_id>-<YYYY-MM-DD>
// so re-runs are idempotent.

import * as XLSX from 'xlsx';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const filePath = process.argv[2];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY env vars required.');
  process.exit(1);
}
if (!filePath) {
  console.error('ERROR: path to MOSTOS PHENOLICS xlsx required as arg.');
  process.exit(1);
}

const wb = XLSX.readFile(filePath);
if (!wb.SheetNames.includes('PHENOLICS 2024')) {
  console.error('ERROR: expected sheet "PHENOLICS 2024" not found.');
  process.exit(1);
}

const rows = XLSX.utils.sheet_to_json(wb.Sheets['PHENOLICS 2024'], { defval: null, raw: false });
console.log(`Loaded ${rows.length} rows from PHENOLICS 2024`);

function toISODate(excelDate) {
  if (!excelDate) return null;
  if (typeof excelDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(excelDate)) return excelDate.slice(0, 10);
  if (typeof excelDate === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + excelDate * 86400000);
    return d.toISOString().slice(0, 10);
  }
  try { return new Date(excelDate).toISOString().slice(0, 10); } catch { return null; }
}

const payload = [];
for (const r of rows) {
  const tankId = String(r['TANQUE'] ?? '').trim();
  const date = toISODate(r['FECHA']);
  if (!tankId || !date) continue;

  payload.push({
    report_code:     `MOSTOS-${tankId}-${date}`,
    reception_date:  date,
    tank_id:         tankId,
    batch_code:      r['LOTE'] ?? null,
    supplier:        r['PROVEEDOR'] ?? null,
    variety:         r['VARIEDAD'] ?? null,
    polifenoles_wx:  r['PHENOLICS'] ?? null,
    antocianinas_wx: r['ANTHOCYANINS'] ?? null,
    vintage_year:    2024,
  });
}

console.log(`Mapped ${payload.length} rows for upsert`);

const BATCH = 500;
let total = 0;
for (let i = 0; i < payload.length; i += BATCH) {
  const chunk = payload.slice(i, i + BATCH);
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/tank_receptions?on_conflict=report_code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(chunk),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    console.error(`Batch ${i}: FAIL ${resp.status} — ${txt}`);
    process.exit(1);
  }
  total += chunk.length;
  console.log(`Upserted ${total}/${payload.length}`);
}

console.log(`Done. ${total} rows upserted into tank_receptions.`);
