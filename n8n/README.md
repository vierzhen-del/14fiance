# Notion → Obsidian 동기화 (n8n 1.70.0)

설계: 노션 "🤖 클로드 고레벨 활용 지침" 하단 "🔄 동기화 워크플로우 설계 확정" 섹션 참조.
이 디렉토리는 Tab S9의 n8n에 임포트할 선구현 산출물이다. **이 repo 환경에서는 n8n 실행이 불가하므로 아래 수동 검증 절차가 테스트를 대체한다.**

## 착수 전 확인 4건 (구현 시작 전에 결정)

- [ ] 동기화 대상 Notion DB 선정 → `REPLACE_ME_NOTION_DATABASE_ID`
- [ ] vault 위치 확정 (가정: Tab S9 로컬) → `REPLACE_ME_VAULT_PATH`. S26에서 열람하려면 Syncthing 또는 Obsidian Sync 별도 구성
- [ ] 폴더 매핑 규칙 (현재: `vault/notion-sync/` 단일 폴더)
- [ ] 동기화 주기 (기본안 1시간 — Schedule Trigger에서 변경)

## Placeholder 치환 목록

| Placeholder | 위치 | 값 |
|---|---|---|
| `REPLACE_ME_NOTION_DATABASE_ID` | notion-obsidian-sync.json | Notion DB ID (URL의 32자 hex) |
| `REPLACE_ME_VAULT_PATH` | notion-obsidian-sync.json | vault 절대경로 (proot 규칙: 절대경로 필수) |
| `REPLACE_ME_TELEGRAM_CHAT_ID` | error-telegram.json | 화이트리스트에 등록된 본인 chat_id |

크레덴셜(Notion API·Postgres 17·Telegram Bot)은 n8n Credentials UI에서 생성 후 노드에 연결 — 토큰·키를 JSON/커밋/로그에 절대 기록하지 않는다.

## Tab S9 수동 검증 절차 (테스트 대체)

1. `psql -f n8n/sql/sync_state.sql` 실행 (스키마 생성)
2. n8n UI → Workflows → Import from File → `error-telegram.json` 먼저, 이후 `notion-obsidian-sync.json`
3. 두 워크플로우의 크레덴셜 연결 + placeholder 치환 확인
4. 메인 워크플로우 Settings → Error Workflow = "Error → Telegram Alert" 지정
5. 수동 1회 실행(Execute Workflow) → 확인:
   - `vault/notion-sync/`에 `.md` 파일 생성, front matter(title/notion_id/url/tags/updated) 정상
   - `SELECT count(*) FROM sync_state;` = 페이지 수
   - **재실행 시 파일 재작성 없음** (hash 동일 → Upsert & Diff에서 0 rows 반환)
   - `Upsert & Diff (PG)` 노드의 Query Parameters가 배열 표현식으로 안 들어가면: `queryReplacement`를 개별 표현식 5개로 분리
6. 배포 전 SENTINEL 정적 검사: `node scripts/sentinel/check.mjs n8n/workflows/*.json` 통과 확인
7. Activate → 다음 정시 실행 로그 확인

## 동작 요약

매시간 → Notion DB 전체 페이지 조회 → Markdown(YAML front matter) 생성 + sha256 → PG `sync_state`에 조건부 upsert(해시가 다를 때만 row 반환) → **변경된 페이지만** `vault/notion-sync/<slug>.md`로 기록. 삭제는 하지 않는다(파괴적 작업 금지 — Notion에서 삭제된 페이지의 파일 정리는 수동 또는 v2의 `_trash/` 이동으로).

- Phase 1(현재): properties만 → front matter + 원본 링크
- Phase 2: **설계 확정** (2026-07-10, 노션 v5.8 하단 "🧠 Phase 2 설계 확정" 참조) — 블록 본문→Markdown(HTTP+notionApi, depth 1) + OKF 폴더 구조(카테고리 폴더 + index.md 자동 생성, sync_state v2). Phase 1이 Tab S9 수동 검증을 통과한 뒤 구현 착수
