#!/usr/bin/env python3
"""[임시 진단용] 4차 프로브: /api/stock/{code}/etfAnalysis 전체 구조 덤프.

3차 프로브에서 이 엔드포인트가 200을 반환하고 dividendPerShare 필드를
포함함을 확인했다. 이번엔 전체 키 구조를 펼쳐서 개별 배당락일/배당금
리스트가 어느 키에 있는지 정확히 찾는다.
"""
import json
import sys
import urllib.error
import urllib.request

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"
    ),
    "Referer": "https://m.stock.naver.com/",
    "Accept": "application/json",
}

CODES = ["441640", "472150"]


def get(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as err:
        try:
            return err.code, err.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            return err.code, ""
    except Exception as err:  # noqa: BLE001
        return -1, str(err)


def describe(obj, path="root", depth=0, lines=None):
    if lines is None:
        lines = []
    indent = "  " * depth
    if isinstance(obj, dict):
        lines.append(f"{indent}{path} (dict, {len(obj)} keys): {list(obj.keys())}")
        for k, v in obj.items():
            if isinstance(v, (dict, list)):
                describe(v, k, depth + 1, lines)
    elif isinstance(obj, list):
        lines.append(f"{indent}{path} (list, n={len(obj)})")
        if obj and isinstance(obj[0], dict):
            lines.append(f"{indent}  item keys: {list(obj[0].keys())}")
            lines.append(f"{indent}  sample[0]: {json.dumps(obj[0], ensure_ascii=False)[:300]}")
            if len(obj) > 1:
                lines.append(f"{indent}  sample[1]: {json.dumps(obj[1], ensure_ascii=False)[:300]}")
    return lines


def main() -> int:
    for code in CODES:
        print(f"\n===== {code} : etfAnalysis full dump =====")
        status, body = get(f"https://m.stock.naver.com/api/stock/{code}/etfAnalysis")
        print(f"status={status} length={len(body)}")
        if status != 200:
            print("  body:", body[:300])
            continue
        try:
            data = json.loads(body)
        except json.JSONDecodeError as err:
            print("  JSON parse failed:", err)
            print("  raw:", body[:500])
            continue
        for line in describe(data):
            print(line)

    return 0


if __name__ == "__main__":
    sys.exit(main())
