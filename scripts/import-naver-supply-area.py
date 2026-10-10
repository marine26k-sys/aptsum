#!/usr/bin/env python3
"""로컬 엑셀에서 검증된 네 항목만 추출. 원본·가격·링크·단지ID는 출력하지 않는다.
naver의 기존 비교 함수를 직접 사용하고 K-apt/기존 aptsum 세대수 일치를 검증한다.
사용: bundled-python scripts/import-naver-supply-area.py --workbook <xlsx> --naver-root ../naver
"""
import argparse, collections, json, math, re, sys
from pathlib import Path
import openpyxl

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook', required=True, type=Path)
    parser.add_argument('--naver-root', required=True, type=Path)
    parser.add_argument('--out', type=Path, default=Path('data/supply-area-naver'))
    args = parser.parse_args()
    sys.path.insert(0, str(args.naver_root.resolve() / 'tools'))
    import add_historical_high as matching
    root = Path(__file__).resolve().parents[1]
    regions = {}
    # shared/regions.mjs는 정적 문자열 쌍만 사용한다. 시/도별 블록을 따로 읽어 동명이인 구를 분리.
    text = (root/'shared/regions.mjs').read_text()
    for city, block in re.findall(r"\['(서울|경기|인천|부산)', \[\[(.*?)\]\]\]", text):
        for gu, lawd in re.findall(r"'([^']+)','([^']+)'", block):
            regions[(city, gu)] = lawd
    book = openpyxl.load_workbook(args.workbook, read_only=True, data_only=True)
    rows = book.active.iter_rows(values_only=True); headers = next(rows)
    complexes = {}; stats = collections.Counter()
    for row in rows:
        stats['sourceRows'] += 1
        r = dict(zip(headers, row)); lawd = regions.get((r.get('시'), r.get('구')))
        try:
            ex = float(r['전용면적(㎡)']); supply = float(r['면적(㎡)']); hh = int(r['세대수'])
        except (ValueError, TypeError, KeyError):
            stats['invalidRows'] += 1; continue
        if not lawd or not all(math.isfinite(v) for v in (ex, supply)) or not (0 < ex < supply and hh > 0):
            stats['invalidRows'] += 1; continue
        key = (lawd, str(r['법정동']), str(r['단지명']), str(r['단지ID']))
        c = complexes.setdefault(key, {'hh':set(), 'areas':collections.defaultdict(set), 'city':r['시'], 'gu':r['구']})
        c['hh'].add(hh); c['areas'][ex].add(supply)
    book.close()
    raw_dongs = collections.defaultdict(set)
    by_dong = collections.defaultdict(list)
    for key, c in complexes.items(): by_dong[key[:2]].append((key,c))
    outputs = collections.defaultdict(dict); owners = collections.defaultdict(set)
    for lawd in sorted({key[0] for key in complexes}):
        grouped={};legacy={}
        for kind in ('analyze','presale','rent'):
            loaded=matching.collect_sigungu_trades(root/'data'/kind/lawd, '202311', presale=kind=='presale', legacy_out=legacy)
            for key, values in loaded.items(): grouped.setdefault(key,[]).extend(values)
        for (_dong,_name),values in grouped.items():
            for value in values:raw_dongs[(lawd,value['apt'])].add(value.get('umd',''))
        try: kapt=json.loads((root/'data/hhcnt'/f'{lawd}.json').read_text()).get('items',[])
        except (OSError,ValueError): kapt=[]
        try: stored=json.loads((root/'data/hhcnt-naver'/f'{lawd}.json').read_text()).get('items',{})
        except (OSError,ValueError): stored={}
        for (region,dong), entries in by_dong.items():
            if region!=lawd:continue
            candidates={n:v for (d,n),v in grouped.items() if d==dong}
            old={n:v for (d,n),v in legacy.items() if d==dong}
            qn_owners=collections.defaultdict(set)
            for (_,_,apt,nid),c in entries:qn_owners[matching._norm_name(apt,dong)].add(nid)
            reserved=set(qn_owners);ambiguous={n for n,ids in qn_owners.items() if len(ids)>1}
            kapt_candidates=collections.defaultdict(list)
            for h in kapt:
                addr=str(h.get('kaptAddr','')); m=re.search(r'([가-힣0-9]+(?:동|가|읍|면|리))\s+\d',addr)
                if not m or m.group(1)!=dong:continue
                kapt_candidates[matching._norm_name(h.get('name',''),dong)].append(h)
            for (_,_,apt,nid),c in entries:
                stats['complexesChecked']+=1
                if len(c['hh'])!=1:stats['householdConflict']+=1;continue
                hh=next(iter(c['hh']))
                prefixes=matching.region_prefixes_for(c['city'],c['gu'],dong)
                kh=matching.match_trade_names(kapt_candidates,apt,dong,reserved_qns=reserved,ambiguous_qns=ambiguous,region_prefixes=prefixes)
                kh={h.get('kaptCode') or h.get('kaptAddr'):h for h in kh}
                if len(kh)==1:
                    confirmed=next(iter(kh.values()))
                    if confirmed.get('hhcnt')!=hh:stats['householdMismatch']+=1;continue
                    stats['kaptHouseholdVerified']+=1
                else:
                    # K-apt 자료가 없는 지역은 aptsum에 이미 저장된 네이버 세대수와 비교.
                    # 이름이 달라 추측해야 하는 경우는 승인하지 않는다.
                    stored_hits=[v for v in stored.values() if v.get('umd')==dong and matching._norm_name(v.get('name',''),dong)==matching._norm_name(apt,dong)]
                    if len(stored_hits)!=1:stats['householdUnconfirmed']+=1;continue
                    if stored_hits[0].get('hh')!=hh:stats['householdMismatch']+=1;continue
                    stats['storedHouseholdVerified']+=1
                hits=matching.match_trade_names(candidates,apt,dong,reserved_qns=reserved,ambiguous_qns=ambiguous,region_prefixes=prefixes,legacy_candidates=old)
                if not hits:stats['nameUnmatched']+=1;continue
                stats['complexesMatched']+=1
                raw_names={h['apt'] for h in hits}
                for name in raw_names:owners[(lawd,name)].add(nid)
                for ex,supplies in c['areas'].items():
                    # 엑셀 면적은 네이버 응답의 정수 표기. 원본 실거래 면적을 다시 확인한다.
                    # 네이버 앱의 AreaConverter와 같은 평형 표기를 사용한다.
                    pys={math.floor(round(s*0.3025,10)+0.2) for s in supplies}
                    if len(pys)!=1:stats['ambiguousTypes']+=1;continue
                    # 공급면적이 여러 값이면 대표값을 추측하지 않는다.
                    if len(supplies)!=1:stats['multipleSupplyAreas']+=1;continue
                    supply=next(iter(supplies))
                    areas={(h['apt'],float(h['area'])) for h in hits if math.floor(float(h.get('area',0)))==ex}
                    if not areas:stats['areaUnmatched']+=1;continue
                    for name,area in areas:
                        if not (0<area<supply):continue
                        rounded=math.floor(area+0.5);k=(name,rounded)
                        item={'apt':name,'hh':hh,'exclusiveArea':area,'supplyArea':supply}
                        previous=outputs[lawd].get(k)
                        if previous is False:continue
                        if previous and (previous['hh']!=hh or math.floor(round(previous['supplyArea']*0.3025,10)+0.2)!=next(iter(pys))):
                            outputs[lawd][k]=False;stats['roundedAreaConflict']+=1
                        elif previous is None:outputs[lawd][k]=item
    args.out.mkdir(parents=True,exist_ok=True)
    for lawd, items in outputs.items():
        safe=[v for k,v in items.items() if v and len(owners[(lawd,k[0])])==1 and len(raw_dongs[(lawd,k[0])])==1]
        safe.sort(key=lambda v:(v['apt'],v['exclusiveArea']))
        (args.out/f'{lawd}.json').write_text(json.dumps(safe,ensure_ascii=False,separators=(',',':'))+'\n')
        stats['exportedTypes']+=len(safe)
    stats['regionFiles']=len(outputs)
    print(json.dumps(stats,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
