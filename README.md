# realtime-trading

개인 투자 종목(비트코인 · 미국 반도체 지수 · 코스피/삼성전자/SK하이닉스) 실시간 트레이딩 대시보드 프로젝트.

## 문서

- **[트레이딩 대시보드 활용 가능성 검토 및 최적 제안](docs/trading-dashboard-feasibility.md)** — Claude Code × TradingView Desktop MCP 브리지 기반 대시보드의 가능성·비용·리스크 검토 및 2계층 하이브리드 아키텍처 제안

## 제안 요약

- **Layer 1 (즉시)**: TradingView MCP 브리지로 AI 보조 차트 분석·얼럿·리포트 자동화
- **Layer 2 (점진 구축)**: 이 레포에 무료 API(Upbit WebSocket, 한국투자증권 OpenAPI, Yahoo/FMP) 기반 자체 실시간 대시보드를 구축해 비공식 브리지 파손 리스크 헤지

## 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 1 (1주) | 브리지 설치·검증, 워치리스트·얼럿 구성 | 대기 |
| Phase 2 (2~4주) | 자체 대시보드 MVP — 6개 종목 실시간 시세 보드 | **스캐폴드 완료** |
| Phase 3 | 얼럿 통합, 노션 자동 데일리 리포트, 포트폴리오 손익 트래킹 | 대기 |

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

### 구조

```
server/
  index.js        # Express + WebSocket 서버 (피드 취합 → 브라우저 중계)
  config.js       # 종목·피드 매핑, 환경변수
  broadcaster.js  # 최신 시세 보관 + 클라이언트 팬아웃
  feeds/
    upbit.js      # Upbit 실시간 ticker
    kis.js        # 한국투자증권 실시간 체결가 (H0STCNT0)
    yahoo.js      # Yahoo Finance 폴링 (미국 반도체·지수·폴백)
public/           # 대시보드 UI (종목 타일 + 스파크라인, 다크모드 지원)
```

종목 추가/변경은 `server/config.js`의 `SYMBOLS` 배열만 수정하면 됩니다.
