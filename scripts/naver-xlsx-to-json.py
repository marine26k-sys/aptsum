#!/usr/bin/env python3
# 운영자 제공 네이버 단지 매핑표(엑셀)를 build-naver-names.mjs 입력용 JSON 배열로 바꾼다.
# 엑셀 원본·변환된 JSON은 저장소에 올리지 않는다(결과물 data/naver-names/만 커밋).
#   python3 scripts/naver-xlsx-to-json.py <엑셀> <출력.json>
import json, sys
import openpyxl

src, dst = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(src, read_only=True).active
rows = list(ws.iter_rows(values_only=True))
header = rows[0]
out = [dict(zip(header, r)) for r in rows[1:] if any(r)]
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"{len(out)}개 단지 → {dst}")
