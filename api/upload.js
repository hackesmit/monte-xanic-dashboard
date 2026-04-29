import { verifyToken } from './lib/verifyToken.js';
import { rateLimit } from './lib/rateLimit.js';

// Allowed tables: conflict columns, max rows, column whitelist, required fields
export const ALLOWED_TABLES = {
  wine_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    maxRows: 500,
    required: ['sample_id'],
    columns: new Set([
      'sample_id','vessel_id','sample_type','sample_date',
      'crush_date','days_post_crush','vintage_year','variety','appellation',
      'tant','fant','bant','ptan','irps','ipt','ph','ta','brix',
      'l_star','a_star','b_star','color_i','color_t','berry_weight',
      'berry_anthocyanins','berry_sugars_mg','alcohol','va','malic_acid',
      'rs','below_detection','notes','sample_seq'
    ])
  },
  tank_receptions: {
    conflict: 'report_code',
    maxRows: 200,
    required: ['report_code'],
    columns: new Set([
      'report_code','reception_date','batch_code','tank_id','supplier',
      'variety','brix','ph','ta','ag','am','av','so2','nfa',
      'temperature','solidos_pct','polifenoles_wx','antocianinas_wx',
      'poli_spica','anto_spica','ipt_spica','acidificado','p010_kg',
      'vintage_year'
    ])
  },
  berry_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    maxRows: 1000,
    required: ['sample_id'],
    columns: new Set([
      'sample_id','sample_date','sample_seq','sample_type',
      'vintage_year','variety','appellation','crush_date','days_post_crush',
      'batch_id','notes','below_detection',
      'berry_count','berries_weight_g','extracted_juice_ml','extracted_juice_g',
      'extracted_phenolics_ml','berry_fresh_weight_g','berry_anthocyanins_mg_100b',
      'berry_sugars_mg','berry_acids_mg','berry_water_mg','berry_skins_seeds_mg',
      'berry_sugars_pct','berry_acids_pct','berry_water_pct','berry_skins_seeds_pct',
      'berry_sugars_g','berry_acids_g','berry_water_g','berry_skins_seeds_g',
      'ipt','tant','fant','bant','ptan','irps',
      'l_star','a_star','b_star','color_i','color_t',
      'brix','ph','ta',
    ]),
  },

  pre_receptions: {
    conflict: 'report_code',
    maxRows: 500,
    required: ['report_code'],
    columns: new Set([
      'report_code','vintrace','reception_date','medicion_date','vintage_year',
      'supplier','variety','lot_code',
      'total_bins','bin_unit','tons_received','bin_temp_c','truck_temp_c',
      'bunch_avg_weight_g','berry_length_avg_cm','berries_200_weight_g','berry_avg_weight_g',
      'health_madura','health_inmadura','health_sobremadura','health_picadura',
      'health_enfermedad','health_pasificada','health_aceptable','health_no_aceptable',
      'lab_date','brix','ph','at','ag','am','polifenoles','catequinas','antocianos',
      'notes',
    ]),
  },

  reception_lots: {
    conflict: 'report_code,lot_position',
    maxRows: 2000,
    required: ['report_code','lot_code'],
    columns: new Set(['report_code','lot_code','lot_position','reception_id']),
  },
  prefermentativos: {
    conflict: 'report_code',
    maxRows: 200,
    required: ['report_code'],
    columns: new Set([
      'report_code','measurement_date','batch_code','tank_id','variety',
      'brix','ph','ta','temperature','tant','notes','vintage_year'
    ])
  },
  mediciones_tecnicas: {
    conflict: 'medicion_code',
    maxRows: 200,
    required: ['medicion_code'],
    columns: new Set([
      'medicion_code','medicion_date','vintage_year','variety','appellation',
      'lot_code','tons_received','berry_count_sample','berry_avg_weight_g',
      'berry_diameter_mm','health_grade','health_madura','health_inmadura',
      'health_sobremadura','health_picadura','health_enfermedad',
      'health_quemadura','phenolic_maturity','measured_by','notes'
    ])
  }
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!rateLimit(req, res, { maxRequests: 30 })) return;

  // 1. Validate auth token + blacklist
  const token = req.headers['x-session-token'];
  const result = await verifyToken(token, { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: 'No autorizado' });
  }

  // 2. Check role — only lab and admin can upload
  const role = result.payload.role || 'viewer';
  if (role !== 'lab' && role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Sin permisos para subir datos' });
  }

  // 3. Validate request body
  const { table, rows } = req.body || {};

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

  // 4. Strip unknown columns and validate required fields
  const { columns, required } = tableConfig;
  if (columns) {
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!columns.has(key)) delete row[key];
      }
    }
  }
  if (required && required.length) {
    for (let i = 0; i < rows.length; i++) {
      for (const field of required) {
        if (rows[i][field] === undefined || rows[i][field] === null || rows[i][field] === '') {
          return res.status(400).json({
            ok: false,
            error: `Fila ${i + 1}: campo requerido '${field}' falta o está vacío`
          });
        }
      }
    }
  }

  // 5. Insert via Supabase service key (server-side only)
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: 'Configuración de base de datos incompleta' });
  }

  try {
    const conflictCol = tableConfig.conflict;
    const headers = {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
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
      // Parse Supabase error for user-facing detail
      let detail = 'Error al insertar datos';
      try {
        const errObj = JSON.parse(errText);
        if (errObj.message) detail += ': ' + errObj.message;
      } catch (_) { /* ignore parse error */ }
      return res.status(500).json({ ok: false, error: detail });
    }

    return res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    console.error('[upload] Server error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}
