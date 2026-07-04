#!/usr/bin/env python3
"""[임시 진단용] 네이버 모바일 증권 내부 API(m.stock.naver.com/api/stock/{code}/integration)
응답 전체 구조를 확인해 개별 배당락일/배당금 이력이 어느 키에 들어있는지 찾는다.

1차 프로브 결과: /api/stock/{code}/integration 가 200으로 정상 JSON을 반환함을
확인했다(dividendYieldTtm, dividendPerShareTtm 등 TTM 요약치는 있음). 이번엔
전체 응답을 훑어서 날짜별 개별 배당 이력 리스트가 있는 키를 찾는다.
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


def find_date_like_lists(obj, path="root", found=None):
    """dict/list를 재귀 순회하며, 'date'/'day'/'ymd' 비슷한 키를 가진
    dict들의 list를 찾아 (path, sample) 형태로 수집한다."""
    if found is None:
        found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            find_date_like_lists(v, f"{path}.{k}", found)
    elif isinstance(obj, list) and obj:
        first = obj[0]
        if isinstance(first, dict):
            keys = set()
            for item in obj[:3]:
                if isinstance(item, dict):
                    keys |= set(item.keys())
            date_like = [k for k in keys if any(t in k.lower() for t in ("date", "day", "ymd", "dt"))]
            if date_like or "dividend" in path.lower():
                found.append((path, len(obj), list(keys)[:12], obj[:2]))
        for item in obj[:5]:
            find_date_like_lists(item, f"{path}[]", found)
    return found


def main() -> int:
    for code in CODES:
        print(f"\n===== {code} : integration full =====")
        status, body = get(f"https://m.stock.naver.com/api/stock/{code}/integration")
        print(f"status={status} length={len(body)}")
        if status != 200:
            print("  body:", body[:300])
            continue
        try:
            data = json.loads(body)
        except json.JSONDecodeError as err:
            print("  JSON parse failed:", err)
            continue

        print("  top-level keys:", list(data.keys()))
        hits = find_date_like_lists(data)
        if hits:
            print(f"  candidate date-like lists ({len(hits)}):")
            for path, n, keys, sample in hits:
                print(f"    - {path}: n={n} keys={keys}")
                print(f"      sample={json.dumps(sample, ensure_ascii=False)[:400]}")
        else:
            print("  no date-like list found via heuristic scan")

        # dividend 관련 키를 직접 검색 (얕은 깊이)
        def walk_keys(obj, path="root", depth=0, out=None):
            if out is None:
                out = []
            if depth > 6:
                return out
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if "divid" in k.lower():
                        out.append((f"{path}.{k}", type(v).__name__, str(v)[:200]))
                    walk_keys(v, f"{path}.{k}", depth + 1, out)
            elif isinstance(obj, list):
                for item in obj[:5]:
                    walk_keys(item, f"{path}[]", depth + 1, out)
            return out

        divkeys = walk_keys(data)
        print(f"  keys containing 'divid' ({len(divkeys)}):")
        for path, typ, val in divkeys:
            print(f"    - {path} ({typ}): {val}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
