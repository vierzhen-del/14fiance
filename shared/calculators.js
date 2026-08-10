// shared/calculators.js — 📈 투자시뮬레이터·📉 MDD 테스트·🎛 커스텀 포트폴리오 계산·렌더 로직.
// index.html(웹사이트)의 동일 기능을 그대로 가져온 것으로, capture/index.html(APK 앱)에서만
// 로드한다(웹사이트는 자체 인라인 사본을 계속 쓰므로 이 파일을 로드하지 않는다).
// 의존: shared/myassets-utils.js(fetchJSON/flashStatus/todayStr/fmtPrice/csvField·csvRow/
// downloadBlob/cssVar/calcMDD/buildChart/buildCompareChart/BLENDS/isBlend/ACCOUNT_TYPES/
// accountOptionsHTML/etfOptionsHTML), shared/price-data.js(loadSymbol/loadFx).
// 사용하는 전역 state 필드는 capture/index.html의 init()이 이미 채워둔 state.manifest/
// listedEtfs/metaBySymbol을 그대로 재사용하고, 이 파일이 추가로 state.allSymbols/
// marketFilter/compareChecked/simCurrency/simInputMode/simFxMode를 초기화한다.

/* ---------- 카카오톡 공유 ---------- */
/* index.html(웹사이트)의 shareToKakao와 동일한 기능이지만, 공유 링크는 location.origin/
   pathname 대신 고정 주소를 쓴다 — 앱(Capacitor WebView) 안에서는 location.origin이
   실제 배포 주소가 아니라 앱 내부 오리진(androidScheme:"https" 기준 https://localhost)이라
   그대로 쓰면 카톡에 실려나간 링크가 나중에 열리지 않는다(2026-08-10 실측).
   카카오 디벨로퍼스 콘솔의 플랫폼(Web) 허용 도메인에 이 앱의 WebView 오리진
   (https://localhost)도 등록돼 있어야 실제 전송까지 정상 동작한다. */
const KAKAO_JS_KEY = "6d122bbe9d926f06ce1d964db6fc4340";
const SITE_ORIGIN = "https://vierzhen-del.github.io";
const CAPTURE_PAGE_URL = `${SITE_ORIGIN}/14fiance/capture/index.html`;

function initKakao() {
  if (typeof Kakao === "undefined") return;
  try {
    if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY);
  } catch (err) {
    // SDK 로드 실패(오프라인 등) — 카카오 공유 버튼만 조용히 비활성
  }
}

function shareToKakao(data, url, statusElId) {
  if (typeof Kakao === "undefined" || !Kakao.isInitialized || !Kakao.isInitialized()) {
    flashStatus(statusElId, "카카오톡 공유 기능을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
    return;
  }
  const statLine = data.stats.slice(0, 3).map((s) => `${s.label} ${s.value}`).join(" · ");
  try {
    Kakao.Share.sendDefault({
      objectType: "feed",
      content: {
        title: data.title,
        description: statLine,
        imageUrl: `${SITE_ORIGIN}/14fiance/icons/icon-512.png`,
        link: { webUrl: url, mobileWebUrl: url },
      },
      buttons: [{ title: "결과 보러가기", link: { webUrl: url, mobileWebUrl: url } }],
    });
  } catch (err) {
    flashStatus(statusElId, "카카오톡 공유 중 오류가 발생했습니다.");
  }
}

/* ---------- 공용 소품 ---------- */
const MAX_COMPARE = 5;
const CAT_COLORS = ["--cat-1", "--cat-2", "--cat-3", "--cat-4", "--cat-5", "--cat-6", "--cat-7", "--cat-8"];
function symbolColor(symbol) {
  const idx = state.allSymbols.indexOf(symbol);
  const slot = CAT_COLORS[(idx < 0 ? 0 : idx) % CAT_COLORS.length];
  return cssVar(slot);
}

function daysBetween(dateStrA, dateStrB) {
  const a = new Date(dateStrA), b = new Date(dateStrB);
  return Math.round((b - a) / 86400000);
}

function sliceByPeriod(dates, closes, months) {
  if (!months) return { dates, closes };
  const lastDate = new Date(dates[dates.length - 1]);
  const cutoff = new Date(lastDate);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return sliceFromDate(dates, closes, cutoffStr);
}

function sliceFromDate(dates, closes, startDateStr) {
  let startIdx = dates.findIndex((d) => d >= startDateStr);
  if (startIdx < 0) startIdx = 0;
  return { dates: dates.slice(startIdx), closes: closes.slice(startIdx) };
}

/* 결과 시계열을 CSV(엑셀·시트)로 내보낸다 */
function buildResultCSV(data) {
  const header = ["날짜", data.valueLabel || "값"];
  if (data.dd) header.push("낙폭(%)");
  const lines = [csvRow(header)];
  for (let i = 0; i < data.dates.length; i++) {
    const row = [data.dates[i], data.values[i]];
    if (data.dd) row.push((data.dd[i] * 100).toFixed(2));
    lines.push(csvRow(row));
  }
  if (data.perAsset && data.perAsset.length) {
    lines.push("", "종목별 개별 결과");
    lines.push(csvRow(["종목", "방식", "납입원금", "최종평가액", "수익률", "연IRR", "MDD"]));
    for (const pa of data.perAsset) {
      lines.push(csvRow([pa.symbol, pa.mode, pa.contributed, pa.finalValue, pa.returnPct, pa.irr || "—", pa.mdd]));
    }
  }
  if (data.accountSummary && data.accountSummary.length) {
    lines.push("", "계좌별 합계");
    lines.push(csvRow(["계좌", "포함 종목", "납입원금", "최종평가액", "수익률"]));
    for (const r of data.accountSummary) {
      lines.push(csvRow([r.account, r.symbols, r.contributed, r.finalValue, r.returnPct]));
    }
  }
  return lines.join("\n");
}
function downloadResultCSV(data, filename) {
  const csv = buildResultCSV(data);
  downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), filename);
}

/* 사람이 읽는 텍스트 요약 (클로드 등에 붙여넣기용) */
function buildResultSummaryText(data) {
  const lines = [data.title, data.subtitle, ""];
  for (const s of data.stats) {
    lines.push(`- ${s.label}: ${s.value}${s.sub ? ` (${s.sub})` : ""}`);
  }
  if (data.perAsset && data.perAsset.length) {
    lines.push("", "종목별 개별 결과:");
    for (const pa of data.perAsset) {
      lines.push(`- ${pa.symbol} (${pa.mode}): 납입원금 ${pa.contributed} → 최종 ${pa.finalValue}, 수익률 ${pa.returnPct}, MDD ${pa.mdd}`);
    }
  }
  if (data.accountSummary && data.accountSummary.length) {
    lines.push("", "계좌별 합계:");
    for (const r of data.accountSummary) {
      lines.push(`- ${r.account} (${r.symbols}): 납입원금 ${r.contributed} → 최종 ${r.finalValue}, 수익률 ${r.returnPct}`);
    }
  }
  lines.push("", `기간: ${data.dates[0]} ~ ${data.dates[data.dates.length - 1]}`);
  return lines.join("\n");
}
async function copyResultSummary(data, statusElId) {
  const text = buildResultSummaryText(data);
  try {
    await navigator.clipboard.writeText(text);
    flashStatus(statusElId, "결과 요약이 복사되었습니다 ✓ 클로드 대화창에 붙여넣기 해보세요.");
  } catch (err) {
    window.prompt("아래 내용을 복사해서 클로드에 붙여넣으세요:", text);
  }
}

/* ---------- 합성 포트폴리오(BLENDS) 로딩 ---------- */
function computeBlend(weights, dataBySymbol) {
  const priceMaps = weights.map((w) => {
    const d = dataBySymbol.get(w.symbol);
    const m = new Map();
    for (let i = 0; i < d.dates.length; i++) m.set(d.dates[i], d.closes[i]);
    return m;
  });

  let commonDates = [...priceMaps[0].keys()];
  for (let i = 1; i < priceMaps.length; i++) {
    commonDates = commonDates.filter((d) => priceMaps[i].has(d));
  }
  commonDates.sort();

  const dates = [];
  const closes = [];
  let nav = 100;
  let prevPrices = null;
  for (const date of commonDates) {
    const prices = priceMaps.map((m) => m.get(date));
    if (prevPrices) {
      let blendedReturn = 0;
      for (let i = 0; i < weights.length; i++) {
        blendedReturn += weights[i].weight * (prices[i] / prevPrices[i] - 1);
      }
      nav *= 1 + blendedReturn;
    }
    dates.push(date);
    closes.push(Math.round(nav * 10000) / 10000);
    prevPrices = prices;
  }
  return { dates, closes };
}

async function loadBlend(blendDef) {
  if (state.cache.has(blendDef.id)) return state.cache.get(blendDef.id);
  const dataBySymbol = new Map();
  for (const w of blendDef.weights) {
    dataBySymbol.set(w.symbol, await loadSymbol(w.symbol));
  }
  const { dates, closes } = computeBlend(blendDef.weights, dataBySymbol);
  const result = {
    symbol: blendDef.id,
    currency: "USD",
    first: dates[0],
    last: dates[dates.length - 1],
    count: dates.length,
    dates,
    closes,
    isBlend: true,
  };
  state.cache.set(blendDef.id, result);
  return result;
}

function loadEntry(id) {
  const blend = BLENDS.find((b) => b.id === id);
  return blend ? loadBlend(blend) : loadSymbol(id);
}

/* ---------- 🎛 커스텀 포트폴리오 행 CRUD ---------- */
let calcRowSeq = 0;

function addPortfolioRow(defaultSymbol, defaultWeight, defaultAccount) {
  const rowId = "prow_" + (calcRowSeq++);
  const row = document.createElement("div");
  row.className = "portfolio-row";
  row.dataset.rowId = rowId;
  row.innerHTML = `
    <select class="portfolio-symbol" aria-label="종목 선택">${etfOptionsHTML(defaultSymbol)}</select>
    <div class="portfolio-weight-wrap">
      <input type="number" class="portfolio-weight" min="0" step="1" value="${defaultWeight}"> %
    </div>
    <select class="portfolio-account" aria-label="계좌 구분">${accountOptionsHTML(defaultAccount)}</select>
    <button type="button" class="portfolio-remove" aria-label="종목 제거">×</button>
  `;
  document.getElementById("portfolioRows").appendChild(row);

  row.querySelector(".portfolio-symbol").addEventListener("change", renderPortfolio);
  row.querySelector(".portfolio-weight").addEventListener("input", renderPortfolio);
  row.querySelector(".portfolio-account").addEventListener("change", renderPortfolio);
  row.querySelector(".portfolio-remove").addEventListener("click", () => {
    row.remove();
    renderPortfolio();
  });
}

const PORTFOLIO_STORAGE_KEY = "mdd_portfolio_v1";

function serializePortfolioRows() {
  return [...document.querySelectorAll("#portfolioRows .portfolio-row")].map((el) => ({
    symbol: el.querySelector(".portfolio-symbol").value,
    weight: parseFloat(el.querySelector(".portfolio-weight").value) || 0,
    account: el.querySelector(".portfolio-account").value,
  }));
}

function applyPortfolioRows(rows) {
  document.getElementById("portfolioRows").innerHTML = "";
  for (const r of rows) addPortfolioRow(r.symbol, r.weight, r.account);
  renderPortfolio();
}

function savePortfolioSettings() {
  const rows = serializePortfolioRows();
  if (!rows.length) { flashStatus("portfolioSaveStatus", "저장할 종목이 없습니다"); return; }
  localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(rows));
  flashStatus("portfolioSaveStatus", "설정이 저장되었습니다 ✓ (이 기기에만 보관됩니다)");
}

function loadPortfolioSettings() {
  const raw = localStorage.getItem(PORTFOLIO_STORAGE_KEY);
  if (!raw) { flashStatus("portfolioSaveStatus", "저장된 설정이 없습니다"); return; }
  try {
    const rows = JSON.parse(raw);
    if (Array.isArray(rows) && rows.length) {
      applyPortfolioRows(rows);
      flashStatus("portfolioSaveStatus", "저장된 설정을 불러왔습니다 ✓");
    }
  } catch (err) {
    flashStatus("portfolioSaveStatus", "저장된 설정을 읽지 못했습니다");
  }
}

/* ---------- 📉 MDD 단일 종목 ---------- */
async function renderMdd() {
  const symbol = document.getElementById("etfSelect").value;
  const months = Number(document.getElementById("periodSelect").value);
  const app = document.getElementById("mddApp");
  app.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">불러오는 중…</p>`;

  let full;
  try {
    full = await loadEntry(symbol);
  } catch (err) {
    app.innerHTML = `<p style="color:var(--critical); font-size:13px;">${err.message}</p>`;
    return;
  }

  const meta = state.metaBySymbol.get(symbol);
  const { dates, closes } = sliceByPeriod(full.dates, full.closes, months);
  if (dates.length < 2) {
    app.innerHTML = `<p style="color:var(--text-muted); font-size:13px;">선택한 기간에 데이터가 부족합니다.</p>`;
    return;
  }
  const { mdd, peakIdx, troughIdx, recoveryIdx, ddSeries } = calcMDD(dates, closes);

  const peakDate = dates[peakIdx], troughDate = dates[troughIdx];
  const fallDays = daysBetween(peakDate, troughDate);
  const recovered = recoveryIdx !== -1;
  const recoveryDate = recovered ? dates[recoveryIdx] : null;
  const recoveryDays = recovered ? daysBetween(troughDate, recoveryDate) : null;

  app.innerHTML = `
    <div class="card">
      <div class="stat-row">
        <div class="stat">
          <p class="stat-label">최대낙폭 (MDD)</p>
          <p class="stat-hero" style="color:var(--critical)">-${(Math.abs(mdd) * 100).toFixed(1)}%</p>
        </div>
        <div class="stat">
          <p class="stat-label">고점</p>
          <p class="stat-value">${fmtPrice(closes[peakIdx], full.currency)}</p>
          <p class="stat-sub">${peakDate}</p>
        </div>
        <div class="stat">
          <p class="stat-label">저점</p>
          <p class="stat-value">${fmtPrice(closes[troughIdx], full.currency)}</p>
          <p class="stat-sub">${troughDate} · 고점 후 ${fallDays}일</p>
        </div>
        <div class="stat">
          <p class="stat-label">회복 상태</p>
          ${recovered
            ? `<span class="badge recovered">✓ 회복 완료</span><p class="stat-sub">${recoveryDate} · ${recoveryDays}일 소요</p>`
            : `<span class="badge ongoing">● 미회복 (진행 중)</span><p class="stat-sub">${dates[dates.length - 1]} 기준</p>`}
        </div>
      </div>
      ${meta && meta.ttmDividend
        ? `<p class="stat-sub" style="border-top:1px solid var(--gridline); padding-top:12px; margin-top:0;">💰 최근 12개월 배당 <b style="color:var(--text-primary)">${fmtPrice(meta.ttmDividend, full.currency)}</b>/주 · 배당수익률 <b style="color:var(--text-primary)">${(meta.dividendYield * 100).toFixed(2)}%</b> <span style="color:var(--text-muted)">(현재가 기준)</span></p>`
        : ""}
    </div>

    <div class="card">
      <p class="chart-title">가격 추이 — ${meta ? meta.name : symbol}</p>
      ${full.isBlend ? `<p class="stat-sub" style="margin:-8px 0 12px;">합성 포트폴리오: 최초 100 투자·일별 리밸런싱 가정 지수(실제 가격 아님)</p>` : ""}
      <div id="mddPriceChart"></div>
    </div>

    <div class="card">
      <p class="chart-title">낙폭 추이 (Underwater) — 고점 대비 하락률</p>
      <div id="mddDdChart"></div>
    </div>
  `;

  buildChart(document.getElementById("mddPriceChart"), {
    dates, values: closes, color: cssVar("--series-price"),
    mode: "price", currency: full.currency,
    markers: [
      { idx: peakIdx, cls: "peak", label: "고점" },
      { idx: troughIdx, cls: "trough", label: `−${(Math.abs(mdd) * 100).toFixed(1)}%` },
    ],
    valueFmt: (v) => fmtPrice(v, full.currency),
    seriesLabel: "종가",
  });

  buildChart(document.getElementById("mddDdChart"), {
    dates, values: ddSeries, color: cssVar("--series-dd"),
    mode: "drawdown",
    markers: [{ idx: troughIdx, cls: "trough", label: `−${(Math.abs(mdd) * 100).toFixed(1)}%` }],
    valueFmt: (v) => (v * 100).toFixed(1) + "%",
    seriesLabel: "낙폭",
  });
}

/* ---------- 📉 MDD 비교(최대 5개) ---------- */
async function renderCompare() {
  const checked = [...(state.compareChecked || new Set())];
  const months = Number(document.getElementById("periodSelect").value);
  const alignStart = document.getElementById("alignStartToggle").checked;
  const result = document.getElementById("compareResult");
  document.getElementById("chkCount").textContent = String(checked.length);

  document.querySelectorAll("#compareChecklist input").forEach((el) => {
    const item = el.closest(".chk-item");
    if (!el.checked && checked.length >= MAX_COMPARE) item.classList.add("disabled");
    else item.classList.remove("disabled");
    el.disabled = !el.checked && checked.length >= MAX_COMPARE;
  });

  if (checked.length === 0) {
    result.innerHTML = `<p class="compare-empty">비교할 ETF를 위에서 골라주세요.</p>`;
    return;
  }
  result.innerHTML = `<p class="compare-empty">불러오는 중…</p>`;

  const fulls = [];
  for (const symbol of checked) {
    try {
      fulls.push({ symbol, full: await loadEntry(symbol) });
    } catch (err) {
      continue;
    }
  }

  if (fulls.length === 0) {
    result.innerHTML = `<p class="compare-empty">데이터를 불러오지 못했습니다.</p>`;
    return;
  }

  let commonStart = null;
  let commonStartSymbol = null;
  if (alignStart) {
    for (const { symbol, full } of fulls) {
      if (!commonStart || full.dates[0] > commonStart) {
        commonStart = full.dates[0];
        commonStartSymbol = symbol;
      }
    }
  }

  const rows = [];
  for (const { symbol, full } of fulls) {
    const sliced = alignStart
      ? sliceFromDate(full.dates, full.closes, commonStart)
      : sliceByPeriod(full.dates, full.closes, months);
    if (sliced.dates.length < 2) continue;
    const { mdd, peakIdx, troughIdx, recoveryIdx, ddSeries } = calcMDD(sliced.dates, sliced.closes);
    rows.push({
      symbol, meta: state.metaBySymbol.get(symbol), color: symbolColor(symbol),
      dates: sliced.dates, closes: sliced.closes, mdd, peakIdx, troughIdx, recoveryIdx, ddSeries,
      recovered: recoveryIdx !== -1,
    });
  }

  if (rows.length === 0) {
    result.innerHTML = `<p class="compare-empty">선택한 기간에 데이터가 부족합니다.</p>`;
    return;
  }

  const alignNote = alignStart
    ? `<p class="compare-empty">📌 <b style="color:var(--text-primary)">${commonStartSymbol}</b>의 상장일(${commonStart}) 기준으로 전 종목을 맞춰 비교합니다 — 위에서 고른 기간은 이 모드에서 적용되지 않습니다.</p>`
    : "";

  rows.sort((a, b) => a.mdd - b.mdd);
  const worstMdd = Math.abs(rows[0].mdd);

  const tableRows = rows
    .map((r) => {
      const label = r.meta ? r.meta.name : r.symbol;
      const recoveryText = r.recovered
        ? `${r.dates[r.recoveryIdx]}`
        : `<span style="color:var(--critical)">미회복</span>`;
      return `<tr>
        <td><span class="row-key"><span class="swatch" style="background:${r.color}"></span>${label}</span></td>
        <td class="mdd-cell">-${(Math.abs(r.mdd) * 100).toFixed(1)}%</td>
        <td>${r.dates[r.peakIdx]}</td>
        <td>${r.dates[r.troughIdx]}</td>
        <td>${recoveryText}</td>
      </tr>`;
    })
    .join("");

  const barRows = rows
    .map((r) => {
      const pct = worstMdd === 0 ? 0 : (Math.abs(r.mdd) / worstMdd) * 100;
      const label = r.meta ? r.meta.name : r.symbol;
      return `<div class="bar-row">
        <span class="bar-label" title="${label}">${r.symbol}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%; background:${r.color}"></div></div>
        <span class="bar-value">-${(Math.abs(r.mdd) * 100).toFixed(1)}%</span>
      </div>`;
    })
    .join("");

  result.innerHTML = `
    ${alignNote}
    <div class="bar-list">${barRows}</div>
    <div style="overflow-x:auto;">
      <table class="compare-table">
        <thead><tr><th>종목</th><th>MDD</th><th>고점일</th><th>저점일</th><th>회복일</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    <p class="chart-title" style="margin-top:20px;">낙폭 추이 비교 (Underwater)</p>
    <div id="compareChart"></div>
  `;

  buildCompareChart(document.getElementById("compareChart"), rows.map((r) => ({
    symbol: r.symbol,
    label: r.meta ? r.meta.name : r.symbol,
    color: r.color,
    dates: r.dates,
    values: r.ddSeries,
  })));
}

/* ---------- 🎛 커스텀 포트폴리오 계산 ---------- */
async function renderPortfolio() {
  state.portfolioSnapshotData = null;
  const rowEls = [...document.querySelectorAll("#portfolioRows .portfolio-row")];
  const months = Number(document.getElementById("periodSelect").value);
  const sumEl = document.getElementById("portfolioSum");
  const result = document.getElementById("portfolioResult");

  const entries = rowEls
    .map((el) => ({
      symbol: el.querySelector(".portfolio-symbol").value,
      weight: parseFloat(el.querySelector(".portfolio-weight").value) || 0,
      account: el.querySelector(".portfolio-account").value,
    }))
    .filter((e) => e.weight > 0);

  const sum = entries.reduce((s, e) => s + e.weight, 0);
  if (rowEls.length > 0) {
    sumEl.textContent = `합계 ${sum.toFixed(0)}%` + (Math.abs(sum - 100) < 0.5 ? " ✓" : " — 자동으로 100%에 맞춰 계산됩니다");
    sumEl.classList.toggle("ok", Math.abs(sum - 100) < 0.5);
  } else {
    sumEl.textContent = "";
  }

  if (entries.length < 2 || sum <= 0) {
    result.innerHTML = `<p class="compare-empty">최소 2개 종목에 비율을 입력해주세요.</p>`;
    return;
  }
  result.innerHTML = `<p class="compare-empty">계산 중…</p>`;

  const weights = entries.map((e) => ({ symbol: e.symbol, weight: e.weight / sum, account: e.account }));
  const dataBySymbol = new Map();
  try {
    for (const w of weights) {
      if (!dataBySymbol.has(w.symbol)) dataBySymbol.set(w.symbol, await loadSymbol(w.symbol));
    }
  } catch (err) {
    result.innerHTML = `<p class="compare-empty" style="color:var(--critical)">${err.message}</p>`;
    return;
  }

  const blended = computeBlend(weights, dataBySymbol);
  if (blended.dates.length < 2) {
    result.innerHTML = `<p class="compare-empty">선택한 종목들의 겹치는 데이터 기간이 없습니다.</p>`;
    return;
  }
  const { dates, closes } = sliceByPeriod(blended.dates, blended.closes, months);
  if (dates.length < 2) {
    result.innerHTML = `<p class="compare-empty">선택한 기간에 데이터가 부족합니다.</p>`;
    return;
  }
  const { mdd, peakIdx, troughIdx, recoveryIdx, ddSeries } = calcMDD(dates, closes);

  const peakDate = dates[peakIdx], troughDate = dates[troughIdx];
  const fallDays = daysBetween(peakDate, troughDate);
  const recovered = recoveryIdx !== -1;
  const recoveryDate = recovered ? dates[recoveryIdx] : null;
  const recoveryDays = recovered ? daysBetween(troughDate, recoveryDate) : null;

  const mixLabel = weights
    .map((w) => `${w.symbol} ${(w.weight * 100).toFixed(0)}%`)
    .join(" + ");

  const accountGroups = new Map();
  for (const w of weights) {
    if (!w.account) continue;
    if (!accountGroups.has(w.account)) accountGroups.set(w.account, { weight: 0, symbols: [] });
    const g = accountGroups.get(w.account);
    g.weight += w.weight;
    g.symbols.push(`${w.symbol} ${(w.weight * 100).toFixed(0)}%`);
  }
  const accountSummaryHTML = accountGroups.size
    ? `
    <p class="chart-title" style="margin-top:20px;">계좌별 비중</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>계좌</th><th>포함 종목</th><th>비중 합계</th></tr></thead>
      <tbody>
        ${[...accountGroups].map(([acc, g]) => `<tr><td>${acc}</td><td style="text-align:left;">${g.symbols.join(", ")}</td><td>${(g.weight * 100).toFixed(1)}%</td></tr>`).join("")}
      </tbody>
    </table>
    </div>`
    : "";

  result.innerHTML = `
    <div class="stat-row">
      <div class="stat">
        <p class="stat-label">최대낙폭 (MDD)</p>
        <p class="stat-hero" style="color:var(--critical)">-${(Math.abs(mdd) * 100).toFixed(1)}%</p>
      </div>
      <div class="stat">
        <p class="stat-label">고점</p>
        <p class="stat-value">${fmtPrice(closes[peakIdx], "USD")}</p>
        <p class="stat-sub">${peakDate}</p>
      </div>
      <div class="stat">
        <p class="stat-label">저점</p>
        <p class="stat-value">${fmtPrice(closes[troughIdx], "USD")}</p>
        <p class="stat-sub">${troughDate} · 고점 후 ${fallDays}일</p>
      </div>
      <div class="stat">
        <p class="stat-label">회복 상태</p>
        ${recovered
          ? `<span class="badge recovered">✓ 회복 완료</span><p class="stat-sub">${recoveryDate} · ${recoveryDays}일 소요</p>`
          : `<span class="badge ongoing">● 미회복 (진행 중)</span><p class="stat-sub">${dates[dates.length - 1]} 기준</p>`}
      </div>
    </div>
    ${accountSummaryHTML}

    <p class="chart-title" style="margin-top:20px;">가격 추이 — ${mixLabel}</p>
    <p class="stat-sub" style="margin:-8px 0 12px;">합성 포트폴리오: 최초 100 투자·일별 리밸런싱 가정 지수(실제 가격 아님)</p>
    <div id="portfolioChart"></div>

    <p class="chart-title" style="margin-top:20px;">낙폭 추이 (Underwater)</p>
    <div id="portfolioDdChart"></div>
  `;

  buildChart(document.getElementById("portfolioChart"), {
    dates, values: closes, color: cssVar("--series-price"),
    mode: "price",
    markers: [
      { idx: peakIdx, cls: "peak", label: "고점" },
      { idx: troughIdx, cls: "trough", label: `−${(Math.abs(mdd) * 100).toFixed(1)}%` },
    ],
    valueFmt: (v) => fmtPrice(v, "USD"),
    seriesLabel: "지수",
  });

  buildChart(document.getElementById("portfolioDdChart"), {
    dates, values: ddSeries, color: cssVar("--series-dd"),
    mode: "drawdown",
    markers: [{ idx: troughIdx, cls: "trough", label: `−${(Math.abs(mdd) * 100).toFixed(1)}%` }],
    valueFmt: (v) => (v * 100).toFixed(1) + "%",
    seriesLabel: "낙폭",
  });

  state.portfolioSnapshotData = {
    title: `커스텀 포트폴리오 — ${mixLabel}`,
    subtitle: `${dates[0]} ~ ${dates[dates.length - 1]}`,
    stats: [
      { label: "최대낙폭 (MDD)", value: `-${(Math.abs(mdd) * 100).toFixed(1)}%`, color: cssVar("--critical") },
      { label: "고점", value: fmtPrice(closes[peakIdx], "USD"), sub: peakDate },
      { label: "저점", value: fmtPrice(closes[troughIdx], "USD"), sub: troughDate },
      { label: "회복 상태", value: recovered ? "회복 완료" : "미회복", sub: recovered ? recoveryDate : dates[dates.length - 1] },
    ],
    dates, values: closes, mddIdx: troughIdx, dd: ddSeries, valueLabel: "지수",
  };
}

/* ---------- 📈 투자 시뮬레이터 ---------- */
async function loadDividends(symbol) {
  const key = "div:" + symbol;
  if (state.cache.has(key)) return state.cache.get(key);
  let div = null;
  try {
    div = await fetchJSON(`${DATA_DIR}/div/${symbol}.json`);
  } catch (err) {
    div = null;
  }
  state.cache.set(key, div);
  return div;
}

function solveAnnualIRR(cashflows) {
  const npv = (rm) => cashflows.reduce((s, c) => s + c.amount / Math.pow(1 + rm, c.t), 0);
  let lo = -0.5, hi = 1.0;
  let flo = npv(lo), fhi = npv(hi);
  if (isNaN(flo) || isNaN(fhi) || flo * fhi > 0) return null;
  for (let iter = 0; iter < 100; iter++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (flo * fm <= 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  const rm = (lo + hi) / 2;
  return Math.pow(1 + rm, 12) - 1;
}

function fxRateOn(fx, dateStr) {
  let lo = 0, hi = fx.dates.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fx.dates[mid] <= dateStr) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans >= 0 ? fx.rates[ans] : null;
}

function runPortfolioBacktest(assets, cur, fx) {
  const priceMaps = assets.map((a) => {
    const m = new Map();
    for (let i = 0; i < a.dates.length; i++) m.set(a.dates[i], a.closes[i]);
    return m;
  });
  let commonDates = [...priceMaps[0].keys()];
  for (let i = 1; i < priceMaps.length; i++) {
    commonDates = commonDates.filter((d) => priceMaps[i].has(d));
  }
  commonDates.sort();

  const convert = (assetCur, price, date) => {
    if (assetCur === cur) return price;
    const rate = fxRateOn(fx, date);
    if (rate == null) return null;
    return assetCur === "USD" ? price * rate : price / rate;
  };

  const needsFx = assets.some((a) => a.currency !== cur);
  if (needsFx) {
    commonDates = commonDates.filter((d) => fxRateOn(fx, d) != null);
  }
  if (commonDates.length < 2) return null;

  const n = commonDates.length;
  const conv = assets.map(() => new Array(n));
  const raw = assets.map(() => new Array(n));
  for (let i = 0; i < n; i++) {
    const d = commonDates[i];
    for (let k = 0; k < assets.length; k++) {
      raw[k][i] = priceMaps[k].get(d);
      conv[k][i] = convert(assets[k].currency, raw[k][i], d);
    }
  }

  return { dates: commonDates, conv, raw };
}

function simulatePerAsset(dates, conv, assets, cur, fx, months, dateRange, fxMode, raw) {
  let startIdx = 0, endIdx = dates.length - 1;
  if (dateRange && dateRange.start && dateRange.end) {
    startIdx = dates.findIndex((d) => d >= dateRange.start);
    if (startIdx < 0) startIdx = dates.length;
    endIdx = dates.length - 1;
    while (endIdx >= 0 && dates[endIdx] > dateRange.end) endIdx--;
  } else if (months) {
    const lastDate = new Date(dates[dates.length - 1]);
    lastDate.setMonth(lastDate.getMonth() - months);
    const cutoff = lastDate.toISOString().slice(0, 10);
    startIdx = dates.findIndex((d) => d >= cutoff);
    if (startIdx < 0) startIdx = 0;
  }
  if (startIdx > endIdx) return null;
  const D = dates.slice(startIdx, endIdx + 1);
  let P = conv.map((arr) => arr.slice(startIdx, endIdx + 1));
  const n = D.length;
  if (n < 30) return null;

  let fixedRate = null;
  if (fxMode === "fixed" && fx && raw) {
    fixedRate = fxRateOn(fx, D[0]);
    if (fixedRate != null) {
      P = raw.map((arr, k) => {
        const sliced = arr.slice(startIdx, endIdx + 1);
        if (assets[k].currency === cur) return sliced;
        return sliced.map((p) => (assets[k].currency === "USD" ? p * fixedRate : p / fixedRate));
      });
    }
  }

  const startTs = Date.parse(D[0]);
  const monthsAt = (dateStr) => (Date.parse(dateStr) - startTs) / (86400000 * 30.4375);

  const totalWeight = assets.reduce((s, a) => s + a.lumpAmount + a.monthlyAmount, 0) || 1;
  const nav = new Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let k = 0; k < assets.length; k++) v += ((assets[k].lumpAmount + assets[k].monthlyAmount) / totalWeight) * (P[k][i] / P[k][0]);
    nav[i] = v * 100;
  }

  const shares = assets.map(() => 0);
  const perContributed = assets.map(() => 0);
  const perDivCash = assets.map(() => 0);
  const perFlows = assets.map(() => []);
  const perDivEvents = assets.map(() => []);
  let contributed = 0, divCash = 0;
  const flows = [];
  const divEvents = [];
  const divPtr = assets.map((a) => {
    if (!a.div) return null;
    let di = 0;
    while (di < a.div.dates.length && a.div.dates[di] < D[0]) di++;
    return di;
  });

  let lastMonth = "";
  const values = new Array(n);
  const perValues = assets.map(() => new Array(n));
  for (let i = 0; i < n; i++) {
    const month = D[i].slice(0, 7);
    const isFirstDay = i === 0;
    const isMonthChange = month !== lastMonth;
    for (let k = 0; k < assets.length; k++) {
      let buy = 0;
      if (isFirstDay && assets[k].lumpAmount > 0) buy += assets[k].lumpAmount;
      if (isMonthChange && assets[k].monthlyAmount > 0) buy += assets[k].monthlyAmount;
      if (buy > 0) {
        shares[k] += buy / P[k][i];
        perContributed[k] += buy;
        contributed += buy;
        perFlows[k].push({ t: monthsAt(D[i]), amount: -buy });
        flows.push({ t: monthsAt(D[i]), amount: -buy });
      }
    }
    lastMonth = month;

    for (let k = 0; k < assets.length; k++) {
      const a = assets[k];
      if (!a.div) continue;
      while (divPtr[k] < a.div.dates.length && a.div.dates[divPtr[k]] <= D[i]) {
        let amt = a.div.amounts[divPtr[k]];
        if (a.currency !== cur) {
          const rate = fixedRate != null ? fixedRate : fxRateOn(fx, a.div.dates[divPtr[k]]);
          amt = rate == null ? 0 : (a.currency === "USD" ? amt * rate : amt / rate);
        }
        const cash = shares[k] * amt;
        divCash += cash;
        perDivCash[k] += cash;
        divEvents.push({ date: a.div.dates[divPtr[k]], cash });
        perDivEvents[k].push({ date: a.div.dates[divPtr[k]], cash });
        divPtr[k]++;
      }
    }

    let v = 0;
    for (let k = 0; k < assets.length; k++) {
      const pv = shares[k] * P[k][i];
      perValues[k][i] = pv;
      v += pv;
    }
    values[i] = v;
  }

  const finalValue = values[n - 1];
  flows.push({ t: monthsAt(D[n - 1]), amount: finalValue + divCash });
  const irr = solveAnnualIRR(flows);

  const lastYearStart = new Date(Date.parse(D[n - 1]) - 365 * 86400000).toISOString().slice(0, 10);
  const ttmDivCash = divEvents.filter((e) => e.date > lastYearStart).reduce((s, e) => s + e.cash, 0);

  const perAsset = assets.map((a, k) => {
    const finalV = perValues[k][n - 1];
    perFlows[k].push({ t: monthsAt(D[n - 1]), amount: finalV + perDivCash[k] });
    const pIrr = perContributed[k] > 0 ? solveAnnualIRR(perFlows[k]) : null;
    const pTtmDiv = perDivEvents[k].filter((e) => e.date > lastYearStart).reduce((s, e) => s + e.cash, 0);
    const { mdd, troughIdx } = calcMDD(D, perValues[k]);
    return {
      symbol: a.symbol, values: perValues[k], contributed: perContributed[k], finalValue: finalV,
      divCash: perDivCash[k], ttmDivCash: pTtmDiv, irr: pIrr, shares: shares[k], mdd, troughIdx,
      lumpAmount: a.lumpAmount, monthlyAmount: a.monthlyAmount,
    };
  });

  return { dates: D, values, nav, contributed, finalValue, divCash, ttmDivCash, irr, shares, perAsset };
}

function estimateFuture(totalLump, totalMonthly, years, priceCAGR, divYield, divGrowth) {
  const months = years * 12;
  const rm = Math.pow(1 + priceCAGR, 1 / 12) - 1;
  const fvLump = totalLump * Math.pow(1 + priceCAGR, years);
  const fvMonthly = Math.abs(rm) < 1e-9 ? totalMonthly * months : totalMonthly * ((Math.pow(1 + rm, months) - 1) / rm);
  const fv = fvLump + fvMonthly;
  const contributed = totalLump + totalMonthly * months;
  const monthlyDiv = divYield != null ? (fv * divYield * Math.pow(1 + (divGrowth || 0), years)) / 12 : null;
  return { fv, contributed, monthlyDiv };
}

function estimateDivGrowth(div) {
  if (!div || div.dates.length < 4) return 0;
  const byYear = new Map();
  for (let i = 0; i < div.dates.length; i++) {
    const y = div.dates[i].slice(0, 4);
    byYear.set(y, (byYear.get(y) || 0) + div.amounts[i]);
  }
  const years = [...byYear.keys()].sort();
  const full = years.slice(0, -1);
  if (full.length < 3) return 0;
  const first = byYear.get(full[0]), last = byYear.get(full[full.length - 1]);
  if (first <= 0 || last <= 0) return 0;
  const g = Math.pow(last / first, 1 / (full.length - 1)) - 1;
  return Math.max(-0.2, Math.min(0.3, g));
}

function updateSimRowFieldVisibility(row) {
  const rowMode = row.querySelector(".sim-row-mode").value;
  const lumpEl = row.querySelector(".sim-row-lump");
  const monthlyEl = row.querySelector(".sim-row-monthly");
  lumpEl.style.display = rowMode === "dca" ? "none" : "";
  monthlyEl.style.display = rowMode === "lump" ? "none" : "";
  if (rowMode === "dca") lumpEl.value = "";
  if (rowMode === "lump") monthlyEl.value = "";
}

function addSimRow(defaultSymbol, defaultWeight, rowMode, lumpAmount, monthlyAmount, defaultAccount) {
  const rowId = "srow_" + (calcRowSeq++);
  const row = document.createElement("div");
  row.className = "portfolio-row";
  row.dataset.rowId = rowId;
  row.innerHTML = `
    <select class="sim-symbol" aria-label="종목 선택">${etfOptionsHTML(defaultSymbol)}</select>
    <div class="portfolio-weight-wrap sim-weight-field">
      <input type="number" class="sim-weight" min="0" step="1" value="${defaultWeight}"> %
    </div>
    <div class="sim-custom-fields">
      <select class="sim-row-mode" aria-label="종목별 투자 방식">
        <option value="lump" ${rowMode === "lump" ? "selected" : ""}>거치</option>
        <option value="dca" ${rowMode === "dca" ? "selected" : ""}>월적립</option>
        <option value="both" ${rowMode === "both" ? "selected" : ""}>거치+월적립</option>
      </select>
      <input type="number" class="sim-row-lump" min="0" step="1" placeholder="초기 투자금" value="${lumpAmount || ""}">
      <input type="number" class="sim-row-monthly" min="0" step="1" placeholder="월 납입액" value="${monthlyAmount || ""}">
    </div>
    <select class="sim-account portfolio-account" aria-label="계좌 구분">${accountOptionsHTML(defaultAccount)}</select>
    <button type="button" class="portfolio-remove" aria-label="종목 제거">×</button>
  `;
  document.getElementById("simRows").appendChild(row);
  updateSimRowFieldVisibility(row);

  row.querySelector(".sim-symbol").addEventListener("change", renderSimulator);
  row.querySelector(".sim-weight").addEventListener("input", renderSimulator);
  row.querySelector(".sim-row-mode").addEventListener("change", () => {
    updateSimRowFieldVisibility(row);
    renderSimulator();
  });
  row.querySelector(".sim-row-lump").addEventListener("input", renderSimulator);
  row.querySelector(".sim-row-monthly").addEventListener("input", renderSimulator);
  row.querySelector(".sim-account").addEventListener("change", renderSimulator);
  row.querySelector(".portfolio-remove").addEventListener("click", () => {
    row.remove();
    renderSimulator();
  });
}

const SIM_STORAGE_KEY = "mdd_simulator_v1";

function applyFxModeUI() {
  document.querySelectorAll("#simFxSeg button").forEach((b) => b.classList.toggle("active", b.dataset.fx === state.simFxMode));
  document.getElementById("simFxHint").style.display = state.simFxMode === "fixed" ? "" : "none";
}

function applyInputModeUI() {
  const isCustom = state.simInputMode === "custom";
  document.getElementById("simRows").classList.toggle("custom-mode", isCustom);
  document.getElementById("simGlobalAmount").style.display = isCustom ? "none" : "contents";
  document.getElementById("simCustomHint").style.display = isCustom ? "" : "none";
  document.querySelectorAll("#simInputModeSeg button").forEach((b) => b.classList.toggle("active", b.dataset.inputMode === state.simInputMode));
}

function serializeSimConfig() {
  return {
    inputMode: state.simInputMode,
    fxMode: state.simFxMode,
    rows: [...document.querySelectorAll("#simRows .portfolio-row")].map((el) => ({
      symbol: el.querySelector(".sim-symbol").value,
      weight: parseFloat(el.querySelector(".sim-weight").value) || 0,
      rowMode: el.querySelector(".sim-row-mode").value,
      lumpAmount: parseFloat(el.querySelector(".sim-row-lump").value) || 0,
      monthlyAmount: parseFloat(el.querySelector(".sim-row-monthly").value) || 0,
      account: el.querySelector(".sim-account").value,
    })),
    cur: state.simCurrency,
    mode: document.getElementById("simMode").value,
    amount: document.getElementById("simAmount").value,
    futureYears: document.getElementById("simFutureYears").value,
    goalDate: document.getElementById("simGoalDate").value,
    goalAmount: document.getElementById("simGoalAmount").value,
    expectedReturn: document.getElementById("simExpectedReturn").value,
    inflationOn: document.getElementById("simInflationOn").checked,
    inflationRate: document.getElementById("simInflationRate").value,
    months: document.getElementById("periodSelect").value,
    startDate: document.getElementById("simStartDate").value,
    endDate: document.getElementById("simEndDate").value,
  };
}

function applySimConfig(cfg) {
  if (!cfg || !Array.isArray(cfg.rows) || !cfg.rows.length) return false;
  document.getElementById("simRows").innerHTML = "";
  for (const r of cfg.rows) addSimRow(r.symbol, r.weight, r.rowMode, r.lumpAmount, r.monthlyAmount, r.account);
  state.simCurrency = cfg.cur === "KRW" ? "KRW" : "USD";
  document.querySelectorAll("#simCurrencySeg button").forEach((b) => b.classList.toggle("active", b.dataset.cur === state.simCurrency));
  state.simInputMode = cfg.inputMode === "custom" ? "custom" : "simple";
  applyInputModeUI();
  state.simFxMode = cfg.fxMode === "fixed" ? "fixed" : "float";
  applyFxModeUI();
  if (cfg.mode) document.getElementById("simMode").value = cfg.mode;
  if (cfg.amount) document.getElementById("simAmount").value = cfg.amount;
  if (cfg.futureYears) document.getElementById("simFutureYears").value = cfg.futureYears;
  document.getElementById("simGoalDate").value = cfg.goalDate || "";
  document.getElementById("simGoalAmount").value = cfg.goalAmount || "";
  document.getElementById("simExpectedReturn").value = cfg.expectedReturn || "";
  document.getElementById("simInflationOn").checked = !!cfg.inflationOn;
  if (cfg.inflationRate) document.getElementById("simInflationRate").value = cfg.inflationRate;
  if (cfg.months) document.getElementById("periodSelect").value = cfg.months;
  document.getElementById("simStartDate").value = cfg.startDate || "";
  document.getElementById("simEndDate").value = cfg.endDate || "";
  return true;
}

function saveSimSettings() {
  localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(serializeSimConfig()));
  flashStatus("simSaveStatus", "설정이 저장되었습니다 ✓ (이 기기에만 보관됩니다)");
}

function loadSimSettings() {
  const raw = localStorage.getItem(SIM_STORAGE_KEY);
  if (!raw) { flashStatus("simSaveStatus", "저장된 설정이 없습니다"); return; }
  try {
    const cfg = JSON.parse(raw);
    if (applySimConfig(cfg)) {
      renderMdd(); renderCompare(); renderPortfolio(); renderSimulator();
      flashStatus("simSaveStatus", "저장된 설정을 불러왔습니다 ✓");
    }
  } catch (err) {
    flashStatus("simSaveStatus", "저장된 설정을 읽지 못했습니다");
  }
}

async function renderSimulator() {
  state.simSnapshotData = null;
  const rowEls = [...document.querySelectorAll("#simRows .portfolio-row")];
  const inputMode = state.simInputMode;
  const mode = document.getElementById("simMode").value;
  const amount = parseFloat(document.getElementById("simAmount").value) || 0;
  const dropdownYears = Number(document.getElementById("simFutureYears").value);
  const goalDateVal = document.getElementById("simGoalDate").value;
  const todayForGoal = new Date().toISOString().slice(0, 10);
  const goalDateYears = goalDateVal && goalDateVal > todayForGoal ? daysBetween(todayForGoal, goalDateVal) / 365.25 : null;
  const futureYears = goalDateYears != null ? goalDateYears : dropdownYears;
  document.getElementById("simGoalDateHint").style.display = goalDateYears != null ? "" : "none";
  const months = Number(document.getElementById("periodSelect").value);
  const simMaxDateStr = new Date().toISOString().slice(0, 10);
  const startInput = document.getElementById("simStartDate");
  const endInput = document.getElementById("simEndDate");
  if (startInput.value > simMaxDateStr) startInput.value = simMaxDateStr;
  if (endInput.value > simMaxDateStr) endInput.value = simMaxDateStr;
  const startDateVal = startInput.value;
  const endDateVal = endInput.value;
  const dateRange = startDateVal && endDateVal ? { start: startDateVal, end: endDateVal } : null;
  const cur = state.simCurrency;
  const fmt = (v) => fmtPrice(v, cur);
  const sumEl = document.getElementById("simSum");
  const result = document.getElementById("simResult");

  if (dateRange && dateRange.start >= dateRange.end) {
    result.innerHTML = `<p class="compare-empty" style="color:var(--critical)">시작일은 종료일보다 앞서야 합니다.</p>`;
    return;
  }

  const curSym = cur === "KRW" ? "₩" : "$";
  document.getElementById("simAmountUnit").textContent = mode === "dca" ? `${curSym}/월` : `${curSym} 총액`;
  document.getElementById("simGoalUnit").textContent = `${curSym} 목표`;
  const goalAmount = parseFloat(document.getElementById("simGoalAmount").value) || 0;

  let rawEntries, mixLabel;
  if (inputMode === "custom") {
    sumEl.textContent = "";
    rawEntries = rowEls
      .map((el) => ({
        symbol: el.querySelector(".sim-symbol").value,
        lumpAmount: parseFloat(el.querySelector(".sim-row-lump").value) || 0,
        monthlyAmount: parseFloat(el.querySelector(".sim-row-monthly").value) || 0,
        account: el.querySelector(".sim-account").value,
      }))
      .filter((e) => e.lumpAmount > 0 || e.monthlyAmount > 0);
    if (rawEntries.length === 0) {
      result.innerHTML = `<p class="compare-empty">최소 1개 종목에 투자금을 입력해주세요.</p>`;
      return;
    }
    mixLabel = rawEntries
      .map((e) => {
        const parts = [];
        if (e.lumpAmount > 0) parts.push(`거치 ${fmt(e.lumpAmount)}`);
        if (e.monthlyAmount > 0) parts.push(`월 ${fmt(e.monthlyAmount)}`);
        return `${e.symbol} ${parts.join("+")}`;
      })
      .join(" · ");
  } else {
    const weightEntries = rowEls
      .map((el) => ({
        symbol: el.querySelector(".sim-symbol").value,
        weight: parseFloat(el.querySelector(".sim-weight").value) || 0,
        account: el.querySelector(".sim-account").value,
      }))
      .filter((e) => e.weight > 0);
    const sum = weightEntries.reduce((s, e) => s + e.weight, 0);
    if (rowEls.length > 0) {
      sumEl.textContent = `합계 ${sum.toFixed(0)}%` + (Math.abs(sum - 100) < 0.5 ? " ✓" : " — 자동으로 100%에 맞춰 계산됩니다");
      sumEl.classList.toggle("ok", Math.abs(sum - 100) < 0.5);
    } else {
      sumEl.textContent = "";
    }
    if (weightEntries.length === 0 || sum <= 0) {
      result.innerHTML = `<p class="compare-empty">최소 1개 종목에 비율을 입력해주세요.</p>`;
      return;
    }
    if (amount <= 0) {
      result.innerHTML = `<p class="compare-empty">금액을 입력해주세요.</p>`;
      return;
    }
    rawEntries = weightEntries.map((e) => ({
      symbol: e.symbol,
      lumpAmount: mode === "lump" ? (amount * e.weight) / sum : 0,
      monthlyAmount: mode === "dca" ? (amount * e.weight) / sum : 0,
      account: e.account,
    }));
    mixLabel = weightEntries.map((e) => `${e.symbol} ${((e.weight / sum) * 100).toFixed(0)}%`).join(" + ");
  }

  result.innerHTML = `<p class="compare-empty">계산 중…</p>`;

  let assets, fx;
  try {
    assets = await Promise.all(
      rawEntries.map(async (e) => {
        const full = await loadSymbol(e.symbol);
        const div = await loadDividends(e.symbol);
        return {
          symbol: e.symbol,
          lumpAmount: e.lumpAmount,
          monthlyAmount: e.monthlyAmount,
          account: e.account,
          dates: full.dates,
          closes: full.closes,
          currency: full.currency || "USD",
          div,
        };
      })
    );
    fx = await loadFx();
  } catch (err) {
    result.innerHTML = `<p class="compare-empty" style="color:var(--critical)">${err.message}</p>`;
    return;
  }

  const needsFx = assets.some((a) => a.currency !== cur);
  if (needsFx && !fx) {
    result.innerHTML = `<p class="compare-empty" style="color:var(--critical)">환율 데이터가 아직 준비되지 않아 통화가 다른 종목을 계산할 수 없습니다. 잠시 후 다시 시도해주세요.</p>`;
    return;
  }

  const bt0 = runPortfolioBacktest(assets, cur, fx);
  if (!bt0) {
    result.innerHTML = `<p class="compare-empty">선택한 종목들의 겹치는 데이터 기간이 없습니다.</p>`;
    return;
  }
  const sim = simulatePerAsset(bt0.dates, bt0.conv, assets, cur, fx, months, dateRange, state.simFxMode, bt0.raw);
  if (!sim) {
    const lastDataDate = bt0.dates[bt0.dates.length - 1];
    const msg =
      dateRange && dateRange.end > lastDataDate
        ? `종료일이 실제 시세 데이터의 마지막 날짜(${lastDataDate})보다 뒤에 있습니다. 그 이전 날짜로 종료일을 다시 선택해주세요.`
        : "선택한 기간에 데이터가 부족합니다 (최소 30 거래일 필요).";
    result.innerHTML = `<p class="compare-empty" style="color:var(--critical)">${msg}</p>`;
    return;
  }

  const { dates, values } = sim;
  const { mdd, troughIdx, ddSeries } = calcMDD(dates, values);
  const totalReturn = (sim.finalValue + sim.divCash) / sim.contributed - 1;

  const days = daysBetween(dates[0], dates[dates.length - 1]);
  const priceCAGR = days > 0 ? Math.pow(sim.nav[sim.nav.length - 1] / sim.nav[0], 365.25 / days) - 1 : 0;

  const expectedReturnVal = document.getElementById("simExpectedReturn").value;
  const expectedReturn = expectedReturnVal !== "" ? Number(expectedReturnVal) / 100 : null;
  const effectivePriceCAGR = expectedReturn != null ? expectedReturn : priceCAGR;
  document.getElementById("simExpectedReturnHint").style.display = expectedReturn != null ? "" : "none";

  const inflationOn = document.getElementById("simInflationOn").checked;
  const inflationRate = inflationOn ? (Number(document.getElementById("simInflationRate").value) || 0) / 100 : null;

  let wYieldSum = 0, wYieldWeight = 0, wGrowthSum = 0;
  for (let k = 0; k < assets.length; k++) {
    const a = assets[k];
    const shareW = sim.contributed > 0 ? sim.perAsset[k].contributed / sim.contributed : 0;
    const meta = state.metaBySymbol.get(a.symbol);
    if (meta && meta.ttmDividend && a.closes[a.closes.length - 1]) {
      const y = meta.ttmDividend / a.closes[a.closes.length - 1];
      wYieldSum += y * shareW;
      wYieldWeight += shareW;
      wGrowthSum += estimateDivGrowth(a.div) * shareW;
    }
  }
  const divYield = wYieldWeight > 0 ? wYieldSum : null;
  const divGrowth = wYieldWeight > 0 ? wGrowthSum / wYieldWeight : 0;
  const totalLump = assets.reduce((s, a) => s + a.lumpAmount, 0);
  const totalMonthly = assets.reduce((s, a) => s + a.monthlyAmount, 0);
  const fut = estimateFuture(totalLump, totalMonthly, futureYears, effectivePriceCAGR, divYield, divGrowth);
  const futReal = inflationRate != null ? fut.fv / Math.pow(1 + inflationRate, futureYears) : null;

  const trCAGR = effectivePriceCAGR + (divYield || 0);
  const goal = goalAmount > 0 ? monthsToGoal(goalAmount, totalLump, totalMonthly, trCAGR) : null;
  const goalTimeLabel = goal
    ? goal.months == null
      ? "50년 초과"
      : goal.months === 0
        ? "즉시 달성 (거치금만으로 충분)"
        : `${Math.floor(goal.months / 12) > 0 ? `${Math.floor(goal.months / 12)}년 ` : ""}${goal.months % 12 > 0 ? `${goal.months % 12}개월` : ""}`.trim()
    : null;

  const anyDiv = assets.some((a) => a.div);
  const someMissingDiv = assets.some((a) => !a.div);
  const divLine = anyDiv
    ? `누적 배당 수령 <b style="color:var(--text-primary)">${fmt(sim.divCash)}</b> · 최근 1년 월평균 배당 <b style="color:var(--text-primary)">${fmt(sim.ttmDivCash / 12)}</b> <span style="color:var(--text-muted)">(현금 수령 가정, 재투자 안 함${someMissingDiv ? " · 일부 종목은 배당 데이터 없어 미포함" : ""})</span>`
    : `<span style="color:var(--text-muted)">배당 데이터 없음 (국내 종목·배당 미제공 종목만 포함된 경우)</span>`;

  const holdingsLine = assets
    .map((a, k) => `${a.symbol} ${sim.shares[k].toLocaleString(undefined, { maximumFractionDigits: 2 })}주`)
    .join(" · ");

  const perAssetTableHTML = inputMode === "custom"
    ? `
    <p class="chart-title" style="margin-top:20px;">종목별 개별 결과</p>
    <div style="overflow-x:auto;">
    <table class="sim-per-asset-table">
      <thead><tr><th>종목</th><th>방식</th><th>납입원금</th><th>최종평가액</th><th>수익률</th><th>연IRR</th><th>MDD</th></tr></thead>
      <tbody>
        ${sim.perAsset.map((pa) => {
          const paReturn = pa.contributed > 0 ? (pa.finalValue + pa.divCash) / pa.contributed - 1 : 0;
          const modeLabel = pa.lumpAmount > 0 && pa.monthlyAmount > 0 ? "거치+월적립" : pa.lumpAmount > 0 ? "거치" : "월적립";
          return `<tr>
            <td>${pa.symbol}</td>
            <td>${modeLabel}</td>
            <td>${fmt(pa.contributed)}</td>
            <td>${fmt(pa.finalValue)}</td>
            <td style="color:${paReturn >= 0 ? "var(--good)" : "var(--critical)"}">${paReturn >= 0 ? "+" : ""}${(paReturn * 100).toFixed(1)}%</td>
            <td>${pa.irr != null ? (pa.irr * 100).toFixed(1) + "%" : "—"}</td>
            <td style="color:var(--critical)">-${(Math.abs(pa.mdd) * 100).toFixed(1)}%</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>`
    : "";

  const accountGroups = new Map();
  assets.forEach((a, k) => {
    if (!a.account) return;
    if (!accountGroups.has(a.account)) accountGroups.set(a.account, { contributed: 0, finalValue: 0, divCash: 0, symbols: [] });
    const g = accountGroups.get(a.account);
    const pa = sim.perAsset[k];
    g.contributed += pa.contributed;
    g.finalValue += pa.finalValue;
    g.divCash += pa.divCash;
    g.symbols.push(a.symbol);
  });
  const accountSummaryList = [...accountGroups].map(([acc, g]) => ({
    account: acc,
    symbols: g.symbols.join(", "),
    contributed: fmt(g.contributed),
    finalValue: fmt(g.finalValue),
    returnPct: g.contributed > 0 ? (((g.finalValue + g.divCash) / g.contributed - 1) * 100).toFixed(1) + "%" : "—",
    _returnSign: g.contributed > 0 ? (g.finalValue + g.divCash) / g.contributed - 1 : 0,
  }));
  const accountSummaryHTML = accountSummaryList.length
    ? `
    <p class="chart-title" style="margin-top:20px;">계좌별 합계</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>계좌</th><th>포함 종목</th><th>납입원금</th><th>최종평가액</th><th>수익률</th></tr></thead>
      <tbody>
        ${accountSummaryList.map((r) => `<tr>
            <td>${r.account}</td>
            <td style="text-align:left;">${r.symbols}</td>
            <td>${r.contributed}</td>
            <td>${r.finalValue}</td>
            <td style="color:${r._returnSign >= 0 ? "var(--good)" : "var(--critical)"}">${r._returnSign >= 0 ? "+" : ""}${r.returnPct}</td>
          </tr>`).join("")}
      </tbody>
    </table>
    </div>`
    : "";

  const fxLabel = needsFx ? (state.simFxMode === "fixed" ? " · 고정 환율(시작일 기준)" : " · 환율 변동 반영") : "";
  result.innerHTML = `
    <p class="chart-title" style="margin-top:8px;">📊 백테스트 (합산결과) — ${mixLabel} · ${dates[0]} ~ ${dates[dates.length - 1]}${fxLabel}</p>
    <div class="stat-row">
      <div class="stat">
        <p class="stat-label">최종 평가액 (배당 별도)</p>
        <p class="stat-hero" style="font-size:32px;">${fmt(sim.finalValue)}</p>
        <p class="stat-sub">납입원금 ${fmt(sim.contributed)}</p>
      </div>
      <div class="stat">
        <p class="stat-label">총수익률 (배당 포함)</p>
        <p class="stat-value" style="color:${totalReturn >= 0 ? "var(--good)" : "var(--critical)"}">${totalReturn >= 0 ? "+" : ""}${(totalReturn * 100).toFixed(1)}%</p>
        <p class="stat-sub">연 수익률(IRR) ${sim.irr != null ? (sim.irr * 100).toFixed(1) + "%" : "—"}</p>
      </div>
      <div class="stat">
        <p class="stat-label">기간 중 최대낙폭</p>
        <p class="stat-value" style="color:var(--critical)">-${(Math.abs(mdd) * 100).toFixed(1)}%</p>
        <p class="stat-sub">${dates[troughIdx]} 저점</p>
      </div>
      <div class="stat">
        <p class="stat-label">보유 수량</p>
        <p class="stat-value" style="font-size:14.5px; line-height:1.5;">${holdingsLine}</p>
      </div>
    </div>
    <p class="stat-sub" style="border-top:1px solid var(--gridline); padding-top:12px;">💰 ${divLine}</p>
    ${perAssetTableHTML}
    ${accountSummaryHTML}

    <p class="chart-title" style="margin-top:20px;">평가액 추이</p>
    <div id="simValueChart"></div>
    <p class="chart-title" style="margin-top:20px;">평가액 낙폭 추이</p>
    <div id="simDdChart"></div>

    <p class="chart-title" style="margin-top:24px;">🔮 ${goalDateYears != null ? `목표일(${goalDateVal})까지` : `향후 ${futureYears}년`} 추정 (과거 실적 기반)</p>
    <div class="stat-row">
      <div class="stat">
        <p class="stat-label">예상 평가액</p>
        <p class="stat-value">${fmt(fut.fv)}</p>
        <p class="stat-sub">납입 예정 원금 ${fmt(fut.contributed)}${futReal != null ? ` · 물가반영 실질가치 ${fmt(futReal)}` : ""}</p>
      </div>
      <div class="stat">
        <p class="stat-label">적용 연 수익률</p>
        <p class="stat-value">${(effectivePriceCAGR * 100).toFixed(1)}%</p>
        <p class="stat-sub">${expectedReturn != null ? "사용자 지정 기대수익률" : "백테스트 기간 포트폴리오 CAGR"}</p>
      </div>
      <div class="stat">
        <p class="stat-label">예상 월배당 (${goalDateYears != null ? goalDateVal : `${futureYears}년 후`})</p>
        <p class="stat-value">${fut.monthlyDiv != null ? fmt(fut.monthlyDiv) : "—"}</p>
        <p class="stat-sub">${fut.monthlyDiv != null ? `가중평균 수익률 ${(divYield * 100).toFixed(2)}% · 배당성장 연 ${(divGrowth * 100).toFixed(1)}% 가정` : "배당 데이터 없음"}</p>
      </div>
      <div class="stat">
        <p class="stat-label">참고 최대낙폭</p>
        <p class="stat-value" style="color:var(--critical)">-${(Math.abs(mdd) * 100).toFixed(1)}%</p>
        <p class="stat-sub">과거 기간 실측치</p>
      </div>
    </div>
    ${goal ? `
    <p class="chart-title" style="margin-top:24px;">🎯 목표 금액 도달 추정</p>
    <div class="stat-row">
      <div class="stat">
        <p class="stat-label">목표 금액</p>
        <p class="stat-value">${fmt(goalAmount)}</p>
        <p class="stat-sub">현재 투자 조건 기준${totalMonthly > 0 ? ` (월 ${fmt(totalMonthly)} 적립)` : ""}</p>
      </div>
      <div class="stat">
        <p class="stat-label">도달 소요시간</p>
        <p class="stat-value">${goalTimeLabel}</p>
        <p class="stat-sub">${goal.months != null && goal.months > 0 ? `도달 시점 납입원금 ${fmt(goal.contributed)}` : goal.months === 0 ? "" : "투자금·기간 조건 재검토 필요"}</p>
      </div>
      <div class="stat">
        <p class="stat-label">적용 연평균 TR 수익률</p>
        <p class="stat-value">${(trCAGR * 100).toFixed(1)}%</p>
        <p class="stat-sub">가격 ${(effectivePriceCAGR * 100).toFixed(1)}%${expectedReturn != null ? "(지정값)" : ""}${divYield != null ? ` + 배당 ${(divYield * 100).toFixed(2)}% 재투자 가정` : " (배당 데이터 없음)"}</p>
      </div>
    </div>` : ""}
    <p class="stat-sub" style="color:var(--critical);">⚠️ 미래 추정은 과거 실적을 그대로 연장한 참고치일 뿐이며, 실제 수익률·배당·낙폭을 보장하지 않습니다.${inputMode === "custom" ? " (미래 추정은 개별 종목이 아닌 합산 포트폴리오 기준입니다)" : ""}</p>
  `;

  buildChart(document.getElementById("simValueChart"), {
    dates, values, color: cssVar("--series-price"),
    mode: "price", currency: cur,
    markers: [{ idx: troughIdx, cls: "trough", label: `−${(Math.abs(mdd) * 100).toFixed(1)}%` }],
    valueFmt: (v) => fmt(v),
    seriesLabel: "평가액",
  });
  buildChart(document.getElementById("simDdChart"), {
    dates, values: ddSeries, color: cssVar("--series-dd"),
    mode: "drawdown",
    markers: [{ idx: troughIdx, cls: "trough", label: `−${(Math.abs(mdd) * 100).toFixed(1)}%` }],
    valueFmt: (v) => (v * 100).toFixed(1) + "%",
    seriesLabel: "낙폭",
  });

  state.simSnapshotData = {
    title: `투자 시뮬레이터 — ${mixLabel}`,
    subtitle: `합산결과 · ${dates[0]} ~ ${dates[dates.length - 1]}${fxLabel}`,
    stats: [
      { label: "최종 평가액", value: fmt(sim.finalValue), sub: `납입원금 ${fmt(sim.contributed)}` },
      { label: "총수익률", value: `${totalReturn >= 0 ? "+" : ""}${(totalReturn * 100).toFixed(1)}%`, color: totalReturn >= 0 ? cssVar("--good") : cssVar("--critical") },
      { label: "최대낙폭", value: `-${(Math.abs(mdd) * 100).toFixed(1)}%`, color: cssVar("--critical"), sub: dates[troughIdx] },
      { label: "연 수익률(IRR)", value: sim.irr != null ? `${(sim.irr * 100).toFixed(1)}%` : "—" },
      ...(goal
        ? [
            { label: "목표 금액", value: fmt(goalAmount), sub: `도달 소요시간 ${goalTimeLabel}` },
            { label: "적용 연평균 TR", value: `${(trCAGR * 100).toFixed(1)}%`, sub: "가격+배당 재투자 가정" },
          ]
        : []),
    ],
    dates, values, mddIdx: troughIdx, dd: ddSeries, valueLabel: `평가액(${cur})`,
    perAsset: inputMode === "custom"
      ? sim.perAsset.map((pa) => ({
          symbol: pa.symbol,
          mode: pa.lumpAmount > 0 && pa.monthlyAmount > 0 ? "거치+월적립" : pa.lumpAmount > 0 ? "거치" : "월적립",
          contributed: fmt(pa.contributed),
          finalValue: fmt(pa.finalValue),
          returnPct: pa.contributed > 0 ? (((pa.finalValue + pa.divCash) / pa.contributed - 1) * 100).toFixed(1) + "%" : "—",
          irr: pa.irr != null ? (pa.irr * 100).toFixed(1) + "%" : null,
          mdd: `-${(Math.abs(pa.mdd) * 100).toFixed(1)}%`,
        }))
      : null,
    accountSummary: accountSummaryList.length
      ? accountSummaryList.map((r) => ({ account: r.account, symbols: r.symbols, contributed: r.contributed, finalValue: r.finalValue, returnPct: (r._returnSign >= 0 ? "+" : "") + r.returnPct }))
      : null,
  };
}

/* ---------- 초기화 — capture/index.html의 init()이 state.manifest/listedEtfs/metaBySymbol을
   채운 뒤 호출한다. 마켓 필터·MDD 비교 체크리스트·기본 포트폴리오·기본 시뮬레이터 종목까지
   한 번에 구성한다. ---------- */
function initCalculators() {
  initKakao();
  state.allSymbols = [...state.listedEtfs.map((e) => e.symbol), ...BLENDS.map((b) => b.id)];
  for (const b of BLENDS) {
    if (!state.metaBySymbol.has(b.id)) state.metaBySymbol.set(b.id, { symbol: b.id, name: b.name, category: b.category });
  }
  state.marketFilter = "all";
  state.compareChecked = new Set(["SPY", "QQQ", "SCHD", "GLD", "TLT"]);
  state.simCurrency = "USD";
  state.simInputMode = "simple";
  state.simFxMode = "float";

  const select = document.getElementById("etfSelect");
  const checklist = document.getElementById("compareChecklist");

  function rebuildSelectors() {
    const filter = state.marketFilter;
    const visible = state.listedEtfs.filter((e) => filter === "all" || e.market === filter);
    const byCategory = new Map();
    for (const etf of visible) {
      if (!byCategory.has(etf.category)) byCategory.set(etf.category, []);
      byCategory.get(etf.category).push(etf);
    }
    if (BLENDS.length && filter !== "kr") {
      byCategory.set("합성 포트폴리오", BLENDS.map((b) => ({ symbol: b.id, name: b.name })));
    }

    const prevSelected = select.value;
    select.innerHTML = "";
    for (const [category, list] of byCategory) {
      const group = document.createElement("optgroup");
      group.label = category;
      for (const etf of list) {
        const opt = document.createElement("option");
        opt.value = etf.symbol;
        opt.textContent = etf.name;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }
    if ([...select.options].some((o) => o.value === prevSelected)) select.value = prevSelected;

    checklist.innerHTML = "";
    for (const [category, list] of byCategory) {
      if (category === "합성 포트폴리오") continue;
      const wrap = document.createElement("div");
      const label = document.createElement("p");
      label.className = "checklist-group-label";
      label.textContent = category;
      const items = document.createElement("div");
      items.className = "checklist-items";
      for (const etf of list) {
        const id = "cmp_" + etf.symbol;
        const color = symbolColor(etf.symbol);
        const lbl = document.createElement("label");
        lbl.className = "chk-item";
        lbl.setAttribute("for", id);
        lbl.innerHTML =
          `<span class="swatch" style="background:${color}"></span>` +
          `<input type="checkbox" id="${id}" value="${etf.symbol}" ${state.compareChecked.has(etf.symbol) ? "checked" : ""}>` +
          `${etf.name}`;
        items.appendChild(lbl);
      }
      wrap.appendChild(label);
      wrap.appendChild(items);
      checklist.appendChild(wrap);
    }
  }
  rebuildSelectors();

  document.querySelectorAll("#marketSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.marketFilter = btn.dataset.market;
      document.querySelectorAll("#marketSeg button").forEach((b) => b.classList.toggle("active", b === btn));
      const prev = select.value;
      rebuildSelectors();
      if (select.value !== prev) renderMdd();
      renderCompare();
    });
  });

  checklist.addEventListener("change", (evt) => {
    if (!evt.target.matches('input[type="checkbox"]')) return;
    if (evt.target.checked) state.compareChecked.add(evt.target.value);
    else state.compareChecked.delete(evt.target.value);
    renderCompare();
  });
  document.getElementById("alignStartToggle").addEventListener("change", renderCompare);
  select.addEventListener("change", renderMdd);
  document.getElementById("periodSelect").addEventListener("change", () => { renderMdd(); renderCompare(); renderPortfolio(); renderSimulator(); });

  addPortfolioRow("DIVO", 75);
  addPortfolioRow("VOO", 25);
  document.getElementById("addPortfolioRow").addEventListener("click", () => {
    const used = new Set([...document.querySelectorAll(".portfolio-symbol")].map((el) => el.value));
    const next = state.listedEtfs.find((e) => !used.has(e.symbol)) || state.listedEtfs[0];
    addPortfolioRow(next.symbol, 0);
    renderPortfolio();
  });
  document.getElementById("portfolioSaveBtn").addEventListener("click", savePortfolioSettings);
  document.getElementById("portfolioLoadBtn").addEventListener("click", loadPortfolioSettings);
  document.getElementById("portfolioCsvBtn").addEventListener("click", () => {
    if (!state.portfolioSnapshotData) { flashStatus("portfolioExportStatus", "먼저 계산 결과가 나온 뒤 눌러주세요"); return; }
    downloadResultCSV(state.portfolioSnapshotData, `mdd-portfolio-${todayStr()}.csv`);
  });
  document.getElementById("portfolioClaudeBtn").addEventListener("click", () => {
    if (!state.portfolioSnapshotData) { flashStatus("portfolioExportStatus", "먼저 계산 결과가 나온 뒤 눌러주세요"); return; }
    copyResultSummary(state.portfolioSnapshotData, "portfolioExportStatus");
  });
  document.getElementById("portfolioKakaoBtn").addEventListener("click", () => {
    if (!state.portfolioSnapshotData) { flashStatus("portfolioExportStatus", "먼저 계산 결과가 나온 뒤 눌러주세요"); return; }
    shareToKakao(state.portfolioSnapshotData, CAPTURE_PAGE_URL, "portfolioExportStatus");
  });

  addSimRow("SPY", 100);
  applyInputModeUI();
  document.querySelectorAll("#simInputModeSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.simInputMode = btn.dataset.inputMode;
      applyInputModeUI();
      renderSimulator();
    });
  });
  applyFxModeUI();
  document.querySelectorAll("#simFxSeg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.simFxMode = btn.dataset.fx;
      applyFxModeUI();
      renderSimulator();
    });
  });
  document.querySelectorAll("#simCurrencySeg button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.cur === state.simCurrency);
    btn.addEventListener("click", () => {
      state.simCurrency = btn.dataset.cur;
      document.querySelectorAll("#simCurrencySeg button").forEach((b) => b.classList.toggle("active", b === btn));
      renderSimulator();
    });
  });
  document.getElementById("addSimRow").addEventListener("click", () => {
    const used = new Set([...document.querySelectorAll(".sim-symbol")].map((el) => el.value));
    const next = state.listedEtfs.find((e) => !used.has(e.symbol)) || state.listedEtfs[0];
    addSimRow(next.symbol, 0);
    renderSimulator();
  });
  document.getElementById("simMode").addEventListener("change", renderSimulator);
  document.getElementById("simFutureYears").addEventListener("change", renderSimulator);
  document.getElementById("simAmount").addEventListener("input", renderSimulator);
  document.getElementById("simGoalAmount").addEventListener("input", renderSimulator);
  document.getElementById("simGoalDate").addEventListener("change", renderSimulator);
  document.getElementById("simExpectedReturn").addEventListener("input", renderSimulator);
  document.getElementById("simInflationOn").addEventListener("change", renderSimulator);
  document.getElementById("simInflationRate").addEventListener("input", renderSimulator);
  const simMaxDateStr = new Date().toISOString().slice(0, 10);
  document.getElementById("simStartDate").max = simMaxDateStr;
  document.getElementById("simEndDate").max = simMaxDateStr;
  document.getElementById("simGoalDate").min = simMaxDateStr;
  document.getElementById("simStartDate").addEventListener("change", renderSimulator);
  document.getElementById("simEndDate").addEventListener("change", renderSimulator);
  document.getElementById("simDateClear").addEventListener("click", () => {
    document.getElementById("simStartDate").value = "";
    document.getElementById("simEndDate").value = "";
    renderSimulator();
  });
  document.getElementById("simSaveBtn").addEventListener("click", saveSimSettings);
  document.getElementById("simLoadBtn").addEventListener("click", loadSimSettings);
  document.getElementById("simCsvBtn").addEventListener("click", () => {
    if (!state.simSnapshotData) { flashStatus("simExportStatus", "먼저 계산 결과가 나온 뒤 눌러주세요"); return; }
    downloadResultCSV(state.simSnapshotData, `mdd-simulator-${todayStr()}.csv`);
  });
  document.getElementById("simClaudeBtn").addEventListener("click", () => {
    if (!state.simSnapshotData) { flashStatus("simExportStatus", "먼저 계산 결과가 나온 뒤 눌러주세요"); return; }
    copyResultSummary(state.simSnapshotData, "simExportStatus");
  });
  document.getElementById("simKakaoBtn").addEventListener("click", () => {
    if (!state.simSnapshotData) { flashStatus("simExportStatus", "먼저 계산 결과가 나온 뒤 눌러주세요"); return; }
    shareToKakao(state.simSnapshotData, CAPTURE_PAGE_URL, "simExportStatus");
  });

  renderMdd();
  renderCompare();
  renderPortfolio();
  renderSimulator();
}
