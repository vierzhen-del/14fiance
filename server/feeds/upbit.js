import WebSocket from "ws";

const UPBIT_WS = "wss://api.upbit.com/websocket/v1";
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

// Upbit 공개 WebSocket — 인증 불필요, 실시간 체결가(ticker) 수신
// https://docs.upbit.com/kr/reference/websocket-ticker
export function startUpbitFeed(symbols, publish) {
  const targets = symbols.filter((s) => s.feed === "upbit");
  if (targets.length === 0) return;
  const codes = targets.map((s) => s.upbitCode);
  const byCode = new Map(targets.map((s) => [s.upbitCode, s]));

  let retryMs = RECONNECT_BASE_MS;

  const connect = () => {
    const ws = new WebSocket(UPBIT_WS);

    ws.on("open", () => {
      retryMs = RECONNECT_BASE_MS;
      console.log(`[upbit] connected (${codes.join(", ")})`);
      ws.send(
        JSON.stringify([
          { ticket: "realtime-trading" },
          { type: "ticker", codes },
        ])
      );
    });

    ws.on("message", (raw) => {
      try {
        const t = JSON.parse(raw.toString());
        const sym = byCode.get(t.code);
        if (!sym || t.trade_price == null) return;
        publish({
          id: sym.id,
          name: sym.name,
          price: t.trade_price,
          change: t.signed_change_price,
          changePct: t.signed_change_rate * 100,
          currency: sym.currency,
          source: "upbit(실시간)",
          ts: t.trade_timestamp ?? Date.now(),
        });
      } catch {
        // 개별 메시지 파싱 실패는 무시
      }
    });

    const scheduleReconnect = () => {
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    };
    ws.on("close", () => {
      console.warn(`[upbit] disconnected, retrying in ${retryMs}ms`);
      scheduleReconnect();
    });
    ws.on("error", (err) => {
      console.warn(`[upbit] error: ${err.message}`);
      ws.terminate();
    });
  };

  connect();
}
