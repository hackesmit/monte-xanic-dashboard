// ── Configuration: Colors, Categories, Mappings ──

const CONFIG = {
  // Grape type classification
  grapeTypes: {
    red: ['Cabernet Sauvignon','Syrah','Cabernet Franc','Merlot','Tempranillo',
          'Marselan','Grenache','Caladoc','Malbec','Petit Verdot','Durif','Nebbiolo'],
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
    'Petite Sirah':      '#E65100',
    'Mourvèdre':         '#AD1457',
    'Chardonnay':        '#FFD54F',
    'Viognier':          '#AED581',
    'Chenin Blanc':      '#80DEEA'
  },

  // Origin colors (full names as they appear in data)
  originColors: {
    'Valle de Ojos Negros (Kompali)':               '#C4A060',
    'Valle de Ojos Negros (Viña Alta)':              '#60A8C0',
    'Valle de Guadalupe (Olé)':                      '#E07060',
    'Valle de Ojos Negros (Ojos Negros)':            '#7EC87A',
    'Valle de Guadalupe (Monte Xanic)':              '#DDB96E',
    'Valle de Ojos Negros (Dominio de las Abejas)':  '#9B59B6',
    'Valle de Ojos Negros (Rancho 14)':              '#E67E22',
    'Valle de Guadalupe (Siete Leguas)':             '#1ABC9C',
    'Valle de Ojos Negros (Dubacano)':               '#3498DB',
    'California':                                     '#95A5A6',
    'San Gerónimo':                                   '#F39C12',
    'Camino Corazón (Valle de Parras)':               '#D4E157',
    // Short aliases for backwards compat
    'Kompali':               '#C4A060',
    'Viña Alta':             '#60A8C0',
    'Olé':                   '#E07060',
    'Ojos Negros':           '#7EC87A',
    'Monte Xanic':           '#DDB96E',
    'Dominio de las Abejas': '#9B59B6',
    'Rancho 14':             '#E67E22',
    'Siete Leguas':          '#1ABC9C',
    'Dubacano':              '#3498DB'
  },

  // Varietal abbreviations (code → full name)
  varietyAbbr: {
    'CS':'Cabernet Sauvignon','CF':'Cabernet Franc','SY':'Syrah','ME':'Merlot',
    'MA':'Malbec','GRE':'Grenache','GR':'Grenache','PV':'Petit Verdot',
    'TE':'Tempranillo','TEM':'Tempranillo','CA':'Caladoc','CAL':'Caladoc',
    'MS':'Marselan','MRS':'Marselan','DU':'Durif','NB':'Nebbiolo','SB':'Sauvignon Blanc'
  },

  // Origin abbreviations (code → full name)
  originAbbr: {
    'MX':'Monte Xanic','VA':'Viña Alta','ON':'Ojos Negros','OLE':'Olé',
    'DUB':'Dubacano','DA':'Dominio de las Abejas','DLA':'Dominio de las Abejas',
    '7L':'Siete Leguas','KMP':'Kompali','R14':'Rancho 14','SG':'San Gerónimo',
    'UC':'Dominio de las Abejas'
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
    'KCS-S8-1-BIO':  ['25CSKMP-EXP-1'],
    'KCS-S8-1-MAT':  ['25CSKMP-EXP-2'],
    'KCS-S8-1-R':    ['25CSKMP-EXP-3'],
    'KCS-S8-1-ABA':  ['25CSKMP-EXP-4'],
    'KCS-S2B-ALIVIO':['25CSKMP-EXP-5'],
    'CSOLE-1CP':     ['25CSOLE-EXP-5'],
    'CSOLE-2SP':     ['25CSOLE-EXP-6'],
    'CSOLE-3CP':     ['25CSOLE-EXP-3'],
    'CSOLE-4SP':     ['25CSOLE-EXP-8'],
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
    'Kompali':               'circle',
    'Viña Alta':             'triangle',
    'Olé':                   'rect',
    'Ojos Negros':           'rectRounded',
    'Monte Xanic':           'star',
    'Dominio de las Abejas': 'crossRot',
    'Rancho 14':             'rectRot',
    'Siete Leguas':          'cross',
    'Dubacano':              'dash',
    'California':            'circle',
    'San Gerónimo':          'triangle',
    'Camino Corazón (Valle de Parras)': 'rectRot'
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
    'IPT SPICA':                 'ipt_spica'
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
    'notes':           'notes'
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
    'report_code':      'codigoBodega',
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
  }
};
