# intraday-kr 스케줄 드롭 해결 — n8n workflow_dispatch 트리거

## 목적

`intraday-kr.yml`의 GitHub `schedule:` 큐는 혼잡 시 지연·드롭이 흔하다(2026-07-06~10
실측: 하루 14회 예정 중 실제 2~4회만 실행). 반면 이 세션에서 `workflow_dispatch`
API 호출(`mcp__github__actions_run_trigger` `run_workflow`)로 수동 실행한 건은 매번
즉시 실행됐다 — `workflow_dispatch`는 이 지연 큐를 우회한다. Tab S9의 n8n이 이제
정상 동작하므로, n8n의 스케줄 트리거가 30분마다 GitHub API에 `workflow_dispatch`를
직접 호출해 GitHub 자체 cron 큐를 거치지 않고 실행을 강제한다.

**2026-07-20 사용자 확정**: 3개 파이프라인(intraday-kr·intraday-global·signal-alert) 중
**intraday-kr만 먼저** 적용(측정상 가장 심각 — 3/14회). global·signal-alert는 이 방식이
실측으로 검증된 뒤 같은 패턴으로 확장한다. 기존 GitHub `schedule:` 트리거는
**삭제하지 않고 백업으로 유지** — n8n/Tab S9 자체가 죽어도 GitHub 쪽이 (지연되더라도)
계속 시도하는 이중 안전망 구조.

## 구조

```
n8n(Tab S9, 09:05~15:35 KST 30분) ─POST /actions/workflows/intraday-kr.yml/dispatches─▶ GitHub Actions
                                                                                          (즉시 실행, 큐 우회)
```

기존 GitHub `schedule: "5,35 0-6 * * 1-5"`(동일 시각대)는 백업으로 그대로 둔다.
`intraday-kr.yml`에 `concurrency: { group: intraday-kr-${{ github.ref }}, cancel-in-progress: false }`를
추가해(2026-07-20) 두 트리거가 겹쳐도 순차 실행되어 `live` 브랜치 force-push가 경합하지 않는다.

## 1. GitHub PAT 발급 (최초 1회, 사용자 직접, 웹UI)

기존 3tv/second-brain 동기화용 PAT는 **Contents: Read-only**라 workflow_dispatch를
호출할 권한이 없다 — 이 용도로 **별도 PAT**를 새로 발급한다(최소 권한 원칙 유지).

1. GitHub → Settings → Developer settings → Fine-grained personal access tokens → **Generate new token**
2. Repository access: **Only select repositories** → `14fiance`만 선택
3. Permissions → **Actions: Read and write** 로 설정 (다른 권한은 전부 비활성 유지)
4. 발급된 토큰(`github_pat_...`)은 **n8n 웹 UI의 HTTP 노드 Header에 직접 입력** —
   Claude 세션/대화창에는 절대 붙여넣지 않는다.

## 2. 워크플로 등록 (Tab S9)

1. n8n 웹 UI → Workflows → **Import from File** → `n8n_intraday_kr_dispatch_workflow.json`
2. import 후 **"GitHub workflow_dispatch 호출"** 노드의 Header
   `Authorization: Bearer <GITHUB_PAT>` 값을 1번에서 발급한 토큰으로 교체
3. 워크플로 Settings → Timezone: **Asia/Seoul** 확인
4. 활성화(Active 토글)

## 3. 검증

1. n8n에서 **Execute Workflow** 수동 1회 → 응답 204(No Content)면 성공
2. `mcp__github__actions_list`(`list_workflow_runs`, event=workflow_dispatch)로 방금 실행이
   `claude/us-etf-mdd-calculator-gdwui7` 브랜치에서 즉시 시작됐는지 확인
3. 1~2일 실사용 후 실제 발화 횟수를 GitHub Actions 실행 이력으로 비교(하루 13회 = 09:05~15:35
   30분 간격, 마지막 15:35 포함) — schedule 큐 지연 때처럼 드롭되지 않는지 확인

## 참고

- `ref`는 반드시 **배포 브랜치** `claude/us-etf-mdd-calculator-gdwui7`로 고정한다 —
  GitHub의 기존 `schedule:` 트리거도 이 브랜치의 워크플로 파일로 실행되므로 동일하게
  맞춰야 `live` 브랜치에 같은 결과가 쌓인다(다른 브랜치를 넣으면 그 브랜치 워크플로 정의로
  실행되어 결과가 어긋날 수 있음).
- intraday-global·signal-alert로 확장할 때는 이 워크플로를 복제해 URL의
  `intraday-kr.yml`만 `intraday-global.yml`/`signal-alert.yml`로, cron을 각 파이프라인의
  기존 주기(7·37분 / 16:05·06:35)로 바꾸면 된다. 같은 PAT를 재사용해도 되고
  (이미 저장소 하나로 스코프됨), 원하면 워크플로별로 더 쪼갤 수도 있다.
