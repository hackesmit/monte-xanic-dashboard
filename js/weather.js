// ── Weather Store: Open-Meteo API + Supabase meteorology cache ──
// Valle de Guadalupe: 32.0°N, 116.6°W
// Harvest season: July 1 – October 31

const WeatherStore = {
  data:    [],   // Sorted array of daily rows { date, temp_max, temp_min, temp_avg, rainfall_mm, ... }
  _byDate: {},   // YYYY-MM-DD → row (O(1) lookup)

  _API_BASE: 'https://api.open-meteo.com/v1/archive',
  _LAT:       32.0,
  _LON:      -116.6,
  _TZ:       'America/Tijuana',

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
      this.data.forEach(r => { this._byDate[r.date] = r; });
      return this.data.length > 0;
    } catch (e) {
      console.warn('[WeatherStore] load error:', e);
      return false;
    }
  },

  // ── Sync ───────────────────────────────────────────────────────
  // Fetch any missing harvest-season days from Open-Meteo and cache them.
  // vintages: array of vintage years, e.g. [2024, 2025]

  async sync(vintages) {
    if (!DataStore.supabase) return;
    const today = new Date().toISOString().split('T')[0];

    for (const year of vintages) {
      const start = `${year}-07-01`;
      const end   = `${year}-10-31` <= today ? `${year}-10-31` : today;
      if (start > today) continue;
      if (this._hasFullRange(start, end)) continue;

      try {
        const rows = await this._fetchFromAPI(start, end);
        if (!rows.length) continue;
        await DataStore.supabase
          .from('meteorology')
          .upsert(rows, { onConflict: 'date' });
        rows.forEach(r => {
          this._byDate[r.date] = r;
          if (!this.data.find(d => d.date === r.date)) this.data.push(r);
        });
        this.data.sort((a, b) => a.date.localeCompare(b.date));
      } catch (e) {
        console.warn('[WeatherStore] sync failed for', year, ':', e.message);
      }
    }
  },

  // Return true if we already have near-complete data for the range (≤3 missing days allowed)
  _hasFullRange(start, end) {
    const startD    = new Date(start);
    const endD      = new Date(end);
    const totalDays = Math.floor((endD - startD) / 86400000) + 1;
    let present     = 0;
    const cur       = new Date(startD);
    while (cur <= endD) {
      if (this._byDate[cur.toISOString().split('T')[0]]) present++;
      cur.setDate(cur.getDate() + 1);
    }
    return (totalDays - present) <= 3;
  },

  // ── Open-Meteo fetch ───────────────────────────────────────────

  async _fetchFromAPI(startDate, endDate) {
    const params = new URLSearchParams({
      latitude:   this._LAT,
      longitude:  this._LON,
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

    const res = await fetch(`${this._API_BASE}?${params}`);
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

  getRange(startDate, endDate) {
    return this.data.filter(d => d.date >= startDate && d.date <= endDate);
  },

  getByDate(dateStr) {
    return this._byDate[this._toISO(dateStr)] || null;
  },

  getTempForDate(dateStr) {
    const w = this.getByDate(dateStr);
    return w ? w.temp_avg : null;
  },

  // Cumulative rainfall from July 1 of the sample's vintage year up to sampleDate
  getCumulativeRainfall(dateStr) {
    const iso = this._toISO(dateStr);
    if (!iso) return null;
    const year   = parseInt(iso.substring(0, 4));
    const start  = `${year}-07-01`;
    const endD   = new Date(iso);
    let total    = 0;
    let hasAny   = false;
    const cur    = new Date(start);
    while (cur <= endD) {
      const row = this._byDate[cur.toISOString().split('T')[0]];
      if (row && row.rainfall_mm !== null) { total += row.rainfall_mm; hasAny = true; }
      cur.setDate(cur.getDate() + 1);
    }
    return hasAny ? total : null;
  },

  // Day-of-season index: July 1 = 1, Aug 1 = 32, etc.
  dayOfSeason(dateStr) {
    const iso = this._toISO(dateStr);
    if (!iso) return null;
    const d    = new Date(iso);
    const jul1 = new Date(d.getFullYear(), 6, 1);
    return Math.floor((d - jul1) / 86400000) + 1;
  },

  // Return unique vintage years present in DataStore.berryData
  getVintagesFromData() {
    const years = new Set(DataStore.berryData.map(d => d.vintage).filter(Boolean));
    return [...years].map(Number).sort();
  },

  // Growing Degree Days: sum of max(0, temp_avg - baseTemp) from Jul 1 – Oct 31
  gdd(year, baseTemp = 10) {
    const start = `${year}-07-01`;
    const end   = `${year}-10-31`;
    let total   = 0;
    let hasAny  = false;
    const cur   = new Date(start);
    const endD  = new Date(end);
    while (cur <= endD) {
      const row = this._byDate[cur.toISOString().split('T')[0]];
      if (row && row.temp_avg !== null) {
        total += Math.max(0, row.temp_avg - baseTemp);
        hasAny = true;
      }
      cur.setDate(cur.getDate() + 1);
    }
    return hasAny ? total : null;
  },

  // Season summary for Jul 1 – Oct 31 of given year
  seasonSummary(year) {
    const start = `${year}-07-01`;
    const end   = `${year}-10-31`;
    let gdd          = 0;
    let totalRainfall = 0;
    let sumMax = 0, sumMin = 0, countTemp = 0, hotDays = 0;
    let hasAny = false;
    const cur  = new Date(start);
    const endD = new Date(end);
    while (cur <= endD) {
      const row = this._byDate[cur.toISOString().split('T')[0]];
      if (row) {
        hasAny = true;
        if (row.temp_avg !== null) gdd += Math.max(0, row.temp_avg - 10);
        if (row.rainfall_mm !== null) totalRainfall += row.rainfall_mm;
        if (row.temp_max !== null) { sumMax += row.temp_max; countTemp++; if (row.temp_max > 35) hotDays++; }
        if (row.temp_min !== null) sumMin += row.temp_min;
      }
      cur.setDate(cur.getDate() + 1);
    }
    if (!hasAny) return null;
    return {
      gdd,
      totalRainfall,
      avgTempMax: countTemp ? sumMax / countTemp : null,
      avgTempMin: countTemp ? sumMin / countTemp : null,
      hotDays
    };
  },

  // Normalize M/D/YYYY or YYYY-MM-DD → YYYY-MM-DD
  _toISO(dateStr) {
    if (!dateStr) return '';
    const s = String(dateStr);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const p = s.split('/');
    if (p.length === 3) {
      return `${p[2]}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`;
    }
    return s;
  }
};
