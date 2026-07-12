const MAX_POINTS = 120; // 타일당 스파크라인 보관 포인트 수

const tiles = new Map(); // id -> { el, priceEl, deltaEl, sourceEl, canvas, history: [{price, ts}] }
const grid = document.getElementById("grid");
const connEl = document.getElementById("conn");

// 지수는 단위 없이 소수 2자리, 통화는 KRW 정수 / USD 소수 2자리
const fmt = (tile) =>
  new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: tile.isIndex ? 2 : 0,
    maximumFractionDigits: tile.isIndex || tile.currency !== "KRW" ? 2 : 0,
  });
const unit = (tile) => (tile.isIndex ? "" : tile.currency === "KRW" ? " 원" : " USD");

function createTile(sym) {
  const el = document.createElement("section");
  el.className = "tile";
  el.innerHTML = `
    <div class="head">
      <span class="name">${sym.name}</span>
      <span class="source"></span>
    </div>
    <div class="price waiting">시세 대기 중…</div>
    <div class="delta flat"></div>
    <canvas height="44"></canvas>`;
  grid.appendChild(el);
  const tile = {
    el,
    priceEl: el.querySelector(".price"),
    deltaEl: el.querySelector(".delta"),
    sourceEl: el.querySelector(".source"),
    canvas: el.querySelector("canvas"),
    currency: sym.currency,
    isIndex: Boolean(sym.isIndex),
    history: [],
  };
  attachSparklineHover(tile);
  tiles.set(sym.id, tile);
}

function applyQuote(q) {
  const tile = tiles.get(q.id);
  if (!tile) return;
  const nf = fmt(tile);

  tile.priceEl.classList.remove("waiting");
  tile.priceEl.textContent = `${nf.format(q.price)}${unit(tile)}`;
  tile.sourceEl.textContent = q.source;

  if (q.change != null && q.changePct != null) {
    const dir = q.change > 0 ? "up" : q.change < 0 ? "down" : "flat";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "―";
    tile.deltaEl.className = `delta ${dir}`;
    tile.deltaEl.textContent = `${arrow} ${nf.format(Math.abs(q.change))} (${Math.abs(q.changePct).toFixed(2)}%)`;
  }

  const last = tile.history[tile.history.length - 1];
  if (!last || last.price !== q.price) {
    tile.history.push({ price: q.price, ts: q.ts });
    if (tile.history.length > MAX_POINTS) tile.history.shift();
    drawSparkline(tile);
    tile.el.classList.remove("flash");
    void tile.el.offsetWidth; // 애니메이션 재시작
    tile.el.classList.add("flash");
  }
}

function drawSparkline(tile) {
  const canvas = tile.canvas;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const pts = tile.history;
  if (pts.length < 2) return;
  const prices = pts.map((p) => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const pad = 3;
  const x = (i) => (i / (pts.length - 1)) * (w - pad * 2) + pad;
  const y = (p) => h - pad - ((p - min) / span) * (h - pad * 2);

  const style = getComputedStyle(document.documentElement);
  ctx.strokeStyle = style.getPropertyValue("--spark").trim();
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(x(i), y(p.price)) : ctx.lineTo(x(i), y(p.price))));
  ctx.stroke();
}

// 스파크라인 호버: 가장 가까운 포인트의 가격/시각 툴팁
function attachSparklineHover(tile) {
  let tip = null;
  tile.canvas.addEventListener("mousemove", (e) => {
    const pts = tile.history;
    if (pts.length < 2) return;
    const rect = tile.canvas.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const i = Math.round(ratio * (pts.length - 1));
    const p = pts[Math.max(0, Math.min(pts.length - 1, i))];
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tooltip";
      document.body.appendChild(tip);
    }
    const time = new Date(p.ts).toLocaleTimeString("ko-KR");
    tip.textContent = `${fmt(tile).format(p.price)} · ${time}`;
    tip.style.left = `${e.clientX + 12}px`;
    tip.style.top = `${e.clientY - 28}px`;
  });
  tile.canvas.addEventListener("mouseleave", () => {
    tip?.remove();
    tip = null;
  });
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    connEl.dataset.state = "open";
    connEl.textContent = "실시간 연결됨";
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "snapshot") msg.quotes.forEach(applyQuote);
    else if (msg.type === "quote") applyQuote(msg.quote);
  };
  ws.onclose = () => {
    connEl.dataset.state = "closed";
    connEl.textContent = "연결 끊김 — 재접속 중…";
    setTimeout(connect, 3000);
  };
}

async function init() {
  const symbols = await fetch("/api/symbols").then((r) => r.json());
  symbols.forEach(createTile);
  connect();
}

init();
