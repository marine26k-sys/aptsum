#!/usr/bin/env python3
"""로컬 네이버 매칭표(우선) 또는 엑셀에서 검증된 네 항목만 추출한다.
원본·가격·링크·단지ID는 출력하지 않는다.
naver의 기존 비교 함수를 직접 사용하고 K-apt/기존 aptsum 세대수 일치를 검증한다.
사용: bundled-python scripts/import-naver-supply-area.py --mapping <json> --naver-root ../naver
구형 엑셀: --mapping 대신 --workbook <xlsx>
이전 엑셀에만 있던 검증값도 유지하려면 --previous data/supply-area-naver 를 지정한다.
"""
import argparse, collections, json, math, re, sys
from pathlib import Path
import openpyxl

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--workbook', type=Path)
    source.add_argument('--mapping', type=Path)
    parser.add_argument('--naver-root', required=True, type=Path)
    parser.add_argument('--out', type=Path, default=Path('data/supply-area-naver'))
    parser.add_argument('--previous', type=Path)
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
    complexes = {}; stats = collections.Counter()
    if args.mapping:
        source_data = json.loads(args.mapping.read_text())
        if source_data.get('schema_version') != 1 or not isinstance(source_data.get('complexes'), dict):
            parser.error('지원하지 않는 네이버 매칭표 형식')
        if source_data.get('supply_pyeong_rule') != 'floor(supply_area * 0.3025)':
            parser.error('지원하지 않는 공급평형 계산 규칙')
        for nid, entry in source_data['complexes'].items():
            region = entry.get('region') or {}
            city, gu, dong = region.get('시'), region.get('구'), region.get('법정동')
            lawd = regions.get((city, gu))
            for row in (entry.get('areas') or {}).values():
                stats['sourceRows'] += 1
                if row.get('status') != 'confirmed':
                    stats['unconfirmedRows'] += 1; continue
                try:
                    ex = float(row['exclusive_area']); supply = float(row['supply_area']); hh = int(entry['households'])
                except (ValueError, TypeError, KeyError):
                    stats['invalidRows'] += 1; continue
                if not lawd or not dong or not entry.get('name') or not all(math.isfinite(v) for v in (ex, supply)) or not (0 < ex < supply and hh > 0):
                    stats['invalidRows'] += 1; continue
                key = (lawd, str(dong), str(entry['name']), str(nid))
                c = complexes.setdefault(key, {'hh':set(), 'areas':collections.defaultdict(set), 'city':city, 'gu':gu})
                c['hh'].add(hh); c['areas'][ex].add(supply)
    else:
        book = openpyxl.load_workbook(args.workbook, read_only=True, data_only=True)
        rows = book.active.iter_rows(values_only=True); headers = next(rows)
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
    def area_matches(actual, source):
        if args.mapping:
            return math.floor(float(actual)*100+0.5) == math.floor(source*100+0.5)
        return math.floor(float(actual)) == source
    raw_dongs = collections.defaultdict(set)
    by_dong = collections.defaultdict(list)
    for key, c in complexes.items(): by_dong[key[:2]].append((key,c))
    outputs = collections.defaultdict(dict); owners = collections.defaultdict(set)
    observed_types = set(); retained_types = set(); current_areas = collections.defaultdict(set)
    verified_hh = collections.defaultdict(set)
    for lawd in sorted({key[0] for key in complexes}):
        grouped={};legacy={}
        for kind in ('analyze','presale','rent'):
            loaded=matching.collect_sigungu_trades(root/'data'/kind/lawd, '202311', presale=kind=='presale', legacy_out=legacy)
            for key, values in loaded.items(): grouped.setdefault(key,[]).extend(values)
        for (_dong,_name),values in grouped.items():
            for value in values:
                raw_dongs[(lawd,value['apt'])].add(value.get('umd',''))
                current_areas[(lawd,value['apt'])].add(math.floor(float(value['area'])+0.5))
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
                hits=matching.match_trade_names(candidates,apt,dong,reserved_qns=reserved,ambiguous_qns=ambiguous,region_prefixes=prefixes,legacy_candidates=old)
                # 최신 자료에서 보였지만 검증에 실패한 타입은 예전 결과로 되살리지 않는다.
                for ex in c['areas']:
                    for h in hits:
                        area=float(h.get('area',0))
                        if area_matches(area,ex):
                            observed_types.add((lawd,h['apt'],round(area,2) if args.mapping else math.floor(area+0.5)))
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
                if not hits:stats['nameUnmatched']+=1;continue
                stats['complexesMatched']+=1
                raw_names={h['apt'] for h in hits}
                for name in raw_names:
                    owners[(lawd,name)].add(nid)
                    verified_hh[(lawd,name)].add(hh)
                for ex,supplies in c['areas'].items():
                    areas={(h['apt'],float(h['area'])) for h in hits if area_matches(h.get('area',0),ex)}
                    # 엑셀 면적은 네이버 응답의 정수 표기. 원본 실거래 면적을 다시 확인한다.
                    # 개정 매칭표의 공급평형 계산 규칙을 사용한다.
                    pys={math.floor(s*0.3025) for s in supplies}
                    if len(pys)!=1:stats['ambiguousTypes']+=1;continue
                    # 서로 다른 타입의 실제 공급면적이어도 표시 평형이 같으면
                    # 이 파일의 용도(평형 라벨 보정)에는 모호함이 없다.
                    # 가장 작은 실측 공급면적을 결정적인 대표값으로 저장한다.
                    if len(supplies)>1:stats['samePyeongSupplyAreas']+=1
                    supply=min(supplies)
                    if not areas:stats['areaUnmatched']+=1;continue
                    for name,area in sorted(areas):
                        if not (0<area<supply):continue
                        rounded=math.floor(area+0.5);k=(name,ex if args.mapping else rounded)
                        item={'apt':name,'hh':hh,'exclusiveArea':ex if args.mapping else area,'supplyArea':supply}
                        previous=outputs[lawd].get(k)
                        if previous is False:continue
                        if previous and (previous['hh']!=hh or math.floor(previous['supplyArea']*0.3025)!=next(iter(pys))):
                            outputs[lawd][k]=False;stats['roundedAreaConflict']+=1
                        elif previous is None:outputs[lawd][k]=item
    if args.previous:
        for file in args.previous.glob('*.json'):
            lawd=file.stem
            for row in json.loads(file.read_text()):
                name=row['apt'];rounded=math.floor(row['exclusiveArea']+0.5)
                area_key=round(row['exclusiveArea'],2) if args.mapping else rounded
                key=(name,area_key)
                # 우선 자료에 같은 타입이 있으면 그 판정(충돌·제외 포함)을 존중한다.
                if key in outputs[lawd] or (lawd,name,area_key) in observed_types:continue
                if rounded not in current_areas[(lawd,name)]:continue
                if len(raw_dongs[(lawd,name)])!=1 or len(owners[(lawd,name)])>1:continue
                if verified_hh[(lawd,name)] and verified_hh[(lawd,name)]!={row['hh']}:continue
                if not (row['hh']>0 and row['supplyArea']>row['exclusiveArea']>0):continue
                outputs[lawd][key]=row
                retained_types.add((lawd,name,area_key))
                stats['previousTypesRetained']+=1
    args.out.mkdir(parents=True,exist_ok=True)
    for lawd, items in outputs.items():
        safe=[v for k,v in items.items() if v and (len(owners[(lawd,k[0])])==1 or (lawd,*k) in retained_types) and len(raw_dongs[(lawd,k[0])])==1]
        safe.sort(key=lambda v:(v['apt'],v['exclusiveArea']))
        (args.out/f'{lawd}.json').write_text(json.dumps(safe,ensure_ascii=False,separators=(',',':'))+'\n')
        stats['exportedTypes']+=len(safe)
    stats['regionFiles']=len(outputs)
    print(json.dumps(stats,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
