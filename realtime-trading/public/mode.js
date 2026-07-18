// 대시보드 동작 모드 결정 + 모드 표시/전환 UI.
//  server — Node 서버(server/index.js)가 서빙: /api/symbols + WebSocket 실시간(기존 동작)
//  mobile — 서버 없이 정적 호스팅(GitHub Pages 등): Upbit 직접 + GitHub 30분 파이프라인
//  native — 14fiance 안드로이드 앱(Capacitor) 안의 대시보드 탭: 네이버·야후·KIS 직접 호출
const DASH_MODE_KEY = "rt_dash_mode_v1";

function resolveDashMode() {
  // 앱(WebView)은 항상 native — CapacitorHttp 덕에 CORS 없이 직접 조회가 가능해 최선의 모드
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    return "native";
  }
  const q = new URLSearchParams(location.search).get("mode");
  if (q === "server" || q === "mobile") return q;
  const saved = localStorage.getItem(DASH_MODE_KEY);
  if (saved === "server" || saved === "mobile") return saved;
  // GitHub Pages에서 열렸으면 서버가 없으므로 mobile, 그 외(로컬 Node 서버)는 server
  return location.host.endsWith("github.io") ? "mobile" : "server";
}

const DASH_MODE_LABEL = {
  server: "서버 연동",
  mobile: "모바일 (서버 없음)",
  native: "앱 실시간",
};

function setupModeUi(mode) {
  const btn = document.getElementById("mode-toggle");
  if (!btn) return;
  if (mode === "native") {
    // 앱에서는 모드 전환 개념이 없음(항상 native)
    btn.hidden = true;
    return;
  }
  const other = mode === "server" ? "mobile" : "server";
  btn.hidden = false;
  btn.textContent = `${DASH_MODE_LABEL[mode]} 모드 · 전환`;
  btn.title = `${DASH_MODE_LABEL[other]} 모드로 전환`;
  btn.addEventListener("click", () => {
    localStorage.setItem(DASH_MODE_KEY, other);
    // ?mode= 쿼리가 저장값을 덮어쓰지 않도록 지우고 리로드
    const url = new URL(location.href);
    url.searchParams.delete("mode");
    location.href = url.toString();
  });
}
