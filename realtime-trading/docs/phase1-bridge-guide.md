# Phase 1 — TradingView MCP 브리지 설치 가이드

> 검토 문서([trading-dashboard-feasibility.md](trading-dashboard-feasibility.md))의 Layer 1에 해당하는 단계입니다.
> Claude Code가 TradingView Desktop을 자연어로 제어(차트 읽기·심볼 전환·얼럿·Pine Script·스크린샷)할 수 있게 로컬 MCP 브리지를 설치합니다.
>
> ⚠️ **비공식 통합**: Chrome DevTools Protocol(CDP) 기반 오픈소스이며 TradingView 공식 기능이 아닙니다. TradingView 데스크톱 업데이트 시 작동이 중단될 수 있고, **차트 분석·모니터링 용도로만** 사용하세요 (매매 주문 자동화 금지).

## 1. 준비물

| 항목 | 비고 |
|---|---|
| TradingView Desktop | [tradingview.com/desktop](https://www.tradingview.com/desktop/) — 웹 브라우저 버전 아님 |
| Node.js 18+ | 자체 대시보드와 동일한 런타임 |
| Claude Code | 기존 구독 활용 |
| TradingView 계정 | 무료 플랜으로 시작 가능 (시나리오 A) |
| 브리지 소스 | [tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) (MIT 오픈소스) |

## 2. 브리지 설치

```bash
git clone https://github.com/tradesdontlie/tradingview-mcp.git ~/tradingview-mcp
cd ~/tradingview-mcp
npm install
```

## 3. TradingView Desktop을 디버그 포트로 실행

브리지는 CDP로 로컬 TradingView에 접속하므로, TradingView를 원격 디버깅 포트(9222)를 켠 채 실행해야 합니다. TradingView가 이미 실행 중이면 완전히 종료한 뒤 아래 명령으로 다시 실행합니다.

**Windows (Microsoft Store/MSIX 설치)**
```bat
:: 브리지에 포함된 실행 스크립트 사용
scripts\launch_tv_debug.bat
```
접근 거부 오류가 나면 브리지의 `tv_launch` MCP 도구가 MSIX 패키지를 로컬로 복사해 자동 처리합니다 — WindowsApps 폴더 권한은 직접 수정하지 마세요.

**Windows (일반 설치)**
```bat
%LOCALAPPDATA%\TradingView\TradingView.exe --remote-debugging-port=9222
```

**macOS**
```bash
/Applications/TradingView.app/Contents/MacOS/TradingView --remote-debugging-port=9222
```

**Linux**
```bash
/opt/TradingView/tradingview --remote-debugging-port=9222
```

> 💡 매번 플래그를 붙여 실행해야 하므로, 바로가기(Windows)나 alias(macOS/Linux)로 만들어 두면 편합니다.

## 4. Claude Code에 MCP 서버 등록

프로젝트의 `.mcp.json` 또는 전역 `~/.claude/.mcp.json`에 추가합니다 (`<INSTALL_PATH>`는 2단계에서 클론한 경로, 예: `~/tradingview-mcp`):

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["<INSTALL_PATH>/src/server.js"]
    }
  }
}
```

등록 후 Claude Code를 재시작하면 서버가 로드됩니다.

## 5. 연결 확인

Claude Code에서 브리지의 헬스체크 도구를 호출해 다음과 같은 응답이 나오면 성공입니다:

```json
{ "success": true, "cdp_connected": true, "chart_symbol": "...", "api_available": true }
```

간단히는 Claude Code에 이렇게 물어보면 됩니다: **"트레이딩뷰 연결 상태 확인해줘"**

## 6. 워치리스트 구성 (내 투자 종목)

TradingView에서 아래 심볼로 워치리스트를 만들어 두면 Claude가 순회 분석할 수 있습니다:

| 종목 | TradingView 심볼 |
|---|---|
| 비트코인 (KRW) | `UPBIT:BTCKRW` |
| 코스피 지수 | `KRX:KOSPI` |
| 삼성전자 | `KRX:005930` |
| SK하이닉스 | `KRX:000660` |
| 필라델피아 반도체지수 | `SOX` |
| iShares 반도체 ETF | `NASDAQ:SOXX` |
| 나스닥100 선물 (연속) | `CME_MINI:NQ1!` |
| 코스피200 선물 | TradingView 심볼 검색에서 KRX 선물 최근월물 확인 |

## 7. 활용 예시 (Phase 1 완료 기준)

로드맵의 완료 기준은 **"워치리스트 종목 순회 스캔 리포트 자동 생성"**입니다. Claude Code에 이런 식으로 지시해 보세요:

```
워치리스트의 8개 종목을 하나씩 돌면서:
1. 일봉 기준 주요 지지선/저항선을 식별하고
2. 각 차트를 스크린샷으로 캡처한 뒤
3. 종목별 한 줄 코멘트를 붙여 마크다운 리포트로 정리해줘
```

그 외 가능한 작업:
- **얼럿 생성**: "삼성전자 12만원 도달하면 얼럿 만들어줘"
- **Pine Script**: "SOX 대비 삼성전자 상대강도 지표 만들어서 차트에 적용해줘"
- **백테스트**: "이 전략을 비트코인 4시간봉으로 백테스트해줘"

## 8. 문제 해결

| 증상 | 조치 |
|---|---|
| 연결 실패 (`cdp_connected: false`) | TradingView가 `--remote-debugging-port=9222` 플래그로 실행됐는지 확인 (기존 프로세스 완전 종료 후 재실행) |
| Claude Code가 서버를 인식 못 함 | `.mcp.json` JSON 문법 확인 후 Claude Code 재시작 |
| Windows 접근 거부 | `tv_launch` 도구 사용 (권한 직접 수정 금지) |
| 데이터가 안 바뀜 | TradingView 로딩 완료까지 수 초 대기 |
| **업데이트 후 갑자기 중단** | 비공식 연동의 알려진 리스크 — 브리지 레포 이슈 확인, 자체 대시보드(Phase 2)로 모니터링 유지 |

TradingView 자동 업데이트를 지연시키면 파손 빈도를 줄일 수 있습니다.

## 9. 참고

- 원본 프로젝트: [tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) · [공식 SETUP_GUIDE](https://github.com/tradesdontlie/tradingview-mcp/blob/main/SETUP_GUIDE.md)
- TradingView Desktop v2.14+ 실행 버그 수정 포크: [LewisWJackson/tradingview-mcp-jackson](https://github.com/LewisWJackson/tradingview-mcp-jackson)
- 브리지는 로컬 CDP 폴링만 사용하며 TradingView 서버에 직접 접속하지 않습니다 (데이터는 내 PC 안에서만 이동)
