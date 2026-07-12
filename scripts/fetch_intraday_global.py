#!/usr/bin/env python3
"""트레이딩 대시보드(realtime-trading/) 웹 모바일 모드용 글로벌 시세를 latest_global.json으로 저장한다.

fetch_intraday_kr.py(국내 전 종목 → live 브랜치)와 같은 구조로, intraday-global.yml이
30분 주기로 실행해 전용 `live-trading` 브랜치에 단일 커밋으로 force-push 한다
(live 브랜치는 latest_kr.json 전용 — 루트 CLAUDE.md 규칙에 따라 파일을 섞지 않는다).
대시보드의 mobile 모드(realtime-trading/public/mobile-feeds.js)가 raw URL로 읽는다.

수집 대상은 국내 파이프라인이 못 다루는 것들이다:
  - KOSPI 지수: 네이버 모바일 증권 지수 basic API (국내 파이프라인은 개별 종목만 수집)
  - 나스닥100 선물(NQ=F)·필라델피아 반도체지수(^SOX)·SOXX: Yahoo chart API
    (realtime-trading/server/feeds/yahoo.js와 동일 엔드포인트, 지연 시세)

latest_kr.json과 달리 prices 값은 {price, change, changePct} 객체다(등락 표시용).
실패한 심볼은 건너뛰고 절반 이상 실패 시에만 에러로 처리한다.

사용법: python scripts/fetch_intraday_global.py [출력경로]
"""
import json
import sys
import time
from pathlib import Path

from fetch_data import NAVER_STOCK_HEADERS, http_get_text

NAVER_INDEX_URL = "https://m.stock.naver.com/api/index/{code}/basic"
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1m&range=1d"
YAHOO_HEADERS = {"User-Agent": "Mozilla/5.0 (realtime-trading dashboard)"}
INTERVAL_SEC = 0.4

NAVER_INDEXES = {"KOSPI": "KOSPI"}  # 출력 키 → 네이버 지수 코드
YAHOO_SYMBOLS = ["NQ=F", "^SOX", "SOXX"]  # 출력 키 == Yahoo 심볼


def _num(value) -> float | None:
    try:
        n = float(str(value).replace(",", ""))
        return n if n == n else None  # NaN 방지
    except (TypeError, ValueError):
        return None


def fetch_naver_index(code: str) -> dict | None:
    payload = json.loads(http_get_text(NAVER_INDEX_URL.format(code=code), headers=NAVER_STOCK_HEADERS, retries=2))
    price = _num(payload.get("closePrice"))
    if price is None or price <= 0:
        return None
    change = _num(payload.get("compareToPreviousClosePrice"))
    change_pct = _num(payload.get("fluctuationsRatio"))
    # 하락 방향 코드(4·5)면 부호 보정 — 네이버가 음수 문자열을 안 줄 때 대비
    direction = (payload.get("compareToPreviousPrice") or {}).get("code")
    if direction in ("4", "5"):
        change = -abs(change) if change is not None else None
        change_pct = -abs(change_pct) if change_pct is not None else None
    return {"price": price, "change": change, "changePct": change_pct}


def fetch_yahoo(symbol: str) -> dict | None:
    from urllib.parse import quote

    payload = json.loads(http_get_text(YAHOO_CHART_URL.format(symbol=quote(symbol)), headers=YAHOO_HEADERS, retries=2))
    meta = ((payload.get("chart") or {}).get("result") or [{}])[0].get("meta") or {}
    price = _num(meta.get("regularMarketPrice"))
    if price is None:
        return None
    prev = _num(meta.get("chartPreviousClose")) or _num(meta.get("previousClose"))
    change = price - prev if prev is not None else None
    change_pct = (change / prev) * 100 if (change is not None and prev) else None
    return {"price": price, "change": change, "changePct": change_pct}


def main() -> int:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("latest_global.json")

    prices: dict[str, dict] = {}
    total = len(NAVER_INDEXES) + len(YAHOO_SYMBOLS)

    for key, code in NAVER_INDEXES.items():
        try:
            quote_data = fetch_naver_index(code)
            if quote_data:
                prices[key] = quote_data
        except (RuntimeError, ValueError, TypeError) as err:
            print(f"  .. {key} skipped: {err}")
        time.sleep(INTERVAL_SEC)

    for symbol in YAHOO_SYMBOLS:
        try:
            quote_data = fetch_yahoo(symbol)
            if quote_data:
                prices[symbol] = quote_data
        except (RuntimeError, ValueError, TypeError) as err:
            print(f"  .. {symbol} skipped: {err}")
        time.sleep(INTERVAL_SEC)

    # KST(UTC+9) 표기 — 대시보드 타일 source에 그대로 노출된다
    kst = time.gmtime(time.time() + 9 * 3600)
    result = {
        "updated": time.strftime("%Y-%m-%d %H:%M KST", kst),
        "count": len(prices),
        "prices": prices,
    }
    out_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"done. {len(prices)}/{total} quotes -> {out_path}")
    return 1 if len(prices) < total / 2 else 0


if __name__ == "__main__":
    sys.exit(main())
