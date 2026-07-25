---
name: 시세파이프라인
description: 국내·해외 실시간 시세 수집(intraday-kr/intraday-global), 주간 가격데이터(fetch-data), 시그널 텔레그램 알림(signal-alert), n8n workflow_dispatch 우회 구조. "시세가 안 갱신돼요", "알림이 안 와요", "신규 종목이 앱에 안 보여요" 같은 문의에 사용.
---

# 시세파이프라인 — 수집 워크플로 진단·복구

## 공통 진단 순서

시세·알림 관련 문의는 사이트 표시 로직 버그보다 **GitHub 스케줄 큐 문제**일 가능성이 높다.

1. `mcp__github__actions_list` 로 해당 워크플로의 최근 실행 이력을 확인한다.
2. 안 돌았으면 `mcp__github__actions_run_trigger`(`run_workflow`)로 즉시 수동 실행해 당장의 데이터를 갱신한다.
3. 실패했으면 `get_job_logs` 로 원인을 본다.

## intraday-kr — 국내 실시간(30분) 시세

`.github/workflows/intraday-kr.yml` 이 국내 장중(KST 09:05~15:35) 30분 주기(매시 5분·35분 — 전 세계
cron이 몰리는 정각·30분 congestion을 피하는 offset)로 `scripts/fetch_intraday_kr.py` 를 실행해 국내 전
종목 현재가를 **전용 `live` 브랜치에 단일 커밋 force-push** 한다(`latest_kr.json`).

- 개발 브랜치 이력을 오염시키지 않기 위한 구조이므로 **`live` 브랜치에 다른 파일을 넣지 말 것**.
- 사이트 "🔄 최신시세" 토글이 raw.githubusercontent.com으로 이 파일을 읽는다.
- "⏱️ 지금 확인" 버튼은 브라우저 캐시만 무시하고 재조회할 뿐 **GitHub 쪽 재실행을 강제하지 않는다**.

### ⚠️ 스케줄 신뢰도 낮음 (2026-07-06~10 실측)

GitHub 무료 스케줄 큐가 congestion 시 실행을 수 시간~반나절 지연시키거나 아예 드롭한다 —
하루 14회(30분 × 평일 6.5시간) 예정인데 실제로는 **하루 2~4회만** 실행된 사례가 확인됐다.
정각 offset으로 일부 완화했지만 근본 해결은 아니다.

## intraday-global — 해외·지수 시세

`.github/workflows/intraday-global.yml` + `scripts/fetch_intraday_global.py`, 7분·37분 offset 30분 주기.
전용 **`live-trading` 브랜치의 `latest_global.json`** 에 단일 커밋 force-push(live 브랜치와 같은 구조 —
**여기에도 다른 파일을 넣지 말 것**). 코스피지수·나스닥선물·SOX·SOXX를 담당한다.

## fetch-data — 주간 가격데이터 (⚠️ 이중 트리거)

`.github/workflows/fetch-data.yml` 은 **`push`(paths: `scripts/**`) 자동 트리거**를 갖고 있다.
`scripts/etf_list.json` 등을 수정해 push하면(개발·배포 브랜치 각각) 그것만으로 수집이 자동 실행된다.

- **push 직후 `run_workflow` 수동 dispatch를 병행하지 말 것.**
  실사례(2026-07-18): push 2회 + 수동 1회 = 동시 3중 실행이 같은 브랜치에 데이터 커밋을 경쟁하다
  push 단계 실패. 수동 실행은 `actions_list`로 확인해 자동 실행이 정말 안 됐을 때만.
- 워크플로에 concurrency 직렬화 + push 실패 시 rebase 재시도(2026-07-19 추가)가 있어 경합이 나도
  데이터는 결국 반영되지만, 불필요한 동시 실행 자체를 만들지 않는 게 원칙.
- **신규 종목이 앱에 "안 보인다"는 문의**: 저장소 데이터 반영 여부만 확인하고 끝내지 말 것.
  클라이언트 fetch는 캐시버스팅이 적용돼 있으나(2026-07-19 수정), 구버전 APK나 서비스워커 캐시 등
  **사용자 화면까지의 전체 경로**를 점검한 뒤에 "해결됨"을 판정한다.

## signal-alert — 시그널 텔레그램 알림 (A12, 2026-07-17)

`.github/workflows/signal-alert.yml` 이 평일 2회(16:05 KST 국내 마감 후 · 06:35 KST 미국 마감 후)
`scripts/signal_alert.py` 를 실행해 워치리스트(저장소 변수 `ALERT_WATCHLIST`, 기본 삼성전자·하이닉스·SOXL)
종목의 종합등급을 계산하고 **매일 요약 + 시그널 종목 🚨 강조** 메시지를 텔레그램으로 보낸다.

- 등급 = 📡 시그널 탭과 동일한 5투표: RSI14 · 다이버전스 · 볼린저 · MACD · MA200이격.
- 시크릿 `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` 미설정 시 안내 로그만 남기고 무해 종료.
- 직전 등급은 Actions 캐시(`.alert_state.json` — 저장소 커밋 안 함)로 보관해 등급 변화 시 🆕 표시.
- **지표 공식은 `shared/myassets-utils.js` 와 교차검증된 동일 구현이므로 한쪽 수정 시 양쪽 동기화할 것.**

## n8n workflow_dispatch 우회 (2026-07-20 도입)

GitHub `schedule:` 큐를 우회하려고 Tab S9의 n8n이 `workflow_dispatch` API를 30분마다 직접 호출한다.
기존 GitHub `schedule:` 트리거는 백업으로 유지(n8n/Tab S9 다운 대비 이중 안전망) — 둘이 겹쳐도
`concurrency: intraday-kr-${{ github.ref }}`(직렬화, 취소 안 함)로 안전하다.

PAT는 기존 Contents:Read 전용(3tv/second-brain 동기화용)과 분리된 **별도 Fine-grained PAT**
(`14fiance`만, `Actions: Read and write`)를 쓴다 — n8n 웹UI에만 입력하고 **대화·코드에 노출 금지**.

| 단계 | 대상 | 상태 | 문서 |
|---|---|---|---|
| 1 | intraday-kr | **설치·활성화 완료**(2026-07-20), 배포 브랜치에도 병합 완료 | `docs/n8n_intraday_kr_dispatch.md` + `docs/n8n_intraday_kr_dispatch_workflow.json` |
| 2 | intraday-global | JSON·가이드 준비 완료, **활성화 보류** | `docs/n8n_intraday_global_dispatch_workflow.json` |
| 3 | signal-alert | JSON 준비 완료, **활성화 보류** | `docs/n8n_signal_alert_dispatch_workflow.json` |

2·3단계는 intraday-kr의 실사용 검증(다음 장중 자동 발화 확인) 후 Tab S9에서 생성·활성화한다
(사용자 확정 순차 확장 방침).

### ⚠️ UTC↔KST 요일 경계 함정 (2026-07-20 계산 완료)

GitHub `schedule:` 은 **UTC로 요일을 판정**하는데 n8n은 **Asia/Seoul(KST)** 타임존이라, 자정을 넘나드는
구간에서 cron 문자열을 그대로 복사하면 "평일" 범위가 어긋난다.

- intraday-global(거의 24시간 운영): 월요일 09~23시 · 화~금 종일 · 토요일 00~08시 **3규칙**으로 분할.
- signal-alert의 "익일 06:35" 알림: 시각뿐 아니라 **요일 범위도** 화~토(2-6)로 shift해야 한다
  (코멘트의 "익일"이 요일에도 적용된다는 점이 놓치기 쉬운 함정).

근거 계산은 `docs/n8n_intraday_global_dispatch.md` 참조.
