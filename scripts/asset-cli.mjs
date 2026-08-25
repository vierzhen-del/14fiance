#!/usr/bin/env node
/**
 * asset-cli — 백업 JSON + 저장소 가격데이터로 자산 질문에 답하는 커맨드라인 도구
 *
 * 앱을 켜지 않고 터미널에서 계좌 현황·배당·수익률을 조회한다. 텔레그램 봇(n8n)이
 * 답하지 못하는 질문을 여기서 먼저 확인하고, 필요하면 같은 계산을 n8n으로 옮긴다.
 *
 *   node scripts/asset-cli.mjs check    --file ~/myassets-2026-08-25.json
 *   node scripts/asset-cli.mjs accounts --file <backup.json>
 *   node scripts/asset-cli.mjs project  --file <backup.json> --account DC --years 5
 *
 * ⚠️ 백업 JSON은 개인 보유 데이터다. 이 저장소(public)에 커밋하지 말 것 —
 *    파일 경로만 인자로 넘긴다.
 *
 * 데이터 출처
 *   - 보유수량·매입단가·이력 : 사용자 백업 JSON (--file)
 *   - 가격 이력             : data/{symbol}.json      (주 1회 수집)
 *   - 환율                  : data/fx/USDKRW.json
 *   - 종목 메타(성향·지역)   : scripts/etf_list.json
 *
 * 값을 지어내지 않는다 — 가격·분배율이 없으면 null로 두고 "모름"으로 표시한다.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

/* ---------------- 인자 파싱 ---------------- */

function parseArgs(argv) {
  const cmd = argv[2];
  const opts = {};
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return { cmd, opts };
}

/* ---------------- 표기 헬퍼 ---------------- */

const won = (v) => (v == null ? "—" : Math.round(v).toLocaleString("ko-KR") + "원");
const shortWon = (v) => {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e8) return (v / 1e8).toFixed(2) + "억";
  if (a >= 1e4) return Math.round(v / 1e4).toLocaleString("ko-KR") + "만";
  return Math.round(v).toLocaleString("ko-KR");
};
const pct = (v, d = 2) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const pad = (s, n) => String(s).padEnd(n, " ");
const padL = (s, n) => String(s).padStart(n, " ");
/** 한글은 터미널에서 2칸을 차지한다 — 표 정렬이 밀리지 않게 폭을 따로 센다. */
const dispWidth = (s) => [...String(s)].reduce((w, ch) => w + (/[ᄀ-ᇿ　-〿가-힯＀-｠]/.test(ch) ? 2 : 1), 0);
const padDisp = (s, n) => String(s) + " ".repeat(Math.max(0, n - dispWidth(s)));

/** 계좌명 마스킹 — 앱 maskAccountLabel과 같은 규칙(끝 2자리만 남긴다). */
function maskAccount(label) {
  if (!label) return "";
  return String(label).replace(/(\d{3,})/g, (m) => "*".repeat(Math.max(0, m.length - 2)) + m.slice(-2));
}

function hr(ch = "─", n = 62) { return ch.repeat(n); }
function head(title) { console.log(`\n${title}\n${hr()}`); }

/* ---------------- 데이터 로딩 ---------------- */

function loadBackup(file) {
  if (!file || file === true) die("--file <백업 JSON 경로> 가 필요합니다.");
  const p = path.resolve(String(file).replace(/^~/, process.env.HOME || "~"));
  if (!fs.existsSync(p)) die(`파일을 찾을 수 없습니다: ${p}`);
  let json;
  try { json = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { die(`JSON 파싱 실패: ${e.message}`); }
  if (!Array.isArray(json.rows)) die("이 파일에 rows 배열이 없습니다 — 앱 「📤 내보내기」로 받은 JSON이 맞는지 확인하세요.");
  return json;
}

let META = null;
function loadMeta() {
  if (META) return META;
  META = new Map();
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "etf_list.json"), "utf8"));
  for (const region of ["kr", "us"]) {
    for (const e of list[region] || []) {
      META.set(e.symbol, { ...e, currency: region === "us" ? "USD" : "KRW" });
    }
  }
  return META;
}

const PRICE_CACHE = new Map();
function loadPrices(symbol) {
  if (PRICE_CACHE.has(symbol)) return PRICE_CACHE.get(symbol);
  const p = path.join(DATA, `${symbol}.json`);
  let series = null;
  if (fs.existsSync(p)) {
    try {
      const d = JSON.parse(fs.readFileSync(p, "utf8"));
      if (Array.isArray(d.dates) && Array.isArray(d.closes)) series = d;
    } catch (e) { series = null; }
  }
  PRICE_CACHE.set(symbol, series);
  return series;
}

let MANIFEST = null;
/** 수집 카탈로그 전체(보유 여부 무관) — 시장 랭킹의 모집단. */
function loadManifest() {
  if (MANIFEST) return MANIFEST;
  const p = path.join(DATA, "manifest.json");
  if (!fs.existsSync(p)) die("data/manifest.json 이 없습니다.");
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  MANIFEST = { updated: m.updated, items: [...(m.kr || []), ...(m.us || [])] };
  return MANIFEST;
}

let FX = null;
function loadFx() {
  if (FX) return FX;
  const p = path.join(DATA, "fx", "USDKRW.json");
  FX = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
  return FX;
}

/**
 * 기준일 이하의 마지막 값을 찾는다(이진탐색). 주 1회 수집이라 정확히 그날의
 * 종가가 없는 게 정상 — "그날 이전 마지막 수집분"을 쓰고 그 날짜를 함께 돌려준다.
 */
function valueAsOf(dates, values, asOf) {
  if (!dates || !dates.length) return null;
  if (!asOf) return { value: values[values.length - 1], date: dates[dates.length - 1] };
  let lo = 0, hi = dates.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= asOf) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (found < 0) return null;
  return { value: values[found], date: dates[found] };
}

function priceAt(symbol, asOf) {
  const s = loadPrices(symbol);
  if (!s) return null;
  return valueAsOf(s.dates, s.closes, asOf);
}
function fxAt(asOf) {
  const f = loadFx();
  if (!f) return null;
  return valueAsOf(f.dates, f.rates, asOf);
}

/* ---------------- 평가 엔진 ---------------- */

/**
 * 보유 행 × 기준일 가격 → 원화 평가액.
 * asOf가 과거여도 **현재 보유수량**을 쓴다 — 과거 수량 이력이 없기 때문이다.
 * 즉 "지금 이 구성을 그때 들고 있었다면" 기준이며, 호출부가 그렇게 표기해야 한다.
 */
function valuate(rows, asOf) {
  const meta = loadMeta();
  const fx = fxAt(asOf);
  const out = [];
  const missing = [];
  for (const r of rows) {
    if (!(r.qty > 0)) continue;
    const m = meta.get(r.symbol);
    const px = priceAt(r.symbol, asOf);
    if (!px || !(px.value > 0)) { missing.push(r.symbol); continue; }
    const isUsd = m ? m.currency === "USD" : !/\.KS$/.test(r.symbol);
    const rate = isUsd ? (fx ? fx.value : null) : 1;
    if (rate == null) { missing.push(r.symbol); continue; }
    const value = px.value * rate * r.qty;
    const cost = r.avgPrice > 0 ? r.avgPrice * (isUsd ? rate : 1) * r.qty : null;
    out.push({
      account: r.account || "계좌 미지정",
      symbol: r.symbol,
      name: m ? m.name : r.symbol,
      style: m ? m.style : "미분류",
      region: m ? m.region : "미분류",
      qty: r.qty,
      price: px.value,
      priceDate: px.date,
      currency: isUsd ? "USD" : "KRW",
      value, cost,
      divRate: r.divRate || 0,
      confirmedDps: r.confirmedDps || 0,
      payPeriod: r.payPeriod || "",
    });
  }
  return { rows: out, missing, fxDate: fx ? fx.date : null, fxRate: fx ? fx.value : null };
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, { value: 0, cost: 0, costedValue: 0, rows: [] });
    const g = m.get(k);
    g.value += r.value;
    if (r.cost != null) { g.cost += r.cost; g.costedValue += r.value; }
    g.rows.push(r);
  }
  return m;
}

/** 월배당 — 앱과 같은 우선순위: ①등록 분배율×현재가 ②확정DPS×수량 ③모름(null). */
function monthlyDiv(r) {
  if (r.divRate > 0) return { amount: r.value * (r.divRate / 100), basis: "divRate" };
  if (r.confirmedDps > 0) {
    const rate = r.currency === "USD" ? (loadFx() ? loadFx().rates[loadFx().rates.length - 1] : 1) : 1;
    return { amount: r.confirmedDps * rate * r.qty, basis: "confirmedDps" };
  }
  return { amount: null, basis: "unknown" };
}

/* ---------------- 수익률 계산 ---------------- */

const MONTHS_BY_PERIOD = { "1m": 1, "3m": 3, "6m": 6, "1y": 12, "2y": 24, "3y": 36 };

function monthsAgoStr(months, base) {
  const d = base ? new Date(base) : new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/**
 * 두 시점 사이 수익률을 **통화기준·원화환산 두 갈래로** 돌려준다.
 *
 * 미국 종목은 이 둘이 다르다 — 달러로 +10%인데 환율이 5% 내리면 원화로는 +4.5%다.
 * 어느 쪽이 "맞다"가 아니라 질문이 다른 것이다:
 *   native(통화기준) = 그 자산 자체가 얼마나 올랐나 (종목 비교용)
 *   krw(원화환산)    = 내 원화 자산이 얼마나 늘었나 (실제 손익)
 * 국내 종목은 둘이 같다.
 */
function periodReturn(symbol, currency, fromDate, toDate) {
  const p0 = priceAt(symbol, fromDate);
  const p1 = priceAt(symbol, toDate);
  if (!p0 || !p1 || !(p0.value > 0) || !(p1.value > 0)) return null;
  if (p0.date === p1.date) return null; // 두 시점이 같은 수집분이면 비교 불가
  const native = ((p1.value - p0.value) / p0.value) * 100;
  let krw = native;
  if (currency === "USD") {
    const f0 = fxAt(fromDate), f1 = fxAt(toDate);
    if (f0 && f1 && f0.value > 0) {
      const v0 = p0.value * f0.value, v1 = p1.value * f1.value;
      krw = ((v1 - v0) / v0) * 100;
    } else {
      krw = null; // 환율 이력이 없으면 지어내지 않는다
    }
  }
  return { native, krw, from: p0.date, to: p1.date, fromPrice: p0.value, toPrice: p1.value };
}

/**
 * 일간 수익률의 표준편차(%). 앱 `dailyReturnSigma`(shared/myassets-utils.js:929)와
 * **같은 식**이어야 한다 — 앱 「시그널」 탭과 CLI가 다른 값을 내면 안 되기 때문.
 * 표본표준편차(n-1)를 쓰고, 데이터가 window+1 미만이면 null.
 */
function dailyReturnSigma(closes, window) {
  if (!closes || closes.length < window + 1) return null;
  const rets = [];
  for (let i = closes.length - window; i < closes.length; i++) rets.push((closes[i] / closes[i - 1] - 1) * 100);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1));
}

/** 52주(252거래일) 최고 종가 — 앱 high52와 동일. */
function high52(closes) {
  return closes && closes.length ? Math.max(...closes.slice(-252)) : null;
}

/** 카탈로그 필터 — 시장 명령들이 공유한다. */
function filterCatalog(opts) {
  let items = loadManifest().items;
  if (!opts["include-stocks"]) items = items.filter((it) => it.assetType !== "stock");
  if (typeof opts.region === "string") {
    const r = opts.region.toLowerCase();
    items = items.filter((it) => (r === "kr" ? it.region === "한국" : r === "us" ? it.region === "미국" : it.region === opts.region));
  }
  if (typeof opts.style === "string") items = items.filter((it) => it.style === opts.style);
  if (typeof opts.category === "string") items = items.filter((it) => (it.category || "").includes(opts.category));
  return items;
}

/* ---------------- A67: 이어서 물어볼 질문(넛지) ----------------
   답변 끝에 "이런 것도 물어볼 수 있어요" 5개를 붙인다(`--nudge`).

   n8n이 아니라 여기서 만드는 이유: **방금 어떤 명령이 돌았는지는 CLI만 안다.**
   n8n에서 붙이면 그 지식을 한 벌 더 관리해야 하고 금방 어긋난다.

   ⚠️ 제안 문구는 **텔레그램에 그대로 칠 말**이어야 하고, n8n "명령 분류" 노드의
   ROUTES 정규식에 **반드시 걸려야 한다.** 라우팅 안 되는 걸 권하면 사용자는
   봇이 고장난 걸로 받아들인다 — ROUTES를 고치면 이 목록도 함께 고칠 것.

   보유 데이터가 필요한 제안은 BACKUP_JSON(또는 --file)이 있을 때만 내보낸다. */
const NUDGE_POOL = {
  sigma: [
    { t: "이번달 수익률 1위 ETF" },
    { t: "분기별 best" },
    { t: "배당 ETF 랭킹" },
    { t: "계좌 현황", backup: true },
    { t: "내 종목 수익률", backup: true },
  ],
  market: [
    { t: "분기별 best" },
    { t: "배당 ETF 랭킹" },
    { t: "SOXL 시그마" },
    { t: "내 비중", backup: true },
    { t: "내 종목 수익률", backup: true },
  ],
  quarters: [
    { t: "이번달 수익률 1위 ETF" },
    { t: "배당 ETF 랭킹" },
    { t: "SOXL 시그마" },
    { t: "계좌 현황", backup: true },
    { t: "MDD 추이", backup: true },
  ],
  accounts: [
    { t: "이번달 배당", backup: true },
    { t: "내 비중", backup: true },
    { t: "MDD 추이", backup: true },
    { t: "내 종목 수익률", backup: true },
    { t: "이번달 수익률 1위 ETF" },
  ],
  dividend: [
    { t: "분배금 오른 종목", backup: true },
    { t: "계좌 현황", backup: true },
    { t: "내 비중", backup: true },
    { t: "배당 ETF 랭킹" },
    { t: "SOXL 시그마" },
  ],
  dps: [
    { t: "이번달 배당", backup: true },
    { t: "계좌 현황", backup: true },
    { t: "내 종목 수익률", backup: true },
    { t: "배당 ETF 랭킹" },
    { t: "분기별 best" },
  ],
  movers: [
    { t: "내 비중", backup: true },
    { t: "계좌 현황", backup: true },
    { t: "MDD 추이", backup: true },
    { t: "이번달 수익률 1위 ETF" },
    { t: "분기별 best" },
  ],
  weights: [
    { t: "계좌 현황", backup: true },
    { t: "이번달 배당", backup: true },
    { t: "MDD 추이", backup: true },
    { t: "내 종목 수익률", backup: true },
    { t: "이번달 수익률 1위 ETF" },
  ],
  mdd: [
    { t: "계좌 현황", backup: true },
    { t: "내 종목 수익률", backup: true },
    { t: "내 비중", backup: true },
    { t: "이번달 배당", backup: true },
    { t: "분기별 best" },
  ],
  project: [
    { t: "계좌 현황", backup: true },
    { t: "MDD 추이", backup: true },
    { t: "내 비중", backup: true },
    { t: "이번달 수익률 1위 ETF" },
    { t: "분기별 best" },
  ],
  check: [
    { t: "계좌 현황", backup: true },
    { t: "이번달 배당", backup: true },
    { t: "MDD 추이", backup: true },
    { t: "SOXL 시그마" },
    { t: "이번달 수익률 1위 ETF" },
  ],
};

/** sigma는 방금 물어본 종목을 다시 권하지 않도록 다른 티커를 하나 끼워넣는다. */
const SIGMA_ALTS = ["SOXL", "SOXX", "QQQ", "SCHD", "069500.KS"];

function printNudges(cmd, opts) {
  if (!opts.nudge) return;
  const hasBackup = !!(opts.file && opts.file !== true) || !!process.env.BACKUP_JSON;
  let pool = (NUDGE_POOL[cmd] || []).filter((n) => !n.backup || hasBackup);

  if (cmd === "sigma" && typeof opts.symbol === "string") {
    const cur = opts.symbol.toUpperCase();
    const alt = SIGMA_ALTS.find((s) => s !== cur && loadPrices(s));
    if (alt) pool = [{ t: `${alt} 시그마` }, ...pool];
  }
  pool = pool.slice(0, 5);
  if (!pool.length) return;

  console.log(`  ── 이어서 물어볼 수 있어요 ──`);
  for (const n of pool) console.log(`  · ${n.t}`);
  if (!hasBackup) console.log(`  (계좌·배당 질문은 백업 JSON이 연결돼야 답할 수 있습니다)`);
  console.log("");
}

/* ---------------- 명령 ---------------- */

function cmdCheck(backup) {
  const snap = backup.snapshotHistory || [];
  const daily = backup.dailyHistory || [];
  const rows = backup.rows.filter((r) => r.qty > 0);
  const withRate = rows.filter((r) => r.divRate > 0).length;
  const withCost = rows.filter((r) => r.avgPrice > 0).length;
  const v = valuate(rows, null);
  const dailyRB = daily.filter((d) => d.returnBreakdown).length;
  const snapMdd = snap.filter((s) => s.mdd != null).length;
  const withDps = snap.filter((s) => s.dpsBySymbol && Object.keys(s.dpsBySymbol).length).length;

  head("📦 데이터 가용성");
  const line = (label, val, note) => console.log(`  ${padDisp(label, 26)}${padL(val, 8)}  ${note || ""}`);
  line("보유 종목(수량>0)", String(rows.length), "");
  line("가격 조회 성공", String(v.rows.length), v.missing.length ? `미수집 ${v.missing.length}종: ${v.missing.slice(0, 5).join(", ")}` : "");
  line("매입단가 입력분", String(withCost), withCost < rows.length ? `${rows.length - withCost}종은 수익률 계산 불가` : "");
  line("분배율(divRate) 등록", String(withRate), withRate < rows.length ? `${rows.length - withRate}종은 확정DPS 폴백` : "");
  line("월별 스냅샷", String(snap.length), snap.length ? `${snap[0].month} ~ ${snap[snap.length - 1].month}` : "없음");
  line("일별 스냅샷", String(daily.length), daily.length ? `${daily[0].date} ~ ${daily[daily.length - 1].date}` : "없음");
  line("  └ 수익률 필드 포함", String(dailyRB), dailyRB < daily.length ? "구버전 항목엔 없음" : "");
  line("월별 MDD 기록", String(snapMdd), "");
  line("월별 DPS 기록", String(withDps), withDps < 2 ? "2건 이상이어야 분배금 증감 비교 가능" : "");
  line("변동이력", String((backup.changelog || []).length), "");
  line("수집 카탈로그", String(loadManifest().items.length), `시장 랭킹 모집단 · ${loadManifest().updated}`);

  head("❓ 질문별 답변 가능 여부");
  const monthsSpan = snap.length;
  const q = [
    ["1. 금일 계좌 현황", v.rows.length > 0, `accounts`, v.rows.length ? `최신 수집일 ${v.rows[0].priceDate} 종가 기준` : "가격 데이터 없음"],
    ["2. 어제 계좌 현황", daily.length >= 2, `accounts --asof <날짜>`, daily.length >= 2 ? "일별 스냅샷 또는 과거 종가로 재평가" : "일별 스냅샷 2건 이상 필요"],
    ["3. 한달전 대비 계좌 수익률", withCost > 0 && (monthsSpan >= 2 || true), `accounts --asof <한달전>`, withCost === 0 ? "매입단가가 없어 수익률 산출 불가" : "과거 종가 재평가로 가능"],
    ["4. 이번달 배당금", withRate > 0 || rows.some((r) => r.confirmedDps > 0), `dividend`, withRate < rows.length ? "divRate 없는 종목은 확정DPS 폴백" : ""],
    ["5. 전달대비 배당 증가분", snap.length >= 2, `dividend --prev`, snap.length >= 2 ? "" : "월별 스냅샷 2건 이상 필요"],
    ["6. 수익률 best/worst 종목", v.rows.length > 0, `movers --period 6m`, "가격 이력 기반(매입단가 무관)"],
    ["7. 전달대비 비중", snap.length >= 2, `weights --prev`, snap.length >= 2 ? "" : "월별 스냅샷 2건 이상 필요"],
    ["8. MDD 변화", snapMdd >= 2, `mdd`, snapMdd >= 2 ? "" : "MDD 기록된 월별 스냅샷 2건 이상 필요"],
    ["9. N년뒤 기대수익률 투영", v.rows.length > 0, `project --account <키워드>`, "가격 이력만으로 계산 — 스냅샷 불필요"],
    ["10. 등록ETF 월간 수익률 1위", true, `market --period 1m`, "카탈로그 전체 — 백업 JSON 불필요"],
    ["11. 분기별 BEST ETF", true, `quarters --n 4`, "달력 분기별 상위"],
    ["12. 환율 고려/미고려 수익률", true, `market --fx / --native`, "미국 종목만 두 값이 다름"],
    ["13. 전달대비 분배금 상승 ETF", withDps >= 2, `dps`, withDps >= 2 ? "" : `DPS 기록 스냅샷 ${withDps}건 — 2건 이상 필요`],
    ["14. n시그마 매수가", true, `sigma --symbol SOXL`, "앱 「시그널」 탭과 동일 공식"],
  ];
  for (const [label, ok, cmd, note] of q) {
    console.log(`  ${ok ? "✅" : "❌"} ${padDisp(label, 28)} ${padDisp(cmd, 26)} ${note}`);
  }
  console.log("");
}

function cmdAccounts(backup, opts) {
  const asOf = typeof opts.asof === "string" ? opts.asof : null;
  const mask = opts.raw ? ((s) => s) : maskAccount;
  const v = valuate(backup.rows, asOf);
  if (!v.rows.length) die("평가할 수 있는 보유 종목이 없습니다(가격 데이터 미수집).");

  const total = v.rows.reduce((s, r) => s + r.value, 0);
  const accounts = [...groupBy(v.rows, (r) => r.account).entries()]
    .map(([acc, g]) => ({ acc, ...g, pct: total > 0 ? (g.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const priceDates = [...new Set(v.rows.map((r) => r.priceDate))].sort();
  head(`💼 계좌별 현황${asOf ? ` (${asOf} 기준 재평가)` : ""}`);
  console.log(`  가격 기준일 ${priceDates[priceDates.length - 1]}${priceDates.length > 1 ? ` (종목별 최대 ${priceDates[0]}까지 차이)` : ""}`);
  if (v.fxRate) console.log(`  환율 ${v.fxRate.toFixed(2)}원 (${v.fxDate})`);
  console.log("");
  console.log(`  ${padDisp("계좌", 30)}${padL("평가액", 12)}${padL("비중", 8)}${padL("수익률", 10)}`);
  console.log(`  ${hr("·", 58)}`);
  for (const a of accounts) {
    const ret = a.cost > 0 ? ((a.costedValue - a.cost) / a.cost) * 100 : null;
    console.log(`  ${padDisp(mask(a.acc), 30)}${padL(shortWon(a.value), 12)}${padL(a.pct.toFixed(1) + "%", 8)}${padL(pct(ret, 1), 10)}`);
  }
  console.log(`  ${hr("·", 58)}`);
  console.log(`  ${padDisp("합계", 30)}${padL(shortWon(total), 12)}${padL("100.0%", 8)}`);
  console.log(`\n  ${won(total)}`);
  if (v.missing.length) console.log(`\n  ⚠️ 가격 미수집 ${v.missing.length}종 제외: ${v.missing.join(", ")}`);
  const noCost = v.rows.filter((r) => r.cost == null).length;
  if (noCost) console.log(`  ℹ️ 매입단가 없는 ${noCost}종은 수익률 계산에서 제외(평가액에는 포함)`);
  console.log("");
}

function cmdDividend(backup, opts) {
  const mask = opts.raw ? ((s) => s) : maskAccount;
  const v = valuate(backup.rows, null);
  let total = 0, unknown = 0, fallback = 0;
  const perRow = [];
  for (const r of v.rows) {
    const d = monthlyDiv(r);
    if (d.amount == null) { unknown++; continue; }
    if (d.basis === "confirmedDps") fallback++;
    total += d.amount;
    perRow.push({ ...r, div: d.amount, basis: d.basis });
  }

  head("💰 이번 달 배당(예상)");
  console.log(`  합계 ${won(total)}  (${shortWon(total)})`);
  if (fallback) console.log(`  ⚠️ ${fallback}종목은 divRate 미등록 → 확정DPS로 계산. 노션 배당기준 마스터의 분배율을 실어야 정확합니다.`);
  if (unknown) console.log(`  ℹ️ ${unknown}종목은 분배율·확정DPS가 모두 없어 제외(0으로 넣지 않음)`);

  console.log(`\n  상위 10종목`);
  console.log(`  ${padDisp("종목", 32)}${padL("월배당", 12)}${padL("근거", 14)}`);
  console.log(`  ${hr("·", 58)}`);
  for (const p of perRow.sort((a, b) => b.div - a.div).slice(0, 10)) {
    console.log(`  ${padDisp(p.name.slice(0, 15), 32)}${padL(shortWon(p.div), 12)}${padL(p.basis === "divRate" ? "분배율" : "확정DPS", 14)}`);
  }

  const byAcc = [...groupBy(perRow, (r) => r.account).entries()]
    .map(([acc, g]) => ({ acc, div: g.rows.reduce((s, r) => s + r.div, 0) }))
    .sort((a, b) => b.div - a.div);
  console.log(`\n  계좌별`);
  for (const a of byAcc) console.log(`  ${padDisp(mask(a.acc), 32)}${padL(shortWon(a.div), 12)}`);

  if (opts.prev) {
    const snap = backup.snapshotHistory || [];
    head("📈 전달 대비");
    if (snap.length < 2) {
      console.log("  ❌ 월별 스냅샷이 2건 미만이라 비교할 수 없습니다.");
      console.log("     앱 「추이」 탭 → 「📸 이번 달 스냅샷 저장」을 매달 눌러두면 쌓입니다.");
    } else {
      const cur = snap[snap.length - 1], prev = snap[snap.length - 2];
      const diff = (cur.monthlyDiv || 0) - (prev.monthlyDiv || 0);
      const rate = prev.monthlyDiv > 0 ? (diff / prev.monthlyDiv) * 100 : null;
      console.log(`  ${prev.month}  ${won(prev.monthlyDiv)}`);
      console.log(`  ${cur.month}  ${won(cur.monthlyDiv)}`);
      console.log(`  변화     ${diff >= 0 ? "+" : ""}${won(diff)}  ${pct(rate, 1)}`);
    }
  }
  console.log("");
}

function cmdMovers(backup, opts) {
  const period = typeof opts.period === "string" ? opts.period : "6m";
  const topN = parseInt(opts.top, 10) || 5;
  const months = { "1m": 1, "3m": 3, "6m": 6, "1y": 12, "2y": 24 }[period];
  if (!months) die(`--period 는 1m/3m/6m/1y/2y 중 하나여야 합니다 (받은 값: ${period})`);

  const now = new Date();
  const past = new Date(now); past.setMonth(past.getMonth() - months);
  const pastStr = past.toISOString().slice(0, 10);

  const cur = valuate(backup.rows, null);
  const rowsOut = [];
  for (const r of cur.rows) {
    const then = priceAt(r.symbol, pastStr);
    if (!then || !(then.value > 0)) continue;
    // 종목 수익률은 통화 기준 가격 변화로 본다(환율 효과 제외 — 아래 주석 참조)
    const ret = ((r.price - then.value) / then.value) * 100;
    rowsOut.push({ ...r, retPct: ret, fromPrice: then.value, fromDate: then.date });
  }
  if (!rowsOut.length) die("비교 가능한 가격 이력이 없습니다.");
  rowsOut.sort((a, b) => b.retPct - a.retPct);

  const show = (title, list) => {
    console.log(`\n  ${title}`);
    console.log(`  ${padDisp("종목", 30)}${padL("수익률", 10)}${padL("평가액", 11)}${padL("기준일", 12)}`);
    console.log(`  ${hr("·", 58)}`);
    for (const r of list) {
      console.log(`  ${padDisp(r.name.slice(0, 14), 30)}${padL(pct(r.retPct, 1), 10)}${padL(shortWon(r.value), 11)}${padL(r.fromDate, 12)}`);
    }
  };
  head(`📊 종목 수익률 (최근 ${period})`);
  show(`🔺 BEST ${topN}`, rowsOut.slice(0, topN));
  show(`🔻 WORST ${topN}`, rowsOut.slice(-topN).reverse());
  console.log(`\n  ℹ️ 각 종목의 통화 기준 가격 변화입니다(미국 종목은 달러 기준 — 환율 효과 제외).`);
  console.log(`     매입단가가 아니라 ${months}개월 전 종가 대비이므로, 그 사이 매수분도 같은 기준으로 계산됩니다.`);
  console.log("");
}

function cmdWeights(backup, opts) {
  const mask = opts.raw ? ((s) => s) : maskAccount;
  const v = valuate(backup.rows, null);
  const total = v.rows.reduce((s, r) => s + r.value, 0);

  head("⚖️ 현재 비중");
  for (const [label, keyFn] of [["성향별", (r) => r.style], ["지역별", (r) => r.region]]) {
    console.log(`\n  ${label}`);
    const g = [...groupBy(v.rows, keyFn).entries()].sort((a, b) => b[1].value - a[1].value);
    for (const [k, grp] of g) {
      const p = total > 0 ? (grp.value / total) * 100 : 0;
      const bar = "▓".repeat(Math.round(p / 4)) + "░".repeat(Math.max(0, 25 - Math.round(p / 4)));
      console.log(`  ${padDisp(k, 14)}${padL(p.toFixed(1) + "%", 7)}  ${bar} ${shortWon(grp.value)}`);
    }
  }

  if (opts.prev) {
    const snap = backup.snapshotHistory || [];
    head("📈 전달 대비 비중 변화");
    if (snap.length < 2) {
      console.log("  ❌ 월별 스냅샷이 2건 미만이라 비교할 수 없습니다.");
    } else {
      const cur = snap[snap.length - 1], prev = snap[snap.length - 2];
      if (!cur.byAccount || !prev.byAccount) {
        console.log("  ❌ 스냅샷에 계좌별 평가액(byAccount)이 없습니다 — 구버전 기록입니다.");
      } else {
        const sum = (o) => Object.values(o).reduce((s, x) => s + x, 0);
        const ct = sum(cur.byAccount), pt = sum(prev.byAccount);
        console.log(`  ${padDisp("계좌", 30)}${padL(prev.month, 9)}${padL(cur.month, 9)}${padL("변화", 9)}`);
        console.log(`  ${hr("·", 58)}`);
        const keys = [...new Set([...Object.keys(cur.byAccount), ...Object.keys(prev.byAccount)])];
        for (const k of keys) {
          const cp = ct > 0 ? ((cur.byAccount[k] || 0) / ct) * 100 : 0;
          const pp = pt > 0 ? ((prev.byAccount[k] || 0) / pt) * 100 : 0;
          console.log(`  ${padDisp(mask(k), 30)}${padL(pp.toFixed(1) + "%", 9)}${padL(cp.toFixed(1) + "%", 9)}${padL(pct(cp - pp, 1), 9)}`);
        }
      }
    }
  }
  console.log("");
}

function cmdMdd(backup) {
  const snap = (backup.snapshotHistory || []).filter((s) => s.mdd != null);
  head("📉 MDD(최대낙폭) 추이");
  if (!snap.length) {
    console.log("  ❌ MDD가 기록된 월별 스냅샷이 없습니다.");
    console.log("     앱 「추이」 탭 → 「📸 이번 달 스냅샷 저장」을 눌러야 쌓입니다.\n");
    return;
  }
  console.log(`  ${padDisp("월", 12)}${padL("MDD", 10)}${padL("전월대비", 12)}${padL("평가액", 12)}`);
  console.log(`  ${hr("·", 58)}`);
  let prev = null;
  for (const s of snap) {
    const d = prev != null ? s.mdd - prev : null;
    console.log(`  ${padDisp(s.month, 12)}${padL(s.mdd.toFixed(1) + "%", 10)}${padL(d == null ? "—" : pct(d, 1), 12)}${padL(shortWon(s.value), 12)}`);
    prev = s.mdd;
  }
  if (snap.length >= 2) {
    const first = snap[0], last = snap[snap.length - 1];
    console.log(`\n  ${first.month} → ${last.month}: ${first.mdd.toFixed(1)}% → ${last.mdd.toFixed(1)}% (${pct(last.mdd - first.mdd, 1)})`);
    console.log(`  ℹ️ MDD는 음수이고 0에 가까울수록 낙폭이 작습니다 — 값이 커지면(+) 회복된 것입니다.`);
  }
  console.log("");
}

/**
 * n시그마 매수가. 앱 「시그널」 탭 renderLev와 **같은 식**이다:
 *   매수목표가 = 전일종가 × (1 − n×σ/100)
 *   참고 열    = 52주 전고점 × (1 − n×σ/100)   ← 노션 SOXL 매수테이블 방식
 *
 * ⚠️ σ는 일간 변동성이다. "1σ 매수가"는 **하루 안에** 그 폭이 나올 확률이
 *    약 16%라는 뜻이지, 그 가격까지 반드시 내려온다는 뜻이 아니다.
 */
function cmdSigma(opts) {
  const sym = typeof opts.symbol === "string" ? opts.symbol.toUpperCase() : null;
  if (!sym) die("--symbol <티커> 가 필요합니다 (예: --symbol SOXL, --symbol 069500.KS)");
  const series = loadPrices(sym);
  if (!series) die(`data/${sym}.json 이 없습니다 — scripts/etf_list.json에 등재된 종목인지 확인하세요.`);

  const meta = loadMeta().get(sym);
  const name = meta ? meta.name : sym;
  const isUsd = meta ? meta.currency === "USD" : !/\.KS$/.test(sym);
  const closes = series.closes;
  const close = closes[closes.length - 1];
  const hi = high52(closes);
  const s252 = dailyReturnSigma(closes, 252);
  const s30 = dailyReturnSigma(closes, 30);
  if (s252 == null && s30 == null) die(`σ 계산에 필요한 데이터가 부족합니다 (보유 ${closes.length}건).`);

  const fx = isUsd ? fxAt(null) : null;
  const cur = (v) => (isUsd ? `$${v.toFixed(2)}` : Math.round(v).toLocaleString("ko-KR") + "원");
  const krw = (v) => (isUsd && fx ? `  ≈ ${Math.round(v * fx.value).toLocaleString("ko-KR")}원` : "");

  head(`📐 ${name} — n시그마 매수가`);
  console.log(`  전일종가        ${cur(close)}${krw(close)}   [${series.dates[series.dates.length - 1]}]`);
  if (hi) console.log(`  52주 전고점     ${cur(hi)}   (전고점 대비 ${pct((close / hi - 1) * 100, 1)})`);
  console.log(`  σ 1년(252일)    ${s252 == null ? "—" : s252.toFixed(2) + "%"}`);
  console.log(`  σ 30일          ${s30 == null ? "—" : s30.toFixed(2) + "%"}`);
  if (isUsd && fx) console.log(`  환율            ${fx.value.toFixed(2)}원 (${fx.date})`);
  console.log(`  데이터          ${series.first} ~ ${series.last} (${series.count}건)`);

  const krwOnly = (v) => (isUsd && fx ? Math.round(v * fx.value).toLocaleString("ko-KR") + "원" : "");
  for (const [label, s] of [["σ 1년", s252], ["σ 30일", s30]]) {
    if (s == null) continue;
    console.log(`\n  ── ${label} 기준 ──`);
    console.log(`  ${padDisp("구간", 6)}${padL("하락폭", 10)}${padL("전일종가 기준", 16)}${isUsd ? padL("(원화)", 14) : ""}${padL("52주 전고점 기준", 20)}`);
    console.log(`  ${hr("·", isUsd ? 66 : 52)}`);
    for (const n of [1, 2, 3]) {
      const t = close * (1 - (n * s) / 100);
      const r = hi != null ? hi * (1 - (n * s) / 100) : null;
      console.log(`  ${padDisp(n + "σ", 6)}${padL("-" + (n * s).toFixed(2) + "%", 10)}${padL(cur(t), 16)}${isUsd ? padL(krwOnly(t), 14) : ""}${padL(r == null ? "—" : cur(r), 20)}`);
    }
  }

  console.log(`\n  ⚠️ σ는 **일간** 변동성입니다 — "1σ 매수가"는 하루 안에 그 폭이 나올 확률이`);
  console.log(`     약 16%라는 뜻이지, 그 가격까지 내려온다는 보장이 아닙니다.`);
  if (/SOXL|TQQQ|레버리지|3배|2배/.test(name)) {
    console.log(`  ⚠️ 레버리지 상품입니다 — 일간 리밸런싱 탓에 횡보장에서도 가치가 깎입니다(변동성 끌림).`);
    console.log(`     σ가 크다는 건 밴드가 넓다는 뜻이지 그만큼 싸졌다는 뜻이 아닙니다.`);
  }
  console.log(`     "전일종가"는 주 1회 수집의 마지막 종가라 오늘 시세와 다를 수 있습니다.\n`);
}

/** 등록 카탈로그 전체에서 기간 수익률 상위/하위 — 보유 여부와 무관(백업 JSON 불필요). */
function cmdMarket(opts) {
  const period = typeof opts.period === "string" ? opts.period : "1m";
  const months = MONTHS_BY_PERIOD[period];
  if (!months) die(`--period 는 ${Object.keys(MONTHS_BY_PERIOD).join("/")} 중 하나여야 합니다 (받은 값: ${period})`);
  const topN = parseInt(opts.top, 10) || 10;
  const items = filterCatalog(opts);
  if (!items.length) die("조건에 맞는 종목이 없습니다. --region kr|us, --style, --category 를 확인하세요.");

  const from = monthsAgoStr(months);
  const scored = [];
  let noData = 0;
  for (const it of items) {
    const r = periodReturn(it.symbol, it.currency, from, null);
    if (!r) { noData++; continue; }
    scored.push({ ...it, ...r });
  }
  if (!scored.length) die("가격 이력이 있는 종목이 없습니다.");

  // 미국 종목이 섞여 있으면 원화환산 기준이 공정하다(같은 잣대로 비교)
  const hasUsd = scored.some((s) => s.currency === "USD");
  const useKrw = opts.fx || (hasUsd && !opts.native);
  const keyOf = (s) => (useKrw && s.krw != null ? s.krw : s.native);
  scored.sort((a, b) => keyOf(b) - keyOf(a));

  head(`🏆 등록 종목 수익률 랭킹 — 최근 ${period}`);
  console.log(`  모집단 ${scored.length}종${noData ? ` (가격이력 부족 ${noData}종 제외)` : ""} · 수집 ${loadManifest().updated}`);
  console.log(`  정렬 기준 ${useKrw ? "원화환산" : "통화기준"}${hasUsd ? " · 미국 종목은 두 값이 다릅니다" : ""}`);
  console.log("");
  const header = `  ${padDisp("종목", 30)}${padL("통화기준", 11)}${padL("원화환산", 11)}${padL("배당률", 9)}${padL("구간", 13)}`;
  const show = (title, list) => {
    console.log(`  ${title}`);
    console.log(header);
    console.log(`  ${hr("·", 72)}`);
    for (const s of list) {
      const dy = s.dividendYield > 0 ? (s.dividendYield * 100).toFixed(2) + "%" : "—";
      console.log(`  ${padDisp(s.name.slice(0, 14), 30)}${padL(pct(s.native, 1), 11)}${padL(s.krw == null ? "—" : pct(s.krw, 1), 11)}${padL(dy, 9)}${padL(s.from.slice(5), 13)}`);
    }
  };
  show(`🔺 BEST ${topN}`, scored.slice(0, topN));
  console.log("");
  show(`🔻 WORST ${topN}`, scored.slice(-topN).reverse());
  console.log(`\n  ℹ️ 국내 종목은 통화기준=원화환산(같은 값)입니다.`);
  console.log(`     주 1회 수집이라 구간 시작일이 종목마다 며칠씩 다를 수 있습니다.`);
  console.log(`     ⚠️ 과거 수익률이지 추천이 아닙니다 — 보수·괴리·유동성은 여기에 없습니다.\n`);
}

/** 분기별 BEST — 최근 N개 분기 각각의 상위 종목. */
function cmdQuarters(opts) {
  const n = parseInt(opts.n, 10) || 4;
  const topN = parseInt(opts.top, 10) || 3;
  const items = filterCatalog(opts);

  // 달력 분기 경계를 만든다(최근 완료분기부터 거슬러 올라간다)
  const now = new Date();
  const qs = [];
  let y = now.getFullYear(), q = Math.floor(now.getMonth() / 3);
  for (let i = 0; i < n; i++) {
    const startM = q * 3;
    const start = new Date(Date.UTC(y, startM, 1));
    const end = new Date(Date.UTC(y, startM + 3, 0));
    qs.push({
      label: `${y}Q${q + 1}`,
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      ongoing: end > now,
    });
    q--; if (q < 0) { q = 3; y--; }
  }

  head(`📅 분기별 BEST — 최근 ${n}개 분기`);
  console.log(`  모집단 ${items.length}종 · 수집 ${loadManifest().updated}\n`);
  for (const qq of qs) {
    const scored = [];
    for (const it of items) {
      const r = periodReturn(it.symbol, it.currency, qq.from, qq.to);
      if (r) scored.push({ ...it, ...r });
    }
    const useKrw = !opts.native;
    scored.sort((a, b) => ((useKrw && b.krw != null ? b.krw : b.native) - (useKrw && a.krw != null ? a.krw : a.native)));
    console.log(`  ${qq.label}  ${qq.from} ~ ${qq.to}${qq.ongoing ? "  (진행 중)" : ""}`);
    if (!scored.length) { console.log(`    가격 이력이 있는 종목 없음\n`); continue; }
    for (const s of scored.slice(0, topN)) {
      console.log(`    ${padDisp(s.name.slice(0, 16), 34)}${padL(pct(useKrw && s.krw != null ? s.krw : s.native, 1), 10)}`);
    }
    console.log("");
  }
  console.log(`  ℹ️ ${opts.native ? "통화기준" : "원화환산"} 정렬입니다 (--native 로 전환).`);
  console.log(`     진행 중 분기는 아직 끝나지 않은 구간의 부분 수익률입니다.\n`);
}

/** 전달 대비 확정DPS(분배금) 변화 — 월별 스냅샷의 dpsBySymbol 비교. */
function cmdDps(backup, opts) {
  const snap = backup.snapshotHistory || [];
  const withDps = snap.filter((s) => s.dpsBySymbol && Object.keys(s.dpsBySymbol).length);
  head("💵 확정 분배금(DPS) 전월 대비 변화");
  if (withDps.length < 2) {
    console.log(`  ❌ DPS가 기록된 월별 스냅샷이 2건 미만입니다 (현재 ${withDps.length}건).`);
    console.log(`     확정DPS가 입력된 상태로 「📸 이번 달 스냅샷 저장」을 두 달 이상 눌러야 비교됩니다.\n`);
    return;
  }
  let cur = withDps[withDps.length - 1], prev = withDps[withDps.length - 2];
  if (typeof opts.month === "string") {
    const i = withDps.findIndex((s) => s.month === opts.month);
    if (i < 1) die(`${opts.month} 스냅샷이 없거나 그 전월 기록이 없습니다.\n  사용 가능: ${withDps.map((s) => s.month).join(", ")}`);
    cur = withDps[i]; prev = withDps[i - 1];
  }

  const meta = loadMeta();
  const fx = fxAt(null);
  const held = new Map(backup.rows.filter((r) => r.qty > 0).map((r) => [r.symbol, r]));
  const keys = [...new Set([...Object.keys(cur.dpsBySymbol), ...Object.keys(prev.dpsBySymbol)])];
  const up = [], down = [], added = [], removed = [];
  for (const sym of keys) {
    const c = cur.dpsBySymbol[sym], p = prev.dpsBySymbol[sym];
    const m = meta.get(sym);
    const name = m ? m.name : sym;
    // DPS는 그 종목의 통화 단위다 — 미국 종목은 달러라, 원화 영향으로 환산해야 한다
    const isUsd = m ? m.currency === "USD" : !/\.KS$/.test(sym);
    const rate = isUsd ? (fx ? fx.value : null) : 1;
    const qty = held.has(sym) ? held.get(sym).qty : 0;
    const base = { sym, name, qty, isUsd, rate };
    if (p == null) { added.push({ ...base, c }); continue; }
    if (c == null) { removed.push({ ...base, p }); continue; }
    if (c > p) up.push({ ...base, p, c, diff: c - p, rate2: ((c - p) / p) * 100 });
    else if (c < p) down.push({ ...base, p, c, diff: c - p, rate2: ((c - p) / p) * 100 });
  }
  /** DPS는 원(수백~수천)일 수도 달러(0.25)일 수도 있어 자릿수를 값에 맞춘다. */
  const dpsFmt = (v, isUsd) => (isUsd ? `$${v.toFixed(3)}` : Math.round(v).toLocaleString("ko-KR"));
  /** 월배당 영향 = 증감액 × 수량, 달러면 원화 환산. 환율을 모르면 "—". */
  const impact = (r) => {
    if (!(r.qty > 0)) return "미보유";
    if (r.rate == null) return "환율 미상";
    const krw = r.diff * r.qty * r.rate;
    return (krw >= 0 ? "+" : "") + shortWon(krw);
  };

  console.log(`  ${prev.month} → ${cur.month}  ·  비교 대상 ${keys.length}종\n`);
  const table = (title, list, fmt) => {
    if (!list.length) return;
    console.log(`  ${title}`);
    console.log(`  ${padDisp("종목", 30)}${padL("이전", 10)}${padL("이번", 10)}${padL("증감", 10)}${padL("월배당 영향", 14)}`);
    console.log(`  ${hr("·", 72)}`);
    for (const r of list) console.log(fmt(r));
    console.log("");
  };
  up.sort((a, b) => b.rate2 - a.rate2);
  down.sort((a, b) => a.rate2 - b.rate2);
  const fmtRow = (r) => `  ${padDisp(r.name.slice(0, 14), 30)}${padL(dpsFmt(r.p, r.isUsd), 10)}${padL(dpsFmt(r.c, r.isUsd), 10)}${padL(pct(r.rate2, 1), 10)}${padL(impact(r), 14)}`;

  table(`🔺 분배금 상승 ${up.length}종`, up, fmtRow);
  table(`🔻 분배금 하락 ${down.length}종`, down, fmtRow);
  if (added.length) {
    console.log(`  🆕 신규 확정 ${added.length}종`);
    for (const r of added) console.log(`  ${padDisp(r.name.slice(0, 14), 30)}${padL(dpsFmt(r.c, r.isUsd), 10)}${r.qty > 0 ? "" : "  (미보유)"}`);
    console.log("");
  }
  if (removed.length) {
    console.log(`  ⚪ 이번 달 확정값 없음 ${removed.length}종`);
    for (const r of removed) console.log(`  ${padDisp(r.name.slice(0, 14), 30)}${padL(dpsFmt(r.p, r.isUsd), 10)}  ← 이전 값`);
    console.log("");
  }
  // 환율을 모르는 종목은 순변화 집계에서 제외한다(0으로 넣지 않음)
  const netRows = [...up, ...down].filter((r) => r.qty > 0 && r.rate != null);
  const net = netRows.reduce((s, r) => s + r.diff * r.qty * r.rate, 0);
  const skipped = [...up, ...down].filter((r) => r.qty > 0 && r.rate == null).length;
  console.log(`  보유분 월배당 순변화  ${net >= 0 ? "+" : ""}${won(net)}${skipped ? `  (환율 미상 ${skipped}종 제외)` : ""}`);
  console.log(`\n  ℹ️ 확정DPS(주당 실지급액) 기준입니다 — 분배율(%)이 아니라 금액입니다.`);
  console.log(`     "월배당 영향"은 증감액 × 현재 보유수량이라, 그 사이 수량이 변했으면 실제와 다릅니다.\n`);
}

/**
 * 과거 수익률을 연환산해 N년 뒤를 투영한다.
 *
 * ⚠️ 통계적으로 약한 외삽이다. 6개월은 표본이 짧고, 그 구간이 강세장이었다면
 *    연환산이 크게 부풀려진다(6개월 +20% → 연 +44% → 5년 +524%). 그래서
 *    출력에 구간 수익률·연환산·투영을 **모두** 보여주고 경고를 붙인다.
 */
function cmdProject(backup, opts) {
  const kw = typeof opts.account === "string" ? opts.account : null;
  const years = parseFloat(opts.years) || 5;
  const basis = typeof opts.basis === "string" ? opts.basis : "6m";
  const months = { "3m": 3, "6m": 6, "1y": 12, "2y": 24, "3y": 36 }[basis];
  if (!months) die(`--basis 는 3m/6m/1y/2y/3y 중 하나여야 합니다 (받은 값: ${basis})`);
  const mask = opts.raw ? ((s) => s) : maskAccount;

  let rows = backup.rows.filter((r) => r.qty > 0);
  if (kw) {
    rows = rows.filter((r) => (r.account || "").toLowerCase().includes(kw.toLowerCase()));
    if (!rows.length) {
      const all = [...new Set(backup.rows.filter((r) => r.qty > 0).map((r) => r.account))];
      die(`"${kw}" 와 일치하는 계좌가 없습니다.\n  사용 가능: ${all.map(mask).join(", ")}`);
    }
  }

  const now = new Date();
  const past = new Date(now); past.setMonth(past.getMonth() - months);
  const pastStr = past.toISOString().slice(0, 10);

  const curV = valuate(rows, null);
  const pastV = valuate(rows, pastStr);
  // 두 시점 모두 가격이 있는 종목만 비교한다 — 한쪽만 있으면 수익률이 왜곡된다
  const pastBySym = new Map(pastV.rows.map((r) => [r.symbol, r]));
  const pairs = curV.rows.filter((r) => pastBySym.has(r.symbol));
  const excluded = curV.rows.filter((r) => !pastBySym.has(r.symbol));

  const curTotal = pairs.reduce((s, r) => s + r.value, 0);
  const pastTotal = pairs.reduce((s, r) => s + pastBySym.get(r.symbol).value, 0);
  if (!(pastTotal > 0)) die("과거 시점 평가액을 계산할 수 없습니다(가격 이력 부족).");

  const periodRet = (curTotal - pastTotal) / pastTotal;
  const annualized = Math.pow(1 + periodRet, 12 / months) - 1;
  const fullCurTotal = curV.rows.reduce((s, r) => s + r.value, 0);
  const projected = fullCurTotal * Math.pow(1 + annualized, years);

  head(`🔮 ${kw ? mask(rows[0].account) + " 계좌" : "전체"} — ${years}년 뒤 투영 (직전 ${basis} 수익률 반영)`);
  console.log(`  대상 종목        ${pairs.length}종 (양 시점 가격 존재)`);
  if (excluded.length) console.log(`  제외             ${excluded.length}종 — ${pastStr} 시점 가격 없음: ${excluded.map((r) => r.name.slice(0, 10)).join(", ")}`);
  console.log("");
  console.log(`  ${padDisp(pastStr + " 평가액", 24)}${padL(shortWon(pastTotal), 14)}`);
  console.log(`  ${padDisp("현재 평가액", 24)}${padL(shortWon(curTotal), 14)}`);
  console.log(`  ${padDisp(`${basis} 수익률`, 24)}${padL(pct(periodRet * 100), 14)}`);
  console.log(`  ${padDisp("연환산 수익률(CAGR)", 24)}${padL(pct(annualized * 100), 14)}`);
  console.log(`  ${hr("·", 40)}`);
  console.log(`  ${padDisp(`${years}년 뒤 투영 평가액`, 24)}${padL(shortWon(projected), 14)}`);
  console.log(`  ${padDisp("누적 수익률", 24)}${padL(pct((Math.pow(1 + annualized, years) - 1) * 100), 14)}`);
  console.log(`\n  ${won(projected)}`);

  // 감도 — 하나의 숫자만 보여주면 그게 예측처럼 읽힌다
  console.log(`\n  참고: 연환산 가정을 바꾸면`);
  for (const alt of [0.05, 0.08, 0.10, 0.15]) {
    console.log(`    연 ${(alt * 100).toFixed(0)}% 가정 → ${padL(shortWon(fullCurTotal * Math.pow(1 + alt, years)), 10)}`);
  }

  console.log(`\n  ⚠️ 이 숫자는 예측이 아니라 산술 외삽입니다.`);
  console.log(`     · ${months}개월(표본 ${pairs.length}종)의 수익률을 그대로 ${years}년 늘린 값입니다.`);
  console.log(`     · 그 구간이 강세장이었다면 연환산이 크게 부풀려집니다.`);
  console.log(`     · 배당 재투자·추가 납입·매매를 반영하지 않았습니다(현 보유 그대로 유지 가정).`);
  console.log(`     · 현재 보유수량으로 과거를 재평가했으므로, 그 사이 매수분도 처음부터 들고 있던 것으로 계산됩니다.`);
  console.log("");
}

/* ---------------- 진입점 ---------------- */

function die(msg) { console.error(`\n❌ ${msg}\n`); process.exit(1); }

function usage() {
  console.log(`
asset-cli — 백업 JSON으로 자산 질문에 답하는 CLI

사용법
  node scripts/asset-cli.mjs <명령> --file <백업.json> [옵션]

내 자산 명령 (--file 필요)
  check                          데이터 가용성 + 질문별 답변 가능 여부
  accounts  [--asof YYYY-MM-DD]  계좌별 평가액·비중·수익률
  dividend  [--prev]             이번 달 배당(+ 전달 대비)
  dps       [--month YYYY-MM]    확정 분배금(DPS) 전월 대비 증감
  movers    [--period 6m] [--top 5]   보유 종목 수익률 BEST/WORST
  weights   [--prev]             성향·지역별 비중(+ 전달 대비)
  mdd                            MDD 추이
  project   --account <키워드> [--years 5] [--basis 6m]
                                 과거 수익률 연환산 → N년 뒤 투영

시장 명령 (--file 불필요 — 저장소 수집 데이터만 사용)
  market    [--period 1m] [--top 10]  등록 카탈로그 전체 수익률 랭킹
  quarters  [--n 4] [--top 3]         분기별 BEST
  sigma     --symbol <티커>           1/2/3σ 매수가 (앱 「시그널」 탭과 동일 공식)

공통 옵션
  --file <경로>   앱 「📤 내보내기」로 받은 JSON (내 자산 명령에 필요)
  --raw           계좌명을 마스킹하지 않음 (기본은 마스킹)
  --nudge         답변 끝에 "이어서 물어볼 수 있어요" 5개 추가 (봇용)

시장 명령 옵션
  --period        1m / 3m / 6m / 1y / 2y / 3y
  --region        kr | us
  --style         배당 | 성장 | 안전 …
  --category      부분일치 (예: "반도체")
  --fx            원화환산 기준 정렬 (미국 종목 포함 시 기본값)
  --native        통화기준 정렬 (달러는 달러대로)
  --include-stocks  개별주도 포함 (기본은 ETF만)

예시
  node scripts/asset-cli.mjs check    --file ~/myassets-2026-08-25.json
  node scripts/asset-cli.mjs accounts --file ~/backup.json --asof 2026-07-25
  node scripts/asset-cli.mjs project  --file ~/backup.json --account DC --years 5 --basis 6m
  node scripts/asset-cli.mjs market   --period 1m --region kr --top 10
  node scripts/asset-cli.mjs market   --period 6m --style 배당 --fx
  node scripts/asset-cli.mjs quarters --n 4
  node scripts/asset-cli.mjs sigma    --symbol SOXL
  node scripts/asset-cli.mjs dps      --file ~/backup.json

⚠️ 백업 JSON은 개인 보유 데이터입니다 — 이 저장소에 커밋하지 마세요.
   출력의 계좌명은 기본 마스킹됩니다(--raw 로 해제, 로컬 확인용으로만).
`);
}

const { cmd, opts } = parseArgs(process.argv);
if (!cmd || cmd === "help" || opts.help) { usage(); process.exit(0); }

// market·quarters는 저장소 수집 데이터만 쓰므로 백업 JSON 없이 동작한다
const MARKET_CMDS = ["market", "quarters", "sigma"];
const HOLDING_CMDS = ["check", "accounts", "dividend", "movers", "weights", "mdd", "project", "dps"];
const KNOWN = [...HOLDING_CMDS, ...MARKET_CMDS];
if (!KNOWN.includes(cmd)) { console.error(`\n❌ 알 수 없는 명령: ${cmd}`); usage(); process.exit(1); }

if (MARKET_CMDS.includes(cmd)) {
  if (cmd === "market") cmdMarket(opts);
  else if (cmd === "quarters") cmdQuarters(opts);
  else cmdSigma(opts);
} else {
  // --file 이 없으면 BACKUP_JSON 환경변수를 쓴다(n8n Execute Command에서 넘기는 경로)
  if (!opts.file || opts.file === true) opts.file = process.env.BACKUP_JSON || opts.file;
  const backup = loadBackup(opts.file);
  switch (cmd) {
    case "check": cmdCheck(backup); break;
    case "accounts": cmdAccounts(backup, opts); break;
    case "dividend": cmdDividend(backup, opts); break;
    case "movers": cmdMovers(backup, opts); break;
    case "weights": cmdWeights(backup, opts); break;
    case "mdd": cmdMdd(backup); break;
    case "project": cmdProject(backup, opts); break;
    case "dps": cmdDps(backup, opts); break;
  }
}
printNudges(cmd, opts);
