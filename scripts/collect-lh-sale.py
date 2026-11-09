#!/usr/bin/env python3
"""Collect public LH sale-housing notices from the official Open API."""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "lh-sale.json")
URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1"
KST = dt.timezone(dt.timedelta(hours=9))
REGIONS = {"11": "서울", "41": "경기", "28": "인천", "26": "부산"}


def parse_payload(payload):
    """Support both the LH dsList envelope and the standard data.go.kr envelope."""
    if isinstance(payload, list):
        for block in payload:
            if isinstance(block, dict):
                rows = block.get("dsList") or block.get("items")
                if isinstance(rows, list):
                    return rows
    if isinstance(payload, dict):
        rows = payload.get("dsList") or payload.get("items")
        if isinstance(rows, list):
            return rows
        response = payload.get("response", payload)
        body = response.get("body", {}) if isinstance(response, dict) else {}
        rows = body.get("items", []) if isinstance(body, dict) else []
        if isinstance(rows, dict):
            rows = rows.get("item", [])
        if isinstance(rows, dict):
            rows = [rows]
        if isinstance(rows, list):
            return rows
    raise RuntimeError("LH API 응답에서 공고 목록을 찾지 못했습니다.")


def get_page(key, region_code, page, posted_from, closing_until):
    params = {
        "ServiceKey": key,
        "PG_SZ": "100",
        "PAGE": str(page),
        "UPP_AIS_TP_CD": "05",  # 분양주택만 수집. 신혼희망타운(39) 및 임대주택 제외.
        "CNP_CD": region_code,
        "PAN_NT_ST_DT": posted_from,
        "CLSG_DT": closing_until,
        "_type": "json",
    }
    request = urllib.request.Request(
        URL + "?" + urllib.parse.urlencode(params),
        headers={"User-Agent": "aptsum-public-notice/1.0", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"LH API HTTP {error.code}: {detail}") from error
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError("LH API가 JSON이 아닌 응답을 반환했습니다: " + raw[:500]) from error
    rows = parse_payload(payload)
    # LH API의 오류 envelope도 JSON으로 반환될 수 있어 실제 목록 확인 전 오류를 드러낸다.
    if not rows and isinstance(payload, list):
        message = json.dumps(payload, ensure_ascii=False)[:500]
        if "ERROR" in message or "오류" in message:
            raise RuntimeError("LH API 오류: " + message)
    return rows


def first(row, *keys):
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def to_iso(value):
    match = re.search(r"(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})", str(value or ""))
    return f"{match.group(1)}-{match.group(2)}-{match.group(3)}" if match else ""


def normalize(row, region):
    pan_id = first(row, "PAN_ID", "pan_id")
    name = first(row, "PAN_NM", "pan_nm")
    if not pan_id or not name:
        return None
    notice_date = to_iso(first(row, "PAN_NT_ST_DT", "PAN_DT", "pan_dt"))
    deadline = to_iso(first(row, "CLSG_DT", "clsg_dt"))
    detail_url = first(row, "DTL_URL", "detail_url")
    if not detail_url.startswith("https://apply.lh.or.kr/"):
        return None
    return {
        "category": "lh-sale",
        "source": "LH청약플러스",
        "pblancNo": "LH-" + pan_id,
        "pan_id": pan_id,
        "name": name,
        "region": region,
        "address": first(row, "CNP_CD_NM", "cnp_cd_nm"),
        "notice_date": notice_date,
        "apply_start": None,
        "apply_end": deadline or None,
        "apply_period": "일정은 LH 공고문 확인",
        "announce_date": "공고문 확인",
        "total_units": None,
        "price_min": None,
        "price_max": None,
        "pan_status": first(row, "PAN_SS", "pan_ss"),
        "detail_url": detail_url,
        "apply_url": "",
        "units": [],
        "schedule": [],
    }


def main():
    key = os.environ.get("LH_DATA_GO_KR_KEY", "").strip()
    if not key:
        raise RuntimeError("LH_DATA_GO_KR_KEY 환경변수가 없습니다.")
    today = dt.datetime.now(KST).date()
    posted_from = (today - dt.timedelta(days=180)).strftime("%Y.%m.%d")
    closing_until = (today + dt.timedelta(days=180)).strftime("%Y.%m.%d")
    previous = {}
    try:
        for item in json.load(open(OUT, encoding="utf-8")).get("items", []):
            if item.get("pblancNo"):
                previous[item["pblancNo"]] = item
    except (OSError, ValueError):
        pass

    items = []
    for code, region in REGIONS.items():
        page = 1
        while True:
            rows = get_page(key, code, page, posted_from, closing_until)
            if not rows:
                break
            for row in rows:
                if first(row, "UPP_AIS_TP_CD", "upp_ais_tp_cd").zfill(2) != "05":
                    continue
                item = normalize(row, region)
                if item:
                    items.append(item)
            if len(rows) < 100:
                break
            page += 1
            time.sleep(0.15)
        print(f"{region}: {len(items)} 누적", file=sys.stderr)

    if not items:
        raise RuntimeError("LH 분양주택 공고가 0건입니다. 기존 파일은 유지합니다.")
    unique = {}
    for item in items:
        old = previous.get(item["pblancNo"], {})
        # API 목록에 공고 종료 시각 등 일부 값이 빠져 있을 때 저장된 보강값은 유지한다.
        for field in ("apply_start", "apply_end", "apply_period", "announce_date", "total_units", "price_min", "price_max", "units", "schedule"):
            if not item.get(field) and old.get(field):
                item[field] = old[field]
        unique[item["pblancNo"]] = item
    items = sorted(unique.values(), key=lambda item: (item.get("notice_date") or "", item["name"]), reverse=True)
    result = {
        "updated_at": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
        "source": "한국토지주택공사 LH청약플러스 공공데이터 API",
        "category_code": "05",
        "count": len(items),
        "items": items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    temporary = OUT + ".tmp"
    with open(temporary, "w", encoding="utf-8") as file:
        json.dump(result, file, ensure_ascii=False, separators=(",", ":"))
        file.write("\n")
    os.replace(temporary, OUT)
    print(f"wrote {len(items)} LH sale notices", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
