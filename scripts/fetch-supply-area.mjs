// 건축HUB_건축물대장정보 서비스 — 전유공용면적 조회로 특정 단지의 "실측 공급면적"을 확인하는 도구.
// ─────────────────────────────────────────────────────────────
// 사전 준비:
//  1) data.go.kr에서 "건축HUB_건축물대장정보 서비스" 활용신청 → 승인 (보통 1~2시간, 자동승인이면 즉시)
//     상세기능 중 "전유공용면적 조회"(getBrExposPubuseAreaInfo)는 반드시 체크
//  2) 기존 DATA_GO_KR_KEY(국토부 실거래가용)와 같은 계정이면 서비스키 문자열은 재사용 가능 —
//     단, "활용신청" 자체는 이 API에 대해 별도로 승인받아야 호출이 됨
//  3) 조회 대상 단지의 "지번 주소"(도로명 아님) 필요: 시군구코드(5) + 법정동코드(5) + 본번(+부번)
//     → 씨:리얼(seereal.lh.or.kr), 국토부 실거래가 상세, 또는 정부24 건축물대장 열람에서 지번 확인 가능
//
// 사용법:
//   DATA_GO_KR_KEY=xxx node scripts/fetch-supply-area.mjs --sigungu=41135 --bjdong=11000 --bun=0542 --ji=0000
//   (동명을 알면 --dong=101동 옵션으로 좁혀서 결과를 줄일 수 있음)
//
// 이 스크립트는 자동으로 shared/supply-area.mjs를 수정하지 않는다.
// 조회 결과(호별 전유면적+공용면적 합 = 공급면적, ㎡ → 평 변환값)를 출력만 하고,
// 어떤 (단지|umd|전용면적) 키에 어떤 평형을 등록할지는 사람이 확인 후 수동으로 넣는 것을 원칙으로 한다
// (같은 전용면적이라도 타입(A/B/C)에 따라 공급면적이 달라 자동 매칭이 오히려 오차를 만들 수 있음).

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) {
  console.error("DATA_GO_KR_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

// API 신청·승인 완료(2026.08). 아래 BASE는 활용신청 상세기능 화면의 오퍼레이션 경로(/getBrExposPubuseAreaInfo)와
// 동일 기관(국토교통부, 서비스ID 1613000) 관례를 근거로 한 값 — 최초 실행 전에 data.go.kr 상세페이지의
// "미리보기" 버튼으로 한 번 호출해보고, 여기 URL과 실제 요청주소가 다르면 BASE만 바꿔주면 됨(나머지 로직 동일).
const BASE = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo";
const SQM_PER_PY = 3.3058;

function parseArgs() {
  const args = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([\w]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function xtag(b, name) {
  const m = b.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`));
  return m ? m[1].trim() : "";
}

async function main() {
  const { sigungu, bjdong, bun, ji, dong } = parseArgs();
  if (!sigungu || !bjdong) {
    console.error("--sigungu=시군구코드(5) --bjdong=법정동코드(5) [--bun=본번] [--ji=부번] [--dong=동명] 형식으로 입력하세요.");
    process.exit(1);
  }
  const qs = new URLSearchParams({
    serviceKey: KEY,
    sigunguCd: sigungu,
    bjdongCd: bjdong,
    ...(bun ? { bun } : {}),
    ...(ji ? { ji } : {}),
    numOfRows: "500",
    pageNo: "1",
  });
  const r = await fetch(`${BASE}?${qs.toString()}`);
  const xml = await r.text();

  const items = [];
  const re = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/g;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];
    const dongNm = xtag(b, "dongNm");
    if (dong && dongNm && dongNm !== dong) continue;
    items.push({
      dong: dongNm,
      ho: xtag(b, "hoNm"),
      gbn: xtag(b, "exposPubuseGbCdNm"), // 전유 | 공용
      area: parseFloat(xtag(b, "area")) || 0,
      mainPurpose: xtag(b, "mainAtchGbCdNm"),
    });
  }

  if (!items.length) {
    console.log("결과 없음 — sigungu/bjdong/bun/ji 값을 다시 확인하세요. (원본 응답 일부)");
    console.log(xml.slice(0, 500));
    return;
  }

  // 동+호 단위로 전유(주거) + 공용 면적 합산 → 공급면적
  const byUnit = {};
  for (const it of items) {
    const k = `${it.dong}|${it.ho}`;
    byUnit[k] = byUnit[k] || { dong: it.dong, ho: it.ho, exclusive: 0, common: 0 };
    if (it.gbn.includes("전유")) byUnit[k].exclusive += it.area;
    else byUnit[k].common += it.area;
  }

  console.log("동 / 호 / 전유면적(㎡) / 공용면적(㎡) / 공급면적(㎡) / 공급면적 환산평");
  for (const u of Object.values(byUnit)) {
    const supply = u.exclusive + u.common;
    const py = Math.round(supply / SQM_PER_PY);
    console.log(`${u.dong} / ${u.ho} / ${u.exclusive.toFixed(2)} / ${u.common.toFixed(2)} / ${supply.toFixed(2)} / ${py}평`);
  }
  console.log("\n→ 확인된 값을 shared/supply-area.mjs의 SUPPLY_AREA_OVERRIDE에 \"단지명|umd|전용면적반올림값\": 평형 형식으로 직접 등록하세요.");
}

main().catch((e) => {
  console.error("조회 실패:", e.message);
  process.exit(1);
});
