// shared/myassets.js — 내 자산 대시보드 전체(계산+렌더, 9탭 build*HTML 포함)
// index.html에서 추출한 사본(2026-07-06 M1). state/DATA_DIR는 호출 페이지가 선언.
// 의존: shared/myassets-utils.js(fmtPrice/cssVar/buildChart 등), shared/price-data.js(loadSymbol/loadFx/loadLiveKrQuotes 등)

const MY_ASSETS_KEY = "my_assets_v1";
const MY_ASSETS_HISTORY_KEY = "my_assets_history_v1";
const MY_ASSETS_DAILY_HISTORY_KEY = "my_assets_daily_history_v1";
const MY_INCLUDE_STOCKS_KEY = "my_assets_include_stocks_v1"; // "0"이면 일반종목(개별주) 제외
const MY_ASSETS_CHANGELOG_KEY = "my_assets_changelog_v1";
const MY_ASSETS_WATCHLIST_KEY = "my_assets_watchlist_v1"; // A10 📡 시그널 탭 워치리스트, 최대 300건, A3b/c: 폼 채우기·가져오기 시 변경 이력
const MY_SIGNAL_DECISIONS_KEY = "my_signal_decisions_v1"; // A14 트레이드플랜 결정메모(승인/보류/거부), 최대 200건

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
  if (!csv) return { totalValue: 0, byAccount: {}, mdd: null };
  const byAccount = {};
  for (const [acc, g] of csv.accountMap) byAccount[acc] = g.value;
  // A26b: 이 함수는 계좌 변동 직전/직후에 각각 호출되므로(호출부 6곳), 여기서 MDD를 함께
  // 담아두면 호출부를 하나도 고치지 않고 before/after MDD가 changelog에 그대로 남는다.
  const m = portfolioMDD(csv.perRow);
  return { totalValue: csv.totalValue, byAccount, mdd: m ? m.mdd : null };
}

/* ---------- A25a: 월별 스냅샷 자동 기록(계좌별·카테고리별 비중 포함) ----------
   종전에는 "📸 이번 달 스냅샷 저장" 버튼을 눌러야만 쌓여서 이력이 거의 남지 않았고, 비중
   정보도 없었다. 계좌를 갱신(캡처 반영·가져오기)하면 그 달 스냅샷이 자동으로 갱신되게 한다.
   비중(%)이 아니라 **평가액**을 저장한다 — 나중에 그룹이 늘어도 합이 깨지지 않고, 화면에서
   나눠 쓰면 되기 때문. 같은 달이면 덮어쓴다(수동 버튼과 동일 규칙). */
/* mddOverride: pushAssetChangelog가 방금 계산해둔 afterSnap.mdd를 넘겨 재계산을 아낀다.
   수동 "📸 이번 달 스냅샷 저장" 버튼 경로는 인자 없이 불러 여기서 직접 계산한다. */
function upsertMonthlySnapshot(mddOverride) {
  const csv = state.myAssetsCsvData;
  if (!csv) return; // 아직 렌더 전이면 기록할 값이 없음
  const month = todayStr().slice(0, 7);
  const byAccount = {};
  for (const [acc, g] of csv.accountMap) byAccount[acc] = g.value;
  const byCategory = {};
  for (const p of csv.perRow) {
    if (!(p.value > 0)) continue;
    const k = (p.meta && p.meta.category) || "미분류";
    byCategory[k] = (byCategory[k] || 0) + p.value;
  }
  const dpsBySymbol = {};
  for (const p of csv.perRow) if (p.confirmedDps > 0) dpsBySymbol[p.symbol] = p.confirmedDps;

  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(MY_ASSETS_HISTORY_KEY) || "[]"); } catch (e) { hist = []; }
  // A26b: 월 단위 MDD 이력이 비중 이력과 같은 주기로 쌓인다(추이 탭 "MDD 이력" 표의 재료).
  let mdd = mddOverride;
  if (mdd === undefined) { const m = portfolioMDD(csv.perRow); mdd = m ? m.mdd : null; }
  const entry = { month, value: csv.totalValue, monthlyDiv: csv.totalMonthlyDiv, mdd, dpsBySymbol, byAccount, byCategory };
  const idx = hist.findIndex((h) => h.month === month);
  if (idx >= 0) hist[idx] = entry; else hist.push(entry);
  hist.sort((a, b) => a.month.localeCompare(b.month));
  localStorage.setItem(MY_ASSETS_HISTORY_KEY, JSON.stringify(hist));
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
    // A26b: 이 변동이 계좌 전체 낙폭을 어떻게 바꿨는지. 구버전 엔트리엔 없으므로 화면에서
    // 두 값이 다 있을 때만 줄을 그린다(없는 값을 0으로 지어내지 않는다).
    beforeMdd: beforeSnap.mdd != null ? beforeSnap.mdd : null,
    afterMdd: afterSnap.mdd != null ? afterSnap.mdd : null,
  });
  localStorage.setItem(MY_ASSETS_CHANGELOG_KEY, JSON.stringify(log.slice(0, 300)));
  // A25a: 계좌가 실제로 바뀐 시점이므로 이번 달 스냅샷(비중 포함)도 함께 갱신한다 —
  // 수동 버튼을 누르지 않아도 월별 이력이 쌓이게 하는 것이 이 호출의 목적.
  // A26b: 방금 계산한 변동 직후 MDD를 넘겨 같은 시리즈를 두 번 계산하지 않게 한다.
  upsertMonthlySnapshot(afterSnap.mdd != null ? afterSnap.mdd : null);
  // MY_ASSETS_KEY 안에도 이력이 사본으로 박제돼 있어(applyMyAssets가 앱 재시작 시 그 사본으로
  // 각 이력 키를 되씌운다) 방금 쓴 값을 saveMyAssets()로 즉시 동기화해두지 않으면, 앱을
  // 재실행했을 때 이 changelog 항목이 사라진다(2026-08-01 실사례: 스냅샷 항목 소실과 동일 원인).
  if (typeof saveMyAssets === "function") saveMyAssets();
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
    <div class="portfolio-weight-wrap">
      <input type="number" class="my-div-rate portfolio-weight" style="width:104px" min="0" step="0.01" value="${a.divRate ?? ""}" placeholder="분배율(%,선택)" title="월 분배율(%). 입력하면 월배당을 '현재가×분배율'로 계산해 주가 등락이 바로 반영됩니다(노션 배당기준 마스터의 배당률)."> %
    </div>
    <select class="my-period" aria-label="지급시기">${payPeriodOptionsHTML(a.payPeriod)}</select>
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
      divRate: parseFloat(el.querySelector(".my-div-rate").value) || 0,
      payPeriod: normalizePayPeriod(el.querySelector(".my-period").value),
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
    signalDecisions: (() => { try { return JSON.parse(localStorage.getItem(MY_SIGNAL_DECISIONS_KEY) || "[]"); } catch (e) { return []; } })(),
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
  if (Array.isArray(data.signalDecisions) && data.signalDecisions.length) localStorage.setItem(MY_SIGNAL_DECISIONS_KEY, JSON.stringify(data.signalDecisions.slice(0, 200)));
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
function buildReturnAnalysisHTML(regionRetMap, styleRetMap, accountMap, history, perRow) {
  const fmtW = (v) => fmtPrice(v, "KRW");

  /* A27d: 손익 셀 한 벌 — 지역별·계좌별·성향별이 전부 같은 계산이라 한 곳에 모은다.
     profit = costedValue - cost 로 재는 이유: value에는 매입단가 미입력분까지 들어 있어
     value - cost 를 쓰면 분자만 부풀어 손익이 과대계상된다(분자·분모 모집단 일치 원칙). */
  const returnRowsHTML = (entries) => entries.map(([label, g]) => {
    const costedValue = g.costedValue || 0;
    const profit = g.cost > 0 ? costedValue - g.cost : null;
    const pct = g.cost > 0 ? (profit / g.cost) * 100 : null;
    // 매입단가를 일부만 입력한 그룹은 "몇 %가 계산에 들어갔는지"를 밝혀야 오해가 없다.
    const coverage = g.value > 0 ? (costedValue / g.value) * 100 : 0;
    const partial = profit != null && coverage < 99.5
      ? `<br><span class="stat-sub" style="font-size:11px;">평가액의 ${coverage.toFixed(0)}%만 반영</span>` : "";
    return `<tr><td>${label}</td><td>${fmtW(g.value)}</td>
      <td style="color:${profit == null ? "var(--text-muted)" : profit >= 0 ? "var(--good)" : "var(--critical)"}">${profit == null ? "<span title='매입단가 미입력 — 매입원가를 알 수 없어 계산 불가'>—</span>" : `${profit >= 0 ? "+" : ""}${fmtW(profit)}<br><span style="font-size:12px;">(${pct.toFixed(1)}%)</span>`}${partial}</td></tr>`;
  }).join("");

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
  const STYLE_ORDER_RET = ["성장", "배당", "안전", "개별주", "미분류"];
  const regionReturnRows = returnRowsHTML(REGION_ORDER.filter((r) => regionRetMap.has(r)).map((r) => [r, regionRetMap.get(r)]));
  // A27d: 계좌별·성향별 수익률 — 사용자가 따로 입력하는 값이 아니라, 캡처·가져오기로 계좌를
  // 갱신할 때 함께 들어오는 매입단가(avgPrice)에서 그대로 파생된다.
  const accountReturnRows = returnRowsHTML(
    [...accountMap.entries()].filter(([, g]) => g.value > 0).sort((a, b) => b[1].value - a[1].value));
  const styleReturnRows = returnRowsHTML(STYLE_ORDER_RET.filter((s) => styleRetMap.has(s)).map((s) => [s, styleRetMap.get(s)]));

  /* A27e: 종목 수익률 TOP5 / WORST5 — 매입단가 입력분만 대상(원가를 모르면 수익률이 없다). */
  const rankable = (perRow || [])
    .filter((p) => p.cost > 0 && p.profit != null)
    .map((p) => ({ p, pct: (p.profit / p.cost) * 100 }))
    .sort((a, b) => b.pct - a.pct);
  const rankRowsHTML = (list) => list.map(({ p, pct }) => {
    const color = pct >= 0 ? "var(--good)" : "var(--critical)";
    return `<tr>
      <td>${(p.meta && p.meta.name) || p.symbol}<br><span class="stat-sub" style="font-size:11.5px;">${p.account || "계좌 미지정"}</span></td>
      <td>${fmtW(p.value)}</td>
      <td style="color:${color}">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%<br><span style="font-size:11.5px;">${p.profit >= 0 ? "+" : ""}${fmtW(p.profit)}</span></td></tr>`;
  }).join("");
  const rankTableHTML = (list) => `<div style="overflow-x:auto;"><table class="account-summary-table">
      <thead><tr><th>종목 · 계좌</th><th>평가액</th><th>수익률 · 손익</th></tr></thead>
      <tbody>${rankRowsHTML(list)}</tbody>
    </table></div>`;
  // 모집단이 10건 미만이면 TOP과 WORST가 같은 종목을 중복 표시하게 되므로 반씩 나눠 자른다.
  const rankN = Math.min(5, Math.floor(rankable.length / 2)) || (rankable.length ? 1 : 0);
  const rankHTML = rankable.length === 0
    ? `<p class="compare-empty">매입단가를 입력한 종목이 없어 수익률 순위를 계산할 수 없습니다 — 캡처 반영이나 가져오기로 매입단가가 들어오면 자동으로 표시됩니다.</p>`
    : `<p class="chart-title" style="margin-top:20px; font-size:13.5px;">🏆 수익률 TOP${rankN}</p>
       ${rankTableHTML(rankable.slice(0, rankN))}
       <p class="chart-title" style="margin-top:20px; font-size:13.5px;">🔻 수익률 WORST${rankN}</p>
       ${rankTableHTML(rankable.slice(-rankN).reverse())}
       <p class="stat-sub" style="margin-top:6px;">매입단가를 입력한 ${rankable.length}종목만 순위에 들어갑니다(전체 보유 ${(perRow || []).length}종목).</p>`;

  // 시가배당률 = 연배당 ÷ 평가액(현재가·"최신시세" 켜져있으면 실시간 조회가 기준)
  // 투자배당률(YOC) = 연배당 ÷ 매입원가 — 매입단가 입력분에서만 계산 가능
  const marketYield = (div, value) => value > 0 ? (div * 12 / value) * 100 : 0;
  const costYield = (div, cost) => cost > 0 ? (div * 12 / cost) * 100 : null;

  const accountYieldEntries = [...accountMap.entries()].filter(([, g]) => g.value > 0)
    .sort((a, b) => marketYield(b[1].monthlyDiv, b[1].value) - marketYield(a[1].monthlyDiv, a[1].value));
  const accountYieldRows = accountYieldEntries.map(([acc, g]) => {
    const cy = costYield(g.monthlyDiv, g.cost);
    return `<tr><td>${acc}</td><td>${fmtW(g.value)}<br><span class="stat-sub" style="font-size:11.5px;">월배당 ${g.monthlyDiv > 0 ? fmtW(g.monthlyDiv) : "—"}</span></td>
      <td>${marketYield(g.monthlyDiv, g.value).toFixed(2)}%<br><span class="stat-sub" style="font-size:11.5px;">${cy == null ? "<span title='매입단가 미입력 — 매입원가를 알 수 없어 계산 불가'>YOC —</span>" : "YOC " + cy.toFixed(2) + "%"}</span></td></tr>`;
  }).join("");

  const STYLE_ORDER = ["성장", "배당", "안전", "개별주", "미분류"];
  const weightYieldRows = [
    ...REGION_ORDER.filter((r) => regionRetMap.has(r)).map((r) => [r, regionRetMap.get(r)]),
    ...STYLE_ORDER.filter((s) => styleRetMap.has(s)).map((s) => [s, styleRetMap.get(s)]),
  ].map(([label, g]) => {
    const cy = costYield(g.div, g.cost);
    return `<tr><td>${label}</td><td>${fmtW(g.value)}<br><span class="stat-sub" style="font-size:11.5px;">월배당 ${g.div > 0 ? fmtW(g.div) : "—"}</span></td>
      <td>${marketYield(g.div, g.value).toFixed(2)}%<br><span class="stat-sub" style="font-size:11.5px;">${cy == null ? "<span title='매입단가 미입력 — 매입원가를 알 수 없어 계산 불가'>YOC —</span>" : "YOC " + cy.toFixed(2) + "%"}</span></td></tr>`;
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

    <p class="chart-title" style="margin-top:20px;">📁 계좌별 수익률 (매입단가 입력분 기준)</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>계좌</th><th>평가액</th><th>손익</th></tr></thead>
      <tbody>${accountReturnRows}</tbody>
    </table>
    </div>

    <p class="chart-title" style="margin-top:20px;">🎯 성향별 수익률 (매입단가 입력분 기준)</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>성향</th><th>평가액</th><th>손익</th></tr></thead>
      <tbody>${styleReturnRows}</tbody>
    </table>
    </div>
    <p class="stat-sub" style="margin-top:6px;">위 「📈 자산 수익률」은 스냅샷 평가액을 단순 비교한 값(추가 납입·매도 포함)이고, 지역·계좌·성향별 손익은 <b>매입단가 기준 실손익</b>입니다 — 두 값은 서로 다릅니다.</p>

    ${rankHTML}

    <p class="chart-title" style="margin-top:20px;">💰 배당수익률 (계좌별, 연환산)</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>계좌</th><th>평가액 · 월배당</th><th title="위=시가배당률(÷평가액), 아래 YOC=투자배당률(÷매입원가)">배당률<br>시가 / YOC</th></tr></thead>
      <tbody>${accountYieldRows}</tbody>
    </table>
    </div>

    <p class="chart-title" style="margin-top:20px;">💰 배당수익률 (비중별: 지역·스타일, 연환산)</p>
    <div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>구분</th><th>평가액 · 월배당</th><th title="위=시가배당률(÷평가액), 아래 YOC=투자배당률(÷매입원가)">배당률<br>시가 / YOC</th></tr></thead>
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

/* A21: 트리맵 셀은 폭이 매우 좁아 종목명이 겹치거나 밀려 보임 — 발행사·유형 단어를
   약어로 줄여 좁은 셀에서도 읽히게 한다(전체 이름은 title 툴팁·확대 클릭 시 그대로 표시). */
const ETF_ISSUER_ABBR = [
  ["KIWOOM", "Q"], ["KODEX", "K"], ["TIGER", "T"], ["PLUS", "PLS"], ["TIME", "TM"],
  ["HANARO", "HN"], ["KBSTAR", "KB"], ["RISE", "RS"], ["ACE", "ACE"], ["SOL", "SOL"],
];
const ETF_WORD_ABBR = [
  ["커버드콜", "CC"], ["액티브", "A"], ["채권", "채"],
];
const STOCK_NAME_ABBR = { "삼성전자": "삼전", "SK하이닉스": "하닉" };
function abbrevEtfName(name) {
  if (STOCK_NAME_ABBR[name]) return STOCK_NAME_ABBR[name];
  let s = name;
  for (const [full, abbr] of ETF_ISSUER_ABBR) {
    if (s.startsWith(full)) { s = abbr + s.slice(full.length); break; }
  }
  for (const [full, abbr] of ETF_WORD_ABBR) s = s.split(full).join(abbr);
  return s;
}

/* A24a: 셀이 작아도 글자 크기가 고정(10.5/11.5/9.5px)이라 좁은 셀에서 종목명이 겹치고
   잘려 보이는 문제 — 셀의 화면상 예상 크기를 계산해 단계별로 글자를 줄이고, 아주 작은
   셀은 부차 정보(비중%·등락%)를 감춰 종목명만 남긴다. 전체 정보는 title 툴팁과 탭 확대
   오버레이(showTmZoom)로 계속 접근할 수 있으므로 정보가 사라지는 건 아니다.
   셀 좌표는 "그룹 사각형(트리맵 전체의 %) × 그룹 내 셀 사각형(그룹 body의 %)" 합성이라
   두 비율을 곱해 화면 픽셀을 근사한다(모바일 기준 폭·높이 상수). */
const TREEMAP_NOMINAL_W = 380, TREEMAP_NOMINAL_H = 460;
function treemapSizeClass(estW, estH) {
  if (estH < 22 || estW < 38) return "tm-xs";
  if (estH < 34 || estW < 64) return "tm-sm";
  if (estH < 48 || estW < 92) return "tm-md";
  return "";
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
      const sizeCls = treemapSizeClass(
        (gr.w / 100) * (r.w / 100) * TREEMAP_NOMINAL_W,
        (gr.h / 100) * (r.h / 100) * TREEMAP_NOMINAL_H,
      );
      return `<div class="tm-cell ${changeColorClass(chg)} ${sizeCls}" style="left:${r.x.toFixed(3)}%;top:${r.y.toFixed(3)}%;width:${r.w.toFixed(3)}%;height:${r.h.toFixed(3)}%;"
        data-tm-name="${label.replace(/"/g, "&quot;")}" data-tm-value="${fmtW(p.value)}" data-tm-pct="${pct.toFixed(1)}%" data-tm-chg="${chgText}"
        title="${label} · ${fmtW(p.value)} · 비중 ${pct.toFixed(1)}% · 등락 ${chgText}">
        <div class="hm-name">${abbrevEtfName(label)}</div>
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

/* A21: 트리맵 셀 확대 오버레이 — 좁은 셀에서 약어·겹친 텍스트로는 알아보기 어려우므로
   탭하면 전체 이름·평가액·비중·등락을 큰 카드로 보여준다(배경 탭 또는 닫기로 해제). */
function showTmZoom(name, value, pct, chg, cellClass) {
  let overlay = document.getElementById("tmZoomOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "tmZoomOverlay";
    overlay.className = "tm-zoom-overlay";
    overlay.addEventListener("click", (evt) => { if (evt.target === overlay) hideTmZoom(); });
    document.body.appendChild(overlay);
  }
  const chgClass = /tm-up/.test(cellClass) ? "tm-up1" : /tm-dn/.test(cellClass) ? "tm-dn1" : "";
  overlay.innerHTML = `<div class="tm-zoom-card">
    <button type="button" class="tm-zoom-close" aria-label="닫기">✕</button>
    <p class="tm-zoom-name">${name}</p>
    <p class="tm-zoom-chg ${chgClass}">${chg}</p>
    <p class="tm-zoom-sub">평가액 ${value} · 비중 ${pct}</p>
  </div>`;
  overlay.querySelector(".tm-zoom-close").addEventListener("click", hideTmZoom);
  overlay.classList.add("open");
}
function hideTmZoom() {
  const overlay = document.getElementById("tmZoomOverlay");
  if (overlay) overlay.classList.remove("open");
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
function buildYearlyDivHTML(divHistory, expectedMonthly, snapshotHistory) {
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
    </div>${momHTML}${buildDivGapHTML(divHistory, expectedMonthly, snapshotHistory)}`;
}

/* ---------- A25c: 확정 배당 vs 실시간 예상 배당 + 괴리율 ----------
   확정(divHistory = 실제 지급된 금액)과 예상(A24c/A25c의 "기준일 종가 × 분배율" 합계)을
   나란히 놓고 괴리율을 보여준다. 월별 스냅샷의 monthlyDiv는 그 달 스냅샷을 찍은 시점의
   예상액이라, 확정치가 함께 있는 달은 "그때 예상이 얼마나 맞았는지"를 사후 검증할 수 있다. */
function buildDivGapHTML(divHistory, expectedMonthly, snapshotHistory) {
  const fmtW = (v) => fmtPrice(v, "KRW");
  const gapText = (exp, act) => {
    const g = (exp - act) / act;
    return `<span style="color:${Math.abs(g) < 0.05 ? "var(--good)" : "var(--critical)"}">${g >= 0 ? "+" : ""}${(g * 100).toFixed(1)}%</span>`;
  };
  const month = todayStr().slice(0, 7);
  const confirmed = (divHistory || {})[month];
  let card = "";
  if (expectedMonthly > 0) {
    card = `<p class="stat-sub" style="margin-top:10px;">이번 달(${month}) 실시간 예상 배당: <b>${fmtW(expectedMonthly)}</b>`
      + (confirmed > 0
        ? ` · 확정 <b>${fmtW(confirmed)}</b> · 괴리율 ${gapText(expectedMonthly, confirmed)}`
        : ` · 확정 <b>미확정</b>(지급 후 이력에 반영됨)`)
      + `</p>`;
  }
  // 과거 달: 스냅샷 예상액 vs 확정액 — 어느 달에 예상이 과대/과소였는지
  const rows = (snapshotHistory || [])
    .filter((h) => h.monthlyDiv > 0 && (divHistory || {})[h.month] > 0)
    .slice(-12)
    .reverse()
    .map((h) => {
      const act = divHistory[h.month];
      return `<tr><td>${h.month}</td><td>${fmtW(h.monthlyDiv)}</td><td>${fmtW(act)}</td><td>${gapText(h.monthlyDiv, act)}</td></tr>`;
    }).join("");
  const table = rows
    ? `<div style="overflow-x:auto; margin-top:8px;">
        <table class="account-summary-table">
          <thead><tr><th>월</th><th>그때 예상</th><th>확정</th><th>괴리율</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        </div>`
    : "";
  if (!card && !table) return "";
  return `${card}${table}<p class="stat-sub" style="margin-top:6px;">예상 &gt; 확정이면 주가 기준 분배율이 실제 지급보다 높게 잡힌 것입니다. 예상액은 각 종목의 배당기준일 종가(기준일 미도래 시 현재가) × 분배율로 계산합니다.</p>`;
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
      <td><button type="button" class="my-daily-del" data-date="${h.date}" title="이 날 기록 삭제"
        style="border:none; background:none; color:var(--critical); cursor:pointer; font-size:15px; padding:2px 6px;">🗑</button></td>
    </tr>`;
  }).join("");
  return `<div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>날짜</th><th>평가액</th><th>전일 대비</th><th>월배당(그 시점)</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <p class="stat-sub" style="margin-top:6px;">최근 ${sorted.length}일 기록(총 ${dailyHistory.length}일 캡처됨).
    A36: 잘못 쌓인 기록은 🗑으로 지웁니다 — 오염된 스냅샷(반영 사고 중에 저장된 값 등)이 남아 있으면
    추이·주간·월별 계산이 전부 그 값을 물고 갑니다.</p>`;
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

/* A24c: 월배당 산출 근거 배지 — 같은 숫자라도 어떤 기준으로 나온 값인지 한눈에 보이게 한다.
   rate=노션 등록 분배율, derived=확정DPS÷현재가 역산, confirmed=확정DPS 고정(폴백), ttm=TTM추정 */
function DIV_BASIS_LABEL(p) {
  // A25c: 어느 날 주가로 계산했는지까지 배지에 넣는다 — 기준일 종가면 그 날짜를, 기준일이
  // 아직 안 왔으면 현재가를 썼다는 사실을 밝혀야 사용자가 숫자를 검산할 수 있다.
  const priceRef = p.divPriceDate ? `기준일 ${p.divPriceDate} 종가` : "현재가";
  if (p.divBasis === "rate") return `분배율 ${(p.effRate * 100).toFixed(2)}%×${priceRef}`;
  if (p.divBasis === "derived") return `역산 ${(p.effRate * 100).toFixed(2)}%×${priceRef}`;
  return `추정(TTM)×${priceRef}`;
}

/* A25c: 배당기준일·매수마감일(T+2) 안내 — 지급시기가 등록된 종목에만 표시 */
function divRecordNoteHTML(p) {
  if (!p.recordDate) return "";
  if (p.recordFuture) {
    return `<br><span style="color:var(--text-muted); font-size:11px;">기준일 ${p.recordDate} 미도래(현재가로 예상)</span>`;
  }
  const buy = p.buyDeadline ? ` · 매수마감 ${p.buyDeadline}(T+2)` : "";
  return `<br><span style="color:var(--text-muted); font-size:11px;">기준일 ${p.recordDate}${buy}</span>`;
}

const CHANGE_TYPE_LABEL = { added: "🆕 신규", removed: "🗑️ 삭제", "qty-changed": "🔁 수량변경" };

/* ---------- A37: 계좌 반영 전/후 변동 리포트 ----------
   changelog 항목은 화면 표에만 있어서, "이번 반영으로 뭐가 바뀌었나"를 남에게 보내거나
   에이전트에게 넘기려면 사람이 다시 옮겨 적어야 했다. 이 함수는 그 한 건을 그대로
   읽을 수 있는 텍스트로 만든다.

   **편입/편출을 맨 위에 따로 뽑는다** — 수량 증감은 자동매수로 설명되지만, 내 자산에
   새로 들어오거나 빠진 종목은 판단이 필요한 사건이고 3protv ETF 리포트와 대조할
   대상이기도 하다(그쪽도 🆕신규편입/🚪편출로 같은 축을 쓴다).

   계좌명은 목적지에 따라 가린다 — buildReportText와 같은 규칙(opts.mask===false면 원문). */
function buildChangeReportText(entry, opts) {
  if (!entry) return null;
  const maskAcc = (opts && opts.mask === false) ? ((s) => s || "계좌 미지정") : ((s) => maskAccountLabel(s || "계좌 미지정"));
  const fmtW = (v) => fmtPrice(v, "KRW");
  const nameOf = (sym) => {
    const m = state.metaBySymbol && state.metaBySymbol.get(sym);
    return m && m.name ? `${m.name}(${sym})` : sym;
  };
  const L = [];
  L.push("🔄 계좌 반영 변동 리포트");
  L.push(`${entry.ts} · ${CHANGE_SOURCE_LABEL[entry.source] || entry.source}`);
  L.push("");

  const dv = entry.afterValue - entry.beforeValue;
  L.push(`총 평가액 ${fmtW(entry.beforeValue)} → ${fmtW(entry.afterValue)}`);
  L.push(`  ${dv >= 0 ? "+" : ""}${fmtW(dv)}${entry.beforeValue > 0 ? ` (${dv >= 0 ? "+" : ""}${((dv / entry.beforeValue) * 100).toFixed(1)}%)` : ""}`);
  if (entry.beforeMdd != null && entry.afterMdd != null) {
    L.push(`계좌 전체 MDD ${(entry.beforeMdd * 100).toFixed(1)}% → ${(entry.afterMdd * 100).toFixed(1)}%`);
  }
  L.push("");

  const added = entry.changes.filter((c) => c.type === "added");
  const removed = entry.changes.filter((c) => c.type === "removed");
  const changed = entry.changes.filter((c) => c.type === "qty-changed");

  if (added.length) {
    L.push(`🆕 편입 ${added.length}건`);
    for (const c of added) L.push(`· ${maskAcc(c.account)} ${nameOf(c.symbol)} ${c.newQty}주`);
    L.push("");
  }
  if (removed.length) {
    L.push(`🚪 편출 ${removed.length}건`);
    for (const c of removed) L.push(`· ${maskAcc(c.account)} ${nameOf(c.symbol)} ${c.oldQty}주 → 0`);
    L.push("");
  }
  if (changed.length) {
    L.push(`🔁 수량변경 ${changed.length}건`);
    for (const c of changed) {
      const d = (c.newQty || 0) - (c.oldQty || 0);
      L.push(`· ${maskAcc(c.account)} ${nameOf(c.symbol)} ${c.oldQty}→${c.newQty} (${d >= 0 ? "+" : ""}${d})`);
    }
    L.push("");
  }

  // 계좌별 전후 — 어느 계좌에서 벌어진 일인지 한눈에
  const accs = new Set([...Object.keys(entry.beforeByAccount || {}), ...Object.keys(entry.afterByAccount || {})]);
  const accRows = [...accs].map((a) => ({
    a, b: (entry.beforeByAccount || {})[a] || 0, f: (entry.afterByAccount || {})[a] || 0,
  })).filter((r) => Math.abs(r.f - r.b) > 0).sort((x, y) => Math.abs(y.f - y.b) - Math.abs(x.f - x.b));
  if (accRows.length) {
    L.push("🏦 계좌별 변동");
    for (const r of accRows) {
      const d = r.f - r.b;
      L.push(`· ${maskAcc(r.a)} ${fmtW(r.b)} → ${fmtW(r.f)} (${d >= 0 ? "+" : ""}${fmtW(d)})`);
    }
    L.push("");
  }

  L.push("※ 편입·편출은 자동매수로 설명되지 않는 사건이라 매도이력 대장 확인이 필요합니다.");
  L.push("※ 보유 ETF의 내부 구성변화는 3protv ETF 리포트(🆕신규편입/🚪편출)와 대조하세요.");
  return L.join("\n");
}

/* A24b: 변동이력 가독성 — 종목변동 수십 건이 쉼표로 이어진 한 문단이라 읽기 어려웠다.
   ① 계좌별로 묶고 ② 종목코드에 등록 종목명을 붙이며 ③ 8건을 넘으면 나머지를 접는다. */
const CHANGELOG_VISIBLE_ITEMS = 8;
function changeSymbolLabel(symbol) {
  const meta = state.metaBySymbol && state.metaBySymbol.get(symbol);
  if (!meta) return symbol; // 아직 수집 목록에 없는 종목은 코드 그대로(이름을 지어내지 않음)
  const code = symbol.replace(/\.KS$/, "");
  return `${meta.name}<span class="chg-code">(${code})</span>`;
}

function changeItemsHTML(changeList) {
  const byAccount = new Map();
  for (const c of changeList) {
    const acc = c.account || "계좌 미지정";
    if (!byAccount.has(acc)) byAccount.set(acc, []);
    byAccount.get(acc).push(c);
  }
  return [...byAccount.entries()].map(([acc, list]) => {
    const li = (c) => `<li>${changeSymbolLabel(c.symbol)} <b>${CHANGE_TYPE_LABEL[c.type] || c.type}</b> <span class="chg-qty">${c.oldQty}→${c.newQty}</span></li>`;
    const head = list.slice(0, CHANGELOG_VISIBLE_ITEMS).map(li).join("");
    const rest = list.slice(CHANGELOG_VISIBLE_ITEMS);
    return `<div class="chg-account">
      <p class="chg-account-name">${acc} <span>${list.length}건</span></p>
      <ul class="chg-list">${head}</ul>
      ${rest.length ? `<details class="chg-more"><summary>…외 ${rest.length}건 펼치기</summary><ul class="chg-list">${rest.map(li).join("")}</ul></details>` : ""}
    </div>`;
  }).join("");
}
const CHANGE_SOURCE_LABEL = { "capture-account": "📸 계좌 캡처", "capture-buyplan": "📈 월매수 캡처", "capture-account-reset": "🆕 완전 신규 업데이트", import: "📂 가져오기", "import-csv": "📄 CSV/TSV 가져오기" };

/* A26b: "📉 MDD 변동: -18.2% → -16.9% (+1.3%p 개선)" 한 줄. 값이 없으면 빈 문자열 —
   변동이력 카드와 추이 탭 MDD 이력이 같은 표기를 쓰도록 여기 한 곳에 둔다. */
function mddChangeLineHTML(beforeMdd, afterMdd) {
  if (beforeMdd == null || afterMdd == null) return "";
  const b = beforeMdd * 100, a = afterMdd * 100, d = a - b;
  const verdict = Math.abs(d) < 0.05 ? "변화 없음" : `${d > 0 ? "+" : ""}${d.toFixed(1)}%p ${d > 0 ? "개선" : "악화"}`;
  return `<p class="stat-sub" style="margin:4px 0;">📉 MDD 변동: ${b.toFixed(1)}% → ${a.toFixed(1)}%
    <span style="color:${d >= 0 ? "var(--good)" : "var(--critical)"}">(${verdict})</span></p>`;
}

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

    // A26b: MDD변동 — 기간 시작 직전 ↔ 종료 직후 계좌 전체 낙폭. MDD는 음수라 값이 커지면
    // (0에 가까워지면) 낙폭이 얕아진 것 = 개선이다. 마스킹 도입 전 구버전 엔트리처럼 두 값 중
    // 하나라도 없으면 줄 자체를 생략한다.
    const mddLine = mddChangeLineHTML(first.beforeMdd, last.afterMdd);

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
      ${weightLines.length ? `<p class="stat-sub" style="margin:4px 0; line-height:1.7;">⚖️ 비중변동: ${weightLines.join(" · ")}</p>` : ""}
      ${mddLine}
      ${changeList.length ? `<p class="stat-sub" style="margin:8px 0 2px;">📦 종목변동 ${changeList.length}건</p>${changeItemsHTML(changeList)}` : ""}
    </div>`;
  }).join("");
  return `${rows}<p class="stat-sub" style="margin-top:6px;">총 ${log.length}건의 변경 이벤트가 기록되어 있습니다(최대 300건, 이 브라우저에만 보관).</p>`;
}

/* ---------- A25b: 월별 포트폴리오 비중 변화 (계좌별·카테고리별) ----------
   A25a가 월별 스냅샷에 byAccount·byCategory(평가액)를 남기므로, 여기서 각 달의 합으로
   나눠 비중(%)을 만들고 전월 대비 %p 증감을 보여준다. 비중을 저장하지 않고 평가액에서
   매번 계산하는 이유는 그룹 구성이 달라져도 합이 100%로 유지되게 하기 위함이다.
   byAccount가 없는 구버전 스냅샷은 값을 지어내지 않고 그 달을 건너뛴다. */
function buildWeightHistoryHTML(history, groupBy) {
  const field = groupBy === "category" ? "byCategory" : "byAccount";
  const months = (history || []).filter((h) => h[field] && Object.keys(h[field]).length);
  if (months.length < 2) {
    const only = months.length === 1 ? " (현재 1개월치만 기록됨)" : "";
    return `<p class="compare-empty">월별 비중 변화는 서로 다른 달의 스냅샷이 2개 이상 쌓여야 표시됩니다${only} — 계좌를 갱신(캡처 반영·가져오기)하면 그 달 스냅샷이 자동으로 기록됩니다.</p>`;
  }
  const recent = months.slice(-12);
  // 열(그룹)은 가장 최근 달의 비중이 큰 순 — 표가 매달 흔들리지 않게 한 기준으로 고정
  const lastMap = recent[recent.length - 1][field];
  const lastTotal = Object.values(lastMap).reduce((a, b) => a + b, 0) || 1;
  const groups = Object.keys(lastMap).sort((a, b) => (lastMap[b] || 0) - (lastMap[a] || 0));
  const pctOf = (map, g) => {
    const tot = Object.values(map).reduce((a, b) => a + b, 0);
    return tot > 0 ? ((map[g] || 0) / tot) * 100 : 0;
  };
  const rows = recent.slice().reverse().map((h, ri, arr) => {
    const prev = arr[ri + 1]; // reverse 상태라 다음 원소가 전월
    const cells = groups.map((g) => {
      const cur = pctOf(h[field], g);
      const d = prev ? cur - pctOf(prev[field], g) : null;
      const dHTML = d == null || Math.abs(d) < 0.05 ? ""
        : `<br><span style="font-size:11px; color:${d >= 0 ? "var(--good)" : "var(--critical)"}">${d >= 0 ? "+" : ""}${d.toFixed(1)}%p</span>`;
      return `<td>${cur.toFixed(1)}%${dHTML}</td>`;
    }).join("");
    return `<tr><td>${h.month}</td>${cells}</tr>`;
  }).join("");
  // 계좌 미지정 비중이 크면 캡처 시 계좌 지정을 놓친 것이므로 눈에 띄게 알린다(A25e)
  const unassigned = groupBy === "category" ? 0 : pctOf(lastMap, "계좌 미지정") || pctOf(lastMap, "미지정");
  const warn = unassigned >= 1
    ? `<p class="stat-sub" style="color:var(--critical); margin-top:6px;">⚠️ 최근 달에 계좌 미지정이 ${unassigned.toFixed(1)}% 있습니다 — 캡처 파싱 때 계좌를 지정하지 않으면 이렇게 남습니다. 캡처 검토표의 "⚡ 계좌 일괄 지정"으로 한 번에 지정한 뒤 다시 반영하세요.</p>`
    : "";
  return `<div style="overflow-x:auto;">
    <table class="account-summary-table">
      <thead><tr><th>월</th>${groups.map((g) => `<th>${g}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>${warn}
    <p class="stat-sub" style="margin-top:6px;">각 달 스냅샷의 평가액을 그 달 합계로 나눈 비중입니다. 아래 숫자는 전월 대비 증감(%p).</p>`;
}

/* ---------- A26c: 📉 계좌 전체 MDD 이력 (추이 탭) ----------
   세 블록으로 나뉜다. 앞 둘은 **지금 보유구성**만 있으면 스냅샷이 하나도 없어도 값이 나오고,
   마지막 하나만 기록이 쌓여야 보인다.
     ① 현재 구성 KPI — 전체기간·최근1년 MDD, 최대낙폭 구간, 전고점 회복 여부
     ② 연도별 MDD — 시그널 탭의 단일 종목 연간 MDD와 같은 방식이되 포트폴리오 전체 기준
     ③ 기록형 이력 — 월별 스냅샷 mdd + 변동이벤트 afterMdd를 시간순으로 합친 표
   전체기간 NAV 시리즈를 한 번만 만들고 나머지는 슬라이스로 파생한다: buildMyBlendPctSeries는
   "sinceDate 이후로 필터 → 교집합"이라 (전체 교집합 ∩ 최근1년) = (최근1년으로 다시 만든 것)이
   같고, MDD는 비율이라 재정규화도 필요 없다. */
function buildMDDHistoryHTML(history, changelog, perRow) {
  const full = portfolioNavSeries(perRow);
  if (!full) {
    return `<p class="compare-empty">보유 종목의 가격 이력이 부족해 계좌 전체 MDD를 계산할 수 없습니다 — 주간 시세 수집이 2회 이상 쌓인 종목이 필요합니다.</p>`;
  }
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const sliceSince = (since) => {
    const i = full.dates.findIndex((d) => d >= since);
    return i >= 0 && full.dates.length - i >= 2
      ? { dates: full.dates.slice(i), navs: full.navs.slice(i) } : null;
  };
  const mddOf = (s) => {
    if (!s) return null;
    const r = calcMDD(s.dates, s.navs);
    return { mdd: r.mdd, peakDate: s.dates[r.peakIdx], troughDate: s.dates[r.troughIdx], recoveredDate: r.recoveryIdx >= 0 ? s.dates[r.recoveryIdx] : null };
  };
  const cur = mddOf(full);
  const y1 = mddOf(sliceSince(benchSinceDate(12)));

  // ① 현재 구성 KPI
  const kpiHTML = `<div class="stats" style="margin-top:8px;">
    <div class="stat"><p class="stat-label">전체기간 MDD</p><p class="stat-value" style="color:var(--critical)">${pct(cur.mdd)}</p><p class="stat-sub">${full.dates[0]} ~ ${full.dates[full.dates.length - 1]}</p></div>
    <div class="stat"><p class="stat-label">최근 1년 MDD</p><p class="stat-value">${y1 ? pct(y1.mdd) : "―"}</p><p class="stat-sub">${y1 ? "최근 12개월 구간" : "1년치 데이터 부족"}</p></div>
    <div class="stat"><p class="stat-label">최대낙폭 구간</p><p class="stat-value" style="font-size:15px;">${cur.peakDate} → ${cur.troughDate}</p><p class="stat-sub">고점에서 저점까지</p></div>
    <div class="stat"><p class="stat-label">회복 여부</p><p class="stat-value" style="font-size:16px; color:${cur.recoveredDate ? "var(--good)" : "var(--critical)"}">${cur.recoveredDate ? "회복 완료" : "미회복"}</p><p class="stat-sub">${cur.recoveredDate ? `${cur.recoveredDate} 전고점 회복` : "아직 전고점 아래"}</p></div>
  </div>`;

  // ② 연도별 MDD
  const annual = annualMDDs(full.dates, full.navs).slice().reverse();
  const annualHTML = annual.length
    ? `<div style="overflow-x:auto;"><table class="account-summary-table" style="margin-top:10px;">
        <thead><tr><th>연도</th><th>MDD</th><th>거래일</th></tr></thead>
        <tbody>${annual.map((a) => `<tr><td>${a.year}</td><td style="color:var(--critical)">${pct(a.mdd)}</td><td>${a.days}일</td></tr>`).join("")}</tbody>
      </table></div>`
    : `<p class="stat-sub">연도별로 나눌 만큼의 가격 이력이 아직 없습니다.</p>`;

  // ③ 기록형 이력 — 월별 스냅샷과 변동이벤트를 시간순으로 합친다.
  //    "2026-08"(월)과 "2026-08-01 12:00"(이벤트)은 문자열 정렬만으로 자연스럽게 섞인다.
  const records = [];
  for (const h of history || []) if (h && h.mdd != null) records.push({ when: h.month, kind: "📸 월별 스냅샷", mdd: h.mdd });
  for (const e of changelog || []) if (e && e.afterMdd != null) records.push({ when: e.ts, kind: CHANGE_SOURCE_LABEL[e.source] || e.source, mdd: e.afterMdd });
  records.sort((a, b) => String(a.when).localeCompare(String(b.when)));

  let recordHTML;
  if (records.length < 2) {
    const only = records.length === 1 ? " (현재 1건만 기록됨)" : "";
    recordHTML = `<p class="compare-empty">MDD 이력은 기록이 2건 이상 쌓여야 표시됩니다${only} — 계좌를 갱신(캡처 반영·가져오기)하면 그 시점 MDD가 자동으로 기록됩니다.</p>`;
  } else {
    const rows = records.slice(-24).reverse().map((r, ri, arr) => {
      const prev = arr[ri + 1]; // reverse 상태라 다음 원소가 직전 기록
      const d = prev ? (r.mdd - prev.mdd) * 100 : null;
      const dHTML = d == null || Math.abs(d) < 0.05 ? "―"
        : `<span style="color:${d > 0 ? "var(--good)" : "var(--critical)"}">${d > 0 ? "+" : ""}${d.toFixed(1)}%p ${d > 0 ? "개선" : "악화"}</span>`;
      return `<tr><td>${r.when}</td><td>${r.kind}</td><td style="color:var(--critical)">${pct(r.mdd)}</td><td>${dHTML}</td></tr>`;
    }).join("");
    recordHTML = `<div style="overflow-x:auto;"><table class="account-summary-table" style="margin-top:10px;">
      <thead><tr><th>시점</th><th>기록 계기</th><th>MDD</th><th>직전 대비</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  return `${kpiHTML}
    <p class="chart-title" style="margin-top:20px; font-size:13.5px;">📆 연도별 MDD</p>
    ${annualHTML}
    <p class="chart-title" style="margin-top:20px; font-size:13.5px;">🗂️ 기록된 MDD 이력</p>
    ${recordHTML}
    <p class="stat-sub" style="margin-top:8px;">현재 보유 비중으로 과거 가격이력을 합성한 낙폭입니다 — 실제 계좌 평가액 낙폭(입출금·매수 포함)과는 다릅니다.</p>`;
}

/* ---------- A27c: 그룹별 MDD (계좌별 / 성향별) ----------
   A26의 전체 MDD 하나만으로는 "어느 계좌가·어느 성향이 낙폭을 키웠나"를 알 수 없다.
   portfolioMDD는 넘겨받은 배열에서 가중치를 다시 계산하므로 perRow를 그룹으로 쪼개
   그대로 넣기만 하면 된다(계산 함수 수정 불필요).
   groupBy: "account" | "style". 가격이력이 모자란 그룹은 값을 지어내지 않고 "데이터 부족". */
const MDD_GROUP_KEY = {
  account: (p) => p.account || "계좌 미지정",
  style: (p) => (p.meta && p.meta.style) || "미분류",
};

function buildMDDBreakdownHTML(perRow, groupBy) {
  const keyOf = MDD_GROUP_KEY[groupBy] || MDD_GROUP_KEY.account;
  const rows = (perRow || []).filter((p) => p.value > 0);
  if (!rows.length) return `<p class="compare-empty">보유 종목이 없어 그룹별 MDD를 계산할 수 없습니다.</p>`;

  const groups = new Map();
  for (const p of rows) {
    const k = keyOf(p);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const totalValue = rows.reduce((a, p) => a + p.value, 0) || 1;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;

  /* 구간을 반드시 맞춰야 한다. 그룹마다 보유 종목이 달라 각자의 공통일자 교집합도 다른데,
     그대로 두면 이력이 긴 종목만 든 그룹이 더 오래된 구간까지 훑어 **기계적으로** 더 깊은
     MDD가 나온다(실측: 개별주 단독 그룹이 1990년까지 거슬러 -99%, 같은 표의 배당 그룹은
     2023년부터라 -18%). 그렇게 나온 두 수를 나란히 놓으면 비교가 성립하지 않는다.
     이 표의 목적이 "어느 그룹이 더 빠졌나"이므로 전체 포트폴리오의 공통 시작일을 모든
     그룹에 강제한다. */
  const allSeries = portfolioNavSeries(rows);
  if (!allSeries) return `<p class="compare-empty">보유 종목의 가격 이력이 부족해 그룹별 MDD를 계산할 수 없습니다 — 주간 시세가 2회 이상 쌓인 종목이 필요합니다.</p>`;
  const since = allSeries.dates[0];
  const windowEnd = allSeries.dates[allSeries.dates.length - 1];
  const mddSince = (list) => {
    const s = buildMyBlendPctSeries(list, since);
    if (!s || s.dates.length < 2) return null;
    const r = calcMDD(s.dates, s.values.map((v) => 1 + v));
    return {
      mdd: r.mdd, peakDate: s.dates[r.peakIdx], troughDate: s.dates[r.troughIdx],
      recoveredDate: r.recoveryIdx >= 0 ? s.dates[r.recoveryIdx] : null,
    };
  };

  // 전체 MDD를 같은 구간으로 병기해야 그룹 값이 깊은지 얕은지 판단이 된다.
  const all = mddSince(rows);
  const body = [...groups.entries()]
    .map(([name, list]) => ({ name, list, value: list.reduce((a, p) => a + p.value, 0) }))
    .sort((a, b) => b.value - a.value)
    .map(({ name, list, value }) => {
      const m = mddSince(list);
      const share = (value / totalValue) * 100;
      if (!m) {
        return `<tr><td>${name}</td><td>${fmtPrice(value, "KRW")}</td><td>${share.toFixed(1)}%</td>
          <td colspan="3" class="stat-sub">가격이력 부족 — 계산 불가</td></tr>`;
      }
      return `<tr><td>${name}</td><td>${fmtPrice(value, "KRW")}</td><td>${share.toFixed(1)}%</td>
        <td style="color:var(--critical)">${pct(m.mdd)}</td>
        <td>${m.peakDate} → ${m.troughDate}</td>
        <td style="color:${m.recoveredDate ? "var(--good)" : "var(--critical)"}">${m.recoveredDate ? "회복" : "미회복"}</td></tr>`;
    }).join("");

  return `${all ? `<p class="stat-sub" style="margin:4px 0;">전체 기준 MDD <b style="color:var(--critical)">${pct(all.mdd)}</b> (${all.peakDate} → ${all.troughDate}) — 아래 그룹 값과 비교해 보세요. 분산이 잘 됐다면 전체가 개별 그룹보다 얕습니다.</p>` : ""}
    <p class="stat-sub" style="margin:4px 0;">모든 그룹을 <b>${since} ~ ${windowEnd}</b> 같은 구간으로 맞춰 계산했습니다 — 상장이 늦은 종목이 있으면 그 종목 때문에 공통 구간이 짧아집니다.</p>
    <div style="overflow-x:auto;"><table class="account-summary-table">
      <thead><tr><th>구분</th><th>평가액</th><th>비중</th><th>MDD</th><th>최대낙폭 구간</th><th>회복</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/* ---------- A32e: 내 포트폴리오 vs VOO·QQQ·SCHD MDD 동일기준 비교 ----------
   buildMDDBreakdownHTML의 "공통 구간 정렬"과 같은 원리 — 벤치마크는 대개 포트폴리오보다
   상장이 훨씬 오래돼(예: QQQ 1999년) 그대로 각자 전체기간 MDD를 병기하면 비교가 안 된다.
   내 포트폴리오 + 세 벤치마크의 시작일 중 가장 늦은 날 ~ 종료일 중 가장 이른 날로 전부
   맞춘 뒤 같은 calcMDD로 계산한다. 데이터가 없는 벤치마크만 조용히 빠진다(값을 지어내지 않음). */
const MDD_BENCHMARK_SYMBOLS = ["VOO", "QQQ", "SCHD"];

async function computeBenchmarkMDDCompare(perRow) {
  const full = portfolioNavSeries(perRow);
  if (!full) return null;
  const benchData = [];
  for (const symbol of MDD_BENCHMARK_SYMBOLS) {
    try {
      const d = await loadSymbol(symbol);
      if (d && d.dates && d.dates.length >= 2 && d.closes) benchData.push({ symbol, dates: d.dates, closes: d.closes });
    } catch (err) { /* 해당 벤치마크만 제외 */ }
  }
  if (!benchData.length) return null;

  const since = [full.dates[0], ...benchData.map((b) => b.dates[0])].reduce((a, b) => (b > a ? b : a));
  const until = [full.dates[full.dates.length - 1], ...benchData.map((b) => b.dates[b.dates.length - 1])].reduce((a, b) => (b < a ? b : a));

  const mddCommon = (dates, values) => {
    const si = dates.findIndex((d) => d >= since);
    let ei = -1;
    for (let i = 0; i < dates.length; i++) { if (dates[i] <= until) ei = i; else break; }
    if (si < 0 || ei < si + 1) return null;
    const ds = dates.slice(si, ei + 1), vs = values.slice(si, ei + 1);
    const r = calcMDD(ds, vs);
    return { mdd: r.mdd, peakDate: ds[r.peakIdx], troughDate: ds[r.troughIdx], recoveredDate: r.recoveryIdx >= 0 ? ds[r.recoveryIdx] : null };
  };

  const rows = [{ name: "내 포트폴리오", m: mddCommon(full.dates, full.navs) }];
  for (const b of benchData) rows.push({ name: b.symbol, m: mddCommon(b.dates, b.closes) });
  return { since, until, rows };
}

function buildBenchmarkMDDHTML(cmp) {
  if (!cmp) return `<p class="compare-empty">벤치마크 가격 이력이 부족해 비교할 수 없습니다.</p>`;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const body = cmp.rows.map(({ name, m }) => m
    ? `<tr><td>${name}</td><td style="color:var(--critical)">${pct(m.mdd)}</td><td>${m.peakDate} → ${m.troughDate}</td><td style="color:${m.recoveredDate ? "var(--good)" : "var(--critical)"}">${m.recoveredDate ? "회복" : "미회복"}</td></tr>`
    : `<tr><td>${name}</td><td colspan="3" class="stat-sub">데이터 부족</td></tr>`).join("");
  return `<p class="stat-sub" style="margin:4px 0;">공통 구간 <b>${cmp.since} ~ ${cmp.until}</b>으로 맞춰 계산했습니다(내 포트폴리오와 VOO·QQQ·SCHD 중 가장 늦게 시작한 시점부터).</p>
    <div style="overflow-x:auto;"><table class="account-summary-table">
      <thead><tr><th>구분</th><th>MDD</th><th>최대낙폭 구간</th><th>회복</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/* A29: 계좌별 월별 손익 차트를 실제로 그린다 — 환율 이력(loadFx)을 매번 새로 불러오지
   않도록 fetchJSON 자체 캐시(state.cache의 "fx:USDKRW" 키)에 의존한다. accountKey="__all__"
   이면 전체 계좌(perRow 전체)를 하나로 합쳐서 계산한다. */
async function renderMonthlyPnlChart(accountKey) {
  const container = document.getElementById("myMonthlyPnlChart");
  if (!container) return;
  const csv = state.myAssetsCsvData;
  if (!csv) return;
  const rows = accountKey === "__all__" ? csv.perRow : csv.perRow.filter((p) => (p.account || "계좌 미지정") === accountKey);
  container.innerHTML = `<p class="compare-empty">불러오는 중…</p>`;
  const fx = await loadFx();
  const daily = accountMonthlyValueSeries(rows, fx);
  if (!daily) {
    container.innerHTML = `<p class="compare-empty">가격 이력이 부족해 월별 손익을 계산할 수 없습니다 — 주간 시세가 2회 이상 쌓인 종목이 필요합니다.</p>`;
    return;
  }
  const months = monthlyPnlFromDailySeries(daily).slice(-24); // 최근 24개월
  buildMonthlyBarChart(container, months, { emptyMsg: "아직 월이 하나뿐이라 손익을 비교할 전월이 없습니다." });
}

/* ---------- A30: 계좌별·종합 계획 달성현황 ----------
   참고 화면(다른 브로커 앱의 "○○펀드 계획 달성현황")을 재현한다: 지금까지의 적립액+가정
   수익률로 "계획대로면 지금 얼마여야 하는지"를 실제 자산과 대조한다.
   비교 수익률 2개(rate1/rate2)는 사용자 확정 규칙 —
     · 기대수익률(#myExpectedReturn) 입력값이 있으면 rate1 = 그 값, 없으면 rate1 = S&P500
       추세수익률(SPY 트레일링 연환산, sp500ExpectedReturn()).
     · rate2 = rate1 × 2 (참고 화면의 7%→14%와 같은 비율).
   원금(성장 없이 적립만 했을 때)도 같은 lump0·monthly로 rate=0을 fvProjectionSeries에
   넣어 뽑는다 — 계획선·원금선이 전부 같은 공식이라 서로 비교 가능하다(다른 산식을 섞지
   않음). 시작점(t0)은 월별 스냅샷 이력의 첫 기록 — 그 이전 이력은 이 앱이 갖고 있지
   않으므로 "계좌 개설 이후 전체"가 아니라 "이 앱으로 추적하기 시작한 이후"의 계획 대조임을
   화면에 명시한다. */

let __sp500RateCache = null;
async function sp500ExpectedReturn() {
  if (__sp500RateCache != null) return __sp500RateCache;
  try {
    const spy = await loadSymbol("SPY");
    const months = Math.min(120, spy.dates.length - 1); // 최근 10년(부족하면 있는 만큼)
    const r = trailingReturnAnnualized(spy.dates, spy.closes, months);
    __sp500RateCache = r != null ? r : 0.07; // 계산 불가 시 보수적 기본값으로 폴백(값을 지어내지 않되 UI가 멈추지 않게)
  } catch (err) {
    __sp500RateCache = 0.07;
  }
  return __sp500RateCache;
}

/* scope: "__all__" 또는 계좌명. sp500Rate는 매번 다시 구하지 않도록 호출부가 미리 구해 넘긴다.
   반환 null = 월별 스냅샷 이력이 부족해 계산할 수 없음(값을 지어내지 않음). */
function computeGoalPlanData(scope, sp500Rate) {
  const csv = state.myAssetsCsvData;
  if (!csv) return null;
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(MY_ASSETS_HISTORY_KEY) || "[]"); } catch (e) { hist = []; }
  hist = hist.slice().sort((a, b) => a.month.localeCompare(b.month));

  const isAll = scope === "__all__";
  const withScope = isAll ? hist : hist.filter((h) => h.byAccount && h.byAccount[scope] != null);
  if (withScope.length < 1) return null;
  const t0 = withScope[0];
  const lump0 = isAll ? t0.value : t0.byAccount[scope];
  const nowYm = todayStr().slice(0, 7);
  const elapsed = monthDiffYM(t0.month, nowYm);
  if (elapsed < 1) return null; // 이번 달에 이력이 시작됐으면 아직 "지금까지"를 비교할 수 없음

  const rows = isAll ? csv.perRow : csv.perRow.filter((p) => (p.account || "계좌 미지정") === scope);
  const monthlyBuy = rows.reduce((a, p) => a + (p.monthlyBuy || 0), 0);
  const contributions = serializeMyContributions();
  const monthlyContrib = isAll
    ? Object.values(contributions).reduce((a, b) => a + b, 0)
    : (contributions[scope] || 0);
  const monthly = monthlyBuy + monthlyContrib;

  const expReturnInput = document.getElementById("myExpectedReturn").value;
  const rate1 = expReturnInput !== "" ? Number(expReturnInput) / 100 : sp500Rate;
  const rate2 = rate1 * 2;
  const rate1IsDefault = expReturnInput === "";

  const actualNow = isAll ? csv.totalValue : rows.reduce((a, p) => a + p.value, 0);
  const plan1Now = fvProjectionSeries(lump0, monthly, rate1, elapsed)[elapsed];
  const plan2Now = fvProjectionSeries(lump0, monthly, rate2, elapsed)[elapsed];
  const principalNow = fvProjectionSeries(lump0, monthly, 0, elapsed)[elapsed];

  // 차트용 — 실제는 스냅샷이 있는 달까지만, 계획선은 추세를 보여주기 위해 미래로 더 뻗는다.
  const FUTURE_MONTHS = 24;
  const totalMonths = elapsed + FUTURE_MONTHS;
  const [t0y, t0m] = t0.month.split("-").map(Number);
  const planDates = [];
  for (let m = 0; m <= totalMonths; m++) {
    planDates.push(new Date(Date.UTC(t0y, t0m - 1 + m, 1)).toISOString().slice(0, 10));
  }
  const actualSeries = {
    dates: withScope.map((h) => h.month + "-01"),
    values: withScope.map((h) => (isAll ? h.value : h.byAccount[scope])),
  };

  return {
    scope, t0Month: t0.month, lump0, monthly, elapsed, rate1, rate2, rate1IsDefault,
    actualNow, plan1Now, plan2Now, principalNow,
    actualSeries,
    plan1Series: { dates: planDates, values: fvProjectionSeries(lump0, monthly, rate1, totalMonths) },
    plan2Series: { dates: planDates, values: fvProjectionSeries(lump0, monthly, rate2, totalMonths) },
    principalSeries: { dates: planDates, values: fvProjectionSeries(lump0, monthly, 0, totalMonths) },
  };
}

/* 요약 표(구분|금액|GAP|달성률) — 금액기준·수익률기준 공통 골격, cell()만 바꿔 끼운다.
   달성률(실제÷계획×100%)은 두 기준 모두 같은 정의라 basis와 무관하게 항상 같은 값이다. */
function buildGoalPlanTableHTML(d, basis) {
  const fmtW = (v) => fmtPrice(v, "KRW");
  const pctOfPrincipal = (v) => d.principalNow > 0 ? ((v / d.principalNow - 1) * 100) : null;
  const cell = (v) => {
    if (basis === "return") {
      const p = pctOfPrincipal(v);
      return p == null ? "—" : `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
    }
    return fmtW(v);
  };
  const gapCell = (actual, plan) => {
    if (basis === "return") {
      const pa = pctOfPrincipal(actual), pp = pctOfPrincipal(plan);
      if (pa == null || pp == null) return "—";
      const d2 = pa - pp;
      return `${d2 >= 0 ? "+" : ""}${d2.toFixed(1)}%p`;
    }
    return `${actual - plan >= 0 ? "+" : ""}${fmtW(actual - plan)}`;
  };
  const achieveCell = (plan) => plan > 0 ? `${((d.actualNow / plan) * 100).toFixed(0)}%` : "—";
  // A32a: 수기입력 목표액(#myGoalAmount)은 계좌별이 아니라 종합 하나뿐이라 __all__ 스코프에서만 붙인다.
  const gi = state.myAssetsGoalInfo;
  const goalLine = (d.scope === "__all__" && gi)
    ? `<p class="stat-sub">🎯 수기입력 목표 ${fmtManwon(gi.goalAmount)} 도달까지 <b>${gi.goalLabel}</b> (연 ${(gi.goalRate * 100).toFixed(1)}% 가정 — 통합 탭 「🎯 목표 도달」 카드와 동일 계산)</p>`
    : "";
  const rows = [
    ["총자산", d.actualNow, null],
    [`계획(${(d.rate1 * 100).toFixed(1)}%)${d.rate1IsDefault ? " · S&P500" : ""}`, d.plan1Now, d.plan1Now],
    [`계획(${(d.rate2 * 100).toFixed(1)}%)`, d.plan2Now, d.plan2Now],
    ["원금(적립만)", d.principalNow, d.principalNow],
  ];
  const headRow = rows.map(([label]) => `<th>${label}</th>`).join("");
  const amtRow = rows.map(([, v]) => `<td>${cell(v)}</td>`).join("");
  const gapRow = rows.map(([, v, plan]) => `<td>${plan == null ? "—" : gapCell(d.actualNow, plan)}</td>`).join("");
  const achRow = rows.map(([, v, plan]) => `<td>${plan == null ? "—" : achieveCell(plan)}</td>`).join("");
  return `<div style="overflow-x:auto;"><table class="account-summary-table">
    <thead><tr><th>구분</th>${headRow}</tr></thead>
    <tbody>
      <tr><td>${basis === "return" ? "수익률" : "금액"}</td>${amtRow}</tr>
      <tr><td>GAP</td>${gapRow}</tr>
      <tr><td>달성률</td>${achRow}</tr>
    </tbody>
  </table></div>
  <p class="stat-sub" style="margin-top:6px;">${d.t0Month}(이 앱으로 추적을 시작한 첫 달)부터 지금까지 ${d.elapsed}개월, 월 재투자액 ${fmtW(d.monthly)} 가정. 달성률 = 총자산 ÷ 계획금액.</p>
  ${goalLine}`;
}

/* 실제총자산·계획A·계획B·원금 네 선을 buildCompareChart로 겹쳐 그린다(원래 %전용이던
   차트를 opts.fmtAxis/fmtTip·anchorZero=false로 원화·수익률 양쪽에 재사용). */
function buildGoalPlanChartHTML(container, d, basis) {
  const good = cssVar("--good") || "#2e7d32", accent1 = "#2563eb", accent2 = "#f59e0b", muted = cssVar("--text-muted") || "#888";
  let seriesList;
  if (basis === "return") {
    // 원금(t)은 시간에 따라 변하므로 각 시점의 principalSeries 값으로 나눠야 한다 — 날짜 그리드가
    // 다른 actualSeries는 principalSeries를 같은 날짜로 다시 계산(fvProjectionSeries는 폐형식이라
    // 임의 시점 재계산이 싸다)해 정확히 맞춘다.
    const principalAt = (dateStr) => {
      const m = monthDiffYM(d.t0Month, dateStr.slice(0, 7));
      return d.lump0 + d.monthly * m;
    };
    const toPct = (series) => ({
      dates: series.dates,
      values: series.values.map((v, i) => {
        const p = principalAt(series.dates[i]);
        return p > 0 ? (v / p - 1) : 0;
      }),
    });
    seriesList = [
      { ...toPct(d.actualSeries), color: good, label: "실제 총자산" },
      { ...toPct(d.plan1Series), color: accent1, label: `계획(${(d.rate1 * 100).toFixed(1)}%)` },
      { ...toPct(d.plan2Series), color: accent2, label: `계획(${(d.rate2 * 100).toFixed(1)}%)` },
      { dates: d.principalSeries.dates, values: d.principalSeries.values.map(() => 0), color: muted, label: "원금(기준선)" },
    ];
    buildCompareChart(container, seriesList, {
      fmtAxis: (v) => (v * 100).toFixed(0) + "%", fmtTip: (v) => (v * 100).toFixed(1) + "%", anchorZero: false,
    });
  } else {
    seriesList = [
      { ...d.actualSeries, color: good, label: "실제 총자산" },
      { ...d.plan1Series, color: accent1, label: `계획(${(d.rate1 * 100).toFixed(1)}%)` },
      { ...d.plan2Series, color: accent2, label: `계획(${(d.rate2 * 100).toFixed(1)}%)` },
      { ...d.principalSeries, color: muted, label: "원금(적립만)" },
    ];
    buildCompareChart(container, seriesList, {
      fmtAxis: (v) => fmtPrice(v, "KRW"), fmtTip: (v) => fmtPrice(v, "KRW"), anchorZero: false,
    });
  }
}

/* 통합 탭 상단(항상 보이는 헤더)의 간략 카드 — 표만, 차트 없음. */
async function renderGoalPlanCompact() {
  const wrap = document.getElementById("myGoalPlanCompactWrap");
  if (!wrap) return;
  const sp500Rate = await sp500ExpectedReturn();
  const d = computeGoalPlanData("__all__", sp500Rate);
  if (!d) {
    wrap.innerHTML = `<p class="stat-label">📐 계획 달성현황</p><p class="stat-sub">"추이" 탭에서 월별 스냅샷을 2개월 이상 쌓으면 계획 대비 현황이 표시됩니다.</p>`;
    return;
  }
  const fmtW = (v) => fmtPrice(v, "KRW");
  const ach1 = d.plan1Now > 0 ? (d.actualNow / d.plan1Now) * 100 : null;
  // A32a: 통합 탭 "🎯 목표 도달" 카드가 쓰는 수기입력 목표액(#myGoalAmount) 도달 시점을 같이 보여준다.
  const gi = state.myAssetsGoalInfo;
  const goalLine = gi ? `<p class="stat-sub">🎯 수기입력 목표 ${fmtManwon(gi.goalAmount)} 도달까지 <b>${gi.goalLabel}</b> (연 ${(gi.goalRate * 100).toFixed(1)}% 가정)</p>` : "";
  wrap.innerHTML = `<p class="stat-label">📐 계획 달성현황 (계획 ${(d.rate1 * 100).toFixed(1)}%${d.rate1IsDefault ? " · S&P500" : ""} 대비)</p>
    <p class="stat-value" style="font-size:16px; color:${ach1 != null && ach1 >= 100 ? "var(--good)" : "var(--critical)"}">${ach1 != null ? ach1.toFixed(0) + "%" : "—"}</p>
    <p class="stat-sub">실제 ${fmtW(d.actualNow)} vs 계획 ${fmtW(d.plan1Now)} — 「추이」 탭에서 전체 표·차트 확인</p>
    ${goalLine}`;
}

/* 추이 탭의 전체 섹션 — 종합/계좌 select + 금액/수익률 토글, 바뀔 때마다 다시 그린다. */
async function renderGoalPlanSection(scope, basis) {
  const tableEl = document.getElementById("myGoalPlanTable");
  const chartEl = document.getElementById("myGoalPlanChart");
  if (!tableEl || !chartEl) return;
  tableEl.innerHTML = `<p class="compare-empty">불러오는 중…</p>`;
  chartEl.innerHTML = "";
  const sp500Rate = await sp500ExpectedReturn();
  const d = computeGoalPlanData(scope, sp500Rate);
  if (!d) {
    tableEl.innerHTML = `<p class="compare-empty">"추이" 탭에서 월별 스냅샷을 2개월 이상 쌓으면(계좌별 보기는 그 계좌 데이터가 포함된 스냅샷이 2개월 이상 있어야) 계획 대비 현황이 표시됩니다.</p>`;
    return;
  }
  tableEl.innerHTML = buildGoalPlanTableHTML(d, basis);
  buildGoalPlanChartHTML(chartEl, d, basis);
}

/* ---------- A28: 설정탭 API 키 (텔레그램) ----------
   capture/index.html의 CAPTURE_CLAUDE_KEY/CAPTURE_GEMINI_KEY와 같은 신뢰 모델 — localStorage
   에만 저장하고 저장소·서버에는 절대 커밋/전송하지 않는다(CLAUDE.md 원칙). 텔레그램 Bot API는
   브라우저 CORS를 허용해서(노션·카카오와 달리) 클라이언트에서 직접 호출할 수 있다. 저장소의
   GitHub Actions 시크릿(TELEGRAM_BOT_TOKEN, signal-alert.yml 전용)은 CI 서버에서만 쓰이고
   클라이언트로는 절대 노출되지 않으므로 재사용할 수 없다 — 사용자 본인 봇을 새로 만들어
   여기 넣어야 한다. */
const MY_TELEGRAM_TOKEN_KEY = "my_assets_telegram_token_v1";
const MY_TELEGRAM_CHATID_KEY = "my_assets_telegram_chatid_v1";
function telegramBotToken() { return (localStorage.getItem(MY_TELEGRAM_TOKEN_KEY) || "").trim(); }
function telegramChatId() { return (localStorage.getItem(MY_TELEGRAM_CHATID_KEY) || "").trim(); }

/* 성공 시 {ok:true}, 실패 시 {ok:false, error}. 네트워크 자체가 막힌 환경(오프라인 등)도
   여기서 잡아 호출부가 항상 같은 모양의 결과를 받게 한다. */
async function sendTelegramMessage(text) {
  const token = telegramBotToken(), chatId = telegramChatId();
  if (!token || !chatId) return { ok: false, error: "설정 탭에서 텔레그램 봇 토큰과 chat_id를 먼저 저장하세요." };
  try {
    // parse_mode를 안 쓴다 — 리포트 텍스트에 "&"·"<"·">"가 섞이면(종목명의 S&P500 등)
    // HTML 모드는 이스케이프 없이 그대로 보내면 400 오류가 난다. 서식보다 항상 전송되는
    // 쪽이 중요하므로 그냥 일반 텍스트로 보낸다.
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok) return { ok: true };
    return { ok: false, error: (data && data.description) || `전송 실패(HTTP ${res.status})` };
  } catch (err) {
    return { ok: false, error: "네트워크 오류 — " + (err && err.message) };
  }
}

/* ---------- A31: 리포트 등락 집계·표기 헬퍼 ----------
   buildReportText가 쓰는 순수 함수 모음. 계산과 표기를 함수 밖으로 빼 화면(트리맵 등)에서도
   재사용할 수 있게 하고, 브라우저 없이도 단독 검증이 가능하게 했다.
   ⚠️ index.html에도 같은 사본이 있다(A28과 같은 이중 미러 구조) — 한쪽만 고치지 말 것. */

/* 종목 한 줄의 변동액(원). 등락률을 모르는 종목은 null을 준다 — 0으로 채워 합계에 섞으면
   "데이터 없음"이 "보합"으로 둔갑해 총 변동액·변동률이 조용히 왜곡된다.
   value는 "현재가 × 수량"이므로 직전 평가액은 value/(1+chg), 그 차이가 변동액이다. */
function rowChangeAmount(p) {
  const chg = lastChangePct(p);
  if (chg == null || !(p.value > 0) || chg <= -1) return null;
  return p.value - p.value / (1 + chg);
}

/* 여러 종목의 등락 합계 — 계좌별·전체 어디에나 같은 함수를 쓴다.
   pct의 분모는 "현재 평가액"이 아니라 직전 평가액(= 합계 − 변동액)이어야 등락률이 맞다.
   missing은 등락 데이터가 없어 합계에서 빠진 종목 수(리포트에 그대로 밝힌다). */
function aggregateChange(rows) {
  let amount = 0, valued = 0, missing = 0, counted = 0;
  for (const p of rows || []) {
    if (!(p.value > 0)) continue;
    const amt = rowChangeAmount(p);
    if (amt == null) { missing += 1; continue; }
    amount += amt; valued += p.value; counted += 1;
  }
  const prevValue = valued - amount;
  return { amount, pct: prevValue > 0 ? amount / prevValue : null, missing, counted };
}

/* 등락의 비교 기준 문구 — 주가 수집이 주 1회라 이 값은 **항상 "전일대비"가 아니다**
   (lastChangePct 주석 참조). 라이브 시세가 적용된 종목은 "마지막 수집 종가"가, 아니면
   "직전 수집 종가"가 기준이므로 실제 기준일을 뽑아 밝힌다. 종목마다 기준일이 다르면
   가장 많은 날짜를 대표로 쓰고 "등"을 붙인다. */
function changeBasisLabel(rows) {
  const counts = new Map();
  let live = false;
  for (const p of rows || []) {
    const f = p.full;
    if (!f || !f.closes || !f.dates || f.closes.length < 2) continue;
    const n = f.closes.length;
    const isLive = p.close !== f.closes[n - 1];
    if (isLive) live = true;
    const d = isLive ? f.dates[n - 1] : f.dates[n - 2];
    if (d) counts.set(d, (counts.get(d) || 0) + 1);
  }
  if (!counts.size) return "직전 종가 대비";
  let best = null, bestN = -1;
  for (const [d, n] of counts) if (n > bestN || (n === bestN && d > best)) { best = d; bestN = n; }
  return `${best}${counts.size > 1 ? " 등" : ""} 종가 대비${live ? " · 라이브 반영" : ""}`;
}

/* 축약 원화 — ₩795,324,454처럼 9자리가 그대로 나오면 한눈에 자릿수가 안 잡힌다.
   부호는 값에 붙여 그대로 유지한다(음수를 넘겨도 마이너스가 사라지지 않게). */
function fmtKrwShort(v) {
  const n = Math.round(v), a = Math.abs(n), sign = n < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}₩${(a / 1e12).toFixed(2)}조`;
  if (a >= 1e8) return `${sign}₩${(a / 1e8).toFixed(2)}억`;
  if (a >= 1e4) return `${sign}₩${Math.round(a / 1e4).toLocaleString()}만`;
  return `${sign}₩${a.toLocaleString()}`;
}
function signedKrwShort(v) { return (Math.round(v) > 0 ? "+" : "") + fmtKrwShort(v); }
function signedKrw(v) {
  const n = Math.round(v);
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}₩${Math.abs(n).toLocaleString()}`;
}
function signedPct(p, digits) { return `${p > 0 ? "+" : ""}${p.toFixed(digits == null ? 2 : digits)}%`; }

/* 텔레그램은 parse_mode를 못 써서(종목명의 "S&P500" 때문 — sendTelegramMessage 주석) 굵게·색이
   전부 불가능하다. 방향은 기호로만 구분한다(한국 관례에 맞춰 상승 ▲ · 하락 ▼). */
function changeMark(v) { return v > 0 ? "▲" : v < 0 ? "▼" : "―"; }

/* 한글은 표시 폭이 2배라 String.length로 자르면 줄 길이가 들쭉날쭉해진다 — 폭 기준으로 센다. */
function displayWidth(s) {
  let w = 0;
  // 한중일 문자 대역(한글 자모·완성형·전각기호 등)만 2컬럼으로 센다.
  for (const ch of String(s)) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}
function truncWidth(s, maxW) {
  let w = 0, out = "";
  for (const ch of String(s)) {
    const cw = displayWidth(ch);
    if (w + cw > maxW) return out + "…";
    w += cw; out += ch;
  }
  return out;
}

/* 비중 막대 — 폭이 같은 블록문자(█/░)만 써서 비례폭 글꼴에서도 길이가 흐트러지지 않게 한다.
   숫자만 있으면 45%와 7%의 크기 차이가 안 느껴져서 붙였다. */
const REPORT_BAR_WIDTH = 10;
function pctBar(pct) {
  const filled = Math.max(0, Math.min(REPORT_BAR_WIDTH, Math.round((pct / 100) * REPORT_BAR_WIDTH)));
  return "█".repeat(filled) + "░".repeat(REPORT_BAR_WIDTH - filled);
}

/* 섹션 헤더 — 종전 "[종합]" 대괄호는 스크롤 중에 경계가 안 보였다. 한 줄짜리 굵은 구분선으로
   바꿔 줄 수를 늘리지 않으면서 대비만 올린다. */
const REPORT_HEADER_WIDTH = 20;
function reportSection(title) {
  const inner = ` ${title} `;
  return "━━" + inner + "━".repeat(Math.max(2, REPORT_HEADER_WIDTH - displayWidth(inner) - 2));
}

// 비중이 이 값 미만인 계좌는 "기타 N개"로 접는다 — 0.3%짜리가 45%짜리와 같은 무게로 나열되면
// 스캔 비용만 늘어난다(실측: 9개 계좌 중 4개가 1% 미만).
const REPORT_MINOR_ACCOUNT_PCT = 1.0;
const REPORT_ACCOUNT_WIDTH = 9;
// 텔레그램 sendMessage 한 통의 상한. 종목이 크게 늘어도 400이 나지 않게 마지막에 자른다.
const REPORT_MAX_CHARS = 4000;
// A32d: 하락 WORST5는 평가액이 작은 종목(단가 변동이 커도 실제 손실액은 미미)이 순위를 흐리지
// 않게, 이 평가액 이상인 종목만 대상으로 한다. 상승 TOP5는 그대로(작은 급등도 관심 대상이라).
const REPORT_WORST_MIN_VALUE = 1000000;
// A32c: 종목명을 등락률·금액(또는 월배당액)과 같은 줄에 욱여넣으면(예전 REPORT_NAME_WIDTH=16)
// "TIGER 배당커버드콜액티브" 같은 긴 이름이 "…배당커버드콜…"처럼 알아보기 어렵게 잘렸다
// (실사용 텔레그램 리포트에서 확인됨). 상승·하락·월배당 TOP5 전부 이름을 별도 줄로 내려 폭을 넓힌다.
const REPORT_NAME_WIDTH_WIDE = 28;

/* ---------- A28: 종합 탭 "리포트 생성" (A31에서 가독성·등락 보강) ----------
   종합(계좌별 요약)·비중(성향별)·추이(MDD)·등락(상승·하락 TOP5)·배당(TOP5) 정보를 한 텍스트로
   모아 다운로드·클립보드·텔레그램·옵시디안, 그리고 buildAiAnalysisPrompt(LLM 입력)에 공통으로
   쓴다. 계좌명은 기본적으로 maskAccountLabel로 가린다 — 텔레그램·클립보드로 이 텍스트가 그대로
   밖에 나갈 수 있는 경로이기 때문(A26a와 같은 이유).

   A34: 다만 **옵시디안 목적지는 예외**다. 옵시디안 볼트는 기기 안(폐쇄망)에만 있고 노션·텔레그램처럼
   밖으로 나가지 않으므로, 마스킹된 계좌명으로 저장하면 나중에 어느 계좌인지 대조가 안 돼 백업의
   목적을 잃는다. opts.mask === false 로 부르면 원문 계좌명을 그대로 쓴다.
   ⚠️ 이 옵션은 **로컬 저장 경로에만** 쓸 것 — 텔레그램·클립보드·다운로드는 반드시 기본값(마스킹)을
   유지한다(클립보드는 다른 앱이 읽을 수 있고, 다운로드 파일은 공유될 수 있다).

   A31 레이아웃 원칙(모바일 텔레그램 실측 기준):
   ① 값과 라벨이 줄바꿈으로 찢어지지 않게 한 줄을 30컬럼 안쪽으로 유지하고, 넘칠 것은
      "라벨 줄 + 들여쓴 값 줄"로 미리 쪼갠다(종전에는 계좌 9줄 중 4줄이 제멋대로 접혔다).
   ② 면책·기준 설명은 본문에서 빼 notes로 모아 맨 아래 각주로 붙인다 — 숫자보다 문장이
      커 보이던 문제(MDD 2줄 면책)를 없앤다. */
async function buildReportText(csv, history, opts) {
  if (!csv || !csv.perRow || !csv.perRow.length) return null;
  // A34: 목적지별 계좌명 마스킹 분기. 기본은 마스킹(밖으로 나가는 경로), 옵시디안만 원문.
  const maskAcc = (opts && opts.mask === false) ? ((s) => s || "") : maskAccountLabel;
  const fmtW = (v) => fmtPrice(v, "KRW");
  const lines = [];
  const notes = [];
  const total = csv.totalValue;
  const pctOf = (v) => (total > 0 ? (v / total) * 100 : 0);

  lines.push("📊 14fiance 포트폴리오 리포트");
  lines.push(todayStr());
  lines.push("");

  /* ── 종합 ── 총 평가액·총 월배당을 축약(₩7.95억)과 원 단위로 함께 보여 1초 안에 잡히게 한다. */
  const chgAll = aggregateChange(csv.perRow);
  const basis = changeBasisLabel(csv.perRow);
  lines.push(reportSection("종합"));
  lines.push(`평가액 ${fmtKrwShort(total)}`);
  lines.push(`  ${fmtW(total)}`);
  lines.push(`월배당 ${fmtKrwShort(csv.totalMonthlyDiv)}`);
  lines.push(`  ${fmtW(csv.totalMonthlyDiv)}`);
  if (chgAll.pct != null) {
    lines.push(`등락 ${changeMark(chgAll.amount)} ${signedPct(chgAll.pct * 100)}`);
    lines.push(`  ${signedKrw(chgAll.amount)}`);
    lines.push(`  (${basis})`);
    if (chgAll.missing > 0) lines.push(`  ※ ${chgAll.missing}종목은 등락 데이터 없어 제외`);
  } else {
    lines.push("등락 — 가격 이력이 부족해 계산 불가");
  }
  if (csv.totalProfit != null) {
    lines.push(`손익 ${changeMark(csv.totalProfit)} ${signedKrw(csv.totalProfit)}`);
    lines.push("  (매입단가 입력분 기준)");
  }
  lines.push("");

  /* ── 계좌별 ── 평가액 내림차순 + 1% 미만은 접기. 계좌당 2줄 고정(1줄=이름·비중·막대,
     2줄=평가액·월배당·등락)이라 어느 값이 어느 계좌 것인지 들여쓰기로 분명해진다. */
  const rowsByAccount = new Map();
  for (const p of csv.perRow) {
    const k = p.account || "계좌 미지정";
    if (!rowsByAccount.has(k)) rowsByAccount.set(k, []);
    rowsByAccount.get(k).push(p);
  }
  const accounts = [...csv.accountMap.entries()]
    .filter(([, g]) => g.value > 0)
    .map(([acc, g]) => ({ acc, g, pct: pctOf(g.value), chg: aggregateChange(rowsByAccount.get(acc) || []) }))
    .sort((a, b) => b.g.value - a.g.value);
  // 접을 계좌가 하나뿐이면 접어도 줄 수가 그대로라 계좌명만 사라진다 — 2개 이상일 때만 묶는다.
  const smalls = accounts.filter((a) => a.pct < REPORT_MINOR_ACCOUNT_PCT);
  const fold = smalls.length >= 2;
  const majors = fold ? accounts.filter((a) => a.pct >= REPORT_MINOR_ACCOUNT_PCT) : accounts;
  const minors = fold ? smalls : [];

  lines.push(reportSection("계좌별"));
  for (const a of majors) {
    lines.push(`${maskAcc(a.acc)} ${a.pct.toFixed(1)}%`);
    lines.push(`  ${pctBar(a.pct)}`);
    const bits = [fmtKrwShort(a.g.value)];
    if (a.g.monthlyDiv > 0) bits.push(`월 ${fmtKrwShort(a.g.monthlyDiv)}`);
    if (a.chg.pct != null) bits.push(`${changeMark(a.chg.amount)}${signedPct(a.chg.pct * 100, 1)}`);
    lines.push(`  ${bits.join(" · ")}`);
  }
  if (minors.length) {
    const v = minors.reduce((s, a) => s + a.g.value, 0);
    const d = minors.reduce((s, a) => s + a.g.monthlyDiv, 0);
    lines.push(`기타 ${minors.length}개 계좌 ${pctOf(v).toFixed(1)}%`);
    lines.push(`  ${fmtKrwShort(v)}${d > 0 ? ` · 월 ${fmtKrwShort(d)}` : ""}`);
    notes.push(`※ 비중 ${REPORT_MINOR_ACCOUNT_PCT}% 미만 계좌는 "기타"로 묶었습니다.`);
  }
  lines.push("");

  const styleMap = new Map();
  for (const p of csv.perRow) {
    if (!(p.value > 0)) continue;
    const s = (p.meta && p.meta.style) || "미분류";
    styleMap.set(s, (styleMap.get(s) || 0) + p.value);
  }
  lines.push(reportSection("비중 · 성향별"));
  for (const [s, v] of [...styleMap.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = pctOf(v);
    lines.push(`${s} ${pct.toFixed(1)}%`);
    lines.push(`  ${pctBar(pct)} ${fmtKrwShort(v)}`);
  }
  lines.push("");

  /* ── 추이 ── 숫자를 먼저 놓고 면책은 notes로 내린다. */
  lines.push(reportSection("추이"));
  const mdd = portfolioMDD(csv.perRow);
  if (mdd) {
    lines.push(`전체기간 MDD ${changeMark(mdd.mdd)} ${signedPct(mdd.mdd * 100, 1)}`);
    lines.push(`  ${mdd.peakDate} → ${mdd.troughDate}`);
    lines.push(`  ${mdd.recoveredDate ? "회복 완료" : "미회복"}`);
    notes.push("※ MDD는 현재 보유 비중으로 과거 가격이력을 합성한 낙폭 — 실제 계좌 평가액 낙폭과는 다릅니다.");
  } else {
    lines.push("가격 이력이 부족해 MDD를 계산할 수 없습니다.");
  }
  // A32e: VOO·QQQ·SCHD와 같은 기준(공통 구간 정렬)으로 MDD를 나란히 보여준다.
  try {
    const benchCmp = await computeBenchmarkMDDCompare(csv.perRow);
    if (benchCmp) {
      lines.push(`MDD 비교 (VOO·QQQ·SCHD 동일기준, ${benchCmp.since}~${benchCmp.until})`);
      for (const { name, m } of benchCmp.rows) {
        lines.push(m ? `  ${name} ${changeMark(m.mdd)} ${signedPct(m.mdd * 100, 1)}` : `  ${name} 데이터 부족`);
      }
      notes.push("※ MDD 비교는 내 포트폴리오와 세 벤치마크 중 가장 늦게 시작한 시점부터 공통 구간으로 맞춘 값입니다.");
    }
  } catch (err) { /* 벤치마크 조회 실패해도 리포트 나머지는 계속 생성 */ }
  if (history && history.length >= 2) {
    const sorted = history.slice().sort((a, b) => a.month.localeCompare(b.month));
    const first = sorted[0], last = sorted[sorted.length - 1];
    const diff = last.value - first.value;
    const pct = first.value > 0 ? (diff / first.value) * 100 : 0;
    lines.push(`평가액 ${first.month}→${last.month}`);
    lines.push(`  ${changeMark(diff)} ${signedPct(pct, 1)} ${signedKrw(diff)}`);
    notes.push("※ 평가액 변동은 월 스냅샷 단순비교입니다.");
  }
  lines.push("");

  /* ── 상승·하락 TOP5 ── 같은 종목이 여러 계좌에 걸쳐 있으면 등락률이 같아 목록이 한 종목으로
     도배된다(실측: TIGER 배당커버드콜액티브가 3개 계좌). 종목 단위로 합쳐서 순위를 매긴다. */
  const bySymbol = new Map();
  for (const p of csv.perRow) {
    if (!(p.value > 0)) continue;
    const chg = lastChangePct(p), amt = rowChangeAmount(p);
    if (chg == null || amt == null) continue;
    if (!bySymbol.has(p.symbol)) {
      bySymbol.set(p.symbol, { name: (p.meta && p.meta.name) || p.symbol, chg, amount: 0, value: 0, accounts: 0 });
    }
    const e = bySymbol.get(p.symbol);
    e.amount += amt; e.value += p.value; e.accounts += 1;
  }
  const ranked = [...bySymbol.values()].sort((a, b) => b.chg - a.chg);
  const pushRankLine = (e) => {
    lines.push(`${changeMark(e.chg)}${signedPct(e.chg * 100, 1)} ${signedKrwShort(e.amount)}`);
    lines.push(`  ${truncWidth(e.name, REPORT_NAME_WIDTH_WIDE)}`);
  };

  const gainers = ranked.filter((e) => e.chg > 0).slice(0, 5);
  const losers = ranked.filter((e) => e.chg < 0 && e.value >= REPORT_WORST_MIN_VALUE).slice(-5).reverse();
  lines.push(reportSection("상승 TOP5"));
  if (gainers.length) for (const e of gainers) pushRankLine(e);
  else lines.push("상승 종목이 없습니다.");
  lines.push("");
  lines.push(reportSection("하락 WORST5"));
  if (losers.length) for (const e of losers) pushRankLine(e);
  else lines.push("하락 종목이 없습니다.");
  if (ranked.length) {
    notes.push(`※ 등락 기준: ${basis}. 주가 수집이 주 1회라 항상 "전일대비"는 아닙니다.`);
    notes.push(`※ 하락 WORST5는 평가액 ${fmtKrwShort(REPORT_WORST_MIN_VALUE)} 이상 종목 기준입니다.`);
  }
  lines.push("");

  const top5 = csv.perRow.filter((p) => p.monthlyDiv > 0).sort((a, b) => b.monthlyDiv - a.monthlyDiv).slice(0, 5);
  lines.push(reportSection("월배당 TOP5"));
  if (top5.length) {
    for (const p of top5) {
      const name = truncWidth((p.meta && p.meta.name) || p.symbol, REPORT_NAME_WIDTH_WIDE);
      const acc = truncWidth(maskAcc(p.account || "계좌 미지정"), REPORT_ACCOUNT_WIDTH);
      lines.push(`${fmtKrwShort(p.monthlyDiv)}/월`);
      lines.push(`  ${name}`);
      lines.push(`  ${acc}`);
    }
  } else {
    lines.push("월배당 정보가 있는 종목이 없습니다.");
  }
  lines.push("");

  for (const n of notes) lines.push(n);
  lines.push("— 14fiance에서 자동 생성됨. 매매 자문이 아닌 참고용 정보입니다.");

  const text = lines.join("\n");
  return text.length <= REPORT_MAX_CHARS ? text : text.slice(0, REPORT_MAX_CHARS - 12) + "\n…(생략)";
}

/* ---------- A28: AI 분석 탭(옵션) ----------
   capture 앱이 이미 관리하는 제미나이 키(CAPTURE_GEMINI_KEY와 같은 localStorage 키 문자열)를
   그대로 재사용한다 — capture-parse.js가 로드되지 않는 root index.html에서도 쓸 수 있도록
   상수를 하드코딩하되(둘이 다른 스크립트라 상수 공유 불가) 값은 동일하다. 같은 브라우저·앱
   에서 한 번만 키를 넣으면 캡처 파싱과 AI 분석 탭이 같은 키를 공유한다(같은 origin이라
   localStorage가 공유되므로). */
const AI_GEMINI_KEY_STORAGE = "capture_gemini_key";
const AI_GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
function geminiApiKey() { return (localStorage.getItem(AI_GEMINI_KEY_STORAGE) || "").trim(); }

/* callGeminiVision(capture-parse.js)의 텍스트 전용 버전 — 이미지 파트 없이 프롬프트만 보낸다. */
async function callGeminiText(promptText, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || AI_GEMINI_MODEL_DEFAULT}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: promptText }] }] }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gemini API 오류 ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return ((data.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

function buildAiAnalysisPrompt(reportText) {
  return `다음은 내 투자 포트폴리오 리포트입니다. 매매를 추천하지 말고 아래 관점에서 관찰·리스크 위주로 짧게 분석해줘:
1) 계좌·성향 비중이 한쪽으로 쏠려 있는지
2) MDD(최대낙폭)로 볼 때 분산이 잘 되고 있는지
3) 배당 집중도(TOP5가 전체 월배당에서 차지하는 비중)가 과도한지
4) 등락(상승·하락 TOP5)에서 특정 섹터·성향에 손실이 몰려 있는지
5) 눈에 띄는 리스크나 점검해볼 만한 점

${reportText}`;
}

/* ---------- A25d: 옵시디안 볼트 백업용 노트 생성 ----------
   노션(온라인) 외에 폰에도 주요 기록을 남긴다. 여기서는 **문자열만 만들고**(순수 함수라
   웹에서도 검증 가능) 실제 파일 기록은 APK 전용 app/src/native-files.js가 담당한다.
   md는 옵시디안에서 바로 읽는 표, json은 재가공·복원용으로 쌍으로 남긴다. */
const OBSIDIAN_PATH_KEY = "my_assets_obsidian_path_v1";
function obsidianVaultPath() { return (localStorage.getItem(OBSIDIAN_PATH_KEY) || "").trim(); }

function buildObsidianNotes() {
  const csv = state.myAssetsCsvData;
  const now = nowDateTimeStr();
  const won = (v) => Math.round(v || 0).toLocaleString();
  const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch (e) { return []; } };
  const monthly = read(MY_ASSETS_HISTORY_KEY);
  const daily = read(MY_ASSETS_DAILY_HISTORY_KEY);
  const changelog = read(MY_ASSETS_CHANGELOG_KEY);
  const divHistory = state.myAssetsDivHistory || {};
  const notes = [];

  // ── 1) 배당 이력 ──
  const divRows = Object.keys(divHistory).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort().reverse();
  const expected = csv ? csv.totalMonthlyDiv : 0;
  const thisMonth = todayStr().slice(0, 7);
  const perSym = csv ? csv.perRow.filter((p) => p.monthlyDiv > 0)
    .sort((a, b) => b.monthlyDiv - a.monthlyDiv)
    .map((p) => `| ${p.meta ? p.meta.name : p.symbol} | ${p.account || "미지정"} | ${p.qty.toLocaleString()} | ${p.effRate ? (p.effRate * 100).toFixed(2) + "%" : "—"} | ${p.divPriceDate || "현재가"} | ${won(p.monthlyDiv)} |`)
    .join("\n") : "";
  notes.push({ name: "배당-이력.md", text:
`# 배당 이력 (14fiance)
> 자동 생성 ${now} · 예상액은 "배당기준일 종가 × 분배율"(기준일 미도래 시 현재가)

## 이번 달(${thisMonth})
- 실시간 예상 배당: **₩${won(expected)}**
- 확정: ${divHistory[thisMonth] > 0 ? `**₩${won(divHistory[thisMonth])}** · 괴리율 ${(((expected - divHistory[thisMonth]) / divHistory[thisMonth]) * 100).toFixed(1)}%` : "미확정(지급 후 반영)"}

## 확정 월배당 이력
| 월 | 확정 배당금 |
| --- | --- |
${divRows.map((m) => `| ${m} | ₩${won(divHistory[m])} |`).join("\n") || "| — | 기록 없음 |"}

## 종목별 예상 배당(현재)
| 종목 | 계좌 | 수량 | 분배율 | 기준주가일 | 월배당 |
| --- | --- | --- | --- | --- | --- |
${perSym || "| — | | | | | 보유 없음 |"}
` });
  notes.push({ name: "배당-이력.json", text: JSON.stringify({ generatedAt: now, expectedThisMonth: expected, divHistory }, null, 2) });

  // ── 2) 종목변동 이력 ──
  const clRows = changelog.slice(0, 60).map((e) => {
    const items = e.changes.map((c) => `${c.account || "미지정"} ${c.symbol} ${CHANGE_TYPE_LABEL[c.type] || c.type}(${c.oldQty}→${c.newQty})`).join(", ");
    return `### ${e.ts} · ${CHANGE_SOURCE_LABEL[e.source] || e.source}\n- 자산: ₩${won(e.beforeValue)} → ₩${won(e.afterValue)}\n- 변동 ${e.changes.length}건: ${items}`;
  }).join("\n\n");
  notes.push({ name: "종목변동-이력.md", text:
`# 종목변동 이력 (14fiance)
> 자동 생성 ${now} · 최근 ${Math.min(changelog.length, 60)}건 / 전체 ${changelog.length}건

${clRows || "기록 없음 — 캡처 반영·가져오기를 하면 여기 쌓입니다."}
` });
  notes.push({ name: "종목변동-이력.json", text: JSON.stringify({ generatedAt: now, changelog }, null, 2) });

  // ── 3) 일별 종합결과 ──
  const dailyRows = daily.slice().reverse().slice(0, 90)
    .map((h) => `| ${h.date} | ₩${won(h.value)} | ₩${won(h.monthlyDiv)} |`).join("\n");
  const lastSnap = monthly[monthly.length - 1];
  const accRows = lastSnap && lastSnap.byAccount
    ? Object.entries(lastSnap.byAccount).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `| ${k} | ₩${won(v)} | ${((v / (lastSnap.value || 1)) * 100).toFixed(1)}% |`).join("\n")
    : "";
  notes.push({ name: "일별-종합결과.md", text:
`# 일별 종합결과 (14fiance)
> 자동 생성 ${now}

## 현재 요약
- 총 평가액: **₩${won(csv ? csv.totalValue : 0)}**
- 예상 월배당: **₩${won(expected)}**
- 보유 종목: ${csv ? csv.perRow.length : 0}건

## 계좌별 비중(최근 월 스냅샷${lastSnap ? ` ${lastSnap.month}` : ""})
| 계좌 | 평가액 | 비중 |
| --- | --- | --- |
${accRows || "| — | | 스냅샷 없음 |"}

## 일별 자산 스냅샷
| 날짜 | 평가액 | 월배당 |
| --- | --- | --- |
${dailyRows || "| — | | 기록 없음 |"}
` });
  notes.push({ name: "일별-종합결과.json", text: JSON.stringify({
    generatedAt: now,
    totalValue: csv ? csv.totalValue : 0,
    expectedMonthlyDiv: expected,
    dailyHistory: daily,
    monthlySnapshots: monthly,
  }, null, 2) });

  // ── 4) 에이전트 브리핑 (A35) ──
  // 볼트에는 파일이 여러 개라 에이전트에게 전부 넘기기 번거롭다. 이 한 파일만 읽으면
  // 현재 상태·최근 변동·데이터 신선도·자가진단을 다 알 수 있게 모아둔다.
  // 계좌명은 **마스킹하지 않는다** — 볼트는 기기 안에만 있는 폐쇄 저장소이고, 가려두면
  // 나중에 어느 계좌인지 대조가 안 돼 백업의 목적을 잃는다(2계층 데이터 정책, A34와 같은 근거).
  notes.push({ name: "00_에이전트-브리핑.md", text: buildAgentBriefingNote(csv, changelog, now, won) });

  return notes;
}

/* ---------- A35: 에이전트 브리핑 노트 ----------
   "내자산" 스킬을 든 에이전트가 이 파일 하나로 맥락을 잡게 만드는 것이 목적이다.
   숫자를 나열하는 데 그치지 않고 **자가진단 결과를 함께 적는다** — 앱은 divRate 누락이나
   (계좌,종목) 중복 같은 걸 이미 알고 있는데, 지금까지는 그걸 아무 데도 안 남겨서
   에이전트가 매번 처음부터 다시 찾아야 했다(2026-08-02 배당 과대계상이 그렇게 늦게 발견됐다).
   순수 함수라 웹에서도 검증 가능하다 — 파일 기록은 native-files.js가 맡는다. */
function buildAgentBriefingNote(csv, changelog, now, won) {
  const L = [];
  L.push("# 🤖 에이전트 브리핑 — 14fiance 자산");
  L.push(`> 자동 생성 ${now} · **이 볼트는 기기 안에만 있는 폐쇄 저장소라 계좌명을 가리지 않았다.**`);
  L.push("> 여기 내용을 노션·텔레그램·저장소로 옮길 때는 반드시 계좌번호를 마스킹할 것.");
  L.push("");

  if (!csv || !csv.perRow || !csv.perRow.length) {
    L.push("보유 종목이 없어 브리핑할 내용이 없습니다.");
    return L.join("\n");
  }

  // ── 현재 상태 ──
  L.push("## 현재 상태");
  L.push(`- 총 평가액: **₩${won(csv.totalValue)}**`);
  L.push(`- 예상 월배당: **₩${won(csv.totalMonthlyDiv)}** (연환산 ₩${won(csv.totalMonthlyDiv * 12)})`);
  const annualYield = csv.totalValue > 0 ? (csv.totalMonthlyDiv * 12) / csv.totalValue * 100 : 0;
  L.push(`- 연환산 배당률: **${annualYield.toFixed(2)}%**`);
  L.push(`- 보유 종목 수: ${csv.perRow.length}행`);
  L.push("");

  // ── 계좌별 ──
  const accMap = new Map();
  for (const p of csv.perRow) {
    const k = p.account || "계좌 미지정";
    if (!accMap.has(k)) accMap.set(k, { value: 0, div: 0, n: 0 });
    const g = accMap.get(k);
    g.value += p.value || 0; g.div += p.monthlyDiv || 0; g.n += 1;
  }
  L.push("## 계좌별");
  L.push("| 계좌 | 평가액 | 월배당 | 종목수 |");
  L.push("| --- | --- | --- | --- |");
  for (const [acc, g] of [...accMap.entries()].sort((a, b) => b[1].value - a[1].value)) {
    L.push(`| ${acc} | ₩${won(g.value)} | ₩${won(g.div)} | ${g.n} |`);
  }
  L.push("");

  // ── 자가진단 ──
  // 에이전트가 "이상감지 체크리스트"를 처음부터 돌리지 않아도 되게 앱이 미리 검사해 남긴다.
  const flags = [];

  // (1) divRate 누락 — 등록 분배율이 없어 확정DPS 역산으로 떨어진 종목.
  //     확정DPS는 과거 기준주가로 산정된 값이라 주가가 빠졌으면 분배율이 부풀어 오른다.
  const derived = csv.perRow.filter((p) => p.divBasis === "derived" && p.monthlyDiv > 0);
  if (derived.length) {
    const amt = derived.reduce((a, b) => a + b.monthlyDiv, 0);
    flags.push(`⚠️ **divRate 미등록 ${derived.length}종목** — 확정DPS 역산으로 계산 중(월배당 ₩${won(amt)} 해당). ` +
      "노션 배당기준 마스터의 분배율이 import JSON의 divRate로 실려 나갔는지 확인할 것. " +
      "역산은 주가가 빠진 종목일수록 분배율이 부풀어 오른다.");
  }

  // (2) 확정DPS 대비 괴리 — **경로에 따라 뜻이 정반대다.**
  //   · divBasis "rate"(등록 분배율 사용): 괴리는 정상이다. 확정DPS는 과거 기준주가로 산정된
  //     스냅샷이고 분배율×현재가가 최신값이므로, 주가가 빠진 만큼 음수 괴리가 나는 게 맞다.
  //     경고가 아니라 "노션 배당기준 마스터의 확정DPS가 낡았다"는 정보로 표시한다.
  //     (2026-08-02: 이걸 경고로 냈다가 divRate 수정이 잘 먹은 종목들이 전부 ⚠️로 떠 오탐이 됐다.)
  //   · divBasis "derived"(확정DPS 역산): 이건 진짜 경고다. 등록 분배율이 없어 역산에 의존하는데
  //     그 역산값이 확정DPS와 어긋난다는 뜻이라 어느 쪽도 믿기 어렵다.
  const gapLabel = (p) => `${p.meta ? p.meta.name : p.symbol}[${p.account || "미지정"}] ` +
    `${p.dpsGapPct >= 0 ? "+" : ""}${(p.dpsGapPct * 100).toFixed(0)}%`;
  const byGap = (a, b) => Math.abs(b.dpsGapPct) - Math.abs(a.dpsGapPct);
  const gapped = csv.perRow.filter((p) => p.dpsGapPct != null && Math.abs(p.dpsGapPct) > 0.15);

  const gapDerived = gapped.filter((p) => p.divBasis === "derived").sort(byGap);
  if (gapDerived.length) {
    flags.push(`⚠️ **역산 분배율이 확정DPS와 15%↑ 어긋남 ${gapDerived.length}건** — 등록 분배율이 없어 ` +
      `역산 중인데 그 값도 확정DPS와 맞지 않는다(어느 쪽도 신뢰하기 어려움): ` +
      gapDerived.slice(0, 5).map(gapLabel).join(", ") + (gapDerived.length > 5 ? ` 외 ${gapDerived.length - 5}건` : ""));
  }

  const gapRate = gapped.filter((p) => p.divBasis === "rate").sort(byGap);
  if (gapRate.length) {
    flags.push(`ℹ️ **확정DPS가 낡음 ${gapRate.length}건**(이상 아님) — 등록 분배율×현재가로 정상 계산 중이고, ` +
      `확정DPS는 과거 기준주가로 산정된 값이라 주가가 움직인 만큼 차이가 난다. ` +
      `노션 배당기준 마스터의 DPS를 최신 기준주가로 갱신하면 사라진다: ` +
      gapRate.slice(0, 5).map(gapLabel).join(", ") + (gapRate.length > 5 ? ` 외 ${gapRate.length - 5}건` : ""));
  }

  // (3) 같은 (계좌,종목) 중복 — 하류 집계가 경고 없이 합산하므로 평가액·배당이 부풀어 오른다.
  const seen = new Map();
  for (const p of csv.perRow) {
    const k = `${p.account || ""}|${p.symbol}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  const dups = [...seen.entries()].filter(([, n]) => n > 1);
  if (dups.length) {
    flags.push(`🔴 **(계좌,종목) 중복 ${dups.length}건** — 집계가 합산되어 평가액·배당이 부풀어 있다: ` +
      dups.slice(0, 5).map(([k, n]) => `${k.replace("|", " / ")} ×${n}`).join(", "));
  }

  // (4) 연환산 배당률 상식 범위 — 커버드콜 비중이 높아도 15%를 넘으면 입력 데이터를 의심한다.
  if (annualYield > 15) {
    flags.push(`⚠️ **연환산 배당률 ${annualYield.toFixed(1)}%** — 커버드콜 비중을 감안해도 높다. 위 divRate 항목부터 확인.`);
  }

  L.push("## 자가진단");
  L.push(flags.length ? flags.map((f) => `- ${f}`).join("\n") : "- 걸리는 항목 없음.");
  L.push("");

  // ── 최근 변동 ──
  L.push("## 최근 변동 (최신 10건)");
  if (changelog && changelog.length) {
    for (const e of changelog.slice(0, 10)) {
      const src = CHANGE_SOURCE_LABEL[e.source] || e.source;
      const items = e.changes.slice(0, 6)
        .map((c) => `${c.symbol} ${c.oldQty}→${c.newQty}`).join(", ");
      const more = e.changes.length > 6 ? ` 외 ${e.changes.length - 6}건` : "";
      L.push(`- \`${e.ts}\` **${src}** · ₩${won(e.beforeValue)} → ₩${won(e.afterValue)} · ${items}${more}`);
    }
    L.push("");
    L.push("> `source`가 `capture-account-reset`이면 계좌 전체가 교체된 것이라, 수량 급변이");
    L.push("> 실제 매매가 아니라 반영 사고일 수 있다(2026-08-02 실사례).");
  } else {
    L.push("- 기록 없음.");
  }
  L.push("");

  // ── 보유 전체 ──
  L.push("## 보유 종목 전체");
  L.push("| 계좌 | 종목 | 코드 | 수량 | 평가액 | 월배당 | 배당근거 |");
  L.push("| --- | --- | --- | --- | --- | --- | --- |");
  const BASIS_LABEL = { rate: "등록 분배율", derived: "확정DPS 역산", ttm: "TTM 추정" };
  for (const p of [...csv.perRow].sort((a, b) => (b.value || 0) - (a.value || 0))) {
    L.push(`| ${p.account || "미지정"} | ${p.meta ? p.meta.name : p.symbol} | ${p.symbol} | ` +
      `${(p.qty || 0).toLocaleString()} | ₩${won(p.value)} | ₩${won(p.monthlyDiv)} | ${BASIS_LABEL[p.divBasis] || "—"} |`);
  }

  return L.join("\n");
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

/* ---------- A26b: 계좌 전체(포트폴리오) MDD ----------
   "지금 이 보유구성이었다면 과거에 얼마나 빠졌을까"를 재는 값이다(사용자 확정 기준).
   실제 계좌 평가액 스냅샷의 낙폭이 아니라 보유비중 합성 NAV(지수비교 탭과 같은 시리즈)의
   낙폭을 쓰는 이유: 평가액은 입출금·추가매수로 오르내려 낙폭이 오염되는 반면, 합성 NAV는
   종목을 바꿔야만 값이 변하므로 "계좌변동이 MDD를 어떻게 바꿨나"를 그대로 볼 수 있다.
   months=null/미지정이면 전체 기간. 가격이력이 모자라면 null(값을 지어내지 않음). */
function portfolioNavSeries(perRow, months) {
  // buildMyBlendPctSeries는 %변화(0 시작)라 NAV(1 시작)로 되돌린다 — 낙폭은 비율이라 스케일 무관.
  const s = buildMyBlendPctSeries(perRow || [], benchSinceDate(months));
  return s && s.dates.length >= 2 ? { dates: s.dates, navs: s.values.map((v) => 1 + v) } : null;
}

function portfolioMDD(perRow, months) {
  const s = portfolioNavSeries(perRow, months);
  if (!s) return null;
  const r = calcMDD(s.dates, s.navs);
  return {
    mdd: r.mdd,
    peakDate: s.dates[r.peakIdx],
    troughDate: s.dates[r.troughIdx],
    recoveredDate: r.recoveryIdx >= 0 ? s.dates[r.recoveryIdx] : null,
  };
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

// 미수집 종목 감지 시 manifest를 1회 재조회해 자가치유한다 — 기기(WebView) 캐시가
// 묵은 manifest를 물고 있으면 저장소에 이미 수집된 종목이 "수집 목록에 없음"으로
// 계속 제외되는 실사례(0219E0.KS, 2026-07-19)가 있었다.
async function refreshManifestAndRerender() {
  const m = await fetchJSON(`${DATA_DIR}/manifest.json`);
  state.manifest = m;
  state.listedEtfs = [
    ...m.us.map((e) => ({ ...e, market: "us" })),
    ...m.kr.map((e) => ({ ...e, market: "kr" })),
  ];
  state.metaBySymbol = new Map(state.listedEtfs.map((e) => [e.symbol, e]));
  const pageUpdated = document.getElementById("pageUpdated");
  if (pageUpdated) pageUpdated.textContent = `데이터 업데이트: ${m.updated}`;
  renderMyAssets();
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

  // 미수집 종목이 보이면 세션당 1회 manifest를 자동 재조회한다 — 앱 시작 시점에
  // 캐시된 구본을 읽었더라도 사용자 조작 없이 스스로 회복되도록.
  if (unknownRows.length && !state.manifestRefetched) {
    state.manifestRefetched = true;
    try { await refreshManifestAndRerender(); return; } catch (err) { /* 재조회 실패 시 기존 manifest로 계속 */ }
  }

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
    ? `<p class="stat-sub" style="color:var(--critical); margin-top:10px;">⚠️ 아직 수집 목록에 없는 종목 ${unknownRows.length}건은 계산에서 제외했습니다: ${unknownRows.map((r) => r.symbol).join(", ")} — 클로드에게 "이 종목 추가해줘"라고 요청하면 다음 데이터 수집 때 반영됩니다. (데이터 기준: ${state.manifest.updated}) <button type="button" id="myManifestRefreshBtn">🔄 수집 목록 새로 확인</button></p>`
    : "";
  if (result && !result.dataset.manifestBtnWired) {
    result.dataset.manifestBtnWired = "1";
    result.addEventListener("click", async (e) => {
      const btn = e.target && e.target.id === "myManifestRefreshBtn" ? e.target : null;
      if (!btn) return;
      btn.disabled = true; btn.textContent = "확인 중…";
      try { await refreshManifestAndRerender(); }
      catch (err) { btn.disabled = false; btn.textContent = "🔄 수집 목록 새로 확인"; }
    });
  }

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
    // A24c: 확정DPS·TTM을 분배율로 역산할 때의 기준가 — 그 값들이 산출된 시점의 가격이므로
    // 실시간가가 아니라 "수집 종가"를 써야 한다(아래 derivedRate 주석 참조).
    const baseClose = close;
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
    /* A24c: 월배당은 "현재가 × 분배율"이 기본이다(2026-08-01 사용자 결정).
       커버드콜·고배당 ETF는 실제로 기준주가에 분배율을 곱해 지급하므로, 확정 DPS(원/주)를
       고정값으로 쓰면 주가가 빠져도 분배금이 그대로여서 실제 지급액과 괴리가 생겼다.
       close는 🔄 최신시세가 켜져 있으면 장중 실시간가로 교체된 값이라(위 참조) 주가 하락이
       곧바로 분배금 감소로 반영된다. 분배율 출처는 ① 노션 배당기준 마스터 등록값(divRate)
       ② 없으면 확정DPS÷현재가 역산 순. 실제 지급 확정액은 divHistory(연도별 확정 월배당)가
       따로 보관하므로 "확정=실지급 기록 / 예상=분배율×현재가"로 역할이 나뉜다. */
    const registeredRate = it.divRate > 0 ? it.divRate / 100 : 0;
    /* ⚠️ 역산 분배율의 분모는 반드시 "수집 종가(baseClose)"여야 한다 — 실시간가로 나누면
       close × (confirmedDps/close) = confirmedDps 로 상쇄돼 주가 연동이 무효가 된다(구현 중 실측).
       baseClose로 나눠야 confirmedDps × (실시간가/수집종가), 즉 수집 이후 주가 변동분만큼
       분배금이 조정된다. TTM 경로도 같은 이유로 월 분배율(연배당수익률÷12)로 환산해 연동시킨다. */
    const derivedRate = !registeredRate && it.confirmedDps > 0 && baseClose > 0 ? it.confirmedDps / baseClose : 0;
    // TTM 역산은 manifest의 dividendYield가 아니라 ttm÷수집종가를 쓴다 — 네이버가 준 연배당
    // 수익률은 자체 기준가로 계산돼 우리 종가와 어긋나서(실측 8.65% vs 7.26%) 그대로 쓰면
    // 주가 연동과 무관하게 기존 표시액이 20% 가까이 튄다. ttm÷baseClose면 수집 시점 값은
    // 종전(ttm/12)과 정확히 같고 주가 변동분만 추가로 반영된다.
    const ttmRate = !registeredRate && !derivedRate && baseClose > 0
      ? (ttm > 0 ? ttm / 12 / baseClose : divYield / 12)
      : 0;
    const effRate = registeredRate || derivedRate || ttmRate;
    // divBasis: 화면에 산출 근거를 표시하기 위한 구분 — rate(등록 분배율)/derived(확정DPS 역산)/ttm(TTM 역산)
    const divBasis = registeredRate ? "rate" : derivedRate ? "derived" : "ttm";
    const usedConfirmed = it.confirmedDps > 0;
    /* A25c: 분배금은 "배당기준일 종가 × 분배율"로 계산한다. 기준일은 지급시기(월초/월중/월말/
       분기)로 정해지는 정형 패턴이라 종목별 조회가 필요 없고, 휴일 보정은 실제 거래일 시리즈로
       처리한다(dividendRecordDate 주석 참조). 기준일이 아직 안 온 달은 그 날 종가가 없으므로
       현재가로 대신 계산하고 화면에 "미도래·현재가 기준"으로 구분 표시한다. */
    const recordInfo = dividendRecordDate(it.payPeriod, todayStr().slice(0, 7), it.full.dates);
    const recordClose = recordInfo && !recordInfo.future ? closeOnDate(it.full, recordInfo.date) : null;
    // 배당 계산에 실제로 쓴 주가와 그 날짜 — 화면에 "어느 날 주가로 계산했는지" 밝히기 위해 보관
    const divPrice = recordClose != null ? recordClose : close;
    const divPriceDate = recordClose != null ? recordInfo.date : null; // null이면 현재가 사용
    const recordDate = recordInfo ? recordInfo.date : null;
    const recordFuture = recordInfo ? recordInfo.future : false;
    const buyDeadline = recordInfo && !recordInfo.future ? buyDeadlineDate(recordInfo.date, it.full.dates) : null;
    const monthlyDiv = effRate > 0 ? toKrw(divPrice * effRate) * it.qty : 0;
    // 확정 DPS 대비 괴리(분배율 기준으로 계산했을 때 실제 등록 확정값과 얼마나 차이나는지)
    const dpsFromRate = effRate > 0 ? divPrice * effRate : null;
    const dpsGapPct = dpsFromRate != null && it.confirmedDps > 0 ? (dpsFromRate - it.confirmedDps) / it.confirmedDps : null;
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
    perRow.push({ ...it, meta, close, isUsd, value, cost, profit, monthlyDiv, nextMonthDiv, monthlyBuy, erosion, usedConfirmed, trailReturn, effRate, divBasis, dpsFromRate, dpsGapPct, divPrice, divPriceDate, recordDate, recordFuture, buyDeadline });

    const accKey = it.account || "계좌 미지정";
    if (!accountMap.has(accKey)) accountMap.set(accKey, { value: 0, cost: 0, costedValue: 0, monthlyDiv: 0, monthlyBuy: 0, n: 0 });
    const g = accountMap.get(accKey);
    g.value += value; if (cost != null) { g.cost += cost; g.costedValue += value; } g.monthlyDiv += monthlyDiv; g.monthlyBuy += monthlyBuy; g.n += 1;

    if (monthlyDiv > 0) {
      const pKey = it.payPeriod || "지급시기 미지정";
      periodMap.set(pKey, (periodMap.get(pKey) || 0) + monthlyDiv);
    }
  }

  const totalProfit = totalCost > 0 ? costedValue - totalCost : null;
  const selfSuffRate = totalMonthlyBuy > 0 ? totalMonthlyDiv / totalMonthlyBuy : null;

  // 계좌별로 묶어서 보이게 정렬(정식 계좌 순서 우선, 목록 밖 계좌명은 뒤로·이름순,
  // 같은 계좌 안에서는 평가액 내림차순) — 정렬이 없으면 나중에 추가된 종목이 항상
  // 배열 끝에 붙어 같은 계좌가 표에서 여러 구간으로 쪼개져 보이는 문제가 있었다.
  perRow.sort((a, b) => {
    const ai = ACCOUNT_TYPES.indexOf(a.account), bi = ACCOUNT_TYPES.indexOf(b.account);
    const ar = ai === -1 ? ACCOUNT_TYPES.length : ai, br = bi === -1 ? ACCOUNT_TYPES.length : bi;
    if (ar !== br) return ar - br;
    if (a.account !== b.account) return (a.account || "").localeCompare(b.account || "");
    return b.value - a.value;
  });

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
  // A32a: 📐 계획 달성현황(컴팩트 카드·추이탭)에서도 "수기입력 목표액 도달까지"를 같이 보여주기
  // 위해 저장 — 계산은 위 goal/goalLabel과 완전히 동일(같은 #myGoalAmount·#myExpectedReturn 참조),
  // 여기서는 새 계산 없이 재사용만 한다.
  state.myAssetsGoalInfo = goal ? { goalAmount, goalLabel, goalRate } : null;

  const rowsHTML = perRow.map((p) => {
    const ttm = p.meta && p.meta.ttmDividend ? p.meta.ttmDividend : 0;
    // A24c: 주당 분배금은 실제 계산에 쓴 값(분배율×현재가)을 그대로 보여준다 — 화면 숫자와
    // 월배당 합계가 서로 다른 근거로 계산되면 사용자가 검산할 수 없기 때문.
    const perShareMonthly = p.dpsFromRate != null ? p.dpsFromRate : p.confirmedDps > 0 ? p.confirmedDps : ttm / 12;
    const basisText = DIV_BASIS_LABEL(p);
    const basisColor = p.divBasis === "ttm" ? "var(--text-muted)" : "var(--good)";
    const distLabel = perShareMonthly > 0
      ? `${p.isUsd ? "$" + perShareMonthly.toFixed(4) : fmtW(perShareMonthly)} <span style="color:${basisColor}; font-size:11px;">${basisText}</span>${
          p.dpsGapPct != null && Math.abs(p.dpsGapPct) >= 0.02
            ? `<br><span style="color:var(--critical); font-size:11px;">확정 ${fmtW(p.confirmedDps)} 대비 ${p.dpsGapPct >= 0 ? "+" : ""}${(p.dpsGapPct * 100).toFixed(0)}%</span>` : ""}${divRecordNoteHTML(p)}`
      : "—";
    const divLabel = p.monthlyDiv > 0
      ? `${fmtW(p.monthlyDiv)} <span style="color:${basisColor}; font-size:11px;">${basisText}</span>`
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

  // 매수계획 상세(ETF모으기)
  const buyPlanHTML = buildBuyPlanHTML(perRow);

  // 계좌 히트맵 탭은 A7에서 트리맵으로 대체 — 패널 컨테이너에 renderMyAssets 끝의
  // 와이어링(renderTreemap)이 buildTreemapHTML 결과를 채운다.

  // 월별 스냅샷 추이 — 계좌 갱신 시 자동 기록(A25a) + "이번 달 스냅샷 저장" 수동 버튼
  const history = JSON.parse(localStorage.getItem(MY_ASSETS_HISTORY_KEY) || "[]");
  // 연도별 확정 배당 이력 + 예상 대비 괴리율(A25c) — history를 쓰므로 반드시 그 뒤에서 호출
  const yearlyHTML = buildYearlyDivHTML(state.myAssetsDivHistory || {}, totalMonthlyDiv, history);
  const trendHTML = history.length >= 2
    ? `<div id="myAssetTrendChart"></div>`
    : `<p class="compare-empty">"이번 달 스냅샷 저장"을 매달 눌러두면 평가액·월배당 추이 그래프가 여기 쌓입니다(현재 ${history.length}개월 기록).</p>`;
  // 일별 자산변동 캡처 이력 — "오늘 자산 스냅샷" 버튼으로 누적(기기 저장, 매일 직접 눌러야 함)
  const dailyHistory = JSON.parse(localStorage.getItem(MY_ASSETS_DAILY_HISTORY_KEY) || "[]");

  // 수익률 분석 — 자산 수익률(스냅샷 이력) + 지역별 수익률 + 배당수익률(계좌별·비중별)
  const returnAnalysisHTML = buildReturnAnalysisHTML(regionRetMap, styleRetMap, accountMap, history, perRow);

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
        ${/* A36: 이 수치가 어디서 왔는지 화면에 밝힌다. 종전에는 "연 22.7% 가정"만 보여서
             근거를 물어봐야 알 수 있었고, 배당이 바뀌면 이 값도 따라 움직이는데 그 사실이
             드러나지 않았다(실제로 배당 과대계상이 고쳐지자 27.4%→22.7%로 내려갔다). */""}
        <p class="stat-sub" style="color:var(--text-muted);">└ 산출 근거: ${
          cfg.returnMode !== "manual" ? "종목별 실적" : "기대수익률(직접입력)"
        } <b>${expReturn == null ? "0.0" : (expReturn * 100).toFixed(1)}%</b> + 배당수익률 <b>${(wDivYield * 100).toFixed(2)}%</b>${
          livingExpenseUsed > 0 ? `(재투자 ${fmtW(reinvestedDiv)}/월 ÷ 평가액 기준)` : ""
        }. <b>배당이 바뀌면 이 수치도 자동으로 바뀝니다.</b>${
          cfg.returnMode === "manual" && expReturn != null
            ? " ⚠️ 직접입력값은 <b>주가 상승률</b>로 취급돼 배당수익률이 더해집니다 — 총수익률을 넣으셨다면 배당이 이중계산됩니다."
            : ""
        }</p>
        <p class="stat-sub">월 재투자액 ${fmtW(totalMonthlyInvest)}${totalContributions > 0 ? ` (월매수 ${fmtW(totalMonthlyBuy)} + 월적립 ${fmtW(totalContributions)})` : ""} 반영${livingExpenseUsed > 0 ? ` · 배당은 재투자분(${fmtW(reinvestedDiv)}/월)만 복리 반영, 생활비 사용분 제외` : ""}</p>
        ${realGoalLabel ? `<p class="stat-sub" style="color:var(--text-muted);">물가상승률 ${(inflationRate * 100).toFixed(1)}%/년 반영(오늘 구매력 기준): <b>${realGoalLabel}</b></p>` : ""}
      </div>` : ""}
      <div class="stat" id="myGoalPlanCompactWrap"><p class="stat-label">📐 계획 달성현황</p><p class="stat-sub">불러오는 중…</p></div>
    </div>
    <p class="stat-sub">최신 수집: ${state.manifest.updated} 기준(주간 자동 수집 — 실시간 시세 아님)${
      liveKr ? ` · <b style="color:var(--good)">🔄 최신시세 ${liveKr.updated} 적용(국내 ${liveApplied}종목, GitHub 사정에 따라 수 시간 지연 가능)</b>`
      : liveQuotesEnabled() ? ` · <span style="color:var(--critical)">🔄 최신시세 불러오기 실패(${state.liveKrError || "데이터 없음"}) — 주간 종가 사용</span>` : ""
    }</p>
    ${excludedStockHTML}
    ${unknownHTML}

    <div class="dash-tabs" id="myDashTabs">
      <button type="button" class="dash-tab-btn" data-tab="overview">📊 통합</button>
      <button type="button" class="dash-tab-btn" data-tab="trend">📈 추이</button>
      <button type="button" class="dash-tab-btn" data-tab="summary">📋 종합</button>
      <button type="button" class="dash-tab-btn" data-tab="alloc">📊 비중분석</button>
      <button type="button" class="dash-tab-btn" data-tab="heatmap">🗺️ 비중 히트맵</button>
      <button type="button" class="dash-tab-btn" data-tab="divstatus">💰 월배당현황</button>
      <button type="button" class="dash-tab-btn" data-tab="suff">⚖️ 자급률·월매수</button>
      <button type="button" class="dash-tab-btn" data-tab="divbasis">💹 배당기준·이력</button>
      <button type="button" class="dash-tab-btn" data-tab="benchmark">📊 지수비교</button>
      <button type="button" class="dash-tab-btn" data-tab="signal">📡 시그널</button>
      <button type="button" class="dash-tab-btn" data-tab="review">🧺 포트폴리오검토</button>
      <button type="button" class="dash-tab-btn" data-tab="changelog">🗂️ 변동이력</button>
      <button type="button" class="dash-tab-btn" data-tab="ai">🤖 AI 분석</button>
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

      <p class="chart-title" style="margin-top:24px;">📅 월별 비중 변화</p>
      <div class="controls" style="margin-bottom:8px;">
        <select id="myTrendWeightGroup" aria-label="비중 이력 그룹 기준">
          <option value="account">계좌별</option>
          <option value="category">카테고리별</option>
        </select>
      </div>
      <div id="myTrendWeightHistBody"></div>

      <p class="chart-title" style="margin-top:24px;">📉 MDD 이력 (계좌 전체)</p>
      ${buildMDDHistoryHTML(history, loadAssetChangelog(), perRow)}

      <p class="chart-title" style="margin-top:24px;">🗺️ 계좌별 MDD</p>
      ${buildMDDBreakdownHTML(perRow, "account")}

      <p class="chart-title" style="margin-top:24px;">🎯 성향별 MDD</p>
      ${buildMDDBreakdownHTML(perRow, "style")}

      <p class="chart-title" style="margin-top:24px;">📐 VOO·QQQ·SCHD MDD 비교</p>
      <div id="myBenchMddWrap"><p class="compare-empty">불러오는 중…</p></div>

      <p class="chart-title" style="margin-top:24px;">💵 계좌별 월별 손익</p>
      <p class="stat-sub">선택한 계좌의 <b>현재 보유 수량을 그 기간 내내 갖고 있었다고 가정</b>하고 월말 평가액 변화를 손익으로 계산합니다 — 실제 입출금·매매 내역은 반영하지 않으므로 추가 매수·환매가 있었던 달은 실제 손익과 다르게 보일 수 있습니다.</p>
      <div class="controls" style="margin-bottom:8px;">
        <select id="myMonthlyPnlAccount" aria-label="월별 손익 계좌 선택"></select>
      </div>
      <div id="myMonthlyPnlChart"><p class="compare-empty">계좌를 선택하면 표시됩니다.</p></div>

      <p class="chart-title" style="margin-top:24px;">📐 계획 달성현황</p>
      <p class="stat-sub">월별 스냅샷을 쌓기 시작한 첫 달부터 지금까지, "그 수익률로 꾸준히 불었다면"과 실제 자산을 대조합니다. 기대수익률(위 목표 입력칸)을 넣으면 그 값을, 비워두면 S&P500 추세수익률을 계획①로 쓰고 계획②는 그 2배입니다.</p>
      <div class="controls" style="margin-bottom:8px; flex-wrap:wrap; gap:8px 16px;">
        <select id="myGoalPlanScope" aria-label="계획 달성현황 범위 선택">
          <option value="__all__">종합(전체 계좌)</option>
        </select>
        <div style="display:inline-flex; border-radius:999px; overflow:hidden; border:1px solid var(--border);">
          <button type="button" class="btn-action my-goalplan-basis" data-basis="amount" style="border-radius:0; border:none;">금액기준</button>
          <button type="button" class="btn-action my-goalplan-basis" data-basis="return" style="border-radius:0; border:none;">수익률기준</button>
        </div>
      </div>
      <div id="myGoalPlanTable"></div>
      <div id="myGoalPlanChart" style="margin-top:10px;"></div>
    </div>

    <div class="dash-panel" data-tab="summary" hidden>
      <p class="chart-title" style="margin-top:20px;">계좌별 합계</p>
      <div style="overflow-x:auto;">
      <table class="account-summary-table">
        <thead><tr><th>계좌</th><th>종목 수</th><th>평가액</th><th>월배당</th></tr></thead>
        <tbody>${accHTML}</tbody>
      </table>
      </div>

      <details class="collapse-box" style="margin-top:20px;">
        <summary>보유 종목 상세 (${perRow.length}건)</summary>
        <div class="collapse-body" style="overflow-x:auto;">
        <table class="account-summary-table">
          <thead><tr><th>계좌</th><th>종목</th><th>수량</th><th>현재가</th><th>평가액</th><th>손익</th><th>분배금(주당·월평균)</th><th>월배당</th></tr></thead>
          <tbody>${rowsHTML}</tbody>
        </table>
        </div>
      </details>

      <p class="chart-title" style="margin-top:24px;">📤 리포트 생성</p>
      <p class="stat-sub">종합·비중·추이·배당 정보를 텍스트 한 장으로 모읍니다 — 계좌번호는 자동으로 가려집니다. 구글시트·엑셀·노션은 API 직접 연동이 브라우저에서 막혀 있어 클립보드 복사로 대체합니다(복사된 텍스트를 각 서비스에 붙여넣으세요).</p>
      <div class="controls" style="margin:6px 0 8px; flex-wrap:wrap; gap:10px 16px;">
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;"><input type="checkbox" class="my-report-dest" value="download" checked> 📥 다운로드</label>
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;"><input type="checkbox" class="my-report-dest" value="clipboard"> 📋 클립보드(구글시트·엑셀·노션)</label>
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;"><input type="checkbox" class="my-report-dest" value="obsidian" id="myReportObsidianWrap"> 🗂️ 옵시디안</label>
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;"><input type="checkbox" class="my-report-dest" value="telegram"> 📨 텔레그램</label>
      </div>
      <div class="action-row">
        <button type="button" id="myReportBtn" class="btn-action">📤 리포트 생성</button>
        <span id="myReportStatus" class="action-status"></span>
      </div>
    </div>

    <div class="dash-panel" data-tab="alloc" hidden>
      ${marketKpiHTML}
      <p class="chart-title" style="margin-top:20px;">🌱 성장·배당·안전 비중</p>
      <div class="bar-list">${styleAllocHTML}</div>

      <p class="chart-title" style="margin-top:20px;">🧩 자산 성격별 비중 (카테고리)</p>
      <div class="bar-list">${categoryAllocHTML}</div>

      <p class="chart-title" style="margin-top:20px;">🗺️ 계좌별 비중</p>
      <div class="bar-list">${accountAllocHTML}</div>
      <p class="stat-sub" style="margin-top:8px;">시장 전망(드러켄밀러 OS·매크로 스코어)은 외부 시장데이터가 필요해 이 사이트 범위 밖입니다 — 클로드 세션(금융비서)에서 제공됩니다.</p>

      ${returnAnalysisHTML}

      <p class="chart-title" style="margin-top:24px;">📅 월별 비중 변화</p>
      <div class="controls" style="margin-bottom:8px;">
        <select id="myWeightHistGroup" aria-label="비중 이력 그룹 기준">
          <option value="account">계좌별</option>
          <option value="category">카테고리별</option>
        </select>
      </div>
      <div id="myWeightHistBody"></div>

      <details class="collapse-box" style="margin-top:20px;">
        <summary>📊 자산배분 비중 — 전종목 (${bySymbolValue.length}건)</summary>
        <div class="collapse-body bar-list">${assetAllocHTML}</div>
      </details>
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
      <details class="collapse-box" open>
        <summary>🌡️ 변동성 체제 — VIX vs VIXEQ</summary>
        <div class="collapse-body" id="mySignalVolBody"><p class="compare-empty">불러오는 중…</p></div>
      </details>

      <details class="collapse-box" open>
        <summary>🔍 전 종목 스캔</summary>
        <div class="collapse-body">
          <p class="stat-sub">선택한 범위의 종목을 한 번에 스캔해 종합등급순으로 정렬합니다(강매수→강매도). 데이터 로딩량이 있어 버튼을 눌러야 실행됩니다.</p>
          <div class="controls" style="margin:8px 0;">
            <select id="mySignalScanGroup" aria-label="스캔 범위 선택">
              <option value="mine">보유+워치리스트</option>
              <option value="kr">국내 전체</option>
              <option value="us">미국 전체</option>
              <option value="all">전체(국내+미국)</option>
            </select>
            <button type="button" id="mySignalScanBtn" class="btn-action">🔍 스캔 실행</button>
          </div>
          <div id="mySignalScanBody"></div>
        </div>
      </details>

      <details class="collapse-box" open>
        <summary>👀 워치리스트 — 20일 포지션</summary>
        <div class="collapse-body">
          <p class="stat-sub">현재가가 최근 20거래일 최저~최고 범위의 어디에 있는지 표시합니다 — <b>하단 30% 이하 🟢 관심 구간, 상단 75% 이상 🔴 경계 구간</b>. 국내 종목은 🔄 최신시세 켜짐 시 실시간가, 미국 종목은 주 1회 수집 종가 기준입니다(참고용, 투자 조언 아님).</p>
          <div id="mySignalWatchBody"></div>
          <div class="controls" style="margin:8px 0;">
            <select id="mySignalWatchAdd" aria-label="워치리스트에 추가할 종목"></select>
            <button type="button" id="mySignalWatchAddBtn" class="btn-action">➕ 워치리스트 추가</button>
          </div>
        </div>
      </details>

      <details class="collapse-box" open>
        <summary>📡 선택 종목 시그널 상세</summary>
        <div class="collapse-body">
          <div class="controls" style="margin:8px 0;">
            <select id="mySignalSymbol" aria-label="시그널 상세 종목 선택"></select>
          </div>
          <div id="mySignalDetailBody"></div>
        </div>
      </details>

      <details class="collapse-box">
        <summary>📐 표준편차(σ)·매수목표가 — 주요 종목</summary>
        <div class="collapse-body">
          <p class="stat-sub">σ = 일간수익률 표준편차(%). <b>기본 1년(252거래일)</b> — 노션 매수테이블의 실측 σ와 같은 계산 계열이며, 30일 σ는 최근 급변을 반영해 더 큽니다.</p>
          <div class="controls" style="margin:8px 0;">
            <select id="mySignalSigmaWin" aria-label="시그마 계산 기간">
              <option value="252" selected>σ 기간: 1년(252일)</option>
              <option value="30">σ 기간: 30일</option>
            </select>
          </div>
          <div id="mySignalSigmaBody"></div>
        </div>
      </details>

      <details class="collapse-box">
        <summary>🎯 레버리지 σ 매수가 — 전일종가 기준</summary>
        <div class="collapse-body">
          <div class="controls" style="margin:8px 0;">
            <select id="mySignalLevSymbol" aria-label="레버리지 매수가 종목 선택"></select>
          </div>
          <div id="mySignalLevBody"></div>
        </div>
      </details>
    </div>

    <div class="dash-panel" data-tab="review" hidden>
      <p class="chart-title" style="margin-top:20px;">⚖️ 스타일 비중 검토 — 배당/성장 목표 대비</p>
      <p class="stat-sub">은퇴 후 배당 포트폴리오 전환 검토용 — 내 보유의 배당/성장 비중을 목표와 비교합니다(참고용, 투자 조언 아님).</p>
      <div class="controls" style="margin:8px 0;">
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;">목표 배당 비중 <input type="number" id="myReviewDivTarget" value="70" min="0" max="100" step="5" style="width:60px;">%</label>
        <span class="stat-sub">(나머지 = 성장 목표)</span>
      </div>
      <div id="myReviewStyleBody"></div>

      <p class="chart-title" style="margin-top:20px;">🏁 운용 목표 진행률</p>
      <div class="controls" style="margin:8px 0;">
        <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;">목표금액 <input type="number" id="myReviewGoal" value="4000000000" step="100000000" style="width:150px;">원</label>
      </div>
      <div id="myReviewGoalBody"></div>

      <details class="collapse-box" style="margin-top:20px;">
        <summary>🧺 모델 포트폴리오 대조 — 평온 배당70/성장30 (24종)</summary>
        <div class="collapse-body" id="myReviewModelBody"></div>
      </details>
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
        <button type="button" id="myChangelogReportBtn" class="btn-action">🔄 최근 변동 리포트</button>
        <button type="button" id="myChangelogClearBtn" class="btn-action">🗑️ 이력 지우기</button>
        <span id="myChangelogStatus" class="action-status"></span>
      </div>
      <div id="myChangelogBody"></div>
    </div>

    <div class="dash-panel" data-tab="ai" hidden>
      <p class="chart-title" style="margin-top:20px;">🤖 AI 분석 (옵션)</p>
      <p class="stat-sub">「📋 종합」 탭의 리포트를 AI에게 보내 계좌·성향 쏠림, 분산도, 배당 집중도 같은 관찰 포인트를 받아봅니다 — <b>매매 자문이 아닌 참고용</b>입니다. 설정 탭(또는 캡처 앱)에 제미나이 키가 있으면 자동으로 분석하고, 없으면 프롬프트만 복사해 원하는 AI 채팅에 직접 붙여넣을 수 있습니다.</p>
      <div class="action-row" style="margin:8px 0;">
        <button type="button" id="myAiAnalyzeBtn" class="btn-action">🔍 AI 분석 시작</button>
        <button type="button" id="myAiPromptCopyBtn" class="btn-action">📋 프롬프트만 복사</button>
        <button type="button" id="myAiTelegramBtn" class="btn-action">📨 텔레그램으로 보내기</button>
        <span id="myAiStatus" class="action-status"></span>
      </div>
      <div id="myAiResult"></div>
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

      <p class="chart-title" style="margin-top:20px;">🗂️ 옵시디안 폰 백업 (앱 전용)</p>
      <p class="stat-sub">노션(온라인) 말고 <b>폰 안에도</b> 배당·종목변동·일별 종합결과를 남깁니다. 아래에 옵시디안 볼트 경로를 넣으면 데이터가 바뀔 때마다 그 폴더에 <b>마크다운(.md)과 JSON</b>이 함께 저장돼, 옵시디안에서 바로 열어 보거나 검색할 수 있습니다.</p>
      <div class="action-row" style="margin:8px 0;">
        <input type="text" id="myObsidianPath" placeholder="예: Obsidian/14rae" style="min-width:200px;" value="${obsidianVaultPath().replace(/"/g, "&quot;")}">
        <button type="button" id="myObsidianSaveBtn" class="btn-action">저장</button>
        <button type="button" id="myObsidianBackupBtn" class="btn-action" style="display:none;">📥 지금 백업</button>
        <span id="myObsidianStatus" class="action-status"></span>
      </div>
      <p class="stat-sub">경로는 <b>문서 폴더 기준 상대경로</b>로 적으세요(안드로이드 저장소 정책상 임의 절대경로는 앱이 쓸 수 없습니다). 예를 들어 <code>Obsidian/14rae</code>를 넣으면 <b>문서/Obsidian/14rae/14fiance/</b> 아래에 파일이 생깁니다. 옵시디안에서 "폴더를 볼트로 열기"로 그 폴더(또는 상위 <code>문서/Obsidian</code>)를 지정하면 됩니다.</p>
      <p class="stat-sub"><b>노션을 안 쓰는 경우</b>에도 이 경로만 지정해두면 기록이 전부 폰에 남습니다 — 노션 연동은 필수가 아니며, 이 백업만으로 배당 이력·종목변동·일별 결과를 계속 추적할 수 있습니다. (웹 브라우저에서는 파일 저장 권한이 없어 이 기능은 앱에서만 동작합니다.)</p>

      <p class="chart-title" style="margin-top:20px;">🔑 API 키 (텔레그램·AI 분석)</p>
      <p class="stat-sub">여기 입력한 키는 <b>이 기기의 브라우저(localStorage)에만</b> 저장되고 저장소·서버로는 전송되지 않습니다. AI 분석 탭은 캡처 앱(📸 캡처 탭 → 설정)에서 이미 넣어둔 제미나이 키를 그대로 씁니다 — 같은 브라우저·앱이면 한 번만 넣으면 됩니다.</p>
      <div class="action-row" style="margin:8px 0;">
        <input type="password" id="myTelegramToken" placeholder="텔레그램 봇 토큰(선택)" style="min-width:220px;" autocomplete="off">
        <input type="text" id="myTelegramChatId" placeholder="chat_id" style="min-width:110px;" autocomplete="off">
        <button type="button" id="myTelegramSaveBtn" class="btn-action">저장</button>
        <button type="button" id="myTelegramTestBtn" class="btn-action">🔌 연결 테스트</button>
        <button type="button" id="myTelegramClearBtn" class="btn-action" style="color:var(--critical);">삭제</button>
        <span id="myTelegramStatus" class="action-status"></span>
      </div>
      <p class="stat-sub">봇 토큰은 텔레그램에서 <b>@BotFather</b>에게 <code>/newbot</code>을 보내면 발급됩니다. chat_id는 그 봇과 대화를 한 번 시작한 뒤 브라우저로 <code>https://api.telegram.org/bot&lt;토큰&gt;/getUpdates</code>를 열면 <code>"chat":{"id":...}</code> 값으로 확인할 수 있습니다. 저장해두면 「📋 종합」 탭의 "📤 리포트 생성"에서 텔레그램으로 바로 보낼 수 있습니다.</p>

      <p class="chart-title" style="margin-top:20px;" id="myAutoReportTitle">📤 평일 장마감 자동 리포트 (앱 전용)</p>
      <p class="stat-sub">매일 <b>평일 16:05경(국내 장마감 후)</b> 앱을 직접 켜지 않아도 자동으로 실행돼 텔레그램 리포트를 보내고, 「추이」 탭의 오늘 자산 스냅샷도 함께 저장합니다. 위 텔레그램 봇 토큰·chat_id가 저장돼 있어야 동작합니다.</p>
      <div class="action-row" style="margin:8px 0;">
        <label style="display:inline-flex; align-items:center; gap:6px;">
          <input type="checkbox" id="myAutoReportToggle">
          자동 발신 켜기
        </label>
        <span id="myAutoReportStatus" class="action-status"></span>
      </div>
      <p class="stat-sub">알람 시각에 앱이 잠깐 자동으로 열렸다 닫힙니다(정상 동작). 기기 제조사의 강한 배터리 최적화(일부 삼성·샤오미 기기)가 걸려 있으면 지연되거나 건너뛸 수 있습니다 — 계속 안 오면 설정 &gt; 배터리에서 이 앱의 배터리 최적화를 "제한 없음"으로 바꿔보세요.</p>
      <div class="action-row" style="margin:8px 0;">
        <button type="button" id="myKeysExportBtn" class="btn-action">🔑 키 내보내기</button>
        <button type="button" id="myKeysImportBtn" class="btn-action">🔑 키 불러오기</button>
        <input type="file" id="myKeysImportFile" accept="application/json" style="display:none;">
        <span id="myKeysStatus" class="action-status"></span>
      </div>
      <p class="stat-sub">키 내보내기는 <b>이 기기의 API 키만</b> 담은 별도 파일입니다(보유 종목·계좌 정보는 포함되지 않음) — 위 "📤 내보내기"(백업 파일)와는 다른 파일이니 따로 보관하세요. 재설치·기기변경 시 이 파일로 키만 복원할 수 있습니다. <b>이 파일은 저장소에 커밋하거나 다른 사람과 공유하지 마세요.</b></p>

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
    // A25a: 수동 버튼도 자동 경로와 같은 헬퍼를 써서 저장 형식(비중 포함)을 하나로 통일한다.
    upsertMonthlySnapshot();
    // saveMyAssets()가 MY_ASSETS_KEY 안의 박제 사본까지 동기화해야, 앱 재실행 시
    // applyMyAssets()가 그 오래된 사본으로 방금 쓴 값을 되씌우지 않는다.
    saveMyAssets();
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
    // saveMyAssets()가 MY_ASSETS_KEY 안의 박제 사본까지 동기화해야, 앱 재실행 시
    // applyMyAssets()가 그 오래된 사본으로 방금 쓴 값을 되씌우지 않는다.
    saveMyAssets();
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
    /* A36: 일별 스냅샷 개별 삭제 — 반영 사고 중에 저장된 오염 스냅샷이 남아 있으면
       추이 차트·주간·월별 계산이 전부 그 값을 물고 간다. 자동 판별은 하지 않는다
       (어느 값이 오염인지는 사람만 안다) — 삭제는 확인 다이얼로그를 거친다. */
    body.querySelectorAll(".my-daily-del").forEach((btn) => {
      btn.addEventListener("click", () => {
        const date = btn.dataset.date;
        const hist = JSON.parse(localStorage.getItem(MY_ASSETS_DAILY_HISTORY_KEY) || "[]");
        const target = hist.find((h) => h.date === date);
        if (!target) return;
        if (!window.confirm(`${date} 스냅샷을 삭제합니다.\n\n평가액 ${fmtPrice(target.value, "KRW")}\n\n되돌릴 수 없습니다. 계속하시겠습니까?`)) return;
        const next = hist.filter((h) => h.date !== date);
        localStorage.setItem(MY_ASSETS_DAILY_HISTORY_KEY, JSON.stringify(next));
        // 2026-08-01 실사례와 같은 이유로 saveMyAssets()까지 해야 앱 재시작 때
        // MY_ASSETS_KEY 안의 박제 사본이 삭제분을 되살리지 않는다.
        saveMyAssets();
        flashStatus("myDailySnapshotStatus", `${date} 스냅샷 삭제됨`);
        renderMyAssets();
      });
    });
  };
  if (state.myAssetChangeGranularity) changeSel.value = state.myAssetChangeGranularity;
  changeSel.addEventListener("change", () => { state.myAssetChangeGranularity = changeSel.value; renderAssetChange(); });
  renderAssetChange();

  // A25d: 옵시디안 볼트 경로 저장 + 수동 백업(네이티브에서만 버튼 노출)
  const obsInput = document.getElementById("myObsidianPath");
  const obsSaveBtn = document.getElementById("myObsidianSaveBtn");
  if (obsInput && obsSaveBtn) {
    obsSaveBtn.addEventListener("click", () => {
      const v = obsInput.value.trim().replace(/^\/+|\/+$/g, "");
      localStorage.setItem(OBSIDIAN_PATH_KEY, v);
      flashStatus("myObsidianStatus", v ? `저장됨 — 문서/${v}/14fiance/` : "경로를 비웠습니다(백업 안 함)");
      if (v && typeof window.exportObsidianNotes === "function") window.exportObsidianNotes();
    });
    const obsBackupBtn = document.getElementById("myObsidianBackupBtn");
    if (obsBackupBtn && typeof window.exportObsidianNotes === "function") {
      obsBackupBtn.style.display = ""; // 네이티브(APK)에서만 함수가 정의됨
      obsBackupBtn.addEventListener("click", async () => {
        if (!obsidianVaultPath()) { flashStatus("myObsidianStatus", "먼저 볼트 경로를 저장하세요"); return; }
        flashStatus("myObsidianStatus", "백업 중…");
        const ok = await window.exportObsidianNotes();
        flashStatus("myObsidianStatus", ok ? "백업 완료 ✓" : "백업 실패 — 경로·권한을 확인하세요");
      });
    }
  }

  // A28: 텔레그램 봇 토큰·chat_id 저장/삭제/연결테스트 — capture 앱의 API 키 UI와 같은 결.
  const tgTokenInput = document.getElementById("myTelegramToken");
  const tgChatInput = document.getElementById("myTelegramChatId");
  if (tgTokenInput && tgChatInput) {
    tgTokenInput.value = telegramBotToken();
    tgChatInput.value = telegramChatId();
    document.getElementById("myTelegramSaveBtn").addEventListener("click", () => {
      localStorage.setItem(MY_TELEGRAM_TOKEN_KEY, tgTokenInput.value.trim());
      localStorage.setItem(MY_TELEGRAM_CHATID_KEY, tgChatInput.value.trim());
      flashStatus("myTelegramStatus", "저장됨 ✓");
    });
    document.getElementById("myTelegramClearBtn").addEventListener("click", () => {
      localStorage.removeItem(MY_TELEGRAM_TOKEN_KEY);
      localStorage.removeItem(MY_TELEGRAM_CHATID_KEY);
      tgTokenInput.value = ""; tgChatInput.value = "";
      flashStatus("myTelegramStatus", "삭제됨");
    });
    document.getElementById("myTelegramTestBtn").addEventListener("click", async () => {
      // 저장 버튼을 안 눌러도 입력칸 값 그대로 테스트할 수 있게, 테스트 직전에 먼저 저장한다.
      localStorage.setItem(MY_TELEGRAM_TOKEN_KEY, tgTokenInput.value.trim());
      localStorage.setItem(MY_TELEGRAM_CHATID_KEY, tgChatInput.value.trim());
      flashStatus("myTelegramStatus", "전송 중…");
      const r = await sendTelegramMessage("✅ 14fiance 연결 테스트 — 이 메시지가 보이면 텔레그램 연동이 정상입니다.");
      flashStatus("myTelegramStatus", r.ok ? "성공 — 텔레그램에서 확인하세요 ✓" : `실패: ${r.error}`, 5000);
    });
  }

  // A32f: 평일 장마감 자동 리포트 토글 — app/src/auto-report.js(앱 전용)가 정의하는
  // window.setAutoReportEnabled/getAutoReportEnabled가 있을 때만 동작(웹에는 자동 실행 개념이
  // 없으므로 이 섹션 자체를 숨긴다) — 옵시디안 섹션과 같은 네이티브 감지 패턴.
  const autoReportToggle = document.getElementById("myAutoReportToggle");
  if (autoReportToggle) {
    if (typeof window.getAutoReportEnabled === "function" && typeof window.setAutoReportEnabled === "function") {
      autoReportToggle.checked = window.getAutoReportEnabled();
      autoReportToggle.addEventListener("change", async () => {
        await window.setAutoReportEnabled(autoReportToggle.checked);
        flashStatus("myAutoReportStatus", autoReportToggle.checked ? "켜짐 — 다음 평일 16:05경 자동 실행됩니다" : "꺼짐");
      });
    } else {
      const titleEl = document.getElementById("myAutoReportTitle");
      if (titleEl && titleEl.nextElementSibling) titleEl.nextElementSibling.textContent = "이 기능은 앱(APK)에서만 동작합니다 — 웹 브라우저에서는 자동 실행이 불가능합니다.";
      autoReportToggle.disabled = true;
    }
  }

  // A28: 키 내보내기/불러오기 — 보유 종목 백업(📤 내보내기)과 완전히 분리된 별도 파일.
  // 키는 serializeMyAssets()에 절대 섞지 않는다 — 그 파일은 "🤖 클로드에 복사"로 AI 채팅
  // 텍스트에도 그대로 들어가는데, 거기에 시크릿이 실려 나가면 안 되기 때문.
  const keysExportBtn = document.getElementById("myKeysExportBtn");
  if (keysExportBtn) {
    keysExportBtn.addEventListener("click", () => {
      const keys = { telegramToken: telegramBotToken(), telegramChatId: telegramChatId() };
      downloadBlob(new Blob([JSON.stringify(keys, null, 2)], { type: "application/json" }), `my-assets-keys-${todayStr()}.json`);
      flashStatus("myKeysStatus", "키 파일 저장됨 — 이 파일은 공유하지 마세요");
    });
    document.getElementById("myKeysImportBtn").addEventListener("click", () => document.getElementById("myKeysImportFile").click());
    document.getElementById("myKeysImportFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (data.telegramToken != null) localStorage.setItem(MY_TELEGRAM_TOKEN_KEY, data.telegramToken);
          if (data.telegramChatId != null) localStorage.setItem(MY_TELEGRAM_CHATID_KEY, data.telegramChatId);
          if (tgTokenInput) tgTokenInput.value = telegramBotToken();
          if (tgChatInput) tgChatInput.value = telegramChatId();
          flashStatus("myKeysStatus", "키 불러오기 완료 ✓");
        } catch (err) {
          flashStatus("myKeysStatus", "키 파일을 읽을 수 없습니다");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });
  }

  // A28: 종합 탭 리포트 생성 — 체크된 목적지마다 같은 텍스트를 각자 방식으로 내보낸다.
  // 구글시트·엑셀·노션·옵시디안(웹)은 브라우저에서 직접 API를 부를 수 없어 전부 클립보드
  // 복사 하나로 묶는다(사용자가 그 텍스트를 각 서비스에 붙여넣는다) — 실제 API 연동은
  // 텔레그램만(CORS 허용), 옵시디안은 네이티브(APK)에서만 파일로 직접 저장한다.
  const reportBtn = document.getElementById("myReportBtn");
  if (reportBtn) {
    const reportObsWrap = document.getElementById("myReportObsidianWrap");
    if (reportObsWrap && typeof window.exportReportNote !== "function") {
      reportObsWrap.closest("label").title = "웹에서는 옵시디안에 직접 쓸 수 없어 클립보드 복사로 대체됩니다(앱에서는 볼트에 직접 저장).";
    }
    reportBtn.addEventListener("click", async () => {
      const csv = state.myAssetsCsvData;
      const text = csv ? await buildReportText(csv, history) : null;
      if (!text) { flashStatus("myReportStatus", "먼저 보유 종목을 입력하세요"); return; }
      const dests = [...document.querySelectorAll(".my-report-dest:checked")].map((el) => el.value);
      if (!dests.length) { flashStatus("myReportStatus", "내보낼 곳을 하나 이상 선택하세요"); return; }
      const results = [];
      if (dests.includes("download")) {
        downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `14fiance-리포트-${todayStr()}.txt`);
        results.push("다운로드 완료");
      }
      if (dests.includes("clipboard")) {
        const ok = await copyTextToClipboard(text);
        results.push(ok ? "클립보드 복사됨" : "클립보드 복사 실패");
      }
      if (dests.includes("obsidian")) {
        // A34: 옵시디안은 기기 안 폐쇄 저장소라 마스킹하지 않은 원문으로 다시 만든다.
        // (웹 폴백은 클립보드로 가므로 마스킹된 text를 그대로 쓴다 — 밖으로 나갈 수 있는 경로)
        if (typeof window.exportReportNote === "function") {
          const rawText = await buildReportText(csv, history, { mask: false });
          const ok = await window.exportReportNote(rawText || text);
          results.push(ok ? "옵시디안 저장됨" : "옵시디안 저장 실패(볼트 경로 확인)");
        } else {
          const ok = await copyTextToClipboard(text);
          results.push(ok ? "옵시디안용 클립보드 복사됨" : "클립보드 복사 실패");
        }
      }
      if (dests.includes("telegram")) {
        // 텔레그램 메시지는 4096자 제한 — 넘으면 잘라 보내고 잘렸다는 사실을 알린다.
        const tgText = text.length > 4000 ? text.slice(0, 3900) + "\n…(길이 제한으로 이하 생략)" : text;
        const r = await sendTelegramMessage(tgText);
        results.push(r.ok ? "텔레그램 전송됨" : `텔레그램 실패: ${r.error}`);
      }
      flashStatus("myReportStatus", results.join(" · "), 6000);
    });
  }

  // A28: AI 분석 탭 — 제미나이 키가 있으면 자동 호출, 없으면 프롬프트 복사로 폴백.
  const aiAnalyzeBtn = document.getElementById("myAiAnalyzeBtn");
  if (aiAnalyzeBtn) {
    const buildPromptOrWarn = async () => {
      const csv = state.myAssetsCsvData;
      const text = csv ? await buildReportText(csv, history) : null;
      if (!text) { flashStatus("myAiStatus", "먼저 보유 종목을 입력하세요"); return null; }
      return buildAiAnalysisPrompt(text);
    };
    aiAnalyzeBtn.addEventListener("click", async () => {
      const prompt = await buildPromptOrWarn();
      if (!prompt) return;
      const key = geminiApiKey();
      const resultEl = document.getElementById("myAiResult");
      if (!key) {
        const ok = await copyTextToClipboard(prompt);
        flashStatus("myAiStatus", ok ? "제미나이 키가 없어 프롬프트를 복사했습니다 — AI 채팅에 붙여넣으세요" : "복사 실패", 6000);
        return;
      }
      flashStatus("myAiStatus", "분석 중… (제미나이 호출)");
      try {
        const answer = await callGeminiText(prompt, key);
        resultEl.innerHTML = `<div class="card" style="margin-top:10px; white-space:pre-wrap; line-height:1.6;">${(answer || "(응답이 비어 있습니다)").replace(/</g, "&lt;")}</div>`;
        flashStatus("myAiStatus", "분석 완료 ✓");
      } catch (err) {
        flashStatus("myAiStatus", "분석 실패: " + err.message, 6000);
      }
    });
    document.getElementById("myAiPromptCopyBtn").addEventListener("click", async () => {
      const prompt = await buildPromptOrWarn();
      if (!prompt) return;
      const ok = await copyTextToClipboard(prompt);
      flashStatus("myAiStatus", ok ? "프롬프트 복사됨 — AI 채팅에 붙여넣으세요" : "복사 실패");
    });
    // AI 분석 결과 텔레그램 발송 — #myAiResult에 이미 렌더된 결과 텍스트를 그대로 보낸다
    // (다시 분석을 돌리지 않음). 프롬프트 복사만 한 경우(제미나이 키 없음)는 결과가 없으므로
    // 안내만 하고 끝낸다 — 그 경우 보낼 "분석 결과"가 애초에 없기 때문.
    document.getElementById("myAiTelegramBtn").addEventListener("click", async () => {
      const resultEl = document.getElementById("myAiResult");
      const text = resultEl && resultEl.textContent.trim();
      if (!text) { flashStatus("myAiStatus", "먼저 「AI 분석 시작」으로 분석 결과를 받으세요(제미나이 키 필요)"); return; }
      flashStatus("myAiStatus", "텔레그램 전송 중…");
      const tgText = text.length > 4000 ? text.slice(0, 3900) + "\n…(길이 제한으로 이하 생략)" : text;
      const r = await sendTelegramMessage(`🤖 AI 분석 결과 (${todayStr()})\n\n${tgText}`);
      flashStatus("myAiStatus", r.ok ? "텔레그램 전송됨 ✓" : `텔레그램 실패: ${r.error}`, 6000);
    });
  }

  // A29: 계좌별 월별 손익 — 계좌 선택 select, 선택은 state에 보존(다른 select들과 같은 패턴).
  const pnlSel = document.getElementById("myMonthlyPnlAccount");
  if (pnlSel) {
    pnlSel.innerHTML = `<option value="__all__">전체 계좌(합산)</option>` +
      [...accountMap.keys()].map((a) => `<option value="${a}">${a}</option>`).join("");
    const savedPnlAcc = state.myMonthlyPnlAccount && [...accountMap.keys(), "__all__"].includes(state.myMonthlyPnlAccount)
      ? state.myMonthlyPnlAccount : "__all__";
    pnlSel.value = savedPnlAcc;
    pnlSel.addEventListener("change", () => {
      state.myMonthlyPnlAccount = pnlSel.value;
      renderMonthlyPnlChart(pnlSel.value);
    });
    renderMonthlyPnlChart(savedPnlAcc);
  }

  // A30: 계획 달성현황 — 범위(종합/계좌) select + 금액·수익률 토글, 선택은 state에 보존.
  const goalPlanSel = document.getElementById("myGoalPlanScope");
  if (goalPlanSel) {
    goalPlanSel.innerHTML = `<option value="__all__">종합(전체 계좌)</option>` +
      [...accountMap.keys()].map((a) => `<option value="${a}">${a}</option>`).join("");
    const savedScope = state.myGoalPlanScope && [...accountMap.keys(), "__all__"].includes(state.myGoalPlanScope)
      ? state.myGoalPlanScope : "__all__";
    goalPlanSel.value = savedScope;
    const savedBasis = state.myGoalPlanBasis === "return" ? "return" : "amount";
    const basisBtns = [...document.querySelectorAll(".my-goalplan-basis")];
    const setBasisActive = (basis) => basisBtns.forEach((b) => {
      b.style.background = b.dataset.basis === basis ? "var(--accent, #2563eb)" : "";
      b.style.color = b.dataset.basis === basis ? "#fff" : "";
    });
    setBasisActive(savedBasis);
    basisBtns.forEach((b) => b.addEventListener("click", () => {
      state.myGoalPlanBasis = b.dataset.basis;
      setBasisActive(b.dataset.basis);
      renderGoalPlanSection(goalPlanSel.value, b.dataset.basis);
    }));
    goalPlanSel.addEventListener("change", () => {
      state.myGoalPlanScope = goalPlanSel.value;
      renderGoalPlanSection(goalPlanSel.value, state.myGoalPlanBasis === "return" ? "return" : "amount");
    });
    renderGoalPlanSection(savedScope, savedBasis);
  }
  renderGoalPlanCompact(); // 통합 탭 상단 헤더 카드 — 탭과 무관하게 항상 갱신

  // A32e: VOO·QQQ·SCHD MDD 비교 — 벤치마크 가격을 fetch해야 해서(비동기) 패널 템플릿과
  // 별도로 채운다(다른 MDD 섹션들처럼 동기 계산이 안 됨).
  const benchMddWrap = document.getElementById("myBenchMddWrap");
  if (benchMddWrap) {
    computeBenchmarkMDDCompare(perRow).then((cmp) => { benchMddWrap.innerHTML = buildBenchmarkMDDHTML(cmp); })
      .catch((err) => { benchMddWrap.innerHTML = `<p class="compare-empty" style="color:var(--critical)">벤치마크 MDD 계산 실패: ${err.message}</p>`; });
  }

  // A25b: 월별 비중 변화 — 그룹 기준 전환(계좌별/카테고리별), 선택은 state에 보존.
  // A26c: 같은 표가 비중분석 탭과 추이 탭 두 곳에 붙는다. state.myWeightHistGroup 하나를
  // 공유해 한쪽에서 바꾸면 다른 쪽 select 값과 본문도 같이 따라오게 한다(선택 어긋남 방지).
  const weightHistPairs = [["myWeightHistGroup", "myWeightHistBody"], ["myTrendWeightGroup", "myTrendWeightHistBody"]];
  const renderWeightHists = () => {
    const groupBy = state.myWeightHistGroup || "account";
    for (const [selId, bodyId] of weightHistPairs) {
      const sel = document.getElementById(selId), body = document.getElementById(bodyId);
      if (sel) sel.value = groupBy;
      if (body) body.innerHTML = buildWeightHistoryHTML(history, groupBy);
    }
  };
  for (const [selId] of weightHistPairs) {
    const sel = document.getElementById(selId);
    if (sel) sel.addEventListener("change", () => { state.myWeightHistGroup = sel.value; renderWeightHists(); });
  }
  renderWeightHists();

  const changelogSel = document.getElementById("myChangelogGranularity");
  const renderChangelog = () => {
    const body = document.getElementById("myChangelogBody");
    if (!body) return;
    body.innerHTML = buildChangelogHTML(changelogSel.value);
  };
  if (state.myChangelogGranularity) changelogSel.value = state.myChangelogGranularity;
  changelogSel.addEventListener("change", () => { state.myChangelogGranularity = changelogSel.value; renderChangelog(); });
  /* A37: 최근 변동 1건을 리포트로 뽑아 목적지별로 내보낸다. 목적지 규칙은 종합 탭
     "리포트 생성"과 동일 — 옵시디안만 계좌명 원문(폐쇄 저장소), 나머지는 마스킹. */
  const changelogReportBtn = document.getElementById("myChangelogReportBtn");
  if (changelogReportBtn) changelogReportBtn.addEventListener("click", async () => {
    const log = loadAssetChangelog();
    if (!log.length) { flashStatus("myChangelogStatus", "기록된 변동이 없습니다"); return; }
    const entry = log[0];
    const masked = buildChangeReportText(entry, { mask: true });
    const results = [];
    const ok = await copyTextToClipboard(masked);
    results.push(ok ? "클립보드 복사됨(계좌명 마스킹)" : "클립보드 실패");
    if (typeof window.exportReportNote === "function") {
      // 볼트는 기기 안 폐쇄 저장소라 원문으로 남긴다(A34와 같은 근거).
      const raw = buildChangeReportText(entry, { mask: false });
      const done = await window.exportReportNote(raw);
      results.push(done ? "옵시디안 저장됨(원문)" : "옵시디안 저장 실패");
    }
    if (telegramBotToken() && telegramChatId()) {
      const tg = masked.length > 4000 ? masked.slice(0, 3900) + "\n…(길이 제한으로 생략)" : masked;
      const r = await sendTelegramMessage(tg);
      results.push(r.ok ? "텔레그램 전송됨" : `텔레그램 실패: ${r.error}`);
    }
    flashStatus("myChangelogStatus", results.join(" · "));
  });
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

  // A21: 트리맵 셀 탭하면 확대 — 좁은 셀은 이름이 겹쳐 보이므로 전체 정보를 오버레이로 표시
  const tmBody = document.getElementById("myTreemapBody");
  if (tmBody && !tmBody.dataset.zoomWired) {
    tmBody.dataset.zoomWired = "1";
    tmBody.addEventListener("click", (evt) => {
      const cell = evt.target.closest(".tm-cell");
      if (!cell) return;
      showTmZoom(cell.dataset.tmName, cell.dataset.tmValue, cell.dataset.tmPct, cell.dataset.tmChg, cell.className);
    });
  }

  // A10: 📡 시그널 탭 — 워치리스트·지표·σ 매수가
  setupSignalTab(perRow, liveKr);

  // A16b: 🧺 포트폴리오검토 — 스타일 비중·모델 대조·운용 목표
  setupReviewTab(perRow, totalMonthlyInvest, goalRate);
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

/* A14: 결정 메모(승인/보류/거부) — 최대 200건, export/import로 재설치 후에도 복원 */
function loadDecisions() {
  try {
    const v = JSON.parse(localStorage.getItem(MY_SIGNAL_DECISIONS_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function saveDecisions(list) {
  localStorage.setItem(MY_SIGNAL_DECISIONS_KEY, JSON.stringify(list.slice(0, 200)));
}
function buildDecisionsListHTML() {
  const list = loadDecisions().slice(0, 8);
  if (!list.length) return `<p class="compare-empty">아직 기록된 결정이 없습니다.</p>`;
  const icon = { approved: "✅ 승인", hold: "⏸ 보류", rejected: "❌ 거부" };
  return `<div style="overflow-x:auto;"><table class="account-summary-table">
    <thead><tr><th>일시</th><th>종목</th><th>결정</th><th>등급</th><th>진입/목표/손절</th></tr></thead>
    <tbody>${list.map((d) => `<tr><td>${d.ts}</td><td>${d.name}</td><td>${icon[d.decision] || d.decision}</td><td>${d.grade}</td><td>${d.entry}/${d.target}/${d.stop}</td></tr>`).join("")}</tbody>
    </table></div>`;
}

/* A13: AI 셋업 리뷰 요청 문구 — API 호출 없이 클립보드 복사 후 AI 세션에 붙여넣는 방식(기존 SOP 요약 패턴과 동일 원칙) */
function buildSignalReviewText(sym, name, cur, currency, core) {
  const { grade, votes, arrText, crossMsgs } = core;
  const lines = [`[📡 시그널 셋업 리뷰 요청 — ${name}(${sym}), ${todayStr()}]`];
  lines.push(`현재가: ${fmtPrice(cur, currency)} · 종합등급: ${grade}`);
  lines.push(`지표: ${votes.map((v) => `${v.name} ${v.text}`).join(" · ")}`);
  lines.push(`MA 배열: ${arrText}${crossMsgs.length ? " · " + crossMsgs.join(" · ") : ""}`);
  lines.push("");
  lines.push("위 시그널 셋업에 대해 다음 3가지를 검토 의견으로 답해줘(투자 조언이 아니라 참고용 검토):");
  lines.push("1) 강세 시나리오(Bull Case) — 이 판단을 뒷받침하는 근거");
  lines.push("2) 약세 시나리오(Bear Case) — 반대로 틀릴 수 있는 리스크·하방 요인");
  lines.push("3) 핵심 미지수(Key Unknown) — 결과를 좌우할 수 있는 불확실한 요인");
  return lines.join("\n");
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

/* A16b: 🧺 포트폴리오검토 — 스타일 비중 vs 목표(기본 배당70/성장30), 평온 모델 대조, 운용 목표 진행률 */
const PYEONGON_MODEL = [
  { group: "미국 성장", syms: ["AAPL", "MSFT", "TSLA", "GOOGL", "AMZN", "TSM", "SCHG", "BMNR", "HOOD"] },
  { group: "미국 배당", syms: ["SCHD", "DIVO", "JEPQ", "GPIQ", "O", "IRM"] },
  { group: "국내 배당", syms: ["498400.KS", "498410.KS", "441640.KS", "0144L0.KS", "486290.KS", "0177R0.KS"] },
  { group: "일본 배당", syms: ["1489"] },
  { group: "채권", syms: ["481060.KS", "0000D0.KS"] },
];

function setupReviewTab(perRow, totalMonthlyInvest, goalRate) {
  const styleBody = document.getElementById("myReviewStyleBody");
  if (!styleBody) return;
  const divTargetInput = document.getElementById("myReviewDivTarget");
  const modelBody = document.getElementById("myReviewModelBody");
  const goalInput = document.getElementById("myReviewGoal");
  const goalBody = document.getElementById("myReviewGoalBody");
  const totalValue = perRow.reduce((a, p) => a + (p.value || 0), 0);
  const heldSyms = new Set(perRow.filter((p) => p.value > 0).map((p) => p.symbol));

  const renderStyle = () => {
    const target = Math.min(100, Math.max(0, Number(divTargetInput.value) || 70));
    state.myReviewDivTarget = target;
    if (!(totalValue > 0)) { styleBody.innerHTML = `<p class="compare-empty">보유 자산이 없습니다 — 보유 입력 후 확인하세요.</p>`; return; }
    const sums = { div: 0, gro: 0, etc: 0 };
    for (const p of perRow) {
      const st = p.meta && p.meta.style;
      if (st === "배당") sums.div += p.value || 0;
      else if (st === "성장") sums.gro += p.value || 0;
      else sums.etc += p.value || 0;
    }
    const divPct = (sums.div / totalValue) * 100;
    const groPct = (sums.gro / totalValue) * 100;
    const etcPct = (sums.etc / totalValue) * 100;
    const gapDiv = target - divPct; // +면 배당 부족(성장→배당 이동 필요)
    const moveAmt = (Math.abs(gapDiv) / 100) * totalValue;
    styleBody.innerHTML = `
      <div class="stats" style="margin-top:8px;">
        <div class="stat"><p class="stat-label">배당 비중</p><p class="stat-value">${divPct.toFixed(1)}%</p><p class="stat-sub">목표 ${target}%</p></div>
        <div class="stat"><p class="stat-label">성장 비중</p><p class="stat-value">${groPct.toFixed(1)}%</p><p class="stat-sub">목표 ${100 - target}%</p></div>
        <div class="stat"><p class="stat-label">기타(안전·개별주)</p><p class="stat-value">${etcPct.toFixed(1)}%</p></div>
        <div class="stat"><p class="stat-label">리밸런싱 필요액</p><p class="stat-value" style="font-size:16px;">${fmtManwon(moveAmt)}</p><p class="stat-sub">${gapDiv >= 0 ? "성장·기타 → 배당" : "배당 → 성장"} 이동 시 목표 근접</p></div>
      </div>
      <p class="stat-sub">스타일 분류는 수집 목록(manifest)의 성장/배당/안전 필드 기준입니다. 개별주·안전(채권 등) 자산은 "기타"로 집계됩니다.</p>`;
  };

  const renderModel = () => {
    const rows = PYEONGON_MODEL.map((g) => g.syms.map((s) => {
      const known = state.metaBySymbol.has(s);
      const held = heldSyms.has(s);
      const nm = known ? symbolDisplayName(s) : s;
      const badge = held ? `<span class="sig-badge sig-watch">보유중</span>`
        : known ? `<span class="sig-badge sig-neutral">미보유</span>`
        : `<span class="sig-badge sig-alert">데이터 미수집</span>`;
      return `<tr><td>${g.group}</td><td>${nm}</td><td>${badge}</td></tr>`;
    }).join("")).join("");
    modelBody.innerHTML = `<div style="overflow-x:auto;"><table class="account-summary-table">
      <thead><tr><th>그룹</th><th>종목</th><th>상태</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="stat-sub">"평온 배당70/성장30" 참조 모델 — "데이터 미수집" 종목은 수집 파이프라인 반영 후 자동으로 이름·시그널이 연결됩니다. 모델은 구성 참고용이며 매수 권유가 아닙니다.</p>`;
  };

  const renderGoal = () => {
    const goal = Number(goalInput.value) || 4000000000;
    state.myReviewGoal = goal;
    const pct = totalValue > 0 ? (totalValue / goal) * 100 : 0;
    const r = monthsToGoal(goal, totalValue, totalMonthlyInvest || 0, goalRate || 0.07);
    // 배당70 구성 시 예상 월배당 — 현재 배당 스타일 보유의 가중평균 TTM 수익률 적용(추정)
    let wSum = 0, ySum = 0;
    for (const p of perRow) {
      if (p.meta && p.meta.style === "배당" && p.meta.dividendYield > 0 && p.value > 0) {
        wSum += p.value; ySum += p.value * p.meta.dividendYield;
      }
    }
    const avgYield = wSum > 0 ? ySum / wSum : 0;
    const divMonthly = (goal * 0.7 * avgYield) / 12;
    goalBody.innerHTML = `
      <div class="stats" style="margin-top:8px;">
        <div class="stat"><p class="stat-label">진행률</p><p class="stat-value">${pct.toFixed(1)}%</p><p class="stat-sub">${fmtManwon(totalValue)} / ${fmtManwon(goal)}</p></div>
        <div class="stat"><p class="stat-label">도달 예상</p><p class="stat-value" style="font-size:16px;">${r && r.months != null ? `${Math.floor(r.months / 12)}년 ${r.months % 12}개월` : "600개월 내 미도달"}</p><p class="stat-sub">연 ${(100 * (goalRate || 0.07)).toFixed(1)}% 가정 · 월 ${fmtManwon(totalMonthlyInvest || 0)} 적립 반영</p></div>
        <div class="stat"><p class="stat-label">목표 달성+배당70 구성 시 월배당</p><p class="stat-value" style="font-size:16px;">${avgYield > 0 ? fmtManwon(divMonthly) : "―"}</p><p class="stat-sub">${avgYield > 0 ? `배당 보유 가중 TTM 수익률 ${(avgYield * 100).toFixed(2)}% 적용 — 추정치(확정 배당 아님)` : "배당 스타일 보유가 없어 추정 불가"}</p></div>
      </div>`;
  };

  if (state.myReviewDivTarget != null) divTargetInput.value = state.myReviewDivTarget;
  if (state.myReviewGoal != null) goalInput.value = state.myReviewGoal;
  divTargetInput.addEventListener("change", renderStyle);
  goalInput.addEventListener("change", renderGoal);
  renderStyle();
  renderModel();
  renderGoal();
}

/* A13: 종목 하나의 종합 시그널 등급 계산 — renderDetail·전종목 스캔 표·트레이드 플랜이 공유하는
   순수 계산부(HTML 없음). closes/dates=일별 종가·날짜, cur=판정에 쓸 현재가(라이브가 또는 마지막 종가). */
function computeSignalGrade(closes, dates, cur) {
  const maDefs = [5, 20, 60, 120, 200];
  const mas = maDefs.map((n) => ({ n, v: smaAt(closes, n) }));

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

  return { mas, arrText, crossMsgs, rsi, rsiArr, m, sg, h, bb, pos, zone, votes, divVote, ma200, buyN, sellN, grade, gradeCls };
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
  const scanGroupSel = document.getElementById("mySignalScanGroup");
  const scanBtn = document.getElementById("mySignalScanBtn");
  const scanBody = document.getElementById("mySignalScanBody");

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

  // A14 리스크 게이트에서 쓸 총 평가액(KRW) — perRow.value가 이미 원화 환산 평가액
  const totalValue = perRow.reduce((a, p) => a + (p.value || 0), 0);

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

      const core = computeSignalGrade(closes, dates, cur);
      const { mas, arrText, crossMsgs, rsi, rsiArr, m, sg, h, bb, pos, zone, votes, divVote, ma200, buyN, sellN, grade, gradeCls } = core;
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
      const macdVote = votes.find((v) => v.name === "MACD");
      const macdLine = h == null ? "MACD 데이터 부족"
        : `MACD 히스토그램 ${h >= 0 ? "+" : ""}${h.toFixed(2)} — ${
            macdVote && macdVote.v === 1 ? "상향 전환(단기 반등 신호)"
            : macdVote && macdVote.v === -1 ? "하향 전환(단기 조정 신호)"
            : h >= 0 ? "상승 모멘텀 지속(시그널선 위)" : "하락 모멘텀 지속(시그널선 아래)"
          }`;
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

      // A13: 지지·저항 레벨 — 최근 180거래일 피벗(findPivots, A12과 동일 원칙) 중 최근 3개씩 + 52주 최고가
      const pivotWindow = Math.min(closes.length, 180);
      const pivotStart = closes.length - pivotWindow;
      const pivots = findPivots(closes.slice(pivotStart), 3);
      const supportLevels = pivots.lows.map((i) => pivotStart + i).map((idx) => ({ date: dates[idx], price: closes[idx] })).slice(-3).reverse();
      const resistLevels = pivots.highs.map((i) => pivotStart + i).map((idx) => ({ date: dates[idx], price: closes[idx] })).slice(-3).reverse();
      const hi52 = high52(closes);
      const supportHTML = supportLevels.length
        ? supportLevels.map((s) => `${fmtPrice(s.price, full.currency)}(${s.date})`).join(" · ")
        : "감지된 지지 피벗 없음(최근 180거래일)";
      const resistHTML = resistLevels.length
        ? resistLevels.map((r) => `${fmtPrice(r.price, full.currency)}(${r.date})`).join(" · ")
        : "감지된 저항 피벗 없음(최근 180거래일)";

      // A14: 트레이드 플랜 초안 — 진입(σ매수가 구간)·목표(저항/52주 전고점)·손절(지지/σ)·무효화(MA200)
      const planSigma = dailyReturnSigma(closes, Number(sigmaWinSel.value));
      const entryLow = planSigma != null ? cur * (1 - planSigma / 100) : cur;
      const nearestResistAbove = resistLevels.map((r) => r.price).filter((p) => p > cur).sort((a, b) => a - b)[0];
      const targetPrice = nearestResistAbove || (hi52 && hi52 > cur ? hi52 : cur * 1.10);
      const nearestSupportBelow = supportLevels.map((s) => s.price).filter((p) => p < cur).sort((a, b) => b - a)[0];
      const stopFallback = planSigma != null ? cur * (1 - 2 * planSigma / 100) : cur * 0.9;
      const stopPrice = nearestSupportBelow || stopFallback;

      // A14: 리스크 게이트 — 총자산은 원화(KRW)이므로 미국 종목은 환율 환산 후 수량 산정
      let fxRate = null;
      if (full.currency === "USD") {
        try {
          const fx = await loadFx();
          if (fx && fx.rates && fx.rates.length) fxRate = fx.rates[fx.rates.length - 1];
        } catch (e) { /* 환율 조회 실패 시 원화 환산 리스크 계산 생략 */ }
      }
      const toKRW = (v) => full.currency === "USD" ? (fxRate ? v * fxRate : null) : v;
      const riskPct = state.mySignalRiskPct != null ? state.mySignalRiskPct : 1;
      const stopDistanceNative = cur - stopPrice;
      const stopDistanceKRW = toKRW(stopDistanceNative);
      const riskAmount = totalValue * (riskPct / 100);
      const sizedShares = (stopDistanceKRW && stopDistanceKRW > 0) ? Math.floor(riskAmount / stopDistanceKRW) : 0;
      const positionValueKRW = toKRW(sizedShares * cur);
      const positionPct = (totalValue > 0 && positionValueKRW != null) ? (positionValueKRW / totalValue) * 100 : 0;
      const concentrationWarn = positionPct > 20;
      const fxUnavailable = full.currency === "USD" && fxRate == null;

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
        <p class="chart-title" style="margin-top:20px;">📍 지지·저항 레벨 — 최근 180거래일</p>
        <p class="stat-sub">지지(하단): ${supportHTML}</p>
        <p class="stat-sub">저항(상단): ${resistHTML}</p>
        <p class="stat-sub">52주 최고가: ${hi52 == null ? "―" : fmtPrice(hi52, full.currency)}</p>

        <div class="action-row" style="margin:12px 0 4px;">
          <button type="button" id="mySignalAiReviewBtn" class="btn-action">🤖 AI 셋업 리뷰 복사</button>
          <button type="button" id="mySignalApiReviewBtn" class="btn-action" style="display:none;">⚡ API로 즉시 리뷰 받기</button>
        </div>
        <div id="mySignalApiReviewResult"></div>

        <div class="apple-panel">
          <p class="apple-panel-title">🎯 트레이드 플랜 (초안)</p>
          <p class="apple-panel-note">아래 값은 지표로 자동 계산한 초안입니다 — 실제 매매는 직접 검토 후 결정하세요(투자 조언 아님).</p>
          <div class="apple-tile-grid">
            <div class="apple-tile accent-blue"><p class="apple-tile-label">진입 구간</p><p class="apple-tile-value">${fmtPrice(entryLow, full.currency)} ~ ${fmtPrice(cur, full.currency)}</p></div>
            <div class="apple-tile accent-good"><p class="apple-tile-label">목표가</p><p class="apple-tile-value">${fmtPrice(targetPrice, full.currency)}</p></div>
            <div class="apple-tile accent-critical"><p class="apple-tile-label">손절선</p><p class="apple-tile-value">${fmtPrice(stopPrice, full.currency)}</p></div>
            <div class="apple-tile"><p class="apple-tile-label">무효화(MA200)</p><p class="apple-tile-value">${ma200 == null ? "―" : fmtPrice(ma200, full.currency)}</p></div>
          </div>
        </div>

        <div class="apple-panel">
          <p class="apple-panel-title">⚖️ 리스크 게이트</p>
          <div class="controls" style="margin:0 0 10px;">
            <label style="font-size:12.5px; display:inline-flex; align-items:center; gap:4px;">1회 리스크 <input type="number" id="mySignalRiskPct" min="0.1" max="10" step="0.1" value="${riskPct}" style="width:60px;">%</label>
          </div>
          ${fxUnavailable
            ? `<p class="apple-panel-note" style="color:var(--critical);">환율 정보를 불러오지 못해 원화 환산 리스크 계산을 생략했습니다.</p>`
            : `<p class="apple-panel-note">총자산 ${fmtManwon(totalValue)} 기준 · 손절 거리 ${fmtPrice(stopDistanceNative, full.currency)} · 리스크 금액 ${fmtManwon(riskAmount)}</p>
          <div class="apple-tile-grid">
            <div class="apple-tile accent-blue"><p class="apple-tile-label">권장 수량</p><p class="apple-tile-value">${sizedShares.toLocaleString()}주</p></div>
            <div class="apple-tile accent-blue"><p class="apple-tile-label">포지션 금액</p><p class="apple-tile-value">${fmtManwon(positionValueKRW || 0)}</p></div>
            <div class="apple-tile ${concentrationWarn ? "accent-warn" : ""}"><p class="apple-tile-label">총자산 대비</p><p class="apple-tile-value">${positionPct.toFixed(1)}%</p></div>
            <div class="apple-tile ${concentrationWarn ? "accent-warn" : "accent-good"}"><p class="apple-tile-label">판정</p><p class="apple-tile-value" style="font-size:14px;">${concentrationWarn ? '<span class="apple-pill warn">⚠️ 집중 경고</span>' : '<span class="apple-pill good">✅ Continue</span>'}</p></div>
          </div>
          ${concentrationWarn ? `<p class="apple-panel-note" style="color:var(--critical); margin-top:10px;">⚠️ 이 포지션이 총자산의 ${positionPct.toFixed(0)}%를 차지합니다(기준 20%) — 비중을 줄이거나 리스크%를 낮추는 것을 검토하세요.</p>` : ""}`
          }
        </div>

        <div class="apple-panel">
          <p class="apple-panel-title">📝 결정 메모</p>
          <div class="apple-segmented">
            <button type="button" class="sig-decide-btn seg-approve" data-decision="approved">✅ 승인</button>
            <button type="button" class="sig-decide-btn seg-hold" data-decision="hold">⏸ 보류</button>
            <button type="button" class="sig-decide-btn seg-reject" data-decision="rejected">❌ 거부</button>
          </div>
          <p class="action-status" id="mySignalDecideStatus" style="margin:6px 0 2px;"></p>
          <div id="mySignalDecisionsBody">${buildDecisionsListHTML()}</div>
        </div>

        <div id="mySignalChart"></div>
        <p class="chart-title" style="margin-top:20px;">📉 연간 MDD 분포 — ${name}</p>
        ${annHTML}`;

      const aiReviewBtn = document.getElementById("mySignalAiReviewBtn");
      if (aiReviewBtn) aiReviewBtn.addEventListener("click", async () => {
        const text = buildSignalReviewText(sym, name, cur, full.currency, core);
        try {
          await navigator.clipboard.writeText(text);
          flashStatus("mySignalDecideStatus", "AI 리뷰 요청 문구 복사됨 — AI 세션에 붙여넣으세요");
        } catch (err) {
          window.prompt("아래 내용을 복사하세요:", text);
        }
      });

      // A15: 인앱 AI 리뷰(API 직접 호출) — capture-parse.js가 로드되고(앱/APK) 저장된 키가
      // 있을 때만 노출(사이트에는 API 키 인프라가 없어 항상 숨김). 클릭 시에만 비용 발생.
      const apiReviewBtn = document.getElementById("mySignalApiReviewBtn");
      const apiReviewResult = document.getElementById("mySignalApiReviewResult");
      if (apiReviewBtn && apiReviewResult) {
        // A20: Claude API 비활성화 플래그(capture-parse.js) — 미로드 환경(사이트)에서는 안전하게 비활성 취급
        const claudeApiDisabled = typeof CAPTURE_CLAUDE_API_DISABLED !== "undefined" ? CAPTURE_CLAUDE_API_DISABLED : true;
        const claudeKey = claudeApiDisabled ? null : localStorage.getItem("capture_claude_key");
        const geminiKey = localStorage.getItem("capture_gemini_key");
        if (typeof callGeminiVision === "function" && (claudeKey || geminiKey)) {
          apiReviewBtn.style.display = "";
          apiReviewBtn.addEventListener("click", async () => {
            apiReviewBtn.disabled = true;
            const prevLabel = apiReviewBtn.textContent;
            apiReviewBtn.textContent = "요청 중…";
            apiReviewResult.innerHTML = `<p class="compare-empty">AI 응답을 기다리는 중…</p>`;
            try {
              const prompt = buildSignalReviewText(sym, name, cur, full.currency, core) +
                "\n\n한국어로 위 3개 항목(강세 시나리오/약세 시나리오/핵심 미지수)을 각각 2~3문장으로 답해줘.";
              const provider = geminiKey ? "gemini" : claudeKey ? "claude" : "gemini";
              const text = provider === "claude"
                ? await callClaudeVision([], prompt, claudeKey)
                : await callGeminiVision([], prompt, geminiKey);
              apiReviewResult.innerHTML = `<div class="sig-summary"><p class="sig-summary-line" style="white-space:pre-wrap;">${text.replace(/</g, "&lt;")}</p></div>
                <p class="stat-sub">${provider === "claude" ? "Claude" : "Gemini"} API 응답 · 참고용, 투자 조언 아님</p>`;
            } catch (err) {
              apiReviewResult.innerHTML = `<p class="compare-empty" style="color:var(--critical)">API 요청 실패: ${err.message}</p>`;
            } finally {
              apiReviewBtn.disabled = false;
              apiReviewBtn.textContent = prevLabel;
            }
          });
        }
      }

      const riskInput = document.getElementById("mySignalRiskPct");
      if (riskInput) riskInput.addEventListener("change", () => {
        const v = Number(riskInput.value);
        state.mySignalRiskPct = v > 0 ? v : 1;
        renderDetail();
      });

      document.querySelectorAll(".sig-decide-btn").forEach((btn) => btn.addEventListener("click", () => {
        const decision = btn.dataset.decision;
        const list = loadDecisions();
        list.unshift({
          ts: nowDateTimeStr(), symbol: sym, name, decision, grade,
          entry: Math.round(cur), target: Math.round(targetPrice), stop: Math.round(stopPrice),
        });
        saveDecisions(list);
        const body = document.getElementById("mySignalDecisionsBody");
        if (body) body.innerHTML = buildDecisionsListHTML();
        const label = decision === "approved" ? "승인" : decision === "hold" ? "보류" : "거부";
        flashStatus("mySignalDecideStatus", `${label} 기록됨`);
      }));

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

  // ⓪ A13: 전 종목 스캔 — 그룹 선택 후 버튼으로만 실행(다수 종목 로딩 고려, 자동 실행 없음)
  const GRADE_ORDER = { "🟢 강매수": 0, "🟢 매수관심": 1, "⏸ 홀드": 2, "🔴 매도검토": 3, "🔴 강매도": 4 };
  const runScan = async () => {
    const group = scanGroupSel.value;
    state.mySignalScanGroup = group;
    let syms;
    if (group === "mine") {
      syms = [...new Set([...perRow.filter((p) => p.value > 0).map((p) => p.symbol), ...loadWatchlist()])];
    } else if (group === "kr") {
      syms = state.listedEtfs.filter((e) => e.market === "kr").map((e) => e.symbol);
    } else if (group === "us") {
      syms = state.listedEtfs.filter((e) => e.market === "us").map((e) => e.symbol);
    } else {
      syms = state.listedEtfs.map((e) => e.symbol);
    }
    scanBtn.disabled = true;
    scanBtn.textContent = "스캔 중…";
    scanBody.innerHTML = `<p class="compare-empty">스캔 중… (${syms.length}종목, 다소 시간이 걸릴 수 있습니다)</p>`;
    const results = [];
    for (const sym of syms) {
      try {
        const full = await loadSymbol(sym);
        const cur = curPriceOf(sym, full);
        const c = computeSignalGrade(full.closes, full.dates, cur);
        results.push({ sym, cur, currency: full.currency, ...c });
      } catch (err) { /* 개별 종목 오류는 건너뛰고 전체 스캔은 계속 진행 */ }
    }
    scanBtn.disabled = false;
    scanBtn.textContent = "🔍 스캔 실행";
    if (!results.length) {
      scanBody.innerHTML = `<p class="compare-empty">스캔 결과가 없습니다.</p>`;
      return;
    }
    results.sort((a, b) => (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9));
    const rows = results.map((r) => `<tr>
      <td>${symbolDisplayName(r.sym)}</td>
      <td style="text-align:right;">${fmtPrice(r.cur, r.currency)}</td>
      <td><span class="sig-badge ${r.gradeCls}">${r.grade}</span></td>
      <td style="text-align:right;">${r.pos == null ? "―" : Math.round(r.pos * 100) + "%"}</td>
      <td>${r.crossMsgs.length ? r.crossMsgs[r.crossMsgs.length - 1] : ""}</td>
    </tr>`).join("");
    scanBody.innerHTML = `<div style="overflow-x:auto;"><table class="account-summary-table">
      <thead><tr><th>종목</th><th>현재가</th><th>등급</th><th>20일 포지션</th><th>최근 크로스</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
      <p class="stat-sub">${results.length}종목 스캔 완료 · 등급순 정렬(강매수→강매도) · 참고용, 투자 조언 아님</p>`;
  };
  if (state.mySignalScanGroup) scanGroupSel.value = state.mySignalScanGroup;
  scanBtn.addEventListener("click", runScan);

  // A17: 🌡️ 변동성 체제 — VIX(지수 옵션) vs VIXEQ(개별종목 옵션 평균, Cboe) 4분면 판독.
  // Cboe 데이터 미수집 시 실현변동성 근사(주 1회 수집 종가)로 폴백 — 근사임을 명시.
  const volBody = document.getElementById("mySignalVolBody");
  const renderVolRegime = async () => {
    if (!volBody) return;
    const loadVol = async (volSym) => {
      const key = `vol:${volSym}`;
      if (state.cache.has(key)) return state.cache.get(key);
      const d = await fetchJSON(`${DATA_DIR}/vol/${volSym}.json`);
      state.cache.set(key, d);
      return d;
    };
    const tryLoadVol = async (volSym) => { try { return await loadVol(volSym); } catch (e) { return null; } };
    const vixD = await tryLoadVol("VIX");
    const vixeqD = await tryLoadVol("VIXEQ");
    // VIXEQ는 Cboe 공개 CSV 미제공 확인(2026-07-17) — VIX 실제값 + 개별종목 실현변동성 근사를
    // 대용으로 쓰는 하이브리드 경로가 사실상 기본 경로다(대용임을 화면에 명시).
    if (vixD && !vixeqD) {
      try {
        const median = (arr) => { const s2 = arr.slice().sort((a, b) => a - b); const n = s2.length; return n % 2 ? s2[(n - 1) / 2] : (s2[n / 2 - 1] + s2[n / 2]) / 2; };
        const win = vixD.closes.slice(-252);
        const vMed = median(win);
        const vLast = vixD.closes[vixD.closes.length - 1];
        const vUp = vLast > vMed;
        const rv = (closes) => { const s3 = dailyReturnSigma(closes, 20); return s3 != null ? s3 * Math.sqrt(252) : null; };
        const spy = await loadSymbol("SPY");
        const spyRv = rv(spy.closes);
        const proxySyms = [...new Set([...loadWatchlist(), ...perRow.filter((p) => p.value > 0).map((p) => p.symbol)])].slice(0, 8);
        const rvs = [];
        for (const ps of proxySyms) { try { const f = await loadSymbol(ps); const r0 = rv(f.closes); if (r0 != null) rvs.push(r0); } catch (e2) { /* skip */ } }
        const avgRv = rvs.length ? rvs.reduce((a, b) => a + b, 0) / rvs.length : null;
        const eqHigh = spyRv != null && avgRv != null && avgRv > spyRv * 1.8;
        const regime = vUp && eqHigh ? { label: "🔴 거시 리스크", cls: "sig-alert", desc: "시장 전체가 위험 — 지수·개별종목 변동성 동반 상승" }
          : !vUp && !eqHigh ? { label: "🟢 평온 강세장", cls: "sig-watch", desc: "전반적으로 평온한 강세장" }
          : !vUp && eqHigh ? { label: "🟠 차별화 장세", cls: "sig-neutral", desc: "지수는 조용한데 개별 종목 변동성이 큼 — 종목 간 수익률 편차 극심(멘탈 주의)" }
          : { label: "🟡 지수 일시 충격", cls: "sig-neutral", desc: "드문 경우 — 지수 중심의 일시적 충격 가능성" };
        const startV = Math.max(0, vixD.dates.length - 252);
        volBody.innerHTML = `
          <div class="action-row" style="margin:6px 0;">
            <span class="sig-badge sig-neutral">VIX ${vLast.toFixed(2)} (1년 중앙값 ${vMed.toFixed(1)} ${vUp ? "↑" : "↓"})</span>
            <span class="sig-badge sig-neutral">개별종목 변동성(근사) ${avgRv != null ? avgRv.toFixed(1) + "%" : "―"} vs SPY ${spyRv != null ? spyRv.toFixed(1) + "%" : "―"}</span>
            <span class="sig-badge ${regime.cls}" style="font-size:13px;">${regime.label}</span>
          </div>
          <p class="stat-sub">${regime.desc}. VIX는 Cboe 실제값, 개별종목 쪽은 <b>VIXEQ 대용 실현변동성 근사</b>(워치리스트·보유 ${rvs.length}종목 20일 연율화 평균 — Cboe가 VIXEQ 일별 CSV를 제공하지 않아 근사 사용, 옵션 내재변동성 아님)입니다.</p>
          <div id="mySignalVolChart"></div>
          <p class="stat-sub">해석표 — VIX↑·개별↑ 거시 리스크 / VIX↓·개별↓ 평온 강세장 / VIX↓·개별↑ 차별화 장세 / VIX↑·개별↓ 지수 일시 충격</p>`;
        const volChartEl0 = document.getElementById("mySignalVolChart");
        if (volChartEl0) buildCompareChart(volChartEl0, [{ label: "VIX", color: "#2a78d6", dates: vixD.dates.slice(startV), values: vixD.closes.slice(startV) }],
          { anchorZero: false, fmtAxis: (x) => x.toFixed(0), fmtTip: (x) => x.toFixed(2) });
        return;
      } catch (eHybrid) { /* 아래 일반 경로/폴백으로 진행 */ }
    }
    try {
      if (!vixD || !vixeqD) throw new Error("변동성 지수 데이터 없음");
      const vix = vixD, vixeq = vixeqD;
      const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
      const judge = (d) => {
        const win = d.closes.slice(-252);
        const med = median(win);
        const last = d.closes[d.closes.length - 1];
        return { last, med, up: last > med };
      };
      const v = judge(vix), q = judge(vixeq);
      const regime = v.up && q.up ? { label: "🔴 거시 리스크", desc: "시장 전체가 위험 — 지수·개별종목 변동성 동반 상승" }
        : !v.up && !q.up ? { label: "🟢 평온 강세장", desc: "전반적으로 평온한 강세장" }
        : !v.up && q.up ? { label: "🟠 차별화 장세", desc: "지수는 조용한데 개별 종목 변동성이 큼 — 종목 간 수익률 편차 극심(멘탈 주의)" }
        : { label: "🟡 지수 일시 충격", desc: "드문 경우 — 지수 중심의 일시적 충격 가능성" };
      const sliceVol = (d, color, label) => { const n = d.dates.length; const s = Math.max(0, n - 252); return { label, color, dates: d.dates.slice(s), values: d.closes.slice(s) }; };
      volBody.innerHTML = `
        <div class="action-row" style="margin:6px 0;">
          <span class="sig-badge sig-neutral">VIX ${v.last.toFixed(2)} (1년 중앙값 ${v.med.toFixed(1)} ${v.up ? "↑" : "↓"})</span>
          <span class="sig-badge sig-neutral">VIXEQ ${q.last.toFixed(2)} (1년 중앙값 ${q.med.toFixed(1)} ${q.up ? "↑" : "↓"})</span>
          <span class="sig-badge ${v.up && q.up ? "sig-alert" : !v.up && !q.up ? "sig-watch" : "sig-neutral"}" style="font-size:13px;">${regime.label}</span>
        </div>
        <p class="stat-sub">${regime.desc}. VIX = S&amp;P500 지수 옵션 변동성, VIXEQ = 개별 종목 옵션 평균 변동성(Cboe Constituent Volatility). ↑/↓는 각 지수의 최근 1년 중앙값 대비입니다.</p>
        <div id="mySignalVolChart"></div>
        <p class="stat-sub">해석표 — VIX↑·VIXEQ↑ 거시 리스크 / VIX↓·VIXEQ↓ 평온 강세장 / VIX↓·VIXEQ↑ 차별화 장세 / VIX↑·VIXEQ↓ 지수 일시 충격</p>`;
      const volChartEl = document.getElementById("mySignalVolChart");
      if (volChartEl) buildCompareChart(volChartEl, [sliceVol(vix, "#2a78d6", "VIX"), sliceVol(vixeq, "#d64545", "VIXEQ")],
        { anchorZero: false, fmtAxis: (x) => x.toFixed(0), fmtTip: (x) => x.toFixed(2) });
    } catch (err) {
      try {
        const spy = await loadSymbol("SPY");
        const rv = (closes) => { const s = dailyReturnSigma(closes, 20); return s != null ? s * Math.sqrt(252) : null; };
        const spyRv = rv(spy.closes);
        const proxySyms = [...new Set([...loadWatchlist(), ...perRow.filter((p) => p.value > 0).map((p) => p.symbol)])].slice(0, 8);
        const rvs = [];
        for (const ps of proxySyms) { try { const f = await loadSymbol(ps); const r0 = rv(f.closes); if (r0 != null) rvs.push(r0); } catch (e2) { /* skip */ } }
        const avgRv = rvs.length ? rvs.reduce((a, b) => a + b, 0) / rvs.length : null;
        volBody.innerHTML = `<p class="stat-sub">Cboe VIX/VIXEQ 데이터가 아직 없어 <b>실현변동성 근사</b>로 표시합니다(주 1회 수집 종가 기준, 옵션 내재변동성 아님): SPY 20일 실현변동성(연율화) <b>${spyRv != null ? spyRv.toFixed(1) + "%" : "―"}</b> vs 워치리스트·보유 주요 ${rvs.length}종목 평균 <b>${avgRv != null ? avgRv.toFixed(1) + "%" : "―"}</b>${spyRv != null && avgRv != null ? ` — ${avgRv > spyRv * 1.8 ? "개별 종목 변동성이 지수 대비 큼(차별화 장세 성격)" : "지수·종목 변동성 격차 보통"}` : ""}</p>`;
      } catch (e3) {
        volBody.innerHTML = `<p class="compare-empty">변동성 지수 데이터를 불러오지 못했습니다.</p>`;
      }
    }
  };
  renderVolRegime();

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
/* A28: 가져오기(parseMyAssetsHoldingsCSV)와 열 순서를 맞춰야 하므로 한 배열로 관리한다.
   앞 6열(계좌·종목명·코드·성향·수량·매입단가)은 addMyAssetRow가 그대로 쓸 수 있는 값이라
   내보내기→가져오기 왕복이 가능하고, 뒤쪽(현재가~지급시기)은 그 시점 계산 결과라 참고용
   — 가져올 때는 DPS구분이 "확정"인 행만 확정DPS로 되살린다("추정(TTM)"은 매번 다시
   계산되는 값이라 그대로 되돌리면 안 됨). */
const HOLDINGS_SHEET_HEADER = ["계좌", "종목명", "코드", "성향", "수량", "매입단가", "현재가", "평가액(원)", "손익(원)", "DPS(주당)", "DPS구분", "월배당(원)", "지급시기"];

function buildMyAssetsSheets(d) {
  const w = (v) => Math.round(v);
  const sheets = {};

  const rowLines = [csvRow(HOLDINGS_SHEET_HEADER)];
  for (const p of d.perRow) {
    const ttm = p.meta && p.meta.ttmDividend ? p.meta.ttmDividend : 0;
    const dps = p.usedConfirmed ? p.confirmedDps : ttm / 12;
    rowLines.push(csvRow([
      p.account || "미지정", p.meta ? p.meta.name : p.symbol, p.symbol, (p.meta && p.meta.style) || "",
      p.qty, p.avgPrice > 0 ? (p.isUsd ? p.avgPrice + " USD" : w(p.avgPrice)) : "",
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

/* ---------- A28: 종목현황 CSV/TSV 가져오기 ----------
   구글시트·엑셀에서 편집한 표를 다시 보유종목으로 반영한다. 쉼표(CSV)·탭(TSV) 구분자를
   자동 인식하고, 값 안에 구분자가 있어도 따옴표로 감싸져 있으면 안전하게 분리한다
   (RFC4180 최소구현 — csvField가 만드는 형태와 정확히 맞물린다). */
function parseDelimitedTable(text, delim) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((f) => f !== "")) rows.push(row); }
  return rows;
}

/* "12345", "12.34 USD", "" 셋 다 다루는 숫자 파서 — USD 표기는 그대로 숫자만 뽑는다.
   avgPrice/close는 원래 통화 그대로 저장되는 필드라 " USD" 접미사는 버려도 된다. */
function parseNumericCell(v) {
  if (v == null) return null;
  const s = String(v).replace(/USD/i, "").trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/* CSV/TSV 텍스트 → addMyAssetRow가 바로 쓸 수 있는 row 객체 배열.
   반환: { rows, warnings } — 코드가 수집 목록에 없는 행은 건너뛰고 warnings에 이유를 남긴다
   (틀린 종목을 추측해서 채우지 않는다 — capture 파이프라인과 같은 원칙). */
function parseMyAssetsHoldingsCSV(text) {
  const delim = text.indexOf("\t") >= 0 && text.indexOf("\t") < (text.indexOf(",") === -1 ? Infinity : text.indexOf(",")) ? "\t" : ",";
  const table = parseDelimitedTable(text.trim(), delim);
  if (!table.length) return { rows: [], warnings: ["빈 파일입니다."] };
  const header = table[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iAcc = idx("계좌"), iName = idx("종목명"), iCode = idx("코드"), iQty = idx("수량"),
    iAvg = idx("매입단가"), iDps = idx("DPS(주당)"), iDpsType = idx("DPS구분"), iPeriod = idx("지급시기");
  if (iCode < 0 || iQty < 0) {
    return { rows: [], warnings: [`헤더에 "코드"·"수량" 열이 없습니다 — 앱에서 내려받은 종목현황 CSV/TSV인지 확인하세요.`] };
  }
  const rows = [], warnings = [];
  for (let i = 1; i < table.length; i++) {
    const line = table[i];
    const symbol = (line[iCode] || "").trim();
    if (!symbol) continue;
    const meta = state.metaBySymbol && state.metaBySymbol.get(symbol);
    if (!meta) { warnings.push(`${i + 1}행 "${symbol}"(${(line[iName] || "").trim()}) — 수집 목록에 없는 코드라 건너뜀`); continue; }
    const qty = parseNumericCell(line[iQty]);
    if (qty == null || qty <= 0) { warnings.push(`${i + 1}행 "${symbol}" — 수량이 없어 건너뜀`); continue; }
    const r = { account: (iAcc >= 0 ? line[iAcc] : "") || "", symbol, qty };
    const avg = iAvg >= 0 ? parseNumericCell(line[iAvg]) : null;
    if (avg != null && avg > 0) r.avgPrice = avg;
    // "추정(TTM)"은 매번 다시 계산되는 값이라 그대로 되돌리면 다음 렌더에서 덮어써질 뿐이니
    // 저장하지 않는다 — "확정"일 때만 사용자가 직접 입력해 둔 값으로 되살린다.
    if (iDpsType >= 0 && (line[iDpsType] || "").trim() === "확정") {
      const dps = iDps >= 0 ? parseNumericCell(line[iDps]) : null;
      if (dps != null && dps > 0) r.confirmedDps = dps;
    }
    if (iPeriod >= 0 && (line[iPeriod] || "").trim()) r.payPeriod = normalizePayPeriod(line[iPeriod].trim());
    rows.push(r);
  }
  if (!rows.length && !warnings.length) warnings.push("가져올 종목이 없습니다.");
  return { rows, warnings };
}

/* CSV 텍스트 → TSV 텍스트 — 구글시트·엑셀에 붙여넣기(클립보드)용. 이미 만든 CSV 파서로
   구조화한 뒤 탭으로 다시 이어 붙인다(파서를 두 번 만들지 않음). */
function csvToTSV(csvText) {
  const table = parseDelimitedTable(csvText.trim(), ",");
  return table.map((row) => row.map((f) => (/\t|\n/.test(f) ? f.replace(/\t/g, " ") : f)).join("\t")).join("\n");
}

/* CSV/TSV 가져오기는 계좌+종목이 이미 있으면 수량·매입단가·확정DPS·지급시기만 갱신(upsert)하고,
   없으면 새 행을 추가한다. 전체를 지우고 다시 채우지 않는 이유: CSV에 없는 계좌(다른 화면에서
   입력해 둔 종목)를 실수로 날리면 안 되기 때문 — 이건 "완전 신규 업데이트"가 아니라 부분 갱신
   도구다. capture/index.html의 upsertAccountHolding과 같은 결의 로직이지만, 이 함수는 root
   index.html에도 필요해 capture 전용 함수에 의존하지 않고 여기(공용)에 다시 둔다. */
function applyCSVHoldingsRows(rows) {
  let added = 0, updated = 0;
  for (const r of rows) {
    const existing = [...document.querySelectorAll("#myAssetRows .portfolio-row")].find(
      (row) => row.querySelector(".my-account").value === (r.account || "") && row.querySelector(".my-symbol").value === r.symbol
    );
    if (existing) {
      existing.querySelector(".my-qty").value = r.qty || 0;
      if (r.avgPrice) existing.querySelector(".my-avg").value = r.avgPrice;
      if (r.confirmedDps) existing.querySelector(".my-confirmed").value = r.confirmedDps;
      if (r.payPeriod) existing.querySelector(".my-period").value = r.payPeriod;
      updated++;
    } else {
      addMyAssetRow(r);
      added++;
    }
  }
  return { added, updated };
}

/* 클립보드 복사 공용 헬퍼 — capture/index.html은 이미 자체 copyToClipboard를 갖고 있어
   그대로 두고, 여기서는 root index.html과 새 기능(TSV·리포트)이 공유해 쓸 이름을 따로 둔다. */
async function copyTextToClipboard(text, statusId, label) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusId) flashStatus(statusId, label || "복사됨 ✓");
    return true;
  } catch (err) {
    if (statusId) flashStatus(statusId, "복사 실패 — 브라우저 권한을 확인하세요");
    return false;
  }
}
