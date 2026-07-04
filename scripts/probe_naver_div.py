#!/usr/bin/env python3
"""[임시 진단용] 네이버 모바일 증권에서 국내 ETF 분배금 이력이 어떤 형태로
제공되는지 CI 러너(실제 인터넷 접근 가능)에서 확인한다.

fetch_dividends_kr가 전 종목 None을 반환한 원인 규명:
- analysis 페이지가 서버 렌더링인지(한글이 그대로 있는지) 확인
- __NEXT_DATA__ JSON 안에 배당 데이터가 있는지 확인
- 내부 JSON API 후보들을 직접 두드려 응답 확인

성공적으로 원인을 찾으면 이 파일과 probe.yml은 삭제한다.
"""
import json
import re
import sys
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

API_CANDIDATES = [
    "https://m.stock.naver.com/api/stock/{code}/integration",
    "https://m.stock.naver.com/api/stock/{code}/dividend",
    "https://m.stock.naver.com/api/stock/{code}/dividend/history",
    "https://m.stock.naver.com/api/stock/{code}/analysis",
    "https://api.stock.naver.com/etf/{code}/dividend",
    "https://api.stock.naver.com/stock/{code}/dividend",
    "https://m.stock.naver.com/front-api/etf/dividend?code={code}",
]


def get(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        return err.code, ""
    except Exception as err:  # noqa: BLE001
        return -1, str(err)


def main() -> int:
    for code in CODES:
        print(f"\n===== {code} : analysis page =====")
        status, html = get(f"https://m.stock.naver.com/domestic/stock/{code}/analysis")
        print(f"status={status} length={len(html)}")
        if html:
            print("  raw '배당락일' in html:", "배당락일" in html)
            print("  escaped '\\ubc30\\ub2f9\\ub77d\\uc77c' in html:", "\\ubc30\\ub2f9\\ub77d\\uc77c" in html)
            print("  '__NEXT_DATA__' in html:", "__NEXT_DATA__" in html)
            print("  'dividend' count:", html.lower().count("dividend"))
            # dividend 주변 문맥 샘플 3곳
            for i, m in enumerate(re.finditer(r"dividend", html, re.I)):
                if i >= 3:
                    break
                s = max(0, m.start() - 120)
                print(f"  ctx{i}: ...{html[s:m.start()+180]!r}...")

        print(f"\n===== {code} : API candidates =====")
        for tpl in API_CANDIDATES:
            url = tpl.format(code=code)
            status, body = get(url)
            head = body[:400].replace("\n", " ")
            print(f"[{status}] {url}\n    {head!r}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
