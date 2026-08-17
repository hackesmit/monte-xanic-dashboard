import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';

// Allowed tables: conflict columns, max rows, column whitelist, required fields
import { sanitizeEvaluaciones, panelConsensus, panelRejectionReason } from '../js/quality-scale.js';

export const ALLOWED_TABLES = {
  wine_samples: {
    conflict: 'sample_id,sample_date,sample_seq',
    // sample_seq carries a deterministic DB default (1); it may be omitted from
    // the payload without breaking upsert dedup. sample_id + sample_date are the
    // meaningful key and must be present — see the key-integrity guard below.
    keyDefault: new Set(['sample_seq']),
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
    keyDefault: new Set(['sample_seq']),
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
      'brix','ph','ta','malic_acid',
    ]),
  },

  // 2026 "Seguimiento de Maduración" per-lot forecast/tonnage/status. The
  // pivoted workbook's per-(lot,date) chemistry goes to berry_samples; this
  // holds what berry_samples has no columns for. tons_seguimiento and
  // cantidad_proyectada are PROVISIONAL/forecast — never authoritative harvested
  // tonnage (see sql/migration_seguimiento_lotes.sql).
  seguimiento_lotes: {
    conflict: 'lot_code,vintage_year',
    maxRows: 500,
    required: ['lot_code'],
    columns: new Set([
      'lot_code','vintage_year','variety','proveedor','status',
      'ant_target','codigo','cantidad_proyectada',
      'tons_seguimiento','tons_seguimiento_cached','tons_mismatch',
    ]),
  },

  // DEPRECATED (Round 35): pre_receptions was unified into mediciones_tecnicas
  // (sql/migration_unify_mediciones.sql). The Pre-recepción parser now writes
  // to mediciones_tecnicas with source='upload'. This whitelist is preserved
  // only to avoid breaking ad-hoc historical inserts; remove once the
  // pre_receptions audit table is dropped.
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
  // Round 35: unified table — accepts both form-entered (source='form') and
  // Pre-recepción upload-entered (source='upload') rows. Schema expanded to
  // a superset of the legacy pre_receptions table by
  // sql/migration_unify_mediciones.sql.
  mediciones_tecnicas: {
    conflict: 'medicion_code',
    maxRows: 500,
    required: ['medicion_code'],
    columns: new Set([
      // Identity / provenance
      'medicion_code','source',
      // Form-original columns
      'medicion_date','vintage_year','variety','appellation',
      'lot_code','tons_received','berry_count_sample','berry_avg_weight_g',
      'berry_diameter_mm','health_grade','health_madura','health_inmadura',
      'health_sobremadura','health_picadura','health_enfermedad',
      'health_quemadura','phenolic_maturity','measured_by','notes',
      // Vendimia 2026: evaluator panel [{evaluador, sanidad, madurez}]
      'evaluaciones',
      // Round 35 — absorbed from pre_receptions
      'vintrace','reception_date','supplier',
      'total_bins','bin_unit','bin_temp_c','truck_temp_c',
      'bunch_avg_weight_g','berry_length_avg_cm','berries_200_weight_g',
      'health_pasificada','health_aceptable','health_no_aceptable',
      'lab_date','brix','ph','at','ag','am','av','polifenoles','catequinas','antocianos',
    ])
  },
  harvest_target_overrides: {
    conflict: 'variety,valley',
    columns: new Set([
      'variety', 'valley',
      'brix_target', 'brix_target_lower', 'brix_upper',
      'anthocyanin_target', 'ph_target',
      'updated_by', 'updated_at',
    ]),
  },
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

  // 2. Check role — only lab can upload (admin = view+export only, Round 37)
  const role = result.payload.role || 'viewer';
  if (role !== 'lab') {
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
      // A present-but-not-an-array panel is a malformed request, not an
      // instruction to erase: writing sanitizeEvaluaciones' null would wipe a
      // stored panel and both labels off a row that was fine.
      //
      // The evaluator panel is the only JSONB column this path writes, so it
      // is the only place a caller could put arbitrary structure into the
      // database. Reduce it to the shape the scoring engine expects, then
      // derive the two consensus labels here rather than trusting whatever
      // the caller sent for them. Client-side JavaScript is editable, and the
      // cap below is applied after sanitising, so a caller who computed a
      // consensus over more rows than survive would otherwise leave the panel
      // and its labels disagreeing about the same row (lucy, 2026-08-12).
      const panelError = panelRejectionReason(row.evaluaciones);
      if (panelError) return res.status(400).json({ ok: false, error: panelError });
      if ('evaluaciones' in row) {
        row.evaluaciones = sanitizeEvaluaciones(row.evaluaciones);
        const consensus = panelConsensus(row.evaluaciones || []);
        row.health_grade      = consensus.health_grade;
        row.phenolic_maturity = consensus.phenolic_maturity;
      } else {
        // No panel, no opinion about the labels that describe one. Deriving
        // only when the panel is present left the invariant escapable by
        // simply omitting it: a payload carrying flattering labels and no
        // panel used to pass straight through and disagree with the stored
        // panel and the score (lucy, 2026-08-12). Both writers always send
        // the panel alongside, so nothing legitimate is dropped here.
        delete row.health_grade;
        delete row.phenolic_maturity;
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

  // 4b. Upsert-key integrity. PostgREST resolves `on_conflict` against the
  // table's unique constraint, but Postgres treats NULL as distinct: a NULL in
  // any key column makes the constraint a no-op, so the row is INSERTed fresh on
  // every retry instead of merged. A sync button's double-clicks, timeout
  // retries, and overlapping runs would each leave a duplicate. Reject a row
  // whose natural key is not fully present — the same guard /api/row already
  // applies to its edit path. Columns with a deterministic non-null DB default
  // (keyDefault, e.g. sample_seq) may be omitted: the default still lets the
  // conflict arbiter match across retries.
  const keyCols = (tableConfig.conflict || '').split(',').map(s => s.trim()).filter(Boolean);
  if (keyCols.length) {
    const keyDefault = tableConfig.keyDefault;
    for (let i = 0; i < rows.length; i++) {
      for (const col of keyCols) {
        const present = col in rows[i];
        const empty = rows[i][col] === null || rows[i][col] === '';
        if (keyDefault && keyDefault.has(col)) {
          // Absent is fine (DB fills the default); an explicit null/'' is not —
          // it would either duplicate or fail the NOT NULL column for the whole
          // batch. Reject early with a clear per-row message.
          if (present && empty) {
            return res.status(400).json({ ok: false,
              error: `Fila ${i + 1}: llave '${col}' no puede ser vacía` });
          }
          continue;
        }
        if (!present || rows[i][col] === undefined || empty) {
          return res.status(400).json({ ok: false,
            error: `Fila ${i + 1}: llave de conflicto '${col}' falta o está vacía` });
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
    // `missing=default` is what actually makes the keyDefault allowance above
    // true. PostgREST builds one INSERT for the whole batch from the UNION of
    // the keys present across rows, and without this preference a column that
    // some rows carry and others omit is sent as NULL for the omitting rows.
    // For sample_seq that means either failing its NOT NULL for the entire
    // batch, or writing a NULL that makes the composite unique constraint a
    // no-op and reintroduces duplicate-on-retry. Asking for the column default
    // instead is the documented fix, and it only affects absent keys.
    const prefer = [];
    if (conflictCol) {
      prefer.push('resolution=merge-duplicates');
      if (tableConfig.keyDefault && tableConfig.keyDefault.size) prefer.push('missing=default');
    } else {
      prefer.push('return=minimal');
    }
    const headers = {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': prefer.join(',')
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
      // Schema-cache errors → translate the opaque PostgREST message into
      // an actionable hint pointing at the missing migration (Round 36).
      if (/schema cache|column .+ does not exist/i.test(errText)) {
        detail += ' — la migración correspondiente parece no estar aplicada. ' +
          'Revisa /api/migrations-status o ejecuta los archivos pendientes en sql/.';
      }
      return res.status(500).json({ ok: false, error: detail });
    }

    return res.status(200).json({ ok: true, count: rows.length });
  } catch (err) {
    console.error('[upload] Server error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
}
