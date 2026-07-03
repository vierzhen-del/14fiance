#!/usr/bin/env python3
"""ETF 일별 종가를 수집해 data/*.json 으로 저장한다.

- 미국 상장 ETF: Twelve Data API (twelvedata.com). 리포지토리 Secrets에
  TWELVEDATA_API_KEY 등록 필요 (무료 티어: 분당 8회, 일일 800회).
  Yahoo Finance·Stooq는 GitHub Actions 러너의 클라우드 IP를 차단해 사용 불가.
- 국내 상장 ETF: 네이버 금융 시세 API (siseJson.naver). 키 불필요.

표준 라이브러리만 사용한다 (GitHub Actions 러너에서 의존성 설치 불필요).
사용법: TWELVEDATA_API_KEY=xxx python scripts/fetch_data.py
"""
import ast
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ETF_LIST = ROOT / "scripts" / "etf_list.json"

API_URL = "https://api.twelvedata.com/time_series"
API_KEY = os.environ.get("TWELVEDATA_API_KEY", "")
# Twelve Data 무료 티어 레이트리밋(분당 8회)을 지키기 위한 요청 간 최소 대기 시간
REQUEST_INTERVAL_SEC = 8.0

NAVER_URL = (
    "https://api.finance.naver.com/siseJson.naver"
    "?symbol={code}&requestType=1&startTime=19900101&endTime={end}&timeframe=day"
)
NAVER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Referer": "https://finance.naver.com/",
}
NAVER_INTERVAL_SEC = 1.0


def http_get_text(url: str, headers: dict | None = None, retries: int = 4) -> str:
    delay = 2.0
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                try:
                    return raw.decode("utf-8")
                except UnicodeDecodeError:
                    return raw.decode("cp949", errors="replace")
        except urllib.error.HTTPError as err:
            # 404/400 같은 클라이언트 오류(4xx)는 재시도해도 성공하지 못하므로
            # 즉시 실패시킨다. 다만 429(레이트리밋)는 기다리면 풀리므로 재시도한다.
            if 400 <= err.code < 500 and err.code != 429:
                raise RuntimeError(f"fetch failed: {url}: {err}") from err
            last_err = err
        except Exception as err:  # noqa: BLE001
            last_err = err
        # 마지막 시도 뒤에는 대기하지 않는다 (불필요한 지연 제거)
        if attempt < retries - 1:
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"fetch failed: {url}: {last_err}")


def http_get_json(url: str) -> dict:
    return json.loads(http_get_text(url))


def fetch_symbol_us(symbol: str) -> dict | None:
    params = {
        "symbol": symbol,
        "interval": "1day",
        "outputsize": 5000,
        "order": "ASC",
        "apikey": API_KEY,
    }
    url = f"{API_URL}?{urllib.parse.urlencode(params)}"
    payload = http_get_json(url)

    if payload.get("status") == "error":
        print(f"  !! {symbol}: {payload.get('message')}")
        return None

    values = payload.get("values") or []
    if not values:
        print(f"  !! empty series for {symbol}")
        return None

    meta = payload.get("meta") or {}
    dates = [v["datetime"] for v in values]
    closes = [round(float(v["close"]), 4) for v in values]

    return {
        "symbol": symbol,
        "currency": meta.get("currency") or "USD",
        "first": dates[0],
        "last": dates[-1],
        "count": len(dates),
        "dates": dates,
        "closes": closes,
    }


def parse_naver_sise(text: str) -> tuple[list[str], list[float]]:
    """siseJson.naver 응답을 (dates, closes)로 파싱한다.

    응답은 작은따옴표를 쓰는 파이썬 리터럴 형태의 2차원 배열이다:
    [['날짜','시가','고가','저가','종가','거래량','외국인소진율'],
     ["20250102", 60000, ..., 60500, ...], ...]
    """
    rows = ast.literal_eval(text.strip())
    dates: list[str] = []
    closes: list[float] = []
    for row in rows[1:]:  # 첫 행은 헤더
        if not isinstance(row, (list, tuple)) or len(row) < 5:
            continue
        day, close = str(row[0]), row[4]
        if not isinstance(close, (int, float)) or len(day) != 8 or not day.isdigit():
            continue
        dates.append(f"{day[0:4]}-{day[4:6]}-{day[6:8]}")
        closes.append(round(float(close), 4))
    return dates, closes


def fetch_symbol_kr(symbol: str) -> dict | None:
    code = symbol[: -len(".KS")] if symbol.endswith(".KS") else symbol
    url = NAVER_URL.format(code=code, end=time.strftime("%Y%m%d", time.gmtime()))
    text = http_get_text(url, headers=NAVER_HEADERS)
    try:
        dates, closes = parse_naver_sise(text)
    except (ValueError, SyntaxError) as err:
        print(f"  !! parse failed for {symbol}: {err}: {text[:120]!r}")
        return None
    if len(dates) < 2:
        print(f"  !! empty series for {symbol}: {text[:120]!r}")
        return None

    return {
        "symbol": symbol,
        "currency": "KRW",
        "first": dates[0],
        "last": dates[-1],
        "count": len(dates),
        "dates": dates,
        "closes": closes,
    }


def main() -> int:
    if not API_KEY:
        print("!! TWELVEDATA_API_KEY 환경변수가 설정되지 않았습니다.")
        return 1

    etfs = json.loads(ETF_LIST.read_text(encoding="utf-8"))
    DATA_DIR.mkdir(exist_ok=True)
    manifest = {"updated": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "us": [], "kr": []}
    failures = []

    fetchers = {"us": (fetch_symbol_us, REQUEST_INTERVAL_SEC), "kr": (fetch_symbol_kr, NAVER_INTERVAL_SEC)}
    for market in ("us", "kr"):
        fetch, interval = fetchers[market]
        for etf in etfs[market]:
            symbol = etf["symbol"]
            print(f"fetching {symbol} ({etf['name']}) ...")
            try:
                series = fetch(symbol)
            except RuntimeError as err:
                print(f"  !! {err}")
                series = None
            time.sleep(interval)
            if series is None:
                failures.append(symbol)
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
                    "currency": series["currency"],
                    "first": series["first"],
                    "last": series["last"],
                    "count": series["count"],
                }
            )
            print(f"  ok: {series['count']} rows {series['first']} ~ {series['last']}")

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
