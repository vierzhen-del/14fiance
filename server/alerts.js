import fs from "node:fs";

// 얼럿 엔진 — alerts.config.json 의 규칙을 시세 스트림에 대조한다.
// 규칙: { symbolId, type: "price_above" | "price_below" | "pct_move", value, note? }
//  - price_above / price_below : 현재가 기준 상·하한
//  - pct_move : 전일 대비 등락률 절대값(%) 임계치
const COOLDOWN_MS = 30 * 60 * 1000; // 동일 규칙 재발동 방지
const RECENT_MAX = 50;

export function createAlertEngine(configPath, symbols) {
  let rules = [];
  try {
    rules = JSON.parse(fs.readFileSync(configPath, "utf8"));
    console.log(`[alerts] ${rules.length}개 규칙 로드 (${configPath})`);
  } catch {
    console.log(
      "[alerts] alerts.config.json 없음 — 얼럿 비활성 (alerts.config.example.json 참고)"
    );
  }

  const names = new Map(symbols.map((s) => [s.id, s.name]));
  const lastFired = new Map(); // ruleIndex -> ts
  const recent = [];

  // 트리거된 얼럿 배열을 반환 (없으면 빈 배열)
  function check(quote) {
    const fired = [];
    rules.forEach((rule, i) => {
      if (rule.symbolId !== quote.id) return;

      let desc = null;
      if (rule.type === "price_above" && quote.price >= rule.value) {
        desc = `${rule.value.toLocaleString("ko-KR")} 상향 돌파`;
      } else if (rule.type === "price_below" && quote.price <= rule.value) {
        desc = `${rule.value.toLocaleString("ko-KR")} 하향 이탈`;
      } else if (
        rule.type === "pct_move" &&
        quote.changePct != null &&
        Math.abs(quote.changePct) >= rule.value
      ) {
        desc = `등락률 ±${rule.value}% 초과 (현재 ${quote.changePct.toFixed(2)}%)`;
      }
      if (!desc) return;

      const now = Date.now();
      if (now - (lastFired.get(i) ?? 0) < COOLDOWN_MS) return;
      lastFired.set(i, now);

      const alert = {
        id: `${i}-${now}`,
        symbolId: quote.id,
        name: names.get(quote.id) ?? quote.id,
        rule: rule.type,
        message: desc,
        note: rule.note ?? "",
        price: quote.price,
        ts: now,
      };
      recent.unshift(alert);
      if (recent.length > RECENT_MAX) recent.pop();
      console.log(`[alerts] ${alert.name}: ${alert.message} (현재가 ${quote.price})`);
      fired.push(alert);
    });
    return fired;
  }

  return { check, getRecent: () => recent };
}
