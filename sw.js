// 아파트썸 실거래 분석 — 최소 서비스워커
// 목적: 안드로이드 Chrome의 PWA 설치(installability) 조건 충족.
// 실거래 데이터는 실시간성이 중요하므로 API(/.netlify/functions/*)는 캐싱하지 않고 항상 네트워크로 통과시킴.
// 앱 셸(정적 파일)만 최소한으로 캐싱해 오프라인에서도 빈 화면 대신 기본 골격은 뜨도록 함.

const CACHE_VERSION = 'aptsum-shell-v1';
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

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          // 정적 파일만 최신본으로 갱신 캐시 (동적 페이지는 캐시하지 않음)
          if (res && res.ok && SHELL_FILES.some((f) => url.endsWith(f) || url.endsWith('/'))) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
