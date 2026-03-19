// One-time migration: seed legacy JSON data into Supabase
// Usage: node seed_supabase.js

const fs = require('fs');
const https = require('https');

const SUPABASE_URL = 'https://bkcaezwonznazgedugap.supabase.co';
// Read .env.local, handle BOM / UTF-16
const envRaw = fs.readFileSync('.env.local', 'utf8').replace(/\uFEFF/g, '').replace(/\0/g, '');
const envLine = envRaw.split(/\r?\n/).find(l => l.includes('SUPABASE_ANON_KEY'));
const SUPABASE_KEY = envLine ? envLine.split('=').slice(1).join('=').trim() : '';
if (!SUPABASE_KEY) { console.error('Could not read SUPABASE_ANON_KEY from .env.local'); process.exit(1); }

function post(table, rows, conflictCol) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(rows);
    const url = new URL(`/rest/v1/${table}`, SUPABASE_URL);
    if (conflictCol) url.searchParams.set('on_conflict', conflictCol);
    const opts = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(rows.length);
        else reject(new Error(`${table}: ${res.statusCode} ${data}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Map berry JSON keys → Supabase columns (reverse of supabaseToBerryJS)
function berryToSupabase(row) {
  return {
    sample_id:       row.sampleId,
    sample_type:     row.sampleType || 'Berries',
    sample_date:     parseDate(row.sampleDate),
    crush_date:      parseDate(row.crushDate),
    days_post_crush: row.daysPostCrush,
    vintage_year:    row.vintage,
    variety:         row.variety,
    appellation:     row.appellation,
    tant:            row.tANT,
    ph:              row.pH,
    ta:              row.ta,
    brix:            row.brix,
    berry_weight:    row.berryFW,
    l_star:          row.colorL,
    a_star:          row.colorA,
    b_star:          row.colorB,
    color_i:         row.colorI,
    color_t:         row.colorT,
    notes:           row.notes,
    vessel_id:       row.tanque || null
  };
}

// Map wine JSON keys → Supabase columns (reverse of supabaseToWineJS)
function wineToSupabase(row) {
  return {
    sample_id:       row.codigoBodega,
    sample_type:     row.sampleType || 'Aging Wine',
    sample_date:     parseDate(row.fecha),
    crush_date:      parseDate(row.crushDate),
    days_post_crush: row.daysPostCrush,
    vintage_year:    row.vintage,
    variety:         row.variedad,
    appellation:     row.proveedor,
    vessel_id:       row.tanque,
    tant:            row.antoWX,
    fant:            row.freeANT,
    bant:            row.boundANT,
    ptan:            row.pTAN,
    irps:            row.iRPs,
    ipt:             row.iptSpica,
    ph:              row.pH,
    ta:              row.at,
    brix:            row.brix,
    l_star:          row.colorL,
    a_star:          row.colorA,
    b_star:          row.colorB,
    color_i:         row.colorI,
    color_t:         row.colorT,
    notes:           row.notes
  };
}

// Map preferment JSON keys → Supabase prefermentativos columns
function prefToSupabase(row) {
  return {
    report_code:      row.codigoBodega || row.reportCode,
    measurement_date: parseDate(row.fecha),
    batch_code:       row.codigoBodega,
    tank_id:          row.tanque,
    variety:          row.variedad,
    brix:             row.brix,
    ph:               row.pH,
    ta:               row.at,
    temperature:      row.temp,
    tant:             row.antoWX,
    notes:            row.notes
  };
}

// Convert "M/D/YYYY" or "YYYY-MM-DD" to "YYYY-MM-DD"
function parseDate(d) {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const parts = d.split('/');
  if (parts.length === 3) {
    const [m, day, y] = parts;
    return `${y}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`;
  }
  return null;
}

// Clean numeric values — handle below-detection strings like "<10", "<50"
const belowDetRe = /^[<>]\s*\d+(\.\d+)?$/;
function cleanNumeric(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  if (str === '' || str === '-' || str === '—' || str === 'NA' || str === 'N/A') return null;
  if (belowDetRe.test(str)) return null; // below detection → NULL
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function cleanRow(row) {
  const numericCols = ['tant','fant','bant','ptan','irps','ph','ta','ipt','brix',
    'l_star','a_star','b_star','color_i','color_t','berry_weight','berry_anthocyanins',
    'berry_sugars_mg','alcohol','va','malic_acid','rs','temperature','so2','nfa',
    'solidos_pct','polifenoles_wx','antocianinas_wx','poli_spica','anto_spica','ipt_spica','p010_kg',
    'ag','am','av','days_post_crush'];
  let hasBelowDet = false;
  for (const col of numericCols) {
    if (col in row && row[col] !== null) {
      const orig = row[col];
      row[col] = cleanNumeric(orig);
      if (row[col] === null && typeof orig === 'string' && belowDetRe.test(orig.trim())) {
        hasBelowDet = true;
      }
    }
  }
  if (hasBelowDet) row.below_detection = true;
  return row;
}

// Ensure all rows in a batch have identical keys (PostgREST requirement)
function normalizeKeys(rows) {
  const allKeys = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  return rows.map(r => {
    const out = {};
    for (const k of allKeys) out[k] = r[k] !== undefined ? r[k] : null;
    return out;
  });
}

async function upsertBatched(table, rows, conflictCol, batchSize = 200) {
  rows = normalizeKeys(rows);
  let total = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const n = await post(table, chunk, conflictCol);
    total += n;
    process.stdout.write(`  ${table}: ${total}/${rows.length}\r`);
  }
  console.log(`  ${table}: ${total} rows inserted`);
  return total;
}

async function main() {
  console.log('Loading JSON files...');
  const berryRaw = JSON.parse(fs.readFileSync('data/berry_data.json', 'utf8'));
  const wineRRaw = JSON.parse(fs.readFileSync('data/wine_recepcion.json', 'utf8'));
  const winePRaw = JSON.parse(fs.readFileSync('data/wine_preferment.json', 'utf8'));

  console.log(`  berry_data.json: ${berryRaw.length} rows`);
  console.log(`  wine_recepcion.json: ${wineRRaw.length} rows`);
  console.log(`  wine_preferment.json: ${winePRaw.length} rows`);

  // Deduplicate by sample_id (berry + wine go into same table)
  const berryRows = berryRaw.map(berryToSupabase).filter(r => r.sample_id);
  const wineRows = wineRRaw.map(wineToSupabase).filter(r => r.sample_id);

  // Merge berry + wine, dedup by sample_id (last wins)
  const sampleMap = new Map();
  for (const r of berryRows) sampleMap.set(r.sample_id, r);
  for (const r of wineRows) sampleMap.set(r.sample_id, r);
  const allSamples = [...sampleMap.values()].map(cleanRow);

  console.log(`\nInserting ${allSamples.length} unique wine_samples...`);
  await upsertBatched('wine_samples', allSamples, 'sample_id');

  // Prefermentativos → prefermentativos table
  const prefRows = winePRaw.map(prefToSupabase).filter(r => r.report_code);
  // Dedup by report_code
  const prefMap = new Map();
  for (const r of prefRows) prefMap.set(r.report_code, r);
  const uniquePref = [...prefMap.values()].map(r => {
    const cleaned = cleanRow(r);
    delete cleaned.below_detection; // prefermentativos table doesn't have this column
    return cleaned;
  });

  console.log(`\nInserting ${uniquePref.length} prefermentativos...`);
  await upsertBatched('prefermentativos', uniquePref, 'report_code');

  console.log('\nDone! Seed complete.');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
