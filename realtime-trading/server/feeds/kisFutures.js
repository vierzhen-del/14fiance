import { HOSTS } from "./kis.js";

// 한국투자증권 국내 선물옵션 시세 REST 폴링 — 코스피200 선물(KRX 야간파생시장 포함)
// KRX 야간시장(2025.6 개장)의 코스피200 선물은 Yahoo 등 무료 API에 없으므로 KIS로 조회한다.
//
// 확인 포인트 (KIS 개발자 포털 문서 기준으로 검증 필요):
//  - tr_id FHMIF10000000 = 선물옵션 시세 조회
//  - FID_COND_MRKT_DIV_CODE: 주간 지수선물 "F". 야간시장 구분코드는 KIS 문서에서
//    확인 후 .env의 KIS_FUT_MARKET_CODE로 지정
//  - 종목코드(KIS_FUT_CODE): 최근월물 코드는 만기(3·6·9·12월)마다 바뀌므로 갱신 필요
const TOKEN_MARGIN_MS = 60 * 1000; // 만료 1분 전 갱신

export function startKisFuturesFeed(symbols, publish, kis, opts = {}) {
  const targets = symbols.filter((s) => s.feed === "kisfut" && s.kisFutCode);
  if (targets.length === 0) return;

  const host = HOSTS[kis.env] ?? HOSTS.prod;
  const marketCode = opts.marketCode ?? "F";
  const pollMs = opts.pollMs ?? 10000;

  let token = null;
  let tokenExpiry = 0;

  async function getToken() {
    if (token && Date.now() < tokenExpiry - TOKEN_MARGIN_MS) return token;
    const res = await fetch(`${host.rest}/oauth2/tokenP`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: kis.appKey,
        appsecret: kis.appSecret,
      }),
    });
    if (!res.ok) throw new Error(`token HTTP ${res.status}`);
    const json = await res.json();
    if (!json.access_token) throw new Error("no access_token in response");
    token = json.access_token;
    tokenExpiry = Date.now() + (Number(json.expires_in) || 86400) * 1000;
    return token;
  }

  async function fetchQuote(sym) {
    const accessToken = await getToken();
    const params = new URLSearchParams({
      FID_COND_MRKT_DIV_CODE: marketCode,
      FID_INPUT_ISCD: sym.kisFutCode,
    });
    const res = await fetch(
      `${host.rest}/uapi/domestic-futureoption/v1/quotations/inquire-price?${params}`,
      {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          authorization: `Bearer ${accessToken}`,
          appkey: kis.appKey,
          appsecret: kis.appSecret,
          tr_id: "FHMIF10000000",
          custtype: "P",
        },
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const o = json.output1;
    if (!o || o.futs_prpr == null) throw new Error(json.msg1 ?? "no output1 in response");
    publish({
      id: sym.id,
      name: sym.name,
      price: Number(o.futs_prpr),
      change: Number(o.futs_prdy_vrss),
      changePct: Number(o.futs_prdy_ctrt),
      currency: sym.currency,
      source: "KIS 선물",
      ts: Date.now(),
    });
  }

  console.log(
    `[kisfut] polling ${targets.map((s) => s.kisFutCode).join(", ")} every ${pollMs}ms (market=${marketCode})`
  );
  const poll = async () => {
    for (const sym of targets) {
      try {
        await fetchQuote(sym);
      } catch (err) {
        console.warn(`[kisfut] ${sym.kisFutCode}: ${err.message}`);
      }
    }
  };
  poll();
  setInterval(poll, pollMs);
}
