"""Import the official R-ONE average/median apartment price JSON exports."""
import json, re, sys
from pathlib import Path
from datetime import datetime, timezone

def read_export(filename):
    sheet = json.loads(Path(filename).read_text())['sheet']['1']['data']
    columns = {c: f'{m[1]}-{int(m[2]):02d}' for c, v in sheet['0'].items()
               if (m := re.fullmatch(r'(\d{4})년\s*(\d+)월', str(v)))}
    result = {}
    for row in sheet.values():
        if not str(row.get('0', '')).isdigit():
            continue
        labels = list(dict.fromkeys(str(row.get(str(c), '')).strip() for c in range(1, 5)))
        labels = [x for x in labels if x]
        if not labels or labels[0] not in ['서울', '경기', '인천', '부산']:
            continue
        for col, period in columns.items():
            raw = str(row.get(col, '')).replace(',', '').strip()
            if raw and re.fullmatch(r'\d+(\.\d+)?', raw):
                result[('>'.join(labels), period)] = float(raw)
    return result

average, median = map(read_export, sys.argv[1:3])
output_path = Path('data/reb-apartment-prices.json')
out = json.loads(output_path.read_text())
placements = re.findall(r"\[\d+,'([^']+)','([^']+)'\]", Path('shared/metro-tile-map.js').read_text())
normalize = lambda s: re.sub(r'시(?=.+구$)', '', re.sub(r'[\s>]', '', s))
annual, district = {}, []
for (path, period), value in average.items():
    if (path, period) not in median:
        continue
    mid = median[path, period]
    if path in ['서울', '경기', '인천', '부산']:
        annual.setdefault(path, {}).setdefault(int(period[:4]), []).append((value, mid))
    matches = [(p, n) for p, n in placements if normalize(path).startswith(p) and normalize(path).endswith(normalize(n))]
    if len(matches) == 1:
        p, n = matches[0]
        district.append(dict(province=p, name=n, period=period, average=value, median=mid))
out['regions'] = {p: [dict(year=y, average=round(sum(v[0] for v in vals)/len(vals),3), median=round(sum(v[1] for v in vals)/len(vals),3), months=len(vals)) for y,vals in sorted(years.items())] for p,years in annual.items()}
out['districtMonthly'] = sorted(district, key=lambda r:(r['period'],r['province'],r['name']))
out['asOf'] = max(r['period'] for r in district)
out['unit'] = '천원'
out['updatedAt'] = datetime.now(timezone.utc).isoformat()
assert len(out['regions']) == 4 and out['asOf'] >= '2026-09'
output_path.write_text(json.dumps(out, ensure_ascii=False, separators=(',',':'))+'\n')
print('Imported through', out['asOf'], 'with',len(district),'monthly region records')
