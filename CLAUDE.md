# 14fiance — 저장소 안내 (AI 어시스턴트 전용)

**ETF 최대낙폭(MDD) 계산기 & 개인 자산 대시보드** — 미국·한국 ETF/주식의 가격·배당 데이터를 수집해 정적 사이트(GitHub Pages)로 제공하는 PWA. 빌드 단계 없이 순수 HTML/CSS/JS + Python 수집 스크립트로 구성된다.

## 1. 저장소 구조

```
14fiance/
├── index.html              # 단일 페이지 앱 전체 (약 4,400줄, UI+CSS+JS 인라인, 빌드 없음)
├── sw.js                   # 서비스워커 — PWA 오프라인 캐시 (stale-while-revalidate)
├── manifest.json           # PWA 매니페스트 (앱 이름·아이콘·테마색)
├── icons/                  # PWA 아이콘 (192/512/maskable)
├── data/                   # 가격·배당 데이터 (수집 스크립트가 자동 생성, 수동 편집 금지)
│   ├── manifest.json       #   전 종목 메타데이터(카테고리·기간·TTM배당) — index.html이 로드
│   ├── {SYMBOL}.json       #   종목별 일별 종가 이력 (예: SPY.json, 005930.KS.json)
│   ├── div/{SYMBOL}.json   #   미국 종목 배당 이력 (배당락일 단위, 한국은 API 미제공으로 없음)
│   └── fx/USDKRW.json      #   일별 원달러 환율 (FRED)
├── scripts/
│   ├── etf_list.json       #   수집 대상 종목 마스터 리스트 (us/kr 배열)
│   ├── fetch_data.py       #   주간 전체 수집 (표준 라이브러리만 사용, 의존성 설치 불필요)
│   └── fetch_intraday_kr.py#   국내 장중 30분 시세 수집
└── .github/workflows/
    ├── fetch-data.yml      #   토요일 06:00 KST — fetch_data.py 실행 후 data/ 커밋
    └── intraday-kr.yml     #   평일 09:00~15:30 KST 30분 주기 — live 브랜치에 force-push
```

## 2. 아키텍처 핵심

- **빌드 없음**: `index.html` 하나에 UI·CSS·JS가 모두 인라인으로 들어있다. 번들러·npm·TypeScript 없음. 로컬 확인은 `python -m http.server`로 정적 서빙 후 브라우저에서 열면 된다.
- **상태 관리**: 전역 `const state = { manifest: null, cache: new Map() }` (index.html:601). 종목 데이터는 fetch 후 `state.cache`에 메모리 캐시.
- **차트**: 외부 차트 라이브러리 없이 Canvas API로 직접 그린다 (`buildChart`, `buildCompareChart`, `buildSnapshotCanvas` — 스냅샷 PNG 생성/공유용).
- **PWA**: `sw.js`가 앱 셸 + `data/` 응답을 stale-while-revalidate로 캐시. `manifest.json`이 설치형 앱 메타데이터 정의.
- **외부 연동**: Kakao SDK(CDN)로 노션 페이지 공유. 노션 자체 API 직접 호출은 없고, 이 세션(Claude)이 Notion MCP로 조회/기록한다.
- **네이밍 컨벤션**: DOM id는 `sec-{name}`, `status-{name}` 패턴. CSS 커스텀 프로퍼티는 `--surface-1`, `--text-primary`, `--series-price`, `--cat-{1~8}`. 국내 종목 심볼은 `{코드}.KS` 접미사(예: `005930.KS`).

## 3. 데이터 파이프라인 (중요 — 함부로 손대지 말 것)

| 스크립트 | 트리거 | 소스 | 결과 |
|---|---|---|---|
| `scripts/fetch_data.py` | 매주 토요일 21:00 UTC + `scripts/**` push + 수동 dispatch | 미국: Twelve Data API (`TWELVEDATA_API_KEY` 필요), 배당 폴백 FMP(`FMP_API_KEY`, 선택) / 한국: 네이버 금융 `siseJson.naver` (키 불필요) / 환율: FRED | `data/*.json`, `data/div/*.json`, `data/fx/USDKRW.json`, `data/manifest.json`을 **현재 브랜치**에 일반 커밋 |
| `scripts/fetch_intraday_kr.py` | 평일 00:00~06:30 UTC 30분 주기 + 수동 dispatch | 네이버 모바일 증권 `m.stock.naver.com/.../basic` (종목당 1콜) | `latest_kr.json`을 **`live` 브랜치에 단일 커밋 force-push** (개발 브랜치 이력 오염 방지) |

- `live` 브랜치는 `latest_kr.json` 전용이다. 다른 파일을 넣지 말 것. 사이트의 "🔄 최신시세" 토글이 `raw.githubusercontent.com/.../live/latest_kr.json`을 직접 읽는다.
- 두 워크플로 모두 `permissions: contents: write`로 `github-actions[bot]` 계정이 커밋한다.
- Yahoo Finance·Stooq는 GitHub Actions 러너 IP가 차단되어 사용 불가 — 미국 가격은 반드시 Twelve Data 사용(`scripts/fetch_data.py` 상단 주석 참고).
- 한국 ETF 배당 이력은 네이버가 개별 배당락일 리스트를 제공하지 않아 `data/div/`가 없다 — `manifest.json`의 TTM 집계값(`ttmDividend`, `dividendYield`)만 네이버 `etfAnalysis` API의 계산값으로 채운다.

## 4. Git 브랜치 전략

- **`ver0.1`**: 메인 개발 브랜치.
- **`live`**: intraday 스크립트 전용, 항상 단일 커밋 force-push (히스토리 없음). 다른 목적으로 커밋하지 말 것.
- **`claude/*`**: 기능/실험 브랜치.
- 커밋 메시지는 Conventional Commits 스타일(`feat:`, `chore:`, `docs:`)을 한국어 설명과 함께 사용 (예: `feat: 자산변동 이력 드롭다운에 월별 옵션 추가`).
- `data/` 변경은 대부분 워크플로우 자동 커밋(`chore: update ETF price data`)이다 — 수동으로 `data/*.json`을 편집하지 말고 스크립트를 통해 갱신할 것.

## 5. 개발 시 확인 사항

- **새 종목 추가**: `scripts/etf_list.json`에 `{symbol, name, category, region, style}` 추가 → `python scripts/fetch_data.py` 로컬 실행(또는 다음 주간 워크플로 대기) → `data/manifest.json` 갱신 확인 → `index.html`에서 자동으로 목록에 나타남(하드코딩된 종목 리스트 없음).
- **UI 변경**: `index.html` 하나뿐이므로 관련 섹션(`sec-*` id)을 grep으로 먼저 찾을 것. 4,400줄이라 전체를 읽기보다 함수/섹션 단위로 검색.
- **로컬 실행 확인**: `cd 14fiance && python -m http.server 8000` 후 `http://localhost:8000` — 별도 dev server나 watch 빌드 없음.
- **개인 자산 데이터는 저장소에 커밋하지 않는다** — 아래 6번 섹션의 노션 SSOT 규칙을 반드시 따를 것.

---

## 6. 공통 SSOT — 노션 SOP 3종 (자산 데이터의 단일 기록처, 2026-07-06 제정)

사이트 "내 자산" 데이터의 원본은 아래 노션 페이지 3개다. 금융지식 세션(계좌캡처 반영)·이 코드 세션·추후 제작할 앱이 **모두 이 3페이지를 공통으로 갱신·참조**한다:

| 구분 | 페이지 ID | 역할 |
|---|---|---|
| 계좌 종목 현황 | `3955efd0-e462-81da-b7f3-cbd905a15dfd` (📊 14RAE 계좌 종목 현황 SOP) | 계좌×종목×수량 SSOT |
| 배당금 | `3865efd0-e462-81c4-9a72-c9bbc70dcea0` (💹 배당기준 마스터) | 확정 DPS·배당률·지급시기 |
| 월매수 | `38f5efd0-e462-81e8-a1a0-e35bfb864dc6` (📈 월자동매수 현황 & 월배당 비교) | ETF모으기 매수계획·금액 |

사용자가 **"자산 업데이트"**를 요청하면: 위 3페이지를 조회 → 매도이력 대장(`38d5efd0-e462-81ff-a961-cb9ce0f22f4f`) 우선 확인 → import JSON을 재생성해 SendUserFile로만 전달한다(개인 보유 데이터라 저장소 커밋 금지). 이 3페이지 밖의 계좌·수량 출처(오래된 세션 기록 등)는 참고만 하고 SSOT와 충돌하면 SSOT를 따르되, 애매하면 사용자에게 확인한다.

## 7. 실시간(30분) 국내시세 파이프라인

`.github/workflows/intraday-kr.yml`이 국내 장중(KST 09:00~15:30) 30분 주기로 `scripts/fetch_intraday_kr.py`를 실행해 국내 전 종목 현재가를 **전용 `live` 브랜치에 단일 커밋 force-push** 한다(`latest_kr.json` — 개발 브랜치 이력을 오염시키지 않기 위한 구조이므로 live 브랜치에 다른 파일을 넣지 말 것). 사이트 "🔄 최신시세" 토글이 raw.githubusercontent.com으로 이 파일을 읽는다.

## 8. 종목 조회 시 노션 자동 기록 (기본 켜짐)

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

## 9. 배당(분배금) 조회 시 개인 14RAE 노션 SOP도 함께 업데이트

사용자가 본인이 실제 보유한 종목의 "이번 달 배당금"을 조회해달라고 하면(위 항목 1과 별개로, 개인 포트폴리오 관리 목적):

1. 먼저 "💹 14RAE 배당기준 마스터" 관련 노션 페이지에서 그 종목이 이미 등록돼 있는지, 등록된 분배금 주기(월초/월중/월말)가 무엇인지, 마지막 기록일이 언제인지 확인한다.
2. **재조회 주기 규칙**: 오늘 날짜와 노션 SOP에 기록된 마지막 조회일의 차이가 **7일 이상일 때만** 실제로 다시 조회해서 노션 SOP를 갱신한다. 7일 미만이면 다시 조회하지 않고 기존 노션 SOP 값을 그대로 써서 예측한다(불필요한 반복 조회 방지).
3. **배당금 결정 우선순위**:
   - ① 해당 기간의 **확정된 배당금**(예: "6월 배당 정산"처럼 이미 공시·확인된 DPS)이 있으면 그 값을 그대로 최우선 적용한다.
   - ② 확정값이 없어 예측해야 하는 경우: **조회 시점 주가 × 분배율(등록된 배당률)** 로 분배금(배당금)을 계산해서 쓴다.
4. 조회한(또는 계산한) DPS를 그 종목의 노션 SOP 이력 페이지에 새 "실행이력" 형태로 기록한다(기존 세션 기록 패턴 — 예: "14RAE 세션 — YYYY-MM-DD ..." 페이지들 — 을 따라 새 하위 페이지 추가). 조회일도 함께 남겨야 다음 재조회 시 7일 규칙을 판단할 수 있다.
5. **주의**: 이 SOP는 사용자의 실제 보유수량·평가금액과 직결된 민감한 개인 자산 기록이다. 자체 검증 규칙(수량 1주 오차 이상 불일치 시 확인 요청, 매도이력 대장 우선 조회 등, "🚫 14RAE 매도이력 & 계좌최신화 SOP" 페이지 참조)을 반드시 지키고, 애매하면 먼저 사용자에게 확인한다 — 조회했다고 곧바로 확정 수치를 덮어쓰지 않는다.

## 10. "내 자산" 화면(사이트) 데이터 갱신 워크플로

사이트 index.html의 "💼 내 자산"은 종목별 **확정 DPS(원/주)** 입력을 지원한다(입력 시 월배당 = DPS × 수량으로 계산, TTM÷12 추정치보다 우선). 사용자가 "내 자산 배당(DPS) 갱신"을 요청하면:

1. 확정 DPS의 SSOT는 노션 "💹 14RAE 배당기준 마스터"(및 금융비서 세션이 그로부터 생성하는 대시보드 HTML의 월별 예상분배금 데이터)다. 위 섹션의 7일 재조회 규칙·확정값 우선순위(①확정 DPS → ②조회 시점 주가 × 등록 배당률)를 그대로 적용해 종목별 DPS를 정한다.
2. 그 DPS·수량·지급시기(월초/월중/월말)로 "📂 가져오기"용 import JSON을 재생성해서 **채팅 파일(SendUserFile)로만 전달**한다 — 개인 보유 데이터이므로 저장소에 절대 커밋하지 않는다.
3. JSON 형식: `{"rows":[{"account","symbol","qty","avgPrice","monthlyQty","buyFreq","buyDay","confirmedDps","payPeriod","divType","divExpiry"}...],"goalAmount","expectedReturn","contributions":{"계좌명":금액},"divHistory":{"YYYY-MM":원},"dataAsOf","importedAt"}`. 계좌명은 사용자 시트 표기(삼성_DC, 삼성_연금, 삼성_IRP, KB_일반, KB_ISA, 신한_일반 등)를 그대로 쓴다(사이트가 목록 밖 계좌명도 보존함). `monthlyQty`는 **1회 매수 수량**, `buyFreq`는 매수주기("매월"/"매주"/"매일" — 월횟수 1/4/22회로 환산), `buyDay`는 표시용 요일/일자 문자열("화요일"/"25일" 등, 계산엔 미사용). `divType`(실확/특별/고정)·`divExpiry`(특별배당 만료 YYYY-MM)는 노션 배당기준 마스터 기준, `divHistory`는 월별 확정 배당 총액 이력(연도별 배당추이 표에 표시). 매수계획만 있고 보유수량 미상인 종목은 `qty` 0 + `monthlyQty`>0으로 넣으면 평가액 0·월매수만 집계된다.
3-1. **지급시기 판정 우선순위**: 노션 배당기준 마스터(월초5일/월중15일/월말30일)가 대시보드 HTML의 월별 예상분배금 탭 표기보다 우선한다. (실사례: SOL 200타겟위클리커버드콜은 마스터=월초5일인데 v534 7월예상 탭에 월말로 잘못 표기돼 있어 월초로 정정함, 2026-07-05.)
4. DPS 미정 종목은 `confirmedDps`를 0으로 두면 사이트가 TTM 추정치로 대체하고 "추정" 라벨을 붙인다 — 미정임을 지어내지 않는다.
5. **상장 1개월 이내 신규 ETF 규칙(사용자 확정, 2026-07-05)**: 상장 후 1개월이 지나지 않은 ETF는 DPS를 미정으로 둔다(추정도 하지 않음). 이후 첫 분배금이 공시·확정되면 그때 확정 DPS로 반영한다. (예: KIWOOM 코스닥150커버드콜액티브 0198A0 — 2026-06-30 상장, 4계좌 보유, DPS 미정 상태로 등록.)
6. **계좌별 월 납입금**(연금저축 등, 배당 외 현금 납입): 노션에서 함께 확인해 `contributions`에 채운다 — 자급률 탭에서 해당 계좌 "수입"에 배당과 함께 합산된다.
