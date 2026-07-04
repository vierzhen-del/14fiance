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
import re
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
DIVIDENDS_URL = "https://api.twelvedata.com/dividends"
API_KEY = os.environ.get("TWELVEDATA_API_KEY", "")
# 배당 폴백: Financial Modeling Prep (Secrets에 FMP_API_KEY 등록 시 활성화)
FMP_API_KEY = os.environ.get("FMP_API_KEY", "")
FMP_DIV_URL = "https://financialmodelingprep.com/stable/dividends"
# Twelve Data 무료 티어 레이트리밋(분당 8회)을 지키기 위한 요청 간 최소 대기 시간
REQUEST_INTERVAL_SEC = 8.0
DIV_DIR_NAME = "div"

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

# 국내 ETF 분배금(배당) 이력: 네이버 모바일 증권 "분석" 탭(서버 렌더링 HTML).
# 정식 API 없이, "배당락일" 표 아래 나오는 날짜·금액 텍스트를 정규식으로 읽는다.
# ("더보기"를 눌러도 추가 요청 없이 바로 펼쳐지는 것을 확인함 — 전체 이력이
#  이미 최초 HTML에 들어있다는 뜻이라 별도 페이지네이션 처리가 필요 없다.)
NAVER_STOCK_URL = "https://m.stock.naver.com/domestic/stock/{code}/analysis"
NAVER_STOCK_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
}
DIV_DATE_RE = re.compile(r"(\d{4})\D{0,3}(\d{2})\D{0,3}(\d{2})\D{0,20}?([\d,]+(?:\.\d+)?)\s*원")

# USD/KRW 일별 환율 (시뮬레이터의 통화 혼합 계산용). FRED 공개 CSV, 키 불필요.
FX_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXKOUS"
FX_DIR_NAME = "fx"


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


def fetch_dividends_us(symbol: str) -> dict | None:
    """미국 ETF의 배당 이력을 받아 {dates(오름차순), amounts}로 반환한다.

    1차: Twelve Data /dividends (무료 플랜에서는 403으로 막히는 경우 있음)
    2차: FMP_API_KEY가 설정돼 있으면 Financial Modeling Prep으로 폴백.
    둘 다 실패하면 None을 반환하고 수집 전체는 계속 진행한다 (배당은 부가 정보).
    """
    div = _dividends_twelvedata(symbol)
    if div is None and FMP_API_KEY:
        div = _dividends_fmp(symbol)
    return div


def _dividends_fmp(symbol: str) -> dict | None:
    url = f"{FMP_DIV_URL}?{urllib.parse.urlencode({'symbol': symbol, 'apikey': FMP_API_KEY})}"
    try:
        payload = http_get_json(url)
    except RuntimeError as err:
        print(f"  .. FMP dividends skipped for {symbol}: {err}")
        return None
    if not isinstance(payload, list):
        print(f"  .. FMP dividends skipped for {symbol}: {str(payload)[:120]}")
        return None
    pairs = []
    for e in payload:
        day = e.get("date") or ""
        try:
            amount = float(e.get("adjDividend") or e.get("dividend") or 0)
        except (TypeError, ValueError):
            continue
        if len(day) == 10 and amount > 0:
            pairs.append((day, round(amount, 6)))
    pairs.sort()
    if not pairs:
        return None
    return {
        "symbol": symbol,
        "count": len(pairs),
        "dates": [p[0] for p in pairs],
        "amounts": [p[1] for p in pairs],
    }


def _dividends_twelvedata(symbol: str) -> dict | None:
    params = {"symbol": symbol, "range": "full", "apikey": API_KEY}
    url = f"{DIVIDENDS_URL}?{urllib.parse.urlencode(params)}"
    try:
        payload = http_get_json(url)
    except RuntimeError as err:
        print(f"  .. dividends skipped for {symbol}: {err}")
        return None

    if payload.get("status") == "error":
        print(f"  .. dividends skipped for {symbol}: {payload.get('message')}")
        return None

    entries = payload.get("dividends") or []
    pairs = []
    for e in entries:
        day = e.get("ex_date") or ""
        try:
            amount = float(e.get("amount"))
        except (TypeError, ValueError):
            continue
        if len(day) == 10 and amount > 0:
            pairs.append((day, round(amount, 6)))
    pairs.sort()
    return {
        "symbol": symbol,
        "count": len(pairs),
        "dates": [p[0] for p in pairs],
        "amounts": [p[1] for p in pairs],
    }


def ttm_dividend(div: dict | None, last_date: str) -> float:
    """마지막 거래일 기준 직전 365일간 배당 합계."""
    if not div or not div["dates"]:
        return 0.0
    import datetime

    end = datetime.date.fromisoformat(last_date)
    start = (end - datetime.timedelta(days=365)).isoformat()
    total = sum(a for d, a in zip(div["dates"], div["amounts"]) if start < d <= last_date)
    return round(total, 6)


def parse_fred_csv(text: str) -> tuple[list[str], list[float]]:
    """FRED fredgraph.csv(DATE,VALUE) 응답을 (dates, rates)로 파싱한다.

    결측일은 값이 "."로 오므로 건너뛴다(사용처에서 직전 값으로 보간).
    """
    dates: list[str] = []
    rates: list[float] = []
    for line in text.splitlines()[1:]:  # 첫 줄은 헤더
        parts = line.strip().split(",")
        if len(parts) != 2 or len(parts[0]) != 10:
            continue
        try:
            rate = float(parts[1])
        except ValueError:
            continue  # "." (결측)
        if rate > 0:
            dates.append(parts[0])
            rates.append(round(rate, 4))
    return dates, rates


def fetch_fx_usdkrw() -> dict | None:
    """USD/KRW 일별 환율을 FRED에서 받아온다. 실패해도 전체 수집은 계속한다."""
    try:
        text = http_get_text(FX_URL)
    except RuntimeError as err:
        print(f"  .. fx skipped: {err}")
        return None
    dates, rates = parse_fred_csv(text)
    if len(dates) < 100:
        print(f"  .. fx skipped: too few rows ({len(dates)})")
        return None
    return {
        "pair": "USDKRW",
        "count": len(dates),
        "first": dates[0],
        "last": dates[-1],
        "dates": dates,
        "rates": rates,
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


def fetch_dividends_kr(symbol: str) -> dict | None:
    """국내 ETF 분배금 이력을 네이버 모바일 증권 분석 탭에서 가져온다 (best-effort).

    공식 API가 없어 "배당락일" 표 텍스트를 정규식으로 읽는 방식이라, 네이버가
    페이지 구조를 바꾸면 조용히 못 읽어올 수 있다 — 실패해도 가격 수집 전체는
    계속 진행한다(US 배당 수집과 동일한 관용도).
    """
    code = symbol[: -len(".KS")] if symbol.endswith(".KS") else symbol
    url = NAVER_STOCK_URL.format(code=code)
    try:
        text = http_get_text(url, headers=NAVER_STOCK_HEADERS)
    except RuntimeError as err:
        print(f"  .. kr dividends skipped for {symbol}: {err}")
        return None

    anchor = text.find("배당락일")
    if anchor < 0:
        return None  # 무분배 ETF 등 — 오류 아님

    end = text.find("세금", anchor)
    raw_window = text[anchor : end if end > anchor else anchor + 20000]
    # HTML 태그를 걷어내 "2026. 06. 12." "101원" 사이의 마크업 깊이에 상관없이
    # 정규식이 안정적으로 붙게 만든다
    window = re.sub(r"<[^>]+>", " ", raw_window)

    pairs = []
    seen = set()
    for m in DIV_DATE_RE.finditer(window):
        y, mo, d, amt_raw = m.groups()
        if not (1 <= int(mo) <= 12 and 1 <= int(d) <= 31):
            continue
        date = f"{y}-{mo}-{d}"
        if date in seen:
            continue
        try:
            amount = float(amt_raw.replace(",", ""))
        except ValueError:
            continue
        if amount <= 0:
            continue
        seen.add(date)
        pairs.append((date, round(amount, 6)))

    if not pairs:
        return None
    pairs.sort()
    return {
        "symbol": symbol,
        "count": len(pairs),
        "dates": [p[0] for p in pairs],
        "amounts": [p[1] for p in pairs],
    }


def main() -> int:
    if not API_KEY:
        print("!! TWELVEDATA_API_KEY 환경변수가 설정되지 않았습니다.")
        return 1

    etfs = json.loads(ETF_LIST.read_text(encoding="utf-8"))
    DATA_DIR.mkdir(exist_ok=True)
    div_dir = DATA_DIR / DIV_DIR_NAME
    div_dir.mkdir(exist_ok=True)
    fx_dir = DATA_DIR / FX_DIR_NAME
    fx_dir.mkdir(exist_ok=True)
    manifest = {"updated": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "us": [], "kr": []}
    failures = []

    print("fetching USD/KRW fx (FRED) ...")
    fx = fetch_fx_usdkrw()
    if fx is not None:
        (fx_dir / "USDKRW.json").write_text(
            json.dumps(fx, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"  ok: {fx['count']} rows {fx['first']} ~ {fx['last']}")

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

            div = fetch_dividends_us(symbol) if market == "us" else fetch_dividends_kr(symbol)
            time.sleep(interval)
            if div is not None:
                (div_dir / f"{symbol}.json").write_text(
                    json.dumps(div, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8",
                )

            out = DATA_DIR / f"{symbol}.json"
            out.write_text(
                json.dumps(series, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            entry = {
                "symbol": symbol,
                "name": etf["name"],
                "category": etf["category"],
                "currency": series["currency"],
                "first": series["first"],
                "last": series["last"],
                "count": series["count"],
            }
            ttm = ttm_dividend(div, series["last"])
            entry["ttmDividend"] = ttm
            last_close = series["closes"][-1]
            entry["dividendYield"] = round(ttm / last_close, 6) if last_close else 0.0
            manifest[market].append(entry)
            div_note = f", div {div['count']}건" if div else ""
            print(f"  ok: {series['count']} rows {series['first']} ~ {series['last']}{div_note}")

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
