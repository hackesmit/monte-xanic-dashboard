// api/pronostico.js - session-checked per-lot forecast of the date at target
// Brix (xd-2ov.2). The server reads the berry samples, the receptions and the
// target overrides with the service key, runs js/pronostico/brix.js (the same
// pure code the backtest measured) and records each issued forecast in
// public.pronosticos. The client sends no value: at most a past cutoff date.
//
//   GET                     today's forecasts; new ones are recorded
//   GET ?corte=YYYY-MM-DD   replay as of a past day (samples and receptions
//                           after it ignored); records nothing
//   200 { ok, corte, vendimia, modelo, banda, filas, guardado }
//
// Writes go only to public.pronosticos, insert-or-ignore on its unique key, so
// a reload writes nothing new and an issued forecast is never rewritten. A
// failed write does not hide the forecast: guardado is false and it is logged.
import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';
import { todayInVineyard } from '../js/utils.js';
import { resolveRubric, resolveValley } from '../js/classification.js';
import { resolveTarget } from '../js/prediction.js';
import {
  seriesPorLote, pronosticosLotes, diaDe, MODELO_VERSION, MIN_MUESTRAS,
} from '../js/pronostico/brix.js';
import { BANDA_BRIX } from '../js/pronostico/brixBanda.js';

const PAGINA = 1000;   // PostgREST caps a response at 1000 rows
const MAX_PAGINAS = 20;
const LIMITE = { maxRequests: 120 };
const VALLE_CODIGO = { 'Valle de Guadalupe': 'VDG', 'Valle de Ojos Negros': 'VON',
  'Valle de San Vicente': 'VSV' };
// Estados worth recording: a forecast, or a reason the lot has none although
// it has samples and a target. Not 'cosechado' (no longer a forecast).
const REGISTRABLES = new Set(['pronostico', 'sin-banda', 'fuera-de-rango', 'sin-tendencia', 'alcanzado']);

async function sb(path, init = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  if (init.method === 'POST') return null;
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = undefined; }
  if (!Array.isArray(json)) throw new Error('Supabase: respuesta no es una lista');
  return json;
}

async function todas(path) {
  const filas = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const pag = await sb(`${path}&limit=${PAGINA}&offset=${p * PAGINA}`);
    filas.push(...pag);
    if (pag.length < PAGINA) return filas;
  }
  throw new Error('Demasiadas filas');
}

// The target Brix of a lot: the catalog rubric's ideal range midpoint, or the
// winemaker's override for (variety, valley), as the Prediccion view resolves it.
export function objetivoPara(overrides) {
  const porClave = new Map((overrides || []).map(o => [`${o.variety}|${o.valley}`, o]));
  return (serie) => {
    const rubric = resolveRubric(serie.variedad, serie.denominacion);
    const valle = VALLE_CODIGO[resolveValley(serie.denominacion)] ?? null;
    const override = porClave.get(`${serie.variedad}|${valle}`) ?? null;
    const t = resolveTarget({ rubric, override }).brixTarget;
    return Number.isFinite(t) ? t : null;
  };
}

// Pure core, exported for tests: rows in, forecasts and rows to record out.
export function construir({ muestras, recepciones, overrides, corte }) {
  const vendimia = Number(corte.slice(0, 4));
  const { filas } = pronosticosLotes({
    series: seriesPorLote(muestras), recepciones, objetivoDe: objetivoPara(overrides),
    vendimia, corteDia: diaDe(corte), banda: BANDA_BRIX.banda,
  });
  const registro = filas
    .filter(f => REGISTRABLES.has(f.estado) && f.n >= MIN_MUESTRAS && f.objetivo !== null)
    .map(f => ({
      tipo: 'brix_objetivo', lote: f.lote, vendimia, fecha_corte: f.fechaUltima,
      n_muestras: f.n, valor_ultimo: f.brixUltimo, objetivo: f.objetivo, estado: f.estado,
      fecha_pronostico: f.fechaObjetivo, banda_dias: f.bandaDias, modelo: MODELO_VERSION,
    }));
  return { vendimia, filas, registro };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }
  const result = await verifyToken(req.headers['x-session-token'], { checkBlacklist: true });
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: 'No autorizado' });
  }
  if (!rateLimit(req, res, LIMITE)) return;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: 'Base de datos no configurada' });
  }

  const hoy = todayInVineyard();
  const pedido = req.query?.corte;
  let corte = hoy;
  if (pedido !== undefined) {
    if (typeof pedido !== 'string' || !ISO.test(pedido) || !Number.isFinite(diaDe(pedido))
        || pedido < '2000-01-01' || pedido > hoy) {
      return res.status(400).json({ ok: false, error: 'Fecha de corte inválida' });
    }
    corte = pedido;
  }
  const registrar = corte === hoy;
  const vendimia = Number(corte.slice(0, 4));

  let muestras, recepciones, overrides;
  try {
    const cols = 'select=sample_id,sample_date,vintage_year,variety,appellation,brix';
    const filtro = `brix=not.is.null&vintage_year=lte.${vendimia}&order=sample_date.asc,id.asc`;
    const [ws, bs, rc, ov] = await Promise.all([
      todas(`wine_samples?${cols}&sample_type=eq.Berries&${filtro}`),
      todas(`berry_samples?${cols}&${filtro}`),
      todas(`mediciones_tecnicas?select=lot_code,vintage_year,reception_date&vintage_year=eq.${vendimia}&order=id.asc`),
      todas('harvest_target_overrides?select=variety,valley,brix_target,brix_target_lower,brix_upper&order=id.asc'),
    ]);
    muestras = [...ws, ...bs];
    recepciones = rc;
    overrides = ov;
  } catch (e) {
    console.error('[pronostico] lectura fallida:', e.message);
    return res.status(502).json({ ok: false, error: 'No se pudieron leer las muestras' });
  }

  const { filas, registro } = construir({ muestras, recepciones, overrides, corte });

  let guardado = false;
  if (registrar && registro.length) {
    try {
      await sb('pronosticos?on_conflict=tipo,lote,vendimia,fecha_corte,modelo,objetivo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(registro),
      });
      guardado = true;
    } catch (e) {
      console.error('[pronostico] registro fallido:', e.message);
    }
  }
  return res.status(200).json({
    ok: true, corte, vendimia, modelo: MODELO_VERSION, banda: BANDA_BRIX.banda, filas, guardado,
  });
}
