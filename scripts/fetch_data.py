#!/usr/bin/env python3
"""Yahoo Finance에서 ETF 일별 수정종가를 수집해 data/*.json 으로 저장한다.

표준 라이브러리만 사용한다 (GitHub Actions 러너에서 의존성 설치 불필요).
사용법: python scripts/fetch_data.py
"""
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ETF_LIST = ROOT / "scripts" / "etf_list.json"

CONSENT_URL = "https://fc.yahoo.com"
CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb"
CHART_URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    "?period1=0&period2=9999999999&interval=1d"
    "&includeAdjustedClose=true&events=div%7Csplit&crumb={crumb}"
)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

COOKIE_JAR = http.cookiejar.CookieJar()
OPENER = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(COOKIE_JAR))


def get_crumb() -> str:
    """Yahoo가 429로 차단하는 것을 피하기 위해 쿠키 동의 + crumb 세션을 미리 받아온다.

    fc.yahoo.com은 의도적으로 404를 응답하지만 필요한 쿠키는 그 응답에
    실려 온다 (알려진 Yahoo Finance API 동작). 쿠키는 이미 OPENER의
    쿠키jar에 기록되므로 이 404는 무시하고 넘어간다.
    """
    req = urllib.request.Request(CONSENT_URL, headers=HEADERS)
    try:
        with OPENER.open(req, timeout=30):
            pass
    except urllib.error.HTTPError:
        pass
    req = urllib.request.Request(CRUMB_URL, headers=HEADERS)
    with OPENER.open(req, timeout=30) as resp:
        return resp.read().decode("utf-8").strip()


def http_get_json(url: str, retries: int = 4) -> dict:
    delay = 2.0
    last_err = None
    for _ in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with OPENER.open(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # noqa: BLE001
            last_err = err
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"fetch failed: {url}: {last_err}")


def fetch_symbol(symbol: str, crumb: str) -> dict | None:
    payload = http_get_json(CHART_URL.format(symbol=symbol, crumb=crumb))
    result = (payload.get("chart") or {}).get("result")
    if not result:
        print(f"  !! no data for {symbol}: {payload.get('chart', {}).get('error')}")
        return None
    result = result[0]
    meta = result.get("meta") or {}
    timestamps = result.get("timestamp") or []
    indicators = result.get("indicators") or {}
    quote = (indicators.get("quote") or [{}])[0]
    adj = (indicators.get("adjclose") or [{}])[0].get("adjclose")
    closes = adj if adj else quote.get("close")
    if not timestamps or not closes:
        print(f"  !! empty series for {symbol}")
        return None

    tz_offset = meta.get("gmtoffset", 0)
    dates, values = [], []
    for ts, close in zip(timestamps, closes):
        if close is None:
            continue
        day = time.strftime("%Y-%m-%d", time.gmtime(ts + tz_offset))
        # 같은 날짜 중복(장중 스냅샷 등)은 마지막 값으로 덮어쓴다
        if dates and dates[-1] == day:
            values[-1] = round(float(close), 4)
            continue
        dates.append(day)
        values.append(round(float(close), 4))

    return {
        "symbol": symbol,
        "yahooName": meta.get("longName") or meta.get("shortName") or "",
        "currency": meta.get("currency") or "",
        "first": dates[0],
        "last": dates[-1],
        "count": len(dates),
        "dates": dates,
        "closes": values,
    }


def main() -> int:
    etfs = json.loads(ETF_LIST.read_text(encoding="utf-8"))
    DATA_DIR.mkdir(exist_ok=True)
    manifest = {"updated": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "us": [], "kr": []}
    failures = []

    print("negotiating Yahoo session (cookie + crumb) ...")
    crumb = get_crumb()

    for market in ("us", "kr"):
        for etf in etfs[market]:
            symbol = etf["symbol"]
            print(f"fetching {symbol} ({etf['name']}) ...")
            try:
                series = fetch_symbol(symbol, crumb)
            except RuntimeError as err:
                print(f"  !! {err}")
                series = None
            if series is None:
                failures.append(symbol)
                time.sleep(1.0)
                continue
            out = DATA_DIR / f"{symbol}.json"
            out.write_text(
                json.dumps(series, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            manifest[market].append(
                {
                    "symbol": symbol,
                    "name": etf["name"],
                    "category": etf["category"],
                    "yahooName": series["yahooName"],
                    "currency": series["currency"],
                    "first": series["first"],
                    "last": series["last"],
                    "count": series["count"],
                }
            )
            print(f"  ok: {series['count']} rows {series['first']} ~ {series['last']}")
            time.sleep(1.0)

    (DATA_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"done. success={len(manifest['us']) + len(manifest['kr'])}, failed={failures or 'none'}")
    # 일부 실패는 허용하되 절반 이상 실패하면 에러로 처리
    total = len(etfs["us"]) + len(etfs["kr"])
    return 1 if len(failures) > total / 2 else 0


if __name__ == "__main__":
    sys.exit(main())
