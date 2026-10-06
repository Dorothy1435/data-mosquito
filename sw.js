/* =============================================================
   모기제로 서비스 워커 — 앱처럼 설치하고, 인터넷이 잠깐 끊겨도 화면이 뜨게 한다
   -------------------------------------------------------------
   · 화면 파일(HTML·CSS·JS·그림)은 먼저 인터넷에서 받고, 실패하면 저장해 둔 것을 쓴다 (항상 최신 우선)
   · 날씨·AI·제보(/api, 외부 서버)는 저장하지 않는다 — 오래된 날씨를 '지금'처럼 보여 주지 않기 위해
   · 사진·위치는 이 파일이 다루지 않는다
   버전을 바꾸면 옛 저장분을 지운다.
   ============================================================= */
const VERSION = 'mz-2026-10-06';
const SHELL = ['/', '/index.html', '/mosquito-info.html', '/privacy.html', '/gimhae.html', '/design.css', '/expert.css', '/chat.css', '/gimhae.js',
  '/script.js', '/app-ui.js', '/hero-map.js', '/model-v5.js', '/data/gimhae-boundary.json', '/data/city-boundaries.json', '/motion.js', '/citizen.js', '/chat.js', '/mosquito-model.js', '/outing-index.js',
  '/park-picks.js', '/weather-bg.js', '/nav.js', '/assets/brand/logo-icon.png', '/assets/brand/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;   // 저장하지 않고 그대로 보낸다
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html')))
  );
});
