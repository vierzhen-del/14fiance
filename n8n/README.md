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

- Phase 1: ✅ **동기화 성공 확인 (2026-07-14 01:27 재검증)** — Notion 3페이지 → sync_state 3행 → `_notion-sync/`에 .md 3개 실제 생성, 내용 일치 확인. ⚠️ 2026-07-13에 기록됐던 "성공"은 **오탐**이었음(버그 #7 참조, 실제로는 파일 0개 생성) — 2026-07-14에 근본 원인 수정 후 재실행하여 최초로 진짜 검증됨. 워크플로우는 현재 **inactive**(안전 상태) — 이 상태 그대로 최종 승인 전까지 유지, 활성화(매시간 자동 실행) 여부는 사용자 승인 후 진행
- Phase 2: 🚧 **구현 완료, Tab S9 실기기 검증 대기** (2026-07-14) — 설계는 노션 v5.8 "🧠 Phase 2 설계 확정" 참조. 아래 "Phase 2 착수 전 결정 사항"·"Phase 2 수동 검증 절차" 참조

## Phase 2 착수 전 결정 사항 (2026-07-14)

- [x] **OKF 폴더 구조 적용 시점** → 우선 **flat 구조**로 구현. 실제 Notion DB(`39c5efd0e4628056a91ed6c5f16d6e85`)에 아직 카테고리 select 속성이 없어 설계상 기본값("미설정 시 flat 유지")과 일치. 카테고리 분류가 필요해지면 Notion DB에 select 속성 추가 → `Build Markdown`의 `folder` 필드만 그 값으로 채우면 나머지(Upsert & Diff PG, Build Write Script, Build Indexes)는 이미 folder 유무를 분기 처리하도록 구현되어 있어 추가 코드 변경 불필요
- [x] **100블록 초과 페이지 처리** → 설계 원안(HTTP 노드 내장 pagination)을 **의도적으로 미구현**. 이 환경에서 n8n UI의 고급 옵션(Execute Once 토글 등)이 반복적으로 불안정했던 전례(디버깅 기록 #4, #8)에 비춰, `has_more` 플래그만 감지해 "100블록 초과 — Notion 원본 참조" 안내문으로 대체하는 단순한 방식을 택함. 개인 KB 페이지는 대부분 100블록 이하라 실사용 영향 적음 — 실제로 필요해지면 별도 이슈로 pagination 추가
- [x] **하위 블록(toggle 내부 등) 처리** → 설계대로 depth 1만 변환, `has_children`인 블록은 본문 뒤에 Notion 원본 링크 placeholder 삽입

## sync_state 스키마 v2 적용 (Tab S9, Phase 2 워크플로우 임포트 전 필수)

1. **pg_dump 선행** (SENTINEL ⑤ — 스키마 변경 전 백업 필수): `pg_dump -h <host> -U <role> -d <db> -f backup_before_sync_state_v2_$(date +%Y%m%d).sql`
2. `psql -f n8n/sql/sync_state_v2.sql` 실행 — `title`·`slug`·`folder`·`summary` 컬럼 추가 (`ADD COLUMN IF NOT EXISTS`라 안전하게 재실행 가능)
3. `\d sync_state`로 4개 컬럼 추가 확인

## Phase 2 수동 검증 절차 (테스트 대체)

1. 위 sync_state v2 스키마 적용 완료 확인
2. n8n UI에서 갱신된 `notion-obsidian-sync.json`을 다시 Import (기존 워크플로우 열어서 Import 또는 새 캔버스에 Import 후 크레덴셜 재연결)
3. **신규 "Fetch Blocks" 노드**에 Notion API 크레덴셜 연결 확인 (Predefined Credential Type = Notion API) — `Get Notion Pages`와 같은 크레덴셜 사용
4. **신규 "Index Query (PG)" 노드**에 Postgres 크레덴셜 연결 확인 (`Upsert & Diff (PG)`와 동일 크레덴셜)
5. placeholder 재확인: `REPLACE_ME_VAULT_PATH`가 `Build Write Script`뿐 아니라 신규 `Build Indexes` 노드에도 들어있음 — 둘 다 동일 값으로 치환
6. 수동 1회 실행(Test workflow) → 확인:
   - `_notion-sync/<slug>.md` 파일에 본문(paragraph/heading/list 등)이 실제로 들어있는지, front matter에 `summary:` 채워졌는지
   - `_notion-sync/index.md`가 새로 생성됐는지, 페이지 목록이 `- [[slug]] — summary` 형식으로 들어있는지
   - `SELECT title, slug, folder, summary FROM sync_state;`로 신규 컬럼 값 채워졌는지 확인
   - **재실행 시 파일 재작성 없음** 재검증(Phase 1과 동일 원칙 — 산출물을 직접 열어서 확인, 초록 체크만으로 판단 금지. 디버깅 기록 #9 참조)
7. 배포 전 SENTINEL 정적 검사: `node scripts/sentinel/check.mjs n8n/workflows/*.json` 통과 확인 (이미 이 repo에서 통과 확인됨)
8. 이상 없으면 Activate 여부 사용자 승인 후 진행

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
| 7 | **(치명)** 2026-07-13에 "성공"으로 기록됐던 실행이 실제로는 파일을 0개 생성 — 모든 노드가 초록 체크로 "성공" 표시됐는데도 | `Upsert & Diff (PG)` 노드에 `queryBatching` 옵션이 없으면 기본값 `"single"`(아이템 전체를 한 쿼리로 묶어 실행) — 이 모드에서는 Postgres 노드가 `RETURNING` 결과를 아이템별로 매핑하지 못하고 `{"success": true}`라는 빈 값만 반환. 후속 노드는 `content`가 없으니 그냥 스킵하고 exit 0으로 "성공" 종료 — 파이프라인 전체가 아무것도 안 쓰면서 전부 초록 체크 | `options.queryBatching: "independently"` 명시 추가(아이템마다 개별 쿼리 실행 + 개별 `RETURNING` 매핑). **교훈: n8n의 초록 체크/exit 0은 "에러 없음"이지 "의도한 작업을 실제로 했음"이 아니다 — 최종 검증은 반드시 산출물(vault 파일 등) 자체를 직접 확인할 것** |
| 8 | 수동 디버깅 중 트리거 간격이 1시간→1분으로 바뀐 채 방치 | 빠른 반복 테스트를 위해 UI에서 임시로 변경했다가 원복을 누락 | 최종 확인 후 반드시 1시간으로 원복(완료) — 디버깅용 임시 설정 변경은 세션 종료 전 체크리스트에 추가 |

**공통 교훈**: proot Ubuntu + Android 공유 저장소 조합에서는 Node.js 네이티브 파일 API보다 **셸 명령 경유가 더 안정적**. Phase 2(블록 본문 동기화) 구현 시에도 파일쓰기는 Execute Command 패턴 유지할 것.

**n8n-mcp 운영 메모**: `n8n_list_workflows`는 n8n 1.70.0과 비호환(`excludePinnedData` 파라미터, VALIDATION_ERROR) — 워크플로우는 ID로 직접 조회(`n8n_get_workflow`). Schedule Trigger 워크플로우를 API로 실행하려면 임시 Webhook 노드를 붙였다 제거하는 패턴 사용(단, 활성화 상태로 두면 비인증 공개 웹훅이 되어 SENTINEL 위반 — 테스트 후 즉시 원복·비활성 유지). cloudflared quick tunnel 재시작마다 URL이 바뀌므로, `~/.claude.json`에 프로젝트 스코프(`/root/14fiance`)와 전역 스코프에 각각 별도의 n8n-mcp 항목이 있을 수 있음 — 프로젝트 스코프 항목이 없으면 전역 항목으로 폴백되므로 **두 스코프 모두** URL/키 갱신 필요.
