# 14fiance — 저장소 함정 메모

## 모델별 동작 (2026-07-25, Anthropic Claude 5 컨텍스트 엔지니어링 가이드 반영)

이 문서는 **열어보기 전엔 모를 함정**만 담는다. 절차 상세는 `.claude/skills/`에 있고 필요할 때만 연다.

- **Opus 5 / Fable 5** (`claude-opus-5`, `claude-fable-5`): 아래를 금지령이 아니라 배경지식으로 읽고,
  주변 코드·맥락에 맞춰 스스로 판단한다. 스킬 문서는 그 작업을 실제로 할 때만 연다.
- **Sonnet 5 이하 · Haiku · 타사 모델(Gemini 등)**: 해당 스킬 문서를 **먼저 열어** 절차대로 수행하고,
  판단으로 단계를 건너뛰지 않는다.
- **모델과 무관하게 항상 유효**: 개인정보·보유자산 데이터 커밋 금지, 매매 자문 금지, 시크릿 노출 금지.
- 모델 세대가 올라가면 옛 약점을 막으려 세워둔 규칙부터 걷어낸다 (`/doctor`로 점검).

원본 규칙: second-brain 볼트 `14rae_work/00_지침/2026-07-25_모델별-운영규칙.md`

## 스킬 (필요할 때만 열기)

| 스킬 | 언제 |
|---|---|
| `내자산` | 자산 관련 **대화 전반** — 보유·배당 질답, 이상감지, 계좌반영 전과정, 배당기준·노션 SOP 관리 |
| `자산업데이트` | "자산 업데이트" · "내 자산 배당(DPS) 갱신" — 노션 SOP 3종 → import JSON |
| `종목조회` | 국내 ETF 티커 조회 · 보유종목 이번 달 배당 · 노션 자동 기록 |
| `시세파이프라인` | 시세·알림이 안 갱신됨 · 신규 종목이 앱에 안 보임 · 워크플로 진단 |
| `github-14fiance` | 브랜치 지도 · 커밋/푸시 · Actions 수동 실행 |

## 함정

**세션 시작 시 브랜치 동기화** — 코드 작업 전에 배포 브랜치(`claude/us-etf-mdd-calculator-gdwui7`)를
fetch해 개발 브랜치에 병합부터 한다. 다른 세션이 배포 브랜치에서 직접 작업한 커밋을 놓친 채 같은
파일을 고치면 병합 충돌·기능 되돌림이 발생한다(실사례 있음). 상세는 `github-14fiance` 스킬.

**내 자산 로직은 `index.html` 과 `shared/myassets.js` 이중 미러** — 루트 사이트(GitHub Pages)는
`index.html` 안의 인라인 `<script>` 사본으로 돌고, `shared/myassets.js` 는 `capture/index.html` 과
안드로이드 앱(`app/build-www.mjs`)이 로드한다. 둘은 **바이트 단위로 같은 사본**이라(`buildReportText`,
`lastChangePct`, `maskAccountLabel` 등) 한쪽만 고치면 사이트와 앱의 동작이 조용히 갈라진다.
고칠 때는 같은 문자열 치환을 두 파일에 함께 적용하고, 끝나면 두 사본이 동일한지 확인할 것.

**AI 캡처 파싱은 Gemini 전용** — `capture/capture-parse.js` 의 `CAPTURE_CLAUDE_API_DISABLED = true` 가
Claude API 호출 경로 4곳(자동 파싱 primary·교차검증·연결 테스트·인앱 AI 리뷰)을 전부 차단하고,
구버전 localStorage의 `provider="claude"` 잔존값도 init에서 gemini로 마이그레이션한다. Anthropic
크레딧을 충전해 다시 쓰려면 이 플래그만 false로 바꾸면 된다(3tv의 `models.claude_disabled` 와 같은 계열).
방식1(프롬프트 복사 → claude.ai 붙여넣기)은 API가 아니므로 항상 가능. 대량 이미지는
`callVisionAPIBatched` 가 5장씩 나눠 순차 호출한다 — 한 번에 다 보내면 뒷부분 이미지만 읽히는 문제가
실측됐다.

**realtime-trading 종목 목록은 두 곳** — `realtime-trading/` 은 별도 레포였던 실시간 트레이딩
대시보드를 subtree 병합(이력 보존)으로 흡수한 서브디렉토리다. 종목 목록을 바꿀 때
`realtime-trading/server/config.js`(server 모드)와 `realtime-trading/public/symbols.js`(mobile/native 모드)를
**함께** 갱신해야 한다. 클라이언트는 3모드를 자동 감지한다:

- **server** — Node 서버가 서빙(`cd realtime-trading && npm start`). GitHub Pages와 무관하게 로컬 PC에서
  실행하는 것이 기본. /api/symbols + WebSocket, 포트폴리오·얼럿 포함
- **mobile** — 서버 없이 정적 호스팅. BTC는 Upbit WS 직접, 국내는 `live` 브랜치 `latest_kr.json`,
  코스피지수·나스닥선물·SOX·SOXX는 `live-trading` 브랜치 `latest_global.json`
- **native** — 안드로이드 앱 하단 「📈 대시보드」 탭(`app/build-www.mjs` 가 `public/` → `www/dashboard/` 복사).
  CapacitorHttp 덕에 CORS 없이 네이버·야후 직접 조회. ⚙️ 설정 패널의 KIS 앱키·시크릿은 localStorage에만
  두고 **저장소·서버에 절대 커밋/전송 금지**

**`live` / `live-trading` 브랜치는 데이터 전용** — 각각 `latest_kr.json` / `latest_global.json` 단일 커밋
force-push 구조다. 다른 파일을 넣지 말 것.

**`fetch-data.yml` 은 push로도 자동 실행된다** — `scripts/**` 수정 push만으로 수집이 돌므로 직후에
수동 dispatch를 병행하면 동시 실행이 데이터 커밋을 경쟁한다. 상세는 `시세파이프라인` 스킬.

**개인 자산 데이터는 저장소에 커밋하지 않는다** — import JSON 등 보유 데이터는 SendUserFile로만 전달한다.

**3tv(삼프로TV) 연동 종목은 여기 등재해야 조회가 된다** — `scripts/etf_list.json`은 정적 큐레이션
목록이라, 3tv 리포트(삼프로TV 방송 캡처)나 노션의 "ETF 등락 상위/하위" 리포트에 새 종목코드가
나와도 이 파일에 없으면 14fiance는 그 종목을 전혀 모른다(가격도, 이름도 조회 불가 — 자동 이름
조회 API가 없다, `fetch_data.py`는 이미 이름이 정해진 종목의 **가격만** 받아온다). 2026-07-28 실측:
3protv 노션 리포트의 등락 상/하위 20종이 전부 이 목록에 없었다. **3tv 쪽에서 ETF를 조회했는데
14fiance에 없으면(=이름을 모르면) `scripts/etf_list.json`의 `kr`(국내) 또는 `us`(미국) 배열에
`{symbol(.KS 포함), name, category, region, style}`을 추가하고 배포 브랜치
(`claude/us-etf-mdd-calculator-gdwui7`)에 커밋·푸시한다** — 이러면 다음 `fetch-data.yml` 실행부터
가격 이력도 쌓이기 시작한다.

**배당 분배율(`divRate`)이 빠지면 월배당이 조용히 부풀어 오른다** — 앱은 월배당을
①등록 분배율×현재가 → ②확정DPS÷수집종가 역산 → ③TTM 역산 순으로 계산한다.
import JSON에 `divRate`가 없으면 ②로 떨어지는데, 확정DPS는 **과거 기준주가**로 산정된 값이라
**주가가 빠진 종목일수록 역산 분배율이 커진다**(A24c가 의도한 "주가↓→분배금↓"의 정반대).
2026-08-02 실사례: 472150 DPS 581원(6월 기준주가 29,050×2.00%) ÷ 현재가 20,190 = 2.88%로 오인,
월배당 ₩2.29M 과대계상. **노션 배당기준 마스터의 배당률을 반드시 `divRate`로 실어 보낼 것.**
