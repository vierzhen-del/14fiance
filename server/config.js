import "dotenv/config";

export const PORT = Number(process.env.PORT ?? 3000);
export const YAHOO_POLL_MS = Number(process.env.YAHOO_POLL_MS ?? 15000);

// 한국투자증권 OpenAPI — 키가 없으면 국내 주식은 Yahoo 지연 시세로 폴백
export const KIS = {
  appKey: process.env.KIS_APP_KEY ?? "",
  appSecret: process.env.KIS_APP_SECRET ?? "",
  // prod: 실전투자 / vps: 모의투자
  env: process.env.KIS_ENV ?? "prod",
};
export const KIS_ENABLED = Boolean(KIS.appKey && KIS.appSecret);

// 대시보드에 표시할 종목 정의.
// feed: 어떤 피드 모듈이 이 종목을 담당하는지
//  - upbit  : Upbit WebSocket 실시간 (무료, 키 불필요)
//  - kis    : 한국투자증권 실시간 웹소켓 (무료, 앱키 필요) — 미설정 시 yahoo로 폴백
//  - kisfut : 한국투자증권 국내선물 REST 폴링 (앱키 필요) — KRX 야간시장 포함
//  - yahoo  : Yahoo Finance 차트 API 폴링 (무료, 지연 시세)
export const SYMBOLS = [
  {
    id: "btc",
    name: "비트코인",
    feed: "upbit",
    upbitCode: "KRW-BTC",
    currency: "KRW",
  },
  {
    id: "kospi",
    name: "코스피",
    feed: "yahoo", // 지수는 KIS H0STCNT0(주식 체결) 대상이 아니므로 MVP에서는 Yahoo 사용
    yahooSymbol: "^KS11",
    currency: "KRW",
    isIndex: true,
  },
  {
    id: "samsung",
    name: "삼성전자",
    feed: "kis",
    kisCode: "005930",
    yahooSymbol: "005930.KS", // KIS 미설정 시 폴백
    currency: "KRW",
  },
  {
    id: "hynix",
    name: "SK하이닉스",
    feed: "kis",
    kisCode: "000660",
    yahooSymbol: "000660.KS",
    currency: "KRW",
  },
  {
    id: "kospi200_fut",
    name: "코스피200 선물 (야간)",
    feed: "kisfut",
    // KRX 야간파생시장(2025.6 개장) 시세 — KIS 선물옵션 시세 API 폴링.
    // 최근월물 종목코드는 만기마다 바뀌므로 .env의 KIS_FUT_CODE로 지정한다.
    kisFutCode: process.env.KIS_FUT_CODE ?? "",
    currency: "KRW",
    isIndex: true, // 지수 포인트 표시
  },
  {
    id: "nasdaq_fut",
    name: "나스닥100 선물",
    feed: "yahoo",
    // CME E-mini 나스닥100 선물 — 거의 24시간 거래라 한국 야간 시간대를 커버
    yahooSymbol: "NQ=F",
    currency: "USD",
    isIndex: true,
  },
  {
    id: "sox",
    name: "필라델피아 반도체지수",
    feed: "yahoo",
    yahooSymbol: "^SOX",
    currency: "USD",
    isIndex: true,
  },
  {
    id: "soxx",
    name: "iShares 반도체 ETF",
    feed: "yahoo",
    yahooSymbol: "SOXX",
    currency: "USD",
  },
];
