// Run: node --test shared/myassets-utils.test.js
// No new dependency -- uses Node's built-in test runner (node:test), matching
// this repo's "pure stdlib, no external deps" pattern (see scripts/fetch_data.py).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "myassets-utils.js"), "utf8");
const marker = "function divergenceSignal";
const start = src.indexOf(marker);
const end = src.indexOf("\n}\n", start) + 3;
// eslint-disable-next-line no-eval
eval(src.slice(start, end));

function buildPivot(base, dipIndex, dipValue, arr) {
  for (let i = dipIndex - 5; i <= dipIndex + 5; i++) arr[i] = base - (5 - Math.abs(i - dipIndex)) * 2;
  arr[dipIndex] = dipValue;
}

test("divergenceSignal detects bullish divergence (price lower low, RSI higher low)", () => {
  const n = 40;
  const closes = new Array(n).fill(100);
  const rsi = new Array(n).fill(50);
  buildPivot(100, 10, 90, closes);
  rsi[10] = 25;
  for (let i = 8; i <= 12; i++) if (i !== 10) rsi[i] = 25 + Math.abs(i - 10) * 3;
  buildPivot(95, 30, 85, closes);
  rsi[30] = 35;
  for (let i = 28; i <= 32; i++) if (i !== 30) rsi[i] = 35 + Math.abs(i - 30) * 3;

  const r = divergenceSignal(closes, rsi, { lookback: 60, pivotK: 3, recentWithin: 12 });
  assert.equal(r.v, 1);
});

test("divergenceSignal detects bearish divergence (price higher high, RSI lower high)", () => {
  const n = 40;
  const closes = new Array(n).fill(100);
  const rsi = new Array(n).fill(50);
  for (let i = 5; i <= 15; i++) closes[i] = 100 + (5 - Math.abs(i - 10)) * 2;
  closes[10] = 110;
  rsi[10] = 75;
  for (let i = 8; i <= 12; i++) if (i !== 10) rsi[i] = 75 - Math.abs(i - 10) * 3;
  for (let i = 25; i <= 35; i++) closes[i] = 105 + (5 - Math.abs(i - 30)) * 2;
  closes[30] = 115;
  rsi[30] = 65;
  for (let i = 28; i <= 32; i++) if (i !== 30) rsi[i] = 65 - Math.abs(i - 30) * 3;

  const r = divergenceSignal(closes, rsi, { lookback: 60, pivotK: 3, recentWithin: 12 });
  assert.equal(r.v, -1);
});

test("divergenceSignal returns 0 for flat/no pivots", () => {
  const n = 40;
  const closes = new Array(n).fill(100).map((v, i) => v + Math.sin(i) * 0.1);
  const rsi = new Array(n).fill(50);
  const r = divergenceSignal(closes, rsi, { lookback: 60, pivotK: 3, recentWithin: 12 });
  assert.equal(r.v, 0);
});

test("divergenceSignal ignores a stale pivot outside recentWithin", () => {
  const n = 60;
  const closes = new Array(n).fill(100);
  const rsi = new Array(n).fill(50);
  buildPivot(100, 10, 90, closes);
  rsi[10] = 25;
  for (let i = 8; i <= 12; i++) if (i !== 10) rsi[i] = 25 + Math.abs(i - 10) * 3;
  buildPivot(95, 30, 85, closes);
  rsi[30] = 35;
  for (let i = 28; i <= 32; i++) if (i !== 30) rsi[i] = 35 + Math.abs(i - 30) * 3;
  // pivots end at index 30, but series continues flat to index 59 (n-1=59, 59-30=29 > recentWithin=12)
  const r = divergenceSignal(closes, rsi, { lookback: 60, pivotK: 3, recentWithin: 12 });
  assert.equal(r.v, 0);
});
