# 모바일 · 갤럭시 탭 S9 운용 가이드

대시보드는 반응형 웹이라 **서버가 어딘가에서 돌고 있으면 모바일 브라우저로 접속하기만 하면 됩니다.** 서버를 어디서 돌리느냐에 따라 4가지 운용 방식이 있습니다.

---

## 방식 1 — 집 PC에서 서버 실행 + 같은 Wi-Fi에서 접속 (가장 간단)

1. PC에서 `npm start` 로 서버 실행
2. PC의 내부 IP 확인: Windows `ipconfig` / macOS·Linux `ifconfig` (예: `192.168.0.10`)
3. 모바일·태블릿 브라우저에서 `http://192.168.0.10:3000` 접속
4. 브라우저 메뉴 → **"홈 화면에 추가"** 하면 앱처럼 아이콘으로 실행 가능

> Windows는 최초 실행 시 방화벽에서 Node.js의 사설 네트워크 접근을 허용해야 합니다.

- 장점: 설정 5분, 추가 비용 없음
- 한계: 같은 네트워크(집)에서만 접속 가능

## 방식 2 — Tailscale로 외부에서 접속 (외출 시, 권장)

포트포워딩 없이 어디서든 안전하게 접속하는 방법입니다.

1. [Tailscale](https://tailscale.com) 무료 가입 (개인 100대까지 무료)
2. 서버 PC와 모바일/태블릿에 Tailscale 앱 설치 → 같은 계정 로그인
3. 모바일에서 `http://<PC의 Tailscale IP>:3000` 접속 (IP는 앱에서 확인, 예: `100.x.y.z`)

- 장점: 공유기 설정 불필요, 대시보드가 인터넷에 공개되지 않음(내 기기끼리만 연결), 무료
- 대안: 포트포워딩 + DDNS도 가능하지만 이 대시보드에는 **로그인 인증이 없으므로** 인터넷에 직접 노출(포트 개방)은 권장하지 않습니다. 시세·포트폴리오 손익이 그대로 보입니다.

## 방식 3 — 탭 S9에서 직접 서버 실행 (Termux)

탭 S9은 성능이 충분해서 서버+화면을 한 기기에서 모두 돌릴 수 있습니다.

1. **Termux 설치** — Play 스토어 버전은 오래됐으므로 [F-Droid](https://f-droid.org/packages/com.termux/) 또는 GitHub 릴리스 버전 사용
2. Termux에서:
   ```bash
   pkg update && pkg install nodejs-lts git
   git clone https://github.com/vierzhen-del/14fiance.git
   cd 14fiance/realtime-trading
   npm install
   cp .env.example .env   # 필요 시 키 입력 (nano .env)
   npm start
   ```
3. 같은 기기 브라우저에서 `http://localhost:3000` 접속
4. **DeX 모드** 또는 멀티윈도우로 브라우저를 띄워 두면 전용 시세 모니터처럼 활용 가능

> 설정 → 배터리에서 Termux를 **배터리 사용량 최적화 제외**로 지정해야 화면을 끄거나 다른 앱을 쓸 때 서버가 종료되지 않습니다. Termux의 `termux-wake-lock` 명령도 함께 사용하면 안정적입니다.

- 장점: PC 불필요, 기기 하나로 24시간 운용 가능
- 한계: 안드로이드가 백그라운드 프로세스를 정리할 수 있어 장기 운용 안정성은 방식 4보다 떨어짐

## 방식 4 — 상시 서버(미니PC·라즈베리파이·클라우드)에서 24시간 운용

데일리 리포트 자동 생성(`REPORT_TIME`)과 얼럿을 하루 종일 놓치지 않으려면 서버가 항상 켜져 있어야 합니다.

1. 라즈베리파이·미니PC 또는 클라우드 VM(Oracle Cloud 무료 티어 등)에 Node.js 18+ 설치
2. 프로세스 매니저로 상시 구동:
   ```bash
   npm install -g pm2
   pm2 start server/index.js --name trading
   pm2 startup && pm2 save   # 재부팅 시 자동 시작
   ```
3. 모바일 접속은 방식 2(Tailscale)를 그대로 적용 — 클라우드 VM이라도 포트를 공개하지 말고 Tailscale로 연결하는 것을 권장

> 클라우드에 올릴 때 주의: `.env`의 KIS 앱키·노션 토큰이 서버에 저장되므로 VM 접근 통제(SSH 키, 방화벽)를 확인하세요.

---

## 어떤 방식을 고를까

| 상황 | 권장 |
|---|---|
| 집에서만 잠깐씩 확인 | 방식 1 |
| 외출 중에도 확인 | 방식 1 + 방식 2 (Tailscale) |
| PC 없이 탭 S9 하나로 | 방식 3 (Termux) |
| 얼럿·데일리 리포트를 24시간 놓치지 않기 | 방식 4 + 방식 2 |

## 참고 — TradingView MCP 브리지(Phase 1)와의 관계

Claude Code × TradingView MCP 브리지는 **데스크톱 전용**(TradingView Desktop + 로컬 브리지 필요)이라 모바일에서는 쓸 수 없습니다. 모바일·태블릿에서는 이 자체 대시보드(Layer 2)가 그 역할을 대신하며, 이것이 검토 문서에서 2계층 하이브리드를 제안한 이유 중 하나입니다. TradingView 앱(iOS/Android)을 병행 설치하면 차트 정밀 분석은 앱에서, 통합 모니터링·손익·얼럿은 이 대시보드에서 나눠 볼 수 있습니다.
