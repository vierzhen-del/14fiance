// mobile 모드(서버 PC 없이 정적 호스팅) 데이터 계층.
// 브라우저에서 CORS 없이 가능한 것만 사용한다:
//  - Upbit 공개 WebSocket(비트코인) — 진짜 실시간
//  - GitHub Actions 파이프라인 산출물(raw.githubusercontent.com) — 30분 주기 예정이지만
//    무료 스케줄 큐 특성상 지연·드롭 흔함(한계 인정, 루트 CLAUDE.md 참조)
const LIVE_KR_URL = "https://raw.githubusercontent.com/vierzhen-del/14fiance/live/latest_kr.json";
const LIVE_GLOBAL_URL = "https://raw.githubusercontent.com/vierzhen-del/14fiance/live-trading/latest_global.json";
const LIVE_POLL_MS = 60 * 1000; // 파일 자체가 30분 주기라 폴링은 가볍게 1분

// ---- Upbit 공개 WebSocket (server/feeds/upbit.js의 브라우저 포팅) ----
function startUpbitWs(symbols, publish) {
  const targets = symbols.filter((s) => s.upbitCode);
  if (targets.length === 0) return;
  const codes = targets.map((s) => s.upbitCode);
  const byCode = new Map(targets.map((s) => [s.upbitCode, s]));

  const BASE_MS = 2000;
  const MAX_MS = 60000;
  let retryMs = BASE_MS;

  const connect = () => {
    const ws = new WebSocket("wss://api.upbit.com/websocket/v1");
    ws.binaryType = "blob";

    ws.onopen = () => {
      retryMs = BASE_MS;
      ws.send(JSON.stringify([{ ticket: "realtime-trading" }, { type: "ticker", codes }]));
    };

    ws.onmessage = async (e) => {
      try {
        const text = typeof e.data === "string" ? e.data : await e.data.text();
        const t = JSON.parse(text);
        const sym = byCode.get(t.code);
        if (!sym || t.trade_price == null) return;
        publish({
          id: sym.id,
          price: t.trade_price,
          change: t.signed_change_price ?? null,
          changePct: t.signed_change_rate != null ? t.signed_change_rate * 100 : null,
          source: "upbit(실시간)",
          ts: t.trade_timestamp ?? Date.now(),
        });
      } catch {
        // 개별 메시지 파싱 실패는 무시
      }
    };

    ws.onclose = () => {
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, MAX_MS);
    };
    ws.onerror = () => ws.close();
  };

  connect();
}

// ---- GitHub 파이프라인 JSON 폴링 ----
// latest_kr.json: prices = { "005930.KS": 61500, ... } (가격만)
// latest_global.json: prices = { "NQ=F": {price, change, changePct}, ... }
async function fetchLiveJson(url) {
  const resp = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data || typeof data.prices !== "object") throw new Error("형식 오류");
  return data;
}

function startLivePolling(symbols, publish) {
  const krTargets = symbols.filter((s) => s.mobileFeed === "livekr" && s.krSymbol);
  const globalTargets = symbols.filter((s) => s.mobileFeed === "global" && s.globalKey);

  const poll = async () => {
    if (krTargets.length > 0) {
      try {
        const data = await fetchLiveJson(LIVE_KR_URL);
        for (const sym of krTargets) {
          const price = data.prices[sym.krSymbol];
          if (typeof price !== "number") continue;
          publish({ id: sym.id, price, change: null, changePct: null, source: `GitHub ${data.updated}`, ts: Date.now() });
        }
      } catch {
        // 다음 폴링에서 재시도 — 실패해도 기존 표시 유지
      }
    }
    if (globalTargets.length > 0) {
      try {
        const data = await fetchLiveJson(LIVE_GLOBAL_URL);
        for (const sym of globalTargets) {
          const q = data.prices[sym.globalKey];
          if (!q || typeof q.price !== "number") continue;
          publish({ id: sym.id, price: q.price, change: q.change ?? null, changePct: q.changePct ?? null, source: `GitHub ${data.updated}`, ts: Date.now() });
        }
      } catch {
        // live-trading 브랜치가 아직 없거나(워크플로 첫 실행 전) 일시 오류 — 재시도
      }
    }
  };

  poll();
  setInterval(poll, LIVE_POLL_MS);
}

function startMobileFeeds(symbols, publish) {
  startUpbitWs(symbols.filter((s) => s.mobileFeed === "upbit"), publish);
  startLivePolling(symbols, publish);
}
