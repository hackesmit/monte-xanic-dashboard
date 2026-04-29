// ── Configuration: Colors, Categories, Mappings ──

export const CONFIG = {
  // Grape type classification
  grapeTypes: {
    red: ['Cabernet Sauvignon','Syrah','Cabernet Franc','Merlot','Tempranillo',
          'Marselan','Grenache','Caladoc','Malbec','Petit Verdot','Durif','Nebbiolo',
          'Mourvèdre'],
    white: ['Sauvignon Blanc','Chardonnay','Viognier','Chenin Blanc']
  },

  // Distinct colors per varietal (vivid, dark-theme friendly, ≥30 ΔE separation)
  varietyColors: {
    'Cabernet Sauvignon': '#DC143C',
    'Syrah':              '#7B2FBE',
    'Cabernet Franc':     '#6366F1',
    'Merlot':             '#EC4899',
    'Tempranillo':        '#F97316',
    'Marselan':           '#BE185D',
    'Grenache':           '#EF4444',
    'Caladoc':            '#A78BFA',
    'Malbec':             '#3B82F6',
    'Petit Verdot':       '#14B8A6',
    'Durif':              '#84CC16',
    'Nebbiolo':           '#F59E0B',
    'Mourvèdre':          '#8B4513',
    'Sauvignon Blanc':    '#4ADE80',
    'Chardonnay':         '#FDE047',
    'Viognier':           '#FB923C',
    'Chenin Blanc':       '#22D3EE'
  },

  // Origin colors (ranch-first format)
  originColors: {
    'Monte Xanic (VDG)':           '#DDB96E',
    'Olé (VDG)':                   '#E07060',
    'Siete Leguas (VDG)':          '#1ABC9C',
    'Rancho 14 (VDG)':             '#E67E22',
    'Kompali (VON)':               '#C4A060',
    'Viña Alta (VON)':             '#60A8C0',
    'Ojos Negros (VON)':           '#7EC87A',
    'Dominio de las Abejas (VON)': '#9B59B6',
    'Dubacano (SV)':               '#3498DB',
    'Llano Colorado (SV)':         '#2ECC71',
    'San Gerónimo':                '#F39C12',
    'Camino Corazón (VP)':         '#C47A5A'
  },

  // Normalize appellation strings (old → new ranch-first format)
  appellationFixes: {
    // Full old format → new ranch-first format
    'Valle de Guadalupe (Monte Xanic)':              'Monte Xanic (VDG)',
    'Valle de Guadalupe (Olé)':                      'Olé (VDG)',
    'Valle de Guadalupe (Ole)':                      'Olé (VDG)',
    'Valle de Guadalupe (Siete Leguas)':             'Siete Leguas (VDG)',
    'Valle de Ojos Negros (Rancho 14)':              'Rancho 14 (VDG)',
    'Valle de Ojos Negros (Kompali)':                'Kompali (VON)',
    'Valle de Ojos Negros (Viña Alta)':              'Viña Alta (VON)',
    'Valle de Ojos Negros (Vina Alta)':              'Viña Alta (VON)',
    'Valle de Ojos Negros (Ojos Negros)':            'Ojos Negros (VON)',
    'Valle de Ojos Negros (Dominio de las Abejas)':  'Dominio de las Abejas (VON)',
    'Valle de Ojos Negros (Dubacano)':               'Dubacano (SV)',
    'Camino Corazón (Valle de Parras)':              'Camino Corazón (VP)',
    'Camino Corazon (Valle de Parras)':              'Camino Corazón (VP)',
    'San Geronimo':                                  'San Gerónimo',
    // Short/bare names that may appear
    'Monte Xanic':           'Monte Xanic (VDG)',
    'Kompali':               'Kompali (VON)',
    'Viña Alta':             'Viña Alta (VON)',
    'Vina Alta':             'Viña Alta (VON)',
    'Olé':                   'Olé (VDG)',
    'Ole':                   'Olé (VDG)',
    'Ojos Negros':           'Ojos Negros (VON)',
    'Dominio de las Abejas': 'Dominio de las Abejas (VON)',
    'Rancho 14':             'Rancho 14 (VDG)',
    'Siete Leguas':          'Siete Leguas (VDG)',
    'Dubacano':              'Dubacano (SV)',
    'Llano Colorado':        'Llano Colorado (SV)',
    'California':            'California'
  },

  // Sample code → ranch mapping for resolving bare valley appellations
  _codeToRanch: {
    'MX': 'Monte Xanic (VDG)', 'VDG': 'Monte Xanic (VDG)',
    'OLE': 'Olé (VDG)', '7L': 'Siete Leguas (VDG)', 'R14': 'Rancho 14 (VDG)',
    'VA': 'Viña Alta (VON)', 'ON': 'Ojos Negros (VON)',
    'DA': 'Dominio de las Abejas (VON)', 'DLA': 'Dominio de las Abejas (VON)',
    'DUB': 'Dubacano (SV)', 'LLC': 'Llano Colorado (SV)',
    'SG': 'San Gerónimo', 'UC': 'Dominio de las Abejas (VON)'
  },
  _resolveRanchFromCode(sampleId) {
    if (!sampleId) return null;
    const id = String(sampleId).replace(/^\d{2}/, ''); // strip vintage prefix
    // K* prefix → Kompali
    if (/^K/i.test(id)) return 'Kompali (VON)';
    // Try known code prefixes (longest first)
    const prefixes = ['DLA','DUB','LLC','OLE','VDG','MX','VA','ON','DA','7L','R14','SG','UC'];
    for (const p of prefixes) {
      if (id.toUpperCase().startsWith(p)) return this._codeToRanch[p] || null;
    }
    // Try extracting ranch code from after variety abbreviation (e.g., 25CFVA-2B → VA)
    const m = id.match(/^[A-Z]{2,3}(MX|VDG|OLE|7L|R14|VA|ON|DA|DLA|DUB|LLC|SG|UC)/i);
    if (m) return this._codeToRanch[m[1].toUpperCase()] || null;
    return null;
  },

  normalizeAppellation(name, sampleId) {
    if (!name) return name;
    // Fix mojibake/replacement characters (U+FFFD from encoding errors in DB)
    let fixed = name;
    if (fixed.includes('\uFFFD')) {
      fixed = fixed
        .replace('Vi\uFFFDa', 'Viña').replace('Ol\uFFFD', 'Olé')
        .replace('Ger\uFFFDnimo', 'Gerónimo').replace('Coraz\uFFFDn', 'Corazón');
      // Strip any remaining replacement characters as last resort
      fixed = fixed.replace(/\uFFFD/g, '');
    }
    // Also fix double-encoded UTF-8 mojibake (ñ as Ã±, é as Ã©, etc.)
    if (fixed.includes('\u00C3')) {
      fixed = fixed
        .replace(/\u00C3\u00B1/g, 'ñ').replace(/\u00C3\u00A9/g, 'é')
        .replace(/\u00C3\u00B3/g, 'ó').replace(/\u00C3\u00AD/g, 'í')
        .replace(/\u00C3\u00BA/g, 'ú').replace(/\u00C3\u0091/g, 'Ñ');
    }
    // Check direct mapping
    if (this.appellationFixes[fixed]) return this.appellationFixes[fixed];
    // Bare valley names → resolve from sample code
    if (/^Valle de Guadalupe$/i.test(fixed) || /^Valle de Ojos Negros$/i.test(fixed)) {
      const resolved = this._resolveRanchFromCode(sampleId);
      if (resolved) return resolved;
      // Fallback: VDG → Monte Xanic, VON → Ojos Negros
      return /Guadalupe/i.test(fixed) ? 'Monte Xanic (VDG)' : 'Ojos Negros (VON)';
    }
    return fixed;
  },

  // Resolve origin color: direct lookup or hash fallback
  _originColorCache: {},
  resolveOriginColor(name) {
    if (!name) return '#888888';
    if (this._originColorCache[name]) return this._originColorCache[name];
    const c = this.originColors[name] || this._hashColor(name);
    this._originColorCache[name] = c;
    return c;
  },
  _hashColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    // Return hex (not HSL) so appending alpha suffixes like + 'AA' works
    const hue = ((h % 360) + 360) % 360;
    const s = 0.6, l = 0.55;
    const a = s * Math.min(l, 1 - l);
    const f = n => { const k = (n + hue / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    const toHex = x => Math.round(x * 255).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
  },

  // Varietal abbreviations (code → full name)
  varietyAbbr: {
    'CS':'Cabernet Sauvignon','CF':'Cabernet Franc','SY':'Syrah','ME':'Merlot',
    'MA':'Malbec','GRE':'Grenache','GR':'Grenache','PV':'Petit Verdot',
    'TE':'Tempranillo','TEM':'Tempranillo','CA':'Caladoc','CAL':'Caladoc',
    'MS':'Marselan','MRS':'Marselan','DU':'Durif','NB':'Nebbiolo','SB':'Sauvignon Blanc',
    'CH':'Chardonnay','VG':'Viognier','CB':'Chenin Blanc','MV':'Mourvèdre','PS':'Durif'
  },

  normalizeVariety(name) {
    if (name === 'Petite Sirah') return 'Durif';
    return name;
  },

  // Origin abbreviations (code → full name)
  originAbbr: {
    'MX':'Monte Xanic (VDG)','VDG':'Monte Xanic (VDG)',
    'VA':'Viña Alta (VON)','ON':'Ojos Negros (VON)','OLE':'Olé (VDG)',
    'DUB':'Dubacano (SV)','LLC':'Llano Colorado (SV)',
    'DA':'Dominio de las Abejas (VON)','DLA':'Dominio de las Abejas (VON)',
    '7L':'Siete Leguas (VDG)','KMP':'Kompali (VON)','R14':'Rancho 14 (VDG)',
    'SG':'San Gerónimo','UC':'Dominio de las Abejas (VON)'
  },

  // Berry → Wine lot mappings (from presentation)
  berryToWine: {
    // Caladoc
    'CALMX-1E':      ['25CAVDG-1'],
    'KCA-S3B':       ['25CAKMP-1','25CAKMP-2'],
    'KCA-S4':        ['25CAKMP-1','25CAKMP-2'],
    // Cabernet Franc
    'KCF-S1-PA':     ['25CFKMP-1'],
    'KCF-S1-PB':     ['25CFKMP-2'],
    'CFVA-2B':       ['25CFVA-1'],
    'CFVA-5A':       ['25CFVA-2'],
    'CFVA-5B':       ['25CFVA-2'],
    'CFVA-2B-RALEO': ['25CFVA-3'],
    // Merlot
    'MEVA-1A':       ['25MEVA-1'],
    'MEVA-2A':       ['25MEVA-2'],
    'KME-S6-2':      ['25MEKMP-1','25MEKMP-2'],
    'KME-S6-1':      ['25MEKMP-3'],
    'MEON-1':        ['25MEON-1'],
    // Syrah
    'SY7L-2':        ['25SY7L-1','25SY7L-2'],
    'SYVA-1D,2C,3C,4C': ['25SYVA-1'],
    'SYVA-1E,2D,3D,4D': ['25SYVA-2'],
    'SYVA-1B':       ['25SYVA-3'],
    'KSY-S723':      ['25SYKMP-1'],
    'KSY-S721':      ['25SYKMP-2','25SYKMP-4'],
    'KSY-S721-R':    ['25SYKMP-3'],
    'SYON-4':        ['25SYON-1','25SYON-2'],
    'SYDA-L13,14':   ['25SYDLA'],
    'SYDA-L5':       ['25SYDLA'],
    // Malbec
    'MADUB-1':       ['25MADUB-1','25MADUB-2'],
    'SYDUB-1':       ['25MADUB-1','25MADUB-2'],
    'MAON-2':        ['25MAON-1'],
    'KMA-S7':        ['25MAKMP-1'],
    // Tempranillo
    'TEON-5':        ['25TEON-1','25TEON-2'],
    'KTE-S1':        ['25TEKMP-2','25TEKMP-3','25TEKMP-4'],
    'KTE-S1-R':      ['25TEKMP-5'],
    // Marselan
    'KMS-S5A+':      ['25MRSKMP-3'],
    'KMS-S5B-':      ['25MRSKMP-4'],
    'KMS-S5B-R':     ['25MRSKMP-5'],
    // Cabernet Sauvignon
    'CSMX-5B':       ['25CSVDG-1'],
    'CSMX-11A':      ['25CSVDG-2'],
    'CSMX-7B':       ['25CSVDG-4'],
    'KCS-S8-1-CONT': ['25CSKMP-1'],
    'KCS-S2A':       ['25CSKMP-4'],
    'KCS-S2B':       ['25CSKMP-6'],
    'CSON-3':        ['25CSON-2'],
    // Durif
    'KDU-S2B':       ['25DUKMP-1','25DUKMP-2'],
    'KDU-S7':        ['25DUKMP-3'],
    // Petit Verdot
    'KPV-S3A':       ['25PVKMP-1'],
    'PVVA-1C':       ['25PVVA-1']
  },

  // Vintage comparison: matchable plots between 2024 and 2025
  vintageMatchPlots: [
    'CFVA-2B','CFVA-5A','CFVA-5B','CSOLE-1','CSOLE-2','CSOLE-3',
    'CSON-3','GREON-6','GREVA-3B','GREVA-4A','GREVA-4B',
    'MAON-2','MEON-1','SYON-4','SYVA-1B','SYVA-1E','TEON-5'
  ],

  // Samples to exclude from all views
  _excludedSamples: new Set(['24ROSEMX-5', '24CABERNETMERLOT-1', '25ROSEMX-1']),
  _excludeRe: /EXP|EXPERIMENTO|^NORMAL$/i,
  _labTestRe: /\b(COLORPRO|CRUSH|WATER|BLUEBERRY|RASPBERRY|RASBERRY|BLKBERRY|BLACKBERRY)\b/i,

  isSampleExcluded(sampleId) {
    if (!sampleId) return false;
    return this._excludedSamples.has(sampleId) || this._excludeRe.test(sampleId) || this._labTestRe.test(sampleId);
  },

  // Valley coordinates for weather
  valleyCoordinates: {
    VDG: { lat: 32.08, lon: -116.62 },
    VON: { lat: 32.00, lon: -116.25 },
    SV:  { lat: 32.05, lon: -116.45 }
  },

  // Extract valley abbreviation from ranch-first appellation
  getWeatherValley(appellation) {
    if (!appellation) return 'VDG';
    const m = appellation.match(/\(([A-Z]{2,3})\)$/);
    if (m) {
      const key = m[1];
      if (key === 'VDG' || key === 'VON' || key === 'SV') return key;
      if (key === 'VP') return 'VDG'; // fallback
    }
    if (/San Ger[oó]nimo/i.test(appellation)) return 'VDG'; // no berry weather needed
    return 'VDG';
  },

  // Berry data column mappings (Excel → internal)
  berryColumns: {
    'Sample Id':              'sampleId',
    'Sample Date':            'sampleDate',
    'Vintage':                'vintage',
    'Variety':                'variety',
    'Appellation':            'appellation',
    'CrushDate (yyyy-mm-dd)': 'crushDate',
    'DaysPostCrush (number)': 'daysPostCrush',
    'Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)': 'brix',
    'pH (pH units)':          'pH',
    'Titratable Acidity (TA gr/l)': 'ta',
    'tANT (ppm ME)':          'tANT',
    'Number Of Berries In Sample (number)': 'berryCount',
    'Weight Of Berries In Sample (gr)':     'berryWeight',
    'Berry Fresh Weight (gr)':              'berryFW',
    'L*':                     'colorL',
    'a*':                     'colorA',
    'b*':                     'colorB',
    'I':                      'colorI',
    'T':                      'colorT',
    'Sample Type':            'sampleType',
    'Notes...':               'notes'
  },

  // Wine/tank reception column mappings
  wineColumns: {
    'Reporte':           'reporte',
    'Fecha':             'fecha',
    'Lote de viñedo 1':  'loteVinedo1',
    'Lote de viñedo 2':  'loteVinedo2',
    'Lote de viñedo 3':  'loteVinedo3',
    'Lote de viñedo 4':  'loteVinedo4',
    'Código (lote de bodega)': 'codigoBodega',
    'Tanque':            'tanque',
    'Proveedor':         'proveedor',
    'Variedad':          'variedad',
    '°Brix':             'brix',
    'pH':                'pH',
    'A.T.':              'at',
    'A.G.':              'ag',
    'A.M.':              'am',
    'A.V.':              'av',
    'SO2L':              'so2l',
    'NFA':               'nfa',
    '°Temp':             'temp',
    '%Sólidos':          'solidos',
    'Polifenoles WX (FFA)':  'polifWX',
    'Antocianinas WX (FFA)': 'antoWX',
    'Poli SPICA':        'poliSpica',
    'Anto SPICA':        'antoSpica',
    'IPT SPICA':         'iptSpica'
  },

  // WineXRay → internal wine field mappings (for wine-type samples from WineXRay CSV)
  wineXRayColumns: {
    'Sample Id':              'codigoBodega',
    'Sample Date':            'fecha',
    'Vessel Id':              'tanque',
    'Variety':                'variedad',
    'Appellation':            'proveedor',
    'Sample Type':            'sampleType',
    'Vintage':                'vintage',
    'DaysPostCrush (number)': 'daysPostCrush',
    'CrushDate (yyyy-mm-dd)': 'crushDate',
    'tANT (ppm ME)':          'antoWX',
    'fANT (ppm ME)':          'freeANT',
    'bANT (ppm ME)':          'boundANT',
    'pTAN (ppm CE)':          'pTAN',
    'iRPs (ppm CE)':          'iRPs',
    'Total Phenolics Index (IPT, d-less)': 'iptSpica',
    'Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)': 'brix',
    'pH (pH units)':          'pH',
    'Titratable Acidity (TA gr/l)': 'at',
    'L*':                     'colorL',
    'a*':                     'colorA',
    'b*':                     'colorB',
    'I':                      'colorI',
    'T':                      'colorT',
    'Notes...':               'notes'
  },

  // Chart defaults
  chartDefaults: {
    pointRadius: 4,
    pointHoverRadius: 7,
    borderWidth: 2,
    tension: 0.3,
    gridColor: 'rgba(255,255,255,0.05)',
    tickColor: '#4A4A4A'
  },

  // Point shapes per origin (Chart.js point styles)
  originPointStyles: {
    'Kompali (VON)':               'circle',
    'Viña Alta (VON)':             'triangle',
    'Olé (VDG)':                   'rect',
    'Ojos Negros (VON)':           'rectRounded',
    'Monte Xanic (VDG)':           'star',
    'Dominio de las Abejas (VON)': 'crossRot',
    'Rancho 14 (VDG)':             'rectRot',
    'Siete Leguas (VDG)':          'cross',
    'Dubacano (SV)':               'dash',
    'Llano Colorado (SV)':         'circle',
    'San Gerónimo':                'triangle',
    'Camino Corazón (VP)':         'rect'
  },

  // ── Supabase Column Mappings ──────────────────────────────────

  // WineXRay CSV/XLSX column headers → wine_samples table columns (used by upload.js)
  wxToSupabase: {
    'Sample Id':              'sample_id',
    'Vessel Id':              'vessel_id',
    'Sample Type':            'sample_type',
    'Sample Date':            'sample_date',
    'CrushDate (yyyy-mm-dd)': 'crush_date',
    'DaysPostCrush (number)': 'days_post_crush',
    'Vintage':                'vintage_year',
    'Variety':                'variety',
    'Appellation':            'appellation',
    'tANT (ppm ME)':          'tant',
    'fANT (ppm ME)':          'fant',
    'bANT (ppm ME)':          'bant',
    'pTAN (ppm CE)':          'ptan',
    'iRPs (ppm CE)':          'irps',
    'Total Phenolics Index (IPT, d-less)': 'ipt',
    'Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)': 'brix',
    'pH (pH units)':          'ph',
    'Titratable Acidity (TA gr/l)': 'ta',
    'L*':                     'l_star',
    'a*':                     'a_star',
    'b*':                     'b_star',
    'I':                      'color_i',
    'T':                      'color_t',
    'Berry Fresh Weight (gr)': 'berry_weight',
    'Berry Extractable Anthocyanins (mg/100b)': 'berry_anthocyanins',
    'Berry (extractable) Anthocyanins (mg/100b me)': 'berry_anthocyanins',
    'Berry Sugars (mg/b)':    'berry_sugars_mg',
    'Alcohol (% vol)':        'alcohol',
    'Alcohol (% v/v)':        'alcohol',
    'Volatile Acidity (g/L)': 'va',
    'Volatile Acidity (VA gr/l)': 'va',
    'Malic Acid (g/L)':       'malic_acid',
    'Malic Acid (TM gr/l)':   'malic_acid',
    'Residual Sugars (g/L)':  'rs',
    'Residual Sugars (RS gr/l)': 'rs',
    'Notes...':               'notes'
  },

  // Recepción Excel column headers → tank_receptions columns
  // Lot columns use _lot1.._lot4 as temp keys; upload.js strips them before insert
  recepcionToSupabase: {
    'Reporte':                   'report_code',
    'Fecha':                     'reception_date',
    'Lote de viñedo 1':          '_lot1',
    'Lote de viñedo 2':          '_lot2',
    'Lote de viñedo 3':          '_lot3',
    'Lote de viñedo 4':          '_lot4',
    'Código (lote de bodega)':   'batch_code',
    'Tanque':                    'tank_id',
    'Proveedor':                 'supplier',
    'Variedad':                  'variety',
    '°Brix':                     'brix',
    'pH':                        'ph',
    'A.T.':                      'ta',
    'A.G.':                      'ag',
    'A.M.':                      'am',
    'A.V.':                      'av',
    'SO2L':                      'so2',
    'NFA':                       'nfa',
    '°Temp':                     'temperature',
    '%Sólidos':                  'solidos_pct',
    'Polifenoles WX (FFA)':      'polifenoles_wx',
    'Antocianinas WX (FFA)':     'antocianinas_wx',
    'Poli SPICA':                'poli_spica',
    'Anto SPICA':                'anto_spica',
    'IPT SPICA':                 'ipt_spica',
    'Acidificado':               'acidificado',
    'P010 (kg)':                 'p010_kg'
  },

  // Prefermentativos Excel column headers → prefermentativos columns
  prefermentToSupabase: {
    'Reporte':                   'report_code',
    'Fecha':                     'measurement_date',
    'Código (lote de bodega)':   'batch_code',
    'Tanque':                    'tank_id',
    'Variedad':                  'variety',
    '°Brix':                     'brix',
    'pH':                        'ph',
    'A.T.':                      'ta',
    '°Temp':                     'temperature',
    'Antocianinas WX (FFA)':     'tant',
    'tANT':                      'tant',
    'Notas':                     'notes',
    'Notes...':                  'notes'
  },

  // ── Sample Type routing for WineXRay ─────────────────────────────
  // Maps the "Sample Type" column value to its destination table.
  // Anything not in this map is rejected by the WineXRay parser.
  sampleTypeRouting: {
    'Berries':      'berry_samples',
    'Must':         'wine_samples',
    'Young Wine':   'wine_samples',
    'Aging Wine':   'wine_samples',
    'Bottled Wine': 'wine_samples',
    'Control Wine': 'skip',
  },

  // ── WineXRay CSV headers → berry_samples columns ─────────────────
  // Used by js/upload/winexray.js for rows where Sample Type = 'Berries'.
  // Includes morphology, per-berry composition, and phenolics/color
  // measured on the extracted juice.
  wxToBerry: {
    'Sample Id':              'sample_id',
    'Sample Type':            'sample_type',
    'Sample Date':            'sample_date',
    'CrushDate (yyyy-mm-dd)': 'crush_date',
    'DaysPostCrush (number)': 'days_post_crush',
    'Vintage':                'vintage_year',
    'Variety':                'variety',
    'Appellation':            'appellation',
    'Batch Id':               'batch_id',
    'Notes...':               'notes',

    // morphology
    'Number Of Berries In Sample (number)':  'berry_count',
    'Weight Of Berries In Sample (gr)':      'berries_weight_g',
    'Volume Of Extracted Juice (milliliters)': 'extracted_juice_ml',
    'Weight Of Extracted Juice (gr)':        'extracted_juice_g',
    'Volume Of Extracted Phenolics (milliliters)': 'extracted_phenolics_ml',
    'Berry Fresh Weight (gr)':               'berry_fresh_weight_g',
    'Berry (extractable) Anthocyanins (mg/100b me)': 'berry_anthocyanins_mg_100b',
    'Berry Extractable Anthocyanins (mg/100b)':      'berry_anthocyanins_mg_100b',

    // per-berry composition (mg/berry)
    'Berry Sugars (mg/b)':        'berry_sugars_mg',
    'Berry Acids (mg/b)':         'berry_acids_mg',
    'Berry Water (mg/b)':         'berry_water_mg',
    'Berry Skins & Seeds (mg/b)': 'berry_skins_seeds_mg',

    // per-berry composition (weight %)
    'Berry Sugars (wt.%)':        'berry_sugars_pct',
    'Berry Acids (wt.%)':         'berry_acids_pct',
    'Berry Water (wt.%)':         'berry_water_pct',
    'Berry Skins & Seeds (wt.%)': 'berry_skins_seeds_pct',

    // per-berry composition (grams)
    'Berry Sugars (gr)':        'berry_sugars_g',
    'Berry Acids (gr)':         'berry_acids_g',
    'Berry Water (gr)':         'berry_water_g',
    'Berry Skins & Seeds (gr)': 'berry_skins_seeds_g',

    // phenolics/color measured on extracted juice
    'Total Phenolics Index (IPT, d-less)': 'ipt',
    'tANT (ppm ME)':                       'tant',
    'fANT (ppm ME)':                       'fant',
    'bANT (ppm ME)':                       'bant',
    'pTAN (ppm CE)':                       'ptan',
    'iRPs (ppm CE)':                       'irps',
    'L*':                                  'l_star',
    'a*':                                  'a_star',
    'b*':                                  'b_star',
    'I':                                   'color_i',
    'T':                                   'color_t',
    'Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)': 'brix',
    'pH (pH units)':                       'ph',
    'Titratable Acidity (TA gr/l)':        'ta',
  },

  // ── Pre-recepción XLSX headers → mediciones_tecnicas columns ─────
  // Used by js/upload/prerecepcion.js. Round 35 unified pre_receptions
  // into mediciones_tecnicas — uploads now land in the same canonical
  // table as the form, distinguished by source='upload' vs source='form'.
  // Note: 'Longitud promedio de 10 bayas (cm)' is deliberately not
  // mapped; the per-baya average carries the same info.
  preReceptionsToSupabase: {
    'Vintrace':                              'vintrace',
    'No. Reporte':                           'medicion_code',
    'Fecha recepción de uva':                'reception_date',
    'Fecha medición técnica':                'medicion_date',
    'Total':                                 'total_bins',
    'Bins/Jabas':                            'bin_unit',
    'Toneladas totales':                     'tons_received',
    'Proveedor':                             'supplier',
    'Variedad':                              'variety',
    'Lote de campo':                         'lot_code',
    'Temperatura de bins/jabas (°C)':        'bin_temp_c',
    'Temperatura de camión (°C)':            'truck_temp_c',
    'Peso promedio racimos (g)':             'bunch_avg_weight_g',
    'Longitud promedio por baya (cm)':       'berry_length_avg_cm',
    'Peso de 200 bayas (g)':                 'berries_200_weight_g',
    'Peso promedio por baya (g)':            'berry_avg_weight_g',
    'Bayas con picadura':                    'health_picadura',
    'Bayas con enfermedades':                'health_enfermedad',
    'Bayas inmaduras':                       'health_inmadura',
    'Bayas Maduras':                         'health_madura',
    'Bayas sobremaduras':                    'health_sobremadura',
    'Bayas pasificadas':                     'health_pasificada',
    'Bayas aceptables':                      'health_aceptable',
    'Bayas No aceptables':                   'health_no_aceptable',
    'Fecha análisis laboratorio':            'lab_date',
    '°Brix':                                 'brix',
    'pH':                                    'ph',
    'AT (g/L)':                              'at',
    'AG (g/L)':                              'ag',
    'AM (g/L)':                              'am',
    'Polifenoles (mg/L)':                    'polifenoles',
    'Catequinas (mg/L)':                     'catequinas',
    'Antocianos (mg/L)':                     'antocianos',
  },

  // wine_samples Supabase columns → DataStore.berryData JS field names
  supabaseToBerryJS: {
    'sample_id':       'sampleId',
    'sample_date':     'sampleDate',
    'vintage_year':    'vintage',
    'variety':         'variety',
    'appellation':     'appellation',
    'crush_date':      'crushDate',
    'days_post_crush': 'daysPostCrush',
    'tant':            'tANT',
    'ph':              'pH',
    'ta':              'ta',
    'brix':            'brix',
    'berry_weight':    'berryFW',
    'berry_anthocyanins': 'anthocyanins',
    'l_star':          'colorL',
    'a_star':          'colorA',
    'b_star':          'colorB',
    'color_i':         'colorI',
    'color_t':         'colorT',
    'sample_type':     'sampleType',
    'vessel_id':       'tanque',
    'notes':           'notes',
    'below_detection': 'belowDetection',
    'sample_seq':      'sampleSeq'
  },

  // wine_samples Supabase columns → DataStore.wineRecepcion JS field names
  supabaseToWineJS: {
    'sample_id':       'codigoBodega',
    'sample_date':     'fecha',
    'vessel_id':       'tanque',
    'variety':         'variedad',
    'appellation':     'proveedor',
    'sample_type':     'sampleType',
    'vintage_year':    'vintage',
    'days_post_crush': 'daysPostCrush',
    'crush_date':      'crushDate',
    'tant':            'antoWX',
    'fant':            'freeANT',
    'bant':            'boundANT',
    'ptan':            'pTAN',
    'irps':            'iRPs',
    'ipt':             'iptSpica',
    'ph':              'pH',
    'ta':              'at',
    'brix':            'brix',
    'l_star':          'colorL',
    'a_star':          'colorA',
    'b_star':          'colorB',
    'color_i':         'colorI',
    'color_t':         'colorT',
    'notes':           'notes'
  },

  // prefermentativos Supabase columns → DataStore.winePreferment JS field names
  supabasePrefToWineJS: {
    'report_code':      'reportCode',
    'measurement_date': 'fecha',
    'batch_code':       'codigoBodega',
    'tank_id':          'tanque',
    'variety':          'variedad',
    'brix':             'brix',
    'ph':               'pH',
    'ta':               'at',
    'temperature':      'temp',
    'tant':             'antoWX',
    'notes':            'notes'
  },

  // ── Explorer Metric Registry ──────────────────────────────────
  explorerMetrics: {
    berry: {
      daysPostCrush: { label: 'Dias Post-Envero', unit: 'dias' },
      brix:          { label: 'Brix', unit: '°Bx' },
      pH:            { label: 'pH', unit: '' },
      ta:            { label: 'Acidez Total', unit: 'g/L' },
      tANT:          { label: 'tANT', unit: 'ppm ME' },
      fANT:          { label: 'fANT', unit: 'ppm ME' },
      bANT:          { label: 'bANT', unit: 'ppm ME' },
      pTAN:          { label: 'pTAN', unit: 'ppm CE' },
      iRPs:          { label: 'iRPs', unit: 'ppm CE' },
      IPT:           { label: 'IPT', unit: '' },
      berryFW:       { label: 'Peso Baya', unit: 'g' },
      berryAnt:      { label: 'ANT Extraibles', unit: 'mg/100b' },
      berrySugars:   { label: 'Azucares Baya', unit: 'mg/b' },
      alcohol:       { label: 'Alcohol', unit: '% v/v' },
      va:            { label: 'Acidez Volatil', unit: 'g/L' },
      malic_acid:    { label: 'Acido Malico', unit: 'g/L' },
      rs:            { label: 'Azucar Residual', unit: 'g/L' },
      colorL:        { label: 'Color L*', unit: '' },
      colorA:        { label: 'Color a*', unit: '' },
      colorB:        { label: 'Color b*', unit: '' },
      maturityIndex:     { label: 'Indice de Madurez', unit: 'Brix/AT', derived: true },
      gdd:               { label: 'GDD Acumulados', unit: '°C·dia', derived: true },
      antExtractability: { label: 'Extractabilidad ANT', unit: '%', derived: true }
    },
    wine: {
      daysPostCrush: { label: 'Dias Post-Envero', unit: 'dias' },
      brix:          { label: 'Brix', unit: '°Bx' },
      pH:            { label: 'pH', unit: '' },
      at:            { label: 'Acidez Total', unit: 'g/L' },
      antoWX:        { label: 'tANT', unit: 'ppm ME' },
      freeANT:       { label: 'fANT', unit: 'ppm ME' },
      boundANT:      { label: 'bANT', unit: 'ppm ME' },
      pTAN:          { label: 'pTAN', unit: 'ppm CE' },
      iRPs:          { label: 'iRPs', unit: 'ppm CE' },
      iptSpica:      { label: 'IPT', unit: '' }
    }
  },

  // ── Map CONFIG ──────────────────────────────────────

  // Explicit lot code → section ID (override pattern-based resolution)
  fieldLotToSection: {
    // Monte Xanic (MX) — known berry lot codes
    'CALMX-1E':  'MX-1E',
    'CSMX-5B':   'MX-5B',  'CSMX-7B':  'MX-7B',  'CSMX-11A': 'MX-11A',
    // Kompali (K) — known berry lot codes
    'KCA-S3B':       'K-S3B',  'KCA-S4':        'K-S4',
    'KCF-S1-PA':     'K-S1',   'KCF-S1-PB':     'K-S1',
    'KME-S6-1':      'K-S6',   'KME-S6-2':      'K-S6',
    'KSY-S723':      'K-S7',   'KSY-S721':      'K-S7',   'KSY-S721-R': 'K-S7',
    'KCS-S8-1-CONT': 'K-S8',   'KCS-S8-1':      'K-S8',
    'KCS-S2A':       'K-S2A',  'KCS-S2B':       'K-S2B',
    'KDU-S2B':       'K-S2B',  'KDU-S7':        'K-S7',
    'KMA-S7':        'K-S7',
    'KMS-S5A+':      'K-S5',   'KMS-S5B-':      'K-S5',   'KMS-S5B-R': 'K-S5',
    'KTE-S1':        'K-S1',   'KTE-S1-R':      'K-S1',
    'KPV-S3A':       'K-S3A',
    // Viña Alta (VA)
    'CFVA-2B':   'VA-2B',  'CFVA-5A':  'VA-5A',  'CFVA-5B': 'VA-5B',
    'CFVA-2B-RALEO': 'VA-2B',
    'MEVA-1A':   'VA-1A',  'MEVA-2A':  'VA-2A',
    'SYVA-1D':   'VA-1D',  'SYVA-1E':  'VA-1E',  'SYVA-1B': 'VA-1B',
    'PVVA-1C':   'VA-1C',
    'GREVA-3B':  'VA-3B',  'GREVA-4A': 'VA-4A',  'GREVA-4B': 'VA-4B',
    // Ojos Negros (ON)
    'CSON-3':    'ON-3',   'SYON-4':   'ON-4',   'MEON-1':  'ON-1',
    'MAON-2':    'ON-2',   'GREON-6':  'ON-6',   'TEON-5':  'ON-5',
    // Siete Leguas (7L)
    'SY7L-2':    '7L-2',
    // Olé (OLE)
    'CSOLE-1':   'OLE-1',  'CSOLE-2':  'OLE-2',  'CSOLE-3': 'OLE-3',
    // Dubacano (DUB)
    'MADUB-1':   'DUB-1',  'SYDUB-1':  'DUB-1',
    // Dominio de las Abejas (DA)
    'SYDA-L13,14': 'DA-L13', 'SYDA-L5': 'DA-L5'
  },

  // Pattern-based lot → section resolution (fallback)
  fieldLotRanchPatterns: [
    { regex: /^K[A-Z]{2,3}-(.+)$/i,           prefix: 'K' },
    { regex: /^[A-Z]{2,4}MX-(.+)$/i,          prefix: 'MX' },
    { regex: /^[A-Z]{2,4}VA-(.+)$/i,          prefix: 'VA' },
    { regex: /^[A-Z]{2,4}ON-(.+)$/i,          prefix: 'ON' },
    { regex: /^[A-Z]{2,4}OLE-(.+)$/i,         prefix: 'OLE' },
    { regex: /^[A-Z]{2,4}7L-(.+)$/i,          prefix: '7L' },
    { regex: /^[A-Z]{2,4}DUB-(.+)$/i,         prefix: 'DUB' },
    { regex: /^[A-Z]{2,4}DA-(.+)$/i,          prefix: 'DA' },
    { regex: /^[A-Z]{2,4}DLA-(.+)$/i,         prefix: 'DA' },
    { regex: /^[A-Z]{2,4}KMP-(.+)$/i,         prefix: 'K' },
    { regex: /^[A-Z]{2,4}R14-(.+)$/i,         prefix: 'R14' },
    { regex: /^[A-Z]{2,4}LLC-(.+)$/i,         prefix: 'LLC' },
    { regex: /^[A-Z]{2,4}SG-(.+)$/i,          prefix: 'SG' }
  ],

  // Color scale config per map metric
  mapMetrics: {
    brix: { label: 'Brix (°Bx)', min: 18, max: 28, stops: ['#2ecc71', '#f1c40f', '#e74c3c'] },
    pH:   { label: 'pH',         min: 3.0, max: 4.0, stops: ['#3498db', '#2ecc71', '#e74c3c'] },
    tANT: { label: 'tANT (ppm)', min: 0,   max: 2000, stops: ['#f0e68c', '#e74c3c', '#800020'] },
    ta:   { label: 'A.T. (g/L)', min: 3.0, max: 9.0, stops: ['#e74c3c', '#2ecc71', '#3498db'] }
  },

  // SVG viewBox dimensions per ranch
  ranchViewBoxes: {
    MX:    { width: 600, height: 500 },
    K:     { width: 460, height: 680 },
    '7L':  { width: 400, height: 200 },
    OLE:   { width: 400, height: 260 },
    ON:    { width: 480, height: 420 },
    VA:    { width: 500, height: 480 },
    DUB:   { width: 200, height: 120 },
    DA:    { width: 260, height: 200 }
  },

  // Vineyard section definitions (with polygon points for SVG rendering)
  vineyardSections: [
    // ── Monte Xanic (VDG) — MX ──
    // Layout: CS sections on the left (irregular western hillside), SB sections on the right (grid)
    // ViewBox: 600 × 500. West = CS irregular shapes, East = SB rectangular grid
    { sectionId: 'MX-1A', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '1A', hectares: 2.02, ranch: 'Monte Xanic (VDG)',
      points: [[460,410],[540,410],[540,480],[460,480]] },
    { sectionId: 'MX-1B', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '1B', hectares: 2.0, ranch: 'Monte Xanic (VDG)',
      points: [[460,330],[540,330],[540,405],[460,405]] },
    { sectionId: 'MX-1C', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '1C', hectares: 2.02, ranch: 'Monte Xanic (VDG)',
      points: [[460,250],[540,250],[540,325],[460,325]] },
    { sectionId: 'MX-1D', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '1D', hectares: 2.02, ranch: 'Monte Xanic (VDG)',
      points: [[460,170],[540,170],[540,245],[460,245]] },
    { sectionId: 'MX-1E', ranchCode: 'MX', variety: 'Caladoc',         sectionLabel: '1E', hectares: null, ranch: 'Monte Xanic (VDG)',
      points: [[460,60],[590,60],[590,165],[460,165]] },
    { sectionId: 'MX-2A', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '2A', hectares: 2.17, ranch: 'Monte Xanic (VDG)',
      points: [[370,410],[455,410],[455,480],[370,480]] },
    { sectionId: 'MX-2B', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '2B', hectares: 2.42, ranch: 'Monte Xanic (VDG)',
      points: [[370,330],[455,330],[455,405],[370,405]] },
    { sectionId: 'MX-2C', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '2C', hectares: 2.01, ranch: 'Monte Xanic (VDG)',
      points: [[370,250],[455,250],[455,325],[370,325]] },
    { sectionId: 'MX-3A', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '3A', hectares: 2.17, ranch: 'Monte Xanic (VDG)',
      points: [[290,410],[365,410],[365,480],[290,480]] },
    { sectionId: 'MX-3B', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '3B', hectares: 1.56, ranch: 'Monte Xanic (VDG)',
      points: [[290,330],[365,330],[365,405],[290,405]] },
    { sectionId: 'MX-4A', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '4A', hectares: 1.37, ranch: 'Monte Xanic (VDG)',
      points: [[290,268],[365,268],[365,325],[290,325]] },
    { sectionId: 'MX-4B', ranchCode: 'MX', variety: 'Sauvignon Blanc', sectionLabel: '4B', hectares: 1.73, ranch: 'Monte Xanic (VDG)',
      points: [[290,200],[365,200],[365,263],[290,263]] },
    { sectionId: 'MX-5A', ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '5A', hectares: 1.6, ranch: 'Monte Xanic (VDG)',
      points: [[200,390],[285,390],[285,480],[200,480]] },
    { sectionId: 'MX-5B', ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '5B', hectares: 1.99, ranch: 'Monte Xanic (VDG)',
      points: [[200,300],[285,300],[285,385],[200,385]] },
    { sectionId: 'MX-5C', ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '5C', hectares: 0.77, ranch: 'Monte Xanic (VDG)',
      points: [[250,225],[325,225],[325,265],[250,265]] },
    { sectionId: 'MX-6',  ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '6',  hectares: null, ranch: 'Monte Xanic (VDG)',
      points: [[200,225],[245,225],[245,295],[200,295]] },
    { sectionId: 'MX-7A', ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '7A', hectares: 1.94, ranch: 'Monte Xanic (VDG)',
      points: [[120,340],[195,340],[195,420],[120,420]] },
    { sectionId: 'MX-7B', ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '7B', hectares: 1.01, ranch: 'Monte Xanic (VDG)',
      points: [[140,270],[195,270],[195,335],[140,335]] },
    { sectionId: 'MX-8',  ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '8',  hectares: 1.01, ranch: 'Monte Xanic (VDG)',
      points: [[100,190],[180,190],[195,265],[130,265]] },
    { sectionId: 'MX-9',  ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '9',  hectares: 1.45, ranch: 'Monte Xanic (VDG)',
      points: [[60,380],[115,370],[120,440],[50,460]] },
    { sectionId: 'MX-10', ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '10', hectares: 1.49, ranch: 'Monte Xanic (VDG)',
      points: [[10,420],[55,400],[60,480],[15,490]] },
    { sectionId: 'MX-11A',ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '11A',hectares: 1.29, ranch: 'Monte Xanic (VDG)',
      points: [[110,120],[195,120],[195,185],[100,185]] },
    { sectionId: 'MX-11B',ranchCode: 'MX', variety: 'Cabernet Sauvignon', sectionLabel: '11B',hectares: 0.29, ranch: 'Monte Xanic (VDG)',
      points: [[140,80],[195,80],[195,115],[120,115]] },
    { sectionId: 'MX-12', ranchCode: 'MX', variety: 'Plantas Madre', sectionLabel: '12', hectares: null, ranch: 'Monte Xanic (VDG)',
      points: [[80,30],[180,20],[190,75],[100,80]] },

    // ── Kompali (VON) — K ──
    // Layout: north-south strip, upper zone (S1-S4) and lower zone (S5-S8) split by arroyo
    // ViewBox: 460 × 680
    { sectionId: 'K-S1',  ranchCode: 'K', variety: 'Cab. Franc / Temp.', sectionLabel: 'S1',  hectares: null, ranch: 'Kompali (VON)',
      points: [[20,10],[440,10],[440,80],[20,80]] },
    { sectionId: 'K-S2A', ranchCode: 'K', variety: 'Cabernet Sauvignon', sectionLabel: 'S2A', hectares: null, ranch: 'Kompali (VON)',
      points: [[230,85],[440,85],[440,175],[230,175]] },
    { sectionId: 'K-S2B', ranchCode: 'K', variety: 'Cab. Sauv. / Durif', sectionLabel: 'S2B', hectares: null, ranch: 'Kompali (VON)',
      points: [[20,85],[225,85],[225,175],[20,175]] },
    { sectionId: 'K-S3A', ranchCode: 'K', variety: 'Petit Verdot / Chenin', sectionLabel: 'S3A', hectares: null, ranch: 'Kompali (VON)',
      points: [[20,180],[440,180],[440,250],[20,250]] },
    { sectionId: 'K-S3B', ranchCode: 'K', variety: 'Caladoc / Sauv. Blanc', sectionLabel: 'S3B', hectares: null, ranch: 'Kompali (VON)',
      points: [[20,255],[440,255],[440,310],[20,310]] },
    { sectionId: 'K-S4',  ranchCode: 'K', variety: 'Chardonnay',  sectionLabel: 'S4',  hectares: 6.33, ranch: 'Kompali (VON)',
      points: [[20,315],[220,315],[220,410],[20,410]] },
    { sectionId: 'K-S5',  ranchCode: 'K', variety: 'Marselan',           sectionLabel: 'S5',  hectares: null, ranch: 'Kompali (VON)',
      points: [[225,315],[440,315],[440,410],[225,410]] },
    { sectionId: 'K-S6',  ranchCode: 'K', variety: 'Merlot',             sectionLabel: 'S6',  hectares: null, ranch: 'Kompali (VON)',
      points: [[225,415],[440,415],[440,490],[225,490]] },
    { sectionId: 'K-S7',  ranchCode: 'K', variety: 'Syrah / Durif',      sectionLabel: 'S7',  hectares: null, ranch: 'Kompali (VON)',
      points: [[20,445],[220,445],[220,580],[20,580]] },
    { sectionId: 'K-S8',  ranchCode: 'K', variety: 'Cabernet Sauvignon', sectionLabel: 'S8',  hectares: null, ranch: 'Kompali (VON)',
      points: [[225,495],[440,495],[440,580],[225,580]] },

    // ── Viña Alta (VON) — VA ──
    // Layout: 5 rows × 4 cols grid. Row 1 (bottom) → Row 5 (top).
    // Cols: A(left), B(center-left), C(center-right), D(right)
    // ViewBox: 500 × 480. Cell ~115w × 85h with 5px gaps
    // Row 5 (top, y=10..90)
    { sectionId: 'VA-5A', ranchCode: 'VA', variety: 'Cabernet Franc',   sectionLabel: '5A', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[10,10],[120,10],[120,90],[10,90]] },
    { sectionId: 'VA-5B', ranchCode: 'VA', variety: 'Cabernet Franc',   sectionLabel: '5B', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[125,10],[240,10],[240,90],[125,90]] },
    // Row 4 (y=95..175)
    { sectionId: 'VA-4A', ranchCode: 'VA', variety: 'Grenache',         sectionLabel: '4A', hectares: 1.65, ranch: 'Viña Alta (VON)',
      points: [[10,95],[120,95],[120,175],[10,175]] },
    { sectionId: 'VA-4B', ranchCode: 'VA', variety: 'Grenache',         sectionLabel: '4B', hectares: 1.31, ranch: 'Viña Alta (VON)',
      points: [[125,95],[240,95],[240,175],[125,175]] },
    { sectionId: 'VA-4C', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '4C', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[245,95],[360,95],[360,175],[245,175]] },
    { sectionId: 'VA-4D', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '4D', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[365,95],[480,95],[480,175],[365,175]] },
    // Row 3 (y=180..260)
    { sectionId: 'VA-3B', ranchCode: 'VA', variety: 'Grenache',         sectionLabel: '3B', hectares: 1.61, ranch: 'Viña Alta (VON)',
      points: [[125,180],[240,180],[240,260],[125,260]] },
    { sectionId: 'VA-3C', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '3C', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[245,180],[360,180],[360,260],[245,260]] },
    { sectionId: 'VA-3D', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '3D', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[365,180],[480,180],[480,260],[365,260]] },
    // Row 2 (y=265..345)
    { sectionId: 'VA-2A', ranchCode: 'VA', variety: 'Merlot',           sectionLabel: '2A', hectares: 1.75, ranch: 'Viña Alta (VON)',
      points: [[10,265],[120,265],[120,345],[10,345]] },
    { sectionId: 'VA-2B', ranchCode: 'VA', variety: 'Cabernet Franc',   sectionLabel: '2B', hectares: 1.65, ranch: 'Viña Alta (VON)',
      points: [[125,265],[240,265],[240,345],[125,345]] },
    { sectionId: 'VA-2C', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '2C', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[245,265],[360,265],[360,345],[245,345]] },
    { sectionId: 'VA-2D', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '2D', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[365,265],[480,265],[480,345],[365,345]] },
    // Row 1 (bottom, y=350..430)
    { sectionId: 'VA-1A', ranchCode: 'VA', variety: 'Merlot',           sectionLabel: '1A', hectares: 2.18, ranch: 'Viña Alta (VON)',
      points: [[10,350],[120,350],[120,430],[10,430]] },
    { sectionId: 'VA-1B', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '1B', hectares: 2.53, ranch: 'Viña Alta (VON)',
      points: [[125,350],[240,350],[240,430],[125,430]] },
    { sectionId: 'VA-1C', ranchCode: 'VA', variety: 'Petit Verdot',     sectionLabel: '1C', hectares: 2.13, ranch: 'Viña Alta (VON)',
      points: [[245,350],[360,350],[360,430],[245,430]] },
    { sectionId: 'VA-1D', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '1D', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[365,350],[480,350],[480,430],[365,430]] },
    { sectionId: 'VA-1E', ranchCode: 'VA', variety: 'Syrah',            sectionLabel: '1E', hectares: null, ranch: 'Viña Alta (VON)',
      points: [[10,435],[120,435],[120,470],[10,470]] },

    // ── Ojos Negros (VON) — ON ──
    // Layout: 6 diagonal parallelogram strips, NW→SE staircase
    // ViewBox: 480 × 420. Strips tilted ~25° from horizontal
    { sectionId: 'ON-1', ranchCode: 'ON', variety: 'Merlot',              sectionLabel: '1', hectares: 1.8,  ranch: 'Ojos Negros (VON)',
      points: [[380,50],[460,20],[470,350],[390,380]] },
    { sectionId: 'ON-2', ranchCode: 'ON', variety: 'Malbec',              sectionLabel: '2', hectares: 2.86, ranch: 'Ojos Negros (VON)',
      points: [[300,75],[375,48],[385,378],[310,405]] },
    { sectionId: 'ON-3', ranchCode: 'ON', variety: 'Cabernet Sauvignon',  sectionLabel: '3', hectares: 3.13, ranch: 'Ojos Negros (VON)',
      points: [[220,98],[295,73],[305,403],[230,420]] },
    { sectionId: 'ON-4', ranchCode: 'ON', variety: 'Syrah',               sectionLabel: '4', hectares: 2.55, ranch: 'Ojos Negros (VON)',
      points: [[145,118],[215,96],[225,410],[155,410]] },
    { sectionId: 'ON-5', ranchCode: 'ON', variety: 'Tempranillo',         sectionLabel: '5', hectares: 3.85, ranch: 'Ojos Negros (VON)',
      points: [[60,140],[140,116],[150,410],[70,410]] },
    { sectionId: 'ON-6', ranchCode: 'ON', variety: 'Grenache',            sectionLabel: '6', hectares: 1.11, ranch: 'Ojos Negros (VON)',
      points: [[10,155],[55,142],[65,360],[15,370]] },

    // ── Olé (VDG) — OLE ──
    // Layout: 2 large CS blocks side-by-side + 2 small sections upper-right
    // ViewBox: 400 × 260
    { sectionId: 'OLE-1', ranchCode: 'OLE', variety: 'Cabernet Sauvignon', sectionLabel: '1', hectares: 4.04, ranch: 'Olé (VDG)',
      points: [[10,50],[185,50],[185,250],[10,250]] },
    { sectionId: 'OLE-2', ranchCode: 'OLE', variety: 'Cabernet Sauvignon', sectionLabel: '2', hectares: 4.81, ranch: 'Olé (VDG)',
      points: [[190,50],[370,50],[370,250],[190,250]] },
    { sectionId: 'OLE-3', ranchCode: 'OLE', variety: 'Viognier',           sectionLabel: '3', hectares: 0.44, ranch: 'Olé (VDG)',
      points: [[300,5],[390,5],[390,45],[300,45]] },
    { sectionId: 'OLE-4', ranchCode: 'OLE', variety: 'Syrah',              sectionLabel: '4', hectares: null, ranch: 'Olé (VDG)',
      points: [[375,50],[390,50],[390,120],[375,120]] },

    // ── Siete Leguas (VDG) — 7L ──
    // Layout: 2 sections side-by-side, left is large trapezoid (CB), right is smaller rect (Syrah)
    // ViewBox: 400 × 200
    { sectionId: '7L-1', ranchCode: '7L', variety: 'Chenin Blanc', sectionLabel: '1', hectares: 5.48, ranch: 'Siete Leguas (VDG)',
      points: [[10,30],[250,10],[250,190],[10,190]] },
    { sectionId: '7L-2', ranchCode: '7L', variety: 'Syrah',        sectionLabel: '2', hectares: 1.70, ranch: 'Siete Leguas (VDG)',
      points: [[255,10],[380,10],[380,190],[255,190]] },

    // ── Dubacano (SV) — DUB ──
    { sectionId: 'DUB-1', ranchCode: 'DUB', variety: 'Malbec / Syrah', sectionLabel: '1', hectares: null, ranch: 'Dubacano (SV)',
      points: [[10,10],[190,10],[190,110],[10,110]] },

    // ── Dominio de las Abejas (VON) — DA ──
    { sectionId: 'DA-L5',  ranchCode: 'DA', variety: 'Syrah', sectionLabel: 'L5',  hectares: null, ranch: 'Dominio de las Abejas (VON)',
      points: [[10,10],[120,10],[120,90],[10,90]] },
    { sectionId: 'DA-L13', ranchCode: 'DA', variety: 'Syrah', sectionLabel: 'L13', hectares: null, ranch: 'Dominio de las Abejas (VON)',
      points: [[130,10],[250,10],[250,90],[130,90]] }
  ],

  explorerChartTypes: [
    { value: 'scatter',  label: 'Dispersión' },
    { value: 'bar',      label: 'Barras' },
    { value: 'line',     label: 'Líneas' }
  ],

  explorerGroupBy: {
    berry: [
      { value: 'variety',     label: 'Varietal' },
      { value: 'appellation', label: 'Origen' },
      { value: 'vintage',     label: 'Vendimia' },
      { value: 'lotCode',     label: 'Lote' }
    ],
    wine: [
      { value: 'variedad',    label: 'Varietal' },
      { value: 'proveedor',   label: 'Origen' },
      { value: 'vintage',     label: 'Vendimia' },
      { value: 'codigoBodega', label: 'Lote' }
    ]
  },

  // ── Map: Vineyard Quality Heatmap ─────────────────────────────

  fieldLotToSection: {
    'KCS-S8-1-CONT': 'K-S8', 'KCS-S8-1-ABA': 'K-S8',
    'KCF-S1-PA': 'K-S1', 'KCF-S1-PB': 'K-S1',
    'KMS-S5A+': 'K-S5', 'KMS-S5B-': 'K-S5', 'KMS-S5B-R': 'K-S5',
    'KSY-S721': 'K-S7', 'KSY-S721-R': 'K-S7', 'KSY-S723': 'K-S7',
    'KDU-S2B': 'K-S2B',
    'SYVA-1D,2C,3C,4C': 'VA-1D', 'SYVA-1E,2D,3D,4D': 'VA-1E',
    'SYDA-L13,14': 'DA-L13'
  },

  fieldLotRanchPatterns: [
    { regex: /^K[A-Z]{2,3}-(.+)$/i, prefix: 'K' },
    { regex: /^[A-Z]{2,4}MX-(.+)$/i, prefix: 'MX' },
    { regex: /^[A-Z]{2,4}VA-(.+)$/i, prefix: 'VA' },
    { regex: /^[A-Z]{2,4}ON-(.+)$/i, prefix: 'ON' },
    { regex: /^[A-Z]{2,4}7L-(.+)$/i, prefix: '7L' },
    { regex: /^[A-Z]{2,4}OLE-(.+)$/i, prefix: 'OLE' },
    { regex: /^[A-Z]{2,4}DUB-(.+)$/i, prefix: 'DUB' },
    { regex: /^[A-Z]{2,4}DA-(.+)$/i, prefix: 'DA' },
    { regex: /^[A-Z]{2,4}LLC-(.+)$/i, prefix: 'LLC' },
    { regex: /^[A-Z]{2,4}R14-(.+)$/i, prefix: 'R14' }
  ],

  mapMetrics: {
    brix:    { label: 'Brix (°Bx)',       min: 18, max: 28,   stops: ['#2166AC','#67A9CF','#D1E5F0','#FDDBC7','#EF8A62','#B2182B'] },
    pH:      { label: 'pH',               min: 3.0, max: 4.0, stops: ['#1B7837','#7FBC41','#D9F0D3','#F7F7F7','#E7D4E8','#762A83'] },
    ta:      { label: 'Acidez Total (g/L)', min: 3, max: 12,  stops: ['#B2182B','#EF8A62','#FDDBC7','#D1E5F0','#67A9CF','#2166AC'] },
    tANT:    { label: 'tANT (ppm ME)',     min: 0, max: 2500, stops: ['#F7F7F7','#FDD49E','#FDBB84','#FC8D59','#E34A33','#B30000'] },
    berryFW: { label: 'Peso Baya (g)',     min: 0.5, max: 2.5, stops: ['#F7FCB1','#ADDD8E','#78C679','#31A354','#006837'] }
  },

  // ── Grade color tokens (used by maps.js and legend) ─────────────────────
  gradeColors: {
    'A+': '#1a7f3e',
    'A':  '#7ac74f',
    'B':  '#f5c542',
    'C':  '#d94a3d',
    null: '#6b6b6b'   // "Sin clasificar"
  },

  // ── Quality rubrics ─────────────────────────────────────────────────────
  // Each rubric defines thresholds per parameter for one variety-group + valley.
  // Params not listed (sanitary-pct, visual, madurez) are derived identically
  // across all rubrics — logic lives in classification.js, not here.
  rubrics: {
    'PV-DUR-VON': {
      name: 'Petit Verdot y Durif — Valle de Ojos Negros',
      params: {
        brix:         { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.67, b: 3.80, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 2800, b: 2000, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 1000, b: 800, imp: 20 }
      }
    },

    'CS-SY-MAL-MRS-TEM-VON': {
      name: 'Cabernet Sauvignon, Syrah, Malbec, Marselan, Tempranillo — Valle de Ojos Negros',
      params: {
        brix:         { kind: 'range', a: [23.5, 24.2], b: [[22.1, 23.4],[24.3, 25.5]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.67, b: 3.80, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 1900, b: 1500, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 950, b: 700, imp: 20 }
      },
      peso_overrides: {
        'Tempranillo': { kind: 'range', a: [1.3, 1.5], b: [[1.0, 1.2],[1.51, 1.7]], imp: 5 }
      }
    },

    'CS-SY-VDG': {
      name: 'Cabernet Sauvignon, Syrah — Valle de Guadalupe',
      params: {
        brix:         { kind: 'range', a: [23.8, 24.5], b: [[22.1, 23.8],[24.6, 25.9]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.60, b: 3.73, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 2100, b: 1600, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 800, b: 600, imp: 20 }
      },
      peso_overrides: {
        'Syrah': { kind: 'range', a: [1.2, 1.4], b: [[1.1, 1.2],[1.4, 1.5]], imp: 5 }
      }
    },

    'MER-CF-GRE-CALADOC-VON': {
      name: 'Merlot, Cabernet Franc, Grenache, Caladoc — Valle de Ojos Negros',
      params: {
        brix:         { kind: 'range', a: [22.8, 23.5], b: [[22.0, 22.7],[23.7, 24.4]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.67, b: 3.80, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 1500, b: 1200, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 900, b: 600, imp: 20 }
      },
      peso_overrides: {
        'Caladoc':  { kind: 'range', a: [1.3, 1.5], b: [[1.0, 1.19],[1.51, 1.7]], imp: 5 },
        'Grenache': { kind: 'range', a: [1.3, 1.5], b: [[1.0, 1.19],[1.51, 1.7]], imp: 5 }
      }
    },

    'GRE-CALADOC-VDG-VSV': {
      name: 'Grenache, Caladoc — Valle de Guadalupe / Valle de San Vicente',
      params: {
        brix:         { kind: 'range', a: [23.0, 23.7], b: [[22.1, 22.9],[23.8, 24.5]], imp: 4 },
        pH:           { kind: 'le-a-le-b', a: 3.60, b: 3.73, imp: 12 },
        ta:           { kind: 'ge-a-ge-b', a: 5.85, b: 5.40, imp: 9 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 13 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 13 },
        berryFW:      { kind: 'range', a: [0.9, 1.1], b: [[0.8, 0.89],[1.12, 1.2]], imp: 5 },
        polyphenols:  { kind: 'ge-a-ge-b', a: 1800, b: 1400, imp: 20 },
        anthocyanins: { kind: 'ge-a-ge-b', a: 650, b: 450, imp: 20 }
      }
    },

    'SB-VDG-VON': {
      name: 'Sauvignon Blanc — Valle de Guadalupe / Valle de Ojos Negros',
      // Whites have a different Imp distribution than reds (95 base, not 100).
      // Engine normalizes via (3 * Σ imp_present); no special-case needed.
      params: {
        brix:         { kind: 'range', a: [19.0, 23.0], b: [[18.0, 19.0],[23.0, 24.5]], imp: 10 },
        pH:           { kind: 'le-a-le-b', a: 3.20, b: 3.40, imp: 20 },
        ta:           { kind: 'ge-a-ge-b', a: 6.60, b: 5.55, imp: 15 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 20 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 20 },
        berryFW:      { kind: 'range', a: [1.1, 1.35], b: [[0.95, 1.09],[1.36, 1.44]], imp: 5 }
      },
      visualImp: 3   // whites weight visual 3, not 2
    },

    'CH-CB-SBGR-VDG-VON': {
      name: 'Chardonnay, Chenin Blanc, Sauvignon Blanc (Gran Ricardo) — VDG / VON',
      params: {
        brix:         { kind: 'range', a: [22.5, 23.5], b: [[21.5, 22.4],[23.6, 24.5]], imp: 10 },
        pH:           { kind: 'le-a-le-b', a: 3.35, b: 3.50, imp: 20 },
        ta:           { kind: 'ge-a-ge-b', a: 6.60, b: 5.55, imp: 15 },
        av:           { kind: 'le-a-le-b', a: 0.00, b: 0.03, imp: 20 },
        ag:           { kind: 'le-a-le-b', a: 0.03, b: 0.10, imp: 20 },
        berryFW:      { kind: 'ge-a-ge-b', a: 1.4, b: 1.0, imp: 5 }
      },
      visualImp: 3
    }
  },

  // ── Global sanitary / visual scoring (same for all rubrics) ─────────────
  sanitaryThresholds: {
    pct: { a: 0.5, b: 2.0 },          // ≤0.5 → A, 0.5 < pct ≤ 2 → B, > 2 → C
    visual: {
      'Excelente': 3,
      'Bueno':     3,
      'Regular':   2,
      'Malo':      1
    },
    defaultConteoImp: 2,
    defaultVisualImp: 2
  },

  // ── Madurez fenólica overlay (winemaker input on mediciones) ────────────
  madurezOverlay: {
    'Sobresaliente':  +3,
    'Parcial':         0,
    'No sobresaliente': -3
    // null / undefined → 0
  },

  // ── Variety × Valley → rubric ID lookup ─────────────────────────────────
  // Valley is derived from appellation (see resolveValley in classification.js).
  // Unknown combinations return null → "Sin rúbrica".
  varietyRubricMap: {
    'Valle de Ojos Negros': {
      'Petit Verdot':       'PV-DUR-VON',
      'Durif':              'PV-DUR-VON',
      'Cabernet Sauvignon': 'CS-SY-MAL-MRS-TEM-VON',
      'Syrah':              'CS-SY-MAL-MRS-TEM-VON',
      'Malbec':             'CS-SY-MAL-MRS-TEM-VON',
      'Marselan':           'CS-SY-MAL-MRS-TEM-VON',
      'Tempranillo':        'CS-SY-MAL-MRS-TEM-VON',
      'Merlot':             'MER-CF-GRE-CALADOC-VON',
      'Cabernet Franc':     'MER-CF-GRE-CALADOC-VON',
      'Grenache':           'MER-CF-GRE-CALADOC-VON',
      'Caladoc':            'MER-CF-GRE-CALADOC-VON',
      'Sauvignon Blanc':    'SB-VDG-VON',
      'Chardonnay':         'CH-CB-SBGR-VDG-VON',
      'Chenin Blanc':       'CH-CB-SBGR-VDG-VON'
    },
    'Valle de Guadalupe': {
      'Cabernet Sauvignon': 'CS-SY-VDG',
      'Syrah':              'CS-SY-VDG',
      'Grenache':           'GRE-CALADOC-VDG-VSV',
      'Caladoc':            'GRE-CALADOC-VDG-VSV',
      'Sauvignon Blanc':    'SB-VDG-VON',
      'Chardonnay':         'CH-CB-SBGR-VDG-VON',
      'Chenin Blanc':       'CH-CB-SBGR-VDG-VON'
    },
    'Valle de San Vicente': {
      'Grenache': 'GRE-CALADOC-VDG-VSV',
      'Caladoc':  'GRE-CALADOC-VDG-VSV'
    }
  },

  // Valley-name extraction from appellation strings — ordered, first match wins.
  valleyPatterns: [
    { re: /Valle de Ojos Negros|\(VON\)/i,   valley: 'Valle de Ojos Negros' },
    { re: /Valle de Guadalupe|\(VDG\)|VDG/i, valley: 'Valle de Guadalupe' },
    { re: /San Vicente|VSV|\(SV\)/i,         valley: 'Valle de San Vicente' }
  ]
};
