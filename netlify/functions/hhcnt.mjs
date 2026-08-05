// Netlify Function — 국토교통부 공동주택 단지목록/기본정보 API로 세대수 조회
// 매매·분양권 실거래 API(analyze.mjs/presale.mjs)와는 완전히 다른 별도 API 군(둘 다 JSON 응답):
//   1) AptListService3/getSigunguAptList3: 시군구코드 → 그 구에 등록된 단지의 kaptCode 목록
//   2) AptBasisInfoServiceV4/getAphusBassInfoV4: kaptCode → 세대수(kaptdaCnt)·동수·사용승인일 등
// (2026.07 data.go.kr 활용신청 승인 스펙 기준으로 V2/V3→V3/V4 갱신, XML→JSON 전환)
// K-apt(공동주택관리정보시스템) 가입 단지만 나오므로, 여기 없는 단지는 세대수를 못 찾을 수 있음
// (의무관리대상 미달 소규모 단지 등) — 매칭 실패 시 조용히 세대수만 비워서 반환, 나머지 분석엔 영향 없음
// 환경변수: DATA_GO_KR_KEY(필수, analyze.mjs·presale.mjs와 공용)

export const config = {
  path: "/api/hhcnt",
};

const LIST_URL = "https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3";
const BASIS_URL = "https://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4";

// analyze.mjs의 SPLIT_REGIONS와 동일한 신규 구코드 매핑(목록조회는 단일 코드만 필요하므로 신규코드 우선,
// 화성·부천은 통합 폐지코드로 폴백 — K-apt 등록정보가 아직 옛 구코드에 남아있을 수 있어서)
const SPLIT_FALLBACK = {
  "HS-": { codes: { "동탄구": "41597", "만세구": "41591", "병점구": "41595", "효행구": "41593" }, old: "41590" },
  "BC-": { codes: { "원미구": "41192", "소사구": "41194", "오정구": "41196" }, old: "41190" },
  // 인천은 옛 구를 쪼개거나 합치는 비대칭 구조라 단일 폴백 코드가 없음 — 신규코드만 시도
  "IC-": { codes: { "제물포구": "28125", "영종구": "28155", "서해구": "28275", "검단구": "28290" }, old: null },
};

function resolveSigungu(lawd) {
  if (/^\d{5}$/.test(lawd)) return [lawd];
  const prefix = Object.keys(SPLIT_FALLBACK).find((p) => lawd.startsWith(p));
  if (!prefix) return [];
  const cfg = SPLIT_FALLBACK[prefix];
  const code = cfg.codes[lawd.slice(prefix.length)];
  if (!code) return [];
  return cfg.old ? [code, cfg.old] : [code];
}

// data.go.kr 표준 JSON 포맷: { response: { header:{resultCode,resultMsg}, body:{ items:{item:[...]}|{item:{...}}|"" , totalCount } } }
// 결과가 0건일 때 items가 빈 문자열("")로 오는 경우가 있어(빈 객체가 아님) 그 경우도 안전하게 []로 처리
function extractItems(json) {
  const body = json && json.response && json.response.body;
  if (!body) return null; // header/body 구조 자체가 없으면 파싱 실패로 취급(에러 응답일 가능성)
  // getAphusBassInfoV4는 body.item(단수, 객체 하나)을 쓰고, getSigunguAptList3는 body.items(배열)를 씀 — 둘 다 지원
  if (body.item && !body.items) return [body.item];
  const items = body.items;
  if (!items) return [];
  if (typeof items === "string") return []; // items:"" (결과 없음)
  if (Array.isArray(items)) return items; // V3/V4: items가 배열 그대로 옴(구버전 items:{item:[...]}와 다름)
  const item = items.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

async function fetchList(key, sgg) {
  try {
    const r = await fetch(`${LIST_URL}?serviceKey=${encodeURIComponent(key)}&sigunguCode=${sgg}&pageNo=1&numOfRows=1000&_type=json`);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error(`[hhcnt] getSigunguAptList3(${sgg}) JSON 파싱 실패. 응답 앞부분:`, text.slice(0, 500));
      return [];
    }
    const header = json && json.response && json.response.header;
    const rawItems = extractItems(json);
    // 임시 디버그: 결과가 비어있으면(정상 빈 목록인지, header에 에러가 실려있는지 구분 안 되므로) 무조건 원문 남김
    if (!rawItems || !rawItems.length) {
      console.error(`[hhcnt] getSigunguAptList3(${sgg}) 빈 결과. HTTP ${r.status}, header:`, JSON.stringify(header), "응답 앞부분:", text.slice(0, 500));
      return [];
    }
    const items = rawItems
      .map((it) => ({ kaptCode: it.kaptCode || it.kaptcode || "", kaptName: it.kaptName || it.kaptname || "" }))
      .filter((it) => it.kaptCode && it.kaptName);
    if (!items.length) {
      // 아이템은 왔는데 필드명이 예상(kaptCode/kaptName)과 다른 경우 — 실제 필드명을 로그로 확인
      console.error(`[hhcnt] getSigunguAptList3(${sgg}) 필드명 불일치. 첫 항목:`, JSON.stringify(rawItems[0]).slice(0, 300));
    }
    return items;
  } catch (e) {
    console.error(`[hhcnt] getSigunguAptList3(${sgg}) fetch 실패:`, e.message);
    return [];
  }
}

// analyzeComplex의 matchComplex와 동일한 방식(정확 일치 → 부분 포함)으로 단지명 매칭.
// 반환값은 "합산해야 할 후보들의 배열" — 대개 1개뿐이지만, 실거래 데이터의 단지명은 "두산"처럼
// 포괄적인데 K-apt엔 "두산1차"/"두산2차"처럼 블록을 나눠 따로 등록된 경우(예: 봉천동 두산아파트 —
// 실거래상 한 단지로 묶여 거래되는데 세대수는 그중 한 블록만 잡혀 실제보다 훨씬 작게 나오는 문제가 있었음),
// 후보 중 하나만 골라 반환하면 세대수가 부당하게 작게 나온다. 검색어로 시작하고 남는 꼬리가 짧으면서
// 숫자를 포함하는("1차","2단지" 등) "형제 단지" 패턴이 여럿 감지되면 전부 합산 대상으로 반환한다(2026.08).
function matchKapt(list, name) {
  const qn = name.replace(/\s/g, "");
  // v108에서 "임대 후보 배제"를 부분일치(cand) 단계에만 넣었었는데, 정확 일치(exact)가 먼저 return돼버려서
  // 정확히 일치하는 이름이 하필 임대 동일 때(예: 두산3단지가 K-apt에 정확히 "두산"으로 등록돼 있고,
  // 매매 대상인 1·2단지는 "두산1,2단지"처럼 다른 이름으로 등록돼 있는 경우) v108 수정이 전혀 적용되지
  // 않는 문제가 있었다 — 정확/부분일치를 가리지 않고 후보를 다 모은 뒤 임대부터 배제하고,
  // 그 다음에 정확 일치를 우선하도록 순서를 바꿈.
  let cand = list.filter((a) => {
    const an = a.kaptName.replace(/\s/g, "");
    return an && (an === qn || an.includes(qn) || qn.includes(an));
  });
  if (!cand.length) return [];
  // 디버그: 후보가 2개 이상(이름이 겹치는 단지가 여러 개)이면, 실제 K-apt 등록 이름이 어떻게 돼 있는지
  // 매칭 로직을 또 고칠 일이 생길 때 바로 확인할 수 있게 로그로 남겨둔다(Netlify 함수 로그에서 확인 가능).
  if (cand.length > 1) {
    console.error(`[hhcnt] "${name}" 매칭 후보 ${cand.length}건:`, JSON.stringify(cand.map((a) => a.kaptName)));
  }
  // 매매 실거래(analyze.mjs)에서 나온 단지명을 세대수와 매칭하는 함수이므로, 후보 중 임대 세대만
  // 있는 단지(예: "두산3단지"가 임대, "두산1,2단지"가 일반분양인 봉천 두산아파트처럼 같은 이름을 쓰는
  // 임대·분양 혼재 단지)는 배제한다 — 임대 세대는 애초에 매매로 거래될 수 없어, 여기 온 이름은
  // 사실상 항상 분양 동 쪽을 가리킨다. 단, 후보가 임대 표기뿐이면(진짜 임대 단지를 조회한 경우) 그대로 둔다.
  const nonRental = cand.filter((a) => !a.kaptName.includes("임대"));
  if (nonRental.length) cand = nonRental;
  // 임대 배제 이후에도 정확히 이름이 같은 후보가 있으면 그걸 우선 채택(기존 "정확 일치 우선" 취지 유지)
  const exact = cand.filter((a) => a.kaptName.replace(/\s/g, "") === qn);
  if (exact.length) return [exact[0]];
  // "형제 단지" 감지 — 후보명이 qn으로 시작하고 남는 꼬리가 짧으면서(4자 이하) 숫자를 포함하면
  // ("두산1차","두산2단지" 등) 한 복합단지를 나눠 등록한 것으로 보고 전부 합산한다.
  // "두산위브"처럼 꼬리에 숫자가 없는 건 별개 개발단지일 뿐이므로 제외된다.
  const siblings = cand.filter((a) => {
    const an = a.kaptName.replace(/\s/g, "");
    if (!an.startsWith(qn)) return false;
    const rest = an.slice(qn.length);
    return rest.length > 0 && rest.length <= 4 && /[0-9]/.test(rest);
  });
  if (siblings.length > 1) return siblings;
  // 여러 후보가 있으면 이름 길이가 검색어와 가장 가까운 쪽 채택
  cand.sort((a, b) => Math.abs(a.kaptName.replace(/\s/g, "").length - qn.length) - Math.abs(b.kaptName.replace(/\s/g, "").length - qn.length));
  return [cand[0]];
}

async function fetchBasis(key, kaptCode) {
  try {
    const r = await fetch(`${BASIS_URL}?serviceKey=${encodeURIComponent(key)}&kaptCode=${encodeURIComponent(kaptCode)}&_type=json`);
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error(`[hhcnt] getAphusBassInfoV4(${kaptCode}) JSON 파싱 실패. 응답 앞부분:`, text.slice(0, 500));
      return null;
    }
    const rawItems = extractItems(json);
    if (!rawItems || !rawItems.length) {
      console.error(`[hhcnt] getAphusBassInfoV4(${kaptCode}) 빈 응답:`, text.slice(0, 500));
      return null;
    }
    const it = rawItems[0];
    const hh = parseInt(String(it.kaptdaCnt ?? "").replace(/,/g, ""), 10);
    if (!hh) {
      // 임시 디버그: kaptCode는 찾았는데 세대수 필드가 없거나 형식이 다른 경우 실제 항목을 로그로 남김
      console.error(`[hhcnt] getAphusBassInfoV4(${kaptCode}) 세대수 파싱 실패. 항목:`, JSON.stringify(it).slice(0, 500));
      return null;
    }
    const dongRaw = parseInt(String(it.kaptDongCnt ?? "").replace(/,/g, ""), 10);
    return { hhcnt: hh, dongCnt: dongRaw || null, useDate: it.kaptUsedate || null };
  } catch (e) {
    console.error(`[hhcnt] getAphusBassInfoV4(${kaptCode}) fetch 실패:`, e.message);
    return null;
  }
}

// matchKapt가 "형제 단지"로 판단해 후보를 여러 개 돌려줄 때, 정적 캐시 항목(이미 hhcnt 계산됨)들을 합산
function mergeFull(fulls) {
  const hh = fulls.reduce((s, f) => s + (f.hhcnt || 0), 0);
  if (!hh) return null;
  const dongCnt = fulls.reduce((s, f) => s + (f.dongCnt || 0), 0) || null;
  const useDate = fulls.map((f) => f.useDate).filter(Boolean).sort()[0] || null; // 가장 이른 사용승인일
  return { hhcnt: hh, dongCnt, useDate };
}
// 위와 동일하되 라이브 조회(fetchBasis) 결과들을 합산
function mergeBasis(bases) {
  const valid = bases.filter(Boolean);
  if (!valid.length) return null;
  const hh = valid.reduce((s, b) => s + b.hhcnt, 0);
  const dongCnt = valid.reduce((s, b) => s + (b.dongCnt || 0), 0) || null;
  const useDate = valid.map((b) => b.useDate).filter(Boolean).sort()[0] || null;
  return { hhcnt: hh, dongCnt, useDate };
}

export default async (req) => {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) return Response.json({ error: "서버에 DATA_GO_KR_KEY가 설정되지 않았습니다." }, { status: 500 });

  // ── 배치 모드(POST): 화면 하나(지역 랭킹 등)에서 최대 100여 개 단지명을 한 번의 요청으로 묶어서 조회 ──
  // GET 모드(기존, 단지 하나씩)는 그대로 유지하되, 목록형 화면은 이 배치 모드를 써서
  // 같은 data/hhcnt/<lawd>.json 파일을 단지 수만큼 반복해서 fetch하던 낭비를 없앤다
  // (2026.07 추가 — 지역 랭킹처럼 최대 100건을 개별 조회하면 파일은 동일한데 매번 새로 읽어와 느렸음).
  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return Response.json({ error: "잘못된 요청" }, { status: 400 }); }
    const lawd = String(body.lawd || "").trim();
    const names = Array.isArray(body.names) ? [...new Set(body.names.map((n) => String(n || "").trim()).filter(Boolean))].slice(0, 200) : [];
    const sggs = resolveSigungu(lawd);
    if (!sggs.length) return Response.json({ error: "지역 코드 오류" }, { status: 400 });
    if (!names.length) return Response.json({ results: {} });

    const results = {};
    const remaining = new Set(names);

    // 정적 배치 파일을 딱 한 번만 읽어서, 그 안에서 요청받은 이름을 전부 매칭 시도
    // (data/hhcnt/<lawd>.json에는 세대수까지 이미 포함돼 있어 매칭만 되면 추가 API 호출이 필요 없음)
    try {
      const staticR = await fetch(`${new URL(req.url).origin}/data/hhcnt/${encodeURIComponent(lawd)}.json`);
      if (staticR.ok) {
        const staticJ = await staticR.json();
        const staticItems = (staticJ && Array.isArray(staticJ.items)) ? staticJ.items : [];
        if (staticItems.length) {
          const staticList = staticItems.map((it) => ({ kaptCode: it.kaptCode, kaptName: it.name }));
          for (const nm of [...remaining]) {
            const hits = matchKapt(staticList, nm);
            if (!hits.length) continue;
            const fulls = hits.map((h) => staticItems.find((it) => it.kaptCode === h.kaptCode)).filter(Boolean);
            const merged = fulls.length ? mergeFull(fulls) : null;
            if (!merged) continue;
            results[nm] = { found: true, name: nm, ...merged };
            remaining.delete(nm);
          }
        }
      }
    } catch (e) { /* 정적 캐시 조회 실패는 조용히 무시하고 아래 라이브 조회로 폴백 */ }

    // 정적 파일에서 못 찾은 나머지만(신규 단지, 배치가 아직 못 받은 지역 등) 라이브 API로 폴백
    // — 목록조회는 한 번만, 세대수 조회(basis)는 실제 매칭된 kaptCode만(중복 제거) 병렬로
    if (remaining.size) {
      try {
        const lists = await Promise.all(sggs.map((s) => fetchList(key, s)));
        const allItems = lists.flat();
        const matched = {}; // nm → [kaptCode, ...] (형제 단지면 여러 개)
        for (const nm of remaining) {
          const hits = matchKapt(allItems, nm);
          if (!hits.length) { results[nm] = { found: false }; continue; }
          matched[nm] = hits.map((h) => h.kaptCode);
        }
        const allCodes = [...new Set(Object.values(matched).flat())];
        const bases = await Promise.all(allCodes.map((c) => fetchBasis(key, c)));
        const basisByCode = {};
        allCodes.forEach((c, i) => { basisByCode[c] = bases[i]; });
        for (const nm of Object.keys(matched)) {
          const merged = mergeBasis(matched[nm].map((c) => basisByCode[c]));
          results[nm] = merged ? { found: true, name: nm, ...merged } : { found: false };
        }
      } catch (e) {
        for (const nm of remaining) results[nm] = { found: false };
      }
    }

    // 배치 응답은 요청마다 이름 조합이 달라 CDN 캐시 효율이 낮으므로 캐시하지 않음
    // (개별 결과는 이미 위에서 static/basis 단계의 CDN 캐시 대상 데이터를 그대로 활용한 것이라 손해 없음)
    return Response.json({ results });
  }

  const url = new URL(req.url);
  const lawd = (url.searchParams.get("lawd") || "").trim();
  const name = (url.searchParams.get("name") || "").trim();

  const sggs = resolveSigungu(lawd);
  if (!sggs.length) return Response.json({ error: "지역 코드 오류" }, { status: 400 });
  if (name.length < 2) return Response.json({ error: "단지명 오류" }, { status: 400 });

  // 세대수·동수는 사실상 고정값(재건축 전까지 안 바뀜) — CDN에 길게 캐시 (클라이언트 localStorage 캐시와 별개로,
  // 캐시가 없는 신규 방문자·다른 브라우저 요청도 최대한 API 재호출 없이 처리되도록)
  // 단, 못 찾은 경우(found:false)는 일시적 API 오류일 수 있으므로 짧게(1일)만 캐시 — 클라이언트도 미스는 1일 TTL로
  // 재시도하는데(HH_TTL_MISS_MS), CDN을 90일로 고정해두면 클라이언트가 재시도해도 CDN이 계속 옛 found:false를
  // 돌려줘 재시도가 무의미해짐(analyze.mjs·presale.mjs가 빈 결과와 정상 결과의 캐시 기간을 다르게 두는 것과 동일한 이유)
  const cacheHeadersFound = {
    "Content-Type": "application/json",
    "Netlify-CDN-Cache-Control": "public, durable, max-age=7776000",
    "Cache-Control": "public, max-age=0, must-revalidate",
  };
  const cacheHeadersMiss = {
    "Content-Type": "application/json",
    "Netlify-CDN-Cache-Control": "public, durable, max-age=86400",
    "Cache-Control": "public, max-age=0, must-revalidate",
  };

  // GitHub Actions 배치가 미리 수집해 리포에 커밋해둔 정적 목록(data/hhcnt/<lawd>.json)을 먼저 확인.
  // 세대수는 재건축 전까지 거의 안 바뀌는 값이라 여기서 매칭되면 국토부 API를 아예 호출하지 않고 즉시 반환.
  // 정적 파일이 없거나(신규 지역 등) 매칭 실패 시엔 조용히 기존 라이브 조회로 폴백.
  try {
    const staticR = await fetch(`${url.origin}/data/hhcnt/${encodeURIComponent(lawd)}.json`);
    if (staticR.ok) {
      const staticJ = await staticR.json();
      const staticList = (staticJ && Array.isArray(staticJ.items)) ? staticJ.items.map((it) => ({ kaptCode: it.kaptCode, kaptName: it.name })) : [];
      if (staticList.length) {
        const hits = matchKapt(staticList, name);
        if (hits.length) {
          const fulls = hits.map((h) => staticJ.items.find((it) => it.kaptCode === h.kaptCode)).filter(Boolean);
          const merged = fulls.length ? mergeFull(fulls) : null;
          if (merged) return new Response(JSON.stringify({ found: true, name, ...merged }), { headers: cacheHeadersFound });
        }
      }
    }
  } catch (e) { /* 정적 캐시 조회 실패는 조용히 무시하고 아래 라이브 조회로 폴백 */ }

  try {
    const lists = await Promise.all(sggs.map((s) => fetchList(key, s)));
    const allItems = lists.flat();
    const hits = matchKapt(allItems, name);
    if (!hits.length) {
      // 임시 디버그: 목록엔 항목이 있는데(=API 자체는 정상) 이 단지명만 못 찾은 경우,
      // 후보 목록 중 이름이 비슷한 것들을 로그로 남겨 "미등록"인지 "표기 차이"인지 구분
      const qn = name.replace(/\s/g, "");
      const similar = allItems
        .filter((a) => a.kaptName.replace(/\s/g, "").includes(qn.slice(0, 2)))
        .map((a) => a.kaptName)
        .slice(0, 15);
      console.error(`[hhcnt] "${name}" 매칭 실패. 목록 총 ${allItems.length}건. 비슷한 이름 후보:`, JSON.stringify(similar));
    }
    const bases = hits.length ? await Promise.all(hits.map((h) => fetchBasis(key, h.kaptCode))) : [];
    const merged = mergeBasis(bases);
    if (!merged) return new Response(JSON.stringify({ found: false }), { headers: cacheHeadersMiss });
    return new Response(JSON.stringify({ found: true, name, ...merged }), { headers: cacheHeadersFound });
  } catch (e) {
    // 세대수는 보조 정보이므로, 실패해도 found:false로 조용히 반환(메인 분석에 영향 없도록 500을 피함)
    return new Response(JSON.stringify({ found: false }), { headers: cacheHeadersMiss });
  }
};
