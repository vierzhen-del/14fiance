#!/usr/bin/env python3
"""[임시 진단용] 3차 프로브.

지금까지 확인된 것:
- /api/stock/{code}/integration : 200, 정상 JSON. 단 etfKeyIndicator 안에
  dividendYieldTtm/dividendPerShareTtm/dividendMonthsThisYear 같은 "TTM 요약값"만
  있고 개별 배당락일/배당금 리스트는 없음(전체 키 스캔으로 확인됨).
- analysis 페이지 원문에도 개별 날짜 리스트 텍스트가 없음(요약 3개 키만 등장).

이번엔 (1) 더 넓은 후보 API 경로들 (2) 영문 필드명 후보(exDividend, recordDate,
paymentDate 등)로 재검색 (3) 혹시 클라이언트 사이드에서 별도로 불러오는 것이라면
포기하고 그 결론을 명확히 낸다.
"""
import json
import re
import sys
import urllib.error
import urllib.request

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json, text/html;q=0.9, */*;q=0.8",
}

CODES = ["441640", "472150"]

SUFFIXES = [
    "etf", "etfInfo", "etfBasic", "etfAnalysis", "etf-analysis",
    "analysisInfo", "finance", "financeInfo", "financeIndex",
    "dividendInfo", "dividendHistory", "dividendList", "basic",
    "finance/dividend", "etf/dividend", "etfDividend", "etfDividendHistory",
    "totalInfo",
]

ENGLISH_FIELD_HINTS = [
    "exDividend", "recordDate", "paymentDate", "dividendDate",
    "distributionDate", "payDate", "dividendHistory", "dividendList",
    "dividendPerShare", "cashDividend",
]


def get(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        return err.code, ""
    except Exception as err:  # noqa: BLE001
        return -1, str(err)


def main() -> int:
    code = CODES[0]  # 시간 절약을 위해 대표 1개만

    print(f"===== {code}: english field hints in analysis page & integration =====")
    _, html = get(f"https://m.stock.naver.com/domestic/stock/{code}/analysis")
    _, integ = get(f"https://m.stock.naver.com/api/stock/{code}/integration")
    for hint in ENGLISH_FIELD_HINTS:
        in_html = hint.lower() in html.lower()
        in_integ = hint.lower() in integ.lower()
        if in_html or in_integ:
            print(f"  '{hint}': analysis_page={in_html} integration_api={in_integ}")

    print(f"\n===== {code}: wider API suffix candidates =====")
    for suf in SUFFIXES:
        url = f"https://m.stock.naver.com/api/stock/{code}/{suf}"
        status, body = get(url)
        if status == 200:
            print(f"[200!] {url}")
            print(f"    {body[:500]!r}")
        else:
            print(f"[{status}] {url}")

    # 종목이 아닌 "종목토론/뉴스"처럼 별도 최상위 API 그룹도 있을 수 있어 확인
    print(f"\n===== {code}: alt top-level api groups =====")
    alt_urls = [
        f"https://m.stock.naver.com/api/etf/{code}",
        f"https://m.stock.naver.com/api/etf/{code}/dividend",
        f"https://m.stock.naver.com/api/index/dividend/{code}",
        f"https://m.stock.naver.com/api/stock/{code}/total",
    ]
    for url in alt_urls:
        status, body = get(url)
        print(f"[{status}] {url}")
        if status == 200:
            print(f"    {body[:500]!r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
