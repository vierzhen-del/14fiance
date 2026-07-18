// 데모/개발용 목 피드 — MOCK=1 로 실행 시 외부 API 없이 랜덤워크 시세를 생성한다.
const BASE_PRICES = {
  btc: 163000000,
  kospi: 3420,
  kospi200_fut: 470.5,
  nasdaq_fut: 23500,
  samsung: 112000,
  hynix: 289000,
  sox: 6890,
  soxx: 312,
};

export function startMockFeed(symbols, publish, intervalMs = 1000) {
  console.log("[mock] 데모 모드 — 랜덤워크 시세 생성 중");
  const state = symbols.map((s) => {
    const base = BASE_PRICES[s.id] ?? 100;
    return { sym: s, base, price: base };
  });

  const tick = () => {
    for (const st of state) {
      st.price = Math.max(st.base * 0.9, st.price * (1 + (Math.random() - 0.5) * 0.004));
      const change = st.price - st.base;
      publish({
        id: st.sym.id,
        name: st.sym.name,
        price:
          !st.sym.isIndex && st.sym.currency === "KRW"
            ? Math.round(st.price)
            : Number(st.price.toFixed(2)),
        change,
        changePct: (change / st.base) * 100,
        currency: st.sym.currency,
        source: "mock(데모)",
        ts: Date.now(),
      });
    }
  };

  tick();
  setInterval(tick, intervalMs);
}
