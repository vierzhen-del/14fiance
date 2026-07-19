# kis-agent 통합 설계 — 계좌 잔고 조회 전용 (2026-07-19)

> 대상: [unohee/kis-agent](https://github.com/unohee/kis-agent) — 한국투자증권(KIS) OpenAPI
> 파이썬 래퍼 (CLI + SDK + `pykis-mcp-server`, MIT, v1.8.0 2026-07-17, 모의투자 지원).
> 상태: **설계만 확정 (구현은 P2, 후속 세션)**. 사용자 결정 2026-07-19.

## 왜 시세가 아니라 잔고인가

이 대시보드 server 모드에는 이미 자체 KIS 연동이 있다 — `server/config.js`의
`feed: kis`(실시간 웹소켓)·`kisfut`(선물 REST)·`KIS_ENABLED` 폴백. **시세 경로에
kis-agent를 끼워 넣으면 이중 구현**이 된다(파이썬 사이드카만 늘어남). 반면 지금까지
자동화가 없는 곳은 **계좌 잔고**다:

- 대시보드 포트폴리오는 `portfolio.json` 수동 입력
- 노션 "계좌 종목 현황 SOP"(자산 SSOT)는 **계좌 캡처 이미지 → Gemini 파싱**으로 갱신
  (수작업 + 파싱 오류 리스크, 14fiance CLAUDE.md의 자가검증 규칙이 필요해진 원인)

kis-agent의 `kis balance`(조회 전용)로 이 두 곳을 자동화하는 것이 통합의 핵심 가치다.

## 안전 경계 (필수 준수)

1. **매매(주문) API는 통합 범위에서 제외** — second-brain 지침의 투자 안전 경계와 동일.
   Claude는 매수/매도/비중조절을 실행하지 않는다. 조회 전용: 잔고·시세·체결내역.
2. **앱키·시크릿은 `.env` 전용, 커밋·전송 금지** — native 모드의 localStorage 규칙과
   동일 계열. `.gitignore` 확인 후 작업.
3. 첫 검증은 **모의투자(paper) 모드**로 (kis-agent `KIS_ENV` 방식은 이 repo
   `config.js`의 prod/vps 구분과 동일 개념).

## 아키텍처 (구현 시)

```
로컬 PC (Galaxy Book)
  kis-agent (pip install kis-agent, .env: APP_KEY/SECRET)
    └─ scripts/kis_balance_snapshot.py (신규, 조회 전용)
         ① kis balance → 계좌×종목×수량×평가액 JSON 스냅샷
         ② out: realtime-trading/portfolio.json 갱신 (대시보드 즉시 반영)
         ③ out: 노션 "계좌 종목 현황 SOP" 갱신용 보고 (Claude 세션이 검토 후 반영)
```

- **①→② 자동, ③은 반자동**: SSOT(노션) 갱신은 기존 자가검증 규칙(수량 1주 이상
  불일치 시 확인 요청, 매도이력 대장 우선 조회)을 거쳐야 하므로 스냅샷을 Claude
  세션에 전달해 검토 후 반영한다. 캡처 파싱의 **대체이자 교차검증 수단**.
- 실행 주기: 수동 실행부터 시작 → 안정화 후 Windows 작업 스케줄러 등록(장 마감 후 1회).
- 다계좌: KIS 앱키는 계좌(증권사 로그인) 단위 — 삼성/KB/신한 등 타 증권사 계좌는
  범위 밖(캡처 파싱 유지). **KIS 계좌만 자동화**된다는 한계를 명시.

## pykis-mcp-server 옵션 (2단계)

kis-agent 동봉 MCP 서버를 PC Claude에 등록하면 세션에서 잔고·시세를 직접 조회 가능.
등록 시 **조회 도구만 노출되는지 확인**하고, 주문 도구가 있으면 비활성/미등록.
1단계(스냅샷 스크립트) 안정화 후 도입 판단.

## 리스크

| 리스크 | 대응 |
|---|---|
| KIS API 일일 호출 한도 | 잔고 조회는 하루 1~수회라 여유. kis-agent 캐싱(80~95% 절감) 활용 |
| 접근토큰 24h 만료 | kis-agent가 자동 갱신 — 자체 구현 불필요 |
| 서드파티 의존(개인 레포) | MIT·활발한 릴리스(7/17 v1.8.0). 버전 고정(pip pin) + 이상 시 캡처 파싱 폴백 |
| 실계좌 오조작 | 조회 전용 스크립트로 한정, 모의투자 선검증, 주문 코드 경로 자체를 만들지 않음 |

## 구현 체크리스트 (P2, 후속 세션용)

- [ ] 사용자: KIS 개발자센터 앱키 발급(모의투자 우선), 로컬 `.env` 설정
- [ ] `scripts/kis_balance_snapshot.py` 작성 (조회 전용, JSON 출력)
- [ ] `portfolio.json` 스키마 매핑 + 대시보드 반영 확인
- [ ] 노션 SSOT 갱신 플로우에 스냅샷 교차검증 절차 추가 (14fiance CLAUDE.md 갱신)
- [ ] (2단계) pykis-mcp-server 조회 전용 등록 검토
