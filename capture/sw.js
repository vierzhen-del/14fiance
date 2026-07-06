// capture/ 전용 서비스워커 — 루트 sw.js(scope "/")와는 별개로 "/capture/" 범위만 담당한다.
// M1 골격 단계라 최소 캐시만 둔다(오프라인 완성도는 M2 이후 필요시 보강).
const SHELL_CACHE = "capture-shell-v1";

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "../shared/myassets-utils.js",
  "../shared/price-data.js",
  "../shared/myassets.js",
  "../shared/myassets.css",
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
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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
