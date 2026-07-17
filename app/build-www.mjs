// app/build-www.mjs — capture 웹앱 + shared 모듈을 app/www/로 복사해 APK용 웹 자산을 만든다.
// 원본(capture/, shared/)이 SSOT — 이 스크립트는 경로 재배치와 앱 전용 치환만 하고 로직은 손대지 않는다.
// 실행: cd app && npm run build:www  (CI의 APK 빌드 전 단계에서도 동일하게 실행)
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(appDir, "..");
const www = join(appDir, "www");

// 데이터(주가 히스토리·manifest)는 APK에 번들하지 않고 배포 브랜치의 raw URL에서 런타임 조회
// (수집이 주 1회라 앱 재설치 없이 항상 최신 데이터를 읽게 하기 위함)
const REMOTE_DATA_DIR = "https://raw.githubusercontent.com/vierzhen-del/14fiance/claude/us-etf-mdd-calculator-gdwui7/data";

rmSync(www, { recursive: true, force: true });
mkdirSync(join(www, "shared"), { recursive: true });
mkdirSync(join(www, "icons"), { recursive: true });

// shared 모듈·CSS 그대로 복사
for (const f of ["myassets-utils.js", "price-data.js", "myassets.js", "calculators.js", "myassets.css"]) {
  cpSync(join(repoRoot, "shared", f), join(www, "shared", f));
}
// capture 파싱 엔진 그대로 복사
cpSync(join(repoRoot, "capture", "capture-parse.js"), join(www, "capture-parse.js"));
// 트레이딩 대시보드(realtime-trading/public) → 앱의 "📈 대시보드" 탭.
// Capacitor 감지(mode.js)로 앱에서는 자동 native 모드(네이버·야후·KIS 직접 조회)가 된다.
mkdirSync(join(www, "dashboard"), { recursive: true });
for (const f of ["index.html", "style.css", "app.js", "symbols.js", "mode.js", "mobile-feeds.js", "native-feeds.js"]) {
  cpSync(join(repoRoot, "realtime-trading", "public", f), join(www, "dashboard", f));
}
// 대시보드 탭바의 캡처 앱 링크를 www 내부 구조에 맞게 치환
{
  const dashHtmlPath = join(www, "dashboard", "index.html");
  let dashHtml = readFileSync(dashHtmlPath, "utf-8");
  const from = 'href="../../capture/index.html"';
  if (!dashHtml.includes(from)) {
    throw new Error(`build-www: 치환 대상 미발견 — realtime-trading/public/index.html이 바뀌었는지 확인 필요: ${from}`);
  }
  writeFileSync(dashHtmlPath, dashHtml.replaceAll(from, 'href="../index.html"'));
}
// APK 전용 네이티브 실시간 시세(CapacitorHttp로 네이버 직접 호출) — 앱에서만 동작, 웹에선 무시됨
cpSync(join(appDir, "src", "native-quotes.js"), join(www, "native-quotes.js"));
// APK 전용 네이티브 파일 백업/복원(@capacitor/filesystem) — 앱에서만 동작, 웹에선 무시됨
cpSync(join(appDir, "src", "native-files.js"), join(www, "native-files.js"));
// 앱 아이콘(웹앱과 공용)
for (const f of ["icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
  const src = join(repoRoot, "icons", f);
  if (existsSync(src)) cpSync(src, join(www, "icons", f));
}

// capture/index.html → www/index.html: 앱 환경에 맞는 최소 치환만 수행
let html = readFileSync(join(repoRoot, "capture", "index.html"), "utf-8");
const replacements = [
  // 상대경로를 www 내부 구조에 맞게 평탄화
  ['href="../shared/myassets.css"', 'href="shared/myassets.css"'],
  ['src="../shared/myassets-utils.js"', 'src="shared/myassets-utils.js"'],
  ['src="../shared/price-data.js"></script>', 'src="shared/price-data.js"></script>\n<script src="native-quotes.js"></script>\n<script src="native-files.js"></script>'],
  ['src="../shared/myassets.js"', 'src="shared/myassets.js"'],
  ['src="../shared/calculators.js"', 'src="shared/calculators.js"'],
  // 데이터는 원격 raw URL에서 조회
  ['const DATA_DIR = "../data";', `const DATA_DIR = "${REMOTE_DATA_DIR}";`],
  // PWA 전용 요소는 앱(WebView)에선 불필요 — manifest 링크 제거, SW 등록은 지원 안 되는 환경에서 catch로 무해하지만 명시적으로 끔
  ['<link rel="manifest" href="manifest.json">', "<!-- APK: PWA manifest 불필요 -->"],
  ['navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {});',
   "/* APK: 서비스워커 미사용(웹 자산이 이미 로컬 번들) */"],
  // 사이트로 돌아가는 상대 링크는 절대 URL로
  ['<a href="../index.html">../index.html</a>', '<a href="https://vierzhen-del.github.io/14fiance/">웹 사이트</a>'],
  // 하단 탭바의 대시보드 링크 → www 내부의 dashboard/
  ['href="../realtime-trading/public/index.html"', 'href="dashboard/index.html"'],
];
for (const [from, to] of replacements) {
  if (!html.includes(from)) throw new Error(`build-www: 치환 대상 미발견 — capture/index.html이 바뀌었는지 확인 필요: ${from}`);
  html = html.replaceAll(from, to);
}
writeFileSync(join(www, "index.html"), html);
console.log("build-www: OK →", www);
