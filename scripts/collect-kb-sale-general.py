#!/usr/bin/env python3
"""Collect KB sale general prices by exact Naver complex ID from the master list."""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import math
import os
from pathlib import Path
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.kbland.kr"
TARGETS = ROOT / "data/kb-sale-general-targets.json"
OUTPUT = ROOT / "data/kb-sale-general.json"
PROVINCES = {"서울": "서울시", "경기": "경기도", "인천": "인천시", "부산": "부산시"}
LOCK = threading.Lock()
NEXT_REQUEST = 0.0
STOP = threading.Event()


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def api_get(path: str, params: dict[str, str], rate: float):
    global NEXT_REQUEST
    url = API + path + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        if STOP.is_set():
            raise RuntimeError("Collection stopped after KB access/rate restriction")
        with LOCK:
            delay = max(0.0, NEXT_REQUEST - time.monotonic())
            NEXT_REQUEST = max(NEXT_REQUEST, time.monotonic()) + 1.0 / rate
        if delay:
            time.sleep(delay)
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "Aptsum-KB-price-collector/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status != 200:
                    raise RuntimeError(f"KB HTTP {response.status}")
                payload = json.loads(response.read())
            code = str((payload.get("dataHeader") or {}).get("resultCode", ""))
            body = payload.get("dataBody")
            if code in {"10402", "10403", "10429"}:
                STOP.set()
                raise RuntimeError(f"KB access/rate restriction: {code}")
            if code not in {"10000", "33210"} or not isinstance(body, dict):
                raise RuntimeError(f"Unexpected KB response: {code or 'missing envelope'}")
            if str(body.get("resultCode", "")) not in {"", "11000", "33210"}:
                raise RuntimeError(f"KB data error: {body.get('resultCode')}")
            return body.get("data")
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 403, 429}:
                STOP.set()
                raise RuntimeError(f"KB access/rate restriction: HTTP {exc.code}") from exc
            error = exc
        except Exception as exc:
            if STOP.is_set():
                raise
            error = exc
        if attempt == 2:
            raise error
        time.sleep(2**attempt)


def collect_catalog(rate: float):
    regions = []
    for city, sido in PROVINCES.items():
        districts = api_get("/land-complex/map/siGunGuAreaNameList", {"시도명": sido}, rate)
        if not isinstance(districts, list) or not districts:
            raise RuntimeError(f"KB district list missing: {city}")
        for district in districts:
            district_name = district.get("시군구명")
            dongs = api_get("/land-complex/map/stutDongAreaNameList", {"시도명": sido, "시군구명": district_name}, rate)
            if not isinstance(dongs, list):
                if dongs is None:
                    continue
                raise RuntimeError(f"KB legal-dong list invalid: {city} {district_name}")
            regions.extend((city, district_name, dong) for dong in dongs)
    # A legal-dong code can appear under a boundary alias; query it only once.
    unique = {}
    for city, district, dong in regions:
        code = str(dong.get("법정동코드") or "")
        if code and code not in unique:
            unique[code] = (city, district, dong)
    return list(unique.values())


def collect_complex_ids(rate: float):
    dongs = collect_catalog(rate)
    complexes = {}
    errors = []

    def fetch(row):
        city, district, dong = row
        code = str(dong["법정동코드"])
        data = api_get("/land-complex/complexComm/hscmList", {"법정동코드": code}, rate)
        if data is None:
            return []
        if not isinstance(data, list):
            raise RuntimeError(f"KB complex list invalid: {code}")
        return [item for item in data if item.get("매물종별구분") == "01" and item.get("단지기본일련번호")]

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(fetch, row): row for row in dongs}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            city, district, dong = futures[future]
            try:
                for item in future.result():
                    cid = int(item["단지기본일련번호"])
                    complexes.setdefault(cid, {
                        "kbComplexId": cid,
                        "kbName": item.get("단지명") or "",
                        "city": city,
                        "district": district,
                        "dong": dong.get("법정동명") or "",
                    })
            except Exception as exc:
                errors.append({"legalDongCode": dong.get("법정동코드"), "error": str(exc)})
            if index % 100 == 0 or index == len(dongs):
                print(f"legal dongs {index}/{len(dongs)}; KB complexes {len(complexes)}; errors {len(errors)}", flush=True)
    if errors:
        raise RuntimeError(f"KB catalog incomplete ({len(errors)} legal-dong failures); no snapshot written")
    return list(complexes.values())


def number(value):
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) and parsed > 0 else None
    except (TypeError, ValueError):
        return None


def main():
    rate = float(os.getenv("KB_REQUESTS_PER_SECOND", "4"))
    workers = int(os.getenv("KB_WORKERS", "8"))
    targets_doc = json.loads(TARGETS.read_text(encoding="utf-8"))
    targets = {int(row["naverId"]): row for row in targets_doc["items"]}
    print(f"targets={len(targets)} rate={rate}/s", flush=True)
    complexes = collect_complex_ids(rate)
    print(f"catalog complexes={len(complexes)}", flush=True)

    def collect(row):
        cid = row["kbComplexId"]
        types = api_get("/land-complex/complex/typInfo", {"단지기본일련번호": str(cid)}, rate)
        if not isinstance(types, list) or not types:
            return None
        naver_ids = {int(t["네이버단지코드"]) for t in types if t.get("네이버단지코드") not in (None, "", 0, "0")}
        matched = naver_ids.intersection(targets)
        if not matched:
            return None
        if len(matched) != 1 or len(naver_ids) != 1:
            raise RuntimeError(f"KB-to-master mapping is ambiguous: KB {cid}, Naver IDs {sorted(naver_ids)}")
        naver_id = next(iter(matched))
        target = targets[naver_id]
        data = api_get("/land-complex/complex/mpriByType", {"단지기본일련번호": str(cid)}, rate)
        if not isinstance(data, list):
            raise RuntimeError(f"KB type price list invalid: {cid}")
        price_by_area = {int(t["면적일련번호"]): t for t in data if t.get("면적일련번호")}
        items = []
        for area in types:
            area_id = int(area.get("면적일련번호") or 0)
            if not area_id or int(area.get("네이버단지코드") or 0) != naver_id:
                continue
            raw = price_by_area.get(area_id, {})
            ai = any(str(source.get(key) or "0") == "1" for source in (raw, area) for key in ("AI시세여부", "단지AI시세여부", "50세대미만여부"))
            provided = bool(raw) and str(raw.get("시세제공여부") or "1") == "1"
            price = number(raw.get("매매일반거래가")) if provided and not ai else None
            supply_pyeong = number(area.get("공급면적평"))
            size_label = area.get("공급면적평N")
            if size_label in (None, "") and supply_pyeong is not None:
                size_label = math.floor(supply_pyeong)
            items.append({
                "kbAreaId": area_id,
                "type": str(size_label or "") + str(area.get("주택형타입내용") or ""),
                "supplyM2": number(area.get("공급면적")),
                "exclusiveM2": number(area.get("전용면적")),
                "supplyPyeong": supply_pyeong,
                "exclusivePyeong": number(area.get("전용면적평")),
                "households": area.get("세대수"),
                "saleGeneralManwon": price,
                "status": "kb_general" if price is not None else ("ai_excluded" if ai else "unavailable"),
            })
        return {
            "naverId": naver_id,
            "kbComplexId": cid,
            "name": target["name"],
            "city": target["city"],
            "district": target["district"],
            "dong": target["dong"],
            "kbName": row["kbName"],
            "url": f"https://kbland.kr/c/{cid}",
            "areas": sorted(items, key=lambda x: (x["supplyM2"] or 0, x["kbAreaId"])),
        }

    mapped = {}
    errors = []
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(collect, row): row for row in complexes}
        for index, future in enumerate(concurrent.futures.as_completed(futures), 1):
            row = futures[future]
            try:
                value = future.result()
                if value:
                    naver_id = value["naverId"]
                    if naver_id in mapped and mapped[naver_id]["kbComplexId"] != value["kbComplexId"]:
                        raise RuntimeError(f"Duplicate KB complexes for Naver ID {naver_id}")
                    mapped[naver_id] = value
            except Exception as exc:
                errors.append({"kbComplexId": row["kbComplexId"], "error": str(exc)})
                if STOP.is_set():
                    break
            if index % 250 == 0 or index == len(complexes):
                print(f"complexes {index}/{len(complexes)}; matched {len(mapped)}; errors {len(errors)}; elapsed {time.monotonic()-started:.0f}s", flush=True)

    # Keep the previous complete data intact if any catalog or price request failed.
    if errors or STOP.is_set():
        raise RuntimeError(f"KB price collection incomplete ({len(errors)} failures); previous snapshot preserved")
    unmatched = sorted(set(targets) - set(mapped))
    areas = [area for item in mapped.values() for area in item["areas"]]
    snapshot = {
        "schemaVersion": 1,
        "source": "KB부동산 매매 일반가",
        "scope": "전체_단지_매핑표 아파트 / 서울·경기·인천·부산",
        "collectedAt": now(),
        "kbReferenceDate": None,
        "targetComplexCount": len(targets),
        "matchedComplexCount": len(mapped),
        "unmatchedComplexCount": len(unmatched),
        "areaTypeCount": len(areas),
        "pricedAreaTypeCount": sum(x["saleGeneralManwon"] is not None for x in areas),
        "unmatchedNaverIds": unmatched,
        "complexes": sorted(mapped.values(), key=lambda x: (x["city"], x["district"], x["dong"], x["name"])),
    }
    temp = OUTPUT.with_suffix(".tmp")
    temp.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    temp.replace(OUTPUT)
    print(json.dumps({k: v for k, v in snapshot.items() if k not in {"complexes", "unmatchedNaverIds"}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
