# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 저장소 상태

**이 저장소(14fiance)는 현재 비어 있는 신규 프로젝트입니다** (2026-07-10 기준, 커밋 없음). 아래 내용은 소유자의 운영 지침 v5.8 (노션: "🤖 클로드 고레벨 활용 지침", 2026.07.10)에서 가져온 프로젝트 규약입니다. 코드가 추가되면 빌드/테스트 명령어와 아키텍처 섹션을 갱신하세요.

## 언어

- 대화·문서: 한국어 / 코드·식별자·커밋 메시지: 영어
- 응답은 짧고 핵심만. 결론 먼저. 인트로/아웃트로 금지.

## 예정 스택 (버전 고정)

- Node.js 24.x LTS (22.x는 Maintenance — 신규 작업에 사용 금지)
- n8n 1.70.0 (self-hosted; 웹 커넥터 불가 → Claude Code CLI + n8n-MCP 조합)
- PostgreSQL 17
- 실행 환경: Tab S9 proot · Galaxy Book · Colab — 작업 전 실행 대상 선확인
- proot 환경: 절대경로 + nohup + 로그 필수
- 외부 노출: cloudflared 기준. localhost 하드코딩 금지

## 코딩 규칙 (CODE-MODE)

1. 모호하면 질문 — 가정하고 진행하지 않기
2. 요청된 것만 구현. 200줄이 50줄로 줄 수 있으면 재작성
3. 요청과 연결된 줄만 수정

## Git

- main 직커밋 금지 — 브랜치 분리
- 1기능 1커밋, 커밋 메시지에 why 포함
- push 전 diff 확인

## 테스트

- 버그 수정 순서: 재현 테스트 작성 → 수정 → 통과 확인
- 신규 기능은 최소 1개 테스트
- 테스트 불가 환경이면 수동 검증 절차를 명시

## 의존성

- 신규 패키지는 사전 승인 필요 (이유 + 대안 1개 제시)
- 버전 pin 필수 (Node 24.x LTS · n8n 1.70.0 · PG 17)
- Termux/proot 환경은 네이티브 빌드 가능 여부 선확인

## 에러 처리 · 버전 관리

- try-catch 최소화. 에러 메시지 = 원인 + 위치 + 다음 행동
- n8n 워크플로우 실패 노드 → Telegram 알림
- 문서/지침 버전: `ver{X.Y}+날짜`, CHANGELOG 3줄 상단, 구버전 보관 후 교체

## 보안 (SENTINEL — 배포 전 필수 체크)

배포 전 5단계, 전부 통과 후에만 진행:

1. 비인증 라우트 — 외부 엔드포인트는 Auth 헤더 필수(비인증 401), cloudflared URL은 공개 URL로 간주, Telegram chat_id 화이트리스트
2. 미검증 입력 — webhook·쿼리 파라미터 타입/범위 검증, SQL은 파라미터 바인딩만, 경로탐색(`../`) 차단
3. 시크릿 노출 — 하드코딩 금지, .env 분리 + .gitignore, 토큰·키는 출력/로그/Notion/커밋에 절대 미기록, 예시는 placeholder만
4. CORS — 와일드카드(`*`) 금지
5. 파괴적 쿼리 — DROP/DELETE/TRUNCATE/rm -rf는 대상 명시 + 사람 승인 후만 실행, write 전 dry-run, 스키마 변경 전 pg_dump

데이터: 증권 캡처는 DB 추출 후 이미지 참조 중단, 개인정보·계좌번호 로그 미포함, 주 1회 pg_dump 백업.

## 관련 저장소

- [vierzhen-del/githubinstall](https://github.com/vierzhen-del/githubinstall) — 설치 참조 repo (현재 placeholder 상태, 설치 명령어·GitHub 링크 모음 예정)

## 예정 작업 (노션 세션 로그 기준)

- n8n-MCP 서버 연결 (`npx n8n-mcp` + n8n API Key, cloudflared URL 헬스체크 선행)
- Notion DB → n8n → Obsidian vault 동기화 워크플로우 설계
- 환경별 Node 22 → 24.x 전환 (Tab S9 proot 등)
