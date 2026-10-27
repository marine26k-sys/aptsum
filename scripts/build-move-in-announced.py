#!/usr/bin/env python3
"""Build a persistent post-official-horizon move-in dataset from ApplyHome notices."""
import datetime as dt
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHEONGYAK = os.path.join(ROOT, 'data', 'cheongyak.json')
OFFICIAL = os.path.join(ROOT, 'data', 'move-in.json')
OUT = os.path.join(ROOT, 'data', 'move-in-announced.json')
REGIONS = {'서울', '경기', '인천', '부산'}
MIN_HOUSEHOLDS = 30


def read(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def clean_key(value):
    return ''.join(ch for ch in str(value or '').lower() if ch.isalnum())


def parse_month(value):
    match = re.fullmatch(r'(\d{4})[.\-](\d{1,2})', str(value or '').strip())
    if not match:
        return None
    year, month = int(match.group(1)), int(match.group(2))
    return f'{year:04d}-{month:02d}' if 1 <= month <= 12 else None


notices = read(CHEONGYAK, {})
official = read(OFFICIAL, {})
if not isinstance(notices.get('items'), list) or not isinstance(official.get('items'), list):
    raise SystemExit('청약홈 또는 공식 입주물량 자료를 읽지 못했습니다.')

official_end = max((str(row.get('month')) for row in official['items'] if row.get('month')), default='')
try:
    previous = read(OUT, {}).get('items', [])
except AttributeError:
    previous = []

by_project = {}
for item in previous if isinstance(previous, list) else []:
    key = item.get('projectKey')
    if key and item.get('month') and item['month'] > official_end:
        by_project[key] = item

for row in notices['items']:
    # 전체 단지 규모를 제공하는 최초 APT 모집공고만 반영한다.
    # 무순위/잔여세대 공고는 해당 단지의 일부 세대 재공급이므로 제외한다.
    if row.get('category') != 'apt' or row.get('region') not in REGIONS:
        continue
    month = parse_month(row.get('move_in'))
    if not month or (official_end and month <= official_end):
        continue
    units = row.get('total_units')
    if not isinstance(units, (int, float)) or units <= 0:
        units = sum((unit.get('total') or 0) for unit in row.get('units', []) if isinstance(unit, dict))
    if not isinstance(units, (int, float)) or units < MIN_HOUSEHOLDS:
        continue
    name = str(row.get('name') or '').strip()
    address = str(row.get('address') or '').strip()
    if not name:
        continue
    key = '|'.join((row['region'], clean_key(name), clean_key(address)))
    item = {
        'projectKey': key,
        'pblancNo': str(row.get('pblancNo') or ''),
        'month': month,
        'region': row['region'],
        'type': row.get('sale_kind') or row.get('house_kind') or 'APT 분양공고',
        'address': address,
        'name': name,
        'households': int(units),
        'noticeDate': row.get('notice_date') or '',
        'detailUrl': row.get('detail_url') or '',
        'source': '한국부동산원 청약홈 APT 모집공고',
    }
    old = by_project.get(key)
    if not old or (item['noticeDate'], item['pblancNo']) >= (old.get('noticeDate', ''), old.get('pblancNo', '')):
        by_project[key] = item

items = sorted(by_project.values(), key=lambda x: (x['month'], x['region'], x['name']))
output = {
    'source': '한국부동산원 청약홈 APT 분양공고',
    'sourceAsOf': notices.get('updated_at', ''),
    'officialCoverageEnd': official_end,
    'householdMinimum': MIN_HOUSEHOLDS,
    'regions': sorted(REGIONS),
    'updatedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
    'items': items,
}
with open(OUT + '.tmp', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')
os.replace(OUT + '.tmp', OUT)
print(f"청약홈 공고 기반 입주예정 {len(items)}개 단지, 공식 전망 종료 {official_end or '미확인'}")
