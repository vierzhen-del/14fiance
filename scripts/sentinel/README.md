# SENTINEL 정적 검사

n8n 워크플로우 배포 전 게이트의 1단계(정적). 의존성 0, Node 22+ 내장 모듈만 사용.
설계: 노션 "🤖 클로드 고레벨 활용 지침" 하단 "🛡️ SENTINEL 배포 전 검증 자동화 설계 확정" 참조.

## 사용법

```bash
node scripts/sentinel/check.mjs n8n/workflows/*.json   # 검사 (위반 시 exit 1 = 배포 차단)
node --test scripts/sentinel/check.test.mjs            # 테스트
```

## SENTINEL 5단계 매핑

| 단계 | 이 스크립트(정적) | 동적 검사(Playwright MCP, Tab S9 설치 후) |
|---|---|---|
| ① 비인증 라우트 | 인증 미설정 Webhook 노드 탐지 | cloudflared URL 비인증 요청 → 401/403 확인 |
| ② 미검증 입력 | SQL 표현식 보간·경로탐색(`../`) 탐지 | 이상 입력 POST → 4xx 확인 (500/200이면 실패) |
| ③ 시크릿 노출 | 토큰 패턴 하드코딩 탐지 (`REPLACE_ME_*`는 허용) | — |
| ④ CORS | `allowedOrigins: '*'`·와일드카드 헤더 탐지 | 타 origin fetch → 응답 헤더 확인 |
| ⑤ 파괴적 쿼리 | DROP/TRUNCATE/DELETE 탐지 → 사람 승인 요구 | — |

정적 전부 통과 → 동적 검사 → 전부 ✓ 후에만 `/go`(activate/배포).
동적 검사는 Playwright MCP 설치(Tab S9 할일) 후 Claude Code CLI에서 연결한다.
