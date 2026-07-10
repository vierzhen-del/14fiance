// app/src/native-quotes.js — APK(Capacitor 네이티브) 전용 실시간 시세.
// capacitor.config.json의 CapacitorHttp.enabled=true가 fetch()를 네이티브 HTTP로
// 패치해 CORS 없이 네이버 모바일 증권 API를 직접 호출할 수 있게 해준다. 이 덕분에
// 웹사이트가 의존하는 GitHub Actions 30분 파이프라인(지연 심함, CLAUDE.md 참조) 없이
// 진짜 실시간 조회가 가능하다 — 네이티브 앱에서만 shared/price-data.js의
// loadLiveKrQuotes()를 이 구현으로 교체하고, 웹 미리보기(비 네이티브)에서는 원래
// GitHub 파이프라인 기반 함수를 그대로 쓴다(build-www.mjs가 이 파일을 www에 복사하고
// index.html에 <script>로 주입).
(function () {
  if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;

  // scripts/fetch_intraday_kr.py와 동일한 엔드포인트·헤더(2026-07-06 프로브로 확인된 패턴)
  const NAVER_BASIC_URL = "https://m.stock.naver.com/api/stock/{code}/basic";
  const NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
  };

  async function fetchNaverPrice(symbol) {
    const code = symbol.endsWith(".KS") ? symbol.slice(0, -3) : symbol;
    const resp = await fetch(NAVER_BASIC_URL.replace("{code}", code), { headers: NAVER_HEADERS, cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const price = parseFloat(String(data.closePrice || "").replace(/,/g, ""));
    return price > 0 ? price : null;
  }

  // 전 종목이 아니라 지금 폼에 입력된 보유 국내 종목만 조회(개인 앱이라 불필요한 호출 최소화)
  function heldKrSymbols() {
    const syms = new Set();
    document.querySelectorAll("#myAssetRows .my-symbol").forEach((el) => {
      if (el.value && el.value.endsWith(".KS")) syms.add(el.value);
    });
    return [...syms];
  }

  function kstNowLabel() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} KST(실시간)`;
  }

  window.loadLiveKrQuotes = async function loadLiveKrQuotes() {
    if (!liveQuotesEnabled()) return null;
    const now = Date.now();
    if (state.liveKr && now - state.liveKr.fetchedAt < 3 * 60 * 1000) return state.liveKr.data;

    const symbols = heldKrSymbols();
    if (!symbols.length) {
      state.liveKr = null;
      state.liveKrError = "보유 국내 종목이 없습니다";
      return null;
    }

    const prices = {};
    for (const symbol of symbols) {
      try {
        const price = await fetchNaverPrice(symbol);
        if (price != null) prices[symbol] = price;
      } catch (err) { /* 종목별 실패는 건너뛰고 나머지는 계속 조회 */ }
    }

    if (Object.keys(prices).length === 0) {
      state.liveKr = null;
      state.liveKrError = "네이버 시세 조회 실패(네트워크를 확인해 주세요)";
      return null;
    }

    const data = { updated: kstNowLabel(), count: Object.keys(prices).length, prices };
    state.liveKr = { data, fetchedAt: now };
    state.liveKrError = null;
    return data;
  };
})();
