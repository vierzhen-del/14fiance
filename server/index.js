import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PORT, YAHOO_POLL_MS, SYMBOLS, KIS, KIS_ENABLED } from "./config.js";
import { Broadcaster } from "./broadcaster.js";
import { createAlertEngine } from "./alerts.js";
import { createPortfolio } from "./portfolio.js";
import { createReporter } from "./report.js";
import { startUpbitFeed } from "./feeds/upbit.js";
import { startYahooFeed } from "./feeds/yahoo.js";
import { startKisFeed } from "./feeds/kis.js";
import { startKisFuturesFeed } from "./feeds/kisFutures.js";
import { startMockFeed } from "./feeds/mock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

// KIS 앱키 미설정 시 국내 주식(feed:"kis")을 Yahoo 지연 시세로 폴백
const symbols = SYMBOLS.map((s) =>
  s.feed === "kis" && !KIS_ENABLED ? { ...s, feed: "yahoo" } : s
);

const broadcaster = new Broadcaster();
const alerts = createAlertEngine(path.join(root, "alerts.config.json"), symbols);
const portfolio = createPortfolio(path.join(root, "portfolio.json"), symbols);
const reporter = createReporter(symbols, {
  reportsDir: path.join(root, "reports"),
  notionKey: process.env.NOTION_API_KEY,
  notionParentPageId: process.env.NOTION_PARENT_PAGE_ID,
  reportTime: process.env.REPORT_TIME ?? "16:00",
  portfolio,
});

// 신규 접속자 스냅샷에 얼럿 이력·포트폴리오 요약 포함
broadcaster.snapshotExtras = () => ({
  alerts: alerts.getRecent(),
  portfolio: portfolio.summary(),
});

// 모든 피드가 이 한 지점을 통과한다: 중계 → 리포트 집계 → 얼럿 판정 → 손익 갱신
const publish = (quote) => {
  broadcaster.publish(quote);
  reporter.record(quote);
  for (const alert of alerts.check(quote)) {
    reporter.addAlert(alert);
    broadcaster.broadcast({ type: "alert", alert });
  }
  const summary = portfolio.update(quote);
  if (summary) broadcaster.broadcast({ type: "portfolio", summary });
};

const app = express();
app.use(express.static(path.join(root, "public")));
app.get("/api/symbols", (_req, res) => res.json(symbols));
app.get("/api/portfolio", (_req, res) => res.json(portfolio.summary()));
app.get("/api/alerts", (_req, res) => res.json(alerts.getRecent()));
app.post("/api/report", async (_req, res) => {
  try {
    res.json(await reporter.generate());
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const server = http.createServer(app);
broadcaster.attach(server);

if (process.env.MOCK === "1") {
  startMockFeed(symbols, publish);
} else {
  startUpbitFeed(symbols, publish);
  startYahooFeed(symbols, publish, YAHOO_POLL_MS);
  if (KIS_ENABLED) {
    startKisFeed(symbols, publish, KIS);
    startKisFuturesFeed(symbols, publish, KIS, {
      marketCode: process.env.KIS_FUT_MARKET_CODE ?? "F",
      pollMs: Number(process.env.KIS_FUT_POLL_MS ?? 10000),
    });
    if (symbols.some((s) => s.feed === "kisfut" && !s.kisFutCode)) {
      console.log("[kisfut] KIS_FUT_CODE 미설정 — 코스피200 선물 타일은 시세 대기 상태로 표시됩니다");
    }
  } else {
    console.log("[kis] KIS_APP_KEY 미설정 — 국내 주식은 Yahoo 지연 시세로, 코스피200 선물은 시세 대기로 표시됩니다");
  }
}
reporter.startScheduler();

server.listen(PORT, () => {
  console.log(`realtime-trading dashboard: http://localhost:${PORT}`);
});
