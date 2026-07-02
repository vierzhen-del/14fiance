#!/usr/bin/env python3
"""Twelve Data에서 ETF 일별 종가를 수집해 data/*.json 으로 저장한다.

Yahoo Finance와 Stooq 모두 GitHub Actions 러너의 클라우드 IP를
봇으로 차단해 데이터를 받아올 수 없어, API 키 기반의 Twelve Data
(twelvedata.com)로 전환했다. 리포지토리 Secrets에 TWELVEDATA_API_KEY를
등록해야 동작한다 (무료 티어: 분당 8회, 일일 800회).
표준 라이브러리만 사용한다 (GitHub Actions 러너에서 의존성 설치 불필요).
사용법: TWELVEDATA_API_KEY=xxx python scripts/fetch_data.py
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ETF_LIST = ROOT / "scripts" / "etf_list.json"

API_URL = "https://api.twelvedata.com/time_series"
API_KEY = os.environ.get("TWELVEDATA_API_KEY", "")
# 무료 티어 레이트리밋(분당 8회)을 지키기 위한 요청 간 최소 대기 시간
REQUEST_INTERVAL_SEC = 8.0


def to_twelvedata_params(symbol: str) -> dict:
    """Yahoo Finance 표기(SPY, 069500.KS)를 Twelve Data 파라미터로 변환한다.

    Twelve Data는 KRX 상장 종목을 "symbol:KRX" 형태(콜론 결합)로
    요구한다. symbol/exchange를 별도 파라미터로 보내면 404가 난다.
    """
    if symbol.endswith(".KS"):
        return {"symbol": f"{symbol[: -len('.KS')]}:KRX"}
    return {"symbol": symbol}


def http_get_json(url: str, retries: int = 4) -> dict:
    delay = 2.0
    last_err = None
    for _ in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # noqa: BLE001
            last_err = err
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"fetch failed: {url}: {last_err}")


def fetch_symbol(symbol: str) -> dict | None:
    params = to_twelvedata_params(symbol)
    params.update({
        "interval": "1day",
        "outputsize": 5000,
        "order": "ASC",
        "apikey": API_KEY,
    })
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
        "currency": meta.get("currency") or "",
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

    # 한국 상장 ETF는 Twelve Data 무료 티어에 없어(404) 매번 재시도만 낭비하므로
    # 잠정 제외한다. etf_list.json의 kr 목록은 대안 소스가 정해지면 재사용한다.
    for market in ("us",):
        for etf in etfs[market]:
            symbol = etf["symbol"]
            print(f"fetching {symbol} ({etf['name']}) ...")
            try:
                series = fetch_symbol(symbol)
            except RuntimeError as err:
                print(f"  !! {err}")
                series = None
            time.sleep(REQUEST_INTERVAL_SEC)
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
    total = len(etfs["us"])
    return 1 if len(failures) > total / 2 else 0


if __name__ == "__main__":
    sys.exit(main())
