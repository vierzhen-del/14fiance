#!/usr/bin/env python3
"""워치리스트 시그널 텔레그램 알림 — 📡 시그널 탭과 동일한 5투표 종합등급을 계산해 발송.

앱(정적 사이트+APK)에는 서버가 없으므로 GitHub Actions 스케줄(.github/workflows/signal-alert.yml,
평일 2회: 16:05 KST 국내 마감 후 · 06:35 KST 미국 마감 후)로 실행한다.

지표 공식은 shared/myassets-utils.js와 동일(교차검증 완료): RSI14(Wilder)·MACD(12·26·9)·
볼린저(20일·2σ)·MA200 이격·RSI 다이버전스(피벗 k=3, lookback 90, 최근 25거래일) 5투표,
2개 이상 합의 시에만 매수/매도 판정(강매수/매수관심/홀드/매도검토/강매도).

환경변수:
  TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — 미설정 시 구성 안내만 남기고 정상 종료(발송 생략).
  ALERT_WATCHLIST — 콤마 구분 심볼(기본 "005930.KS,000660.KS,SOXL"). 저장소 변수로 관리.
  TWELVEDATA_API_KEY — 있으면 미국 종목 최신가 반영(없으면 주간 수집 종가 사용).
  FORCE_SUMMARY — 사용 안 함(항상 요약 발송 정책이라 동작 동일, workflow_dispatch 호환용).

직전 등급은 .alert_state.json(Actions 캐시 — 저장소에 커밋되지 않음)과 비교해 변화 시 🆕 표시.
메시지 본문은 시크릿 유무와 무관하게 로그에 출력되므로 시크릿 없이도 내용 검증 가능.
"""
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
STATE_PATH = os.path.join(ROOT, ".alert_state.json")
DEFAULT_WATCHLIST = "005930.KS,000660.KS,SOXL"
KST = timezone(timedelta(hours=9))

NAVER_BASIC_URL = "https://m.stock.naver.com/api/stock/{code}/basic"
NAVER_HEADERS = {
    # fetch_intraday_kr.py와 동일한 프로브 확인 헤더
    "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    "Referer": "https://m.stock.naver.com/",
}


def http_json(url, headers=None, timeout=15):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------- 지표 (shared/myassets-utils.js와 동일 공식) ----------

def sma_at(c, n):
    return sum(c[-n:]) / n if len(c) >= n else None


def rsi_series(c, n=14):
    out = [None] * len(c)
    if len(c) <= n:
        return out
    gain = loss = 0.0
    for i in range(1, n + 1):
        d = c[i] - c[i - 1]
        if d >= 0:
            gain += d
        else:
            loss -= d
    ag, al = gain / n, loss / n
    out[n] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(n + 1, len(c)):
        d = c[i] - c[i - 1]
        ag = (ag * (n - 1) + max(d, 0)) / n
        al = (al * (n - 1) + max(-d, 0)) / n
        out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def ema_series(c, n):
    out = [None] * len(c)
    if len(c) < n:
        return out
    e = sum(c[:n]) / n
    out[n - 1] = e
    k = 2 / (n + 1)
    for i in range(n, len(c)):
        e = c[i] * k + e * (1 - k)
        out[i] = e
    return out


def macd_hist(c, fast=12, slow=26, sig=9):
    ef, es = ema_series(c, fast), ema_series(c, slow)
    macd = [ef[i] - es[i] if ef[i] is not None and es[i] is not None else None for i in range(len(c))]
    start = next((i for i, v in enumerate(macd) if v is not None), -1)
    signal = [None] * len(c)
    if start >= 0 and len(c) - start >= sig:
        e = sum(macd[start:start + sig]) / sig
        signal[start + sig - 1] = e
        k = 2 / (sig + 1)
        for i in range(start + sig, len(c)):
            e = macd[i] * k + e * (1 - k)
            signal[i] = e
    hist = [macd[i] - signal[i] if macd[i] is not None and signal[i] is not None else None for i in range(len(c))]
    return hist


def bollinger_pct_b(c, n=20, mult=2):
    if len(c) < n:
        return None
    win = c[-n:]
    mid = sum(win) / n
    sd = math.sqrt(sum((x - mid) ** 2 for x in win) / n)
    upper, lower = mid + mult * sd, mid - mult * sd
    return 0.5 if upper == lower else (c[-1] - lower) / (upper - lower)


def pos20d(c):
    if len(c) < 2:
        return None
    win = c[-20:]
    lo, hi = min(win), max(win)
    return 0.5 if hi == lo else max(0.0, min(1.0, (c[-1] - lo) / (hi - lo)))


def find_pivots(vals, k=3):
    lows, highs = [], []
    for i in range(k, len(vals) - k):
        seg = vals[i - k:i + k + 1]
        if all(vals[i] <= x for x in seg):
            lows.append(i)
        if all(vals[i] >= x for x in seg):
            highs.append(i)
    return lows, highs


def detect_divergence(c, rsi, lookback=90, k=3, recent=25):
    n = len(c)
    out = {"bull": None, "bear": None}
    if n < 30:
        return out
    start = max(0, n - lookback)
    lows, highs = find_pivots(c[start:], k)

    def pick(idxs):
        a = [start + i for i in idxs if rsi[start + i] is not None]
        return a[-2:] if len(a) >= 2 else None

    lp = pick(lows)
    if lp and lp[1] >= n - recent and c[lp[1]] < c[lp[0]] and rsi[lp[1]] > rsi[lp[0]]:
        out["bull"] = lp
    hp = pick(highs)
    if hp and hp[1] >= n - recent and c[hp[1]] > c[hp[0]] and rsi[hp[1]] < rsi[hp[0]]:
        out["bear"] = hp
    return out


def detect_ma_cross(c, dates, fast, slow, window=5):
    """최근 window 거래일 내 골든/데드크로스 — 앱 detectCross와 동일."""
    def sma_series(vals, n):
        out = [None] * len(vals)
        s = 0.0
        for i, v in enumerate(vals):
            s += v
            if i >= n:
                s -= vals[i - n]
            if i >= n - 1:
                out[i] = s / n
        return out

    f, s = sma_series(c, fast), sma_series(c, slow)
    msgs = []
    for i in range(max(1, len(c) - window), len(c)):
        if None in (f[i], s[i], f[i - 1], s[i - 1]):
            continue
        if f[i - 1] <= s[i - 1] and f[i] > s[i]:
            msgs.append(f"🔔 골든크로스 MA{fast}×MA{slow} ({dates[i]})")
        if f[i - 1] >= s[i - 1] and f[i] < s[i]:
            msgs.append(f"☠️ 데드크로스 MA{fast}×MA{slow} ({dates[i]})")
    return msgs


# ---------- 최신가 반영 ----------

def fresh_price_kr(symbol):
    code = symbol[:-3] if symbol.endswith(".KS") else symbol
    data = http_json(NAVER_BASIC_URL.format(code=code), headers=NAVER_HEADERS)
    price = float(str(data.get("closePrice", "")).replace(",", "") or 0)
    return price if price > 0 else None


def fresh_price_us(symbol, api_key):
    if not api_key:
        return None
    url = f"https://api.twelvedata.com/quote?symbol={urllib.parse.quote(symbol)}&apikey={api_key}"
    data = http_json(url)
    try:
        price = float(data.get("close", 0))
    except (TypeError, ValueError):
        return None
    return price if price > 0 else None


def load_series(symbol, td_key):
    """수집 일별 종가 + (가능하면) 오늘 실시간가를 임시 봉으로 반영."""
    with open(os.path.join(DATA_DIR, f"{symbol}.json"), encoding="utf-8") as f:
        d = json.load(f)
    dates, closes = list(d["dates"]), list(d["closes"])
    currency = d.get("currency", "USD")
    live_applied = False
    try:
        live = fresh_price_kr(symbol) if symbol.endswith(".KS") else fresh_price_us(symbol, td_key)
    except Exception as e:  # 실시세 실패 → 수집 종가 폴백(치명 아님)
        print(f"  [{symbol}] 실시간가 조회 실패({e}) — 주간 수집 종가 사용")
        live = None
    today = datetime.now(KST).strftime("%Y-%m-%d")
    if live and today > dates[-1]:
        dates.append(today)
        closes.append(live)
        live_applied = True
    elif live and today == dates[-1]:
        closes[-1] = live
        live_applied = True
    return dates, closes, currency, live_applied


# ---------- 등급 계산 (앱 renderDetail과 동일 5투표) ----------

def grade_symbol(dates, closes):
    rsi = rsi_series(closes)
    r = rsi[-1]
    hist = macd_hist(closes)
    h, hp = hist[-1], hist[-2] if len(hist) >= 2 else None
    pct_b = bollinger_pct_b(closes)
    ma200 = sma_at(closes, 200)
    div = detect_divergence(closes, rsi)

    votes = []  # (이름, 방향, 설명)
    if r is not None:
        votes.append(("RSI14", 1 if r <= 30 else -1 if r >= 70 else 0, f"{r:.1f}"))
    if div["bull"]:
        votes.append(("다이버전스", 1, f"강세({dates[div['bull'][0]]}→{dates[div['bull'][1]]})"))
    elif div["bear"]:
        votes.append(("다이버전스", -1, f"약세({dates[div['bear'][0]]}→{dates[div['bear'][1]]})"))
    else:
        votes.append(("다이버전스", 0, "미감지"))
    if pct_b is not None:
        votes.append(("볼린저%B", 1 if pct_b <= 0.05 else -1 if pct_b >= 0.95 else 0, f"{pct_b*100:.0f}%"))
    if h is not None:
        v = 1 if (hp is not None and hp <= 0 < h) else -1 if (hp is not None and hp >= 0 > h) else 0
        votes.append(("MACD", v, f"{h:+.2f}"))
    if ma200 is not None:
        gap = closes[-1] / ma200 - 1
        votes.append(("MA200이격", 1 if gap <= -0.10 else -1 if gap >= 0.15 else 0, f"{gap*100:+.1f}%"))

    buy = sum(1 for _, v, _ in votes if v == 1)
    sell = sum(1 for _, v, _ in votes if v == -1)
    grade = ("🟢 강매수" if buy >= 3 else "🟢 매수관심" if buy >= 2
             else "🔴 강매도" if sell >= 3 else "🔴 매도검토" if sell >= 2 else "⏸ 홀드")
    crosses = detect_ma_cross(closes, dates, 5, 20) + detect_ma_cross(closes, dates, 20, 60)
    return grade, votes, crosses, pos20d(closes)


def zone_label(pos):
    if pos is None:
        return "―"
    if pos <= 0.3:
        return f"🟢 관심({pos*100:.0f}%)"
    if pos >= 0.75:
        return f"🔴 경계({pos*100:.0f}%)"
    return f"중립({pos*100:.0f}%)"


def main():
    watchlist = [s.strip() for s in (os.environ.get("ALERT_WATCHLIST") or DEFAULT_WATCHLIST).split(",") if s.strip()]
    td_key = os.environ.get("TWELVEDATA_API_KEY", "")

    # 이름 표시용 manifest
    names = {}
    try:
        with open(os.path.join(DATA_DIR, "manifest.json"), encoding="utf-8") as f:
            m = json.load(f)
        for e in m.get("us", []) + m.get("kr", []):
            names[e["symbol"]] = e.get("name", e["symbol"])
    except Exception:
        pass

    prev_state = {}
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, encoding="utf-8") as f:
                prev_state = json.load(f)
        except Exception:
            prev_state = {}

    now_kst = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")
    lines = [f"📡 <b>시그널 요약</b> · {now_kst}"]
    new_state, signal_count = {}, 0

    for sym in watchlist:
        try:
            dates, closes, currency, live = load_series(sym, td_key)
            grade, votes, crosses, pos = grade_symbol(dates, closes)
        except FileNotFoundError:
            lines.append(f"\n⚠️ <b>{names.get(sym, sym)}</b> — 데이터 없음(수집 목록에 추가 필요)")
            continue
        except Exception as e:
            lines.append(f"\n⚠️ <b>{names.get(sym, sym)}</b> — 계산 실패: {e}")
            continue

        new_state[sym] = grade
        changed = prev_state.get(sym) not in (None, grade)
        has_signal = "홀드" not in grade or crosses
        if has_signal or changed:
            signal_count += 1

        price = f"₩{closes[-1]:,.0f}" if currency == "KRW" else f"${closes[-1]:,.2f}"
        head = "🚨 " if has_signal else ""
        chg = f" 🆕 {prev_state.get(sym)}→변경" if changed else ""
        lines.append(f"\n{head}<b>{names.get(sym, sym)}</b> {price}{' (실시간)' if live else ' (주간종가)'}")
        lines.append(f"등급 <b>{grade}</b>{chg} · 20일 {zone_label(pos)}")
        lines.append(" · ".join(f"{n} {t}" for n, _, t in votes))
        for c in crosses:
            lines.append(c)

    lines.append(f"\n지표 2개 이상 합의 시에만 매수/매도 판정 · 참고용, 투자 조언 아님")
    message = "\n".join(lines)

    print("=" * 60)
    print(message.replace("<b>", "").replace("</b>", ""))
    print("=" * 60)
    print(f"시그널/변화 종목: {signal_count}건 (정책: 매일 요약 발송)")

    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(new_state, f, ensure_ascii=False, indent=1)

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat_id:
        print("\nℹ️ TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 미설정 — 발송 생략.")
        print("설정 방법: ① 텔레그램 @BotFather → /newbot 으로 봇 생성 → 토큰 복사")
        print("          ② @userinfobot 에게 아무 메시지 → 내 chat id 확인")
        print("          ③ GitHub 저장소 Settings → Secrets and variables → Actions 에")
        print("             TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 등록 후 이 워크플로 수동 실행으로 테스트")
        return 0

    payload = urllib.parse.urlencode({"chat_id": chat_id, "text": message, "parse_mode": "HTML"}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/sendMessage", data=payload)
    with urllib.request.urlopen(req, timeout=20) as resp:
        ok = json.loads(resp.read().decode()).get("ok")
    print("텔레그램 발송:", "✅ 성공" if ok else "❌ 실패")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
