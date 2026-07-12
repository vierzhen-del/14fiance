# realtime-trading

개인 투자 종목(비트코인 · 미국 반도체 지수 · 코스피/삼성전자/SK하이닉스) 실시간 트레이딩 대시보드 프로젝트.

## 문서

- **[트레이딩 대시보드 활용 가능성 검토 및 최적 제안](docs/trading-dashboard-feasibility.md)** — Claude Code × TradingView Desktop MCP 브리지 기반 대시보드의 가능성·비용·리스크 검토 및 2계층 하이브리드 아키텍처 제안

## 제안 요약

- **Layer 1 (즉시)**: TradingView MCP 브리지로 AI 보조 차트 분석·얼럿·리포트 자동화
- **Layer 2 (점진 구축)**: 이 레포에 무료 API(Upbit WebSocket, 한국투자증권 OpenAPI, Yahoo/FMP) 기반 자체 실시간 대시보드를 구축해 비공식 브리지 파손 리스크 헤지

## 로드맵

| 단계 | 내용 |
|---|---|
| Phase 1 (1주) | 브리지 설치·검증, 워치리스트·얼럿 구성 |
| Phase 2 (2~4주) | 자체 대시보드 MVP — 6개 종목 실시간 시세 보드 |
| Phase 3 | 얼럿 통합, 노션 자동 데일리 리포트, 포트폴리오 손익 트래킹 |
