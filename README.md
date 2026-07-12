# realtime-trading

개인 투자 종목(비트코인 · 미국 반도체 지수 · 코스피/삼성전자/SK하이닉스) 실시간 트레이딩 대시보드 프로젝트.

## 문서

- **[트레이딩 대시보드 활용 가능성 검토 및 최적 제안](docs/trading-dashboard-feasibility.md)** — Claude Code × TradingView Desktop MCP 브리지 기반 대시보드의 가능성·비용·리스크 검토 및 2계층 하이브리드 아키텍처 제안
- **[모바일 · 갤럭시 탭 S9 운용 가이드](docs/mobile-guide.md)** — 같은 Wi-Fi 접속, Tailscale 원격 접속, Termux(태블릿 단독 실행), 24시간 상시 서버 구성 4가지 방식
- **[Phase 1 — TradingView MCP 브리지 설치 가이드](docs/phase1-bridge-guide.md)** — 브리지 설치, 디버그 포트 실행(OS별), Claude Code 등록, 워치리스트 구성과 활용 예시

## 제안 요약

- **Layer 1 (즉시)**: TradingView MCP 브리지로 AI 보조 차트 분석·얼럿·리포트 자동화
- **Layer 2 (점진 구축)**: 이 레포에 무료 API(Upbit WebSocket, 한국투자증권 OpenAPI, Yahoo/FMP) 기반 자체 실시간 대시보드를 구축해 비공식 브리지 파손 리스크 헤지

## 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 1 (1주) | 브리지 설치·검증, 워치리스트·얼럿 구성 | [설치 가이드](docs/phase1-bridge-guide.md) 제공 — 로컬 PC에서 진행 |
| Phase 2 (2~4주) | 자체 대시보드 MVP — 6개 종목 실시간 시세 보드 | **완료** |
| Phase 3 | 얼럿 통합, 노션 자동 데일리 리포트, 포트폴리오 손익 트래킹 | **완료** |

## Phase 2 대시보드 실행 방법

```bash
npm install
cp .env.example .env   # 필요 시 KIS 앱키 입력
npm start              # http://localhost:3000

# 외부 API 없이 UI만 확인하려면 (데모 모드)
MOCK=1 npm start
```

### 데이터 소스

| 종목 | 소스 | 비고 |
|---|---|---|
| 비트코인 (KRW-BTC) | Upbit WebSocket | 실시간, 키 불필요 |
| 삼성전자 · SK하이닉스 | 한국투자증권 OpenAPI 웹소켓 | 실시간, `.env`에 앱키 필요 — 미설정 시 Yahoo 지연 시세 폴백 |
| 코스피 · SOX · SOXX | Yahoo Finance 차트 API 폴링 | 지연 시세, 키 불필요 (`YAHOO_POLL_MS`로 주기 조절) |
| 나스닥100 선물 (NQ=F) | Yahoo Finance 차트 API 폴링 | CME E-mini, 거의 24시간 거래로 한국 야간 커버, 키 불필요 |
| 코스피200 선물 (야간) | 한국투자증권 선물옵션 시세 폴링 | KRX 야간파생시장(2025.6~) 종목 — 앱키 + `KIS_FUT_CODE`(최근월물 코드) 필요, 미설정 시 시세 대기 표시 |

### 구조

```
server/
  index.js        # Express + WebSocket 서버 (피드 취합 → 브라우저 중계)
  config.js       # 종목·피드 매핑, 환경변수
  broadcaster.js  # 최신 시세 보관 + 클라이언트 팬아웃
  feeds/
    upbit.js      # Upbit 실시간 ticker
    kis.js        # 한국투자증권 실시간 체결가 (H0STCNT0)
    kisFutures.js # 한국투자증권 선물옵션 시세 폴링 (코스피200 야간선물)
    yahoo.js      # Yahoo Finance 폴링 (미국 반도체·지수·선물·폴백)
public/           # 대시보드 UI (종목 타일 + 스파크라인, 다크모드 지원)
```

종목 추가/변경은 `server/config.js`의 `SYMBOLS` 배열만 수정하면 됩니다.

## Phase 3 기능

### 얼럿

```bash
cp alerts.config.example.json alerts.config.json   # 규칙 작성 후 서버 재시작
```

규칙 형태: `{ "symbolId", "type", "value", "note" }`
- `price_above` / `price_below`: 현재가 상향 돌파 / 하향 이탈
- `pct_move`: 전일 대비 등락률 절대값(%) 임계치

트리거되면 대시보드 얼럿 패널에 표시되고 데일리 리포트에 기록됩니다 (동일 규칙 30분 쿨다운).

### 포트폴리오 손익 트래킹

```bash
cp portfolio.example.json portfolio.json           # 보유 수량·평단가 입력 후 서버 재시작
```

대시보드 상단에 통화별 총 평가액·손익 요약 바, 각 보유 종목 타일에 손익이 표시됩니다 (환율 미적용, KRW/USD 분리 집계).

### 노션 데일리 리포트

- 매일 `REPORT_TIME`(기본 16:00 KST)에 자동 생성, `npm run report`로 수동 생성 (서버 실행 중이어야 함)
- 항상 `reports/YYYY-MM-DD.md`로 저장되며, `.env`에 `NOTION_API_KEY`·`NOTION_PARENT_PAGE_ID`를 설정하면 노션 페이지("데일리 시황 YYYY-MM-DD")로도 게시됩니다 — 설정 방법은 `.env.example` 주석 참고
- 내용: 종목별 시가/고가/저가/현재가/등락률, 당일 얼럿 이력, 포트폴리오 손익
