# 작업 방식 메모 (이 저장소 전용)

## 세션 시작 시 브랜치 동기화 (2026-07-18)

코드 작업을 시작하기 전에 반드시 배포 브랜치(`claude/us-etf-mdd-calculator-gdwui7`)를 fetch해 개발 브랜치(`claude/saved-items-7bnk7u`)에 병합부터 할 것 — 다른 세션이 배포 브랜치에서 직접 작업한 커밋(캡처 파싱 재설계, realtime-trading 등 실사례 있음)을 개발 브랜치가 놓친 채 같은 파일을 고치면 병합 충돌·기능 되돌림이 발생한다.

## AI 캡처 파싱 — Claude API 비활성화 상태 (2026-07-18)

앱의 자동 캡처 파싱은 **Gemini API 전용**이다(사용자 확정: 무과금 최선). `capture/capture-parse.js`의 `CAPTURE_CLAUDE_API_DISABLED = true` 플래그가 Claude API 호출 경로 4곳(자동 파싱 primary·교차검증·연결 테스트·인앱 AI 리뷰)을 전부 차단하고, 구버전 localStorage의 provider="claude" 잔존값도 init에서 gemini로 마이그레이션한다. Anthropic 크레딧을 충전해 다시 쓰려면 이 플래그만 false로 바꾸면 된다. 방식1(프롬프트 복사→claude.ai 대화창 붙여넣기)은 API가 아니므로 항상 사용 가능. 대량 이미지는 `callVisionAPIBatched`가 5장씩 나눠 순차 호출한다(한 번에 다 보내면 뒷부분 이미지만 읽히는 문제 실측됨).

## 주식 프로젝트 통합 — realtime-trading/ (2026-07-12)

`realtime-trading/`은 원래 별도 레포(vierzhen-del/realtime-trading)였던 실시간 트레이딩 대시보드를 subtree 병합(이력 보존)으로 흡수한 서브디렉토리다. Node Express+WebSocket 서버 프로젝트로 **GitHub Pages 정적 사이트와 무관하게 로컬 PC에서 실행**하는 것이 기본이며(`cd realtime-trading && npm start`), 대시보드 클라이언트(`realtime-trading/public/`)는 3가지 모드를 자동 감지한다:

- **server**: Node 서버가 서빙(기존 동작 — /api/symbols + WebSocket, 포트폴리오·얼럿 포함)
- **mobile**: 서버 없이 정적 호스팅(Pages `…/14fiance/realtime-trading/public/`) — BTC는 Upbit WS 직접(실시간), 국내(삼성전자·하이닉스)는 기존 `live` 브랜치 latest_kr.json, 코스피지수·나스닥선물·SOX·SOXX는 **전용 `live-trading` 브랜치의 `latest_global.json`**(`.github/workflows/intraday-global.yml` + `scripts/fetch_intraday_global.py`, 7분·37분 offset 30분 주기 — live 브랜치와 같은 단일 커밋 force-push 구조이며 **live-trading 브랜치에도 다른 파일을 넣지 말 것**. 스케줄 지연 시 대응은 아래 국내시세 파이프라인 절과 동일: actions_list로 확인 후 run_workflow 수동 실행)
- **native**: 14fiance 안드로이드 앱(APK)의 하단 「📈 대시보드」 탭 — `app/build-www.mjs`가 `realtime-trading/public/`을 `www/dashboard/`로 복사. CapacitorHttp 덕에 CORS 없이 네이버·야후 직접 조회(실시간)하고, ⚙️ 설정 패널에 KIS 앱키·시크릿(+선물 종목코드)을 입력하면 KIS 시세·코스피200 야간선물까지 조회한다(키는 localStorage — 저장소·서버에 절대 커밋/전송 금지).

종목 목록을 바꿀 때는 `realtime-trading/server/config.js`(server 모드)와 `realtime-trading/public/symbols.js`(mobile/native 모드)를 함께 갱신해야 한다.

## 공통 SSOT — 노션 SOP 3종 (자산 데이터의 단일 기록처, 2026-07-06 제정)

사이트 "내 자산" 데이터의 원본은 아래 노션 페이지 3개다. 금융지식 세션(계좌캡처 반영)·이 코드 세션·추후 제작할 앱이 **모두 이 3페이지를 공통으로 갱신·참조**한다:

| 구분 | 페이지 ID | 역할 |
|---|---|---|
| 계좌 종목 현황 | `3955efd0-e462-81da-b7f3-cbd905a15dfd` (📊 14RAE 계좌 종목 현황 SOP) | 계좌×종목×수량 SSOT |
| 배당금 | `3865efd0-e462-81c4-9a72-c9bbc70dcea0` (💹 배당기준 마스터) | 확정 DPS·배당률·지급시기 |
| 월매수 | `38f5efd0-e462-81e8-a1a0-e35bfb864dc6` (📈 월자동매수 현황 & 월배당 비교) | ETF모으기 매수계획·금액 |

사용자가 **"자산 업데이트"**를 요청하면: 위 3페이지를 조회 → 매도이력 대장(`38d5efd0-e462-81ff-a961-cb9ce0f22f4f`) 우선 확인 → import JSON을 재생성해 SendUserFile로만 전달한다(개인 보유 데이터라 저장소 커밋 금지). **⚠️ 전달 전 자가검증 필수(2026-07-19 실수 복기로 제정)**: 생성 스크립트가 (a) `monthlyQty>0` 행 수를 출력해 월자동매수 SOP의 매수계획 종목 수와 부합하는지, (b) 3개 SOP 각각이 실제로 반영됐는지(계좌현황→qty, 배당마스터→confirmedDps/payPeriod, 월매수→monthlyQty/buyFreq/buyDay, 납입금→contributions)를 확인한 뒤에만 전달할 것 — 2026-07-18 실사례: 보유수량·DPS 재구성에 집중하다 월매수 SOP를 조회하지 않아 76행 전부 monthlyQty=0인 파일을 전달했고, 사용자가 앱에서 "월매수 계획 —" 빈 화면을 보고서야 발견됐다. **이력 필드(A8, 2026-07-16)**: 노션에 "자산 스냅샷 이력" 기록(사용자가 앱의 "📋 이력 SOP 요약 복사"로 붙여넣어 만든 페이지)이 있으면 그 값을 import JSON의 `snapshotHistory`(월별 `[{month,value,monthlyDiv}]`)·`dailyHistory`(일별 `[{date,value,monthlyDiv}]`)·`changelog` 필드에 채워 재설치 후에도 이력이 복원되게 한다 — 없으면 필드 생략(앱이 기존 localStorage 이력을 유지함). 이 3페이지 밖의 계좌·수량 출처(오래된 세션 기록 등)는 참고만 하고 SSOT와 충돌하면 SSOT를 따르되, 애매하면 사용자에게 확인한다. **워치리스트 필드(A10, 2026-07-16)**: import JSON에 `watchlist`(시그널 탭 관심종목 심볼 배열, 예: `["005930.KS","000660.KS","SOXL"]`)를 넣으면 복원되고, 생략하면 앱이 기존 localStorage 워치리스트를 유지한다 — "자산 업데이트" 시 보통 생략하면 된다.

## 주간 가격데이터 수집 — fetch-data.yml 이중 트리거 주의 (2026-07-19)

`.github/workflows/fetch-data.yml`은 **`push`(paths: `scripts/**`) 자동 트리거**를 갖고 있다 — `scripts/etf_list.json` 등을 수정해 push하면(개발·배포 브랜치 각각) 그것만으로 수집이 자동 실행된다. 따라서 **push 직후 `run_workflow` 수동 dispatch를 병행하지 말 것**(2026-07-18 실사례: push 2회 + 수동 1회 = 동시 3중 실행이 같은 브랜치에 데이터 커밋을 경쟁하다 push 단계 실패). 수동 실행은 `actions_list`로 확인해 자동 실행이 정말 안 됐을 때만. 워크플로에 concurrency 직렬화 + push 실패 시 rebase 재시도(2026-07-19 추가)가 있어 경합이 나도 데이터는 결국 반영되지만, 불필요한 동시 실행 자체를 만들지 않는 게 원칙. 또한 신규 종목이 앱에 "안 보인다"는 문의가 오면 저장소 데이터 반영 여부만 확인하고 끝내지 말 것 — 클라이언트 fetch는 캐시버스팅이 적용돼 있으나(2026-07-19 수정), 구버전 APK나 서비스워커 캐시 등 **사용자 화면까지의 전체 경로**를 점검한 뒤에 "해결됨"을 판정한다.

## 실시간(30분 예정) 국내시세 파이프라인

`.github/workflows/intraday-kr.yml`이 국내 장중(KST 09:05~15:35) 30분 주기(매시 5분·35분 — 전 세계 cron이 몰리는 정각·30분 congestion을 피하려 5분 offset)로 `scripts/fetch_intraday_kr.py`를 실행해 국내 전 종목 현재가를 **전용 `live` 브랜치에 단일 커밋 force-push** 한다(`latest_kr.json` — 개발 브랜치 이력을 오염시키지 않기 위한 구조이므로 live 브랜치에 다른 파일을 넣지 말 것). 사이트 "🔄 최신시세" 토글이 raw.githubusercontent.com으로 이 파일을 읽고, "⏱️ 지금 확인" 버튼은 브라우저 캐시만 무시하고 재조회할 뿐 GitHub 쪽 재실행을 강제하지는 않는다.

**⚠️ 스케줄 신뢰도 낮음(2026-07-06~10 실측 확인)**: GitHub 무료 스케줄 큐가 congestion 시 실행을 크게 지연시키거나(수 시간~반나절) 아예 드롭한다 — 하루 14회(30분×평일 6.5시간) 예정인데 실제로는 하루 2~4회만 실행된 사례가 확인됨. 정각 offset(5분·35분)으로 일부 완화를 시도했지만 근본 해결은 아니다. 사용자가 "시세가 안 갱신되는 것 같다"고 하면: (1) 먼저 `mcp__github__actions_list`로 `intraday-kr.yml`의 최근 실행 이력을 확인해 실제로 최근에 돌았는지 확인하고, (2) 안 돌았으면 `mcp__github__actions_run_trigger`(`run_workflow`)로 즉시 수동 실행해 당장의 데이터를 갱신해 줄 것 — 사이트 자체의 표시 로직 버그가 아니라 GitHub 스케줄 큐 문제일 가능성이 높다.

**근본 대응 — n8n workflow_dispatch 트리거(2026-07-20 도입)**: Tab S9의 n8n이 정상 동작 중이므로,
GitHub `schedule:` 큐를 우회하는 `workflow_dispatch` API 호출을 n8n이 30분마다 직접 실행한다
(`docs/n8n_intraday_kr_dispatch.md` + `docs/n8n_intraday_kr_dispatch_workflow.json`). 사용자 확정:
intraday-kr(가장 심각, 3/14회 측정)부터 먼저 적용 — intraday-global·signal-alert는 검증 후 동일
패턴으로 확장 예정. 기존 GitHub `schedule:` 트리거는 백업으로 유지(n8n/Tab S9 다운 시 대비 이중
안전망) — 둘이 겹쳐도 `concurrency: intraday-kr-${{ github.ref }}`(직렬화, 취소 안 함)로 안전.
PAT는 기존 Contents:Read 전용(3tv/second-brain 동기화용)과 분리된 **별도 Fine-grained PAT**
(`14fiance`만, `Actions: Read and write`)를 사용 — n8n 웹UI에만 입력, 대화/코드에 노출 금지.
**n8n 워크플로 설치·토큰 입력·활성화 완료(2026-07-20)** — intraday-kr 1단계만 우선 적용,
동일 커밋(concurrency 추가 포함)을 배포 브랜치(`claude/us-etf-mdd-calculator-gdwui7`)에도
fast-forward 병합해 실제로 반영 완료.

**2·3단계(intraday-global·signal-alert) — UTC↔KST 요일 경계 계산 완료, 활성화는 보류
(2026-07-20)**: GitHub `schedule:`은 UTC로 요일을 판정하는데 n8n은 Asia/Seoul(KST) 타임존이라,
자정을 넘나드는 구간에서 cron 문자열을 그대로 복사하면 "평일" 범위가 어긋난다(실측 계산·근거는
`docs/n8n_intraday_global_dispatch.md`). intraday-global(거의 24시간 운영)은 월요일 09~23시·
화~금 종일·토요일 00~08시 3규칙으로, signal-alert의 "익일 06:35" 알림은 요일도 화~토(2-6)로
shift해야 함을 확인(코멘트의 "익일"이 시각뿐 아니라 요일 범위에도 적용된다는 게 놓치기 쉬운
함정이었음). `intraday-global.yml`에 concurrency 블록도 추가(intraday-kr과 동일 패턴, 개발+배포
브랜치 양쪽 반영 완료). JSON·가이드는 `docs/n8n_intraday_global_dispatch_workflow.json` +
`docs/n8n_signal_alert_dispatch_workflow.json` + `docs/n8n_intraday_global_dispatch.md`에
준비 완료 — **intraday-kr의 실사용 검증(다음 장중 자동 발화 확인) 후 Tab S9에서 생성·활성화**할
것(사용자 확정 순차 확장 방침 유지, 아직 activate 안 함).

## 시그널 텔레그램 알림 파이프라인 (A12, 2026-07-17)

`.github/workflows/signal-alert.yml`이 평일 2회(16:05 KST 국내 마감 후 · 06:35 KST 미국 마감 후) `scripts/signal_alert.py`를 실행해 워치리스트(저장소 변수 `ALERT_WATCHLIST`, 기본 삼성전자·하이닉스·SOXL) 종목의 종합등급(📡 시그널 탭과 동일한 5투표: RSI14·다이버전스·볼린저·MACD·MA200이격)을 계산, **매일 요약 + 시그널 종목 🚨 강조** 메시지를 텔레그램으로 발송한다. 시크릿 `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` 미설정 시 안내 로그만 남기고 무해 종료. 직전 등급은 Actions 캐시(.alert_state.json — 저장소 커밋 안 함)로 보관해 등급 변화 시 🆕 표시. ⚠️ GitHub 무료 스케줄 지연/드롭 한계는 intraday와 동일 — 안 온다는 문의가 오면 `actions_list`로 실행 이력 확인 후 수동 실행. 지표 공식은 shared/myassets-utils.js와 교차검증된 동일 구현이므로 한쪽 수정 시 양쪽 동기화할 것.

## 종목 조회 시 노션 자동 기록 (기본 켜짐)

사용자가 국내 ETF 티커(예: 아직 `data/`에 없는 후보 종목)를 조회해달라고 요청하면:

1. 주가, 최근 배당금, 배당률(연율화), 월배당 여부, 분배금 주기를 조회한다.
   - **개별 배당락일(정확한 날짜)은 조회하지 않는다** — 네이버에 공개 API가 없어 확인 불가(2026-07 확인됨).
   - 대신 "분배금 주기"만 월초/월중/월말 3단계로 분류한다. 이 종목이 이미 아래 "배당기준_마스터"(개인 14RAE 포트폴리오 SOP)에 등록돼 있으면 그 값을 그대로 쓰고, 없으면 조회해서 "확인안됨"으로 둔다(추측 금지).
2. 조회 결과를 아래 노션 데이터베이스에 새 행으로 저장한다 — 별도 요청 없이 기본적으로 저장한다(끄고 싶다면 사용자가 그때그때 "저장하지 마"라고 말할 것).
   - 데이터베이스: 종목 조회 기록 (국내 ETF)
   - 데이터소스: `collection://aca14c30-8cc5-4265-bcd3-93d9cf61c552`
   - 페이지 URL: https://app.notion.com/p/7dc5a9eb1db94a7cbd8f68a318d0d071
   - 상위 페이지: "미국·한국 ETF MDD 계산기 — 개발 계획" (`3915efd0-e462-81ac-8525-da2f63a3ebb0`)
3. 컬럼: 티커, 종목명, 조회일, 주가, 최근 배당금, 배당률(연율화), 월배당 여부(월배당/분기·기타/확인안됨), 분배금 주기(월초/월중/월말/확인안됨), 비고.

## 배당(분배금) 조회 시 개인 14RAE 노션 SOP도 함께 업데이트

사용자가 본인이 실제 보유한 종목의 "이번 달 배당금"을 조회해달라고 하면(위 항목 1과 별개로, 개인 포트폴리오 관리 목적):

1. 먼저 "💹 14RAE 배당기준 마스터" 관련 노션 페이지에서 그 종목이 이미 등록돼 있는지, 등록된 분배금 주기(월초/월중/월말)가 무엇인지, 마지막 기록일이 언제인지 확인한다.
2. **재조회 주기 규칙**: 오늘 날짜와 노션 SOP에 기록된 마지막 조회일의 차이가 **7일 이상일 때만** 실제로 다시 조회해서 노션 SOP를 갱신한다. 7일 미만이면 다시 조회하지 않고 기존 노션 SOP 값을 그대로 써서 예측한다(불필요한 반복 조회 방지).
3. **배당금 결정 우선순위**:
   - ① 해당 기간의 **확정된 배당금**(예: "6월 배당 정산"처럼 이미 공시·확인된 DPS)이 있으면 그 값을 그대로 최우선 적용한다.
   - ② 확정값이 없어 예측해야 하는 경우: **조회 시점 주가 × 분배율(등록된 배당률)** 로 분배금(배당금)을 계산해서 쓴다.
4. 조회한(또는 계산한) DPS를 그 종목의 노션 SOP 이력 페이지에 새 "실행이력" 형태로 기록한다(기존 세션 기록 패턴 — 예: "14RAE 세션 — YYYY-MM-DD ..." 페이지들 — 을 따라 새 하위 페이지 추가). 조회일도 함께 남겨야 다음 재조회 시 7일 규칙을 판단할 수 있다.
5. **주의**: 이 SOP는 사용자의 실제 보유수량·평가금액과 직결된 민감한 개인 자산 기록이다. 자체 검증 규칙(수량 1주 오차 이상 불일치 시 확인 요청, 매도이력 대장 우선 조회 등, "🚫 14RAE 매도이력 & 계좌최신화 SOP" 페이지 참조)을 반드시 지키고, 애매하면 먼저 사용자에게 확인한다 — 조회했다고 곧바로 확정 수치를 덮어쓰지 않는다.

## "내 자산" 화면(사이트) 데이터 갱신 워크플로

사이트 index.html의 "💼 내 자산"은 종목별 **확정 DPS(원/주)** 입력을 지원한다(입력 시 월배당 = DPS × 수량으로 계산, TTM÷12 추정치보다 우선). 사용자가 "내 자산 배당(DPS) 갱신"을 요청하면:

1. 확정 DPS의 SSOT는 노션 "💹 14RAE 배당기준 마스터"(및 금융비서 세션이 그로부터 생성하는 대시보드 HTML의 월별 예상분배금 데이터)다. 위 섹션의 7일 재조회 규칙·확정값 우선순위(①확정 DPS → ②조회 시점 주가 × 등록 배당률)를 그대로 적용해 종목별 DPS를 정한다.
2. 그 DPS·수량·지급시기(월초/월중/월말)로 "📂 가져오기"용 import JSON을 재생성해서 **채팅 파일(SendUserFile)로만 전달**한다 — 개인 보유 데이터이므로 저장소에 절대 커밋하지 않는다.
3. JSON 형식: `{"rows":[{"account","symbol","qty","avgPrice","monthlyQty","buyFreq","buyDay","confirmedDps","payPeriod","divType","divExpiry"}...],"goalAmount","expectedReturn","contributions":{"계좌명":금액},"divHistory":{"YYYY-MM":원},"dataAsOf","importedAt"}`. 계좌명은 사용자 시트 표기(삼성_DC, 삼성_연금, 삼성_IRP, KB_일반, KB_ISA, 신한_일반 등)를 그대로 쓴다(사이트가 목록 밖 계좌명도 보존함). `monthlyQty`는 **1회 매수 수량**, `buyFreq`는 매수주기("매월"/"매주"/"매일" — 월횟수 1/4/22회로 환산), `buyDay`는 표시용 요일/일자 문자열("화요일"/"25일" 등, 계산엔 미사용). `divType`(실확/특별/고정)·`divExpiry`(특별배당 만료 YYYY-MM)는 노션 배당기준 마스터 기준, `divHistory`는 월별 확정 배당 총액 이력(연도별 배당추이 표에 표시). 매수계획만 있고 보유수량 미상인 종목은 `qty` 0 + `monthlyQty`>0으로 넣으면 평가액 0·월매수만 집계된다.
3-1. **지급시기 판정 우선순위**: 노션 배당기준 마스터(월초5일/월중15일/월말30일)가 대시보드 HTML의 월별 예상분배금 탭 표기보다 우선한다. (실사례: SOL 200타겟위클리커버드콜은 마스터=월초5일인데 v534 7월예상 탭에 월말로 잘못 표기돼 있어 월초로 정정함, 2026-07-05.)
4. DPS 미정 종목은 `confirmedDps`를 0으로 두면 사이트가 TTM 추정치로 대체하고 "추정" 라벨을 붙인다 — 미정임을 지어내지 않는다.
5. **상장 1개월 이내 신규 ETF 규칙(사용자 확정, 2026-07-05)**: 상장 후 1개월이 지나지 않은 ETF는 DPS를 미정으로 둔다(추정도 하지 않음). 이후 첫 분배금이 공시·확정되면 그때 확정 DPS로 반영한다. (예: KIWOOM 코스닥150커버드콜액티브 0198A0 — 2026-06-30 상장, 4계좌 보유, DPS 미정 상태로 등록.)
6. **계좌별 월 납입금**(연금저축 등, 배당 외 현금 납입): 노션에서 함께 확인해 `contributions`에 채운다 — 자급률 탭에서 해당 계좌 "수입"에 배당과 함께 합산된다.
