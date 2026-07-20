# intraday-global · signal-alert 스케줄 드롭 해결 — n8n workflow_dispatch 트리거

`docs/n8n_intraday_kr_dispatch.md`(1단계, 2026-07-20 적용완료)와 같은 목적·같은 구조다.
차이는 **GitHub Actions `schedule:`이 UTC 기준으로 요일을 판정**하는데, n8n 워크플로
타임존은 Asia/Seoul(KST)로 설정하므로, cron 문자열을 그대로 복사하면 자정을 넘나드는
구간에서 "평일" 범위가 어긋난다는 점이다. 이 문서는 그 변환 계산과 결과만 다룬다.

## intraday-global — 요일 경계 계산

원본(`intraday-global.yml`): `cron: "7,37 * * * 1-5"` (UTC, 평일 종일 30분 주기).
UTC 평일(월~금) 전체는 시간 축으로 **UTC 월요일 00:00 ~ UTC 토요일 00:00(제외)**의
연속 구간이다. +9시간 해서 KST로 옮기면:

| 지점 | UTC | KST |
|---|---|---|
| 구간 시작 | 월 00:07 | 월 **09:07** |
| 구간 끝(마지막 실행) | 금 23:37 | 토 **08:37** |
| 제외 확인 | 토 00:07 | 토 09:07 (제외됨) |
| 제외 확인 | 일 23:37 | 월 08:37(다음날) (제외됨) |

(`python3 zoneinfo`로 위 4개 지점 실측 확인, 2026-07-20)

즉 KST 기준 실제 커버리지는 **월요일 09:00 ~ 토요일 09:00 직전까지 연속**이다.
표준 5필드 cron 하나로는 "요일별로 시작 시각이 다른" 이 모양을 못 담으므로,
n8n scheduleTrigger의 interval 배열에 **3개 cron 규칙**을 나눠 넣는다:

1. `7,37 9-23 * * 1` — 월요일 09~23시
2. `7,37 * * * 2-5` — 화~금 종일
3. `7,37 0-8 * * 6` — 토요일 00~08시

## signal-alert — 요일 경계 계산 (2번째 스케줄만 해당)

원본(`signal-alert.yml`) 두 cron 중:
- `5 7 * * 1-5`(UTC) → KST 16:05, **자정을 안 넘음**(07:05+9=16:05 같은 날) → 요일 그대로 월~금 사용 가능.
- `35 21 * * 1-5`(UTC, "익일 06:35" 코멘트 그대로) → **자정을 넘음**(21:35+9=익일 06:35).
  UTC 월요일 21:35 → KST **화요일** 06:35, UTC 금요일 21:35 → KST **토요일** 06:35로 확인됨
  (`python3 zoneinfo` 실측, 2026-07-20). 즉 KST 요일은 **화~토(2-6)**이지 월~금(1-5)이 아니다.
  ⚠️ 이 부분은 코멘트에 "익일"이라고 이미 써 있었는데도 요일 범위까지 shift해야 한다는 점은
  놓치기 쉬운 함정이라 여기 명시해둔다.

n8n interval 2개:
1. `5 16 * * 1-5` — 국내 마감(16:05 KST, 월~금)
2. `35 6 * * 2-6` — 미국 마감 익일(06:35 KST, **화~토**)

## 상태 — 2026-07-20 기준 준비만 완료, 활성화는 보류

1단계(intraday-kr) 이후 순차 확장 방침(사용자 확정)에 따라 이 두 워크플로는
**JSON·가이드만 준비**해두고, **intraday-kr의 실사용(내일 장중 자동 발화) 검증이 끝난 뒤**
Tab S9에서 생성·활성화한다. `intraday-global.yml`에는 이미 `concurrency` 블록을
추가해뒀다(intraday-kr과 동일 패턴 — 백업 schedule과 겹쳐도 안전).

## 설치 절차 (검증 완료 후, intraday-kr과 동일 패턴)

1. GitHub PAT: intraday-kr 때 발급한 `14fiance` 전용 `Actions: Read and write` PAT를
   그대로 재사용 가능(레포 하나로 이미 스코프됨) — 새로 만들 필요 없음.
2. n8n 웹 UI → Workflows → Import from File →
   `n8n_intraday_global_dispatch_workflow.json` / `n8n_signal_alert_dispatch_workflow.json`
3. 각 워크플로의 "GitHub workflow_dispatch 호출" 노드 Header `Authorization`에 PAT 입력
4. Timezone: Asia/Seoul 확인 → Active 전환
5. 검증: Execute Workflow 수동 1회 → 204 확인 → GitHub Actions 실행 이력에서
   `claude/us-etf-mdd-calculator-gdwui7` 브랜치로 실행됐는지 확인
