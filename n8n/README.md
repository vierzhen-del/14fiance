# Notion → Obsidian 동기화 (n8n 1.70.0)

설계: 노션 "🤖 클로드 고레벨 활용 지침" 하단 "🔄 동기화 워크플로우 설계 확정" 섹션 참조.
이 디렉토리는 Tab S9의 n8n에 임포트할 선구현 산출물이다. **이 repo 환경에서는 n8n 실행이 불가하므로 아래 수동 검증 절차가 테스트를 대체한다.**

## 착수 전 확인 4건 (구현 시작 전에 결정)

- [x] 동기화 대상 Notion DB 선정 (2026-07-13) → `39c5efd0e4628056a91ed6c5f16d6e85` ("n8n" 페이지 하위 신규 Database). Integration "n8n"을 Connections에 명시적으로 연결해야 조회됨 — 이름 다른 Integration("14fiance-sync")에만 연결하면 404
- [x] vault 위치 확정 (2026-07-13) → `/storage/emulated/0/Documents/vierzhen_home/MyVault` — 기존 PARA 구조(00_Inbox·10_Notes·20_Projects·30_Resources·40_Archive·_templates) vault, proot Ubuntu에서 접근 확인됨(exit code 0). S26에서 열람하려면 Syncthing 또는 Obsidian Sync 별도 구성 필요(미해결)
- [x] 폴더 매핑 규칙 (2026-07-13) → `_notion-sync/` (언더스코어 접두사 = 이 vault의 기존 시스템/유틸리티 폴더 규칙, `_templates`와 동일 패턴). PARA 번호 폴더와 섞이지 않도록 격리
- [x] 동기화 주기 → 기본안 1시간 유지 (변경 요청 없음)

## Placeholder 치환 목록

| Placeholder | 위치 | 값 |
|---|---|---|
| `REPLACE_ME_NOTION_DATABASE_ID` | notion-obsidian-sync.json | Notion DB ID (URL의 32자 hex) |
| `REPLACE_ME_VAULT_PATH` | notion-obsidian-sync.json | vault 절대경로 (proot 규칙: 절대경로 필수) |
| `REPLACE_ME_TELEGRAM_CHAT_ID` | error-telegram.json | 화이트리스트에 등록된 본인 chat_id |

크레덴셜(Notion API·Postgres 17·Telegram Bot)은 n8n Credentials UI에서 생성 후 노드에 연결 — 토큰·키를 JSON/커밋/로그에 절대 기록하지 않는다.

⚠️ **Postgres 크레덴셜 주의(2026-07-13 확인)**: n8n 자체가 실제로 접속하는 계정은 `postgres`(비밀번호 없음, `DB_POSTGRESDB_USER=postgres`)다. 이전에 문서화됐던 `n8n`/`n8n` 계정은 실제 운영 계정이 아니며 `public` 스키마에 CREATE 권한이 없어 permission denied가 난다 — n8n Credentials UI에서 Postgres 크레덴셜 생성 시 `postgres` 계정으로 설정할 것.

## Tab S9 수동 검증 절차 (테스트 대체)

1. `psql -f n8n/sql/sync_state.sql` 실행 (스키마 생성)
2. n8n UI → Workflows → Import from File → `error-telegram.json` 먼저, 이후 `notion-obsidian-sync.json`
3. 두 워크플로우의 크레덴셜 연결 + placeholder 치환 확인
4. 메인 워크플로우 Settings → Error Workflow = "Error → Telegram Alert" 지정
5. 수동 1회 실행(Execute Workflow) → 확인:
   - `vault/_notion-sync/`에 `.md` 파일 생성, front matter(title/notion_id/url/tags/updated) 정상
   - `SELECT count(*) FROM sync_state;` = 페이지 수
   - **재실행 시 파일 재작성 없음** (hash 동일 → Upsert & Diff에서 0 rows 반환)
   - `Upsert & Diff (PG)` 노드의 Query Parameters가 배열 표현식으로 안 들어가면: `queryReplacement`를 개별 표현식 5개로 분리
6. 배포 전 SENTINEL 정적 검사: `node scripts/sentinel/check.mjs n8n/workflows/*.json` 통과 확인
7. Activate → 다음 정시 실행 로그 확인

## 동작 요약

매시간 → Notion DB 전체 페이지 조회 → Markdown(YAML front matter) 생성 + FNV-1a 해시 → PG `sync_state`에 조건부 upsert(해시가 다를 때만 row 반환) → **변경된 페이지만** `vault/_notion-sync/<slug>.md`로 기록(Execute Command + base64, 아래 디버깅 기록 참조). 삭제는 하지 않는다(파괴적 작업 금지 — Notion에서 삭제된 페이지의 파일 정리는 수동 또는 v2의 `_trash/` 이동으로).

- Phase 1: ✅ **동기화 성공 확인** (2026-07-13, n8n 워크플로우 ID `cDcy5JleTvpOofcP`, active) — Notion 3페이지 → sync_state 3행 → `_notion-sync/`에 .md 3개 실제 생성 (n8n 프로세스 자체 출력으로 검증). 남은 확인: Obsidian 앱에서 파일 표시 여부(마운트 뷰 확인)
- Phase 2: **설계 확정** (2026-07-10, 노션 v5.8 하단 "🧠 Phase 2 설계 확정" 참조) — 블록 본문→Markdown(HTTP+notionApi, depth 1) + OKF 폴더 구조(카테고리 폴더 + index.md 자동 생성, sync_state v2). Phase 1이 Tab S9 수동 검증을 통과한 뒤 구현 착수

## Tab S9 디버깅 기록 (2026-07-13)

실기기에서 Phase 1을 실제로 돌리며 발견된 n8n 1.70.0 self-hosted + proot Ubuntu 환경 특유의 문제들. 전부 repo에 반영 완료.

| # | 증상 | 원인 | 조치 |
|---|---|---|---|
| 1 | Build Markdown에서 아이템 0개로 소실 | Code 노드가 암묵적 `items` 전역변수에 의존 — 버전에 따라 비어있음 | `$input.all()`로 명시적 조회 |
| 2 | `Cannot find module 'crypto'` | n8n Code 노드는 vm2 샌드박스에서 Node 내장 모듈 `require` 차단 | 순수 JS FNV-1a 해시로 교체 (암호학적 강도 불필요 — 변경감지용) |
| 3 | `Write to Vault`(readWriteFile)에서 `ENOENT` | proot 안에서 안드로이드 공유 저장소(FUSE)에 Node.js `fs` write가 실패. 동일 경로에 셸 `echo >`는 성공 — proot+FUSE 조합 특유 이슈 | `readWriteFile` → **Execute Command** 노드로 교체, `echo '<base64>' \| base64 -d > path` 방식. base64 경유로 셸 인젝션·따옴표 문제 원천 차단 |
| 4 | Encode Base64에서 `Buffer.from(undefined)` 에러 | Postgres `INSERT...ON CONFLICT...RETURNING`이 조건 불충족(내용 무변경)으로 0행 매칭돼도, n8n Postgres 노드가 빈 pass-through 아이템을 흘려보냄 | `if (!j.content) continue;` 가드 추가 — 무변경 아이템은 정상적으로 스킵 |

| 5 | 셸에서 `ls`하면 파일이 안 보이는데 n8n은 exitCode 0 | **Tab S9 다중 FUSE 마운트**: n8n 프로세스(uid=0, `/storage/self/primary`)와 검증 셸(uid=10251, `/storage/emulated/0`)이 같은 저장소를 서로 다른 마운트 인스턴스로 봄 — n8n은 처음부터 정상적으로 쓰고 있었음 | 파일 쓰기 검증은 **쓰는 프로세스와 같은 컨텍스트에서** (워크플로우에 `ls` Execute Command를 붙여 n8n 자신의 눈으로 확인). 별도 셸의 `ls` 결과로 "안 써짐"을 단정하지 말 것 |
| 6 | 노드 이름 변경 후 파이프라인 단절 | `connections` 객체는 노드 **이름 문자열**로 참조 — `name` 필드만 바꾸면 연결이 조용히 끊김 | 이름 변경 시 JSON 전체에서 옛 이름을 grep해 일괄 치환. connection 참조 무결성 검증 스크립트로 확인 |

**공통 교훈**: proot Ubuntu + Android 공유 저장소 조합에서는 Node.js 네이티브 파일 API보다 **셸 명령 경유가 더 안정적**. Phase 2(블록 본문 동기화) 구현 시에도 파일쓰기는 Execute Command 패턴 유지할 것.

**n8n-mcp 운영 메모**: `n8n_list_workflows`는 n8n 1.70.0과 비호환(`excludePinnedData` 파라미터, VALIDATION_ERROR) — 워크플로우는 ID로 직접 조회(`n8n_get_workflow`). Schedule Trigger 워크플로우를 API로 실행하려면 임시 Webhook 노드를 붙였다 제거하는 패턴 사용.
