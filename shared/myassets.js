// shared/myassets.js — 내 자산 대시보드 전체(계산+렌더, 9탭 build*HTML 포함)
// index.html에서 추출한 사본(2026-07-06 M1). state/DATA_DIR는 호출 페이지가 선언.
// 의존: shared/myassets-utils.js(fmtPrice/cssVar/buildChart 등), shared/price-data.js(loadSymbol/loadFx/loadLiveKrQuotes 등)

const MY_ASSETS_KEY = "my_assets_v1";
const MY_ASSETS_HISTORY_KEY = "my_assets_history_v1";
const MY_ASSETS_DAILY_HISTORY_KEY = "my_assets_daily_history_v1";
const MY_INCLUDE_STOCKS_KEY = "my_assets_include_stocks_v1"; // "0"이면 일반종목(개별주) 제외
const MY_ASSETS_CHANGELOG_KEY = "my_assets_changelog_v1";
const MY_ASSETS_WATCHLIST_KEY = "my_assets_watchlist_v1"; // A10 📡 시그널 탭 워치리스트 // 최대 300건, A3b/c: 폼 채우기·가져오기 시 변경 이력

/* ---------- A3c: 변동이력(🗂️) — 폼 채우기(캡처 반영)·가져오기 시마다 자동 기록되는 변경 로그.
   위 MY_ASSETS_HISTORY_KEY(월별 수동 스냅샷)와 달리, 이건 "무엇이 바뀌었는지" 이벤트 자체를
   자동으로 남긴다 — 버튼을 누르는 걸 잊어도 반영/가져오기가 일어난 시점마다 쌓인다. */
function loadAssetChangelog() {
  try { return JSON.parse(localStorage.getItem(MY_ASSETS_CHANGELOG_KEY) || "[]"); } catch (err) { return []; }
}

/* 현재 폼(#myAssetRows)의 계좌별 보유 수량 스냅샷 — Map(account -> Map(symbol -> qty)) */
function snapshotHoldingsMap() {
  const map = new Map();
  document.querySelectorAll("#myAssetRows .portfolio-row").forEach((row) => {
    const account = row.querySelector(".my-account").value || "계좌 미지정";
    const symbol = row.querySelector(".my-symbol").value;
    if (!symbol) return;
    const qty = parseFloat(row.querySelector(".my-qty").value) || 0;
    if (!map.has(account)) map.set(account, new Map());
    const accMap = map.get(account);
    accMap.set(symbol, (accMap.get(symbol) || 0) + qty);
  });
  return map;
}

/* 두 시점의 보유 스냅샷을 비교해 종목변동(추가/삭제/수량변경) 목록을 만든다 */
function diffHoldingsSnapshots(beforeMap, afterMap) {
  const changes = [];
  const accounts = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const account of accounts) {
    const before = beforeMap.get(account) || new Map();
    const after = afterMap.get(account) || new Map();
    const symbols = new Set([...before.keys(), ...after.keys()]);
    for (const symbol of symbols) {
      const oldQty = before.get(symbol) || 0;
      const newQty = after.get(symbol) || 0;
      if (oldQty === newQty) continue;
      const type = oldQty === 0 ? "added" : newQty === 0 ? "removed" : "qty-changed";
      changes.push({ account, symbol, type, oldQty, newQty });
    }
  }
  return changes;
}

/* renderMyAssets()가 채워둔 state.myAssetsCsvData.accountMap 기준 계좌별 평가액 스냅샷(자산변동·비중변동용) */
function snapshotAccountValues() {
  const csv = state.myAssetsCsvData;
  if (!csv) return { totalValue: 0, byAccount: {} };
  const byAccount = {};
  for (const [acc, g] of csv.accountMap) byAccount[acc] = g.value;
  return { totalValue: csv.totalValue, byAccount };
}

/* beforeHoldings/afterHoldings는 snapshotHoldingsMap(), beforeSnap/afterSnap은 snapshotAccountValues()
   호출 결과를 그대로 넘긴다. 실제 종목변동이 없으면(예: 매수계획만 바뀐 경우) 기록하지 않는다. */
function pushAssetChangelog(source, beforeHoldings, beforeSnap, afterHoldings, afterSnap) {
  const changes = diffHoldingsSnapshots(beforeHoldings, afterHoldings);
  if (!changes.length) return;
  const log = loadAssetChangelog();
  log.unshift({
    ts: nowDateTimeStr(), source, changes,
    beforeValue: beforeSnap.totalValue, afterValue: afterSnap.totalValue,
    beforeByAccount: beforeSnap.byAccount, afterByAccount: afterSnap.byAccount,
  });
  localStorage.setItem(MY_ASSETS_CHANGELOG_KEY, JSON.stringify(log.slice(0, 300)));
  // 이 시점에는 이미 renderMyAssets()가 끝나 "변동이력" 탭 DOM이 새로 그려진 뒤라(그때는 아직
  // localStorage에 안 쓴 상태) 탭 내용만 다시 채워준다 — 안 보이는 탭이면 그냥 조용히 무시.
  const body = document.getElementById("myChangelogBody");
  const sel = document.getElementById("myChangelogGranularity");
  if (body && sel) body.innerHTML = buildChangelogHTML(sel.value);
}

function updateIncludeStocksBtn() {
  const btn = document.getElementById("myIncludeStocksBtn");
  if (!btn) return;
  const includeStocks = localStorage.getItem(MY_INCLUDE_STOCKS_KEY) !== "0";
  btn.textContent = includeStocks ? "🏢 일반종목: 포함" : "🏢 일반종목: 제외";
  btn.title = "국내 개별 상장주식(삼성전자·SK하이닉스 등) 보유분을 평가액·목표 계산에 포함할지 전환합니다.";
}

/* 🔄 최신시세 — 장중 30분 주기 GitHub Actions가 live 브랜치에 올린 국내 현재가.
   정적 사이트라 진짜 실시간은 아니고, GitHub 무료 스케줄 큐 혼잡으로 실행이 수 시간까지
   지연되거나 일부 주기는 아예 건너뛸 수 있다(2026-07-06~10 실측으로 확인됨).
   실패하면 조용히 주간 수집 종가로 폴백한다(값을 지어내지 않음). */


function updateLiveQuotesBtn() {
  const btn = document.getElementById("myLiveQuotesBtn");
  if (!btn) return;
  const on = liveQuotesEnabled();
  btn.textContent = on ? "🔄 최신시세: 켬" : "🔄 최신시세: 끔";
  btn.title = "켜면 국내 종목 현재가를 장중 30분 주기 수집분(있을 때)으로 바꿔 계산합니다. GitHub 무료 스케줄 큐 혼잡으로 수 시간까지 지연되거나 일부 주기는 건너뛸 수 있고, 실패 시 주간 수집 종가로 자동 폴백합니다.";
  const nowBtn = document.getElementById("myLiveQuotesNowBtn");
  if (nowBtn) nowBtn.style.display = on ? "" : "none";
  const statusEl = document.getElementById("myLiveQuotesTimeStatus");
  if (statusEl && !on) statusEl.textContent = "";
}


function addMyAssetRow(a = {}) {
  const row = document.createElement("div");
  row.className = "portfolio-row";
  row.innerHTML = `
    <select class="my-account" aria-label="계좌 구분">${accountOptionsHTML(a.account)}</select>
    <select class="my-symbol portfolio-symbol" aria-label="종목 선택">${etfOptionsHTML(a.symbol)}</select>
    <div class="portfolio-weight-wrap">
      <input type="number" class="my-qty portfolio-weight" style="width:90px" min="0" step="1" value="${a.qty ?? ""}" placeholder="수량"> 주
    </div>
    <div class="portfolio-weight-wrap">
      <input type="number" class="my-avg portfolio-weight" style="width:110px" min="0" step="0.01" value="${a.avgPrice ?? ""}" placeholder="매입단가(선택)">
    </div>
    <div class="portfolio-weight-wrap">
      <input type="number" class="my-monthly portfolio-weight" style="width:80px" min="0" step="1" value="${a.monthlyQty ?? ""}" placeholder="1회매수(선택)"> 주×
    </div>
    <select class="my-buy-freq" aria-label="매수주기">
      <option value="매월" ${!a.buyFreq || a.buyFreq === "매월" ? "selected" : ""}>매월(1회)</option>
      <option value="매주" ${a.buyFreq === "매주" ? "selected" : ""}>매주(4회)</option>
      <option value="매일" ${a.buyFreq === "매일" ? "selected" : ""}>매일(22회)</option>
    </select>
    <input type="text" class="my-buy-day portfolio-weight" style="width:64px" value="${a.buyDay ?? ""}" placeholder="요일/일" aria-label="매수 요일 또는 일자(표시용)">
    <div class="portfolio-weight-wrap">
      <input type="number" class="my-confirmed portfolio-weight" style="width:130px" min="0" step="1" value="${a.confirmedDps ?? ""}" placeholder="확정 DPS(원/주,선택)">
    </div>
    <select class="my-period" aria-label="지급시기">
      <option value="" ${!a.payPeriod ? "selected" : ""}>지급시기</option>
      <option value="월초" ${a.payPeriod === "월초" ? "selected" : ""}>월초</option>
      <option value="월중" ${a.payPeriod === "월중" ? "selected" : ""}>월중</option>
      <option value="월말" ${a.payPeriod === "월말" ? "selected" : ""}>월말</option>
    </select>
    <button type="button" class="portfolio-remove" aria-label="종목 제거">×</button>
  `;
  // 배당 유형(실확/특별/고정)·특별배당 만료일 — 노션 SOP 메타데이터라 입력칸 없이 행에 보존만
  row.dataset.divType = a.divType || "";
  row.dataset.divExpiry = a.divExpiry || "";
  document.getElementById("myAssetRows").appendChild(row);
  const onChange = () => { saveMyAssets(); renderMyAssets(); };
  row.querySelectorAll("select, input").forEach((el) =>
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", onChange));
  row.querySelector(".portfolio-remove").addEventListener("click", () => { row.remove(); onChange(); });
}

function serializeMyAssets() {
  return {
    rows: [...document.querySelectorAll("#myAssetRows .portfolio-row")].map((el) => ({
      account: el.querySelector(".my-account").value,
      symbol: el.querySelector(".my-symbol").value,
      qty: parseFloat(el.querySelector(".my-qty").value) || 0,
      avgPrice: parseFloat(el.querySelector(".my-avg").value) || 0,
      monthlyQty: parseFloat(el.querySelector(".my-monthly").value) || 0,
      buyFreq: el.querySelector(".my-buy-freq").value,
      buyDay: el.querySelector(".my-buy-day").value.trim(),
      confirmedDps: parseFloat(el.querySelector(".my-confirmed").value) || 0,
      payPeriod: el.querySelector(".my-period").value,
      divType: el.dataset.divType || "",
      divExpiry: el.dataset.divExpiry || "",
    })),
    // 입력칸은 만원 단위로 받고(예: 20000 = 2억원), 저장/계산은 항상 원 단위로 통일
    goalAmount: (() => {
      const manwon = parseFloat(document.getElementById("myGoalAmount").value);
      return manwon > 0 ? Math.round(manwon * 10000) : "";
    })(),
    expectedReturn: document.getElementById("myExpectedReturn").value,
    returnMode: document.getElementById("myReturnMode").value,
    livingExpense: parseFloat(document.getElementById("myLivingExpense").value) || 0,
    inflationOn: document.getElementById("myInflationOn") ? document.getElementById("myInflationOn").checked : false,
    inflationRate: document.getElementById("myInflationRate") ? document.getElementById("myInflationRate").value : "",
    contributions: serializeMyContributions(),
    dataAsOf: state.myAssetsDataAsOf || "",
    importedAt: state.myAssetsImportedAt || "",
    divHistory: state.myAssetsDivHistory || {},
    // A8: 이력 3종을 내보내기에 포함 — 앱 삭제·재설치 후 "가져오기" 한 번으로 이력까지 복원
    snapshotHistory: (() => { try { return JSON.parse(localStorage.getItem(MY_ASSETS_HISTORY_KEY) || "[]"); } catch (e) { return []; } })(),
    dailyHistory: (() => { try { return JSON.parse(localStorage.getItem(MY_ASSETS_DAILY_HISTORY_KEY) || "[]"); } catch (e) { return []; } })(),
    changelog: (() => { try { return JSON.parse(localStorage.getItem(MY_ASSETS_CHANGELOG_KEY) || "[]"); } catch (e) { return []; } })(),
    watchlist: (() => { try { return JSON.parse(localStorage.getItem(MY_ASSETS_WATCHLIST_KEY) || "[]"); } catch (e) { return []; } })(),
  };
}

function saveMyAssets() {
  localStorage.setItem(MY_ASSETS_KEY, JSON.stringify(serializeMyAssets()));
  // A11c: 네이티브(APK)에서 데이터 변경 시 백업 파일 자동 갱신(비네이티브 no-op)
  if (typeof window.autoBackupMyAssets === "function") window.autoBackupMyAssets();
}

/* 목표 도달 수익률 방식(통합 직접입력 / 종목별 실적) 전환 시 관련 UI 표시만 토글 */
function updateReturnModeUI() {
  const modeEl = document.getElementById("myReturnMode");
  const wrapEl = document.getElementById("myExpectedReturnWrap");
  const hintEl = document.getElementById("myReturnModeHint");
  if (!modeEl || !wrapEl || !hintEl) return;
  const manual = modeEl.value === "manual";
  wrapEl.style.display = manual ? "" : "none";
  hintEl.style.display = manual ? "none" : "";
}

/* 물가상승률 반영 체크박스 on/off에 따라 %입력칸 표시만 토글 */
function updateInflationUI() {
  const onEl = document.getElementById("myInflationOn");
  const wrapEl = document.getElementById("myInflationRateWrap");
  if (!onEl || !wrapEl) return;
  wrapEl.style.display = onEl.checked ? "" : "none";
}

/* 내 자산 종목 목록이 길어지면(6행 초과) 기본 접어서 스크롤을 줄인다 — 입력값은 그대로 유지, 시각적으로만 숨김 */
function updateMyRowsCollapseUI() {
  const wrap = document.getElementById("myAssetRowsWrap");
  const btn = document.getElementById("myRowsToggleBtn");
  if (!wrap || !btn) return;
  const n = wrap.querySelectorAll(".portfolio-row").length;
  if (n <= 6) {
    wrap.classList.remove("collapsed");
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  if (!wrap.dataset.userExpanded) wrap.classList.add("collapsed");
  btn.textContent = wrap.classList.contains("collapsed") ? `▼ 전체 종목 보기 (${n}개)` : "▲ 목록 접기";
}

/* "내 자산" 불러온 데이터의 기준일·불러온 시각을 표시 — 추측 없이 있는 값만 보여줌 */
function updateMyAssetsVersionBadge() {
  const el = document.getElementById("myAssetVersionBadge");
  if (!el) return;
  const parts = [];
  if (state.myAssetsDataAsOf) parts.push(`📅 데이터 기준일: ${state.myAssetsDataAsOf}`);
  if (state.myAssetsImportedAt) parts.push(`마지막 불러오기: ${state.myAssetsImportedAt}`);
  if (!parts.length) { el.style.display = "none"; return; }
  el.style.display = "";
  el.textContent = parts.join(" · ");
}

function applyMyAssets(data) {
  if (!data || !Array.isArray(data.rows)) return false;
  state.myContribSeed = data.contributions || {};
  state.myContribAccounts = null; // 계좌 구성이 바뀌었을 수 있으니 다음 렌더에서 강제로 다시 빌드
  state.myAssetsDataAsOf = data.dataAsOf || state.myAssetsDataAsOf || "";
  state.myAssetsImportedAt = data.importedAt || state.myAssetsImportedAt || "";
  state.myAssetsDivHistory = data.divHistory || state.myAssetsDivHistory || {};
  // A8: 가져오기 파일에 이력이 있으면 localStorage에 복원(없으면 기존 이력 유지 — 하위호환)
  if (Array.isArray(data.snapshotHistory) && data.snapshotHistory.length) localStorage.setItem(MY_ASSETS_HISTORY_KEY, JSON.stringify(data.snapshotHistory));
  if (Array.isArray(data.dailyHistory) && data.dailyHistory.length) localStorage.setItem(MY_ASSETS_DAILY_HISTORY_KEY, JSON.stringify(data.dailyHistory));
  if (Array.isArray(data.changelog) && data.changelog.length) localStorage.setItem(MY_ASSETS_CHANGELOG_KEY, JSON.stringify(data.changelog.slice(0, 300)));
  if (Array.isArray(data.watchlist) && data.watchlist.length) localStorage.setItem(MY_ASSETS_WATCHLIST_KEY, JSON.stringify(data.watchlist));
  document.getElementById("myAssetRows").innerHTML = "";
  for (const r of data.rows) {
    // 구버전(확정 월배당 총액) 데이터는 주당 DPS로 1회 변환
    if (!r.confirmedDps && r.confirmedMonthlyDiv > 0 && r.qty > 0) {
      r.confirmedDps = Math.round(r.confirmedMonthlyDiv / r.qty);
    }
    addMyAssetRow(r);
  }
  // 저장값은 원 단위 — 입력칸엔 만원 단위로 환산해서 채운다
  document.getElementById("myGoalAmount").value = data.goalAmount > 0 ? Math.round(Number(data.goalAmount) / 10000) : "";
  document.getElementById("myExpectedReturn").value = data.expectedReturn || "";
  document.getElementById("myReturnMode").value = data.returnMode || "manual";
  document.getElementById("myLivingExpense").value = data.livingExpense || "";
  if (document.getElementById("myInflationOn")) document.getElementById("myInflationOn").checked = !!data.inflationOn;
  if (document.getElementById("myInflationRate") && data.inflationRate) document.getElementById("myInflationRate").value = data.inflationRate;
  updateInflationUI();
  updateReturnModeUI();
  syncMyContribRows();
  return true;
}

/* 계좌별 월 납입금(연금저축 등) — 종목행과 별개로 계좌 단위 입력.
   계좌 구성이 실제로 바뀔 때만 입력칸을 다시 만들어(포커스 보존) 타이핑 중 재생성되지 않게 한다. */
function syncMyContribRows() {
  const accounts = [...new Set(
    [...document.querySelectorAll("#myAssetRows .my-account")].map((el) => el.value).filter(Boolean)
  )];
  const label = document.getElementById("myContribLabel");
  label.style.display = accounts.length ? "" : "none";

  const prevKey = (state.myContribAccounts || []).join("|");
  const newKey = accounts.join("|");
  if (prevKey === newKey) return;
  state.myContribAccounts = accounts;

  const existing = new Map(
    [...document.querySelectorAll("#myContribRows .my-contrib")].map((el) => [el.dataset.account, el.value])
  );
  const seed = state.myContribSeed || {};
  const container = document.getElementById("myContribRows");
  container.innerHTML = accounts.map((acc) => {
    const val = existing.has(acc) ? existing.get(acc) : (seed[acc] ?? "");
    return `<div class="portfolio-weight-wrap">
      <input type="number" class="my-contrib portfolio-weight" style="width:150px" min="0" step="10000" data-account="${acc}" value="${val}" placeholder="${acc} 월납입(만원단위,선택)">
    </div>`;
  }).join("");
  container.querySelectorAll(".my-contrib").forEach((el) =>
    el.addEventListener("input", () => { saveMyAssets(); renderMyAssets(); }));
}

function serializeMyContributions() {
  const map = {};
  document.querySelectorAll("#myContribRows .my-contrib").forEach((el) => {
    const v = parseFloat(el.value) || 0;
    if (v > 0) map[el.dataset.account] = v;
  });
  return map;
}

/* 대시보드 탭 전환 — renderMyAssets()가 7개 패널을 전부 만들어 DOM에 넣어두면
   이 함수는 숨김/표시만 담당한다(재계산 없음). */
function showMyDashTab(id) {
  state.myDashTab = id;
  document.querySelectorAll("#myAssetResult .dash-panel").forEach((p) => {
    p.hidden = p.dataset.tab !== id;
  });
  document.querySelectorAll("#myDashTabs .dash-tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === id);
  });
}

/* 수익률 분석 — ① 스냅샷 이력 기반 전체 자산 변동, ② 지역별 수익률(매입단가 입력분),
   ③ 배당수익률(계좌별), ④ 배당수익률(지역·스타일 비중별) */
function buildReturnAnalysisHTML(regionRetMap, styleRetMap, accountMap, history) {
  const fmtW = (v) => fmtPrice(v, "KRW");

  let historyReturnHTML = `<p class="compare-empty">"추이" 탭에서 월별 스냅샷을 2개월 이상 저장하면 기간 자산 변동률을 계산합니다.</p>`;
  if (history.length >= 2) {
    const sorted = history.slice().sort((a, b) => a.month.localeCompare(b.month));
    const first = sorted[0], last = sorted[sorted.length - 1];
    const diff = last.value - first.value;
    const pct = first.value > 0 ? (diff / first.value) * 100 : 0;
    historyReturnHTML = `<div class="stat-row">
      <div class="stat">
        <p class="stat-label">평가액 변동 (${first.month} → ${last.month})</p>
        <p class="stat-value" style="color:${diff >= 0 ? "var(--good)" : "var(--critical)"}">${diff >= 0 ? "+" : ""}${fmtW(diff)} (${pct.toFixed(1)}%)</p>
        <p class="stat-sub">${fmtW(first.value)} → ${fmtW(last.value)}</p>
      </div>
    </div>
    <p class="stat-sub">참고: 스냅샷 시점 평가액을 단순 비교한 값입니다(추가 납입·매도 등 현금흐름은 반영하지 않음) — 정확한 수익률은 매입단가 기준 손익을 참고하세요.</p>`;
  }

  const REGION_ORDER = ["한국", "미국", "글로벌", "미분류"];
  const regionReturnRows = REGION_ORDER.filter((r) => regionRetMap.has(r)).map((r) => {
    const g = regionRetMap.get(r);
    const profit = g.cost > 0 ? g.costedValue - g.cost : null;
    const pct = g.cost > 0 ? (profit / g.cost) * 100 : null;
    return `<tr><td>${r}</td><td>${fmtW(g.value)}</td>
      <td style="color:${profit == null ? "var(--text-muted)" : profit >= 0 ? "var(--good)" : "var(--critical)"}">${profit == null ? "매입단가 미입력" : `${profit >= 0 ? "+" : ""}${fmtW(profit)} (${pct.toFixed(1)}%)`}</td></tr>`;
  }).join("");

  // 시가배당률 = 연배당 ÷ 평가액(현재가·"최신시세" 켜져있으면 실시간 조회가 기준)
  // 투자배당률(YOC) = 연배당 ÷ 매입원가 — 매입단가 입력분에서만 계산 가능
  const marketYield = (div, value) => value > 0 ? (div * 12 / value) * 100 : 0;
  const costYield = (div, cost) => cost > 0 ? (div * 12 / cost) * 100 : null;

  const accountYieldEntries = [...accountMap.entries()].filter(([, g]) => g.value > 0)
    .sort((a, b) => marketYield(b[1].monthlyDiv, b[1].value) - marketYield(a[1].monthlyDiv, a[1].value));
  const accountYieldRows = accountYieldEntries.map(([acc, g]) => {
    const cy = costYield(g.monthlyDiv, g.cost);
    return `<tr><td>${acc}</td><td>${fmtW(g.value)}</td><td>${g.monthlyDiv > 0 ? fmtW(g.monthlyDiv) : "—"}</td>
      <td>${marketYield(g.monthlyDiv, g.value).toFixed(2)}%</td><td>${cy == null ? "매입단가 미입력" : cy.toFixed(2) + "%"}</td></tr>`;
  }).join("");

  const STYLE_ORDER = ["성장", "배당", "안전", "개별주", "미분류"];
  const weightYieldRows = [
    ...REGION_ORDER.filter((r) => regionRetMap.has(r)).map((r) => [r, regionRetMap.get(r)]),
    ...STYLE_ORDER.filter((s) => styleRetMap.has(s)).map((s) => [s, styleRetMap.get(s)]),
  ].map(([label, g]) => {
    const cy = costYield(g.div, g.cost);
    return `<tr><td>${label}</td><td>${fmtW(g.value)}</td><td>${g.div > 0 ? fmtW(g.div) : "—"}</td>
      <td>${marketYield(g.div, g.value).toFixed(2)}%</td><td>${cy == null ? "매입단가 미입력" : cy.toFixed(2) + "%"}</td></tr>`;
  }).join("");

  return `<p class="chart-title" style="margin-top:20px;">📈 자산 수익률</p>
    ${historyReturnHTML}

    <p class="chart-title" style="margin-top:20px;">🌍 지역별 수익률 (매입단가 입력분 기준)</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>투자대상 시장</th><th>평가액</th><th>손익</th></tr></thead>
      <tbody>${regionReturnRows}</tbody>
    </table>
    </div>

    <p class="chart-title" style="margin-top:20px;">💰 배당수익률 (계좌별, 연환산)</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>계좌</th><th>평가액</th><th>월배당</th><th>시가배당률</th><th>투자배당률(매입원가 기준)</th></tr></thead>
      <tbody>${accountYieldRows}</tbody>
    </table>
    </div>

    <p class="chart-title" style="margin-top:20px;">💰 배당수익률 (비중별: 지역·스타일, 연환산)</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>구분</th><th>평가액</th><th>월배당</th><th>시가배당률</th><th>투자배당률(매입원가 기준)</th></tr></thead>
      <tbody>${weightYieldRows}</tbody>
    </table>
    </div>
    <p class="stat-sub" style="margin-top:6px;">시가배당률 = 연배당 ÷ 평가액(현재 조회 주가 기준 — "🔄 최신시세" 켜면 실시간 조회가로 계산). 투자배당률(YOC) = 연배당 ÷ 매입원가(매입단가 입력분만).</p>`;
}

/* ---------- A7: 🗺️ 비중 트리맵 히트맵 (finviz류) ----------
   사각형 크기 = 평가액 비중, 색 = 등락률(한국 관례: 상승 빨강·하락 파랑),
   그룹(카테고리/계좌/지역/스타일) 먼저 트리맵으로 나눈 뒤 그룹 안에서 종목을 다시 분할.
   기존 균일 그리드 히트맵(색=계좌 고정, 수익률 정보 없음)을 대체. */
const TREEMAP_GROUP_FIELDS = {
  category: (p) => (p.meta && p.meta.category) || "기타",
  account: (p) => p.account || "계좌 미지정",
  region: (p) => (p.meta && p.meta.region) || "미분류",
  style: (p) => (p.meta && p.meta.style) || "미분류",
};

/* 등락률 — 라이브 시세가 적용됐으면 라이브가 vs 마지막 수집 종가, 아니면 마지막 두
   수집 종가 간 변화. 주가 수집이 주 1회라 "일간" 등락이 아닐 수 있음(화면 문구로 명시). */
function lastChangePct(p) {
  const closes = p.full && p.full.closes;
  if (!closes || closes.length < 2) return null;
  const lastStored = closes[closes.length - 1];
  if (p.close !== lastStored) return p.close / lastStored - 1;
  return lastStored / closes[closes.length - 2] - 1;
}

function changeColorClass(chg) {
  if (chg == null) return "tm-flat";
  const a = Math.abs(chg) * 100;
  if (a < 0.25) return "tm-flat";
  const lv = a < 1 ? 1 : a < 2 ? 2 : a < 3 ? 3 : 4;
  return (chg > 0 ? "tm-up" : "tm-dn") + lv;
}

function buildTreemapHTML(perRow, groupBy) {
  const keyFn = TREEMAP_GROUP_FIELDS[groupBy] || TREEMAP_GROUP_FIELDS.category;
  const groups = new Map();
  for (const p of perRow) {
    if (p.value <= 0) continue;
    const k = keyFn(p);
    if (!groups.has(k)) groups.set(k, { key: k, value: 0, items: [] });
    const g = groups.get(k);
    g.value += p.value;
    g.items.push(p);
  }
  const glist = [...groups.values()].sort((a, b) => b.value - a.value);
  if (!glist.length) return `<p class="compare-empty">표시할 보유 종목이 없습니다 — 수량을 입력하면 트리맵이 그려집니다.</p>`;
  const total = glist.reduce((a, g) => a + g.value, 0);
  const grects = squarify(glist, 0, 0, 100, 100);
  const fmtW = (v) => fmtPrice(v, "KRW");
  let html = "";
  glist.forEach((g, gi) => {
    const gr = grects[gi];
    const items = g.items.slice().sort((a, b) => b.value - a.value);
    const irects = squarify(items, 0, 0, 100, 100);
    const cells = items.map((p, ii) => {
      const r = irects[ii];
      const chg = lastChangePct(p);
      const label = p.meta ? p.meta.name : p.symbol;
      const pct = total > 0 ? (p.value / total) * 100 : 0;
      const chgText = chg == null ? "—" : `${chg >= 0 ? "+" : ""}${(chg * 100).toFixed(2)}%`;
      return `<div class="tm-cell ${changeColorClass(chg)}" style="left:${r.x.toFixed(3)}%;top:${r.y.toFixed(3)}%;width:${r.w.toFixed(3)}%;height:${r.h.toFixed(3)}%;" title="${label} · ${fmtW(p.value)} · 비중 ${pct.toFixed(1)}% · 등락 ${chgText}">
        <div class="hm-name">${label}</div>
        <div class="hm-val">${chgText}</div>
        <div class="hm-sub">${pct.toFixed(1)}%</div>
      </div>`;
    }).join("");
    html += `<div class="tm-group" style="left:${gr.x.toFixed(3)}%;top:${gr.y.toFixed(3)}%;width:${gr.w.toFixed(3)}%;height:${gr.h.toFixed(3)}%;">
      <div class="tm-group-label">${g.key} <span>${((g.value / total) * 100).toFixed(1)}%</span></div>
      <div class="tm-group-body">${cells}</div>
    </div>`;
  });
  return `<div class="treemap">${html}</div>`;
}

/* 배당기준·이력 — 확정/추정 DPS, 다음달 기대월배당(배당률×현재가), 배당상승률(직전 스냅샷 대비) */
function buildDividendBasisHTML(perRow, history) {
  const fmtW = (v) => fmtPrice(v, "KRW");
  // 직전 스냅샷(가장 최근 저장분) 대비 현재(라이브) 확정 DPS 증감률 — 1회 이상 스냅샷이 있으면 비교 가능
  const prevSnap = history.length >= 1 ? history[history.length - 1] : null;
  const rowsHTML = perRow.map((p) => {
    const ttm = p.meta && p.meta.ttmDividend ? p.meta.ttmDividend : 0;
    const ttmMonthly = ttm / 12;
    const curDps = p.usedConfirmed ? p.confirmedDps : ttmMonthly;
    const dpsLabel = curDps > 0
      ? `${p.isUsd && !p.usedConfirmed ? "$" + curDps.toFixed(4) : fmtW(curDps)} <span style="color:${p.usedConfirmed ? "var(--good)" : "var(--text-muted)"}; font-size:11px;">${p.usedConfirmed ? "확정" : "추정(TTM)"}</span>`
      : "—";
    const nextLabel = p.nextMonthDiv > 0 ? fmtW(p.nextMonthDiv / p.qty) : "—";
    let growthLabel = "이력 부족";
    if (prevSnap && prevSnap.dpsBySymbol && prevSnap.dpsBySymbol[p.symbol] > 0 && p.usedConfirmed) {
      const prevDps = prevSnap.dpsBySymbol[p.symbol];
      const growth = (p.confirmedDps - prevDps) / prevDps;
      growthLabel = `<span style="color:${growth >= 0 ? "var(--good)" : "var(--critical)"}">${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%</span>`;
    }
    const typeLabel = p.divType
      ? `<span style="color:${p.divType === "특별" ? "var(--critical)" : p.divType === "고정" ? "var(--series-price)" : "var(--good)"}; font-weight:600;">${p.divType}</span>`
      : "—";
    const expiryLabel = p.divExpiry && p.divExpiry !== "-"
      ? `<span style="color:var(--critical); font-weight:600;">⚠️ ${p.divExpiry}</span>`
      : "—";
    return `<tr>
      <td style="text-align:left;">${p.meta ? p.meta.name : p.symbol}</td>
      <td>${p.symbol}</td>
      <td>${typeLabel}</td>
      <td>${p.payPeriod || "—"}</td>
      <td>${dpsLabel}</td>
      <td>${nextLabel}</td>
      <td>${growthLabel}</td>
      <td>${expiryLabel}</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>종목</th><th>코드</th><th>유형</th><th>지급시기</th><th>DPS(주당,월)</th><th>다음달 기대(주당)</th><th>배당상승률</th><th>특별만료</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>
    </div>
    <p class="stat-sub" style="margin-top:8px;">유형(실확/특별/고정)·특별만료는 노션 배당기준 마스터 기준입니다. 특별만료가 있는 종목은 만료 후 배당이 줄어들 수 있습니다. 다음달 기대는 현재가×등록 배당률÷12(참고치), 배당상승률은 "📸 이번 달 스냅샷 저장" 후 표시됩니다.</p>`;
}

/* 자급률 — 계좌별 수입(배당+납입금) vs 매수(매수주기 반영) 비교 + 조절 안내 */
function buildSelfSuffHTML(accountMap, contributions) {
  const fmtW = (v) => fmtPrice(v, "KRW");
  const rowsHTML = [...accountMap.entries()].map(([acc, g]) => {
    const income = g.monthlyDiv + (contributions[acc] || 0);
    const diff = income - g.monthlyBuy;
    const rate = g.monthlyBuy > 0 ? income / g.monthlyBuy : null;
    const status = g.monthlyBuy === 0 ? "—" : diff >= 0 ? "✅ 수입≥매수" : "❌ 매수>수입";
    const advice = g.monthlyBuy === 0 ? "월매수 미설정"
      : diff >= 0 ? `여유 ${fmtW(diff)}`
      : `월매수를 ${fmtW(-diff)} 줄이면 자급률 100%`;
    return `<tr>
      <td>${acc}</td>
      <td>${fmtW(income)}${contributions[acc] ? ` <span style="color:var(--text-muted); font-size:11px;">(납입 ${fmtW(contributions[acc])} 포함)</span>` : ""}</td>
      <td>${g.monthlyBuy > 0 ? fmtW(g.monthlyBuy) : "—"}</td>
      <td style="color:${diff >= 0 ? "var(--good)" : "var(--critical)"}">${g.monthlyBuy > 0 ? (diff >= 0 ? "+" : "") + fmtW(diff) : "—"}</td>
      <td>${rate != null ? (rate * 100).toFixed(1) + "%" : "—"}</td>
      <td>${status}</td>
      <td style="text-align:left; font-size:12px; color:var(--text-muted);">${advice}</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>계좌</th><th>수입(배당+납입)</th><th>매수</th><th>차액</th><th>자급률</th><th>상태</th><th>조절 안내</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>
    </div>`;
}

/* ETF모으기·월매수 — 계좌별 매수계획 상세 표(시트의 ETF모으기 탭과 동일 구성) */
function buildBuyPlanHTML(perRow) {
  const fmtW = (v) => fmtPrice(v, "KRW");
  const buyRows = perRow.filter((p) => p.monthlyQty > 0);
  if (!buyRows.length) return `<p class="compare-empty">종목 줄에 "1회매수 수량"과 매수주기를 입력하면 계좌별 매수계획이 여기 표시됩니다.</p>`;
  const byAccount = new Map();
  for (const p of buyRows) {
    const acc = p.account || "계좌 미지정";
    if (!byAccount.has(acc)) byAccount.set(acc, []);
    byAccount.get(acc).push(p);
  }
  return [...byAccount.entries()].map(([acc, list]) => {
    let subtotal = 0;
    const rows = list.map((p) => {
      const times = BUY_FREQ_TIMES[p.buyFreq] || 1;
      const onceKrw = p.monthlyBuy / times;
      subtotal += p.monthlyBuy;
      const freqLabel = p.buyDay ? `${p.buyFreq}/${p.buyDay}` : p.buyFreq;
      return `<tr>
        <td style="text-align:left;">${p.meta ? p.meta.name : p.symbol}</td>
        <td>${freqLabel}</td>
        <td>${p.monthlyQty.toLocaleString()}</td>
        <td>${fmtW(onceKrw)}</td>
        <td>${times}</td>
        <td>${fmtW(p.monthlyBuy)}</td>
      </tr>`;
    }).join("");
    return `<p class="hm-account-title">${acc} <span style="color:var(--text-muted); font-weight:400;">— 월매수 합계 ${fmtW(subtotal)}</span></p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>종목</th><th>매수주기</th><th>1회수량</th><th>1회매수액</th><th>월횟수</th><th>월매수액</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
  }).join("");
}

/* 연도별 배당추이 — divHistory("YYYY-MM": 원) 확정치를 연도×12개월 표로 */
function buildYearlyDivHTML(divHistory) {
  const keys = Object.keys(divHistory || {}).filter((k) => /^\d{4}-\d{2}$/.test(k) && divHistory[k] > 0);
  if (!keys.length) return "";
  const fmtW = (v) => fmtPrice(v, "KRW");
  const years = [...new Set(keys.map((k) => k.slice(0, 4)))].sort();
  const nowMonth = todayStr().slice(0, 7);
  const rows = years.map((y) => {
    const cells = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const v = divHistory[key];
      if (v > 0) cells.push(`<td style="font-weight:600;">${fmtW(v)}</td>`);
      else if (key > nowMonth) cells.push(`<td style="color:var(--text-muted);">예정</td>`);
      else cells.push(`<td style="color:var(--text-muted);">—</td>`);
    }
    return `<tr><td>${y}</td>${cells.join("")}</tr>`;
  }).join("");
  // 전월 대비(확정치가 연속 2개 이상일 때)
  const sorted = keys.sort();
  let momHTML = "";
  if (sorted.length >= 2) {
    const last = sorted[sorted.length - 1], prev = sorted[sorted.length - 2];
    const diff = divHistory[last] - divHistory[prev];
    const pct = (diff / divHistory[prev]) * 100;
    momHTML = `<p class="stat-sub" style="margin-top:6px;">최근 확정 ${last}: <b>${fmtW(divHistory[last])}</b> (직전 ${prev} 대비 <span style="color:${diff >= 0 ? "var(--good)" : "var(--critical)"}">${diff >= 0 ? "+" : ""}${fmtW(diff)}, ${pct.toFixed(1)}%</span>)</p>`;
  }
  return `<p class="chart-title" style="margin-top:20px;">📅 연도별 확정 월배당 (가져온 이력 기준)</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>연도</th><th>1월</th><th>2월</th><th>3월</th><th>4월</th><th>5월</th><th>6월</th><th>7월</th><th>8월</th><th>9월</th><th>10월</th><th>11월</th><th>12월</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>${momHTML}`;
}

/* 일별 자산변동 캡처 이력 테이블 — "오늘 자산 스냅샷" 버튼으로 쌓은 이력을 최근순으로 표시 */
function buildDailyAssetHTML(dailyHistory) {
  if (!dailyHistory.length) {
    return `<p class="compare-empty">"오늘 자산 스냅샷" 버튼을 매일 눌러두면 일별 평가액·월배당 변동이 여기 쌓입니다. 이 사이트는 정적 페이지라 자동 캡처는 불가능하니(서버가 없어 매일 자동 실행할 수 없음), 확인할 때마다 직접 눌러야 이력이 쌓입니다.</p>`;
  }
  const fmtW = (v) => fmtPrice(v, "KRW");
  const sorted = dailyHistory.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  const rows = sorted.map((h, i) => {
    const prev = sorted[i + 1];
    const diff = prev ? h.value - prev.value : null;
    return `<tr>
      <td>${h.date}</td><td>${fmtW(h.value)}</td>
      <td style="color:${diff == null ? "var(--text-muted)" : diff >= 0 ? "var(--good)" : "var(--critical)"}">${diff == null ? "—" : (diff >= 0 ? "+" : "") + fmtW(diff)}</td>
      <td>${h.monthlyDiv > 0 ? fmtW(h.monthlyDiv) : "—"}</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>날짜</th><th>평가액</th><th>전일 대비</th><th>월배당(그 시점)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <p class="stat-sub" style="margin-top:6px;">최근 ${sorted.length}일 기록(총 ${dailyHistory.length}일 캡처됨).</p>`;
}

/* ISO 주(월요일 시작) 기준 "YYYY-Www" 키로 일별 이력을 묶어 주간 평균 변동을 보여줌 */
function buildWeeklyAssetHTML(dailyHistory) {
  if (dailyHistory.length < 2) {
    return `<p class="compare-empty">일별 캡처가 최소 2건 이상 쌓이면(서로 다른 주) 주간 자산변동을 계산할 수 있습니다. 현재 ${dailyHistory.length}일 기록됨.</p>`;
  }
  const isoWeekKey = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = (d.getUTCDay() + 6) % 7; // 월=0 ... 일=6
    d.setUTCDate(d.getUTCDate() - day + 3); // 그 주의 목요일로 이동(ISO 주 규칙)
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  };
  const byWeek = new Map();
  for (const h of dailyHistory.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    byWeek.set(isoWeekKey(h.date), h); // 그 주의 마지막 기록으로 덮어씀
  }
  const weeks = [...byWeek.entries()];
  const fmtW = (v) => fmtPrice(v, "KRW");
  const rows = weeks.map(([wk, h], i) => {
    const prev = weeks[i - 1];
    const diff = prev ? h.value - prev[1].value : null;
    const pct = prev && prev[1].value > 0 ? (diff / prev[1].value) * 100 : null;
    return `<tr>
      <td>${wk}</td><td>${h.date}</td><td>${fmtW(h.value)}</td>
      <td style="color:${diff == null ? "var(--text-muted)" : diff >= 0 ? "var(--good)" : "var(--critical)"}">${diff == null ? "—" : `${diff >= 0 ? "+" : ""}${fmtW(diff)} (${pct.toFixed(2)}%)`}</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>주(ISO)</th><th>기준일</th><th>평가액</th><th>전주 대비</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

/* 월별 스냅샷(MY_ASSETS_HISTORY_KEY)을 일별·주간·연간과 같은 표 형식으로 보여줌 */
function buildMonthlyAssetHTML(monthlyHistory) {
  if (!monthlyHistory.length) {
    return `<p class="compare-empty">"이번 달 스냅샷 저장" 버튼을 매달 눌러두면 월별 평가액·월배당 변동이 여기 쌓입니다(현재 0개월 기록).</p>`;
  }
  const fmtW = (v) => fmtPrice(v, "KRW");
  const sorted = monthlyHistory.slice().sort((a, b) => b.month.localeCompare(a.month));
  const rows = sorted.map((h, i) => {
    const prev = sorted[i + 1];
    const diff = prev ? h.value - prev.value : null;
    const pct = prev && prev.value > 0 ? (diff / prev.value) * 100 : null;
    return `<tr>
      <td>${h.month}</td><td>${fmtW(h.value)}</td>
      <td style="color:${diff == null ? "var(--text-muted)" : diff >= 0 ? "var(--good)" : "var(--critical)"}">${diff == null ? "—" : `${diff >= 0 ? "+" : ""}${fmtW(diff)} (${pct.toFixed(2)}%)`}</td>
      <td>${h.monthlyDiv > 0 ? fmtW(h.monthlyDiv) : "—"}</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>월</th><th>평가액</th><th>전월 대비</th><th>월배당(그 시점)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <p class="stat-sub" style="margin-top:6px;">총 ${monthlyHistory.length}개월 기록됨("📸 이번 달 스냅샷 저장" 버튼으로 누적).</p>`;
}

/* 월별 스냅샷(MY_ASSETS_HISTORY_KEY)을 연도로 묶어 연초 대비 변동을 보여줌 */
function buildYearlyAssetHTML(monthlyHistory) {
  const byYear = new Map();
  for (const h of monthlyHistory) {
    const y = h.month.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(h);
  }
  const years = [...byYear.keys()].sort();
  if (!years.length) return `<p class="compare-empty">월별 스냅샷이 쌓이면 연간 자산변동을 계산할 수 있습니다.</p>`;
  const fmtW = (v) => fmtPrice(v, "KRW");
  const rows = years.map((y, i) => {
    const list = byYear.get(y).slice().sort((a, b) => a.month.localeCompare(b.month));
    const first = list[0], last = list[list.length - 1];
    const prevYear = i > 0 ? byYear.get(years[i - 1]) : null;
    const base = prevYear ? prevYear[prevYear.length - 1].value : first.value;
    const diff = last.value - base;
    const pct = base > 0 ? (diff / base) * 100 : 0;
    return `<tr>
      <td>${y}</td><td>${first.month} ~ ${last.month} (${list.length}개월)</td><td>${fmtW(last.value)}</td>
      <td style="color:${diff >= 0 ? "var(--good)" : "var(--critical)"}">${diff >= 0 ? "+" : ""}${fmtW(diff)} (${pct.toFixed(1)}%)</td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>연도</th><th>기록 범위</th><th>연말(최신) 평가액</th><th>전년 대비</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
}

/* ---------- A3c: 🗂️ 변동이력 탭 — MY_ASSETS_CHANGELOG_KEY(자동 기록)를 일/주/월/연 단위로
   묶어 자산변동·비중변동·종목변동을 한 번에 보여준다. 위 buildDailyAssetHTML류(수동 스냅샷)와
   달리, 이건 "폼에 채우기"/"가져오기"가 실제로 일어난 이벤트만 모은다. */
function changelogPeriodKey(ts, granularity) {
  const date = ts.slice(0, 10); // "YYYY-MM-DD HH:MM" → "YYYY-MM-DD"
  if (granularity === "daily") return date;
  if (granularity === "monthly") return date.slice(0, 7);
  if (granularity === "yearly") return date.slice(0, 4);
  // weekly: ISO 주(월요일 시작) 키
  const d = new Date(date + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const CHANGE_TYPE_LABEL = { added: "🆕 신규", removed: "🗑️ 삭제", "qty-changed": "🔁 수량변경" };
const CHANGE_SOURCE_LABEL = { "capture-account": "📸 계좌 캡처", "capture-buyplan": "📈 월매수 캡처", "capture-account-reset": "🆕 완전 신규 업데이트", import: "📂 가져오기" };

function buildChangelogHTML(granularity) {
  const log = loadAssetChangelog();
  if (!log.length) {
    return `<p class="compare-empty">계좌 캡처 "폼에 채우기" 또는 "가져오기"를 실행하면 그 변경 내역이 여기 자동으로 쌓입니다(최대 300건 보관). 수동 스냅샷과 달리 버튼을 따로 누를 필요가 없습니다.</p>`;
  }
  const fmtW = (v) => fmtPrice(v, "KRW");
  const byPeriod = new Map();
  // log는 최신순(unshift) — 기간별로 묶을 때는 시간순 정렬이 필요하므로 뒤집어서 순회
  for (const entry of log.slice().reverse()) {
    const key = changelogPeriodKey(entry.ts, granularity);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key).push(entry);
  }
  const periods = [...byPeriod.keys()].sort().reverse();
  const rows = periods.map((period) => {
    const entries = byPeriod.get(period); // 이 기간 내 시간순
    const first = entries[0], last = entries[entries.length - 1];
    const assetDiff = last.afterValue - first.beforeValue;
    const assetPct = first.beforeValue > 0 ? (assetDiff / first.beforeValue) * 100 : null;

    // 비중변동: 기간 시작 시점 vs 종료 시점의 계좌별 비중(%) 차이
    const accounts = new Set([...Object.keys(first.beforeByAccount), ...Object.keys(last.afterByAccount)]);
    const weightLines = [...accounts].map((acc) => {
      const beforePct = first.beforeValue > 0 ? ((first.beforeByAccount[acc] || 0) / first.beforeValue) * 100 : 0;
      const afterPct = last.afterValue > 0 ? ((last.afterByAccount[acc] || 0) / last.afterValue) * 100 : 0;
      const d = afterPct - beforePct;
      return Math.abs(d) >= 0.1 ? `${acc} ${beforePct.toFixed(1)}%→${afterPct.toFixed(1)}%(${d >= 0 ? "+" : ""}${d.toFixed(1)}%p)` : null;
    }).filter(Boolean);

    // 종목변동: 기간 내 모든 이벤트의 changes를 계좌+종목 기준으로 합쳐 마지막 상태만 표시
    const changeMap = new Map();
    for (const e of entries) {
      for (const c of e.changes) changeMap.set(`${c.account}|${c.symbol}`, c);
    }
    const changeList = [...changeMap.values()];

    return `<div class="card" style="margin-top:10px;">
      <p class="chart-title" style="margin-top:0; font-size:13.5px;">${period} <span class="stat-sub" style="font-size:11.5px;">(이벤트 ${entries.length}건: ${[...new Set(entries.map((e) => CHANGE_SOURCE_LABEL[e.source] || e.source))].join(", ")})</span></p>
      <p class="stat-sub" style="margin:4px 0;">📊 자산변동: ${fmtW(first.beforeValue)} → ${fmtW(last.afterValue)}
        ${assetPct != null ? `<span style="color:${assetDiff >= 0 ? "var(--good)" : "var(--critical)"}">(${assetDiff >= 0 ? "+" : ""}${fmtW(assetDiff)}, ${assetPct.toFixed(1)}%)</span>` : ""}</p>
      ${weightLines.length ? `<p class="stat-sub" style="margin:4px 0;">⚖️ 비중변동: ${weightLines.join(" · ")}</p>` : ""}
      ${changeList.length ? `<p class="stat-sub" style="margin:4px 0;">📦 종목변동 ${changeList.length}건: ${changeList.map((c) => `${c.account} ${c.symbol} ${CHANGE_TYPE_LABEL[c.type]}(${c.oldQty}→${c.newQty})`).join(", ")}</p>` : ""}
    </div>`;
  }).join("");
  return `${rows}<p class="stat-sub" style="margin-top:6px;">총 ${log.length}건의 변경 이벤트가 기록되어 있습니다(최대 300건, 이 브라우저에만 보관).</p>`;
}

/* ---------- A6: 📊 지수비교 탭 — 내 수익률 vs 벤치마크 ----------
   "내 수익률"은 현재 보유 평가액 비중으로 각 종목 일별 종가 수익률을 가중평균해
   합성한 근사치(일별 리밸런싱 가정, 기간 시작=0%) — 기간 중 매수·매도를 반영한
   실계좌 누적수익률이 아니므로 화면에 그 한계를 명시한다. 수익률(%) 비교라
   통화 환산은 불필요(각 시리즈를 자기 통화 종가 그대로 정규화). */
const BENCH_US_SYMBOL = "SPY";      // 미국지수 프록시(S&P500)
const BENCH_KR_SYMBOL = "069500.KS"; // 한국지수 프록시(KODEX 200 = 코스피200)

function benchSinceDate(months) {
  if (!months) return "0000-00-00"; // 전체 기간
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/* 단일 종목: sinceDate 이후 첫 종가 대비 %변화 시리즈 */
function pctChangeSeriesSince(full, sinceDate) {
  const dates = [], values = [];
  let base = null;
  for (let i = 0; i < full.dates.length; i++) {
    if (full.dates[i] < sinceDate) continue;
    if (base == null) base = full.closes[i];
    dates.push(full.dates[i]);
    values.push(full.closes[i] / base - 1);
  }
  return dates.length >= 2 ? { dates, values } : null;
}

/* 내 포트폴리오: 보유 종목들의 날짜 교집합 위에서 평가액 비중 가중 일별 수익률을
   복리 누적(index.html computeBlend의 NAV 패턴을 %변화(0 시작)로 변형) */
function buildMyBlendPctSeries(perRow, sinceDate) {
  const rows = perRow.filter((p) => p.value > 0 && p.full && p.full.dates && p.full.dates.length >= 2);
  if (!rows.length) return null;
  const totalV = rows.reduce((a, p) => a + p.value, 0);
  const weights = rows.map((p) => p.value / totalV);
  const priceMaps = rows.map((p) => {
    const m = new Map();
    for (let i = 0; i < p.full.dates.length; i++) {
      if (p.full.dates[i] >= sinceDate) m.set(p.full.dates[i], p.full.closes[i]);
    }
    return m;
  });
  let commonDates = [...priceMaps[0].keys()];
  for (let i = 1; i < priceMaps.length; i++) commonDates = commonDates.filter((d) => priceMaps[i].has(d));
  commonDates.sort();
  if (commonDates.length < 2) return null;
  let nav = 1, prev = null;
  const dates = [], values = [];
  for (const date of commonDates) {
    const prices = priceMaps.map((m) => m.get(date));
    if (prev) {
      let r = 0;
      for (let i = 0; i < weights.length; i++) r += weights[i] * (prices[i] / prev[i] - 1);
      nav *= 1 + r;
    }
    dates.push(date);
    values.push(nav - 1);
    prev = prices;
  }
  return { dates, values };
}

/* 시리즈들의 시작일을 가장 늦은 공통 시작일로 맞춰 전부 그 날=0%가 되게 재정규화 —
   상장일이 늦은 벤치마크가 섞여도 같은 출발선에서 비교되도록(공정 비교) */
function alignSeriesStarts(seriesList) {
  const commonStart = seriesList.reduce((a, s) => (s.dates[0] > a ? s.dates[0] : a), "");
  return seriesList.map((s) => {
    let idx0 = s.dates.findIndex((d) => d >= commonStart);
    if (idx0 < 0) idx0 = 0;
    const factor = 1 + s.values[idx0];
    return {
      ...s,
      dates: s.dates.slice(idx0),
      values: s.values.slice(idx0).map((v) => (1 + v) / factor - 1),
    };
  }).filter((s) => s.dates.length >= 2);
}

/* 통합 탭 — 도넛(종목 비중) SVG (라이브러리 없이 stroke-dasharray로) */
function buildDonutSVG(items, centerLabel) {
  const total = items.reduce((a, b) => a + b.value, 0);
  if (total <= 0) return "";
  const R = 15.9155; // 둘레가 정확히 100이 되는 반지름
  let offset = 25; // 12시 방향 시작
  const circles = items.map((it, i) => {
    const pct = (it.value / total) * 100;
    const c = `<circle r="${R}" cx="21" cy="21" fill="transparent"
      stroke="${MY_ASSETS_PALETTE[i % MY_ASSETS_PALETTE.length]}" stroke-width="6"
      stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"></circle>`;
    offset -= pct;
    return c;
  }).join("");
  const legend = items.map((it, i) => {
    const pct = (it.value / total) * 100;
    return `<div class="donut-legend-row">
      <span class="donut-swatch" style="background:${MY_ASSETS_PALETTE[i % MY_ASSETS_PALETTE.length]}"></span>
      <span class="donut-name" title="${it.label}">${it.label}</span>
      <span class="donut-pct">${pct.toFixed(1)}%</span>
    </div>`;
  }).join("");
  return `<div class="donut-wrap">
    <div class="donut-chart">
      <svg viewBox="0 0 42 42" role="img" aria-label="종목별 비중 도넛 차트">${circles}</svg>
      <div class="donut-center">${centerLabel}</div>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

/* 통합 탭 — 월별 예상 배당금 12개월 바 (확정=divHistory 강조, 나머지=현재 월배당 추정) */
function buildMonthBarsHTML(monthlyDiv, divHistory) {
  const year = todayStr().slice(0, 4);
  const nowMonth = Number(todayStr().slice(5, 7));
  const vals = [];
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, "0")}`;
    const confirmed = divHistory && divHistory[key] > 0 ? divHistory[key] : null;
    // 확정 이력이 있는 달만 실값, 이번 달은 현재 월배당으로 추정, 그 외 달은 데이터가 없으므로 0원 처리
    // (과거 실제 지급액을 알 수 없는데 현재 추정치를 반복해서 채우면 실제보다 부풀려 보이는 문제가 있었음)
    const v = confirmed != null ? confirmed : m === nowMonth ? monthlyDiv : 0;
    vals.push({ m, v, confirmed: confirmed != null, estimated: confirmed == null && m === nowMonth });
  }
  const max = Math.max(...vals.map((x) => x.v), 1);
  const bars = vals.map(({ m, v, confirmed, estimated }) => {
    const h = v > 0 ? Math.max(4, (v / max) * 100) : 0;
    const label = v >= 10000 ? `${Math.round(v / 10000)}만` : v > 0 ? Math.round(v).toLocaleString() : "";
    return `<div class="mb-col">
      <span class="mb-val">${label}</span>
      <div class="mb-bar${confirmed ? " confirmed" : estimated ? " estimated" : ""}" style="height:${h.toFixed(0)}%"></div>
      <span class="mb-label">${m}월</span>
    </div>`;
  }).join("");
  return `<div class="month-bars">${bars}</div>
  <p class="stat-sub">진한 막대 = 확정 이력(가져온 데이터), 중간 막대 = 이번 달 추정(현재 월배당 기준), 표시 없음 = 데이터 없음(${year}년).</p>`;
}

/* 통합 탭 — 자산 유형별(카테고리) 1줄 스택바 */
function buildCategoryStackHTML(perRow) {
  const totals = new Map();
  let total = 0;
  for (const p of perRow) {
    if (p.value <= 0) continue;
    const cat = p.meta && p.meta.category ? p.meta.category : "기타";
    totals.set(cat, (totals.get(cat) || 0) + p.value);
    total += p.value;
  }
  if (total <= 0) return "";
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const segs = entries.map(([cat, v], i) =>
    `<div class="stack-seg" style="width:${((v / total) * 100).toFixed(2)}%; background:${MY_ASSETS_PALETTE[i % MY_ASSETS_PALETTE.length]}" title="${cat}"></div>`).join("");
  const legend = entries.map(([cat, v], i) =>
    `<span class="stack-legend-item"><span class="donut-swatch" style="background:${MY_ASSETS_PALETTE[i % MY_ASSETS_PALETTE.length]}"></span>${cat} ${((v / total) * 100).toFixed(2)}%</span>`).join("");
  return `<div class="stack-bar">${segs}</div><div class="stack-legend">${legend}</div>`;
}

/* 통합 탭 본문 — 계좌 셀렉터에 따라 다시 그림(재계산 없음, 저장된 perRow 필터만) */
function renderMyOverview() {
  const box = document.getElementById("myOverviewBody");
  const sel = document.getElementById("myOverviewAccount");
  const typeSel = document.getElementById("myOverviewAssetType");
  if (!box || !sel || !state.myAssetsCsvData) return;
  const { perRow, totalValue } = state.myAssetsCsvData;
  const acc = sel.value;
  const assetType = typeSel ? typeSel.value : "__all__";
  let rows = acc === "__all__" ? perRow : perRow.filter((p) => (p.account || "계좌 미지정") === acc);
  if (assetType !== "__all__") {
    rows = rows.filter((p) => (assetType === "stock" ? p.meta && p.meta.assetType === "stock" : !(p.meta && p.meta.assetType === "stock")));
  }
  const fmtW = (v) => fmtPrice(v, "KRW");
  const value = rows.reduce((a, b) => a + b.value, 0);
  const costed = rows.filter((p) => p.cost != null);
  const cost = costed.reduce((a, b) => a + b.cost, 0);
  const costedVal = costed.reduce((a, b) => a + b.value, 0);
  const profit = cost > 0 ? costedVal - cost : null;
  const monthlyDiv = rows.reduce((a, b) => a + b.monthlyDiv, 0);

  const donutItems = rows.filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
    .map((p) => ({ label: p.meta ? p.meta.name : p.symbol, value: p.value }));
  // 도넛이 12개 초과면 나머지를 "기타"로 묶음(첨부 양식과 동일하게 범례 과밀 방지)
  let donutFinal = donutItems;
  if (donutItems.length > 12) {
    const rest = donutItems.slice(12).reduce((a, b) => a + b.value, 0);
    donutFinal = [...donutItems.slice(0, 12), { label: "기타", value: rest }];
  }
  // 계좌별 보기에서는 그 계좌 확정 이력이 없으므로 전체 보기에서만 divHistory 강조
  const divHist = acc === "__all__" ? (state.myAssetsDivHistory || {}) : {};

  box.innerHTML = `
    <div class="stat-row" style="margin-top:14px;">
      <div class="stat">
        <p class="stat-label">총 자산${acc === "__all__" ? "" : ` (${acc})`}</p>
        <p class="stat-hero" style="font-size:26px;">${fmtW(value)}</p>
        ${profit != null ? `<p class="stat-sub" style="color:${profit >= 0 ? "var(--good)" : "var(--critical)"}">평가 손익 ${profit >= 0 ? "+" : ""}${fmtW(profit)} (${((costedVal / cost - 1) * 100).toFixed(2)}%)</p>` : `<p class="stat-sub">매입단가 입력 시 손익 표시</p>`}
      </div>
      <div class="stat">
        <p class="stat-label">월배당</p>
        <p class="stat-value">${fmtW(monthlyDiv)}</p>
        <p class="stat-sub">연환산 ${fmtW(monthlyDiv * 12)}</p>
      </div>
    </div>
    ${buildDonutSVG(donutFinal, fmtW(value))}
    <p class="chart-title" style="margin-top:20px;">예상 배당금 (단위: KRW)</p>
    ${buildMonthBarsHTML(monthlyDiv, divHist)}
    <p class="chart-title" style="margin-top:20px;">자산 유형별 구성</p>
    ${buildCategoryStackHTML(rows)}
  `;
}

async function renderMyAssets() {
  const result = document.getElementById("myAssetResult");
  state.myAssetsCsvData = null;
  updateMyRowsCollapseUI();
  updateMyAssetsVersionBadge();
  syncMyContribRows();
  const cfg = serializeMyAssets();
  updateIncludeStocksBtn();
  updateLiveQuotesBtn();
  // 보유(qty)뿐 아니라 매수계획만 있는 행(monthlyQty)도 포함 — 평가액은 0, 월매수만 집계됨
  const rows = cfg.rows.filter((r) => r.qty > 0 || r.monthlyQty > 0);
  if (!rows.length) {
    // 재설치·초기화 직후의 빈 상태 — 입력 섹션이 접혀 있으면 "대시보드가 사라진"
    // 것처럼 보이므로 복원 경로를 크게 안내하고 입력 섹션을 자동으로 펼친다
    result.innerHTML = `
      <div class="empty-restore-card">
        <p class="empty-restore-title">📭 표시할 자산 데이터가 없습니다</p>
        <p class="empty-restore-desc">앱을 새로 설치했거나 데이터가 초기화된 경우, 백업해 둔 📤 내보내기 파일(myassets-…json)을 가져오면 보유 종목·목표 설정·스냅샷 이력까지 한 번에 복원됩니다. 백업 파일이 없다면 아래에서 직접 입력할 수 있습니다.</p>
        <div class="action-row">
          <button type="button" id="myEmptyImportBtn">📂 가져오기로 복원</button>
          <button type="button" id="myEmptyInputBtn">⚙️ 직접 입력하기</button>
        </div>
      </div>`;
    const emptySec = document.getElementById("sec-myassets");
    if (emptySec) emptySec.classList.remove("collapsed");
    const emptyImportBtn = document.getElementById("myEmptyImportBtn");
    if (emptyImportBtn) emptyImportBtn.addEventListener("click", () => {
      const importBtn = document.getElementById("myImportBtn");
      if (importBtn) importBtn.click();
    });
    const emptyInputBtn = document.getElementById("myEmptyInputBtn");
    if (emptyInputBtn) emptyInputBtn.addEventListener("click", () => {
      const sec = document.getElementById("sec-myassets");
      if (sec) { sec.classList.remove("collapsed"); sec.scrollIntoView({ behavior: "smooth" }); }
      const rowsWrap = document.getElementById("myAssetRows");
      if (rowsWrap && !sec) rowsWrap.scrollIntoView({ behavior: "smooth" });
    });
    return;
  }
  result.innerHTML = `<p class="compare-empty">계산 중…</p>`;

  // 아직 수집 목록(state.listedEtfs)에 없는 종목코드는 계산에서 제외하고
  // 별도로 안내한다 — 조용히 다른 종목으로 바뀌거나 전체 계산이 멈추지 않도록
  const unknownRows = rows.filter((r) => !state.metaBySymbol.has(r.symbol));
  let knownRows = rows.filter((r) => state.metaBySymbol.has(r.symbol));

  // 일반종목(개별주) 반영/미반영 토글 — 꺼두면 ETF만으로 평가액·배당·목표계산을 함
  const includeStocks = localStorage.getItem(MY_INCLUDE_STOCKS_KEY) !== "0";
  const stockRows = knownRows.filter((r) => state.metaBySymbol.get(r.symbol).assetType === "stock");
  if (!includeStocks) knownRows = knownRows.filter((r) => state.metaBySymbol.get(r.symbol).assetType !== "stock");

  let fx = null;
  const items = [];
  let liveKr = null;
  try {
    fx = await loadFx();
    liveKr = await loadLiveKrQuotes(); // 켜져 있을 때만, 실패 시 null(주간 데이터 폴백)
    for (const r of knownRows) {
      const full = await loadSymbol(r.symbol);
      items.push({ ...r, full });
    }
  } catch (err) {
    result.innerHTML = `<p class="compare-empty" style="color:var(--critical)">${err.message}</p>`;
    return;
  }

  const excludedStockHTML = !includeStocks && stockRows.length
    ? `<p class="stat-sub" style="margin-top:6px;">🏢 일반종목 ${stockRows.length}건(${stockRows.map((r) => (state.metaBySymbol.get(r.symbol) || {}).name || r.symbol).join(", ")})은 "일반종목: 제외" 상태라 계산에서 빠졌습니다.</p>`
    : "";
  const unknownHTML = unknownRows.length
    ? `<p class="stat-sub" style="color:var(--critical); margin-top:10px;">⚠️ 아직 수집 목록에 없는 종목 ${unknownRows.length}건은 계산에서 제외했습니다: ${unknownRows.map((r) => r.symbol).join(", ")} — 클로드에게 "이 종목 추가해줘"라고 요청하면 다음 데이터 수집 때 반영됩니다.</p>`
    : "";

  if (!items.length) {
    result.innerHTML = `<p class="compare-empty">계산할 수 있는 종목이 없습니다.</p>${unknownHTML}`;
    return;
  }

  const fmtW = (v) => fmtPrice(v, "KRW");
  const latestRate = fx ? fx.rates[fx.rates.length - 1] : null;
  let totalValue = 0, totalCost = 0, totalMonthlyDiv = 0, totalMonthlyBuy = 0;
  let costedValue = 0; // 매입단가가 있는 종목의 평가액 합 (수익률 분모 정합성)
  const perRow = [];
  const accountMap = new Map();
  const periodMap = new Map(); // 지급시기(월초/월중/월말)별 월배당 합계

  let liveApplied = 0;
  for (const it of items) {
    const meta = state.metaBySymbol.get(it.symbol);
    let close = it.full.closes[it.full.closes.length - 1];
    // 🔄 최신시세 켜짐 + 해당 국내 종목의 장중 가격이 있으면 주간 종가 대신 사용
    if (liveKr && liveKr.prices[it.symbol] > 0) { close = liveKr.prices[it.symbol]; liveApplied += 1; }
    const isUsd = (it.full.currency || "USD") === "USD";
    if (isUsd && latestRate == null) {
      result.innerHTML = `<p class="compare-empty" style="color:var(--critical)">환율 데이터가 아직 없어 달러 종목을 환산할 수 없습니다.</p>`;
      return;
    }
    const toKrw = (v) => (isUsd ? v * latestRate : v);
    const value = toKrw(close) * it.qty;
    const cost = it.avgPrice > 0 ? toKrw(it.avgPrice) * it.qty : null;
    const profit = cost != null ? value - cost : null;
    const ttm = meta && meta.ttmDividend ? meta.ttmDividend : 0;
    const divYield = meta && meta.dividendYield ? meta.dividendYield : 0;
    // 확정 DPS(주당)가 있으면 최우선 적용(CLAUDE.md 원칙) — TTM÷12 평균은 신규 상장·특별배당 종목에서 실제 지급액을 과소 반영함
    const usedConfirmed = it.confirmedDps > 0;
    const monthlyDiv = usedConfirmed ? toKrw(it.confirmedDps) * it.qty : toKrw(ttm / 12) * it.qty;
    // 다음달 기대월배당: 등록된 연 배당률(divYield) × 현재가 기준 — TTM 평균과 별개로 "지금 주가라면 다음달 얼마"를 보여주는 참고치
    const nextMonthDiv = divYield > 0 ? toKrw((close * divYield) / 12) * it.qty : 0;
    const buyTimes = BUY_FREQ_TIMES[it.buyFreq] || 1;
    const monthlyBuy = toKrw(close) * it.monthlyQty * buyTimes;

    // NAV 침식 경고(14RAE A-8): 최근 30일 가격 하락률 > 월배당률이면 원금 훼손 의심
    let erosion = null;
    if (ttm > 0 && it.full.dates.length > 25) {
      const lastDate = it.full.dates[it.full.dates.length - 1];
      const cutoff = new Date(lastDate); cutoff.setDate(cutoff.getDate() - 30);
      const cutStr = cutoff.toISOString().slice(0, 10);
      let idx = it.full.dates.findIndex((d) => d >= cutStr);
      if (idx < 0) idx = 0;
      const prev = it.full.closes[idx];
      const drop = (prev - close) / prev;
      const monthlyYield = ttm / 12 / close;
      if (drop > monthlyYield) erosion = drop;
    }

    // 목표 도달 "종목별 실적 반영" 옵션용 — 선택된 기간(1/3/6/12개월)의 실제 가격 등락률(연환산)
    const trailReturn = cfg.returnMode !== "manual"
      ? trailingReturnAnnualized(it.full.dates, it.full.closes, Number(cfg.returnMode))
      : null;

    totalValue += value;
    if (cost != null) { totalCost += cost; costedValue += value; }
    totalMonthlyDiv += monthlyDiv;
    totalMonthlyBuy += monthlyBuy;
    perRow.push({ ...it, meta, close, isUsd, value, cost, profit, monthlyDiv, nextMonthDiv, monthlyBuy, erosion, usedConfirmed, trailReturn });

    const accKey = it.account || "계좌 미지정";
    if (!accountMap.has(accKey)) accountMap.set(accKey, { value: 0, cost: 0, monthlyDiv: 0, monthlyBuy: 0, n: 0 });
    const g = accountMap.get(accKey);
    g.value += value; if (cost != null) g.cost += cost; g.monthlyDiv += monthlyDiv; g.monthlyBuy += monthlyBuy; g.n += 1;

    if (monthlyDiv > 0) {
      const pKey = it.payPeriod || "지급시기 미지정";
      periodMap.set(pKey, (periodMap.get(pKey) || 0) + monthlyDiv);
    }
  }

  const totalProfit = totalCost > 0 ? costedValue - totalCost : null;
  const selfSuffRate = totalMonthlyBuy > 0 ? totalMonthlyDiv / totalMonthlyBuy : null;

  // "📄 시트 저장" 버튼용 — 화면과 동일한 계산 결과를 CSV로 내릴 수 있게 보관
  state.myAssetsCsvData = { perRow, accountMap, periodMap, totalValue, totalMonthlyDiv, totalProfit };

  // 목표 도달: 기대수익률 미입력 시 배당수익률만 가정(보수적) — 안내문에 명시
  const goalAmount = parseFloat(cfg.goalAmount) || 0;
  let expReturn = cfg.expectedReturn !== "" ? Number(cfg.expectedReturn) / 100 : null;
  let weightedTrailReturn = null;
  if (cfg.returnMode !== "manual") {
    let wsum = 0, vsum = 0;
    for (const p of perRow) {
      if (p.trailReturn != null && p.value > 0) { wsum += p.trailReturn * p.value; vsum += p.value; }
    }
    weightedTrailReturn = vsum > 0 ? wsum / vsum : null;
    expReturn = weightedTrailReturn; // 종목별 실적 반영 모드에서는 직접입력 대신 이 값을 씀
  }
  // 생활비 사용액 — 월배당 중 일부를 생활비로 인출하면 그만큼은 복리 재투자에서 빠짐
  const livingExpenseUsed = Math.min(cfg.livingExpense || 0, totalMonthlyDiv);
  const reinvestedDiv = totalMonthlyDiv - livingExpenseUsed;
  const wDivYield = totalValue > 0 ? (reinvestedDiv * 12) / totalValue : 0;
  const goalRate = (expReturn != null ? expReturn : 0) + wDivYield;
  // 월 재투자액 = 월매수총액(ETF 매수) + 월적립투자금액(계좌별 월 납입금, 연금저축 등) — 둘 다 매달 잔고에 더해져 복리로 불어남
  const totalContributions = Object.values(cfg.contributions || {}).reduce((a, b) => a + b, 0);
  const totalMonthlyInvest = totalMonthlyBuy + totalContributions;
  const goal = goalAmount > 0 ? monthsToGoal(goalAmount, totalValue, totalMonthlyInvest, goalRate) : null;
  const goalLabel = goal
    ? goal.months == null ? "50년 초과"
      : goal.months === 0 ? "이미 달성"
      : `${Math.floor(goal.months / 12) > 0 ? `${Math.floor(goal.months / 12)}년 ` : ""}${goal.months % 12 > 0 ? `${goal.months % 12}개월` : ""}`.trim()
    : null;
  // 물가상승률 반영(선택): 목표금액을 "오늘 구매력" 기준으로 유지하려면 실질수익률(명목-물가)로
  // 계산해야 하므로, 시뮬레이터의 실질가치 로직과 동일하게 goalRate에서 물가상승률만큼 차감해 재계산
  const inflationOn = !!cfg.inflationOn;
  const inflationRate = inflationOn ? (Number(cfg.inflationRate) || 0) / 100 : null;
  const realGoal = inflationOn && goalAmount > 0
    ? monthsToGoal(goalAmount, totalValue, totalMonthlyInvest, goalRate - inflationRate)
    : null;
  const realGoalLabel = realGoal
    ? realGoal.months == null ? "50년 초과"
      : realGoal.months === 0 ? "이미 달성"
      : `${Math.floor(realGoal.months / 12) > 0 ? `${Math.floor(realGoal.months / 12)}년 ` : ""}${realGoal.months % 12 > 0 ? `${realGoal.months % 12}개월` : ""}`.trim()
    : null;

  const rowsHTML = perRow.map((p) => {
    const ttm = p.meta && p.meta.ttmDividend ? p.meta.ttmDividend : 0;
    const perShareMonthly = p.usedConfirmed ? p.confirmedDps : ttm / 12;
    const distLabel = perShareMonthly > 0
      ? `${p.isUsd ? "$" + perShareMonthly.toFixed(4) : fmtW(perShareMonthly)} <span style="color:${p.usedConfirmed ? "var(--good)" : "var(--text-muted)"}; font-size:11px;">${p.usedConfirmed ? "확정" : "추정"}</span>`
      : "—";
    const divLabel = p.monthlyDiv > 0
      ? `${fmtW(p.monthlyDiv)} <span style="color:${p.usedConfirmed ? "var(--good)" : "var(--text-muted)"}; font-size:11px;">${p.usedConfirmed ? "확정" : "추정(TTM)"}</span>`
      : "—";
    return `<tr>
      <td>${p.account || "미지정"}</td>
      <td style="text-align:left;">${p.meta ? p.meta.name : p.symbol}${p.erosion != null ? ` <span style="color:var(--critical); font-size:11px;">⚠️ NAV침식 의심</span>` : ""}</td>
      <td>${p.qty.toLocaleString()}</td>
      <td>${p.isUsd ? "$" + p.close.toLocaleString() : fmtW(p.close)}</td>
      <td>${fmtW(p.value)}</td>
      <td style="color:${p.profit == null ? "var(--text-muted)" : p.profit >= 0 ? "var(--good)" : "var(--critical)"}">${p.profit == null ? "—" : (p.profit >= 0 ? "+" : "") + fmtW(p.profit)}</td>
      <td>${distLabel}</td>
      <td>${divLabel}</td>
    </tr>`;
  }).join("");

  const accHTML = [...accountMap.entries()].map(([acc, g]) => `<tr>
      <td>${acc}</td><td>${g.n}</td><td>${fmtW(g.value)}</td><td>${g.monthlyDiv > 0 ? fmtW(g.monthlyDiv) : "—"}</td>
    </tr>`).join("");

  // 자산배분 비중(종목별) — 첨부 대시보드의 "비중분석" 탭에 해당
  const PALETTE = MY_ASSETS_PALETTE;
  const bySymbolValue = perRow.slice().sort((a, b) => b.value - a.value);
  const assetAllocHTML = bySymbolValue.map((p, i) => {
    const pct = totalValue > 0 ? (p.value / totalValue) * 100 : 0;
    const label = p.meta ? p.meta.name : p.symbol;
    return `<div class="bar-row">
      <span class="bar-label" title="${label}">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%; background:${PALETTE[i % PALETTE.length]}"></div></div>
      <span class="bar-value">${pct.toFixed(1)}%</span>
    </div>`;
  }).join("");

  // 계좌별 비중 — 첨부 대시보드의 "연금자산 히트맵" 탭을 막대 강도로 대체 표현
  const byAccountValue = [...accountMap.entries()].sort((a, b) => b[1].value - a[1].value);
  const accountAllocHTML = byAccountValue.map(([acc, g]) => {
    const pct = totalValue > 0 ? (g.value / totalValue) * 100 : 0;
    return `<div class="bar-row">
      <span class="bar-label" title="${acc}">${acc}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%; background:${accountColor(acc)}"></div></div>
      <span class="bar-value">${pct.toFixed(1)}%</span>
    </div>`;
  }).join("");

  // 지급시기별 월배당 — 시트(금융비서 대시보드)의 "지급시기별" 집계와 동일형태
  const PERIOD_ORDER = ["월초", "월중", "월말", "지급시기 미지정"];
  const periodTotal = [...periodMap.values()].reduce((a, b) => a + b, 0);
  const periodHTML = PERIOD_ORDER.filter((k) => periodMap.has(k)).map((k, i) => {
    const v = periodMap.get(k);
    const pct = periodTotal > 0 ? (v / periodTotal) * 100 : 0;
    return `<div class="bar-row">
      <span class="bar-label" title="${k}">${k}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%; background:${PALETTE[i % PALETTE.length]}"></div></div>
      <span class="bar-value">${fmtW(v)}</span>
    </div>`;
  }).join("");

  // 월배당 TOP10 — 첨부 대시보드의 "월배당 현황차트" 탭 중 TOP10 항목
  const top10Div = perRow.filter((p) => p.monthlyDiv > 0).sort((a, b) => b.monthlyDiv - a.monthlyDiv).slice(0, 10);
  const maxDiv = top10Div.length ? top10Div[0].monthlyDiv : 0;
  const top10HTML = top10Div.map((p) => {
    const pct = maxDiv > 0 ? (p.monthlyDiv / maxDiv) * 100 : 0;
    const label = p.meta ? p.meta.name : p.symbol;
    return `<div class="bar-row">
      <span class="bar-label" title="${label}">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%; background:${accountColor(p.account || "계좌 미지정")}"></div></div>
      <span class="bar-value">${fmtW(p.monthlyDiv)}</span>
    </div>`;
  }).join("");

  // 계좌별 월배당 — v534 "월배당현황차트"의 계좌별 비교 차트에 해당
  const byAccountDiv = [...accountMap.entries()].filter(([, g]) => g.monthlyDiv > 0).sort((a, b) => b[1].monthlyDiv - a[1].monthlyDiv);
  const maxAccDiv = byAccountDiv.length ? byAccountDiv[0][1].monthlyDiv : 0;
  const accountDivHTML = byAccountDiv.map(([acc, g]) => {
    const pct = maxAccDiv > 0 ? (g.monthlyDiv / maxAccDiv) * 100 : 0;
    return `<div class="bar-row">
      <span class="bar-label" title="${acc}">${acc}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%; background:${accountColor(acc)}"></div></div>
      <span class="bar-value">${fmtW(g.monthlyDiv)}</span>
    </div>`;
  }).join("");

  // 투자대상 시장 비중(한국/미국/글로벌) + 성장·배당·안전 스타일 비중 + 자산 성격별(카테고리) 비중
  // — v534 "비중분석" 탭에 해당. 상장 통화(isUsd)가 아니라 실제 투자대상 시장(meta.region)
  // 기준으로 분류한다 — "TIGER 미국S&P500"처럼 국내 상장이라도 미국에 투자하면 미국 비중으로,
  // "TIGER 배당커버드콜액티브"처럼 국내 배당주(SK하이닉스·삼성전자 등) 기반이면 한국 비중으로 잡힌다.
  const regionMap = new Map();
  const styleMap = new Map();
  const catMap = new Map();
  // 수익률 분석(비중별)용 — 매입원가/월배당도 region·style별로 함께 집계
  const regionRetMap = new Map(); // region -> {cost, costedValue, div, value}
  const styleRetMap = new Map();
  for (const p of perRow) {
    if (p.value <= 0) continue;
    const region = (p.meta && p.meta.region) || "미분류";
    const style = (p.meta && p.meta.style) || "미분류";
    regionMap.set(region, (regionMap.get(region) || 0) + p.value);
    styleMap.set(style, (styleMap.get(style) || 0) + p.value);
    const cat = p.meta && p.meta.category ? p.meta.category : "기타";
    catMap.set(cat, (catMap.get(cat) || 0) + p.value);

    if (!regionRetMap.has(region)) regionRetMap.set(region, { cost: 0, costedValue: 0, div: 0, value: 0 });
    const rr = regionRetMap.get(region);
    rr.value += p.value; rr.div += p.monthlyDiv;
    if (p.cost != null) { rr.cost += p.cost; rr.costedValue += p.value; }

    if (!styleRetMap.has(style)) styleRetMap.set(style, { cost: 0, costedValue: 0, div: 0, value: 0 });
    const sr = styleRetMap.get(style);
    sr.value += p.value; sr.div += p.monthlyDiv;
    if (p.cost != null) { sr.cost += p.cost; sr.costedValue += p.value; }
  }
  const REGION_ORDER = ["한국", "미국", "글로벌", "미분류"];
  const marketKpiHTML = totalValue > 0 ? `<div class="stat-row" style="margin-top:14px;">
      ${REGION_ORDER.filter((r) => regionMap.has(r)).map((r) => `<div class="stat">
        <p class="stat-label">${r} 투자 비중</p>
        <p class="stat-value">${((regionMap.get(r) / totalValue) * 100).toFixed(1)}%</p>
        <p class="stat-sub">${fmtW(regionMap.get(r))}</p>
      </div>`).join("")}
    </div>` : "";
  const STYLE_ORDER = ["성장", "배당", "안전", "개별주", "미분류"];
  const styleAllocHTML = STYLE_ORDER.filter((s) => styleMap.has(s)).map((s, i) => {
    const v = styleMap.get(s);
    const pct = totalValue > 0 ? (v / totalValue) * 100 : 0;
    const sub = s === "안전" ? "채권혼합·리츠 등" : s === "배당" ? "커버드콜 등 분배 중심" : s === "성장" ? "지수·테마 성장주" : s === "개별주" ? "국내 상장 개별 종목(비ETF)" : "";
    return `<div class="bar-row">
      <span class="bar-label" title="${s}">${s}${sub ? ` <span style="color:var(--text-muted);">(${sub})</span>` : ""}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%; background:${PALETTE[i % PALETTE.length]}"></div></div>
      <span class="bar-value">${pct.toFixed(1)}%</span>
    </div>`;
  }).join("");
  const categoryAllocHTML = [...catMap.entries()].sort((a, b) => b[1] - a[1]).map(([cat, v], i) => {
    const pct = totalValue > 0 ? (v / totalValue) * 100 : 0;
    return `<div class="bar-row">
      <span class="bar-label" title="${cat}">${cat}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%; background:${PALETTE[i % PALETTE.length]}"></div></div>
      <span class="bar-value">${pct.toFixed(1)}%</span>
    </div>`;
  }).join("");

  // 매수계획 상세(ETF모으기) + 연도별 확정 배당 이력
  const buyPlanHTML = buildBuyPlanHTML(perRow);
  const yearlyHTML = buildYearlyDivHTML(state.myAssetsDivHistory || {});

  // 계좌 히트맵 탭은 A7에서 트리맵으로 대체 — 패널 컨테이너에 renderMyAssets 끝의
  // 와이어링(renderTreemap)이 buildTreemapHTML 결과를 채운다.

  // 월별 스냅샷 추이 — "이번 달 스냅샷 저장" 버튼으로 기기에 누적(로그인 없이도 이력 확인 가능)
  const history = JSON.parse(localStorage.getItem(MY_ASSETS_HISTORY_KEY) || "[]");
  const trendHTML = history.length >= 2
    ? `<div id="myAssetTrendChart"></div>`
    : `<p class="compare-empty">"이번 달 스냅샷 저장"을 매달 눌러두면 평가액·월배당 추이 그래프가 여기 쌓입니다(현재 ${history.length}개월 기록).</p>`;
  // 일별 자산변동 캡처 이력 — "오늘 자산 스냅샷" 버튼으로 누적(기기 저장, 매일 직접 눌러야 함)
  const dailyHistory = JSON.parse(localStorage.getItem(MY_ASSETS_DAILY_HISTORY_KEY) || "[]");

  // 수익률 분석 — 자산 수익률(스냅샷 이력) + 지역별 수익률 + 배당수익률(계좌별·비중별)
  const returnAnalysisHTML = buildReturnAnalysisHTML(regionRetMap, styleRetMap, accountMap, history);

  // 배당기준·이력 — 확정/추정 DPS, 다음달 기대월배당, 배당상승률
  const divBasisHTML = buildDividendBasisHTML(perRow, history);
  // 자급률 — 계좌별 수입(배당+납입금) vs 매수 + 조절 안내
  const suffHTML = buildSelfSuffHTML(accountMap, cfg.contributions);

  result.innerHTML = `
    <div class="stat-row" style="margin-top:14px;">
      <div class="stat stat-hero-card">
        <p class="stat-label">총 평가액</p>
        <p class="stat-hero" style="font-size:28px;">${fmtW(totalValue)}</p>
        ${totalProfit != null ? `<p class="stat-sub" style="color:${totalProfit >= 0 ? "var(--good)" : "var(--critical)"}">손익 ${totalProfit >= 0 ? "+" : ""}${fmtW(totalProfit)} (${((costedValue / totalCost - 1) * 100).toFixed(2)}%)</p>` : `<p class="stat-sub">매입단가 입력 시 손익 표시</p>`}
      </div>
      <div class="stat">
        <p class="stat-label">예상 월배당 (확정 DPS 우선)</p>
        <p class="stat-value">${fmtW(totalMonthlyDiv)}</p>
        <p class="stat-sub">연환산 ${fmtW(totalMonthlyDiv * 12)}</p>
        ${livingExpenseUsed > 0 ? `<p class="stat-sub">배당금총액 ${fmtW(totalMonthlyDiv)} = 생활비사용액 ${fmtW(livingExpenseUsed)} + 배당재투자액 ${fmtW(reinvestedDiv)}</p>` : ""}
      </div>
      <div class="stat">
        <p class="stat-label">월매수 계획</p>
        <p class="stat-value">${totalMonthlyBuy > 0 ? fmtW(totalMonthlyBuy) : "—"}</p>
        <p class="stat-sub">${selfSuffRate != null ? `배당 자급률 ${(selfSuffRate * 100).toFixed(1)}% ${selfSuffRate >= 1 ? "✅ 배당으로 충당" : "⚠️ 부족 " + fmtW(totalMonthlyBuy - totalMonthlyDiv)}` : "월매수 수량 입력 시 자급률 표시"}</p>
      </div>
      ${goal ? `<div class="stat">
        <p class="stat-label">🎯 목표 ${fmtManwon(goalAmount)} 도달</p>
        <p class="stat-value">${goalLabel}</p>
        <p class="stat-sub">연 ${(goalRate * 100).toFixed(1)}% 가정${
          cfg.returnMode !== "manual" ? ` (종목별 최근 ${cfg.returnMode}개월 실적 가중평균${weightedTrailReturn == null ? ", 가격데이터 부족 시 0% 처리" : ""} + 배당수익률)`
          : expReturn == null ? " (기대수익률 미입력 — 배당만 반영)" : ""
        }</p>
        <p class="stat-sub">월 재투자액 ${fmtW(totalMonthlyInvest)}${totalContributions > 0 ? ` (월매수 ${fmtW(totalMonthlyBuy)} + 월적립 ${fmtW(totalContributions)})` : ""} 반영${livingExpenseUsed > 0 ? ` · 배당은 재투자분(${fmtW(reinvestedDiv)}/월)만 복리 반영, 생활비 사용분 제외` : ""}</p>
        ${realGoalLabel ? `<p class="stat-sub" style="color:var(--text-muted);">물가상승률 ${(inflationRate * 100).toFixed(1)}%/년 반영(오늘 구매력 기준): <b>${realGoalLabel}</b></p>` : ""}
      </div>` : ""}
    </div>
    <p class="stat-sub">최신 수집: ${state.manifest.updated} 기준(주간 자동 수집 — 실시간 시세 아님)${
      liveKr ? ` · <b style="color:var(--good)">🔄 최신시세 ${liveKr.updated} 적용(국내 ${liveApplied}종목, GitHub 사정에 따라 수 시간 지연 가능)</b>`
      : liveQuotesEnabled() ? ` · <span style="color:var(--critical)">🔄 최신시세 불러오기 실패(${state.liveKrError || "데이터 없음"}) — 주간 종가 사용</span>` : ""
    }</p>
    ${excludedStockHTML}
    ${unknownHTML}

    <div class="dash-tabs" id="myDashTabs">
      <button type="button" class="dash-tab-btn" data-tab="overview">📊 통합</button>
      <button type="button" class="dash-tab-btn" data-tab="summary">📋 종합</button>
      <button type="button" class="dash-tab-btn" data-tab="alloc">📊 비중분석</button>
      <button type="button" class="dash-tab-btn" data-tab="heatmap">🗺️ 비중 히트맵</button>
      <button type="button" class="dash-tab-btn" data-tab="divstatus">💰 월배당현황</button>
      <button type="button" class="dash-tab-btn" data-tab="suff">⚖️ 자급률·월매수</button>
      <button type="button" class="dash-tab-btn" data-tab="divbasis">💹 배당기준·이력</button>
      <button type="button" class="dash-tab-btn" data-tab="trend">📈 추이</button>
      <button type="button" class="dash-tab-btn" data-tab="benchmark">📊 지수비교</button>
      <button type="button" class="dash-tab-btn" data-tab="signal">📡 시그널</button>
      <button type="button" class="dash-tab-btn" data-tab="changelog">🗂️ 변동이력</button>
      <button type="button" class="dash-tab-btn" data-tab="settings">⚙️ 설정</button>
    </div>

    <div class="dash-panel" data-tab="overview" hidden>
      <div class="controls" style="margin-top:14px; margin-bottom:0;">
        <select id="myOverviewAccount" aria-label="통합 보기 계좌 선택" style="min-width:180px;">
          <option value="__all__">전체 계좌</option>
          ${[...accountMap.keys()].map((acc) => `<option value="${acc}">${acc}</option>`).join("")}
        </select>
        <select id="myOverviewAssetType" aria-label="자산 종류 보기 선택" style="min-width:150px;">
          <option value="__all__">통합(ETF+일반주식)</option>
          <option value="etf">ETF만</option>
          <option value="stock">국내일반주식만</option>
        </select>
      </div>
      <div id="myOverviewBody"></div>
    </div>

    <div class="dash-panel" data-tab="summary" hidden>
      <p class="chart-title" style="margin-top:20px;">보유 종목</p>
      <div style="overflow-x:auto;">
      <table class="account-summary-table">
        <thead><tr><th>계좌</th><th>종목</th><th>수량</th><th>현재가</th><th>평가액</th><th>손익</th><th>분배금(주당·월평균)</th><th>월배당</th></tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>
      </div>

      <p class="chart-title" style="margin-top:20px;">계좌별 합계</p>
      <div style="overflow-x:auto;">
      <table class="account-summary-table">
        <thead><tr><th>계좌</th><th>종목 수</th><th>평가액</th><th>월배당</th></tr></thead>
        <tbody>${accHTML}</tbody>
      </table>
      </div>
    </div>

    <div class="dash-panel" data-tab="alloc" hidden>
      ${marketKpiHTML}
      <p class="chart-title" style="margin-top:20px;">📊 자산배분 비중 (종목별)</p>
      <div class="bar-list">${assetAllocHTML}</div>

      <p class="chart-title" style="margin-top:20px;">🌱 성장·배당·안전 비중</p>
      <div class="bar-list">${styleAllocHTML}</div>

      <p class="chart-title" style="margin-top:20px;">🧩 자산 성격별 비중 (카테고리)</p>
      <div class="bar-list">${categoryAllocHTML}</div>

      <p class="chart-title" style="margin-top:20px;">🗺️ 계좌별 비중</p>
      <div class="bar-list">${accountAllocHTML}</div>
      <p class="stat-sub" style="margin-top:8px;">시장 전망(드러켄밀러 OS·매크로 스코어)은 외부 시장데이터가 필요해 이 사이트 범위 밖입니다 — 클로드 세션(금융비서)에서 제공됩니다.</p>

      ${returnAnalysisHTML}
    </div>

    <div class="dash-panel" data-tab="heatmap" hidden>
      <p class="chart-title" style="margin-top:20px;">🗺️ 비중 히트맵 (트리맵)</p>
      <p class="stat-sub">사각형 크기 = 평가액 비중, 색 = 등락률(<b style="color:#de2121;">상승 빨강</b> · <b style="color:#3042c2;">하락 파랑</b>). 주가는 주 1회 수집이라 등락률은 <b>마지막 두 수집 종가 간 변화</b>(🔄 최신시세 켬 시 라이브가 vs 마지막 수집 종가)입니다 — 일간 등락이 아닐 수 있습니다.</p>
      <div class="controls" style="margin:10px 0;">
        <select id="myTreemapGroup" aria-label="트리맵 그룹 기준">
          <option value="category" selected>카테고리별</option>
          <option value="account">계좌별</option>
          <option value="region">지역별</option>
          <option value="style">스타일별</option>
        </select>
      </div>
      <div id="myTreemapBody"></div>
    </div>

    <div class="dash-panel" data-tab="divstatus" hidden>
      ${accountDivHTML ? `<p class="chart-title" style="margin-top:20px;">🏦 계좌별 월배당</p>
      <div class="bar-list">${accountDivHTML}</div>` : ""}

      ${periodHTML ? `<p class="chart-title" style="margin-top:20px;">🗓️ 지급시기별 월배당</p>
      <div class="bar-list">${periodHTML}</div>` : `<p class="compare-empty">지급시기를 입력하면 여기 표시됩니다.</p>`}

      ${top10HTML ? `<p class="chart-title" style="margin-top:20px;">💰 월배당 TOP${top10Div.length}</p>
      <div class="bar-list">${top10HTML}</div>` : ""}
    </div>

    <div class="dash-panel" data-tab="suff" hidden>
      <p class="chart-title" style="margin-top:20px;">⚖️ 계좌별 자급률(수입 vs 매수)</p>
      ${suffHTML}
      <p class="chart-title" style="margin-top:24px;">🗓️ 계좌별 매수계획 상세 (ETF모으기)</p>
      ${buyPlanHTML}
      <p class="stat-sub" style="margin-top:8px;"><a href="https://app.notion.com/p/38f5efd0e46281e8a1a0e35bfb864dc6" target="_blank" rel="noopener">📈 월매수(월자동매수 현황) SOP(노션) 확인</a></p>
    </div>

    <div class="dash-panel" data-tab="divbasis" hidden>
      <p class="chart-title" style="margin-top:20px;">💹 배당기준·이력</p>
      ${divBasisHTML}
      <p class="stat-sub" style="margin-top:8px;"><a href="https://app.notion.com/p/3865efd0e46281c49a72c9bbc70dcea0" target="_blank" rel="noopener">📋 배당 기준 SOP(노션) 확인</a></p>
    </div>

    <div class="dash-panel" data-tab="trend" hidden>
      ${yearlyHTML}
      <p class="chart-title" style="margin-top:20px;">📈 평가액·월배당 추이 (월별 스냅샷)</p>
      <div class="action-row" style="margin-bottom:8px;">
        <button type="button" id="mySnapshotBtn" class="btn-action">📸 이번 달 스냅샷 저장</button>
        <button type="button" id="myHistorySopBtn" class="btn-action">📋 이력 SOP 요약 복사</button>
        <span id="mySnapshotStatus" class="action-status"></span>
      </div>
      ${trendHTML}

      <p class="chart-title" style="margin-top:24px;">📅 자산변동 이력 (일별·주간·월별·연간)</p>
      <div class="action-row" style="margin-bottom:8px;">
        <button type="button" id="myDailySnapshotBtn" class="btn-action">📅 오늘 자산 스냅샷</button>
        <span id="myDailySnapshotStatus" class="action-status"></span>
      </div>
      <div class="controls" style="margin-bottom:10px;">
        <select id="myAssetChangeGranularity" aria-label="자산변동 보기 단위">
          <option value="daily">일별</option>
          <option value="weekly">주간</option>
          <option value="monthly">월별</option>
          <option value="yearly">연간</option>
        </select>
      </div>
      <div id="myAssetChangeBody"></div>
      <p class="stat-sub" style="margin-top:6px;">이 사이트는 정적 페이지(서버 없음)라 일별 캡처는 자동으로 쌓이지 않습니다 — 확인할 때마다 "오늘 자산 스냅샷"을 눌러야 이력이 쌓입니다. 주간은 일별 캡처가 서로 다른 주에 2건 이상 쌓여야 계산됩니다.</p>
    </div>

    <div class="dash-panel" data-tab="benchmark" hidden>
      <p class="chart-title" style="margin-top:20px;">📊 주요 지수 대비 수익률</p>
      <p class="stat-sub">내 수익률은 <b>현재 보유 비중 기준</b> 합성 수익률(기간 시작=0%, 일별 리밸런싱 가정)입니다 — 기간 중 매수·매도 이력을 반영한 실계좌 누적수익률과는 다를 수 있습니다. 지수는 배당 미포함 가격 기준(SPY·KODEX 200 종가)이며, 통화 환산 없이 각자 %변화로 비교합니다.</p>
      <div class="controls" style="margin:10px 0;">
        <select id="myBenchPeriod" aria-label="비교 기간">
          <option value="3">최근 3개월</option>
          <option value="6" selected>최근 6개월</option>
          <option value="12">최근 1년</option>
          <option value="0">전체</option>
        </select>
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;"><input type="checkbox" id="myBenchUS" checked> 미국 S&amp;P500</label>
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;"><input type="checkbox" id="myBenchKR" checked> 한국 KOSPI200</label>
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;"><input type="checkbox" id="myBenchEtfOn"> 선택 ETF</label>
        <select id="myBenchEtf" aria-label="비교할 ETF 선택"></select>
      </div>
      <div id="myBenchBadges" class="action-row" style="margin:6px 0 10px;"></div>
      <div id="myBenchChart"></div>
    </div>

    <div class="dash-panel" data-tab="signal" hidden>
      <p class="chart-title" style="margin-top:20px;">👀 워치리스트 — 20일 포지션</p>
      <p class="stat-sub">현재가가 최근 20거래일 최저~최고 범위의 어디에 있는지 표시합니다 — <b>하단 30% 이하 🟢 관심 구간, 상단 75% 이상 🔴 경계 구간</b>. 국내 종목은 🔄 최신시세 켜짐 시 실시간가, 미국 종목은 주 1회 수집 종가 기준입니다(참고용, 투자 조언 아님).</p>
      <div id="mySignalWatchBody"></div>
      <div class="controls" style="margin:8px 0;">
        <select id="mySignalWatchAdd" aria-label="워치리스트에 추가할 종목"></select>
        <button type="button" id="mySignalWatchAddBtn" class="btn-action">➕ 워치리스트 추가</button>
      </div>

      <p class="chart-title" style="margin-top:20px;">📡 선택 종목 시그널 상세</p>
      <div class="controls" style="margin:8px 0;">
        <select id="mySignalSymbol" aria-label="시그널 상세 종목 선택"></select>
      </div>
      <div id="mySignalDetailBody"></div>

      <p class="chart-title" style="margin-top:20px;">📐 표준편차(σ)·매수목표가 — 주요 종목</p>
      <p class="stat-sub">σ = 일간수익률 표준편차(%). <b>기본 1년(252거래일)</b> — 노션 매수테이블의 실측 σ와 같은 계산 계열이며, 30일 σ는 최근 급변을 반영해 더 큽니다.</p>
      <div class="controls" style="margin:8px 0;">
        <select id="mySignalSigmaWin" aria-label="시그마 계산 기간">
          <option value="252" selected>σ 기간: 1년(252일)</option>
          <option value="30">σ 기간: 30일</option>
        </select>
      </div>
      <div id="mySignalSigmaBody"></div>

      <p class="chart-title" style="margin-top:20px;">🎯 레버리지 σ 매수가 — 전일종가 기준</p>
      <div class="controls" style="margin:8px 0;">
        <select id="mySignalLevSymbol" aria-label="레버리지 매수가 종목 선택"></select>
      </div>
      <div id="mySignalLevBody"></div>
    </div>

    <div class="dash-panel" data-tab="changelog" hidden>
      <p class="chart-title" style="margin-top:20px;">🗂️ 변동이력 — 캡처 반영·가져오기 자동 기록</p>
      <p class="stat-sub">계좌 캡처 "폼에 채우기" 또는 "가져오기"를 실행할 때마다 자동으로 남는 이력입니다(수동 스냅샷과 별개). 단위를 골라 자산변동·비중변동·종목변동을 함께 확인하세요.</p>
      <div class="controls" style="margin:10px 0;">
        <select id="myChangelogGranularity" aria-label="변동이력 보기 단위">
          <option value="daily">일별</option>
          <option value="weekly">주간</option>
          <option value="monthly">월별</option>
          <option value="yearly">연간</option>
        </select>
        <button type="button" id="myChangelogClearBtn" class="btn-action">🗑️ 이력 지우기</button>
      </div>
      <div id="myChangelogBody"></div>
    </div>

    <div class="dash-panel" data-tab="settings" hidden>
      <p class="chart-title" style="margin-top:20px;">📋 참조 노션 SOP (공통 SSOT 3종)</p>
      <p class="stat-sub"><a href="https://app.notion.com/p/3955efd0e46281dab7f3cbd905a15dfd" target="_blank" rel="noopener">📊 계좌 종목 현황 SOP — 계좌×종목×수량 단일 기록처</a></p>
      <p class="stat-sub"><a href="https://app.notion.com/p/3865efd0e46281c49a72c9bbc70dcea0" target="_blank" rel="noopener">💹 배당금 SOP — 14RAE 배당기준 마스터 (확정 DPS·배당률·지급시기)</a></p>
      <p class="stat-sub"><a href="https://app.notion.com/p/38f5efd0e46281e8a1a0e35bfb864dc6" target="_blank" rel="noopener">📈 월매수 SOP — 월자동매수 현황 & 월배당 비교</a></p>
      <p class="stat-sub" style="margin-top:6px;">금융지식 세션이나 앱에서 위 3개 페이지를 갱신한 뒤, 클로드 코드 세션에 "자산 업데이트"를 요청하면 가져오기 파일이 재생성됩니다.</p>

      <p class="chart-title" style="margin-top:20px;">📂 불러오기 파일 버전</p>
      <p class="stat-sub">${state.myAssetsDataAsOf ? `데이터 기준일: <b>${state.myAssetsDataAsOf}</b>` : "데이터 기준일: — (가져오기 파일에 dataAsOf 없음)"}</p>
      <p class="stat-sub">마지막 불러오기: ${state.myAssetsImportedAt ? `<b>${state.myAssetsImportedAt}</b>` : "— (아직 가져오기 파일을 불러온 적 없음, 현재 화면은 직접 입력분)"}</p>

      <p class="chart-title" style="margin-top:20px;">📈 주가·배당 데이터 업데이트</p>
      <p class="stat-sub">최신 수집: <b>${state.manifest.updated}</b> (매주 자동 수집 — 실시간 시세 아님)</p>
      <p class="stat-sub">🔄 최신시세(장중 30분 주기 예정): <b>${liveQuotesEnabled() ? (liveKr ? `켬 — ${liveKr.updated} 기준 국내 ${liveApplied}종목 적용` : `켬 — 불러오기 실패, 주간 종가 사용`) : "끔"}</b> — 국내 장중(평일 09:05~15:35)에만 갱신되며 GitHub 무료 스케줄 큐 혼잡으로 수 시간까지 지연되거나 일부 주기는 건너뛸 수 있습니다.</p>

      <p class="chart-title" style="margin-top:20px;">🏢 일반종목(개별주) 반영 상태</p>
      <p class="stat-sub">현재: <b>${includeStocks ? "포함" : "제외"}</b> — 위쪽 "일반종목: 포함/제외" 버튼으로 전환할 수 있습니다.</p>

      <p class="chart-title" style="margin-top:20px;">💾 백업·복원</p>
      <p class="stat-sub">📤 내보내기 파일에는 보유 종목·목표 설정과 함께 <b>스냅샷·변동이력·워치리스트가 모두 포함</b>되어, 재설치 후 📂 가져오기 한 번으로 전체 복원됩니다. 앱(APK)에서는 데이터가 바뀔 때마다 <b>문서/14fiance/ 폴더에 백업 파일이 자동 저장</b>되고, 재설치 후 "📂 백업 폴더에서 복원" 버튼으로 파일 선택 없이 복원할 수 있습니다(안드로이드 저장소 정책에 따라 폴더가 삭제될 수 있으니 중요한 시점엔 📤 내보내기도 함께 보관 권장).</p>
    </div>

    <p class="stat-sub" style="margin-top:10px;">현재가는 주간 수집 데이터의 마지막 종가 기준입니다. 월배당은 종목별 "확정 DPS(원/주)"를 입력하면 DPS×수량으로 계산해 우선 적용하고, 비워두면 최근 1년 배당(TTM)÷12 추정치를 사용합니다. 신규 상장·특별배당 종목은 TTM 추정이 실제보다 크게 낮을 수 있으니 시트/노션 배당기준의 확정 DPS 입력을 권장합니다.</p>
  `;

  // 🔄 최신시세 반영 시각 + 다음 30분 주기 수집까지 잔여시간 — 액션바에 상시 표시(탭과 무관)
  const liveTimeEl = document.getElementById("myLiveQuotesTimeStatus");
  if (liveTimeEl) {
    if (!liveQuotesEnabled()) {
      liveTimeEl.textContent = "";
    } else if (liveKr) {
      liveTimeEl.textContent = `${liveKr.updated} 기준 국내 ${liveApplied}종목 반영 · ${nextIntradayCollectionText()}`;
    } else {
      liveTimeEl.textContent = state.liveKrError ? "최신시세 불러오기 실패 — 주간 종가로 표시 중" : "최신시세 확인 중…";
    }
  }

  document.querySelectorAll("#myDashTabs .dash-tab-btn").forEach((btn) =>
    btn.addEventListener("click", () => showMyDashTab(btn.dataset.tab)));
  showMyDashTab(state.myDashTab || "overview");

  // 통합 탭: 계좌 셀렉터에 따라 도넛·월별 바·유형 스택바 재구성(재계산 없음)
  const ovSel = document.getElementById("myOverviewAccount");
  if (state.myOverviewAccount && [...ovSel.options].some((o) => o.value === state.myOverviewAccount)) {
    ovSel.value = state.myOverviewAccount;
  }
  ovSel.addEventListener("change", () => { state.myOverviewAccount = ovSel.value; renderMyOverview(); });
  const ovTypeSel = document.getElementById("myOverviewAssetType");
  if (state.myOverviewAssetType) ovTypeSel.value = state.myOverviewAssetType;
  ovTypeSel.addEventListener("change", () => { state.myOverviewAssetType = ovTypeSel.value; renderMyOverview(); });
  renderMyOverview();

  if (history.length >= 2) {
    buildChart(document.getElementById("myAssetTrendChart"), {
      dates: history.map((h) => h.month + "-01"),
      values: history.map((h) => h.value),
      color: cssVar("--series-price"),
      mode: "price", currency: "KRW",
      markers: [],
      valueFmt: (v) => fmtW(v),
      seriesLabel: "평가액",
    });
  }
  document.getElementById("mySnapshotBtn").addEventListener("click", () => {
    const month = todayStr().slice(0, 7);
    const hist = JSON.parse(localStorage.getItem(MY_ASSETS_HISTORY_KEY) || "[]");
    const idx = hist.findIndex((h) => h.month === month);
    const dpsBySymbol = {};
    for (const p of perRow) if (p.usedConfirmed) dpsBySymbol[p.symbol] = p.confirmedDps;
    const entry = { month, value: totalValue, monthlyDiv: totalMonthlyDiv, dpsBySymbol };
    if (idx >= 0) hist[idx] = entry; else hist.push(entry);
    hist.sort((a, b) => a.month.localeCompare(b.month));
    localStorage.setItem(MY_ASSETS_HISTORY_KEY, JSON.stringify(hist));
    if (typeof window.autoBackupMyAssets === "function") window.autoBackupMyAssets();
    flashStatus("mySnapshotStatus", `${month} 스냅샷 저장 ✓ (이 브라우저에만 보관)`);
    renderMyAssets();
  });
  // A8: 스냅샷·변동이력을 노션 "자산 스냅샷 이력" 페이지에 기록할 붙여넣기용 텍스트 —
  // 앱이 노션 API를 직접 호출하지 않는 원칙 유지(AI 세션에 붙여넣어 처리). 재설치 후
  // 가져오기 파일이 없어도 클로드 세션 "자산 업데이트"로 노션 이력에서 복원할 수 있게 한다.
  document.getElementById("myHistorySopBtn").addEventListener("click", async () => {
    const monthly = (() => { try { return JSON.parse(localStorage.getItem(MY_ASSETS_HISTORY_KEY) || "[]"); } catch (e) { return []; } })();
    const daily = (() => { try { return JSON.parse(localStorage.getItem(MY_ASSETS_DAILY_HISTORY_KEY) || "[]"); } catch (e) { return []; } })();
    const log = loadAssetChangelog();
    const lines = [`📸 자산 스냅샷 이력 백업 (${nowDateTimeStr()})`];
    lines.push(`월별 스냅샷 ${monthly.length}건 / 일별 스냅샷 ${daily.length}건 / 변동이력 ${log.length}건`);
    for (const h of monthly) lines.push(`- [월별] ${h.month}: 평가액 ${Math.round(h.value).toLocaleString()}원, 월배당 ${Math.round(h.monthlyDiv || 0).toLocaleString()}원`);
    for (const h of daily.slice(-30)) lines.push(`- [일별] ${h.date}: 평가액 ${Math.round(h.value).toLocaleString()}원`);
    for (const e of log.slice(0, 20)) lines.push(`- [변동] ${e.ts} (${e.source}): ${Math.round(e.beforeValue).toLocaleString()}→${Math.round(e.afterValue).toLocaleString()}원, ${e.changes.length}건 변경`);
    lines.push("");
    lines.push(`이 내용을 노션 "자산 스냅샷 이력" 페이지에 기록해줘 — 기존 기록과 같은 월/일짜는 이 값으로 갱신하고, 앱 재설치 후 "자산 업데이트" 요청 시 이 이력을 import JSON의 snapshotHistory/dailyHistory 필드에 채워줘.`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      flashStatus("mySnapshotStatus", "이력 요약 복사됨 — AI 세션에 붙여넣어 노션에 기록하세요");
    } catch (err) {
      window.prompt("아래 내용을 복사하세요:", lines.join("\n"));
    }
  });
  document.getElementById("myDailySnapshotBtn").addEventListener("click", () => {
    const date = todayStr();
    const hist = JSON.parse(localStorage.getItem(MY_ASSETS_DAILY_HISTORY_KEY) || "[]");
    const idx = hist.findIndex((h) => h.date === date);
    const entry = { date, value: totalValue, monthlyDiv: totalMonthlyDiv };
    if (idx >= 0) hist[idx] = entry; else hist.push(entry);
    hist.sort((a, b) => a.date.localeCompare(b.date));
    localStorage.setItem(MY_ASSETS_DAILY_HISTORY_KEY, JSON.stringify(hist));
    if (typeof window.autoBackupMyAssets === "function") window.autoBackupMyAssets();
    flashStatus("myDailySnapshotStatus", `${date} 일별 스냅샷 저장 ✓ (이 브라우저에만 보관)`);
    renderMyAssets();
  });
  const changeSel = document.getElementById("myAssetChangeGranularity");
  const renderAssetChange = () => {
    const body = document.getElementById("myAssetChangeBody");
    if (!body) return;
    const g = changeSel.value;
    body.innerHTML = g === "daily" ? buildDailyAssetHTML(dailyHistory)
      : g === "weekly" ? buildWeeklyAssetHTML(dailyHistory)
      : g === "monthly" ? buildMonthlyAssetHTML(history)
      : buildYearlyAssetHTML(history);
  };
  if (state.myAssetChangeGranularity) changeSel.value = state.myAssetChangeGranularity;
  changeSel.addEventListener("change", () => { state.myAssetChangeGranularity = changeSel.value; renderAssetChange(); });
  renderAssetChange();

  const changelogSel = document.getElementById("myChangelogGranularity");
  const renderChangelog = () => {
    const body = document.getElementById("myChangelogBody");
    if (!body) return;
    body.innerHTML = buildChangelogHTML(changelogSel.value);
  };
  if (state.myChangelogGranularity) changelogSel.value = state.myChangelogGranularity;
  changelogSel.addEventListener("change", () => { state.myChangelogGranularity = changelogSel.value; renderChangelog(); });
  document.getElementById("myChangelogClearBtn").addEventListener("click", () => {
    localStorage.removeItem(MY_ASSETS_CHANGELOG_KEY);
    renderChangelog();
  });
  renderChangelog();

  // A6: 📊 지수비교 — 내 수익률(현재 보유 비중 기준) vs 벤치마크
  const benchPeriodSel = document.getElementById("myBenchPeriod");
  const benchUS = document.getElementById("myBenchUS");
  const benchKR = document.getElementById("myBenchKR");
  const benchEtfOn = document.getElementById("myBenchEtfOn");
  const benchEtfSel = document.getElementById("myBenchEtf");
  benchEtfSel.innerHTML = etfOptionsHTML(state.myBenchEtf || "QQQ");
  if (state.myBenchPeriod) benchPeriodSel.value = state.myBenchPeriod;
  if (state.myBenchUS != null) benchUS.checked = state.myBenchUS;
  if (state.myBenchKR != null) benchKR.checked = state.myBenchKR;
  if (state.myBenchEtfOn != null) benchEtfOn.checked = state.myBenchEtfOn;

  const renderBenchmark = async () => {
    const chartEl = document.getElementById("myBenchChart");
    const badgesEl = document.getElementById("myBenchBadges");
    if (!chartEl) return;
    state.myBenchPeriod = benchPeriodSel.value;
    state.myBenchUS = benchUS.checked;
    state.myBenchKR = benchKR.checked;
    state.myBenchEtfOn = benchEtfOn.checked;
    state.myBenchEtf = benchEtfSel.value;
    chartEl.innerHTML = `<p class="compare-empty">불러오는 중…</p>`;
    badgesEl.innerHTML = "";
    try {
      const since = benchSinceDate(Number(benchPeriodSel.value));
      const seriesList = [];
      const mySeries = buildMyBlendPctSeries(perRow, since);
      if (mySeries) seriesList.push({ label: "내 수익률(현재 비중 기준)", color: "#eda100", ...mySeries });
      const benchDefs = [];
      if (benchUS.checked) benchDefs.push({ symbol: BENCH_US_SYMBOL, label: "S&P500(SPY)", color: "#2a78d6" });
      if (benchKR.checked) benchDefs.push({ symbol: BENCH_KR_SYMBOL, label: "KODEX 200", color: "#199e70" });
      if (benchEtfOn.checked && benchEtfSel.value) {
        const meta = state.metaBySymbol.get(benchEtfSel.value);
        benchDefs.push({ symbol: benchEtfSel.value, label: meta ? meta.name : benchEtfSel.value, color: "#7b5ec9" });
      }
      for (const def of benchDefs) {
        const full = await loadSymbol(def.symbol);
        const s = pctChangeSeriesSince(full, since);
        if (s) seriesList.push({ label: def.label, color: def.color, ...s });
      }
      if (!seriesList.length) {
        chartEl.innerHTML = `<p class="compare-empty">표시할 시리즈가 없습니다 — 보유 종목을 입력하거나 벤치마크를 켜주세요.</p>`;
        return;
      }
      const aligned = alignSeriesStarts(seriesList);
      if (!aligned.length) {
        chartEl.innerHTML = `<p class="compare-empty">선택한 기간에 겹치는 데이터가 부족합니다 — 기간을 늘려보세요.</p>`;
        return;
      }
      badgesEl.innerHTML = aligned.map((s) => {
        const last = s.values[s.values.length - 1];
        return `<span style="display:inline-block; background:${s.color}; color:#fff; border-radius:8px; padding:3px 10px; font-size:12.5px; font-weight:600;">${s.label} ${last >= 0 ? "+" : ""}${(last * 100).toFixed(2)}%</span>`;
      }).join(" ");
      chartEl.innerHTML = "";
      buildCompareChart(chartEl, aligned);
      chartEl.insertAdjacentHTML("beforeend",
        `<p class="stat-sub" style="margin-top:6px;">${aligned[0].dates[0]} ~ ${aligned[0].dates[aligned[0].dates.length - 1]} · 시작일 공통 정규화(모든 선이 같은 날 0%에서 출발)</p>`);
    } catch (err) {
      chartEl.innerHTML = `<p class="compare-empty" style="color:var(--critical)">지수 데이터를 불러오지 못했습니다: ${err.message}</p>`;
    }
  };
  benchPeriodSel.addEventListener("change", renderBenchmark);
  benchUS.addEventListener("change", renderBenchmark);
  benchKR.addEventListener("change", renderBenchmark);
  benchEtfOn.addEventListener("change", renderBenchmark);
  benchEtfSel.addEventListener("change", renderBenchmark);
  renderBenchmark();

  // A7: 🗺️ 비중 트리맵 — 그룹 기준 변경 시 트리맵만 재렌더
  const treemapSel = document.getElementById("myTreemapGroup");
  const renderTreemap = () => {
    const body = document.getElementById("myTreemapBody");
    if (!body) return;
    state.myTreemapGroup = treemapSel.value;
    body.innerHTML = buildTreemapHTML(perRow, treemapSel.value);
  };
  if (state.myTreemapGroup) treemapSel.value = state.myTreemapGroup;
  treemapSel.addEventListener("change", renderTreemap);
  renderTreemap();

  // A10: 📡 시그널 탭 — 워치리스트·지표·σ 매수가
  setupSignalTab(perRow, liveKr);
}

/* ===== A10 📡 시그널 탭 — 워치리스트·MA/RSI/MACD/볼린저·σ 매수목표가 ===== */
const SIGNAL_WATCHLIST_DEFAULT = ["005930.KS", "000660.KS", "SOXL"];
const SIGNAL_SIGMA_EXTRA = ["VOO", "QQQ", "069500.KS"]; // 주요종목 σ표 고정 포함 3종

function loadWatchlist() {
  try {
    const v = JSON.parse(localStorage.getItem(MY_ASSETS_WATCHLIST_KEY) || "null");
    if (Array.isArray(v) && v.length) return v;
  } catch (e) { /* 손상 시 기본값 */ }
  return SIGNAL_WATCHLIST_DEFAULT.slice();
}

function saveWatchlist(list) {
  localStorage.setItem(MY_ASSETS_WATCHLIST_KEY, JSON.stringify(list));
}

function symbolDisplayName(sym) {
  const meta = state.metaBySymbol.get(sym);
  return meta ? meta.name : sym;
}

/* 20일 위치 판정 — 참조 SIGNAL MAP 기준: 하단 30% 이하 관심, 상단 75% 이상 경계 */
function posZoneInfo(pos) {
  if (pos == null) return { cls: "sig-neutral", label: "―" };
  if (pos <= 0.3) return { cls: "sig-watch", label: "🟢 관심 구간" };
  if (pos >= 0.75) return { cls: "sig-alert", label: "🔴 경계 구간" };
  return { cls: "sig-neutral", label: "중립" };
}

function sigGaugeHTML(pos) {
  const pct = pos == null ? 50 : Math.round(pos * 100);
  return `<div class="sig-gauge"><div class="sig-gauge-dot" style="left:${pct}%"></div></div>`;
}

function setupSignalTab(perRow, liveKr) {
  const watchBody = document.getElementById("mySignalWatchBody");
  if (!watchBody) return;
  const addSel = document.getElementById("mySignalWatchAdd");
  const addBtn = document.getElementById("mySignalWatchAddBtn");
  const symSel = document.getElementById("mySignalSymbol");
  const detailBody = document.getElementById("mySignalDetailBody");
  const sigmaWinSel = document.getElementById("mySignalSigmaWin");
  const sigmaBody = document.getElementById("mySignalSigmaBody");
  const levSel = document.getElementById("mySignalLevSymbol");
  const levBody = document.getElementById("mySignalLevBody");

  // 시그널용 현재가: 국내 라이브 시세가 켜져 있으면 라이브가, 아니면 마지막 수집 종가
  const curPriceOf = (sym, full) => {
    const live = liveKr && liveKr.prices ? liveKr.prices[sym] : null;
    return live > 0 ? live : full.closes[full.closes.length - 1];
  };
  // 등락률: 라이브가 있으면 라이브 vs 마지막 종가, 없으면 마지막 두 수집 종가 간 변화
  const chgPctOf = (sym, full) => {
    const c = full.closes, n = c.length;
    if (n < 2) return null;
    const cur = curPriceOf(sym, full);
    return cur !== c[n - 1] ? cur / c[n - 1] - 1 : c[n - 1] / c[n - 2] - 1;
  };
  const chgHTML = (chg) => chg == null ? "―"
    : `<span style="color:${chg >= 0 ? "#d64545" : "#2a78d6"};">${chg >= 0 ? "+" : ""}${(chg * 100).toFixed(2)}%</span>`;

  // ① 워치리스트 — 20일 포지션 게이지
  const renderWatch = async () => {
    const list = loadWatchlist();
    if (!list.length) {
      watchBody.innerHTML = `<p class="compare-empty">워치리스트가 비어 있습니다 — 아래에서 종목을 추가하세요.</p>`;
      return;
    }
    watchBody.innerHTML = `<p class="compare-empty">불러오는 중…</p>`;
    const rows = [];
    for (const sym of list) {
      try {
        const full = await loadSymbol(sym);
        const cur = curPriceOf(sym, full);
        const pos = pos20d(full.closes, cur);
        const zone = posZoneInfo(pos);
        rows.push(`<tr>
          <td>${symbolDisplayName(sym)}</td>
          <td style="text-align:right;">${fmtPrice(cur, full.currency)}</td>
          <td style="text-align:right;">${chgHTML(chgPctOf(sym, full))}</td>
          <td style="min-width:140px;">${sigGaugeHTML(pos)}</td>
          <td><span class="sig-badge ${zone.cls}">${zone.label}</span></td>
          <td><button type="button" class="sig-remove-btn" data-sym="${sym}" aria-label="워치리스트에서 제거">✕</button></td>
        </tr>`);
      } catch (err) {
        rows.push(`<tr><td>${symbolDisplayName(sym)}</td><td colspan="4" style="color:var(--critical);">데이터 없음(${err.message})</td>` +
          `<td><button type="button" class="sig-remove-btn" data-sym="${sym}" aria-label="워치리스트에서 제거">✕</button></td></tr>`);
      }
    }
    watchBody.innerHTML = `<div style="overflow-x:auto;"><table class="account-summary-table">
      <thead><tr><th>종목</th><th>현재가</th><th>등락</th><th>20일 포지션</th><th>판정</th><th></th></tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>`;
    watchBody.querySelectorAll(".sig-remove-btn").forEach((btn) => btn.addEventListener("click", () => {
      saveWatchlist(loadWatchlist().filter((s) => s !== btn.dataset.sym));
      renderWatch();
    }));
  };

  // ② 선택 종목 시그널 상세 — MA/RSI/MACD/볼린저/종합등급/연간 MDD
  const renderDetail = async () => {
    const sym = symSel.value;
    state.mySignalSymbol = sym;
    detailBody.innerHTML = `<p class="compare-empty">계산 중…</p>`;
    try {
      const full = await loadSymbol(sym);
      const closes = full.closes, dates = full.dates;
      const cur = curPriceOf(sym, full);
      const name = symbolDisplayName(sym);

      const maDefs = [5, 20, 60, 120, 200];
      const mas = maDefs.map((n) => ({ n, v: smaAt(closes, n) }));
      const maRows = mas.map(({ n, v }) => {
        if (v == null) return `<tr><td>MA${n}</td><td colspan="3" style="color:var(--text-muted);">데이터 부족(현재 ${closes.length}거래일)</td></tr>`;
        const gap = cur / v - 1;
        let judge = "";
        if (n === 200) {
          judge = gap >= 0.15 ? `<span class="sig-badge sig-alert">🟡 과열권(MA200 +15%↑)</span>`
            : gap <= -0.10 ? `<span class="sig-badge sig-watch">🟢 과매도권(MA200 −10%↓)</span>`
            : Math.abs(gap) <= 0.02 ? `<span class="sig-badge sig-neutral">⚡ MA200 근접(±2%)</span>` : "";
        } else if (Math.abs(gap) <= 0.02) {
          judge = `<span class="sig-badge sig-neutral">⚡ 근접(±2%)</span>`;
        }
        return `<tr><td>MA${n}</td><td style="text-align:right;">${fmtPrice(v, full.currency)}</td>` +
          `<td style="text-align:right; color:${gap >= 0 ? "#d64545" : "#2a78d6"};">${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1)}%</td><td>${judge}</td></tr>`;
      }).join("");

      const valid = mas.filter((m) => m.v != null);
      let arrText = "MA 배열 판정 불가(데이터 부족)";
      if (valid.length >= 3) {
        const vs = valid.map((m) => m.v);
        const bull = vs.every((v, i) => i === 0 || v <= vs[i - 1]);
        const bear = vs.every((v, i) => i === 0 || v >= vs[i - 1]);
        arrText = bull ? "🔔 정배열(단기MA>장기MA) — 추세 상승" : bear ? "☠️ 역배열(단기MA<장기MA) — 추세 하락" : "MA 혼조(교차 진행 중)";
      }

      // 골든/데드크로스 — 최근 5거래일 내 교차만 표시(지어내지 않음)
      const crossMsgs = [];
      const detectCross = (fast, slow, label) => {
        const f = smaSeries(closes, fast), s = smaSeries(closes, slow);
        for (let i = Math.max(1, closes.length - 5); i < closes.length; i++) {
          if (f[i] == null || s[i] == null || f[i - 1] == null || s[i - 1] == null) continue;
          if (f[i - 1] <= s[i - 1] && f[i] > s[i]) crossMsgs.push(`🔔 골든크로스 ${label} (${dates[i]})`);
          if (f[i - 1] >= s[i - 1] && f[i] < s[i]) crossMsgs.push(`☠️ 데드크로스 ${label} (${dates[i]})`);
        }
      };
      detectCross(5, 20, "MA5×MA20");
      detectCross(20, 60, "MA20×MA60");

      const rsiArr = rsiSeries(closes, 14);
      const rsi = rsiArr[rsiArr.length - 1];
      const { macd, signal, hist } = macdSeries(closes);
      const m = macd[macd.length - 1], sg = signal[signal.length - 1], h = hist[hist.length - 1];
      const bb = bollingerLast(closes);
      const pos = pos20d(closes, cur);
      const zone = posZoneInfo(pos);

      // 종합 시그널 — 2개 이상 지표가 같은 방향으로 합의할 때만 매매 시그널(설계 원칙)
      const votes = [];
      if (rsi != null) votes.push({ name: "RSI14", v: rsi <= 30 ? 1 : rsi >= 70 ? -1 : 0,
        text: `${rsi.toFixed(1)} ${rsi <= 30 ? "과매도" : rsi >= 70 ? "과열" : "중립(30~70)"}` });
      // A12: RSI 다이버전스 — 가격 저점/고점 vs RSI 저점/고점 방향 불일치(5번째 투표, MA200 이격과 병행)
      const div = detectRsiDivergence(closes, rsiArr);
      const divVote = div.bull
        ? { name: "RSI 다이버전스", v: 1, text: `강세 감지 — 가격 저점 하락(${dates[div.bull.d1]}→${dates[div.bull.d2]})인데 RSI 저점 상승` }
        : div.bear
        ? { name: "RSI 다이버전스", v: -1, text: `약세 감지 — 가격 고점 상승(${dates[div.bear.d1]}→${dates[div.bear.d2]})인데 RSI 고점 하락` }
        : { name: "RSI 다이버전스", v: 0, text: "미감지(최근 90거래일)" };
      votes.push(divVote);
      if (bb) votes.push({ name: "볼린저 %B", v: bb.pctB <= 0.05 ? 1 : bb.pctB >= 0.95 ? -1 : 0,
        text: `${(bb.pctB * 100).toFixed(0)}% ${bb.pctB <= 0.05 ? "하단 접근" : bb.pctB >= 0.95 ? "상단 접근" : "밴드 내"}` });
      if (h != null) {
        const hp = hist[hist.length - 2];
        const v = hp != null && hp <= 0 && h > 0 ? 1 : hp != null && hp >= 0 && h < 0 ? -1 : 0;
        votes.push({ name: "MACD", v,
          text: `히스토그램 ${h >= 0 ? "+" : ""}${h.toFixed(2)} ${v === 1 ? "상향 전환" : v === -1 ? "하향 전환" : h >= 0 ? "상승 지속" : "하락 지속"}` });
      }
      const ma200 = mas[4].v;
      if (ma200 != null) {
        const gap = cur / ma200 - 1;
        votes.push({ name: "MA200 이격", v: gap <= -0.10 ? 1 : gap >= 0.15 ? -1 : 0,
          text: `${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1)}% ${gap >= 0.15 ? "과열권" : gap <= -0.10 ? "과매도권" : "정상 범위"}` });
      }
      const buyN = votes.filter((x) => x.v === 1).length, sellN = votes.filter((x) => x.v === -1).length;
      const grade = buyN >= 3 ? "🟢 강매수" : buyN >= 2 ? "🟢 매수관심" : sellN >= 3 ? "🔴 강매도" : sellN >= 2 ? "🔴 매도검토" : "⏸ 홀드";
      const gradeCls = buyN >= 2 ? "sig-watch" : sellN >= 2 ? "sig-alert" : "sig-neutral";

      // 가격+MA20/60/200+볼린저 다중선 차트 (최근 1년, null 구간 제외)
      const start = Math.max(0, closes.length - 252);
      const sliceSeries = (vals, label, color) => {
        const ds = [], vs = [];
        for (let i = start; i < closes.length; i++) if (vals[i] != null) { ds.push(dates[i]); vs.push(vals[i]); }
        return ds.length >= 2 ? { label, color, dates: ds, values: vs } : null;
      };
      const bbs = bollingerSeries(closes);
      const chartSeries = [
        sliceSeries(closes, `${name} 종가`, "#eda100"),
        sliceSeries(smaSeries(closes, 20), "MA20", "#2a78d6"),
        sliceSeries(smaSeries(closes, 60), "MA60", "#199e70"),
        sliceSeries(smaSeries(closes, 200), "MA200", "#7b5ec9"),
        sliceSeries(bbs.upper, "볼린저 상단", "#c9a24e"),
        sliceSeries(bbs.lower, "볼린저 하단", "#c9a24e"),
      ].filter(Boolean);

      // 연간 MDD 분포 (연도별 낙폭 리셋)
      const ann = annualMDDs(dates, closes);
      let annHTML = `<p class="compare-empty">연간 MDD를 계산할 데이터가 부족합니다(2개 연도 이상 필요).</p>`;
      if (ann.length >= 2) {
        const vals = ann.map((a) => -a.mdd * 100);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const sortedV = vals.slice().sort((a, b) => a - b);
        const median = sortedV.length % 2 ? sortedV[(sortedV.length - 1) / 2] : (sortedV[sortedV.length / 2 - 1] + sortedV[sortedV.length / 2]) / 2;
        const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (vals.length - 1)) : 0;
        const over50 = vals.filter((v) => v >= 50).length;
        const thisYear = String(new Date().getFullYear());
        const curYear = ann.find((a) => a.year === thisYear);
        const maxBucket = Math.max(30, Math.ceil(Math.max(...vals) / 5) * 5);
        const buckets = [];
        for (let b = 0; b < maxBucket; b += 5) buckets.push({ from: b, count: vals.filter((v) => v >= b && v < b + 5).length });
        const maxCount = Math.max(...buckets.map((b) => b.count), 1);
        const curBucketIdx = curYear ? Math.min(buckets.length - 1, Math.floor((-curYear.mdd * 100) / 5)) : -1;
        const barsHTML = buckets.map((b, i) => `
          <div class="mdd-hist-col${i === curBucketIdx ? " mdd-hist-cur" : ""}">
            <div class="mdd-hist-count">${b.count || ""}</div>
            <div class="mdd-hist-bar${b.from >= 50 ? " mdd-hist-danger" : b.from >= 35 ? " mdd-hist-warn" : ""}" style="height:${Math.round((b.count / maxCount) * 100)}%"></div>
            <div class="mdd-hist-label">${b.from}%</div>
          </div>`).join("");
        annHTML = `
          <div class="stats" style="margin-top:8px;">
            <div class="stat"><p class="stat-label">평균 MDD</p><p class="stat-value">${mean.toFixed(1)}%</p></div>
            <div class="stat"><p class="stat-label">중앙값 MDD</p><p class="stat-value">${median.toFixed(1)}%</p></div>
            <div class="stat"><p class="stat-label">표준편차</p><p class="stat-value">${sd.toFixed(1)}%</p></div>
            <div class="stat"><p class="stat-label">-50% 이상 하락</p><p class="stat-value">${over50} / ${ann.length}년</p></div>
          </div>
          <div class="mdd-hist">${barsHTML}</div>
          <p class="stat-sub">연간 최대낙폭(매년 낙폭 리셋) 분포 · 분석 ${ann.length}개년(${ann[0].year}~${ann[ann.length - 1].year})${curYear ? ` · 올해(${thisYear}) MDD <b>${(-curYear.mdd * 100).toFixed(1)}%</b> — 테두리 강조 구간` : ""}</p>`;
      }

      // A11a: RSI/MACD/볼린저 3줄 요약 + 종합평가 1줄 (기존 계산값 재사용)
      const rsiLine = rsi == null ? "데이터 부족"
        : `RSI14 ${rsi.toFixed(1)} — ${rsi <= 30 ? "과매도 구간(반등 가능성 주시)" : rsi >= 70 ? "과열 구간(과매수 주의)" : "중립(30~70), 방향성 약함"}`;
      const macdLine = h == null ? "MACD 데이터 부족"
        : `MACD 히스토그램 ${h >= 0 ? "+" : ""}${h.toFixed(2)} — ${(() => {
            const hp = hist[hist.length - 2];
            if (hp != null && hp <= 0 && h > 0) return "상향 전환(단기 반등 신호)";
            if (hp != null && hp >= 0 && h < 0) return "하향 전환(단기 조정 신호)";
            return h >= 0 ? "상승 모멘텀 지속(시그널선 위)" : "하락 모멘텀 지속(시그널선 아래)";
          })()}`;
      const bbLine = bb == null ? "볼린저 데이터 부족"
        : `볼린저 %B ${(bb.pctB * 100).toFixed(0)}% — ${bb.pctB <= 0.05 ? "하단 접근(눌림 구간)" : bb.pctB >= 0.95 ? "상단 접근(과열 구간)" : "밴드 내 정상"}, 밴드폭 ${(bb.bandwidth * 100).toFixed(1)}%(변동성 ${bb.bandwidth >= 0.15 ? "높음" : "보통"})`;
      const divLine = divVote.v === 1 ? `${divVote.text} → 반등 가능성 신호`
        : divVote.v === -1 ? `${divVote.text} → 상승 동력 약화 신호`
        : "다이버전스 미감지 — 가격과 RSI의 고점/저점 방향이 일치(최근 90거래일)";
      const verdictText = buyN >= 2
        ? `${grade} — 위 지표 중 ${buyN}개가 매수 방향으로 합의`
        : sellN >= 2
        ? `${grade} — 위 지표 중 ${sellN}개가 매도 방향으로 합의`
        : `${grade} — 매수·매도 신호 지표가 각각 2개 미만이라 방향성 불명확, 관망 권장`;
      const summaryCardHTML = `
        <div class="sig-summary sig-summary-${buyN >= 2 ? "buy" : sellN >= 2 ? "sell" : "hold"}">
          <p class="sig-summary-line">① ${rsiLine}</p>
          <p class="sig-summary-line">② ${macdLine}</p>
          <p class="sig-summary-line">③ ${bbLine}</p>
          <p class="sig-summary-line">④ ${divLine}</p>
          <p class="sig-summary-verdict">📌 종합평가: ${verdictText} <span class="sig-summary-note">(참고용 · 투자 조언 아님)</span></p>
        </div>`;

      detailBody.innerHTML = `
        <div class="action-row" style="margin:8px 0;">
          <span class="sig-badge ${gradeCls}" style="font-size:14px;">종합 ${grade}</span>
          <span class="sig-badge ${zone.cls}">20일 포지션 ${pos == null ? "―" : Math.round(pos * 100) + "%"} · ${zone.label}</span>
        </div>
        ${summaryCardHTML}
        <div style="max-width:420px;">${sigGaugeHTML(pos)}</div>
        <p class="stat-sub">종합 시그널은 아래 지표 중 <b>2개 이상이 같은 방향일 때만</b> 매수/매도로 판정합니다(단일 지표 터치·크로스만으로 매매하지 않음). ${votes.map((v) => `<b>${v.name}</b> ${v.text}`).join(" · ")}</p>
        <p class="stat-sub"><b>${arrText}</b> · ${crossMsgs.length ? crossMsgs.join(" · ") : "최근 5거래일 내 MA 교차 없음"}</p>
        <div style="overflow-x:auto;"><table class="account-summary-table">
          <thead><tr><th>이동평균</th><th>값</th><th>현재가 이격</th><th>신호</th></tr></thead>
          <tbody>${maRows}</tbody></table></div>
        <p class="stat-sub">현재가 ${fmtPrice(cur, full.currency)} 기준 · RSI14 <b>${rsi == null ? "―" : rsi.toFixed(1)}</b> · MACD ${m == null ? "―" : m.toFixed(2)} / 시그널 ${sg == null ? "―" : sg.toFixed(2)} / 히스토그램 ${h == null ? "―" : (h >= 0 ? "+" : "") + h.toFixed(2)} · 볼린저(20일·2σ) ${bb ? `상단 ${fmtPrice(bb.upper, full.currency)} · 하단 ${fmtPrice(bb.lower, full.currency)} · %B ${(bb.pctB * 100).toFixed(0)}% · 밴드폭 ${(bb.bandwidth * 100).toFixed(1)}%` : "―"}</p>
        <div id="mySignalChart"></div>
        <p class="chart-title" style="margin-top:20px;">📉 연간 MDD 분포 — ${name}</p>
        ${annHTML}`;

      const chartEl = document.getElementById("mySignalChart");
      if (chartEl && chartSeries.length) {
        const fmtAxisPrice = (v) => full.currency === "KRW"
          ? (v >= 10000 ? (v / 10000).toFixed(1) + "만" : String(Math.round(v)))
          : "$" + (v >= 100 ? v.toFixed(0) : v.toFixed(2));
        buildCompareChart(chartEl, chartSeries, { anchorZero: false, height: 360, fmtAxis: fmtAxisPrice, fmtTip: (v) => fmtPrice(v, full.currency) });
        chartEl.insertAdjacentHTML("beforeend",
          `<p class="stat-sub" style="margin-top:6px;">최근 1년(252거래일) — 종가·MA20/60/200·볼린저(20일·2σ). 주 1회 수집 데이터 기준이라 최신 거래일과 다를 수 있습니다.</p>`);
      }
    } catch (err) {
      detailBody.innerHTML = `<p class="compare-empty" style="color:var(--critical)">지표를 계산하지 못했습니다: ${err.message}</p>`;
    }
  };

  // ③ 주요종목 σ표 — 보유 비중 TOP10 + VOO·QQQ·KODEX200
  const renderSigma = async () => {
    state.mySignalSigmaWin = sigmaWinSel.value;
    const win = Number(sigmaWinSel.value);
    sigmaBody.innerHTML = `<p class="compare-empty">계산 중…</p>`;
    const seen = new Set(), syms = [];
    for (const p of perRow.slice().sort((a, b) => b.value - a.value)) {
      if (syms.length >= 10) break;
      if (p.value > 0 && !seen.has(p.symbol)) { seen.add(p.symbol); syms.push(p.symbol); }
    }
    for (const s of SIGNAL_SIGMA_EXTRA) if (!seen.has(s)) { seen.add(s); syms.push(s); }
    const rows = [];
    for (const sym of syms) {
      try {
        const full = await loadSymbol(sym);
        const close = full.closes[full.closes.length - 1];
        const s252 = dailyReturnSigma(full.closes, 252);
        const s30 = dailyReturnSigma(full.closes, 30);
        const sSel = win === 30 ? s30 : s252;
        const t1 = sSel != null ? close * (1 - sSel / 100) : null;
        const t2 = sSel != null ? close * (1 - 2 * sSel / 100) : null;
        rows.push(`<tr><td>${symbolDisplayName(sym)}</td>
          <td style="text-align:right;">${fmtPrice(close, full.currency)}</td>
          <td style="text-align:right;${win === 252 ? " font-weight:700;" : ""}">${s252 == null ? "―" : s252.toFixed(2) + "%"}</td>
          <td style="text-align:right;${win === 30 ? " font-weight:700;" : ""}">${s30 == null ? "―" : s30.toFixed(2) + "%"}</td>
          <td style="text-align:right;">${t1 == null ? "―" : fmtPrice(t1, full.currency)}</td>
          <td style="text-align:right;">${t2 == null ? "―" : fmtPrice(t2, full.currency)}</td></tr>`);
      } catch (err) {
        rows.push(`<tr><td>${symbolDisplayName(sym)}</td><td colspan="5" style="color:var(--critical);">데이터 없음(${err.message})</td></tr>`);
      }
    }
    sigmaBody.innerHTML = rows.length
      ? `<div style="overflow-x:auto;"><table class="account-summary-table">
          <thead><tr><th>종목 (보유 TOP10 + VOO·QQQ·KODEX200)</th><th>전일종가</th><th>σ 1년</th><th>σ 30일</th><th>1σ 매수가</th><th>2σ 매수가</th></tr></thead>
          <tbody>${rows.join("")}</tbody></table></div>
         <p class="stat-sub">1σ/2σ 매수가는 선택한 σ 기간(굵게 표시) 기준 · 매수가 = 전일종가 × (1 − n×σ). "전일종가"는 주 1회 수집의 마지막 종가입니다.</p>`
      : `<p class="compare-empty">표시할 종목이 없습니다.</p>`;
  };

  // ④ 레버리지 σ 매수가 — 전일종가 기준 1/2/3σ (+ 참고: 52주 전고점 기준)
  const renderLev = async () => {
    const sym = levSel.value;
    state.mySignalLevSymbol = sym;
    const win = Number(sigmaWinSel.value);
    levBody.innerHTML = `<p class="compare-empty">계산 중…</p>`;
    try {
      const full = await loadSymbol(sym);
      const closes = full.closes;
      const close = closes[closes.length - 1];
      const sSel = dailyReturnSigma(closes, win);
      const hi = high52(closes);
      const cur = curPriceOf(sym, full);
      if (sSel == null) {
        levBody.innerHTML = `<p class="compare-empty">σ 계산에 필요한 데이터(${win}거래일)가 부족합니다.</p>`;
        return;
      }
      const rows = [1, 2, 3].map((n) => {
        const target = close * (1 - (n * sSel) / 100);
        const refTarget = hi != null ? hi * (1 - (n * sSel) / 100) : null;
        return `<tr><td>${n}σ (−${(n * sSel).toFixed(2)}%)</td>
          <td style="text-align:right; font-weight:700;">${fmtPrice(target, full.currency)}</td>
          <td style="text-align:right;">${refTarget == null ? "―" : fmtPrice(refTarget, full.currency)}</td>
          <td>${cur <= target ? `<span class="sig-badge sig-watch">▼ 도달(매수 검토)</span>` : ""}</td></tr>`;
      }).join("");
      levBody.innerHTML = `
        <p class="stat-sub">전일종가 <b>${fmtPrice(close, full.currency)}</b> · 52주 전고점 ${hi == null ? "―" : fmtPrice(hi, full.currency)}${hi ? ` (전고점 대비 ${((close / hi - 1) * 100).toFixed(1)}%)` : ""} · σ(${win === 30 ? "30일" : "1년"}) <b>${sSel.toFixed(2)}%</b></p>
        <div style="overflow-x:auto;"><table class="account-summary-table">
          <thead><tr><th>구간</th><th>매수목표가 (전일종가 기준)</th><th>참고: 52주 전고점 기준</th><th>상태</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        <p class="stat-sub">매수목표가 = 전일종가 × (1 − n×σ). "전고점 기준" 열은 노션 SOXL 매수테이블 방식(52주 전고점 × (1 − n×σ)) 참고 병기입니다. 미국 종목의 σ·종가는 주 1회 수집 데이터 기준입니다.</p>`;
    } catch (err) {
      levBody.innerHTML = `<p class="compare-empty" style="color:var(--critical)">계산 실패: ${err.message}</p>`;
    }
  };

  // 초기화 + 와이어링 (state.* 로 선택 보존 — 기존 탭 관례)
  addSel.innerHTML = etfOptionsHTML("SOXX");
  symSel.innerHTML = etfOptionsHTML(state.mySignalSymbol || loadWatchlist()[0] || "SOXL");
  levSel.innerHTML = etfOptionsHTML(state.mySignalLevSymbol || "SOXL");
  if (state.mySignalSigmaWin) sigmaWinSel.value = state.mySignalSigmaWin;
  addBtn.addEventListener("click", () => {
    const sym = addSel.value;
    const list = loadWatchlist();
    if (!list.includes(sym)) { list.push(sym); saveWatchlist(list); renderWatch(); }
  });
  symSel.addEventListener("change", renderDetail);
  sigmaWinSel.addEventListener("change", () => { renderSigma(); renderLev(); });
  levSel.addEventListener("change", renderLev);
  renderWatch();
  renderDetail();
  renderSigma();
  renderLev();
}

function buildMyAssetsText() {
  const cfg = serializeMyAssets();
  const lines = ["[내 자산 보유현황 — " + todayStr() + "]"];
  for (const r of cfg.rows.filter((x) => x.qty > 0)) {
    const meta = state.metaBySymbol.get(r.symbol);
    lines.push(`${r.account || "미지정"} | ${meta ? meta.name : r.symbol} (${r.symbol}) | ${r.qty}주` +
      (r.avgPrice > 0 ? ` | 매입단가 ${r.avgPrice}` : "") +
      (r.monthlyQty > 0 ? ` | 월매수 ${r.monthlyQty}주` : "") +
      (r.confirmedDps > 0 ? ` | 확정 DPS ${r.confirmedDps}원/주` : "") +
      (r.payPeriod ? ` | ${r.payPeriod}` : ""));
  }
  lines.push("", "위 보유현황을 노션 14RAE SOP(매도이력 대장 우선 확인)와 대조해서 갱신해주세요.");
  return lines.join("\n");
}

/* 내 자산 CSV — 시트(금융비서 대시보드)의 종목현황/계좌별/지급시기별 구성과 동일한 형태.
   탭별로 나눠 받을 수 있도록 각 표를 별도 시트(키)로 반환한다. */
function buildMyAssetsSheets(d) {
  const w = (v) => Math.round(v);
  const sheets = {};

  const rowLines = [csvRow(["계좌", "종목", "코드", "수량", "현재가", "평가액(원)", "손익(원)", "DPS(주당)", "DPS구분", "월배당(원)", "지급시기"])];
  for (const p of d.perRow) {
    const ttm = p.meta && p.meta.ttmDividend ? p.meta.ttmDividend : 0;
    const dps = p.usedConfirmed ? p.confirmedDps : ttm / 12;
    rowLines.push(csvRow([
      p.account || "미지정", p.meta ? p.meta.name : p.symbol, p.symbol, p.qty,
      p.isUsd ? p.close + " USD" : w(p.close),
      w(p.value), p.profit == null ? "" : w(p.profit),
      dps > 0 ? (p.isUsd && !p.usedConfirmed ? dps.toFixed(4) + " USD" : w(dps)) : "",
      p.usedConfirmed ? "확정" : dps > 0 ? "추정(TTM)" : "",
      p.monthlyDiv > 0 ? w(p.monthlyDiv) : "", p.payPeriod || "",
    ]));
  }
  sheets["종목현황"] = rowLines.join("\n");

  const acctLines = [csvRow(["계좌", "종목 수", "평가액(원)", "월배당(원)"])];
  for (const [acc, g] of d.accountMap) acctLines.push(csvRow([acc, g.n, w(g.value), w(g.monthlyDiv)]));
  sheets["계좌별 합계"] = acctLines.join("\n");

  const periodLines = [csvRow(["지급시기", "월배당(원)"])];
  for (const [k, v] of d.periodMap) periodLines.push(csvRow([k, w(v)]));
  sheets["지급시기별"] = periodLines.join("\n");

  const totalLines = [csvRow(["총 평가액(원)", w(d.totalValue)]), csvRow(["총 월배당(원)", w(d.totalMonthlyDiv)])];
  if (d.totalProfit != null) totalLines.push(csvRow(["총 손익(원)", w(d.totalProfit)]));
  sheets["총계"] = totalLines.join("\n");

  return sheets;
}

/* 통합(전체) CSV — 기존처럼 모든 시트를 하나의 파일에 이어 붙인 버전 */
function buildMyAssetsCSV(d) {
  const sheets = buildMyAssetsSheets(d);
  const lines = [];
  for (const [name, body] of Object.entries(sheets)) {
    lines.push(name, body, "");
  }
  return lines.join("\n");
}
