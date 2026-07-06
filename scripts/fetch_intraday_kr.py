#!/usr/bin/env python3
"""국내 상장 종목(ETF·개별주)의 현재가만 빠르게 수집해 latest_kr.json으로 저장한다.

주간 전체 수집(fetch_data.py)과 별개로, 국내 장중(09:00~15:30 KST) 30분 주기
GitHub Actions(intraday-kr.yml)에서 실행된다. 결과는 개발 브랜치가 아니라 전용
`live` 브랜치에 단일 커밋으로 force-push 되고(이력 오염 방지), 사이트의
"🔄 최신시세" 옵션이 raw.githubusercontent.com 으로 이 파일을 읽는다.

네이버 모바일 증권 basic API(종목당 1콜)를 사용한다 — ETF·개별주 모두 동일
엔드포인트로 동작함을 확인(2026-07-06 프로브). 실패한 종목은 건너뛰고(해당
종목은 사이트가 주간 수집 종가로 폴백) 절반 이상 실패 시에만 에러로 처리한다.

사용법: python scripts/fetch_intraday_kr.py [출력경로]
"""
import json
import sys
import time
from pathlib import Path

from fetch_data import ETF_LIST, NAVER_STOCK_HEADERS, http_get_text

BASIC_URL = "https://m.stock.naver.com/api/stock/{code}/basic"
INTERVAL_SEC = 0.4


def fetch_price(symbol: str) -> float | None:
    code = symbol[: -len(".KS")] if symbol.endswith(".KS") else symbol
    try:
        payload = json.loads(http_get_text(BASIC_URL.format(code=code), headers=NAVER_STOCK_HEADERS, retries=2))
        price = float(str(payload.get("closePrice", "")).replace(",", ""))
        return price if price > 0 else None
    except (RuntimeError, ValueError, TypeError) as err:
        print(f"  .. {symbol} skipped: {err}")
        return None


def main() -> int:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("latest_kr.json")
    etfs = json.loads(ETF_LIST.read_text(encoding="utf-8"))
    symbols = [e["symbol"] for e in etfs["kr"]]

    prices: dict[str, float] = {}
    for symbol in symbols:
        price = fetch_price(symbol)
        if price is not None:
            prices[symbol] = price
        time.sleep(INTERVAL_SEC)

    # KST(UTC+9) 표기 — 사이트 배지에 그대로 노출된다
    kst = time.gmtime(time.time() + 9 * 3600)
    result = {
        "updated": time.strftime("%Y-%m-%d %H:%M KST", kst),
        "count": len(prices),
        "prices": prices,
    }
    out_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"done. {len(prices)}/{len(symbols)} prices -> {out_path}")
    return 1 if len(prices) < len(symbols) / 2 else 0


if __name__ == "__main__":
    sys.exit(main())
