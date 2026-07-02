#!/usr/bin/env python3
"""Stooq에서 ETF 일별 종가를 수집해 data/*.json 으로 저장한다.

Yahoo Finance는 GitHub Actions 러너의 공유 IP 대역을 차단(HTTP 429)해
데이터를 받아올 수 없어, 클라우드 CI 환경에서도 안정적으로 동작하는
Stooq CSV API로 전환했다.
표준 라이브러리만 사용한다 (GitHub Actions 러너에서 의존성 설치 불필요).
사용법: python scripts/fetch_data.py
"""
import csv
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ETF_LIST = ROOT / "scripts" / "etf_list.json"

CSV_URL = "https://stooq.com/q/d/l/?s={symbol}&i=d"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
}
CURRENCY_BY_MARKET = {"us": "USD", "kr": "KRW"}


def to_stooq_symbol(symbol: str) -> str:
    """Yahoo Finance 표기(SPY, 069500.KS)를 Stooq 표기(spy.us, 069500.kr)로 변환한다."""
    if symbol.endswith(".KS"):
        return symbol[: -len(".KS")].lower() + ".kr"
    return symbol.lower() + ".us"


def http_get_text(url: str, retries: int = 4) -> str:
    delay = 2.0
    last_err = None
    for _ in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read().decode("utf-8")
        except Exception as err:  # noqa: BLE001
            last_err = err
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"fetch failed: {url}: {last_err}")


def fetch_symbol(symbol: str, market: str) -> dict | None:
    stooq_symbol = to_stooq_symbol(symbol)
    text = http_get_text(CSV_URL.format(symbol=stooq_symbol))
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "Close" not in reader.fieldnames:
        print(f"  !! no data for {symbol} (stooq={stooq_symbol}): {text[:120]!r}")
        return None

    dates, values = [], []
    for row in reader:
        date, close = row.get("Date"), row.get("Close")
        if not date or not close:
            continue
        dates.append(date)
        values.append(round(float(close), 4))

    if not dates:
        print(f"  !! empty series for {symbol} (stooq={stooq_symbol})")
        return None

    return {
        "symbol": symbol,
        "stooqSymbol": stooq_symbol,
        "currency": CURRENCY_BY_MARKET[market],
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

    for market in ("us", "kr"):
        for etf in etfs[market]:
            symbol = etf["symbol"]
            print(f"fetching {symbol} ({etf['name']}) ...")
            try:
                series = fetch_symbol(symbol, market)
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
                    "stooqSymbol": series["stooqSymbol"],
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
