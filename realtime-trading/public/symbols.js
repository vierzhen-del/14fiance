// 서버 없이 동작하는 모드(mobile/native)용 종목 정적 정의.
// 서버 모드는 이 파일을 쓰지 않고 기존처럼 /api/symbols(server/config.js)를 사용한다 —
// 종목을 추가할 때는 server/config.js와 이 파일을 함께 갱신할 것.
//
// mobileFeed(웹 모바일 = GitHub Pages, CORS 제약 있음):
//   upbit  — Upbit 공개 WebSocket 직접 연결(실시간)
//   livekr — 14fiance live 브랜치 latest_kr.json (intraday-kr.yml, 30분 주기)
//   global — live-trading 브랜치 latest_global.json (intraday-global.yml, 30분 주기)
//   null   — 웹에서는 불가(타일에 안내 표시)
// nativeFeed(APK = CapacitorHttp가 fetch를 네이티브로 패치해 CORS 없음):
//   upbit / naver(주식 basic API) / naverIndex(지수 basic API) / yahoo(chart API)
//   kis(키 입력 시 국내주식 현재가 REST) / kisfut(키+선물코드 입력 시 선물 REST)
const DASH_SYMBOLS = [
  {
    id: "kospi",
    name: "코스피",
    currency: "KRW",
    isIndex: true,
    globalKey: "KOSPI",
    naverIndexCode: "KOSPI",
    mobileFeed: "global",
    nativeFeed: "naverIndex",
  },
  {
    id: "samsung",
    name: "삼성전자",
    currency: "KRW",
    krSymbol: "005930.KS", // latest_kr.json·네이버 API 키
    kisCode: "005930",
    mobileFeed: "livekr",
    nativeFeed: "naver",
  },
  {
    id: "hynix",
    name: "SK하이닉스",
    currency: "KRW",
    krSymbol: "000660.KS",
    kisCode: "000660",
    mobileFeed: "livekr",
    nativeFeed: "naver",
  },
  {
    id: "kospi200_fut",
    name: "코스피200 선물 (야간)",
    currency: "KRW",
    isIndex: true,
    // KRX 야간선물은 KIS 전용 — 웹 모바일에선 불가, 앱에선 KIS 키+선물코드 입력 시 조회
    mobileFeed: null,
    nativeFeed: "kisfut",
    unavailableNote: { mobile: "서버/앱 전용 (KIS API)", native: "⚙️ 설정에서 KIS 키·선물코드 입력 시 표시" },
  },
  {
    id: "nasdaq_fut",
    name: "나스닥100 선물",
    currency: "USD",
    isIndex: true,
    yahooSymbol: "NQ=F",
    globalKey: "NQ=F",
    mobileFeed: "global",
    nativeFeed: "yahoo",
  },
  {
    id: "sox",
    name: "필라델피아 반도체지수",
    currency: "USD",
    isIndex: true,
    yahooSymbol: "^SOX",
    globalKey: "^SOX",
    mobileFeed: "global",
    nativeFeed: "yahoo",
  },
  {
    id: "soxx",
    name: "iShares 반도체 ETF",
    currency: "USD",
    yahooSymbol: "SOXX",
    globalKey: "SOXX",
    mobileFeed: "global",
    nativeFeed: "yahoo",
  },
  {
    id: "btc",
    name: "비트코인",
    currency: "KRW",
    upbitCode: "KRW-BTC",
    mobileFeed: "upbit",
    nativeFeed: "upbit",
  },
];
