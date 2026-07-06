// capture/ 전용 서비스워커 — 루트 sw.js(scope "/")와는 별개로 "/capture/" 범위만 담당한다.
const SHELL_CACHE = "capture-shell-v1";
const SHARE_TARGET_CACHE = "share-target-cache";

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
      Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== SHARE_TARGET_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // M4: Web Share Target — 갤러리 등에서 스크린샷을 공유하면 manifest.json의
  // share_target 설정에 따라 이 경로로 POST 요청이 온다. GitHub Pages는 정적
  // 서버라 POST를 처리 못 하므로 서비스워커가 가로채 파일을 Cache Storage에
  // 저장해두고, index.html이 로드되면서 꺼내가도록 ?shared=1로 리다이렉트한다.
  if (req.method === "POST" && url.pathname.endsWith("/capture/index.html")) {
    event.respondWith(handleShareTarget(event));
    return;
  }
  if (req.method !== "GET") return;

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

async function handleShareTarget(event) {
  try {
    const formData = await event.request.formData();
    const files = formData.getAll("screenshots").filter((f) => f && f.size > 0);
    const cache = await caches.open(SHARE_TARGET_CACHE);
    const keys = [];
    for (let i = 0; i < files.length; i++) {
      const key = `./shared-file-${i}`;
      await cache.put(key, new Response(files[i], { headers: { "content-type": files[i].type || "image/jpeg" } }));
      keys.push(key);
    }
    await cache.put("./shared-index", new Response(JSON.stringify(keys)));
  } catch (err) { /* 공유 페이로드를 못 읽어도 앱 자체는 정상 열리게 그냥 리다이렉트 */ }
  return Response.redirect("./index.html?shared=1", 303);
}
