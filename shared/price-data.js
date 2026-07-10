// shared/price-data.js — 가격·환율·실시간시세 데이터 접근 계층
// index.html에서 추출한 사본(2026-07-06 M1). DATA_DIR/state는 각 호출 페이지가 선언.

async function loadSymbol(symbol) {
  if (state.cache.has(symbol)) return state.cache.get(symbol);
  const d = await fetchJSON(`${DATA_DIR}/${symbol}.json`);
  state.cache.set(symbol, d);
  return d;
}

async function loadFx() {
  if (state.cache.has("fx:USDKRW")) return state.cache.get("fx:USDKRW");
  let fx = null;
  try {
    fx = await fetchJSON(`${DATA_DIR}/fx/USDKRW.json`);
  } catch (err) {
    fx = null;
  }
  state.cache.set("fx:USDKRW", fx);
  return fx;
}

const MY_LIVE_QUOTES_KEY = "my_assets_live_quotes_v1";

const LIVE_KR_URL = "https://raw.githubusercontent.com/vierzhen-del/14fiance/live/latest_kr.json";

function liveQuotesEnabled() { return localStorage.getItem(MY_LIVE_QUOTES_KEY) === "1"; }

async function loadLiveKrQuotes() {
  if (!liveQuotesEnabled()) return null;
  const now = Date.now();
  if (state.liveKr && now - state.liveKr.fetchedAt < 3 * 60 * 1000) return state.liveKr.data;
  try {
    const resp = await fetch(LIVE_KR_URL, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data || typeof data.prices !== "object") throw new Error("형식 오류");
    state.liveKr = { data, fetchedAt: now };
    state.liveKrError = null;
    return data;
  } catch (err) {
    state.liveKr = null;
    state.liveKrError = err.message;
    return null;
  }
}

