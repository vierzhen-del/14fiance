// ETF MDD 계산기 — PWA 서비스워커
// 캐시 이름에 버전을 넣어둠: sw.js를 고칠 때 버전 문자열만 올리면 이전 캐시가 자동 정리됨
const SHELL_CACHE = "mdd-shell-v1";
const DATA_CACHE = "mdd-data-v1";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 외부 요청은 그대로 둔다

  if (url.pathname.includes("/data/")) {
    // 가격·배당·환율 데이터: 캐시가 있으면 즉시 보여주고, 백그라운드에서 최신으로 갱신
    event.respondWith(
      caches.open(DATA_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // 앱 셸(HTML·아이콘 등): 온라인이면 최신을 받아오고, 실패하면 캐시로 대체
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const resClone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
