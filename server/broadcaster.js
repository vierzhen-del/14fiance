import { WebSocketServer } from "ws";

// 종목별 최신 시세를 보관하고, 접속 중인 대시보드 클라이언트 전체에 중계한다.
export class Broadcaster {
  constructor() {
    this.latest = new Map(); // id -> quote
    this.wss = null;
  }

  attach(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    this.wss.on("connection", (ws) => {
      // 신규 접속자에게 현재 스냅샷 전송
      ws.send(
        JSON.stringify({ type: "snapshot", quotes: [...this.latest.values()] })
      );
    });
  }

  // quote: { id, name, price, change, changePct, currency, source, ts }
  publish(quote) {
    this.latest.set(quote.id, quote);
    if (!this.wss) return;
    const msg = JSON.stringify({ type: "quote", quote });
    for (const client of this.wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }
}
