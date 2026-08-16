// 아파트썸 실거래 분석 — 최소 서비스워커
// 목적: 안드로이드 Chrome의 PWA 설치(installability) 조건 충족.
// 실거래 데이터는 실시간성이 중요하므로 API(/.netlify/functions/*)는 캐싱하지 않고 항상 네트워크로 통과시킴.
//
// [2026.08 수정] 기존에는 "캐시 우선"(캐시가 있으면 무조건 그것부터 응답, 네트워크는 다음 방문용으로만 백그라운드 갱신)
// 전략이었는데, 이러면 한 번 캐시된 이후로는 index.html 자체가 통째로 예전 버전에 고정되어
// 그 안의 실거래 조회 로직까지 옛날 버전으로 굳어버리는 문제가 있었음(실제로 특정 브라우저에서
// 최신 몇 개월치 거래가 안 보이는 형태로 발현 — 인앱 브라우저는 이 캐시가 안 걸려있어 정상 표시됨).
// → "네트워크 우선, 오프라인일 때만 캐시로 대체" 전략으로 변경. 온라인 상태에서는 항상 최신 버전을 받고,
// 인터넷이 끊겼을 때만 예비 화면으로 캐시를 사용한다.

const CACHE_VERSION = 'aptsum-shell-v2'; // v1(캐시 우선 방식)은 폐기 — activate 단계에서 자동 삭제됨
const SHELL_FILES = [
  '/',
  '/manifest.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png',
  '/assets/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {}) // 개별 파일 실패해도 설치 자체는 진행
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // API 호출(실거래 데이터)은 서비스워커가 절대 가로채지 않음 — 항상 최신 데이터
  if (url.includes('/.netlify/functions/')) return;
  if (event.request.method !== 'GET') return;

  const isShellFile = SHELL_FILES.some((f) => url.endsWith(f) || url.endsWith('/'));
  if (!isShellFile) return; // 앱 셸 외 요청은 서비스워커가 관여하지 않고 브라우저 기본 동작에 맡김

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // 네트워크 성공 시: 항상 최신 응답을 그대로 쓰고, 오프라인 대비용으로 캐시도 갱신
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request)) // 네트워크 실패(오프라인) 시에만 캐시로 대체
  );
});
