// ── Weather Store: Open-Meteo API + Supabase meteorology cache ──
// Valley-specific weather for 3 locations:
//   VDG (Valle de Guadalupe), VON (Valle de Ojos Negros), SV (San Vicente)
// Harvest season: July 1 – October 31

const WeatherStore = {
  data:    [],   // Flat array of all rows { date, location, temp_max, ... }
  _byDate: {},   // YYYY-MM-DD → { VDG: row, VON: row, SV: row }

  _API_BASE: CONFIG.api.openMeteo,
  _TZ:       'America/Tijuana',
  _VALLEYS:  ['VDG', 'VON', 'SV'],

  // ── Load ───────────────────────────────────────────────────────

  async load() {
    if (!DataStore.supabase) return false;
    try {
      const { data, error } = await DataStore.supabase
        .from(CONFIG.tables.meteorology)
        .select('*')
        .order('date', { ascending: true });
      if (error) { console.warn('[WeatherStore] load:', error.message); return false; }
      this.data    = data || [];
      this._byDate = {};
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

  async sync(vintages) {
    if (!DataStore.supabase) return;
    const today = new Date().toISOString().split('T')[0];
    const coords = CONFIG.valleyCoordinates || { VDG: { lat: 32.08, lon: -116.62 } };

    // Detect if location column exists by checking if any loaded row has it
    const hasLocationCol = this.data.some(r => r.location !== undefined);

    for (const valley of this._VALLEYS) {
      // Only sync non-VDG valleys if the location column exists in DB
      if (valley !== 'VDG' && !hasLocationCol) continue;

      const coord = coords[valley];
      if (!coord) continue;

      for (const year of vintages) {
        const start = `${year}-07-01`;
        const end   = `${year}-10-31` <= today ? `${year}-10-31` : today;
        if (start > today) continue;
        if (this._hasFullRange(start, end, valley)) continue;

        try {
          const rows = await this._fetchFromAPI(start, end, coord.lat, coord.lon);
          if (!rows.length) continue;

          // Persist to Supabase
          if (hasLocationCol) {
            rows.forEach(r => { r.location = valley; });
            const { error: upsertErr } = await DataStore.supabase
              .from(CONFIG.tables.meteorology)
              .upsert(rows, { onConflict: 'date,location' });
            if (upsertErr) console.warn(`[WeatherStore] upsert failed for ${valley}:`, upsertErr.message);
          } else {
            // Pre-migration: no location column, use old single-column conflict
            const { error: upsertErr } = await DataStore.supabase
              .from(CONFIG.tables.meteorology)
              .upsert(rows, { onConflict: 'date' });
            if (upsertErr) console.warn('[WeatherStore] upsert failed:', upsertErr.message);
          }

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
    const timeout = setTimeout(() => controller.abort(), CONFIG.timeouts.weatherApiMs);
    let res;
    try {
      res = await fetch(`${this._API_BASE}?${params}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const json = await res.json();
    const d    = json.daily;
    if (!d || !d.time) return [];

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
      if (row && row.rainfall_mm !== null) { total += row.rainfall_mm; hasAny = true; }
      cur.setDate(cur.getDate() + 1);
    }
    return hasAny ? total : null;
  },

  dayOfSeason(dateStr) {
    const iso = this._toISO(dateStr);
    if (!iso) return null;
    const parts = iso.split('-');
    const d = Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const jul1 = Date.UTC(parseInt(parts[0]), 6, 1);
    return Math.floor((d - jul1) / 86400000) + 1;
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
