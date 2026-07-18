import { WebSocketServer } from "ws";

// 종목별 최신 시세를 보관하고, 접속 중인 대시보드 클라이언트 전체에 중계한다.
export class Broadcaster {
  constructor() {
    this.latest = new Map(); // id -> quote
    this.wss = null;
    // index.js에서 주입 — 신규 접속자 스냅샷에 얼럿/포트폴리오 상태를 포함시키기 위함
    this.snapshotExtras = () => ({});
  }

  attach(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });
    this.wss.on("connection", (ws) => {
      // 신규 접속자에게 현재 스냅샷 전송
      ws.send(
        JSON.stringify({
          type: "snapshot",
          quotes: [...this.latest.values()],
          ...this.snapshotExtras(),
        })
      );
    });
  }

  // 임의 메시지를 접속 클라이언트 전체에 전송
  broadcast(obj) {
    if (!this.wss) return;
    const msg = JSON.stringify(obj);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  // quote: { id, name, price, change, changePct, currency, source, ts }
  publish(quote) {
    this.latest.set(quote.id, quote);
    this.broadcast({ type: "quote", quote });
  }
}
