import WebSocket from "ws";

// 한국투자증권 OpenAPI 실시간 체결가(H0STCNT0) 웹소켓
// https://apiportal.koreainvestment.com — 계좌 개설 후 앱키/시크릿 무료 발급
// KIS_APP_KEY / KIS_APP_SECRET 미설정 시 이 피드는 사용되지 않고 Yahoo 폴백이 담당한다.
const HOSTS = {
  prod: {
    rest: "https://openapi.koreainvestment.com:9443",
    ws: "ws://ops.koreainvestment.com:21000",
  },
  vps: {
    rest: "https://openapivts.koreainvestment.com:29443",
    ws: "ws://ops.koreainvestment.com:31000",
  },
};

const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 120000;

async function getApprovalKey(kis) {
  const host = HOSTS[kis.env] ?? HOSTS.prod;
  const res = await fetch(`${host.rest}/oauth2/Approval`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: kis.appKey,
      secretkey: kis.appSecret,
    }),
  });
  if (!res.ok) throw new Error(`approval HTTP ${res.status}`);
  const json = await res.json();
  if (!json.approval_key) throw new Error("no approval_key in response");
  return json.approval_key;
}

// H0STCNT0 체결 데이터 필드(^ 구분): [0]종목코드 [1]체결시간 [2]현재가 [3]전일대비부호 [4]전일대비 [5]전일대비율 ...
function parseTick(payload, byCode, publish) {
  for (const record of payload.split("$")) {
    const f = record.split("^");
    const sym = byCode.get(f[0]);
    if (!sym || f[2] == null) continue;
    const sign = ["4", "5"].includes(f[3]) ? -1 : 1; // 4:하락, 5:하한
    publish({
      id: sym.id,
      name: sym.name,
      price: Number(f[2]),
      change: sign * Math.abs(Number(f[4])),
      changePct: sign * Math.abs(Number(f[5])),
      currency: sym.currency,
      source: "KIS(실시간)",
      ts: Date.now(),
    });
  }
}

export async function startKisFeed(symbols, publish, kis) {
  const targets = symbols.filter((s) => s.feed === "kis" && s.kisCode);
  if (targets.length === 0) return;
  const byCode = new Map(targets.map((s) => [s.kisCode, s]));
  const host = HOSTS[kis.env] ?? HOSTS.prod;

  let retryMs = RECONNECT_BASE_MS;

  const connect = async () => {
    let approvalKey;
    try {
      approvalKey = await getApprovalKey(kis);
    } catch (err) {
      console.warn(`[kis] approval failed: ${err.message}, retrying in ${retryMs}ms`);
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
      return;
    }

    const ws = new WebSocket(host.ws);

    ws.on("open", () => {
      retryMs = RECONNECT_BASE_MS;
      console.log(`[kis] connected (${[...byCode.keys()].join(", ")})`);
      for (const code of byCode.keys()) {
        ws.send(
          JSON.stringify({
            header: {
              approval_key: approvalKey,
              custtype: "P",
              tr_type: "1",
              "content-type": "utf-8",
            },
            body: { input: { tr_id: "H0STCNT0", tr_key: code } },
          })
        );
      }
    });

    ws.on("message", (raw) => {
      const msg = raw.toString();
      if (msg.startsWith("{")) {
        // 구독 응답 또는 PINGPONG 제어 메시지
        try {
          const json = JSON.parse(msg);
          if (json.header?.tr_id === "PINGPONG") ws.send(msg);
        } catch {
          /* ignore */
        }
        return;
      }
      // 실시간 데이터: "암호화여부|TR_ID|데이터건수|응답데이터"
      const parts = msg.split("|");
      if (parts[1] === "H0STCNT0" && parts[3]) {
        parseTick(parts[3], byCode, publish);
      }
    });

    const scheduleReconnect = () => {
      setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RECONNECT_MAX_MS);
    };
    ws.on("close", () => {
      console.warn(`[kis] disconnected, retrying in ${retryMs}ms`);
      scheduleReconnect();
    });
    ws.on("error", (err) => {
      console.warn(`[kis] error: ${err.message}`);
      ws.terminate();
    });
  };

  connect();
}
