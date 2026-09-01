#!/usr/bin/env python3
"""국내 상장 종목(ETF·개별주)의 현재가만 빠르게 수집해 latest_kr.json으로 저장한다.

주간 전체 수집(fetch_data.py)과 별개로, 국내 장중(09:00~15:30 KST) 30분 주기
GitHub Actions(intraday-kr.yml)에서 실행된다. 결과는 개발 브랜치가 아니라 전용
`live` 브랜치에 단일 커밋으로 force-push 되고(이력 오염 방지), 사이트의
"🔄 최신시세" 옵션이 raw.githubusercontent.com 으로 이 파일을 읽는다.

네이버 모바일 증권 basic API(종목당 1콜)를 사용한다 — ETF·개별주 모두 동일
엔드포인트로 동작함을 확인(2026-07-06 프로브). 실패한 종목은 건너뛰고(해당
종목은 사이트가 주간 수집 종가로 폴백) 절반 이상 실패 시에만 에러로 처리한다.

A51(2026-08-13 사용자 보고): 비중 히트맵의 등락률이 "라이브가 vs 마지막 주간 수집
종가"를 비교해 며칠 치가 누적된 변화를 보여줘서, 오늘 실제로는 상승 중인 종목이
하락으로 뜨는 문제가 있었다. 진짜 "전일종가" 데이터가 필요한데, 이 API가 실제로
전일종가 필드를 주는지 이 저장소 환경에서는 검증할 방법이 없어(네트워크 프록시가
네이버 API 도메인을 차단) 응답 필드에 의존하는 대신, 실행 이력 자체로 전일종가를
만든다: 매일 첫 실행 때 "직전에 저장돼 있던 스냅샷"(=어제 마지막 장중 스냅샷,
장마감 15:30 직후와 거의 같음)을 그날의 prevClose로 확정하고, 같은 날 이후 실행은
그 값을 그대로 들고 간다. 이전 상태는 커밋마다 force-push로 사라지므로, 매번
실행 직전에 live 브랜치의 현재 latest_kr.json을 받아와 넘겨줘야 한다
(intraday-kr.yml의 "Fetch previous snapshot" 스텝 참조).

사용법: python scripts/fetch_intraday_kr.py [출력경로] [이전스냅샷경로]
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


def load_prev(prev_path: Path | None) -> dict | None:
    if not prev_path or not prev_path.exists():
        return None
    try:
        data = json.loads(prev_path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError) as err:
        print(f"  .. 이전 스냅샷 읽기 실패(무시하고 진행): {err}")
        return None


def main() -> int:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("latest_kr.json")
    prev_path = Path(sys.argv[2]) if len(sys.argv) > 2 else None
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
    today_kst = time.strftime("%Y-%m-%d", kst)

    prev = load_prev(prev_path)
    prev_date = (prev.get("updated") or "")[:10] if prev else None
    if prev_date == today_kst:
        # 오늘 이미 한 번 이상 실행됨 — 아침 첫 실행에서 확정한 전일종가를 그대로 승계
        prev_close = prev.get("prevClose") or {}
    elif prev and prev.get("prices"):
        # 오늘 첫 실행 — 직전 스냅샷(=어제 마지막 장중 스냅샷)을 오늘의 전일종가로 확정
        prev_close = prev["prices"]
    else:
        # 이전 스냅샷이 없음(최초 실행 등) — 전일종가 없이 진행, 클라이언트가 폴백 처리
        prev_close = {}

    result = {
        "updated": time.strftime("%Y-%m-%d %H:%M KST", kst),
        "count": len(prices),
        "prices": prices,
        "prevClose": prev_close,
    }
    out_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"done. {len(prices)}/{len(symbols)} prices, prevClose {len(prev_close)}건 -> {out_path}")
    return 1 if len(prices) < len(symbols) / 2 else 0


if __name__ == "__main__":
    sys.exit(main())
