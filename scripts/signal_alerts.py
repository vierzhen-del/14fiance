#!/usr/bin/env python3
"""워치리스트 종목의 종합 시그널 등급을 계산해 변경 시에만 Telegram으로 알린다.

지표 수식(RSI14/MACD/볼린저/다이버전스)과 투표·등급 판정 로직은
index.html / shared/myassets-utils.js의 프론트엔드 엔진과 동일하게 포팅했다
(divergenceSignal, votes 배열, buyN/sellN 임계값 — 두 곳 모두 같은 결과를 내야 함).

표준 라이브러리만 사용한다 (fetch_data.py와 동일 방침).
사용법: TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy python scripts/signal_alerts.py
        DRY_RUN=1 python scripts/signal_alerts.py   (발송 대신 stdout 출력)
"""
import json
import math
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ALERT_LIST = ROOT / "scripts" / "alert_list.json"
ETF_LIST = ROOT / "scripts" / "etf_list.json"
STATE_FILE = ROOT / "data" / "signal_state.json"

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
DRY_RUN = os.environ.get("DRY_RUN", "") == "1"

GRADE_LEVEL = {"강매수": 3, "매수관심": 2, "홀드": 0, "매도검토": -2, "강매도": -3}
GRADE_EMOJI = {"강매수": "🟢", "매수관심": "🟢", "홀드": "⏸", "매도검토": "🔴", "강매도": "🔴"}


def sma_at(closes, n):
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def ema_series(closes, n):
    out = [None] * len(closes)
    if len(closes) < n:
        return out
    ema = sum(closes[:n]) / n
    out[n - 1] = ema
    k = 2 / (n + 1)
    for i in range(n, len(closes)):
        ema = closes[i] * k + ema * (1 - k)
        out[i] = ema
    return out


def rsi_series(closes, n=14):
    out = [None] * len(closes)
    if len(closes) <= n:
        return out
    gain = loss = 0.0
    for i in range(1, n + 1):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            gain += d
        else:
            loss -= d
    avg_gain, avg_loss = gain / n, loss / n
    out[n] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(n + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (n - 1) + max(d, 0)) / n
        avg_loss = (avg_loss * (n - 1) + max(-d, 0)) / n
        out[i] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def macd_series(closes, fast=12, slow=26, sig=9):
    ema_f, ema_s = ema_series(closes, fast), ema_series(closes, slow)
    macd = [
        (ema_f[i] - ema_s[i]) if ema_f[i] is not None and ema_s[i] is not None else None
        for i in range(len(closes))
    ]
    start = next((i for i, v in enumerate(macd) if v is not None), -1)
    signal = [None] * len(closes)
    if start >= 0 and len(closes) - start >= sig:
        ema = sum(macd[start:start + sig]) / sig
        signal[start + sig - 1] = ema
        k = 2 / (sig + 1)
        for i in range(start + sig, len(closes)):
            ema = macd[i] * k + ema * (1 - k)
            signal[i] = ema
    hist = [
        (macd[i] - signal[i]) if macd[i] is not None and signal[i] is not None else None
        for i in range(len(closes))
    ]
    return macd, signal, hist


def bollinger_last(closes, n=20, mult=2):
    if len(closes) < n:
        return None
    win = closes[-n:]
    mid = sum(win) / n
    sd = math.sqrt(sum((c - mid) ** 2 for c in win) / n)
    upper, lower = mid + mult * sd, mid - mult * sd
    last = closes[-1]
    pct_b = 0.5 if upper == lower else (last - lower) / (upper - lower)
    return {"mid": mid, "upper": upper, "lower": lower, "pctB": pct_b}


def divergence_signal(closes, rsi_arr, lookback=60, pivot_k=3, recent_within=12):
    n = len(closes)
    if n < pivot_k * 2 + 2:
        return 0, "없음"
    start = max(pivot_k, n - lookback)
    lows, highs = [], []
    for i in range(start, n - pivot_k):
        if rsi_arr[i] is None:
            continue
        is_low = is_high = True
        for k in range(1, pivot_k + 1):
            if closes[i - k] <= closes[i] or closes[i + k] <= closes[i]:
                is_low = False
            if closes[i - k] >= closes[i] or closes[i + k] >= closes[i]:
                is_high = False
        if is_low:
            lows.append({"i": i, "price": closes[i], "rsi": rsi_arr[i]})
        if is_high:
            highs.append({"i": i, "price": closes[i], "rsi": rsi_arr[i]})
    last_idx = n - 1
    if len(lows) >= 2:
        a, b = lows[-2], lows[-1]
        if last_idx - b["i"] <= recent_within and b["price"] < a["price"] and b["rsi"] > a["rsi"]:
            return 1, "강세(저점: 가격↓·RSI↑)"
    if len(highs) >= 2:
        a, b = highs[-2], highs[-1]
        if last_idx - b["i"] <= recent_within and b["price"] > a["price"] and b["rsi"] < a["rsi"]:
            return -1, "약세(고점: 가격↑·RSI↓)"
    return 0, "없음"


def compute_signal(closes):
    """index.html의 votes/grade 로직과 동일 — 반환: (grade, votes[{name,v,text}])"""
    rsi_arr = rsi_series(closes, 14)
    rsi = rsi_arr[-1]
    macd, signal, hist = macd_series(closes)
    h = hist[-1]
    hp = hist[-2] if len(hist) >= 2 else None
    bb = bollinger_last(closes)
    ma200 = sma_at(closes, 200)
    cur = closes[-1]

    votes = []
    if rsi is not None:
        v = 1 if rsi <= 30 else -1 if rsi >= 70 else 0
        text = f"{rsi:.1f} {'과매도' if rsi <= 30 else '과열' if rsi >= 70 else '중립(30~70)'}"
        votes.append({"name": "RSI14", "v": v, "text": text})
    if bb is not None:
        pb = bb["pctB"]
        v = 1 if pb <= 0.05 else -1 if pb >= 0.95 else 0
        text = f"{pb * 100:.0f}% {'하단 접근' if pb <= 0.05 else '상단 접근' if pb >= 0.95 else '밴드 내'}"
        votes.append({"name": "볼린저 %B", "v": v, "text": text})
    if h is not None:
        v = 1 if (hp is not None and hp <= 0 and h > 0) else -1 if (hp is not None and hp >= 0 and h < 0) else 0
        state = "상향 전환" if v == 1 else "하향 전환" if v == -1 else ("상승 지속" if h >= 0 else "하락 지속")
        votes.append({"name": "MACD", "v": v, "text": f"히스토그램 {h:+.2f} {state}"})
    if ma200 is not None:
        gap = cur / ma200 - 1
        v = 1 if gap <= -0.10 else -1 if gap >= 0.15 else 0
        state = "과열권" if gap >= 0.15 else "과매도권" if gap <= -0.10 else "정상 범위"
        votes.append({"name": "MA200 이격", "v": v, "text": f"{gap * 100:+.1f}% {state}"})
    div_v, div_label = divergence_signal(closes, rsi_arr)
    votes.append({"name": "다이버전스", "v": div_v, "text": div_label})

    buy_n = sum(1 for x in votes if x["v"] == 1)
    sell_n = sum(1 for x in votes if x["v"] == -1)
    if buy_n >= 3:
        grade = "강매수"
    elif buy_n >= 2:
        grade = "매수관심"
    elif sell_n >= 3:
        grade = "강매도"
    elif sell_n >= 2:
        grade = "매도검토"
    else:
        grade = "홀드"
    return grade, votes, cur


def send_telegram(text):
    if DRY_RUN:
        print("--- DRY_RUN: would send ---")
        print(text)
        print("---")
        return
    if not BOT_TOKEN or not CHAT_ID:
        print("TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set, skip send", file=sys.stderr)
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = json.dumps({"chat_id": CHAT_ID, "text": text}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except urllib.error.URLError as e:
        print(f"Telegram send failed: {e}", file=sys.stderr)


def main():
    alert_cfg = json.loads(ALERT_LIST.read_text(encoding="utf-8"))
    symbols = alert_cfg.get("symbols", [])
    min_level = alert_cfg.get("min_level", 2)

    names = {}
    if ETF_LIST.exists():
        etf_list = json.loads(ETF_LIST.read_text(encoding="utf-8"))
        for region in ("us", "kr"):
            for item in etf_list.get(region, []):
                names[item["symbol"]] = item.get("name", item["symbol"])

    state = {}
    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))

    changed = False
    for symbol in symbols:
        data_path = DATA_DIR / f"{symbol}.json"
        if not data_path.exists():
            print(f"skip {symbol}: no data/{symbol}.json", file=sys.stderr)
            continue
        closes = json.loads(data_path.read_text(encoding="utf-8"))["closes"]
        if len(closes) < 30:
            continue
        grade, votes, cur = compute_signal(closes)
        prev = state.get(symbol, {}).get("grade")
        new_level = GRADE_LEVEL[grade]
        prev_level = GRADE_LEVEL.get(prev, 0)

        if grade != prev and (abs(new_level) >= min_level or abs(prev_level) >= min_level):
            name = names.get(symbol, symbol)
            prev_disp = f"{GRADE_EMOJI.get(prev, '⏸')}{prev}" if prev else "(최초)"
            vote_text = " · ".join(f"{v['name']} {v['text']}" for v in votes)
            msg = (
                f"📡 [{name}] 종합시그널 변경: {prev_disp} → {GRADE_EMOJI[grade]}{grade}\n"
                f"투표: {vote_text}\n"
                f"현재가 {cur}"
            )
            send_telegram(msg)

        state[symbol] = {"grade": grade, "updated": datetime.now(timezone.utc).isoformat()}
        changed = True

    if changed and not DRY_RUN:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
