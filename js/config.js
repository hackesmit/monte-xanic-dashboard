// ── Configuration: Colors, Categories, Mappings ──

const CONFIG = {
  // Grape type classification
  grapeTypes: {
    red: ['Cabernet Sauvignon','Syrah','Cabernet Franc','Merlot','Tempranillo',
          'Marselan','Grenache','Caladoc','Malbec','Petit Verdot','Durif','Nebbiolo',
          'Mourvèdre'],
    white: ['Sauvignon Blanc','Chardonnay','Viognier','Chenin Blanc']
  },

  // Distinct colors per varietal (vivid, dark-theme friendly)
  varietyColors: {
    'Cabernet Sauvignon': '#DC143C',
    'Syrah':             '#7B2FBE',
    'Cabernet Franc':    '#C41E3A',
    'Merlot':            '#E040A0',
    'Tempranillo':       '#E74C3C',
    'Marselan':          '#E91E63',
    'Grenache':          '#FF6347',
    'Caladoc':           '#9370DB',
    'Malbec':            '#4169E1',
    'Petit Verdot':      '#00BCD4',
    'Durif':             '#8BC34A',
    'Nebbiolo':          '#FFB300',
    'Sauvignon Blanc':   '#F0E68C',
    'Mourvèdre':         '#8B4513',
    'Chardonnay':        '#F5E6A3',
    'Viognier':          '#E8D5A0',
    'Chenin Blanc':      '#D4E8B0'
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
    // Fix mojibake/replacement characters
    let fixed = name;
    if (fixed.includes('\uFFFD')) {
      fixed = fixed
        .replace('Vi\uFFFDa', 'Viña').replace('Ol\uFFFD', 'Olé')
        .replace('Ger\uFFFDnimo', 'Gerónimo').replace('Coraz\uFFFDn', 'Corazón');
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
    'Berry Sugars (mg/b)':    'berry_sugars_mg',
    'Alcohol (% vol)':        'alcohol',
    'Volatile Acidity (g/L)': 'va',
    'Malic Acid (g/L)':       'malic_acid',
    'Residual Sugars (g/L)':  'rs',
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
    'l_star':          'colorL',
    'a_star':          'colorA',
    'b_star':          'colorB',
    'color_i':         'colorI',
    'color_t':         'colorT',
    'sample_type':     'sampleType',
    'vessel_id':       'tanque',
    'notes':           'notes',
    'below_detection': 'belowDetection'
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

  explorerChartTypes: [
    { value: 'scatter',  label: 'Dispersión' },
    { value: 'bar',      label: 'Barras' },
    { value: 'line',     label: 'Líneas' }
  ],

  explorerGroupBy: {
    berry: [
      { value: 'variety',     label: 'Varietal' },
      { value: 'appellation', label: 'Origen' },
      { value: 'vintage',     label: 'Vendimia' }
    ],
    wine: [
      { value: 'variedad',    label: 'Varietal' },
      { value: 'proveedor',   label: 'Origen' },
      { value: 'vintage',     label: 'Vendimia' }
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

  vineyardSections: [
    // Monte Xanic (VDG)
    { sectionId: 'MX-1A', ranchCode: 'VDG', sectionLabel: '1A', ranch: 'Monte Xanic', variety: 'SB' },
    { sectionId: 'MX-1B', ranchCode: 'VDG', sectionLabel: '1B', ranch: 'Monte Xanic', variety: 'SB' },
    { sectionId: 'MX-1C', ranchCode: 'VDG', sectionLabel: '1C', ranch: 'Monte Xanic', variety: 'SB' },
    { sectionId: 'MX-1D', ranchCode: 'VDG', sectionLabel: '1D', ranch: 'Monte Xanic', variety: 'SB' },
    { sectionId: 'MX-1E', ranchCode: 'VDG', sectionLabel: '1E', ranch: 'Monte Xanic', variety: 'CAL' },
    { sectionId: 'MX-2A', ranchCode: 'VDG', sectionLabel: '2A', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-2B', ranchCode: 'VDG', sectionLabel: '2B', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-2C', ranchCode: 'VDG', sectionLabel: '2C', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-3A', ranchCode: 'VDG', sectionLabel: '3A', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-3B', ranchCode: 'VDG', sectionLabel: '3B', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-4A', ranchCode: 'VDG', sectionLabel: '4A', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-4B', ranchCode: 'VDG', sectionLabel: '4B', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-5A', ranchCode: 'VDG', sectionLabel: '5A', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-5B', ranchCode: 'VDG', sectionLabel: '5B', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-5C', ranchCode: 'VDG', sectionLabel: '5C', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-6',  ranchCode: 'VDG', sectionLabel: '6',  ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-7A', ranchCode: 'VDG', sectionLabel: '7A', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-7B', ranchCode: 'VDG', sectionLabel: '7B', ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-8',  ranchCode: 'VDG', sectionLabel: '8',  ranch: 'Monte Xanic', variety: 'ME' },
    { sectionId: 'MX-9',  ranchCode: 'VDG', sectionLabel: '9',  ranch: 'Monte Xanic', variety: 'CH' },
    { sectionId: 'MX-10', ranchCode: 'VDG', sectionLabel: '10', ranch: 'Monte Xanic', variety: 'ME' },
    { sectionId: 'MX-11A',ranchCode: 'VDG', sectionLabel: '11A',ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-11B',ranchCode: 'VDG', sectionLabel: '11B',ranch: 'Monte Xanic', variety: 'CS' },
    { sectionId: 'MX-12', ranchCode: 'VDG', sectionLabel: '12', ranch: 'Monte Xanic', variety: 'CS' },
    // Kompali (VON)
    { sectionId: 'K-S1',  ranchCode: 'KMP', sectionLabel: 'S1',  ranch: 'Kompali', variety: 'CF/TE' },
    { sectionId: 'K-S2A', ranchCode: 'KMP', sectionLabel: 'S2A', ranch: 'Kompali', variety: 'CS/DU' },
    { sectionId: 'K-S2B', ranchCode: 'KMP', sectionLabel: 'S2B', ranch: 'Kompali', variety: 'CS/DU' },
    { sectionId: 'K-S3A', ranchCode: 'KMP', sectionLabel: 'S3A', ranch: 'Kompali', variety: 'PV/CA' },
    { sectionId: 'K-S3B', ranchCode: 'KMP', sectionLabel: 'S3B', ranch: 'Kompali', variety: 'CA' },
    { sectionId: 'K-S4',  ranchCode: 'KMP', sectionLabel: 'S4',  ranch: 'Kompali', variety: 'CA' },
    { sectionId: 'K-S5',  ranchCode: 'KMP', sectionLabel: 'S5',  ranch: 'Kompali', variety: 'MS' },
    { sectionId: 'K-S6',  ranchCode: 'KMP', sectionLabel: 'S6',  ranch: 'Kompali', variety: 'ME' },
    { sectionId: 'K-S7',  ranchCode: 'KMP', sectionLabel: 'S7',  ranch: 'Kompali', variety: 'SY/MA' },
    { sectionId: 'K-S8',  ranchCode: 'KMP', sectionLabel: 'S8',  ranch: 'Kompali', variety: 'CS' },
    // Viña Alta (VON)
    { sectionId: 'VA-1A', ranchCode: 'VA', sectionLabel: '1A', ranch: 'Viña Alta', variety: 'ME' },
    { sectionId: 'VA-1B', ranchCode: 'VA', sectionLabel: '1B', ranch: 'Viña Alta', variety: 'SY' },
    { sectionId: 'VA-2A', ranchCode: 'VA', sectionLabel: '2A', ranch: 'Viña Alta', variety: 'ME' },
    { sectionId: 'VA-2B', ranchCode: 'VA', sectionLabel: '2B', ranch: 'Viña Alta', variety: 'CF' },
    // Ojos Negros (VON)
    { sectionId: 'ON-1', ranchCode: 'ON', sectionLabel: '1', ranch: 'Ojos Negros', variety: 'ME' },
    { sectionId: 'ON-2', ranchCode: 'ON', sectionLabel: '2', ranch: 'Ojos Negros', variety: 'MA' },
    { sectionId: 'ON-3', ranchCode: 'ON', sectionLabel: '3', ranch: 'Ojos Negros', variety: 'CS' },
    { sectionId: 'ON-4', ranchCode: 'ON', sectionLabel: '4', ranch: 'Ojos Negros', variety: 'SY' },
    { sectionId: 'ON-5', ranchCode: 'ON', sectionLabel: '5', ranch: 'Ojos Negros', variety: 'TE' },
    { sectionId: 'ON-6', ranchCode: 'ON', sectionLabel: '6', ranch: 'Ojos Negros', variety: 'GRE' },
    // Siete Leguas (VDG)
    { sectionId: '7L-1', ranchCode: '7L', sectionLabel: '1', ranch: 'Siete Leguas', variety: 'SY' },
    { sectionId: '7L-2', ranchCode: '7L', sectionLabel: '2', ranch: 'Siete Leguas', variety: 'SY' },
    // Olé (VDG)
    { sectionId: 'OLE-1', ranchCode: 'OLE', sectionLabel: '1', ranch: 'Olé', variety: 'CS' },
    { sectionId: 'OLE-2', ranchCode: 'OLE', sectionLabel: '2', ranch: 'Olé', variety: 'CS' },
    { sectionId: 'OLE-3', ranchCode: 'OLE', sectionLabel: '3', ranch: 'Olé', variety: 'CS' },
    // Dubacano (SV)
    { sectionId: 'DUB-1', ranchCode: 'DUB', sectionLabel: '1', ranch: 'Dubacano', variety: 'MA/SY' },
    // Dominio de las Abejas (VON)
    { sectionId: 'DA-L5',  ranchCode: 'DA', sectionLabel: 'L5',  ranch: 'Dominio de las Abejas', variety: 'SY' },
    { sectionId: 'DA-L13', ranchCode: 'DA', sectionLabel: 'L13', ranch: 'Dominio de las Abejas', variety: 'SY' }
  ]
};
