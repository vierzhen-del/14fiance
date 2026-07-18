// Yahoo Finance 차트 API 폴링 — 키 불필요, 지연 시세 (지수 ~15분)
// 미국 반도체(SOX/SOXX), 코스피 지수, 그리고 KIS 미설정 시 국내 주식 폴백에 사용
const CHART_URL = (symbol) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;

async function fetchQuote(symbol) {
  const res = await fetch(CHART_URL(symbol), {
    headers: { "User-Agent": "Mozilla/5.0 (realtime-trading dashboard)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) {
    throw new Error("no price in response");
  }
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  const change = prevClose != null ? price - prevClose : null;
  const changePct = prevClose ? (change / prevClose) * 100 : null;
  return { price, change, changePct, ts: (meta.regularMarketTime ?? 0) * 1000 || Date.now() };
}

export function startYahooFeed(symbols, publish, pollMs) {
  const targets = symbols.filter((s) => s.feed === "yahoo" && s.yahooSymbol);
  if (targets.length === 0) return;
  console.log(`[yahoo] polling ${targets.map((s) => s.yahooSymbol).join(", ")} every ${pollMs}ms`);

  const poll = async () => {
    for (const sym of targets) {
      try {
        const q = await fetchQuote(sym.yahooSymbol);
        publish({
          id: sym.id,
          name: sym.name,
          price: q.price,
          change: q.change,
          changePct: q.changePct,
          currency: sym.currency,
          source: "yahoo(지연)",
          ts: q.ts,
        });
      } catch (err) {
        console.warn(`[yahoo] ${sym.yahooSymbol}: ${err.message}`);
      }
    }
  };

  poll();
  setInterval(poll, pollMs);
}
