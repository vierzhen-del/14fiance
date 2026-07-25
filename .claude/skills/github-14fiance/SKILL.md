---
name: github-14fiance
description: 14fiance의 브랜치 지도(개발·배포·데이터 브랜치), 워크플로 목록, Actions 수동 실행·진단 절차. 커밋·푸시·병합 전이나 "워크플로가 안 돌아요" 문의 시 사용.
---

# github-작업 — 14fiance 브랜치·Actions

## 브랜치 지도

| 브랜치 | 역할 | 주의 |
|---|---|---|
| `claude/us-etf-mdd-calculator-gdwui7` | **배포 브랜치 = 기본 브랜치.** GitHub Pages가 여기서 서빙된다 | 다른 세션이 여기서 직접 작업한 커밋이 존재한다 |
| `claude/saved-items-7bnk7u` | 개발 브랜치 | 세션 시작 시 배포 브랜치를 먼저 병합할 것 |
| `live` | `latest_kr.json` **전용** 데이터 브랜치 (단일 커밋 force-push) | 다른 파일 금지 |
| `live-trading` | `latest_global.json` **전용** 데이터 브랜치 (단일 커밋 force-push) | 다른 파일 금지 |

**세션 시작 시 브랜치 동기화**: 코드 작업 전에 반드시 배포 브랜치를 fetch해 개발 브랜치에 병합부터
한다 — 다른 세션이 배포 브랜치에서 직접 작업한 커밋(캡처 파싱 재설계, realtime-trading 등 실사례 있음)을
개발 브랜치가 놓친 채 같은 파일을 고치면 병합 충돌·기능 되돌림이 발생한다.

코드 수정이 실제 사이트에 반영되려면 배포 브랜치까지 도달해야 한다(과거 n8n concurrency 커밋도
개발→배포 fast-forward 병합으로 반영했다).

## 워크플로

| 파일 | 트리거 | 비고 |
|---|---|---|
| `build-apk.yml` | `app/`·`shared/`·`capture/` push | 안드로이드 APK 빌드 |
| `fetch-data.yml` | 주간 cron + **`push`(paths: `scripts/**`)** | 이중 트리거 주의 — `시세파이프라인` 스킬 참조 |
| `intraday-kr.yml` | cron 5·35분 offset + n8n dispatch | `live` 브랜치 push |
| `intraday-global.yml` | cron 7·37분 offset | `live-trading` 브랜치 push |
| `signal-alert.yml` | 평일 16:05 / 06:35 KST | 텔레그램 발송 |

## Actions 진단 순서

1. `mcp__github__actions_list` — 최근 실행 이력·지연 여부 확인
2. `mcp__github__get_job_logs` — 실패 원인 확인
3. `mcp__github__actions_run_trigger`(`run_workflow`) — 필요 시 수동 실행

`fetch-data.yml` 만은 예외: push로 자동 실행되므로 수동 dispatch를 **병행하지 않는다**.

## 푸시·PR

- `git push -u origin <branch>`. 네트워크 실패 시에만 2s → 4s → 8s → 16s 지수 백오프로 최대 4회 재시도.
- PR은 사용자가 명시적으로 요청할 때만 만든다.
- 개인 보유 자산 데이터(import JSON 등)·API 키는 어떤 브랜치에도 커밋하지 않는다.
