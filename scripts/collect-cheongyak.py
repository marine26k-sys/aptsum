#!/usr/bin/env python3
"""청약홈(applyhome.co.kr) 분양정보를 수집해 data/listings.json 으로 저장한다.

수집 대상
  - APT 분양정보 (특별공급·1순위·2순위)
  - APT 무순위/잔여세대/계약취소/불법행위 재공급
  - 오피스텔/생활숙박시설/도시형생활주택/민간임대
외부 패키지 없이 표준 라이브러리만 사용한다.
"""
import html
import json
import os
import re
import sys
import time
import datetime as dt
import urllib.request
import urllib.parse

BASE = "https://www.applyhome.co.kr"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "cheongyak.json")

LISTS = {
    "apt": {
        "list": "/ai/aia/selectAPTLttotPblancListView.do",
        "detail": "/ai/aia/selectAPTLttotPblancDetail.do",
        "apply": "/ap/aph/reqst/selectSubscrtReqstAptMainView.do",
        "cols": ["region", "house_kind", "sale_kind", "name", "builder", "phone", "notice_date", "apply_period", "announce_date"],
    },
    "remainder": {
        "list": "/ai/aia/selectAPTRemndrLttotPblancListView.do",
        "detail": "/ai/aia/selectAPTRemndrLttotPblancDetailView.do",
        "apply": "/ap/apr/reqst/selectSubscrtReqstAptMainView.do",
        "cols": ["region", "supply_kind", "name", "builder", "notice_date", "apply_period", "announce_date"],
    },
    "other": {
        "list": "/ai/aia/selectOtherLttotPblancListView.do",
        "detail": "/ai/aia/selectPRMOLttotPblancDetailView.do",
        "apply": "/ap/apb/reqst/selectSubscrtReqstUOMainView.do",
        "cols": ["region", "house_kind", "name", "builder", "phone", "notice_date", "apply_period", "announce_date"],
    },
}

CAPITAL = {"서울", "경기", "인천"}
METRO = {"부산", "대구", "대전", "광주", "울산", "세종"}


def get(url, params=None, retries=2):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def strip_tags(s):
    s = re.sub(r"<[^>]+>", " ", s)
    return html.unescape(re.sub(r"\s+", " ", s)).strip()


def parse_rows(page_html, cols):
    i = page_html.find("<tbody")
    j = page_html.find("</tbody>", i)
    if i < 0 or j < 0:
        return []
    rows = []
    for tr in re.findall(r"<tr[^>]*>.*?</tr>", page_html[i:j], re.S):
        attrs = dict(re.findall(r'data-(\w+)="([^"]*)"', tr[: tr.find(">")]))
        tds = [strip_tags(td) for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if "pbno" not in attrs or len(tds) < len(cols):
            continue
        row = {"pblancNo": attrs.get("pbno"), "houseManageNo": attrs.get("hmno"), "houseSecd": attrs.get("hsecd", "")}
        for k, v in zip(cols, tds):
            row[k] = v
        row["name"] = attrs.get("honm") or row.get("name", "")
        row["phone"] = re.sub(r"^☎\s*", "", row.get("phone", "")) if row.get("phone") else ""
        rows.append(row)
    return rows


def text_of(page_html):
    t = re.sub(r"<script.*?</script>", "", page_html, flags=re.S)
    t = re.sub(r"<style.*?</style>", "", t, flags=re.S)
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    return t


TYPE_RE = re.compile(r"^\d{2,3}\.\d{2,4}\s*[A-Za-z]?$")
AREA_RE = re.compile(r"^\d{2,3}\.\d{2,4}$")
MONEY_RE = re.compile(r"^\d{1,3}(,\d{3})+$")
INT_RE = re.compile(r"^\d{1,6}$")
MODEL_RE = re.compile(r"^\d{8,}\(\d+\)$")
MONTH_RE = re.compile(r"^\d{4}[.\-]\d{1,2}$")


def tables(page_html):
    out = []
    for tb in re.findall(r"<table[^>]*>.*?</table>", page_html, re.S):
        cap = re.search(r"<caption[^>]*>(.*?)</caption>", tb, re.S)
        cap = strip_tags(cap.group(1)) if cap else ""
        ths = [strip_tags(c) for c in re.findall(r"<th[^>]*>(.*?)</th>", tb, re.S)]
        body = tb[tb.find("<tbody"):] if "<tbody" in tb else tb
        rows = []
        for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
            cells = [strip_tags(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
            if cells:
                rows.append(cells)
        out.append((cap, ths, rows))
    return out


def parse_detail(page_html, category):
    t = text_of(page_html)
    d = {"address": "", "total_units_text": "", "total_units": None, "contract_period": "",
         "homepage": "", "move_in": "", "schedule": [], "units": [], "prices": {}}
    units = {}
    order = []

    def unit(key):
        if key not in units:
            units[key] = {"type": key}
            order.append(key)
        return units[key]

    for cap, ths, rows in tables(t):
        if "주요정보" in cap:
            for r in rows:
                if len(r) >= 2 and r[0].startswith("공급위치"):
                    d["address"] = r[1]
                elif len(r) >= 2 and r[0].startswith("공급규모"):
                    d["total_units_text"] = r[1]
            continue
        if "청약일정" in cap:
            for r in rows:
                label = r[0]
                if label.startswith("모집공고일") or label == "청약접수" and len(r) > 2:
                    continue
                if label.startswith("당첨자"):
                    hm = re.search(r"https?://[^\s)]+", " ".join(r[1:]))
                    d["homepage"] = hm.group(0) if hm else ""
                    continue
                if label.startswith("계약일"):
                    d["contract_period"] = " ".join(r[1:]).strip()
                    continue
                dates = [c for c in r[1:] if re.search(r"\d{4}-\d{2}-\d{2}", c)]
                if dates:
                    d["schedule"].append({"label": label, "dates": dates})
            continue
        if "특별공급" in cap or "기타사항" in cap:
            continue
        # 주택형 단위 표 (공급대상 / 공급금액 / 주택형·세대수·분양가 통합표)
        type_col = ths.index("타입") if "타입" in ths else None
        is_price_table = ("공급금액" in cap) or any("공급금액" in h or "분양가" in h for h in ths)
        for r in rows:
            if not r or r[0] == "계":
                continue
            key = None
            if type_col is not None:
                # 2단 헤더가 아니므로 셀과 헤더가 정렬됨. rowspan 으로 앞 셀이 빠지면 오른쪽 정렬
                off = len(ths) - len(r)
                idx = type_col - off
                if 0 <= idx < len(r):
                    key = r[idx]
                    rest = r[idx + 1:]
            else:
                tp = next((c for c in r if TYPE_RE.match(c)), None)
                if tp:
                    key = tp.strip()
                    rest = r[r.index(tp) + 1:]
            if not key or key in ("-", "계"):
                continue
            u = unit(key)
            area = next((c for c in rest if AREA_RE.match(c)), None)
            if area and "area" not in u:
                u["area"] = float(area)
            moneys = [int(c.replace(",", "")) for c in rest if MONEY_RE.match(c)]
            ints = [int(c) for c in rest if INT_RE.match(c) and not MODEL_RE.match(c) and c != area]
            months = [c for c in rest if MONTH_RE.match(c)]
            if months and not d["move_in"]:
                d["move_in"] = months[0].replace("-", ".")
            if is_price_table:
                if moneys:
                    u["price"] = moneys[0]
                elif ints and ints[0] >= 1000:
                    u["price"] = ints[0]
                if any("공급세대수" in h for h in ths) and ints and "total" not in u:
                    u["total"] = ints[0]
                continue
            if moneys and "price" not in u:
                u["price"] = moneys[0]
            if category == "other":
                if ints:
                    u["total"] = ints[0]
            elif len(ints) >= 3:
                u["general"], u["special"], u["total"] = ints[0], ints[1], ints[2]
            elif ints:
                u["total"] = ints[0]
    m = re.search(r"입주예정월\s*[:：]?\s*([0-9]{4}[.\-][0-9]{1,2})", strip_tags(t))
    if m and not d["move_in"]:
        d["move_in"] = m.group(1).replace("-", ".")
    m = re.search(r"(\d[\d,]*)\s*세대", d["total_units_text"])
    d["total_units"] = int(m.group(1).replace(",", "")) if m else None
    for k in order:
        u = units[k]
        if "price" in u:
            d["prices"][k] = u["price"]
            m = re.match(r"(\d{2,3}\.\d+)", k)
            area = float(m.group(1)) if m else u.get("area")
            if area:
                u["price_per_pyeong"] = round(u["price"] / (area / 3.3058))
    d["units"] = [units[k] for k in order]
    pv = [u["price"] for u in d["units"] if "price" in u]
    d["price_min"] = min(pv) if pv else None
    d["price_max"] = max(pv) if pv else None
    if d["total_units"] is None and d["units"]:
        tot = sum(u.get("total", 0) or 0 for u in d["units"])
        d["total_units"] = tot or None
    return d


HGNN_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"


def parse_period(s):
    m = re.findall(r"\d{4}-\d{2}-\d{2}", s or "")
    if not m:
        return None, None
    return m[0], m[-1]


# 청약 데일리의 청약홈 HTML 파서를 참고. 화면·데이터 계약은 aptsum에 맞춰 구성한다.
KST = dt.timezone(dt.timedelta(hours=9))

def main():
    today = dt.datetime.now(KST).date()
    keep_after = (today - dt.timedelta(days=45)).isoformat()
    previous = {}
    try:
        for row in json.load(open(OUT, encoding="utf-8"))["items"]:
            previous[(row["category"], row["pblancNo"])] = row
    except (OSError, ValueError, KeyError):
        pass
    items = []
    failures = []
    for category, config in LISTS.items():
        seen = set()
        for page in range(1, 15):
            rows = parse_rows(get(BASE + config["list"], {"pageIndex": page}), config["cols"])
            rows = [r for r in rows if r["pblancNo"] not in seen]
            if not rows:
                if page == 1:
                    raise RuntimeError(f"{category}: 목록을 읽지 못했습니다. 기존 데이터를 유지합니다.")
                break
            old_page = True
            for row in rows:
                seen.add(row["pblancNo"])
                start, end = parse_period(row.get("apply_period"))
                if end and end < keep_after:
                    continue
                old_page = False
                if row.get("region") not in {"서울", "경기", "인천", "부산"}:
                    continue
                row.update(category=category, apply_start=start, apply_end=end)
                params = {"houseManageNo": row["houseManageNo"], "pblancNo": row["pblancNo"]}
                if row.get("houseSecd"):
                    params["houseSecd"] = row["houseSecd"]
                row["detail_url"] = BASE + config["detail"] + "?" + urllib.parse.urlencode(params)
                row["apply_url"] = BASE + config["apply"]
                try:
                    row.update(parse_detail(get(row["detail_url"]), category))
                except Exception as error:
                    old = previous.get((category, row["pblancNo"]), {})
                    for key in ("address", "total_units", "move_in", "schedule", "units", "price_min", "price_max", "contract_period"):
                        if key in old:
                            row[key] = old[key]
                    failures.append(f"{category}:{row['pblancNo']}")
                    print("detail failed", row["name"], error, file=sys.stderr)
                # 공식 공급 금액만 보관하며 외부 시세·투자 점수는 수집하지 않는다.
                for unit in row.get("units", []):
                    unit.pop("price_per_pyeong", None)
                items.append(row)
                time.sleep(0.2)
            if old_page:
                break
            time.sleep(0.3)
        print(category, len([r for r in items if r["category"] == category]), file=sys.stderr)
    if not items:
        raise RuntimeError("빈 결과로 기존 데이터를 덮어쓰지 않습니다.")
    out = {"updated_at": dt.datetime.now(KST).strftime("%Y-%m-%d %H:%M KST"),
           "source": "한국부동산원 청약홈", "count": len(items), "detail_failures": failures, "items": items}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    temporary = OUT + ".tmp"
    with open(temporary, "w", encoding="utf-8") as file:
        json.dump(out, file, ensure_ascii=False, separators=(",", ":"))
        file.write("\n")
    os.replace(temporary, OUT)
    print("wrote", len(items), file=sys.stderr)

if __name__ == "__main__":
    main()
