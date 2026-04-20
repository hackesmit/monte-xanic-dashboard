// ── Weather Store: Open-Meteo API + Supabase meteorology cache ──
// Valley-specific weather for 3 locations:
//   VDG (Valle de Guadalupe), VON (Valle de Ojos Negros), SV (San Vicente)
// Harvest season: July 1 – October 31
import { CONFIG } from './config.js';
import { DataStore } from './dataLoader.js';

export const WeatherStore = {
  data:    [],   // Flat array of all rows { date, location, temp_max, ... }
  _byDate: {},   // YYYY-MM-DD → { VDG: row, VON: row, SV: row }
  _gddCache: {},

  _API_BASE: 'https://archive-api.open-meteo.com/v1/archive',
  _FORECAST_API: 'https://api.open-meteo.com/v1/forecast',
  _TZ:       'America/Tijuana',
  _VALLEYS:  ['VDG', 'VON', 'SV'],

  // Forecast cache: in-memory, 1-hour TTL, keyed by `${valley}_${horizon}`
  _FORECAST_TTL_MS: 60 * 60 * 1000,
  _forecastCache: {},

  // ── Load ───────────────────────────────────────────────────────

  async load() {
    if (!DataStore.supabase) return false;
    try {
      const { data, error } = await DataStore.supabase
        .from('meteorology')
        .select('*')
        .order('date', { ascending: true });
      if (error) { console.warn('[WeatherStore] load:', error.message); return false; }
      this.data    = data || [];
      this._byDate = {};
      this._gddCache = {};
      this.data.forEach(r => {
        const loc = r.location || 'VDG';
        if (!this._byDate[r.date]) this._byDate[r.date] = {};
        this._byDate[r.date][loc] = r;
      });
      return this.data.length > 0;
    } catch (e) {
      console.warn('[WeatherStore] load error:', e);
      return false;
    }
  },

  // ── Sync ───────────────────────────────────────────────────────

  _isSyncing: false,

  async sync(vintages, dateRangeFn) {
    if (!DataStore.supabase || this._isSyncing) return;
    this._isSyncing = true;
    try { await this._syncInner(vintages, dateRangeFn); } finally { this._isSyncing = false; }
  },

  async _syncInner(vintages, dateRangeFn) {
    const today = new Date().toISOString().split('T')[0];
    const coords = CONFIG.valleyCoordinates || { VDG: { lat: 32.08, lon: -116.62 } };
    const rangeFn = dateRangeFn || (year => ({
      start: `${year}-07-01`,
      end: `${year}-10-31` <= today ? `${year}-10-31` : today
    }));

    // Detect if location column exists by checking if any loaded row has it
    const hasLocationCol = this.data.some(r => r.location !== undefined);

    for (const valley of this._VALLEYS) {
      // Only sync non-VDG valleys if the location column exists in DB
      if (valley !== 'VDG' && !hasLocationCol) continue;

      const coord = coords[valley];
      if (!coord) continue;

      for (const year of vintages) {
        const { start, end } = rangeFn(year);
        if (start > today) continue;
        if (this._hasFullRange(start, end, valley)) continue;

        try {
          const rows = await this._fetchFromAPI(start, end, coord.lat, coord.lon);
          if (!rows.length) continue;

          // Persist to Supabase
          if (hasLocationCol) {
            rows.forEach(r => { r.location = valley; });
            const { error: upsertErr } = await DataStore.supabase
              .from('meteorology')
              .upsert(rows, { onConflict: 'date,location' });
            if (upsertErr) { console.warn(`[WeatherStore] upsert failed for ${valley}:`, upsertErr.message); continue; }
          } else {
            // Pre-migration: no location column, use old single-column conflict
            const { error: upsertErr } = await DataStore.supabase
              .from('meteorology')
              .upsert(rows, { onConflict: 'date' });
            if (upsertErr) { console.warn('[WeatherStore] upsert failed:', upsertErr.message); continue; }
          }

          // Only update in-memory state after confirmed DB upsert
          rows.forEach(r => {
            if (!this._byDate[r.date]) this._byDate[r.date] = {};
            if (!this._byDate[r.date][valley]) this.data.push(r);
            this._byDate[r.date][valley] = r;
          });
        } catch (e) {
          console.warn('[WeatherStore] sync failed for', valley, year, ':', e.message);
        }
      }
    }
    this.data.sort((a, b) => a.date.localeCompare(b.date));
  },

  _hasFullRange(start, end, location) {
    const sp = start.split('-').map(Number);
    const ep = end.split('-').map(Number);
    let cur = Date.UTC(sp[0], sp[1] - 1, sp[2]);
    const endMs = Date.UTC(ep[0], ep[1] - 1, ep[2]);
    const totalDays = Math.floor((endMs - cur) / 86400000) + 1;
    let present = 0;
    while (cur <= endMs) {
      const iso = new Date(cur).toISOString().split('T')[0];
      if (this._byDate[iso] && this._byDate[iso][location]) present++;
      cur += 86400000;
    }
    return (totalDays - present) <= 3;
  },

  // ── Open-Meteo fetch ───────────────────────────────────────────

  async _fetchFromAPI(startDate, endDate, lat, lon) {
    const params = new URLSearchParams({
      latitude:   lat,
      longitude:  lon,
      start_date: startDate,
      end_date:   endDate,
      daily: [
        'temperature_2m_max',
        'temperature_2m_min',
        'temperature_2m_mean',
        'precipitation_sum',
        'relative_humidity_2m_mean',
        'uv_index_max',
        'wind_speed_10m_max'
      ].join(','),
      timezone: this._TZ
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(`${this._API_BASE}?${params}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = await res.json();
    const d    = json.daily;
    if (!d || !Array.isArray(d.time)) {
      console.error('[WeatherStore] Respuesta inesperada de Open-Meteo:', d);
      return [];
    }

    return d.time.map((date, i) => ({
      date,
      temp_max:     d.temperature_2m_max?.[i]        ?? null,
      temp_min:     d.temperature_2m_min?.[i]        ?? null,
      temp_avg:     d.temperature_2m_mean?.[i]       ?? null,
      rainfall_mm:  d.precipitation_sum?.[i]         ?? null,
      humidity_pct: d.relative_humidity_2m_mean?.[i] ?? null,
      uv_index:     d.uv_index_max?.[i]              ?? null,
      wind_speed:   d.wind_speed_10m_max?.[i]        ?? null
    }));
  },

  // ── Forecast (Open-Meteo forecast API) ─────────────────────────

  async syncForecast(valley, horizon) {
    const loc = valley || 'VDG';
    const h = horizon === 16 ? 16 : 7;
    const key = `${loc}_${h}`;
    const now = Date.now();
    const cached = this._forecastCache[key];
    if (cached && (now - cached.fetchedAt) < this._FORECAST_TTL_MS) return cached.data;

    const coord = (CONFIG.valleyCoordinates || {})[loc];
    if (!coord) return null;

    try {
      const rows = await this._fetchForecastFromAPI(coord.lat, coord.lon, h);
      this._forecastCache[key] = { data: rows, fetchedAt: now };
      return rows;
    } catch (e) {
      console.warn('[WeatherStore] forecast fetch failed for', loc, ':', e.message);
      return null;
    }
  },

  async _fetchForecastFromAPI(lat, lon, horizon) {
    const params = new URLSearchParams({
      latitude:  lat,
      longitude: lon,
      daily: [
        'temperature_2m_max',
        'temperature_2m_min',
        'temperature_2m_mean',
        'precipitation_sum',
        'relative_humidity_2m_mean'
      ].join(','),
      forecast_days: horizon,
      timezone: this._TZ
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(`${this._FORECAST_API}?${params}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`Open-Meteo forecast HTTP ${res.status}`);
    const json = await res.json();
    return this._parseForecastDaily(json);
  },

  _parseForecastDaily(json) {
    const d = json && json.daily;
    if (!d || !Array.isArray(d.time)) return [];
    return d.time.map((date, i) => ({
      date,
      temp_max:     d.temperature_2m_max?.[i]        ?? null,
      temp_min:     d.temperature_2m_min?.[i]        ?? null,
      temp_avg:     d.temperature_2m_mean?.[i]       ?? null,
      rainfall_mm:  d.precipitation_sum?.[i]         ?? null,
      humidity_pct: d.relative_humidity_2m_mean?.[i] ?? null,
      isForecast:   true
    }));
  },

  getForecast(valley, horizon) {
    const loc = valley || 'VDG';
    const h = horizon === 16 ? 16 : 7;
    return this._forecastCache[`${loc}_${h}`]?.data || null;
  },

  clearForecastCache() { this._forecastCache = {}; },

  // Forecast is only meaningful when the visible range extends to/past today
  // AND we're not in a purely-historical mode (30d is today-backward).
  forecastEligible(timeframe, rangeEnd) {
    if (timeframe === '30d') return false;
    if (!rangeEnd) return false;
    const today = new Date().toISOString().split('T')[0];
    return rangeEnd >= today;
  },

  // Filter forecast rows to those with date strictly after lastObservedDate,
  // up to min(rangeEnd, forecast horizon end). Never overlap observed data.
  forecastWithinRange(forecastRows, lastObservedDate, rangeEnd) {
    if (!Array.isArray(forecastRows)) return [];
    const today = new Date().toISOString().split('T')[0];
    const minDate = lastObservedDate && lastObservedDate >= today ? lastObservedDate : today;
    return forecastRows.filter(r => r.date > minDate && r.date <= rangeEnd);
  },

  // ── Accessors ──────────────────────────────────────────────────

  getRange(startDate, endDate, location) {
    const loc = location || 'VDG';
    return this.data.filter(d => {
      const dloc = d.location || 'VDG';
      return dloc === loc && d.date >= startDate && d.date <= endDate;
    });
  },

  getByDate(dateStr, appellation) {
    const iso = this._toISO(dateStr);
    if (!iso || !this._byDate[iso]) return null;
    const valley = CONFIG.getWeatherValley(appellation);
    return this._byDate[iso][valley] || this._byDate[iso]['VDG'] || null;
  },

  getTempForDate(dateStr, appellation) {
    const w = this.getByDate(dateStr, appellation);
    return w ? w.temp_avg : null;
  },

  getCumulativeRainfall(dateStr, vintageYear, appellation) {
    const iso = this._toISO(dateStr);
    if (!iso) return null;
    const year   = vintageYear || parseInt(iso.substring(0, 4));
    const valley = CONFIG.getWeatherValley(appellation);
    const start  = `${year}-07-01`;
    const endD   = new Date(iso);
    let total    = 0;
    let hasAny   = false;
    const cur    = new Date(start);
    while (cur <= endD) {
      const d = cur.toISOString().split('T')[0];
      const dayData = this._byDate[d];
      const row = dayData ? (dayData[valley] || dayData['VDG']) : null;
      if (row && row.rainfall_mm !== null && row.rainfall_mm >= 0) { total += row.rainfall_mm; hasAny = true; }
      cur.setDate(cur.getDate() + 1);
    }
    return hasAny ? total : null;
  },

  getCumulativeGDD(dateStr, appellation) {
    const iso = this._toISO(dateStr);
    if (!iso) return null;
    const valley = CONFIG.getWeatherValley(appellation);
    const cacheKey = `${iso}_${valley}`;
    if (this._gddCache[cacheKey] !== undefined) return this._gddCache[cacheKey];
    const year = parseInt(iso.substring(0, 4));
    const start = `${year}-07-01`;
    const endD = new Date(iso);
    let total = 0;
    let totalDays = 0;
    let missingDays = 0;
    const cur = new Date(start);
    while (cur <= endD) {
      totalDays++;
      const d = cur.toISOString().split('T')[0];
      const dayData = this._byDate[d];
      const row = dayData ? (dayData[valley] || dayData['VDG']) : null;
      if (row && row.temp_avg !== null) {
        total += Math.max(0, row.temp_avg - 10);
      } else {
        missingDays++;
      }
      cur.setDate(cur.getDate() + 1);
    }
    // Return null if too many days missing (>3 or >10% of range)
    const result = (totalDays === 0 || missingDays > 3 || missingDays / totalDays > 0.1)
      ? null : Math.round(total * 10) / 10;
    this._gddCache[cacheKey] = result;
    return result;
  },

  dayOfSeason(dateStr) {
    const iso = this._toISO(dateStr);
    if (!iso) return null;
    const parts = iso.split('-');
    const d = Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const jul1 = Date.UTC(parseInt(parts[0]), 6, 1);
    return Math.floor((d - jul1) / 86400000) + 1;
  },

  // ── Aggregation ──────────────────────────────────────────────────

  aggregate(rows, mode) {
    if (!mode || mode === 'day') return rows;
    const groups = {};
    for (const r of rows) {
      const key = mode === 'week' ? this._isoWeek(r.date) : r.date.substring(0, 7);
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, grp]) => {
        const avg = (f) => {
          const v = grp.map(r => r[f]).filter(x => x !== null && x !== undefined);
          return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
        };
        const sum = (f) => {
          const v = grp.map(r => r[f]).filter(x => x !== null && x !== undefined);
          return v.length ? v.reduce((a, b) => a + b, 0) : null;
        };
        const mid = grp[Math.floor(grp.length / 2)];
        return {
          date: mid.date,
          location: grp[0].location,
          temp_max: avg('temp_max'),
          temp_min: avg('temp_min'),
          temp_avg: avg('temp_avg'),
          rainfall_mm: sum('rainfall_mm'),
          humidity_pct: avg('humidity_pct'),
          uv_index: avg('uv_index'),
          wind_speed: avg('wind_speed'),
          _gddContribution: grp.reduce((acc, r) =>
            acc + (r.temp_avg !== null ? Math.max(0, r.temp_avg - 10) : 0), 0),
          _periodLabel: mode === 'week'
            ? `Sem ${this._isoWeek(mid.date).split('-W')[1]}`
            : this._monthName(parseInt(mid.date.split('-')[1])),
          _dayCount: grp.length
        };
      });
  },

  _isoWeek(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  },

  _monthName(month) {
    return ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][month - 1] || '';
  },

  // ── Date range helpers ─────────────────────────────────────────

  getDateRange(vintage, timeframe, customRange) {
    const today = new Date().toISOString().split('T')[0];
    switch (timeframe) {
      case 'year':
        return { start: `${vintage}-01-01`, end: `${vintage}-12-31` <= today ? `${vintage}-12-31` : today };
      case '30d': {
        const d = new Date(); d.setDate(d.getDate() - 29);
        return { start: d.toISOString().split('T')[0], end: today };
      }
      case 'custom':
        return (customRange && customRange.start && customRange.end)
          ? customRange
          : { start: `${vintage}-07-01`, end: `${vintage}-10-31` <= today ? `${vintage}-10-31` : today };
      default:
        return { start: `${vintage}-07-01`, end: `${vintage}-10-31` <= today ? `${vintage}-10-31` : today };
    }
  },

  dayInRange(dateStr, rangeStart) {
    const dp = dateStr.split('-').map(Number);
    const sp = rangeStart.split('-').map(Number);
    const d = Date.UTC(dp[0], dp[1] - 1, dp[2]);
    const s = Date.UTC(sp[0], sp[1] - 1, sp[2]);
    return Math.floor((d - s) / 86400000) + 1;
  },

  _xAxisTitle(timeframe) {
    switch (timeframe) {
      case 'year': return 'Día del año (1 = 1 Ene)';
      case '30d': return 'Últimos 30 días';
      case 'custom': return 'Día desde inicio del rango';
      default: return 'Día de temporada (1 = 1 Jul)';
    }
  },

  getVintagesFromData() {
    const years = new Set(DataStore.berryData.map(d => d.vintage).filter(Boolean));
    return [...years].map(Number).sort();
  },

  _toISO(dateStr) {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const p = s.split('/');
    if (p.length === 3) {
      const [m, d, y] = p.map(Number);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    return null;
  }
};
