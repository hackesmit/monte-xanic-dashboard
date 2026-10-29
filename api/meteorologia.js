// api/meteorologia.js - session-checked Open-Meteo sync into meteorology.
//
// js/weather.js used to fetch Open-Meteo in the browser and upsert the rows
// into meteorology with the anon key, so RLS had to keep anon_insert WITH
// CHECK (true) and anon_update USING (true) on the table. The anon key from
// /api/config cannot be revoked by logout or the blacklist, so anyone who held
// it once could rewrite any day's weather for every user, and the sync never
// re-fetches a stored day to correct it (security audit 2026-10, bead
// xd-0lt.2). The write now happens only here: the session is checked against
// the blacklist, the SERVER fetches Open-Meteo for the valley's fixed
// coordinates, every value is range-checked, and the rows are upserted with
// the service key. sql/migration_meteorologia_sin_escritura_anon.sql drops the
// anon write policies.
//
//   POST { valle, desde, hasta }   valle one of VDG/VON/SV, ISO dates.
//                                  hasta is capped at today (vineyard time).
//   200 { ok: true, filas }        the rows written, with location.
//
// The client chooses a valley and a date span, never a value or a coordinate.
import { verifyToken } from './_lib/verifyToken.js';
import { rateLimit } from './_lib/rateLimit.js';
import { CONFIG } from '../js/config.js';
import { todayInVineyard, VINEYARD_TZ } from '../js/utils.js';

const ARCHIVE_API = 'https://archive-api.open-meteo.com/v1/archive';
const PRIMER_DIA = '1940-01-01';   // the start of the Open-Meteo archive
const MAX_DIAS = 1100;             // three years: the widest custom range a user picks
const DIA_MS = 86400000;
// One dashboard load syncs three valleys per vintage.
const LIMITE = { maxRequests: 300 };

// Open-Meteo daily field -> meteorology column, with the range a real day in
// Baja California can take (units as Open-Meteo returns them: C, mm, %, index,
// km/h). A value outside its range, or not a number, drops the whole day: the
// day stays missing and the next sync asks for it again.
export const CAMPOS = [
  ['temperature_2m_max',        'temp_max',     -40, 60],
  ['temperature_2m_min',        'temp_min',     -40, 60],
  ['temperature_2m_mean',       'temp_avg',     -40, 60],
  ['precipitation_sum',         'rainfall_mm',    0, 1000],
  ['relative_humidity_2m_mean', 'humidity_pct',   0, 100],
  ['uv_index_max',              'uv_index',       0, 20],
  ['wind_speed_10m_max',        'wind_speed',     0, 400],
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const diaMs = (s) => {
  if (typeof s !== 'string' || !ISO.test(s)) return NaN;
  const ms = Date.parse(`${s}T00:00:00Z`);
  // Date.parse rolls 2025-02-30 over to March; a real date reads back the same.
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? ms : NaN;
};

// The rows of an Open-Meteo daily payload that are inside [desde, hasta] and
// within range, as meteorology rows for `valle`. Pure.
export function filasValidas(daily, valle, desde, hasta) {
  if (!daily || !Array.isArray(daily.time)) return [];
  const filas = [];
  const vistos = new Set();
  daily.time.forEach((date, i) => {
    if (!Number.isFinite(diaMs(date)) || date < desde || date > hasta || vistos.has(date)) return;
    const fila = { date, location: valle };
    for (const [campo, col, min, max] of CAMPOS) {
      const v = daily[campo]?.[i] ?? null;
      if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max)) return;
      fila[col] = v;
    }
    vistos.add(date);
    filas.push(fila);
  });
  return filas;
}

async function openMeteo(coord, desde, hasta) {
  const params = new URLSearchParams({
    latitude: coord.lat,
    longitude: coord.lon,
    start_date: desde,
    end_date: hasta,
    daily: CAMPOS.map(c => c[0]).join(','),
    timezone: VINEYARD_TZ,
  });
  const res = await fetch(`${ARCHIVE_API}?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  return (await res.json())?.daily;
}

async function upsert(filas) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${url}/rest/v1/meteorology?on_conflict=date,location`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(filas),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
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

  const { valle, desde } = req.body || {};
  let { hasta } = req.body || {};
  const coords = CONFIG.valleyCoordinates || {};
  if (typeof valle !== 'string' || !Object.hasOwn(coords, valle)) {
    return res.status(400).json({ ok: false, error: 'Valle no permitido' });
  }
  const hoy = todayInVineyard();
  if (typeof hasta === 'string' && hasta > hoy) hasta = hoy;
  const d = diaMs(desde), h = diaMs(hasta);
  if (!Number.isFinite(d) || !Number.isFinite(h) || desde < PRIMER_DIA || d > h
      || (h - d) / DIA_MS + 1 > MAX_DIAS) {
    return res.status(400).json({ ok: false, error: 'Rango de fechas inválido' });
  }

  let filas;
  try {
    filas = filasValidas(await openMeteo(coords[valle], desde, hasta), valle, desde, hasta);
  } catch (e) {
    console.error('[meteorologia] Open-Meteo:', e.message);
    return res.status(502).json({ ok: false, error: 'No se pudo consultar Open-Meteo' });
  }
  if (!filas.length) return res.status(200).json({ ok: true, filas });

  try {
    await upsert(filas);
  } catch (e) {
    console.error('[meteorologia] escritura fallida:', e.message);
    return res.status(502).json({ ok: false, error: 'No se pudo guardar la meteorología' });
  }
  return res.status(200).json({ ok: true, filas });
}
