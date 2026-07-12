import fs from "node:fs";
import path from "node:path";

// 데일리 시황 리포트 — 일중 시세를 집계해 reports/YYYY-MM-DD.md 로 저장하고,
// NOTION_API_KEY + NOTION_PARENT_PAGE_ID 가 설정되어 있으면 노션 페이지로도 게시한다.
const NOTION_API = "https://api.notion.com/v1/pages";
const NOTION_VERSION = "2022-06-28";

const kstDate = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
const kstTime = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());

export function createReporter(symbols, opts) {
  const { reportsDir, notionKey, notionParentPageId, reportTime, portfolio } = opts;
  const order = symbols.map((s) => s.id);
  const names = new Map(symbols.map((s) => [s.id, s.name]));

  let day = kstDate();
  let agg = new Map(); // symbolId -> { open, high, low, last, changePct }
  let alertsToday = [];
  let generatedFor = null;

  function rollover() {
    const d = kstDate();
    if (d !== day) {
      day = d;
      agg = new Map();
      alertsToday = [];
    }
  }

  function record(quote) {
    rollover();
    const a = agg.get(quote.id);
    if (!a) {
      agg.set(quote.id, {
        open: quote.price,
        high: quote.price,
        low: quote.price,
        last: quote.price,
        changePct: quote.changePct,
      });
      return;
    }
    a.high = Math.max(a.high, quote.price);
    a.low = Math.min(a.low, quote.price);
    a.last = quote.price;
    a.changePct = quote.changePct;
  }

  function addAlert(alert) {
    rollover();
    alertsToday.push(alert);
  }

  const num = (v) =>
    v == null ? "-" : v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
  const pct = (v) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);

  function buildRows() {
    return order
      .filter((id) => agg.has(id))
      .map((id) => {
        const a = agg.get(id);
        return [names.get(id) ?? id, num(a.open), num(a.high), num(a.low), num(a.last), pct(a.changePct)];
      });
  }

  function buildMarkdown() {
    const rows = buildRows();
    const lines = [
      `# 📅 데일리 시황 ${day}`,
      "",
      `> 생성 시각: ${day} ${kstTime()} KST · realtime-trading 자동 리포트`,
      "",
      "## 종목별 시황",
      "",
      "| 종목 | 시가 | 고가 | 저가 | 현재가 | 등락률 |",
      "|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.join(" | ")} |`),
      "",
      "## 오늘의 얼럿",
      "",
      ...(alertsToday.length === 0
        ? ["트리거된 얼럿 없음"]
        : alertsToday.map((a) => {
            const t = new Date(a.ts).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" });
            return `- ${t} **${a.name}** — ${a.message}${a.note ? ` (${a.note})` : ""}`;
          })),
    ];

    const pf = portfolio?.summary();
    if (pf) {
      lines.push("", "## 포트폴리오", "", "| 종목 | 수량 | 평단가 | 현재가 | 손익 | 수익률 |", "|---|---|---|---|---|---|");
      for (const p of pf.positions) {
        lines.push(`| ${p.name} | ${num(p.quantity)} | ${num(p.avgPrice)} | ${num(p.price)} | ${num(p.pnl)} | ${pct(p.pnlPct)} |`);
      }
      for (const [cur, t] of Object.entries(pf.totals)) {
        lines.push("", `**${cur} 합계**: 평가 ${num(t.value)} · 손익 ${num(t.pnl)} (${pct(t.pnlPct)})`);
      }
    }
    return lines.join("\n") + "\n";
  }

  // ---- Notion 게시 (블록 구성) ----
  const rt = (text) => [{ type: "text", text: { content: String(text) } }];
  const heading = (text) => ({ object: "block", type: "heading_2", heading_2: { rich_text: rt(text) } });
  const paragraph = (text) => ({ object: "block", type: "paragraph", paragraph: { rich_text: rt(text) } });
  const tableBlock = (header, rows) => ({
    object: "block",
    type: "table",
    table: {
      table_width: header.length,
      has_column_header: true,
      children: [header, ...rows].map((cells) => ({
        type: "table_row",
        table_row: { cells: cells.map((c) => rt(c)) },
      })),
    },
  });

  async function publishToNotion() {
    const children = [
      paragraph(`생성 시각: ${day} ${kstTime()} KST · realtime-trading 자동 리포트`),
      heading("종목별 시황"),
      tableBlock(["종목", "시가", "고가", "저가", "현재가", "등락률"], buildRows()),
      heading("오늘의 얼럿"),
      ...(alertsToday.length === 0
        ? [paragraph("트리거된 얼럿 없음")]
        : alertsToday.map((a) =>
            paragraph(
              `${new Date(a.ts).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })} ${a.name} — ${a.message}${a.note ? ` (${a.note})` : ""}`
            )
          )),
    ];
    const pf = portfolio?.summary();
    if (pf) {
      children.push(
        heading("포트폴리오"),
        tableBlock(
          ["종목", "수량", "평단가", "현재가", "손익", "수익률"],
          pf.positions.map((p) => [p.name, num(p.quantity), num(p.avgPrice), num(p.price), num(p.pnl), pct(p.pnlPct)])
        ),
        ...Object.entries(pf.totals).map(([cur, t]) =>
          paragraph(`${cur} 합계: 평가 ${num(t.value)} · 손익 ${num(t.pnl)} (${pct(t.pnlPct)})`)
        )
      );
    }

    const res = await fetch(NOTION_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { page_id: notionParentPageId },
        icon: { type: "emoji", emoji: "📅" },
        properties: { title: { title: rt(`데일리 시황 ${day}`) } },
        children,
      }),
    });
    if (!res.ok) {
      throw new Error(`Notion API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()).url;
  }

  async function generate() {
    rollover();
    if (agg.size === 0) {
      return { ok: false, error: "집계된 시세가 없습니다 (서버가 시세를 수신한 뒤 실행하세요)" };
    }
    fs.mkdirSync(reportsDir, { recursive: true });
    const file = path.join(reportsDir, `${day}.md`);
    fs.writeFileSync(file, buildMarkdown());
    console.log(`[report] 저장: ${file}`);

    let notionUrl = null;
    if (notionKey && notionParentPageId) {
      try {
        notionUrl = await publishToNotion();
        console.log(`[report] 노션 게시: ${notionUrl}`);
      } catch (err) {
        console.warn(`[report] 노션 게시 실패: ${err.message}`);
        return { ok: true, file, notionError: err.message };
      }
    } else {
      console.log("[report] NOTION_API_KEY 미설정 — 로컬 md만 저장");
    }
    generatedFor = day;
    return { ok: true, file, notionUrl };
  }

  // 매일 reportTime(KST, "HH:MM")에 자동 생성
  function startScheduler() {
    if (!reportTime) return;
    console.log(`[report] 매일 ${reportTime} KST 자동 생성 예약`);
    setInterval(() => {
      if (kstTime() === reportTime && generatedFor !== kstDate()) {
        generate().catch((err) => console.warn(`[report] 자동 생성 실패: ${err.message}`));
      }
    }, 30 * 1000);
  }

  return { record, addAlert, generate, startScheduler };
}
