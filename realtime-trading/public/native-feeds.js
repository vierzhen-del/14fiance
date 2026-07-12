// native 모드(14fiance 안드로이드 앱의 대시보드 탭) 데이터 계층.
// capacitor.config.json의 CapacitorHttp.enabled=true가 fetch()를 네이티브 HTTP로 패치해
// CORS 없이 네이버·야후·KIS API를 직접 호출할 수 있다(app/src/native-quotes.js와 같은 원리).
// 비트코인은 mobile 모드와 동일하게 Upbit WebSocket(wss)을 그대로 쓴다.
const NATIVE_POLL_MS = 10 * 1000; // 네이버·KIS 폴링 주기
const NATIVE_YAHOO_POLL_MS = 15 * 1000; // 야후는 지연 시세라 조금 느리게

// scripts/fetch_intraday_kr.py·app/src/native-quotes.js와 동일 엔드포인트·헤더
const NAVER_STOCK_URL = (code) => `https://m.stock.naver.com/api/stock/${code}/basic`;
const NAVER_INDEX_URL = (code) => `https://m.stock.naver.com/api/index/${code}/basic`;
const NAVER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  "Referer": "https://m.stock.naver.com/",
};

// ---- KIS(한국투자증권 OpenAPI) 설정 — ⚙️ 설정 패널이 localStorage에 저장 ----
const KIS_APP_KEY_KEY = "rt_kis_app_key_v1";
const KIS_APP_SECRET_KEY = "rt_kis_app_secret_v1";
const KIS_FUT_CODE_KEY = "rt_kis_fut_code_v1";
const KIS_TOKEN_CACHE_KEY = "rt_kis_token_v1";
const KIS_REST = "https://openapi.koreainvestment.com:9443"; // server/feeds/kis.js HOSTS.prod

function kisSettings() {
  return {
    appKey: (localStorage.getItem(KIS_APP_KEY_KEY) || "").trim(),
    appSecret: (localStorage.getItem(KIS_APP_SECRET_KEY) || "").trim(),
    futCode: (localStorage.getItem(KIS_FUT_CODE_KEY) || "").trim(),
  };
}

// 접근토큰 — 유효기간 24h·발급 rate-limit(1분 1회)이 있어 localStorage에 캐시해
// 앱 재시작에도 재사용한다(server/feeds/kisFutures.js getToken의 클라이언트판).
async function kisToken(kis) {
  const TOKEN_MARGIN_MS = 60 * 1000;
  try {
    const cached = JSON.parse(localStorage.getItem(KIS_TOKEN_CACHE_KEY) || "null");
    if (cached && cached.appKey === kis.appKey && Date.now() < cached.expiry - TOKEN_MARGIN_MS) {
      return cached.token;
    }
  } catch {
    /* 캐시 파손 시 재발급 */
  }
  const res = await fetch(`${KIS_REST}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: kis.appKey, appsecret: kis.appSecret }),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error("no access_token");
  const expiry = Date.now() + (Number(json.expires_in) || 86400) * 1000;
  localStorage.setItem(KIS_TOKEN_CACHE_KEY, JSON.stringify({ appKey: kis.appKey, token: json.access_token, expiry }));
  return json.access_token;
}

async function kisGet(kis, path, params, trId) {
  const token = await kisToken(kis);
  const res = await fetch(`${KIS_REST}${path}?${new URLSearchParams(params)}`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: kis.appKey,
      appsecret: kis.appSecret,
      tr_id: trId,
      custtype: "P",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// 국내주식 현재가(FHKST01010100) — output.stck_prpr/prdy_vrss/prdy_vrss_sign/prdy_ctrt
async function kisStockQuote(kis, code) {
  const json = await kisGet(
    kis,
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code },
    "FHKST01010100"
  );
  const o = json.output;
  if (!o || o.stck_prpr == null) throw new Error(json.msg1 ?? "no output");
  const sign = ["4", "5"].includes(o.prdy_vrss_sign) ? -1 : 1; // 4:하락 5:하한
  return {
    price: Number(o.stck_prpr),
    change: sign * Math.abs(Number(o.prdy_vrss)),
    changePct: sign * Math.abs(Number(o.prdy_ctrt)),
  };
}

// 선물 시세(FHMIF10000000) — server/feeds/kisFutures.js fetchQuote의 포팅
async function kisFuturesQuote(kis, futCode) {
  const json = await kisGet(
    kis,
    "/uapi/domestic-futureoption/v1/quotations/inquire-price",
    { FID_COND_MRKT_DIV_CODE: "F", FID_INPUT_ISCD: futCode },
    "FHMIF10000000"
  );
  const o = json.output1;
  if (!o || o.futs_prpr == null) throw new Error(json.msg1 ?? "no output1");
  return {
    price: Number(o.futs_prpr),
    change: Number(o.futs_prdy_vrss),
    changePct: Number(o.futs_prdy_ctrt),
  };
}

// ---- 네이버 basic API 공통 파싱 (주식·지수 응답 모두 closePrice/compare.../fluctuationsRatio) ----
function parseNaverBasic(data) {
  const num = (v) => {
    const n = parseFloat(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const price = num(data.closePrice);
  if (price == null || price <= 0) return null;
  let change = num(data.compareToPreviousClosePrice);
  let changePct = num(data.fluctuationsRatio);
  // 하락이면 네이버가 음수 문자열을 주지만, 부호 누락에 대비해 등락 방향 코드로 보정
  const dirCode = data.compareToPreviousPrice && data.compareToPreviousPrice.code;
  if (dirCode === "5" || dirCode === "4") {
    if (change != null) change = -Math.abs(change);
    if (changePct != null) changePct = -Math.abs(changePct);
  }
  return { price, change, changePct };
}

async function naverQuote(url) {
  const res = await fetch(url, { headers: NAVER_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseNaverBasic(await res.json());
}

// ---- Yahoo chart API (server/feeds/yahoo.js의 포팅 — 네이티브라 CORS 없음) ----
async function yahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (realtime-trading dashboard)" }, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error("no price");
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  return {
    price,
    change: prevClose != null ? price - prevClose : null,
    changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : null,
    ts: (meta.regularMarketTime ?? 0) * 1000 || Date.now(),
  };
}

function startNativeFeeds(symbols, publish) {
  startUpbitWs(symbols.filter((s) => s.nativeFeed === "upbit"), publish); // mobile-feeds.js 공용

  const naverTargets = symbols.filter((s) => s.nativeFeed === "naver" && s.krSymbol);
  const indexTargets = symbols.filter((s) => s.nativeFeed === "naverIndex" && s.naverIndexCode);
  const yahooTargets = symbols.filter((s) => s.nativeFeed === "yahoo" && s.yahooSymbol);
  const kisFutTargets = symbols.filter((s) => s.nativeFeed === "kisfut");

  const pollNaverKis = async () => {
    const kis = kisSettings();
    const kisReady = Boolean(kis.appKey && kis.appSecret);

    for (const sym of naverTargets) {
      try {
        // KIS 키가 있으면 공식 실시간(체결가 REST)을, 없으면 네이버를 쓴다
        const q = kisReady
          ? await kisStockQuote(kis, sym.kisCode)
          : await naverQuote(NAVER_STOCK_URL(sym.krSymbol.replace(/\.KS$/, "")));
        if (q) publish({ id: sym.id, ...q, source: kisReady ? "KIS(실시간)" : "네이버(실시간)", ts: Date.now() });
      } catch {
        /* 종목별 실패는 건너뛰고 다음 폴링에서 재시도 */
      }
    }
    for (const sym of indexTargets) {
      try {
        const q = await naverQuote(NAVER_INDEX_URL(sym.naverIndexCode));
        if (q) publish({ id: sym.id, ...q, source: "네이버(실시간)", ts: Date.now() });
      } catch {
        /* 재시도 */
      }
    }
    if (kisReady && kis.futCode) {
      for (const sym of kisFutTargets) {
        try {
          const q = await kisFuturesQuote(kis, kis.futCode);
          publish({ id: sym.id, ...q, source: "KIS 선물", ts: Date.now() });
        } catch {
          /* 재시도 */
        }
      }
    }
  };

  const pollYahoo = async () => {
    for (const sym of yahooTargets) {
      try {
        const q = await yahooQuote(sym.yahooSymbol);
        publish({ id: sym.id, price: q.price, change: q.change, changePct: q.changePct, source: "yahoo(지연)", ts: q.ts });
      } catch {
        /* 재시도 */
      }
    }
  };

  pollNaverKis();
  pollYahoo();
  setInterval(pollNaverKis, NATIVE_POLL_MS);
  setInterval(pollYahoo, NATIVE_YAHOO_POLL_MS);
}
