#!/usr/bin/env python3
"""임시 프로브: 개별 종목(삼성전자/SK하이닉스)도 기존 네이버 파이프라인으로
가격·배당 조회가 되는지 확인한다. 데이터 파일을 쓰지 않고 stdout에만 출력.
확인 후 삭제 예정(영구 스크립트 아님).
"""
import json
import time

from fetch_data import (
    NAVER_STOCK_HEADERS,
    fetch_dividend_summary_kr,
    fetch_symbol_kr,
    http_get_text,
)

CANDIDATES = ["005930", "000660"]  # 삼성전자, SK하이닉스


def main() -> None:
    for code in CANDIDATES:
        print(f"=== {code} ===")
        try:
            series = fetch_symbol_kr(code)
            if series:
                print(f"  price ok: count={series['count']} last={series['last']} close={series['closes'][-1]}")
            else:
                print("  price: empty/None")
        except Exception as err:  # noqa: BLE001
            print(f"  price FAILED: {err}")
        time.sleep(1.0)

        try:
            summary = fetch_dividend_summary_kr(code)
            print(f"  etfAnalysis dividend summary: {summary}")
        except Exception as err:  # noqa: BLE001
            print(f"  etfAnalysis FAILED: {err}")
        time.sleep(1.0)

        # 일반 종목용 배당 정보가 있는지 다른 네이버 모바일 API도 확인
        for path in ["integration", "basic", "finance/dividend"]:
            url = f"https://m.stock.naver.com/api/stock/{code}/{path}"
            try:
                text = http_get_text(url, headers=NAVER_STOCK_HEADERS)
                print(f"  [{path}] ok, len={len(text)}, sample={text[:300]!r}")
            except Exception as err:  # noqa: BLE001
                print(f"  [{path}] FAILED: {err}")
            time.sleep(1.0)


if __name__ == "__main__":
    main()
