// shared/myassets-utils.js — 공용 유틸(내 자산·시뮬레이터·포트폴리오 공통)
// index.html에서 추출한 사본(2026-07-06 M1). index.html 원본은 그대로 두고 신규 capture 앱에서만 로드.

function csvField(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(fields) {
  return fields.map(csvField).join(",");
}

const BLENDS = [
  {
    id: "DIVO75_VOO25",
    name: "DIVO 75% + VOO 25%",
    category: "합성 포트폴리오",
    weights: [
      { symbol: "DIVO", weight: 0.75 },
      { symbol: "VOO", weight: 0.25 },
    ],
  },
];

function isBlend(id) { return BLENDS.some((b) => b.id === id); }

function flashStatus(elId, msg, ms = 2500) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._flashTimer);
  el._flashTimer = setTimeout(() => { el.textContent = ""; }, ms);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

/* ---------- A26a: 계좌번호 마스킹 ----------
   AI가 읽어온 화면 계좌명에는 실계좌번호가 그대로 들어 있다
   ("7164484143-15 [연금저축 CMA(비대면)(회사지원)]"). 처음엔 capture-parse.js 전용이었지만
   A28 리포트 생성(종합 탭)도 같은 마스킹이 필요해 여기(공용 유틸)로 옮겼다 — capture 앱은
   여전히 이 함수를 그대로 쓴다(스크립트 로드 순서상 myassets-utils.js가 먼저 실행됨).
   6자리 이상 연속 숫자만 대상이고 뒤 2자리는 남긴다 — 어느 계좌인지 사람이 알아볼 수는
   있으면서 번호 전체는 복원되지 않게. 6자리 미만은 건드리지 않으므로 "-15" 같은
   상품구분 꼬리표나 계좌명 속 숫자는 그대로다. */
function maskAccountLabel(label) {
  if (!label) return label;
  return String(label).replace(/\d{6,}/g, (run) => "*".repeat(run.length - 2) + run.slice(-2));
}

function nowDateTimeStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fmtPrice(x, currency) {
  // 원화는 소수점이 의미 없어 반올림 표기(달러 환산 합산 시 0.08원 같은 끝자리 방지)
  if (currency === "KRW") return "₩" + Math.round(x).toLocaleString();
  return "$" + x.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// 목표 금액은 입력칸이 만원 단위(myGoalAmount)라 표시도 맞춰서 만원 단위로 보여준다
function fmtManwon(x) { return Math.round(x / 10000).toLocaleString() + "만원"; }

function fmtDate(d) { return d; }

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/* A71(2026-08-31 사용자 보고): raw.githubusercontent.com이 간헐적으로 400을 준다 —
   실측: 442580.KS.json이 한 번 400으로 실패했다가 곧이어 같은 URL이 200을 줬다(파일
   내용은 변함없음). CDN 엣지의 순간적 오류로 보이며 재시도하면 대개 해결된다.
   최대 2회 재시도(짧은 backoff)하고, 그래도 실패하면 그대로 던진다 — 호출부가
   "이 종목만 계산에서 제외"할지 "전체를 멈출지"를 결정한다(이 함수는 지어내지 않는다). */
async function fetchJSON(path) {
  const sep = path.includes("?") ? "&" : "?";
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${path}${sep}_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${path} 불러오기 실패 (${res.status})`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// 차트 좌표계 상수·눈금 계산 — index.html 원본과 동일 값(A6에서 이식).
// 이전에는 shared에 이 정의가 없어서 buildChart가 월별 스냅샷 2건 이상일 때
// ReferenceError로 터지는 잠재 버그가 있었다(캡처앱·APK에서만, 스냅샷을 안 쌓으면 미발현).
const CHART_W = 800, CHART_H = 220, PAD_L = 46, PAD_R = 12, PAD_T = 14, PAD_B = 22;

function niceTicks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  let step;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

function nearestIndexByTime(tsArray, targetTs) {
  let lo = 0, hi = tsArray.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tsArray[mid] < targetTs) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(tsArray[lo - 1] - targetTs) <= Math.abs(tsArray[lo] - targetTs)) return lo - 1;
  return lo;
}

/* squarified treemap 배치 계산(A7 비중 히트맵용) — items는 value 내림차순 배열,
   (x,y,w,h) 직사각형 영역(% 좌표)을 각 아이템 면적이 value에 비례하도록 분할해
   같은 순서의 {x,y,w,h} 목록을 반환. 셀이 최대한 정사각형에 가깝게 유지되는
   고전 squarify 알고리즘(행 추가로 worst aspect ratio가 나빠지기 직전까지 채움). */
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((a, it) => a + it.value, 0);
  if (total <= 0 || !items.length || w <= 0 || h <= 0) return out;
  const areas = items.map((it) => (it.value / total) * w * h);
  const worstRatio = (row, side) => {
    const sum = row.reduce((a, b) => a + b, 0);
    let mx = 0;
    for (const a of row) mx = Math.max(mx, Math.max((side * side * a) / (sum * sum), (sum * sum) / (side * side * a)));
    return mx;
  };
  let i = 0, cx = x, cy = y, cw = w, ch = h;
  while (i < areas.length) {
    const side = Math.max(Math.min(cw, ch), 1e-9);
    let row = [areas[i]];
    let j = i + 1;
    while (j < areas.length && worstRatio(row.concat(areas[j]), side) <= worstRatio(row, side)) {
      row.push(areas[j]);
      j++;
    }
    const rowSum = row.reduce((a, b) => a + b, 0);
    const thick = rowSum / side;
    let off = 0;
    for (const a of row) {
      const len = a / thick;
      if (cw >= ch) out.push({ x: cx, y: cy + off, w: thick, h: len });
      else out.push({ x: cx + off, y: cy, w: len, h: thick });
      off += len;
    }
    if (cw >= ch) { cx += thick; cw -= thick; }
    else { cy += thick; ch -= thick; }
    i = j;
  }
  return out;
}

/* 여러 시리즈를 한 캔버스에 겹쳐 그리는 비교 차트 — index.html의 MDD Underwater 비교용을
   이식하되, 낙폭(≤0) 전용이던 y축을 양수 수익률도 그릴 수 있게 일반화(A6 지수비교 탭용).
   seriesList: [{ label, color, dates:[YYYY-MM-DD], values:[비율(0.05=+5%)] }] */
function buildCompareChart(container, seriesList, opts = {}) {
  // opts.fmtAxis/fmtTip: 값 포맷터(기본 % — 기존 호출부 무변경). opts.anchorZero=false면
  // y축을 0에 고정하지 않음(가격 도메인 다중선용, A10 시그널 탭).
  const fmtAxis = opts.fmtAxis || ((v) => (v * 100).toFixed(0) + "%");
  const fmtTip = opts.fmtTip || ((v) => (v * 100).toFixed(1) + "%");
  const anchorZero = opts.anchorZero !== false;
  const H = opts.height || CHART_H;
  const domainMin = Math.min(...seriesList.map((s) => Date.parse(s.dates[0])));
  const domainMax = Math.max(...seriesList.map((s) => Date.parse(s.dates[s.dates.length - 1])));
  const xAt = (ts) => PAD_L + ((ts - domainMin) / (domainMax - domainMin)) * (CHART_W - PAD_L - PAD_R);

  let vMin = anchorZero ? 0 : Infinity, vMax = anchorZero ? 0 : -Infinity;
  for (const s of seriesList) { vMin = Math.min(vMin, ...s.values); vMax = Math.max(vMax, ...s.values); }
  const ticks = niceTicks(vMin, vMax, 5);
  const tMin = ticks[0], tMax = ticks[ticks.length - 1];
  const yAt = (v) => PAD_T + (1 - (v - tMin) / (tMax - tMin)) * (H - PAD_T - PAD_B);

  const tsLists = seriesList.map((s) => s.dates.map((d) => Date.parse(d)));

  const gridSvg = ticks
    .map((t) => {
      const y = yAt(t).toFixed(2);
      return `<line class="gridline" x1="${PAD_L}" x2="${CHART_W - PAD_R}" y1="${y}" y2="${y}"/>` +
             `<text class="axis-label" x="${PAD_L - 6}" y="${Number(y) + 3}" text-anchor="end">${fmtAxis(t)}</text>`;
    })
    .join("");

  const xTickCount = 5;
  let xLabelsSvg = "";
  for (let k = 0; k <= xTickCount; k++) {
    const ts = domainMin + (k / xTickCount) * (domainMax - domainMin);
    const x = xAt(ts).toFixed(2);
    const label = new Date(ts).toISOString().slice(0, 7);
    xLabelsSvg += `<text class="axis-label" x="${x}" y="${H - 4}" text-anchor="middle">${label}</text>`;
  }

  // 0% 기준선(수익/손실 경계) — 낙폭 전용이던 원본과 달리 0이 축 중간에 올 수 있어 명시적으로 그린다
  const zeroY = yAt(0).toFixed(2);

  let linesSvg = "";
  seriesList.forEach((s, si) => {
    let path = "";
    for (let i = 0; i < s.dates.length; i++) {
      const x = xAt(tsLists[si][i]).toFixed(2), y = yAt(s.values[i]).toFixed(2);
      path += (i === 0 ? "M" : "L") + x + "," + y + " ";
    }
    linesSvg += `<path fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" d="${path}"/>`;
  });

  const legendSvg = seriesList
    .map((s) => `<span class="legend-item"><span class="line-key" style="background:${s.color}"></span>${s.label}</span>`)
    .join("");

  container.innerHTML = `
    <div class="legend-row">${legendSvg}</div>
    <div class="chart-box">
      <svg class="chart" viewBox="0 0 ${CHART_W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${gridSvg}
        ${xLabelsSvg}
        <line class="baseline" x1="${PAD_L}" x2="${CHART_W - PAD_R}" y1="${zeroY}" y2="${zeroY}"/>
        ${linesSvg}
        <g class="hover-layer" style="display:none">
          <line class="crosshair-line" x1="0" x2="0" y1="${PAD_T}" y2="${H - PAD_B}"/>
        </g>
      </svg>
      <div class="tooltip"></div>
    </div>`;

  const svg = container.querySelector("svg");
  const hoverLayer = container.querySelector(".hover-layer");
  const crosshair = container.querySelector(".crosshair-line");
  const tooltip = container.querySelector(".tooltip");

  function onMove(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const ratio = Math.min(1, Math.max(0, (loc.x - PAD_L) / (CHART_W - PAD_L - PAD_R)));
    const targetTs = domainMin + ratio * (domainMax - domainMin);

    hoverLayer.style.display = "";
    const x = xAt(targetTs);
    crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x);

    const rect = svg.getBoundingClientRect();
    const px = rect.left + (x / CHART_W) * rect.width;
    tooltip.style.left = (px - rect.left) + "px";
    tooltip.style.top = ((PAD_T + 4) / H) * 100 + "%";
    tooltip.style.transform = "translate(-50%, 0%)";
    tooltip.style.opacity = "1";

    let refDate = "";
    const rows = seriesList
      .map((s, si) => {
        const idx = nearestIndexByTime(tsLists[si], targetTs);
        if (!refDate || s.dates[idx] > refDate) refDate = s.dates[idx];
        return `<div class="t-row"><span class="t-key"><span class="t-swatch" style="background:${s.color}"></span>${s.label}</span>` +
               `<strong>${fmtTip(s.values[idx])}</strong></div>`;
      })
      .join("");
    tooltip.innerHTML = `<div class="t-date">${refDate}</div>${rows}`;
  }
  // A32b: 모바일은 hover가 없어 pointermove만으로는 탭해도 표시가 안 뜬다(드래그해야만 나옴).
  // 탭(click)하면 그 위치에 고정해서 보여주고, 다시 탭하면 풀리게 한다.
  let pinned = false;
  function hide() { hoverLayer.style.display = "none"; tooltip.style.opacity = "0"; }
  function onLeave() { if (!pinned) hide(); }
  function onClick(evt) {
    pinned = !pinned;
    if (pinned) onMove(evt); else hide();
  }

  svg.addEventListener("pointermove", (evt) => { if (!pinned) onMove(evt); });
  svg.addEventListener("pointerleave", onLeave);
  svg.addEventListener("click", onClick);
}

function buildChart(container, opts) {
  const { dates, values, color, mode, markers, valueFmt, seriesLabel } = opts;
  const axisPrefix = opts.currency === "KRW" ? "₩" : "$";
  const n = values.length;
  const xAt = (i) => PAD_L + (i / (n - 1)) * (CHART_W - PAD_L - PAD_R);

  let vMin = Math.min(...values), vMax = Math.max(...values);
  if (mode === "drawdown") vMax = Math.max(vMax, 0);
  const ticks = niceTicks(vMin, vMax, 5);
  const tMin = ticks[0], tMax = ticks[ticks.length - 1];
  const yAt = (v) => PAD_T + (1 - (v - tMin) / (tMax - tMin)) * (CHART_H - PAD_T - PAD_B);

  let path = "";
  for (let i = 0; i < n; i++) path += (i === 0 ? "M" : "L") + xAt(i).toFixed(2) + "," + yAt(values[i]).toFixed(2) + " ";

  let areaPath = "";
  if (mode === "drawdown") {
    const zeroY = yAt(0).toFixed(2);
    areaPath = `M${xAt(0).toFixed(2)},${zeroY} ` + path.replace(/^M/, "L") + `L${xAt(n - 1).toFixed(2)},${zeroY} Z`;
  }

  const gridSvg = ticks
    .map((t) => {
      const y = yAt(t).toFixed(2);
      const label = mode === "drawdown" ? (t * 100).toFixed(0) + "%" : axisPrefix + t.toLocaleString();
      return `<line class="gridline" x1="${PAD_L}" x2="${CHART_W - PAD_R}" y1="${y}" y2="${y}"/>` +
             `<text class="axis-label" x="${PAD_L - 6}" y="${Number(y) + 3}" text-anchor="end">${label}</text>`;
    })
    .join("");

  // x축: 대략 5개 라벨
  const xTickCount = 5;
  let xLabelsSvg = "";
  for (let k = 0; k <= xTickCount; k++) {
    const idx = Math.round((k / xTickCount) * (n - 1));
    const x = xAt(idx).toFixed(2);
    xLabelsSvg += `<text class="axis-label" x="${x}" y="${CHART_H - 4}" text-anchor="middle">${dates[idx].slice(0, 7)}</text>`;
  }

  let markerSvg = "";
  if (markers) {
    for (const m of markers) {
      const x = xAt(m.idx).toFixed(2), y = yAt(values[m.idx]).toFixed(2);
      markerSvg += `<circle class="marker ${m.cls}" cx="${x}" cy="${y}" r="5"/>`;
      if (m.label) {
        const anchor = m.idx > n * 0.75 ? "end" : m.idx < n * 0.25 ? "start" : "middle";
        const dx = anchor === "end" ? -8 : anchor === "start" ? 8 : 0;
        markerSvg += `<text class="direct-label" x="${Number(x) + dx}" y="${Number(y) - 10}" text-anchor="${anchor}">${m.label}</text>`;
      }
    }
  }

  container.innerHTML = `
    <div class="chart-box">
      <svg class="chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="xMidYMid meet">
        ${gridSvg}
        <line class="baseline" x1="${PAD_L}" x2="${CHART_W - PAD_R}" y1="${CHART_H - PAD_B}" y2="${CHART_H - PAD_B}"/>
        ${areaPath ? `<path class="dd-area" d="${areaPath}"/>` : ""}<path class="${mode === "drawdown" ? "dd-line" : "price-line"}" d="${path}"/>
        ${markerSvg}
        ${xLabelsSvg}
        <g class="hover-layer" style="display:none">
          <line class="crosshair-line" x1="0" x2="0" y1="${PAD_T}" y2="${CHART_H - PAD_B}"/>
        </g>
      </svg>
      <div class="tooltip"></div>
    </div>`;

  const svg = container.querySelector("svg");
  const hoverLayer = container.querySelector(".hover-layer");
  const crosshair = container.querySelector(".crosshair-line");
  const tooltip = container.querySelector(".tooltip");

  function pointerToIndex(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const ratio = Math.min(1, Math.max(0, (loc.x - PAD_L) / (CHART_W - PAD_L - PAD_R)));
    return Math.round(ratio * (n - 1));
  }

  function onMove(evt) {
    const i = pointerToIndex(evt);
    if (i < 0 || i >= n) return;
    hoverLayer.style.display = "";
    const x = xAt(i);
    crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x);

    const rect = svg.getBoundingClientRect();
    const px = rect.left + (x / CHART_W) * rect.width;
    const py = rect.top + (yAt(values[i]) / CHART_H) * rect.height;
    tooltip.style.left = (px - rect.left) + "px";
    tooltip.style.top = (py - rect.top) + "px";
    tooltip.style.opacity = "1";
    tooltip.innerHTML =
      `<div class="t-date">${dates[i]}</div>` +
      `<div class="t-row"><span class="t-key"><span class="t-swatch" style="background:${color}"></span>${seriesLabel}</span>` +
      `<strong>${valueFmt(values[i])}</strong></div>`;
  }
  // A32b: 탭(click)하면 그 위치에 고정해서 보여주고, 다시 탭하면 풀리게 한다(모바일은 hover가 없음).
  let pinned = false;
  function hide() { hoverLayer.style.display = "none"; tooltip.style.opacity = "0"; }
  function onLeave() { if (!pinned) hide(); }
  function onClick(evt) {
    pinned = !pinned;
    if (pinned) onMove(evt); else hide();
  }

  svg.addEventListener("pointermove", (evt) => { if (!pinned) onMove(evt); });
  svg.addEventListener("pointerleave", onLeave);
  svg.addEventListener("click", onClick);
}

/* ---------- A29: 계좌별 월별 손익 ----------
   실제 매매내역(입출금·추가매수 시점)이 없어 완벽한 손익 분해는 불가능하다 — 대신 "지금
   보유한 수량을 그 기간 내내 그대로 갖고 있었다면"이라는 가정으로 월말 평가액을 과거로
   재구성하고, 그 월간 증감을 손익으로 본다(A26b 포트폴리오 MDD와 같은 합성 방식이지만
   단위는 %가 아니라 원화 절대값). 원화 환산은 그 시점의 실제 환율을 쓴다(현재 환율로
   과거를 재는 오차를 없애기 위함 — fx.dates/fx.rates가 이미 그 이력을 갖고 있다). */

/* 이분탐색으로 date 이하 마지막 환율을 찾는다(환율 미수집일은 직전 영업일 값으로 대체). */
function fxRateOnOrBefore(fx, date) {
  if (!fx || !fx.dates || !fx.dates.length) return null;
  let lo = 0, hi = fx.dates.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fx.dates[mid] <= date) { ans = fx.rates[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/* rows: perRow(계좌로 이미 필터링된 배열). 반환 { dates, values(원화) } — 공통 교집합 날짜
   위에서만 계산한다(한 종목이라도 그 날짜에 값이 없으면 전체 평가액을 낼 수 없으므로). */
function accountMonthlyValueSeries(rows, fx) {
  const usable = (rows || []).filter((p) => p.qty > 0 && p.full && p.full.dates && p.full.dates.length);
  if (!usable.length) return null;
  const priceMaps = usable.map((p) => {
    const m = new Map();
    for (let i = 0; i < p.full.dates.length; i++) m.set(p.full.dates[i], p.full.closes[i]);
    return m;
  });
  let commonDates = [...priceMaps[0].keys()];
  for (let i = 1; i < priceMaps.length; i++) commonDates = commonDates.filter((d) => priceMaps[i].has(d));
  commonDates.sort();
  if (commonDates.length < 2) return null;
  const dates = [], values = [];
  for (const date of commonDates) {
    let v = 0;
    for (let i = 0; i < usable.length; i++) {
      const close = priceMaps[i].get(date);
      const isUsd = (usable[i].full.currency || "USD") === "USD";
      const rate = isUsd ? fxRateOnOrBefore(fx, date) : 1;
      if (isUsd && rate == null) { v = null; break; } // 그 날짜의 환율을 못 구하면 이 날은 건너뜀
      v += close * rate * usable[i].qty;
    }
    if (v == null) continue;
    dates.push(date); values.push(v);
  }
  return dates.length >= 2 ? { dates, values } : null;
}

/* 일별 평가액 시리즈 → 월별 손익(원) — 각 달의 "마지막 거래일" 평가액 차이.
   반환 [{month:"YYYY-MM", pnl}] — 시간순, 첫 달은 비교 대상(전월)이 없어 제외된다. */
function monthlyPnlFromDailySeries(dailySeries) {
  if (!dailySeries) return [];
  const { dates, values } = dailySeries;
  const monthEnd = new Map(); // 같은 달의 뒤쪽 날짜로 계속 덮어써서 결국 "그 달의 마지막 거래일"만 남는다
  for (let i = 0; i < dates.length; i++) monthEnd.set(dates[i].slice(0, 7), values[i]);
  const months = [...monthEnd.keys()].sort();
  const out = [];
  for (let i = 1; i < months.length; i++) {
    out.push({ month: months[i], pnl: monthEnd.get(months[i]) - monthEnd.get(months[i - 1]) });
  }
  return out;
}

/* 월별 손익 막대그래프 — buildCompareChart/buildChart와 같은 SVG 좌표계·호버 패턴을 쓰지만
   선이 아니라 막대(rect)이고, 부호에 따라 색이 갈린다(참고 화면: 양수=파랑/청록, 음수=주황). */
function buildMonthlyBarChart(container, months, opts = {}) {
  if (!months || !months.length) {
    container.innerHTML = `<p class="compare-empty">${opts.emptyMsg || "표시할 월별 손익 데이터가 없습니다."}</p>`;
    return;
  }
  const H = opts.height || CHART_H;
  const n = months.length;
  const vals = months.map((m) => m.pnl);
  const vMin = Math.min(0, ...vals), vMax = Math.max(0, ...vals);
  const ticks = niceTicks(vMin, vMax, 5);
  const tMin = ticks[0], tMax = ticks[ticks.length - 1];
  const yAt = (v) => PAD_T + (1 - (v - tMin) / (tMax - tMin || 1)) * (H - PAD_T - PAD_B);
  const bw = (CHART_W - PAD_L - PAD_R) / n;
  const zeroY = yAt(0);
  const good = cssVar("--good") || "#2e7d32", bad = cssVar("--critical") || "#c62828";
  const fmtW = (v) => fmtPrice(v, "KRW");

  const gridSvg = ticks.map((t) => {
    const y = yAt(t).toFixed(2);
    return `<line class="gridline" x1="${PAD_L}" x2="${CHART_W - PAD_R}" y1="${y}" y2="${y}"/>` +
           `<text class="axis-label" x="${PAD_L - 6}" y="${Number(y) + 3}" text-anchor="end">${fmtW(t)}</text>`;
  }).join("");

  const xTickEvery = Math.max(1, Math.ceil(n / 12));
  let xLabelsSvg = "";
  months.forEach((m, i) => {
    if (i % xTickEvery !== 0 && i !== n - 1) return;
    const x = (PAD_L + (i + 0.5) * bw).toFixed(2);
    xLabelsSvg += `<text class="axis-label" x="${x}" y="${H - 4}" text-anchor="middle">${m.month.slice(2)}</text>`;
  });

  const barsSvg = months.map((m, i) => {
    const x = PAD_L + i * bw + bw * 0.15;
    const w = bw * 0.7;
    const y1 = yAt(Math.max(0, m.pnl)), y2 = yAt(Math.min(0, m.pnl));
    const color = m.pnl >= 0 ? good : bad;
    return `<rect x="${x.toFixed(2)}" y="${y1.toFixed(2)}" width="${w.toFixed(2)}" height="${Math.max(0.5, y2 - y1).toFixed(2)}" fill="${color}"/>`;
  }).join("");

  container.innerHTML = `
    <div class="chart-box">
      <svg class="chart" viewBox="0 0 ${CHART_W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${gridSvg}
        ${xLabelsSvg}
        <line class="baseline" x1="${PAD_L}" x2="${CHART_W - PAD_R}" y1="${zeroY.toFixed(2)}" y2="${zeroY.toFixed(2)}"/>
        ${barsSvg}
        <g class="hover-layer" style="display:none">
          <line class="crosshair-line" x1="0" x2="0" y1="${PAD_T}" y2="${H - PAD_B}"/>
        </g>
      </svg>
      <div class="tooltip"></div>
    </div>`;

  const svg = container.querySelector("svg");
  const hoverLayer = container.querySelector(".hover-layer");
  const crosshair = container.querySelector(".crosshair-line");
  const tooltip = container.querySelector(".tooltip");

  function onMove(evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    let i = Math.floor((loc.x - PAD_L) / bw);
    i = Math.min(n - 1, Math.max(0, i));
    const x = PAD_L + (i + 0.5) * bw;
    hoverLayer.style.display = "";
    crosshair.setAttribute("x1", x); crosshair.setAttribute("x2", x);
    const rect = svg.getBoundingClientRect();
    const px = rect.left + (x / CHART_W) * rect.width;
    tooltip.style.left = (px - rect.left) + "px";
    tooltip.style.top = ((PAD_T + 4) / H) * 100 + "%";
    tooltip.style.transform = "translate(-50%, 0%)";
    tooltip.style.opacity = "1";
    const m = months[i];
    const color = m.pnl >= 0 ? good : bad;
    tooltip.innerHTML = `<div class="t-date">${m.month}</div><div class="t-row"><strong style="color:${color}">${m.pnl >= 0 ? "+" : ""}${fmtW(m.pnl)}</strong></div>`;
  }
  // A32b: 탭(click)하면 그 위치에 고정해서 보여주고, 다시 탭하면 풀리게 한다(모바일은 hover가 없음).
  let pinned = false;
  function hide() { hoverLayer.style.display = "none"; tooltip.style.opacity = "0"; }
  function onLeave() { if (!pinned) hide(); }
  function onClick(evt) {
    pinned = !pinned;
    if (pinned) onMove(evt); else hide();
  }

  svg.addEventListener("pointermove", (evt) => { if (!pinned) onMove(evt); });
  svg.addEventListener("pointerleave", onLeave);
  svg.addEventListener("click", onClick);
}

/* A47(2026-08-13 사용자 결정): 상·하한 클램프(±150%/-70%) 제거. A45b에서 "보정 내역"으로
   드러냈던 절단이 실측상 왜곡이었다는 게 확인됐다 — 사용자 판단: 일반종목(개별주)은 실제로
   장기 고수익 구간이 있고, ETF는 작년부터 매수해 이력이 짧아도 실 비중이 크므로, 값을 눌러서
   보여주는 게 오히려 오해를 만든다. 이제 raw 연환산값을 그대로 쓴다. capped/floored 필드는
   호출부(trailNoteHTML 등)와의 형태 호환을 위해 남기되 항상 false — 절단이 없으므로.
   spanMonths는 실제로 쓰인 구간 길이라, months보다 짧으면 요청 기간만큼 이력이 없다는 뜻이다. */
function trailingReturnDetail(dates, closes, months) {
  if (!dates || dates.length < 2) return null;
  const lastClose = closes[closes.length - 1];
  const lastDate = dates[dates.length - 1];
  const cutoff = new Date(lastDate);
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutStr = cutoff.toISOString().slice(0, 10);
  let idx = dates.findIndex((d) => d >= cutStr);
  if (idx < 0 || idx >= dates.length - 1) idx = 0;
  const startClose = closes[idx];
  if (!(startClose > 0)) return null;
  const startDate = dates[idx];
  const periodReturn = lastClose / startClose - 1;
  const annualized = Math.pow(1 + periodReturn, 12 / months) - 1;
  const spanMonths = (new Date(lastDate).getFullYear() - new Date(startDate).getFullYear()) * 12
    + (new Date(lastDate).getMonth() - new Date(startDate).getMonth());
  return {
    value: annualized,
    raw: annualized,
    capped: false,
    floored: false,
    // 요청 기간보다 1개월 이상 짧으면 이력부족 — 그 짧은 구간 수익률이 기간 전체값으로 쓰인다
    shortHistory: spanMonths < months - 1,
    spanMonths, startDate, lastDate,
  };
}

function trailingReturnAnnualized(dates, closes, months) {
  const d = trailingReturnDetail(dates, closes, months);
  return d ? d.value : null;
}

const ACCOUNT_TYPES = [
  "삼성_DC", "삼성_연금", "삼성_연금저축(세금미공제)", "삼성_IRP", "삼성_일반", "삼성_외화",
  "KB_일반", "KB_ISA", "신한_일반",
];

/* A52(2026-08-13 사용자 보고 — 타인 배포 후 피드백): ACCOUNT_TYPES가 이 코드에 박힌
   내 계좌명 9개라, 다른 사람이 자기 JSON을 가져와도 드롭다운엔 계속 "삼성_DC" 같은
   내 계좌가 보였다(그 사람 계좌명 자체는 각 행에 보존되지만, 다른 행에서 골라 쓸
   선택지로는 안 나옴). dynamicList가 있으면 그것만 쓰고 ACCOUNT_TYPES는 섞지 않는다 —
   "JSON에 기재된 계좌정보대로 표시"가 목표라, 남의 계좌 목록에 내 계좌명이 끼어 있으면
   오히려 더 헷갈린다. dynamicList가 비어있을 때만(완전 빈 템플릿 등) 마지막 안전망으로
   ACCOUNT_TYPES를 쓴다. */
function accountOptionsHTML(selected, dynamicList) {
  // dynamicList 인자를 생략한 호출부(⚡ 계좌 일괄 지정 등)도 state.myAccountsExplicit로
  // 자동 폴백 — 호출부마다 일일이 넘겨줄 필요 없이 "가져온 JSON 기준 계좌 목록"이 앱
  // 전체에서 일관되게 적용된다.
  const effectiveList = dynamicList !== undefined ? dynamicList : state.myAccountsExplicit;
  const list = (effectiveList && effectiveList.length) ? effectiveList : ACCOUNT_TYPES;
  let html = `<option value="" ${!selected ? "selected" : ""}>계좌 미지정</option>`;
  // 목록 밖 계좌명이 선택돼 있어도 그대로 보존한다 —
  // 조용히 "계좌 미지정"으로 빠지면 계좌별 합계를 시트와 비교할 수 없게 됨
  if (selected && !list.includes(selected)) {
    html += `<option value="${selected}" selected>${selected}</option>`;
  }
  for (const acc of list) {
    html += `<option value="${acc}" ${acc === selected ? "selected" : ""}>${acc}</option>`;
  }
  return html;
}

/* rows 배열(가져오기 JSON 등)에서 실제 쓰인 계좌명만 등장 순서대로 뽑는다 —
   cfg.accounts를 명시하지 않은 파일도 이걸로 "JSON에 기재된 계좌정보대로" 동작한다. */
function deriveAccountListFromRows(rows) {
  const seen = new Set();
  const list = [];
  for (const r of rows || []) {
    const acc = r && r.account;
    if (acc && !seen.has(acc)) { seen.add(acc); list.push(acc); }
  }
  return list;
}

/* ---------- A25f: 지급시기(payPeriod) 정규화 ----------
   가져오기 JSON은 "월중15일"처럼 상세 표기를 쓰는데 화면 select 옵션은 "월중"만 갖고 있어
   어느 것도 매칭되지 않았고, 그 상태로 저장하면 지급시기가 통째로 빈 값이 됐다(2026-08-01
   실측 버그 — 배당기준일 계산이 이 값에 의존하므로 치명적). 접두만 보고 정식 값으로 승격한다. */
const PAY_PERIOD_TYPES = ["월초5일", "월중15일", "월말30일", "분기말", "확인안됨"];
// A58(2026-08-18 사용자 요청): 월배당 TOP10 등 목록형 화면에 짧게 곁들일 표기 — "월초5일" 같은
// 상세 표기 대신 "월초"만 쓴다(배당기준일 계산에는 상세 표기가 그대로 필요해 PAY_PERIOD_TYPES
// 자체는 안 바꾼다).
const PAY_PERIOD_SHORT = { "월초5일": "월초", "월중15일": "월중", "월말30일": "월말", "분기말": "분기", "확인안됨": "미확인" };

function normalizePayPeriod(v) {
  const s = (v || "").trim();
  if (!s || PAY_PERIOD_TYPES.includes(s)) return s;
  if (s.startsWith("월초")) return "월초5일";
  if (s.startsWith("월중")) return "월중15일";
  if (s.startsWith("월말")) return "월말30일";
  if (s.startsWith("분기")) return "분기말";
  return s; // 알 수 없는 표기는 지우지 않고 보존(accountOptionsHTML의 목록 밖 계좌명 처리와 동일)
}

function payPeriodOptionsHTML(selected) {
  const cur = normalizePayPeriod(selected);
  let html = `<option value="" ${!cur ? "selected" : ""}>지급시기</option>`;
  if (cur && !PAY_PERIOD_TYPES.includes(cur)) {
    html += `<option value="${cur}" selected>${cur}</option>`;
  }
  for (const p of PAY_PERIOD_TYPES) {
    html += `<option value="${p}" ${p === cur ? "selected" : ""}>${p}</option>`;
  }
  return html;
}

/* ---------- A25c: 배당기준일(record date) 산출 ----------
   국내 ETF 기준일은 종목별 API 조회가 필요 없는 정형 패턴이다(사용자 제공 가이드):
     월중 → 매월 15일 / 월말 → 매월 마지막 영업일 / 월초 → 매월 첫 영업일 /
     분기 → 1·4·7·10월 마지막 영업일(12월은 결산).
   "휴일이면 직전 영업일" 규칙은 **별도 휴일 달력 없이** 실제 거래일 시리즈(tradingDates =
   data/{symbol}.json의 dates)에서 목표일 이하의 마지막 날짜를 찾아 처리한다 — 수집 데이터
   자체가 개장일만 담고 있어 달력을 따로 두는 것보다 정확하고 유지보수가 필요 없다. */
const QUARTER_RECORD_MONTHS = [1, 4, 7, 10, 12]; // 12월은 결산 기준일

function lastTradingDayOnOrBefore(tradingDates, target) {
  for (let i = tradingDates.length - 1; i >= 0; i--) if (tradingDates[i] <= target) return tradingDates[i];
  return null;
}
function firstTradingDayOnOrAfter(tradingDates, target) {
  for (let i = 0; i < tradingDates.length; i++) if (tradingDates[i] >= target) return tradingDates[i];
  return null;
}

/* ym="YYYY-MM". 반환 {date, future} — future면 date는 아직 오지 않은 달력상 예정일이라
   그 날 종가가 없으므로 호출부가 현재가로 대체하고 "미도래"로 표시해야 한다. */
function dividendRecordDate(payPeriod, ym, tradingDates) {
  const p = normalizePayPeriod(payPeriod);
  if (!p || p === "확인안됨" || !ym || !tradingDates || !tradingDates.length) return null;
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return null;
  if (p === "분기말" && !QUARTER_RECORD_MONTHS.includes(m)) return null; // 분기 기준월이 아닌 달은 지급 없음
  const pad = (n) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const target = p === "월초5일" ? `${y}-${pad(m)}-01`
    : p === "월중15일" ? `${y}-${pad(m)}-15`
    : `${y}-${pad(m)}-${pad(lastDay)}`; // 월말30일·분기말
  const lastAvail = tradingDates[tradingDates.length - 1];
  if (target > lastAvail) return { date: target, future: true };
  const actual = p === "월초5일"
    ? firstTradingDayOnOrAfter(tradingDates, target)
    : lastTradingDayOnOrBefore(tradingDates, target);
  return actual ? { date: actual, future: false } : null;
}

/* T+2 결제 — 배당을 받으려면 기준일 2영업일 전까지 매수를 마쳐야 한다. */
function buyDeadlineDate(recordDate, tradingDates) {
  if (!recordDate || !tradingDates) return null;
  const i = tradingDates.indexOf(recordDate);
  return i >= 2 ? tradingDates[i - 2] : null;
}

/* 기준일 종가 조회 — 없으면 null(호출부가 현재가로 폴백) */
function closeOnDate(full, date) {
  if (!full || !date) return null;
  const i = full.dates.indexOf(date);
  return i >= 0 ? full.closes[i] : null;
}

function etfOptionsHTML(selectedSymbol) {
  const byCategory = new Map();
  for (const etf of state.listedEtfs) {
    if (!byCategory.has(etf.category)) byCategory.set(etf.category, []);
    byCategory.get(etf.category).push(etf);
  }
  let html = "";
  // 가져오기 등으로 아직 수집 목록에 없는 종목코드가 들어오면, 조용히 다른
  // 종목으로 바뀌지 않도록 그 코드 그대로 보여주는 임시 옵션을 앞에 추가한다
  const known = state.listedEtfs.some((e) => e.symbol === selectedSymbol);
  if (selectedSymbol && !known) {
    html += `<option value="${selectedSymbol}" selected>⚠️ ${selectedSymbol} (수집 목록에 없음)</option>`;
  }
  for (const [category, list] of byCategory) {
    html += `<optgroup label="${category}">`;
    for (const etf of list) {
      html += `<option value="${etf.symbol}" ${etf.symbol === selectedSymbol ? "selected" : ""}>${etf.name}</option>`;
    }
    html += `</optgroup>`;
  }
  return html;
}

const BUY_FREQ_TIMES = { "매월": 1, "매주": 4, "매일": 22 };

const MY_ASSETS_PALETTE = ["#2a78d6", "#e5484d", "#2a9d5c", "#c98a2c", "#7b5ec9", "#1aa8a0", "#c9527b", "#5c7ac9"];

/* 계좌별 고정 색상 — 순위 기반(PALETTE[i])이 아니라 계좌명 자체로 색을 정해서
   "계좌별 월배당"·"계좌별 비중"·"월배당 TOP10" 등 여러 그래프에서 같은 계좌는 항상 같은 색으로 보이게 한다. */
function accountColor(account) {
  const idx = ACCOUNT_TYPES.indexOf(account);
  if (idx >= 0) return MY_ASSETS_PALETTE[idx % MY_ASSETS_PALETTE.length];
  let hash = 0;
  const s = account || "";
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return MY_ASSETS_PALETTE[(ACCOUNT_TYPES.length + hash) % MY_ASSETS_PALETTE.length];
}

/* scripts/fetch_intraday_kr.py가 평일 KST 09:05~15:35 30분마다(매시 5분·35분) 실행되는 것과
   동일한 규칙으로 "다음 수집까지 남은 시간"을 계산한다 — 방문자의 로컬 시간대와 무관하게
   Asia/Seoul 기준으로 판단해야 하므로 Intl로 KST 구성요소를 뽑아 쓴다.
   ⚠️ 이건 "예정 시각"일 뿐이다 — GitHub 무료 스케줄 큐가 정시·30분 congestion 때문에
   실제로는 수 시간까지 밀리거나 통째로 드롭되는 경우가 실측(2026-07-06~10)으로 확인됨. */
function nextIntradayCollectionText() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(parts.weekday);
  const minutesOfDay = hour * 60 + minute;
  const OPEN = 9 * 60 + 5, CLOSE = 15 * 60 + 35;
  if (isWeekday && minutesOfDay >= OPEN && minutesOfDay < CLOSE) {
    const nextMark = minute < 5 ? hour * 60 + 5 : minute < 35 ? hour * 60 + 35 : (hour + 1) * 60 + 5;
    const remain = nextMark - minutesOfDay;
    const hh = String(Math.floor(nextMark / 60)).padStart(2, "0");
    const mm = String(nextMark % 60).padStart(2, "0");
    return `다음 예정 수집까지 약 ${remain}분(${hh}:${mm}, GitHub 사정으로 더 늦어지거나 건너뛸 수 있음)`;
  }
  return "휴장 중(평일 09:05~15:35 외) — 다음 수집은 개장 후 30분 주기 예정(지연 가능)";
}

function monthsToGoal(goal, lump, monthly, annualRate) {
  if (!(goal > 0)) return null;
  const rm = Math.pow(1 + annualRate, 1 / 12) - 1;
  for (let m = 0; m <= 600; m++) {
    const growth = Math.abs(rm) < 1e-9 ? monthly * m : monthly * ((Math.pow(1 + rm, m) - 1) / rm);
    const fv = lump * Math.pow(1 + rm, m) + growth;
    if (fv >= goal) return { months: m, contributed: lump + monthly * m };
  }
  return { months: null, contributed: null };
}

/* A30: 계획 달성현황 — monthsToGoal과 같은 복리적립 공식을, "목표까지 몇 개월"이 아니라
   "0개월째부터 매달 얼마씩 불어나는지" 시계열로 뽑아낸다(계획 라인 차트·특정 시점 금액
   조회 양쪽에 재사용). annualRate=0을 넣으면 성장 없이 lump+monthly*m만 남아 "원금(적립만)"
   라인과 같은 식이 된다 — 별도 공식을 두지 않고 이 함수 하나로 계획선·원금선을 모두 만든다. */
function fvProjectionSeries(lump, monthly, annualRate, months) {
  const rm = Math.pow(1 + annualRate, 1 / 12) - 1;
  const out = [];
  for (let m = 0; m <= months; m++) {
    const growth = Math.abs(rm) < 1e-9 ? monthly * m : monthly * ((Math.pow(1 + rm, m) - 1) / rm);
    out.push(lump * Math.pow(1 + rm, m) + growth);
  }
  return out;
}

/* "YYYY-MM" 두 문자열 사이의 개월 수(b - a). 월별 스냅샷 이력의 month 필드가 이 형식이다. */
function monthDiffYM(a, b) {
  const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

/* MDD 계산 — index.html 원본과 동일 사본(A10에서 shared로 이식, 연간 MDD 계산에 사용) */
function calcMDD(dates, closes) {
  let peakPrice = closes[0], peakIdx = 0;
  let mdd = 0, mddPeakIdx = 0, mddTroughIdx = 0;
  const ddSeries = new Array(closes.length);
  for (let i = 0; i < closes.length; i++) {
    if (closes[i] > peakPrice) { peakPrice = closes[i]; peakIdx = i; }
    const dd = (closes[i] - peakPrice) / peakPrice;
    ddSeries[i] = dd;
    if (dd < mdd) { mdd = dd; mddPeakIdx = peakIdx; mddTroughIdx = i; }
  }
  let recoveryIdx = -1;
  const peakVal = closes[mddPeakIdx];
  for (let i = mddTroughIdx + 1; i < closes.length; i++) {
    if (closes[i] >= peakVal) { recoveryIdx = i; break; }
  }
  return { mdd, peakIdx: mddPeakIdx, troughIdx: mddTroughIdx, recoveryIdx, ddSeries };
}

/* ===== A10 📡 시그널 탭: 기술적 지표 순수함수 (종가 배열 기반 — OHLC·거래량 없음) ===== */

/* 단순이동평균 시리즈 — 앞쪽 n-1개는 null */
function smaSeries(closes, n) {
  const out = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/* 마지막 시점의 MA n 값 (데이터 부족 시 null) */
function smaAt(closes, n) {
  if (closes.length < n) return null;
  let sum = 0;
  for (let i = closes.length - n; i < closes.length; i++) sum += closes[i];
  return sum / n;
}

/* 지수이동평균 시리즈 (표준 2/(n+1) 계수, 첫 값은 SMA 시딩) */
function emaSeries(closes, n) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < n) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += closes[i];
  let ema = sum / n;
  out[n - 1] = ema;
  const k = 2 / (n + 1);
  for (let i = n; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/* RSI(Wilder 평활) 시리즈 — 기본 14일, 계산 불가 구간은 null */
function rsiSeries(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgGain = gain / n, avgLoss = loss / n;
  out[n] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/* MACD(12·26·9) — {macd[], signal[], hist[]} (계산 불가 구간은 null) */
function macdSeries(closes, fast = 12, slow = 26, sig = 9) {
  const emaF = emaSeries(closes, fast), emaS = emaSeries(closes, slow);
  const macd = closes.map((_, i) => (emaF[i] != null && emaS[i] != null ? emaF[i] - emaS[i] : null));
  const start = macd.findIndex((v) => v != null);
  const signal = new Array(closes.length).fill(null);
  if (start >= 0 && closes.length - start >= sig) {
    let sum = 0;
    for (let i = start; i < start + sig; i++) sum += macd[i];
    let ema = sum / sig;
    signal[start + sig - 1] = ema;
    const k = 2 / (sig + 1);
    for (let i = start + sig; i < closes.length; i++) {
      ema = macd[i] * k + ema * (1 - k);
      signal[i] = ema;
    }
  }
  const hist = macd.map((v, i) => (v != null && signal[i] != null ? v - signal[i] : null));
  return { macd, signal, hist };
}

/* 볼린저 밴드(기본 20일·2σ) — 마지막 시점 {mid, upper, lower, pctB, bandwidth} */
function bollingerLast(closes, n = 20, mult = 2) {
  if (closes.length < n) return null;
  const win = closes.slice(-n);
  const mid = win.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - mid) * (b - mid), 0) / n);
  const upper = mid + mult * sd, lower = mid - mult * sd;
  const last = closes[closes.length - 1];
  const pctB = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  return { mid, upper, lower, pctB, bandwidth: mid ? (upper - lower) / mid : 0 };
}

/* 볼린저 상·하단 시리즈(차트용) — {mid[], upper[], lower[]} */
function bollingerSeries(closes, n = 20, mult = 2) {
  const mid = smaSeries(closes, n);
  const upper = new Array(closes.length).fill(null), lower = new Array(closes.length).fill(null);
  for (let i = n - 1; i < closes.length; i++) {
    let sq = 0;
    for (let j = i - n + 1; j <= i; j++) sq += (closes[j] - mid[i]) * (closes[j] - mid[i]);
    const sd = Math.sqrt(sq / n);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

/* 일간수익률 표준편차(%) — 최근 window 거래일, 표본 표준편차(n-1). 데이터 부족 시 null */
function dailyReturnSigma(closes, window) {
  if (closes.length < window + 1) return null;
  const rets = [];
  for (let i = closes.length - window; i < closes.length; i++) rets.push((closes[i] / closes[i - 1] - 1) * 100);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1));
}

/* 52주(252거래일) 최고 종가 */
function high52(closes) {
  return closes.length ? Math.max(...closes.slice(-252)) : null;
}

/* 20일 위치: (현재가-20일 최저)/(20일 최고-최저) → 0~1. curPrice에 라이브가 대입 가능 */
function pos20d(closes, curPrice) {
  if (closes.length < 2) return null;
  const win = closes.slice(-20);
  const lo = Math.min(...win), hi = Math.max(...win);
  const last = curPrice != null ? curPrice : closes[closes.length - 1];
  if (hi === lo) return 0.5;
  return Math.min(1, Math.max(0, (last - lo) / (hi - lo)));
}

/* 연도별 MDD — [{year, mdd(음수 비율), days}] (연도 경계에서 낙폭 리셋 — 연간 MDD 분포용) */
function annualMDDs(dates, closes) {
  const out = [];
  let y = null, start = 0;
  for (let i = 0; i <= dates.length; i++) {
    const yr = i < dates.length ? dates[i].slice(0, 4) : null;
    if (yr !== y) {
      if (y != null && i - start >= 2) {
        const r = calcMDD(dates.slice(start, i), closes.slice(start, i));
        out.push({ year: y, mdd: r.mdd, days: i - start });
      }
      y = yr; start = i;
    }
  }
  return out;
}

/* 국소 피벗(저점/고점) 인덱스 — 좌우 k개 이웃보다 낮으면 저점, 높으면 고점 */
function findPivots(vals, k = 3) {
  const lows = [], highs = [];
  for (let i = k; i < vals.length - k; i++) {
    let isLow = true, isHigh = true;
    for (let j = i - k; j <= i + k; j++) {
      if (vals[j] < vals[i]) isLow = false;
      if (vals[j] > vals[i]) isHigh = false;
    }
    if (isLow) lows.push(i);
    if (isHigh) highs.push(i);
  }
  return { lows, highs };
}

/* RSI 다이버전스 감지 — 최근 lookback 거래일 내 마지막 두 가격 피벗의 방향과 RSI 방향 불일치.
   강세(bull): 가격 저점은 낮아지는데 RSI 저점은 높아짐 / 약세(bear): 가격 고점은 높아지는데 RSI 고점은 낮아짐.
   두 번째 피벗이 마지막 recentBars 거래일 이내일 때만 유효(오래된 다이버전스로 시그널 내지 않음). */
function detectRsiDivergence(closes, rsiArr, lookback = 90, k = 3, recentBars = 25) {
  const n = closes.length;
  const out = { bull: null, bear: null };
  if (n < 30) return out;
  const start = Math.max(0, n - lookback);
  const { lows, highs } = findPivots(closes.slice(start), k);
  const pick = (idxs) => {
    const abs = idxs.map((i) => start + i).filter((i) => rsiArr[i] != null);
    return abs.length >= 2 ? abs.slice(-2) : null;
  };
  const lowPair = pick(lows);
  if (lowPair && lowPair[1] >= n - recentBars &&
      closes[lowPair[1]] < closes[lowPair[0]] && rsiArr[lowPair[1]] > rsiArr[lowPair[0]]) {
    out.bull = { d1: lowPair[0], d2: lowPair[1] };
  }
  const highPair = pick(highs);
  if (highPair && highPair[1] >= n - recentBars &&
      closes[highPair[1]] > closes[highPair[0]] && rsiArr[highPair[1]] < rsiArr[highPair[0]]) {
    out.bear = { d1: highPair[0], d2: highPair[1] };
  }
  return out;
}

