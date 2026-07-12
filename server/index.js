import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, YAHOO_POLL_MS, SYMBOLS, KIS, KIS_ENABLED } from "./config.js";
import { Broadcaster } from "./broadcaster.js";
import { startUpbitFeed } from "./feeds/upbit.js";
import { startYahooFeed } from "./feeds/yahoo.js";
import { startKisFeed } from "./feeds/kis.js";
import { startMockFeed } from "./feeds/mock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// KIS 앱키 미설정 시 국내 주식(feed:"kis")을 Yahoo 지연 시세로 폴백
const symbols = SYMBOLS.map((s) =>
  s.feed === "kis" && !KIS_ENABLED ? { ...s, feed: "yahoo" } : s
);

const app = express();
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("/api/symbols", (_req, res) => res.json(symbols));

const server = http.createServer(app);
const broadcaster = new Broadcaster();
broadcaster.attach(server);

const publish = (quote) => broadcaster.publish(quote);
if (process.env.MOCK === "1") {
  startMockFeed(symbols, publish);
} else {
  startUpbitFeed(symbols, publish);
  startYahooFeed(symbols, publish, YAHOO_POLL_MS);
  if (KIS_ENABLED) {
    startKisFeed(symbols, publish, KIS);
  } else {
    console.log("[kis] KIS_APP_KEY 미설정 — 국내 주식은 Yahoo 지연 시세로 표시됩니다");
  }
}

server.listen(PORT, () => {
  console.log(`realtime-trading dashboard: http://localhost:${PORT}`);
});
