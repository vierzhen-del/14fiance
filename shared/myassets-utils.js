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

function fmtDate(d) { return d; }

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} 불러오기 실패 (${res.status})`);
  return res.json();
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
        ${areaPath ? `<path class="dd-area" d="${areaPath}"/>` : ""}
        <path class="${mode === "drawdown" ? "dd-line" : "price-line"}" d="${path}"/>
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
  function onLeave() { hoverLayer.style.display = "none"; tooltip.style.opacity = "0"; }

  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerleave", onLeave);
}

function trailingReturnAnnualized(dates, closes, months) {
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
  const periodReturn = lastClose / startClose - 1;
  const annualized = Math.pow(1 + periodReturn, 12 / months) - 1;
  // 단기(1~3개월) 등락을 그대로 연율화하면 비현실적으로 큰 값이 나올 수 있어 합리적 범위로 제한
  return Math.max(-0.7, Math.min(1.5, annualized));
}

const ACCOUNT_TYPES = [
  "삼성_DC", "삼성_연금", "삼성_연금저축(세금미공제)", "삼성_IRP", "삼성_일반", "삼성_외화",
  "KB_일반", "KB_ISA", "신한_일반",
];

function accountOptionsHTML(selected) {
  let html = `<option value="" ${!selected ? "selected" : ""}>계좌 미지정</option>`;
  // 가져오기 데이터에 목록 밖 계좌명(예: 삼성_DC)이 있어도 그대로 보존한다 —
  // 조용히 "계좌 미지정"으로 빠지면 계좌별 합계를 시트와 비교할 수 없게 됨
  if (selected && !ACCOUNT_TYPES.includes(selected)) {
    html += `<option value="${selected}" selected>${selected}</option>`;
  }
  for (const acc of ACCOUNT_TYPES) {
    html += `<option value="${acc}" ${acc === selected ? "selected" : ""}>${acc}</option>`;
  }
  return html;
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
