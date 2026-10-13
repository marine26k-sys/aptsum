#!/usr/bin/env python3
"""Import factual nearby-school distances from an operator-supplied wooahakgun archive.
Usage: python3 scripts/import-nearby-schools.py ARCHIVE REGIONS_JSON
REGIONS_JSON: JSON export of shared/regions.mjs REGIONS and SPLIT_REGIONS.
"""
import sys,json,zipfile,re,math
from pathlib import Path
from collections import defaultdict

def norm_region(s):
    return re.sub(r'시(?=\S*구$)','',re.sub(r'\s+','',s))
def main():
    archive,regions_file=sys.argv[1:3]
    config=json.loads(Path(regions_file).read_text())
    lookup={(si,norm_region(gu)):code for si,rows in config['REGIONS'] for gu,code in rows}
    groups=defaultdict(list)
    with zipfile.ZipFile(archive) as z:
        root=next(n for n in z.namelist() if n.endswith('/_rawdata/schools.json'))
        schools=json.loads(z.read(root))
        for filename in z.namelist():
            if '/_rawdata/apts_' not in filename or not filename.endswith('.json'):continue
            for apt in json.loads(z.read(filename)):
                lawd=lookup.get((apt['do'],norm_region(apt['sg'])))
                if not lawd and apt['do']=='경기':
                    for prefix,city in [('HS-','화성'),('BC-','부천')]:
                        if apt['sg'].startswith(city):
                            for district,dongs in config['SPLIT_REGIONS'][prefix]['dongs'].items():
                                if apt.get('dong') in dongs:lawd=prefix+district;break
                if not lawd:continue
                nearby=[]
                for level in ['초','중','고']:
                    for index,distance in apt.get('ns',{}).get(level,[])[:3]:
                        if not isinstance(index,int) or not 0<=index<len(schools) or not 0<=distance<=3000:continue
                        school=schools[index]
                        if school.get('lv')!=level:continue
                        nearby.append({'id':school['id'],'name':school['name'],'level':level,'distance':distance,'type':school.get('type',''),'lat':school.get('lat'),'lng':school.get('lng')})
                if not nearby:continue
                groups[lawd].append({'name':apt['name'],'umd':apt.get('dong',''),'kaptCode':apt['key'][2:] if apt['key'].startswith('K:') else None,'hh':apt.get('ho',0),'lat':apt.get('lat'),'lng':apt.get('lng'),'schools':nearby})
    grid=defaultdict(list)
    records=[(code,apt) for code,items in groups.items() for apt in items if isinstance(apt.get('lat'),(int,float)) and isinstance(apt.get('lng'),(int,float))]
    for code,apt in records:grid[(int(apt['lat']/0.02),int(apt['lng']/0.02))].append((code,apt))
    for code,apt in records:
        gy,gx=int(apt['lat']/0.02),int(apt['lng']/0.02)
        candidates=[];seen=set()
        for dy in [-1,0,1]:
            for dx in [-1,0,1]:
                for other_code,other in grid[(gy+dy,gx+dx)]:
                    if other is apt:continue
                    key=(other_code,re.sub(r'\s|아파트$','',other['name']),other['umd'])
                    if key==(code,re.sub(r'\s|아파트$','',apt['name']),apt['umd']) or key in seen:continue
                    lat1,lat2=math.radians(apt['lat']),math.radians(other['lat'])
                    h=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(other['lng']-apt['lng'])/2)**2
                    distance=round(12742000*math.asin(min(1,math.sqrt(h))))
                    if distance>1000:continue
                    seen.add(key)
                    candidates.append({k:other[k] for k in ['name','umd','hh','lat','lng']}|{'lawd':other_code,'distance':distance})
        apt['nearby']=sorted(candidates,key=lambda x:x['distance'])[:15]
    out=Path(__file__).resolve().parents[1]/'data'/'nearby-schools';out.mkdir(exist_ok=True)
    for code,items in groups.items():
        (out/(code+'.json')).write_text(json.dumps({'source':'운영자 제공 wooahakgun 자료','asOf':'2026-10-13','distanceKind':'straight','items':items},ensure_ascii=False,separators=(',',':')))
    print(json.dumps({'regions':len(groups),'complexes':sum(map(len,groups.values()))},ensure_ascii=False))
if __name__=='__main__':main()
