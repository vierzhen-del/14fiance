import fs from "node:fs";

// 포트폴리오 손익 트래킹 — portfolio.json 의 보유 내역을 최신 시세로 평가한다.
// 보유 내역: [{ symbolId, quantity, avgPrice }]
// 환율은 적용하지 않고 통화(KRW/USD)별로 분리 집계한다.
export function createPortfolio(configPath, symbols) {
  let holdings = [];
  try {
    holdings = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log(`[portfolio] ${holdings.length}개 포지션 로드 (${configPath})`);
  } catch {
    console.log(
      "[portfolio] portfolio.json 없음 — 손익 트래킹 비활성 (portfolio.example.json 참고)"
    );
  }

  const meta = new Map(symbols.map((s) => [s.id, s]));
  const heldIds = new Set(holdings.map((h) => h.symbolId));
  const prices = new Map(); // symbolId -> 최신가

  function summary() {
    if (holdings.length === 0) return null;
    const positions = holdings.map((h) => {
      const m = meta.get(h.symbolId);
      const price = prices.get(h.symbolId);
      const base = {
        id: h.symbolId,
        name: m?.name ?? h.symbolId,
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        currency: m?.currency ?? "KRW",
      };
      if (price == null) return { ...base, price: null, value: null, pnl: null, pnlPct: null };
      const value = price * h.quantity;
      const cost = h.avgPrice * h.quantity;
      const pnl = value - cost;
      return { ...base, price, value, pnl, pnlPct: cost ? (pnl / cost) * 100 : null };
    });

    const totals = {};
    for (const p of positions) {
      if (p.value == null) continue;
      const t = (totals[p.currency] ??= { value: 0, cost: 0, pnl: 0 });
      t.value += p.value;
      t.cost += p.avgPrice * p.quantity;
      t.pnl += p.pnl;
    }
    for (const t of Object.values(totals)) {
      t.pnlPct = t.cost ? (t.pnl / t.cost) * 100 : null;
    }
    return { positions, totals };
  }

  // 보유 종목의 시세가 갱신됐을 때만 새 요약을 반환
  function update(quote) {
    if (!heldIds.has(quote.id)) return null;
    prices.set(quote.id, quote.price);
    return summary();
  }

  return { update, summary };
}
