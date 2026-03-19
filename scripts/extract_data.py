import json, os, sys, csv
from datetime import datetime, date

REDS = ['Cabernet Sauvignon','Syrah','Cabernet Franc','Merlot','Tempranillo',
        'Marselan','Grenache','Caladoc','Malbec','Petit Verdot','Durif','Nebbiolo']

def safe_val(v):
    if v is None or v == '-' or v == '\u2014' or str(v).strip() == '':
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime('%m/%d/%Y')
    if isinstance(v, (int, float)):
        return v
    try:
        return float(v)
    except (ValueError, TypeError):
        return str(v).strip()

def grape_type(variety):
    return 'red' if variety in REDS else 'white'

def extract_lot_code(sample_id):
    if not sample_id:
        return ''
    code = str(sample_id)
    if code.startswith('24') or code.startswith('25'):
        code = code[2:]
    code = code.replace('_BERRIES', '').replace('_RECEPCION', '')
    return code

def extract_from_winexray(path):
    """Extract berry and wine data from a single WineXRay CSV export."""
    rows = []
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()
    # Fix unquoted commas inside header fields (e.g. "Total Phenolics Index (IPT, d-less)")
    text = text.replace('Total Phenolics Index (IPT, d-less)',
                        '"Total Phenolics Index (IPT, d-less)"')
    import io
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        rows.append(row)

    if len(rows) < 2:
        return [], [], []

    headers = [h.strip() for h in rows[0]]

    # Berry column mapping
    berry_map = {
        'Sample Id': 'sampleId', 'Sample Date': 'sampleDate', 'Vintage': 'vintage',
        'Variety': 'variety', 'Appellation': 'appellation',
        'CrushDate (yyyy-mm-dd)': 'crushDate', 'DaysPostCrush (number)': 'daysPostCrush',
        'Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)': 'brix',
        'pH (pH units)': 'pH', 'Titratable Acidity (TA gr/l)': 'ta',
        'tANT (ppm ME)': 'tANT',
        'Number Of Berries In Sample (number)': 'berryCount',
        'Weight Of Berries In Sample (gr)': 'berryWeight',
        'Berry Fresh Weight (gr)': 'berryFW',
        'L*': 'colorL', 'a*': 'colorA', 'b*': 'colorB', 'I': 'colorI', 'T': 'colorT',
        'Sample Type': 'sampleType', 'Notes...': 'notes'
    }

    # Wine column mapping
    wine_map = {
        'Sample Id': 'codigoBodega', 'Sample Date': 'fecha', 'Vessel Id': 'tanque',
        'Variety': 'variedad', 'Appellation': 'proveedor',
        'Sample Type': 'sampleType', 'Vintage': 'vintage',
        'DaysPostCrush (number)': 'daysPostCrush', 'CrushDate (yyyy-mm-dd)': 'crushDate',
        'tANT (ppm ME)': 'antoWX', 'fANT (ppm ME)': 'freeANT',
        'bANT (ppm ME)': 'boundANT', 'pTAN (ppm CE)': 'pTAN',
        'iRPs (ppm CE)': 'iRPs',
        'Total Phenolics Index (IPT, d-less)': 'iptSpica',
        'Brix (degrees %w/w: (gr sucrose/100 gr juice)*100)': 'brix',
        'pH (pH units)': 'pH', 'Titratable Acidity (TA gr/l)': 'at',
        'L*': 'colorL', 'a*': 'colorA', 'b*': 'colorB', 'I': 'colorI', 'T': 'colorT',
        'Notes...': 'notes'
    }

    # Build index maps
    def build_idx(col_map):
        idx = {}
        for i, h in enumerate(headers):
            for src, dst in col_map.items():
                if src == h:
                    idx[dst] = i
                    break
        return idx

    berry_idx = build_idx(berry_map)
    wine_idx = build_idx(wine_map)

    # Find Sample Type column
    type_col = headers.index('Sample Type') if 'Sample Type' in headers else None

    berry_data = []
    wine_recepcion = []
    wine_preferment = []

    for row in rows[1:]:
        if not row or len(row) < 5:
            continue
        sample_type = row[type_col].strip() if type_col is not None and type_col < len(row) else ''

        if sample_type == 'Berries':
            obj = {}
            for key, col_i in berry_idx.items():
                v = row[col_i] if col_i < len(row) else None
                obj[key] = safe_val(v)
            if not obj.get('sampleId'):
                continue
            if 'DELETE' in str(obj['sampleId']).upper():
                continue
            if obj.get('vintage') and isinstance(obj['vintage'], float):
                obj['vintage'] = int(obj['vintage'])
            obj['lotCode'] = extract_lot_code(obj['sampleId'])
            obj['grapeType'] = grape_type(obj.get('variety', ''))
            berry_data.append(obj)
        elif sample_type:
            obj = {}
            for key, col_i in wine_idx.items():
                v = row[col_i] if col_i < len(row) else None
                obj[key] = safe_val(v)
            if not obj.get('codigoBodega'):
                continue
            if 'DELETE' in str(obj['codigoBodega']).upper():
                continue
            if obj.get('vintage') and isinstance(obj['vintage'], float):
                obj['vintage'] = int(obj['vintage'])
            obj['grapeType'] = grape_type(obj.get('variedad', ''))
            if sample_type == 'Must':
                wine_preferment.append(obj)
            else:
                wine_recepcion.append(obj)

    return berry_data, wine_recepcion, wine_preferment

if __name__ == '__main__':
    # Look for WineXRay CSV
    csv_path = None
    for name in ['result_corrected_3.csv', 'result.csv']:
        p = os.path.join(r'C:\Users\danie\Downloads', name)
        if os.path.exists(p):
            csv_path = p
            break

    if not csv_path:
        print('No WineXRay CSV found. Place result.csv in Downloads.')
        sys.exit(1)

    print(f'Extracting from {csv_path}...')
    berry, recepcion, preferment = extract_from_winexray(csv_path)
    print(f'  {len(berry)} berry records')
    print(f'  {len(recepcion)} wine reception records')
    print(f'  {len(preferment)} must/preferment records')

    out_dir = os.path.join(os.path.dirname(__file__), 'data')
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(out_dir, 'berry_data.json'), 'w', encoding='utf-8') as f:
        json.dump(berry, f, ensure_ascii=False)
    with open(os.path.join(out_dir, 'wine_recepcion.json'), 'w', encoding='utf-8') as f:
        json.dump(recepcion, f, ensure_ascii=False)
    with open(os.path.join(out_dir, 'wine_preferment.json'), 'w', encoding='utf-8') as f:
        json.dump(preferment, f, ensure_ascii=False)

    print(f'Data saved to {out_dir}/')
