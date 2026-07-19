// capture/capture-parse.js — 캡처 이미지 → AI 비전 파싱 → 교차검증 (M2)
// capture 앱 전용(index.html/shared에는 없음). state.listedEtfs/state.metaBySymbol에 의존(초기화 후 호출).

const CAPTURE_AI_PROVIDER_KEY = "capture_ai_provider"; // "claude" | "gemini" — 기본 gemini(크레딧 소모 없음)
const CAPTURE_CLAUDE_KEY = "capture_claude_key";
const CAPTURE_GEMINI_KEY = "capture_gemini_key";
const CAPTURE_CLAUDE_MODEL_KEY = "capture_claude_model"; // A19: 소넷/하이쿠 선택(2026-07-18 프롬프트 비교테스트 후속)
const CAPTURE_CLAUDE_MODEL_DEFAULT = "claude-sonnet-5";
const CAPTURE_GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";
// Claude API를 자동 파싱에 "추가로" 부를지(교차검증) 여부 — 기본 꺼짐. 크레딧을 쓰는
// 유일한 자동 경로이므로 사용자가 명시적으로 켜야만 호출된다(3순위 원칙).
const CAPTURE_USE_CLAUDE_CROSSCHECK_KEY = "capture_use_claude_api_v1";
// A20(2026-07-18 사용자 확정): 앱 파싱은 제미나이 전용, 무과금 최선. Claude API 크레딧이
// 없는 상태에서 구버전 localStorage에 provider="claude"가 잔존해 400 오류로 파싱 전체가
// 실패한 실사례가 원인 — 이 플래그가 켜져 있으면 저장값과 무관하게 Claude API 호출 경로
// (자동 파싱 primary·교차검증·연결 테스트·인앱 AI 리뷰)를 전부 차단한다. 크레딧 충전 후
// 다시 쓰려면 false로 바꾸면 나머지 코드는 그대로 원복된다.
const CAPTURE_CLAUDE_API_DISABLED = true;
// A20: 대량 이미지를 한 번에 보내면 뒷부분 이미지만 처리되는 멀티이미지 한계가 실측됨
// (37행 계좌 전체 첨부 → 마지막 화면들의 7행만 반환) — 이 장수 단위로 나눠 순차 호출한다.
// A20g(2026-07-18): 5장 배치로도 여전히 추출 부족 보고 — 배치 내에서도 같은 종류의 주의
// 소실이 재현될 수 있다고 보고 3장으로 축소(호출 횟수는 늘지만 Gemini는 무과금이라 비용 문제 없음).
const CAPTURE_PARSE_BATCH_SIZE = 3;

/* ---------- 이미지 전처리 ---------- */
function resizeImageFile(file, maxDim = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.onerror = () => reject(new Error("이미지 디코딩 실패"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
}

/* ---------- AI 비전 API 직접 호출(브라우저) ----------
   개인 단독 사용자·본인 API 키 전제. 키는 이 기기(localStorage)에만 저장되고
   서버를 거치지 않고 브라우저에서 각 API로 직접 전송된다 — 네트워크 탭에
   그대로 노출되므로 타인과 공유하지 말 것(설정 카드에 문구로도 안내). */
async function callClaudeVision(images, promptText, apiKey, model) {
  const content = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.base64 },
  }));
  content.push({ type: "text", text: promptText });
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: model || CAPTURE_CLAUDE_MODEL_DEFAULT, max_tokens: 4096, messages: [{ role: "user", content }] }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Claude API 오류 ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return (data.content || []).map((b) => b.text || "").join("");
}

async function callGeminiVision(images, promptText, apiKey, model) {
  const parts = [{ text: promptText }, ...images.map((img) => ({ inline_data: { mime_type: img.mediaType, data: img.base64 } }))];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || CAPTURE_GEMINI_MODEL_DEFAULT}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Gemini API 오류 ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return ((data.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

/* 이미지 없이 텍스트 1건만 보내는 최소비용 호출 — "연결 테스트" 버튼 전용(A3d).
   실제 파싱 비용(이미지 인코딩·토큰)을 쓰지 않고 키·엔드포인트·모델명이 유효한지만 확인한다. */
async function pingClaudeAPI(apiKey) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: CAPTURE_CLAUDE_MODEL_DEFAULT, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const err = new Error(errText.slice(0, 200));
    err.status = resp.status;
    throw err;
  }
  return true;
}

async function pingGeminiAPI(apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CAPTURE_GEMINI_MODEL_DEFAULT}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const err = new Error(errText.slice(0, 200));
    err.status = resp.status;
    throw err;
  }
  return true;
}

/* 상태코드로 대략적인 원인을 짐작만 하지 않고, API가 돌려준 실제 오류 본문(errText)을 함께
   보여준다 — 특히 400은 "모델명 오류"일 수도, 완전히 다른 요청 형식 문제일 수도 있어
   짐작만으로는 정확한 진단이 안 된다(실제로 이 문구 때문에 원인 파악이 늦어진 사례). */
function friendlyPingErrorText(providerLabel, err) {
  const status = err && err.status;
  const msg = (err && err.message) || "";
  // Anthropic은 크레딧 부족도 HTTP 400 invalid_request_error로 응답한다 — 진짜 요청 형식
  // 문제와 섞이면 원인 파악이 늦어지므로(과거 실제 발생 사례) 이 메시지만 따로 구분한다.
  const reason = status === 401 || status === 403 ? "키가 잘못됐거나 권한이 없습니다"
    : status === 429 ? "요청이 너무 많습니다(잠시 후 재시도)"
    : status === 400 && /credit balance/i.test(msg) ? "크레딧 잔액 부족 — Anthropic Console(Plans & Billing)에서 충전 필요"
    : status === 400 ? "요청 형식 오류"
    : status ? `오류(HTTP ${status})`
    : "네트워크 오류(연결 확인 필요)";
  const detail = msg ? ` — ${msg}` : "";
  return `❌ ${providerLabel} ${reason}${detail}`;
}

/* 자동 파싱 3단계 우선순위(크레딧 소모 없는 순서로):
   1) 클로드 대화창(방식1) — 이 함수가 아니라 "📋 프롬프트 복사"+붙여넣기 모드로 처리(API 호출 없음)
   2) Gemini API(방식2, 기본) — provider가 gemini면 이것만 단독 호출
   3) Claude API(방식3, 옵트인) — provider를 명시적으로 claude로 선택했거나, 옵트인
      체크박스(CAPTURE_USE_CLAUDE_CROSSCHECK_KEY)를 켰을 때만 호출된다. 옵트인일 때는
      Gemini 호출에 "추가로" 동시 호출해 교차검증한다(A3d 패턴 유지) — 그 외에는
      Claude API가 자동으로 불리는 경로가 전혀 없다(크레딧 과금 방지가 핵심 요구사항).
   claudePromptText/geminiPromptText는 별도 편집·저장 가능한 지침(capture-parse.js
   getEffectivePrompt/getGeminiPrompt)을 각 provider에 맞게 전달받는다. */
async function callVisionAPI(images, claudePromptText, geminiPromptText) {
  // A20: 비활성화 플래그가 켜져 있으면 저장된 provider가 "claude"여도 무시하고 Gemini로
  // 강제 — 구버전 localStorage 잔존값 때문에 Claude API가 호출되는 사고를 원천 차단.
  const provider = CAPTURE_CLAUDE_API_DISABLED ? "gemini" : (localStorage.getItem(CAPTURE_AI_PROVIDER_KEY) || "gemini");
  const useClaudeCrossCheck = !CAPTURE_CLAUDE_API_DISABLED && localStorage.getItem(CAPTURE_USE_CLAUDE_CROSSCHECK_KEY) === "1";
  const claudeKey = localStorage.getItem(CAPTURE_CLAUDE_KEY);
  const geminiKey = localStorage.getItem(CAPTURE_GEMINI_KEY);
  const claudeModel = localStorage.getItem(CAPTURE_CLAUDE_MODEL_KEY) || CAPTURE_CLAUDE_MODEL_DEFAULT;

  const primaryIsClaude = provider === "claude";
  const primaryKey = primaryIsClaude ? claudeKey : geminiKey;
  if (!primaryKey) throw new Error(`${primaryIsClaude ? "Claude" : "Gemini"} API 키가 설정탭에 입력되어 있지 않습니다.`);
  const source = primaryIsClaude ? "claude-api" : "gemini";
  const callPrimary = () =>
    primaryIsClaude ? callClaudeVision(images, claudePromptText, claudeKey, claudeModel) : callGeminiVision(images, geminiPromptText, geminiKey);

  // Claude API 동시 교차검증: primary가 이미 claude면 의미 없고, 옵트인이 꺼져 있거나
  // Claude 키가 없으면 걸지 않는다 — 이 조건을 만족해야만 Claude API가 추가로 호출된다.
  const wantClaudeCross = !primaryIsClaude && useClaudeCrossCheck && claudeKey;
  if (!wantClaudeCross) {
    return { primaryText: await callPrimary(), crossText: null, crossProvider: null, crossError: null, source };
  }

  const [primaryResult, otherResult] = await Promise.allSettled([
    callPrimary(),
    callClaudeVision(images, claudePromptText, claudeKey, claudeModel),
  ]);
  if (primaryResult.status === "rejected") throw primaryResult.reason;
  return {
    primaryText: primaryResult.value,
    crossText: otherResult.status === "fulfilled" ? otherResult.value : null,
    crossProvider: "claude-api",
    crossError: otherResult.status === "rejected" ? otherResult.reason.message : null,
    source,
  };
}

/* A20: 배치 분할 파싱 — 이미지가 CAPTURE_PARSE_BATCH_SIZE보다 많으면 나눠서 순차 호출하고
   결과를 병합한다. 실측(37행 계좌 전체를 한 번에 첨부 → 마지막 화면들의 7행만 반환)에서
   확인된 멀티이미지 주의 소실을 구조적으로 회피하는 게 목적. 병합 규칙:
   - holdings: 배치별 결과를 이어 붙이되 page를 전체 이미지 기준 순번으로 재매핑
   - account_label: 첫 번째 non-null 값
   - reported_total(·_monthly_amount): 모든 배치가 같은 값이면 채택, 불일치면 null(확정 불가)
   - 일부 배치 실패: 나머지는 계속 진행하고 실패 내역을 crossError로 표시(전부 실패 시에만 throw)
   반환 형태는 callVisionAPI와 동일(primaryText=병합 JSON 문자열)이라 호출부 계약이 안 바뀐다.
   배치 모드에서는 Claude 교차검증(crossText)을 켜지 않는다(배치 간 대조 병합이 복잡해지는
   데 비해 효익이 없고, A20 현재는 Claude API 자체가 비활성화 상태). */
// A23(2026-07-18 실측): 37장→13배치 실기기 파싱에서 1배치 성공 후 12배치가 전부
// "Unable to resolve host"로 연쇄 실패 — 기기 네트워크 순단(모바일 DNS 순단·화면 꺼짐 등)
// 한 번에 나머지 배치가 다 죽는 구조였다. 배치마다 아래 지연으로 최대 3회 재시도한다.
const CAPTURE_BATCH_RETRY_DELAYS_MS = [2000, 5000];
// 400/401/403은 키·요청 형식 등 영구 오류라 재시도해도 같은 결과(즉시 실패 처리).
// 429(과다요청)·5xx·네트워크 오류·JSON 파싱 실패는 재시도 대상.
function isPermanentApiError(err) {
  return /API 오류 (400|401|403)\b/.test((err && err.message) || "");
}
const CAPTURE_NETWORK_ERR_RE = /resolve host|failed to fetch|network|ERR_NAME|ERR_INTERNET|ERR_CONNECTION/i;

async function callVisionAPIBatched(images, claudePromptText, geminiPromptText, onProgress) {
  if (images.length <= CAPTURE_PARSE_BATCH_SIZE) {
    if (onProgress) onProgress(1, 1);
    return await callVisionAPI(images, claudePromptText, geminiPromptText);
  }
  const batches = [];
  for (let i = 0; i < images.length; i += CAPTURE_PARSE_BATCH_SIZE) batches.push(images.slice(i, i + CAPTURE_PARSE_BATCH_SIZE));
  const merged = { account_label: null, page_count: images.length, holdings: [] };
  const totals = { reported_total: undefined, reported_total_monthly_amount: undefined };
  const failed = [];
  // A20g: 배치별로 몇 장을 보내 몇 개 종목을 얻었는지 결과 화면에 그대로 노출하기 위한 진단
  // 정보 — 이게 없으면 "결과가 적다"는 보고를 받아도 어느 배치가 문제인지 알 방법이 없었다.
  const batchStats = [];
  let source = null;
  for (let b = 0; b < batches.length; b++) {
    const offset = b * CAPTURE_PARSE_BATCH_SIZE;
    if (b > 0) await new Promise((r) => setTimeout(r, 300)); // 연속 호출 부담 완화
    let parsed = null;
    let lastErr = null;
    for (let attempt = 0; attempt <= CAPTURE_BATCH_RETRY_DELAYS_MS.length; attempt++) {
      if (onProgress) onProgress(b + 1, batches.length, attempt > 0 ? `재시도 ${attempt}/${CAPTURE_BATCH_RETRY_DELAYS_MS.length}` : "");
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, CAPTURE_BATCH_RETRY_DELAYS_MS[attempt - 1]));
        const res = await callVisionAPI(batches[b], claudePromptText, geminiPromptText);
        source = res.source;
        parsed = parseAIJsonResponse(res.primaryText);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (isPermanentApiError(err)) break;
      }
    }
    if (lastErr) {
      batchStats.push({ imageCount: batches[b].length, holdingCount: 0, failed: true });
      failed.push(`배치 ${b + 1}/${batches.length}(${offset + 1}~${offset + batches[b].length}장째) 실패: ${lastErr.message}`);
      continue;
    }
    batchStats.push({ imageCount: batches[b].length, holdingCount: (parsed.holdings || []).length });
    for (const h of parsed.holdings || []) {
      const rel = Number(h.page) >= 1 ? Math.min(Number(h.page), batches[b].length) : 1;
      merged.holdings.push({ ...h, page: offset + rel });
    }
    if (!merged.account_label && parsed.account_label) merged.account_label = parsed.account_label;
    for (const key of Object.keys(totals)) {
      const v = parsed[key];
      if (v == null) continue;
      if (totals[key] === undefined) totals[key] = v;
      else if (totals[key] !== v) totals[key] = null;
    }
  }
  // 실패 메시지가 네트워크 계열이면 원인·대처를 먼저 안내(재시도까지 전부 실패한 경우)
  const netGuide = failed.some((f) => CAPTURE_NETWORK_ERR_RE.test(f))
    ? "📶 파싱 중 기기 네트워크가 끊긴 것으로 보입니다 — 연결 확인 후 다시 시도하고, 파싱 중에는 화면을 끄거나 앱을 벗어나지 마세요. "
    : "";
  if (failed.length === batches.length) throw new Error(netGuide + failed[0]);
  merged.reported_total = totals.reported_total === undefined ? null : totals.reported_total;
  merged.reported_total_monthly_amount = totals.reported_total_monthly_amount === undefined ? null : totals.reported_total_monthly_amount;
  return {
    primaryText: JSON.stringify(merged),
    crossText: null,
    crossProvider: null,
    crossError: failed.length ? `${netGuide}일부 이미지 누락 가능 — ${failed.join(" · ")}` : null,
    source,
    batchCount: batches.length,
    failedBatches: failed,
    batchStats,
  };
}

/* ---------- 프롬프트·스키마 (이번 세션 수동 전사 패턴을 그대로 명문화) ---------- */
const ACCOUNT_CAPTURE_PROMPT = `역할: 한국 증권사 앱의 "계좌 잔고" 화면 스크린샷 여러 장을 순서대로 받는다.
스크린샷은 한 계좌만 있을 수도 있고, 여러 계좌(예: 서로 다른 증권사 탭이나 계좌 전환 화면)가 섞여 있을 수도 있다.
각 장에서 보이는 모든 보유 종목 행에 대해 다음을 추출:
- 계좌명(그 장 화면에 보이는 계좌명·탭명 그대로. 여러 계좌가 섞여 있으면 각 홀딩이 어느 계좌 소속인지 반드시 이 필드로 구분할 것. 전체가 한 계좌뿐이면 모든 홀딩에 같은 값을 넣거나 null로 둬도 됨)
- 종목명(화면 표시 그대로, 축약 없이)
- 종목코드(화면에 보이면, 없으면 null)
- 보유수량(정수)
- 평가금액(원, 정수)
- 매입단가 또는 평균단가(있으면, 없으면 null)
- 현재가(있으면, 없으면 null)
장 하단/상단에 "총 평가금액", "자산" 등 계좌 합계가 보이면 별도 필드로 추출.
받은 이미지는 몇 장이 되었든 전부 빠짐없이 순서대로 확인할 것 — 이미지가 많다고 일부만 보고 응답하거나 요약하지 말 것. holdings의 각 항목마다 page 필드는 그 종목이 실제로 보인 이미지의 순서 번호(받은 순서대로 1부터)를 정확히 적을 것 — 모든 항목에 같은 page 번호를 쓰지 말 것(서로 다른 이미지에서 봤다면 page 번호도 서로 달라야 한다).
스크린샷에 없는 값은 절대 추정하지 말고 null로 둘 것. 특히 보유수량(qty)은 평가금액÷현재가 등으로 역산해서 채우지 말 것 — 화면에 숫자가 안 보이면 반드시 null.
각 필드 값은 반드시 그 장(page)에 실제로 보이는 값만 사용할 것. "다른 계좌"의 같은 종목에서 본 값(매입단가 등)을 가져다 쓰는 것은 금지한다 — 계좌마다 매입단가·수량·평가금액이 서로 다르기 때문이다. (단, 같은 계좌의 같은 종목이 서로 다른 화면 종류에 걸쳐 나뉘어 보이는 것은 정상이니 각 장에서 본 그대로 각각 별도 행으로 보고하면 된다 — 병합하려 하지 말 것.)
계좌번호는 화면에 보이는 숫자를 한 자리도 빠짐없이 그대로 옮겨 적을 것(자릿수를 줄이거나 늘리지 말 것). 증권사명(회사명)은 로고·배지 이미지가 아니라 화면에 글자(텍스트)로 실제로 쓰여 있을 때만 적고, 글자가 안 보이면 계좌명 필드에 계좌번호만 쓰고 증권사명은 "미확인"으로 둘 것(다른 계좌의 증권사명을 보고 짐작하지 말 것).
달러(USD)로 표시된 가격은 소수점 자리를 원본 그대로 유지할 것(예: 11.418을 11418로 쓰지 말 것 — 1000배 차이가 나는 오류다).
같은 종목이 여러 장에 걸쳐 반복 표시되면(스크롤 캡처, 또는 같은 계좌의 다른 화면 종류) 중복 제거하거나 병합하지 말고 각 장에서 본 그대로 각각 별도 행으로 보고할 것. page_count는 이번 요청에서 실제로 받은 이미지 파일의 총 개수를 그대로 셀 것 — 종목 개수·계좌 개수 등 다른 숫자와 혼동하지 말 것.
출력은 아래 JSON만, 설명·마크다운 코드블록 없이 그대로:
{"account_label":"화면에 보이는 대표 계좌명(없으면 null, 여러 계좌가 섞여 있으면 첫 계좌명)","page_count":이미지수,"holdings":[{"page":1,"account":"이 홀딩의 계좌명(섞여 있을 때만 채우고, 한 계좌뿐이면 null 가능)","name":"...","symbol":"...","qty":0,"avgPrice":null,"currentPrice":null,"evalAmount":0}],"reported_total":숫자 또는 null}`;

const BUY_PLAN_CAPTURE_PROMPT = `역할: 한국 ETF모으기(월자동매수) 현황 화면 스크린샷을 받는다. 여러 계좌의 화면이 섞여 있을 수 있다.
각 행에서 계좌명(그 장 화면에 보이는 계좌명·탭명 그대로, 여러 계좌가 섞여 있으면 반드시 구분할 것), 종목명, 종목코드(있으면), 1회 매수수량, 매수주기(매월/매주/매일 중 화면 표기 그대로), 매수일(있으면), 다음 매수 예정일(있으면)을 추출.
화면에 월 총 매수금액이 보이면 별도 필드로 추출. 없는 값은 null — 다른 장·다른 계좌에서 본 값을 가져다 채우지 말 것. 계좌번호·증권사명은 화면에 보이는 글자 그대로(자릿수 정확히) 옮기고, 텍스트로 안 보이면 짐작하지 말 것. 받은 이미지는 전부 빠짐없이 순서대로 확인할 것 — 일부만 보고 응답하지 말 것.
출력은 아래 JSON만, 설명·마크다운 코드블록 없이 그대로:
{"holdings":[{"account":"이 행의 계좌명(섞여 있을 때만 채우고, 한 계좌뿐이면 null 가능)","name":"...","symbol":"...","buyQtyPerTime":0,"buyFreq":"매월","buyDay":null,"nextBuyDate":null}],"reported_total_monthly_amount":숫자 또는 null}`;

/* Gemini 전용 지침(방식2) — 스키마는 위 Claude/대화창용과 동일하지만, Gemini가 종종
   JSON 앞뒤에 설명·코드펜스를 붙이는 경향이 있어 "순수 JSON만 출력" 지시를 앞뒤로
   반복 강조한 버전이다(parseAIJsonResponse가 코드펜스를 벗겨내긴 하지만 애초에
   덜 섞여 나오게 하려는 목적). 설정탭에서 개별 편집·저장 가능. */
const GEMINI_ACCOUNT_CAPTURE_PROMPT = `역할: 한국 증권사 앱의 "계좌 잔고" 화면 스크린샷 여러 장을 순서대로 받는다.
스크린샷은 한 계좌만 있을 수도 있고, 여러 계좌(예: 서로 다른 증권사 탭이나 계좌 전환 화면)가 섞여 있을 수도 있다.
각 장에서 보이는 모든 보유 종목 행에 대해 다음을 추출한다:
- 계좌명(그 장 화면에 보이는 계좌명·탭명 그대로. 여러 계좌가 섞여 있으면 각 홀딩이 어느 계좌 소속인지 반드시 이 필드로 구분할 것. 전체가 한 계좌뿐이면 모든 홀딩에 같은 값을 넣거나 null로 둬도 됨)
- 종목명(화면 표시 그대로, 축약 없이)
- 종목코드(화면에 보이면, 없으면 null)
- 보유수량(정수)
- 평가금액(원, 정수)
- 매입단가 또는 평균단가(있으면, 없으면 null)
- 현재가(있으면, 없으면 null)
장 하단/상단에 "총 평가금액", "자산" 등 계좌 합계가 보이면 별도 필드로 추출.
받은 이미지는 몇 장이 되었든 전부 빠짐없이 순서대로 확인할 것 — 이미지가 많다고 일부만 보고 응답하거나 요약하지 말 것. holdings의 각 항목마다 page 필드는 그 종목이 실제로 보인 이미지의 순서 번호(받은 순서대로 1부터)를 정확히 적을 것 — 모든 항목에 같은 page 번호를 쓰지 말 것(서로 다른 이미지에서 봤다면 page 번호도 서로 달라야 한다).
스크린샷에 없는 값은 절대 추정하지 말고 null로 둘 것. 특히 보유수량(qty)은 평가금액÷현재가 등으로 역산해서 채우지 말 것 — 화면에 숫자가 안 보이면 반드시 null.
각 필드 값은 반드시 그 장(page)에 실제로 보이는 값만 사용할 것. "다른 계좌"의 같은 종목에서 본 값(매입단가 등)을 가져다 쓰는 것은 금지한다 — 계좌마다 매입단가·수량·평가금액이 서로 다르기 때문이다. (단, 같은 계좌의 같은 종목이 서로 다른 화면 종류에 걸쳐 나뉘어 보이는 것은 정상이니 각 장에서 본 그대로 각각 별도 행으로 보고하면 된다 — 병합하려 하지 말 것.)
계좌번호는 화면에 보이는 숫자를 한 자리도 빠짐없이 그대로 옮겨 적을 것(자릿수를 줄이거나 늘리지 말 것). 증권사명(회사명)은 로고·배지 이미지가 아니라 화면에 글자(텍스트)로 실제로 쓰여 있을 때만 적고, 글자가 안 보이면 계좌명 필드에 계좌번호만 쓰고 증권사명은 "미확인"으로 둘 것(다른 계좌의 증권사명을 보고 짐작하지 말 것).
달러(USD)로 표시된 가격은 소수점 자리를 원본 그대로 유지할 것(예: 11.418을 11418로 쓰지 말 것 — 1000배 차이가 나는 오류다).
같은 종목이 여러 장에 걸쳐 반복 표시되면(스크롤 캡처, 또는 같은 계좌의 다른 화면 종류) 중복 제거하거나 병합하지 말고 각 장에서 본 그대로 각각 별도 행으로 보고할 것. page_count는 이번 요청에서 실제로 받은 이미지 파일의 총 개수를 그대로 셀 것 — 종목 개수·계좌 개수 등 다른 숫자와 혼동하지 말 것.

매우 중요: 응답은 아래 JSON 객체 단 하나여야 한다. 설명 문장, 인사말, 코드블록 표시(\`\`\`) 등 JSON이 아닌 텍스트를 앞뒤에 절대 붙이지 마라. 첫 글자부터 마지막 글자까지 순수 JSON만 출력하라.

{"account_label":"화면에 보이는 대표 계좌명(없으면 null, 여러 계좌가 섞여 있으면 첫 계좌명)","page_count":이미지수,"holdings":[{"page":1,"account":"이 홀딩의 계좌명(섞여 있을 때만 채우고, 한 계좌뿐이면 null 가능)","name":"...","symbol":"...","qty":0,"avgPrice":null,"currentPrice":null,"evalAmount":0}],"reported_total":숫자 또는 null}

다시 한번: JSON 객체만 출력하고 다른 텍스트는 포함하지 마라.`;

const GEMINI_BUY_PLAN_CAPTURE_PROMPT = `역할: 한국 ETF모으기(월자동매수) 현황 화면 스크린샷을 받는다. 여러 계좌의 화면이 섞여 있을 수 있다.
각 행에서 계좌명(그 장 화면에 보이는 계좌명·탭명 그대로, 여러 계좌가 섞여 있으면 반드시 구분할 것), 종목명, 종목코드(있으면), 1회 매수수량, 매수주기(매월/매주/매일 중 화면 표기 그대로), 매수일(있으면), 다음 매수 예정일(있으면)을 추출한다.
화면에 월 총 매수금액이 보이면 별도 필드로 추출. 없는 값은 null로 둔다 — 다른 장·다른 계좌에서 본 값을 가져다 채우지 말 것. 계좌번호·증권사명은 화면에 보이는 글자 그대로(자릿수 정확히) 옮기고, 텍스트로 안 보이면 짐작하지 말 것. 받은 이미지는 전부 빠짐없이 순서대로 확인할 것 — 일부만 보고 응답하지 말 것.

매우 중요: 응답은 아래 JSON 객체 단 하나여야 한다. 설명 문장, 인사말, 코드블록 표시(\`\`\`) 등 JSON이 아닌 텍스트를 앞뒤에 절대 붙이지 마라. 첫 글자부터 마지막 글자까지 순수 JSON만 출력하라.

{"holdings":[{"account":"이 행의 계좌명(섞여 있을 때만 채우고, 한 계좌뿐이면 null 가능)","name":"...","symbol":"...","buyQtyPerTime":0,"buyFreq":"매월","buyDay":null,"nextBuyDate":null}],"reported_total_monthly_amount":숫자 또는 null}

다시 한번: JSON 객체만 출력하고 다른 텍스트는 포함하지 마라.`;

/* 지침 편집·저장(설정탭) — 저장값이 있으면 그것을, 없으면 위 기본값을 쓴다.
   kind는 "account" | "buyplan". Claude/대화창용은 "📋 프롬프트 복사"(방식1)와
   provider=claude 자동 호출(방식3) 양쪽에 공통으로 쓰이고, Gemini용은 방식2 전용. */
const CAPTURE_PROMPT_STORAGE_KEYS = { account: "capture_prompt_account_v1", buyplan: "capture_prompt_buyplan_v1" };
const CAPTURE_GEMINI_PROMPT_STORAGE_KEYS = { account: "capture_gemini_prompt_account_v1", buyplan: "capture_gemini_prompt_buyplan_v1" };
const CAPTURE_DEFAULT_PROMPTS = { account: ACCOUNT_CAPTURE_PROMPT, buyplan: BUY_PLAN_CAPTURE_PROMPT };
const CAPTURE_DEFAULT_GEMINI_PROMPTS = { account: GEMINI_ACCOUNT_CAPTURE_PROMPT, buyplan: GEMINI_BUY_PLAN_CAPTURE_PROMPT };

function getEffectivePrompt(kind) {
  return localStorage.getItem(CAPTURE_PROMPT_STORAGE_KEYS[kind]) || CAPTURE_DEFAULT_PROMPTS[kind];
}
function getGeminiPrompt(kind) {
  return localStorage.getItem(CAPTURE_GEMINI_PROMPT_STORAGE_KEYS[kind]) || CAPTURE_DEFAULT_GEMINI_PROMPTS[kind];
}

/* AI 응답에서 ```json 코드펜스가 섞여 와도 안전하게 JSON만 추출 */
function parseAIJsonResponse(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(jsonText);
}

/* ---------- 종목명→코드 매칭 (state.listedEtfs 기준, 자동 정규화 없이 최선의 후보만 제안) ---------- */
function matchSymbolByName(name, symbolHint) {
  const norm = (s) => (s || "").replace(/\s+/g, "").toLowerCase();
  const targetName = norm(name);
  const targetCode = (symbolHint || "").replace(/[^0-9A-Za-z]/g, "");
  if (targetCode) {
    const byCode = state.listedEtfs.find((e) => e.symbol.replace(/\.KS$/, "") === targetCode);
    if (byCode) return byCode;
  }
  const exact = state.listedEtfs.find((e) => norm(e.name) === targetName);
  if (exact) return exact;
  // 느슨한 매칭은 "등록된 정식명이 AI가 읽은 이름을 포함"하는 방향만 허용한다(AI가 이름
  // 앞뒤에 잡음을 붙여 읽은 경우 구제하려는 목적). 반대 방향(짧은 정식명이 AI가 읽은
  // 이름의 일부인 경우)은 절대 매칭하지 않는다 — "KODEX 200"(069500.KS)이 전혀 다른
  // 실제 상품인 "KODEX 200커버드콜액티브"(미수집)의 접두어라는 이유만으로 오매칭돼
  // 서로 다른 펀드의 수량이 "채우기"로 잘못 기록될 뻔한 실사례가 있었다(2026-07-18).
  if (targetName) {
    const loose = state.listedEtfs.find((e) => norm(e.name).includes(targetName));
    if (loose) return loose;
    // 증권사 앱이 좁은 목록 칸에서 종목명을 "…"/"..."로 잘라 보여주는 경우(실사례: KB증권
    // 계좌 잔고 목록, 2026-07-18) AI는 화면에 보이는 그대로 말줄임까지 옮겨 적는다 — 이때는
    // 위 includes 매칭도 실패한다(말줄임 문자가 정식명에 없으므로). 말줄임을 떼고 정식명이
    // 그 앞부분으로 "시작"하는지 확인한다 — 여전히 "정식명이 AI가 읽은 문자열을 포함"하는
    // 안전한 방향(위 주석 참조)이고, 후보가 정확히 1개일 때만 채택해 오매칭을 방지한다.
    const ellipsisMatch = targetName.match(/^(.{4,}?)(\.{2,}|…)$/);
    if (ellipsisMatch) {
      const prefix = ellipsisMatch[1];
      const candidates = state.listedEtfs.filter((e) => norm(e.name).startsWith(prefix));
      if (candidates.length === 1) return candidates[0];
    }
  }
  return null;
}

/* ---------- A3f: 계좌명(원문 텍스트) → 앱 정식 계좌 목록(ACCOUNT_TYPES) 매칭 ----------
   폴더 하나에 여러 계좌 스크린샷이 섞여 있을 때, AI가 읽은 계좌명 문자열을 정식 계좌명과
   자동으로 이어붙여 각 행의 계좌 선택을 미리 채워준다(수동 재선택 부담을 줄임). 매칭 안
   되면 null을 반환해 폼에서는 그냥 "계좌 미지정"으로 남고 사용자가 직접 고르면 된다 —
   틀린 계좌를 추측해서 채우지 않는다(더미데이터 오염 방지 원칙). */
function matchAccountByLabel(label) {
  if (!label) return null;
  // "KB증권 ISA" 같은 화면 원문과 "KB_ISA" 같은 정식 계좌명을 비교하려면 "증권"·공백·밑줄을
  // 전부 지우고 비교해야 한다(그대로 두면 항상 매칭 실패) — matchSymbolByName의 종목명 정규화와
  // 같은 목적, 계좌명 특성에 맞게 지우는 문자만 다름.
  const norm = (s) => (s || "").replace(/증권|\s|_/g, "").toLowerCase();
  const target = norm(label);
  const exact = ACCOUNT_TYPES.find((a) => norm(a) === target);
  if (exact) return exact;
  const loose = ACCOUNT_TYPES.find((a) => norm(a).includes(target) || target.includes(norm(a)));
  return loose || null;
}

/* ---------- 교차검증 엔진 (이번 세션에서 실제로 오류를 잡아낸 패턴 재구현) ----------
   1) 행 단위: qty×currentPrice ≈ evalAmount (오차 1% 초과 시 경고)
   2) 합계 대조: ΣevalAmount vs reported_total (오차 0.5% 초과 시 "누락 종목 가능성" 경고)
   3) 종목명→코드 매칭 실패는 "수집 목록에 없음"으로 표시(자동 생성 금지) */
function validateAccountCapture(parsed) {
  const holdings = (parsed.holdings || []).map((h) => {
    const issues = [];
    if (h.qty != null && h.currentPrice != null && h.evalAmount != null && h.evalAmount > 0) {
      const expected = h.qty * h.currentPrice;
      const diffPct = Math.abs(expected - h.evalAmount) / h.evalAmount;
      if (diffPct > 0.01) issues.push(`행 오차 ${(diffPct * 100).toFixed(1)}% (수량×현재가=${Math.round(expected).toLocaleString()} vs 평가액=${h.evalAmount.toLocaleString()})`);
    }
    const match = matchSymbolByName(h.name, h.symbol);
    if (!match) issues.push("수집 목록에 없는 종목 — 코드 세션에 추가 요청 필요");
    // A3f: 폴더에 여러 계좌가 섞여 있으면 행별 account, 아니면 최상위 account_label을 계좌 원문으로 사용
    const rawAccountLabel = h.account || parsed.account_label || null;
    const matchedAccount = matchAccountByLabel(rawAccountLabel);
    return { ...h, issues, matchedSymbol: match ? match.symbol : null, matchedName: match ? match.name : null, rawAccountLabel, matchedAccount };
  });
  const sumEval = holdings.reduce((a, h) => a + (h.evalAmount || 0), 0);
  let totalCheck = null;
  if (parsed.reported_total != null && parsed.reported_total > 0) {
    const diff = sumEval - parsed.reported_total;
    const diffPct = Math.abs(diff) / parsed.reported_total;
    totalCheck = { sumEval, reported: parsed.reported_total, diff, diffPct, ok: diffPct <= 0.005 };
  }
  return { holdings, totalCheck, accountLabel: parsed.account_label || null };
}

function validateBuyPlanCapture(parsed) {
  const holdings = (parsed.holdings || []).map((h) => {
    const issues = [];
    const match = matchSymbolByName(h.name, h.symbol);
    if (!match) issues.push("수집 목록에 없는 종목 — 코드 세션에 추가 요청 필요");
    const rawAccountLabel = h.account || null;
    const matchedAccount = matchAccountByLabel(rawAccountLabel);
    return { ...h, issues, matchedSymbol: match ? match.symbol : null, matchedName: match ? match.name : null, rawAccountLabel, matchedAccount };
  });
  return { holdings, reportedTotal: parsed.reported_total_monthly_amount ?? null };
}

/* ---------- 교차검증 결과를 primary 파싱 결과에 덧붙인다 ----------
   두 가지 경로에서 호출된다: (a) A3d 듀얼 비전(Claude API 옵트인 시 Gemini와 동시 호출),
   (b) 3단계 우선순위 비교 — 같은 종류(계좌/월매수)의 마지막 저장 결과(방식1 붙여넣기든
   방식2 Gemini 자동이든)와 순차 대조. qtyField는 계좌캡처="qty", 월매수캡처="buyQtyPerTime".
   상대가 같은 종목을 다른 수량으로 읽었으면 "mismatch", 아예 못 찾았으면 "missing" — 두
   경우 모두 h.crossCheck에 기록해 화면에서 채우기 체크박스를 기본 해제하는 근거로 쓴다. */
function applyCrossCheck(validated, crossValidated, crossProvider, qtyField) {
  const crossBySymbol = new Map();
  for (const h of crossValidated.holdings) {
    if (h.matchedSymbol) crossBySymbol.set(h.matchedSymbol, h);
  }
  for (const h of validated.holdings) {
    if (!h.matchedSymbol) continue;
    const other = crossBySymbol.get(h.matchedSymbol);
    if (!other) { h.crossCheck = { status: "missing", crossProvider }; continue; }
    const qtyMatch = h[qtyField] === other[qtyField];
    h.crossCheck = { status: qtyMatch ? "match" : "mismatch", crossProvider, otherQty: other[qtyField] };
  }
}

const CROSS_CHECK_PROVIDER_LABEL = {
  claude: "Claude", gemini: "Gemini",
  "claude-chat": "Claude 대화창(방식1)", "claude-api": "Claude API(방식3)",
};

function crossCheckBadgeHTML(crossCheck) {
  if (!crossCheck) return "";
  const label = CROSS_CHECK_PROVIDER_LABEL[crossCheck.crossProvider] || crossCheck.crossProvider;
  if (crossCheck.status === "match") return `<span style="color:var(--good); font-size:11px;">✅ ${label} 일치</span>`;
  if (crossCheck.status === "missing") return `<span style="color:var(--critical); font-size:11px;">⚠️ ${label}엔 없음</span>`;
  return `<span style="color:var(--critical); font-size:11px;">⚠️ ${label} 불일치(${crossCheck.otherQty})</span>`;
}

/* ---------- 노션 SOP 갱신용 요약 텍스트 (앱은 이 텍스트만 만들고, 실제 노션 반영은
   계속 사람이 붙여넣는 AI 세션이 담당 — CLAUDE.md/계획서의 역할분리 원칙).
   대상 AI(클로드/제미나이/ChatGPT)는 설정탭에서 고른 값을 localStorage에서 읽어
   문구만 그에 맞게 바꾼다 — 앱이 그 AI를 직접 호출하는 게 아니라 사람이 복사해서
   해당 AI 세션에 붙여넣는 방식은 동일하다. */
const CAPTURE_SOP_TARGET_KEY = "capture_sop_ai_target"; // "claude" | "gemini" | "chatgpt"
function sopTargetLabel() {
  const t = (typeof localStorage !== "undefined" && localStorage.getItem(CAPTURE_SOP_TARGET_KEY)) || "claude";
  return { claude: "클로드 코드 세션", gemini: "제미나이", chatgpt: "ChatGPT" }[t] || "클로드 코드 세션";
}

function buildAccountCaptureSummaryText(validated, divStatus) {
  const lines = [];
  lines.push(`📸 계좌 캡처 파싱 결과${validated.accountLabel ? ` — ${validated.accountLabel}` : ""} (${todayStr()})`);
  if (validated.totalCheck) {
    const t = validated.totalCheck;
    lines.push(`합계 대조: Σ평가액 ${Math.round(t.sumEval).toLocaleString()}원 vs 화면합계 ${Math.round(t.reported).toLocaleString()}원 (오차 ${(t.diffPct * 100).toFixed(2)}%, ${t.ok ? "정상" : "누락 종목 가능성 있음"})`);
  }
  if (divStatus) {
    lines.push(`배당 정보 기준: ${divStatus === "confirmed" ? "확정(공시된 DPS)" : "예정(주가×배당률 추정)"} — 배당기준 마스터 갱신 시 이 기준으로 처리해줘.`);
  }
  for (const h of validated.holdings) {
    const label = h.matchedName || h.name;
    const symbolPart = h.matchedSymbol ? ` (${h.matchedSymbol})` : "";
    const issuePart = h.issues && h.issues.length ? ` [⚠️ ${h.issues.join("; ")}]` : " [정상]";
    const acctPart = ` [${h.matchedAccount || h.rawAccountLabel || "계좌 미지정"}]`;
    lines.push(`-${acctPart} ${label}${symbolPart}: ${h.qty ?? "?"}주, 평가액 ${h.evalAmount != null ? Math.round(h.evalAmount).toLocaleString() : "?"}원${issuePart}`);
  }
  lines.push("");
  lines.push(`이 결과를 ${sopTargetLabel()}에 붙여넣어 노션 "계좌 종목 현황 SOP"에 반영해줘.`);
  return lines.join("\n");
}

function buildBuyPlanCaptureSummaryText(validated) {
  const lines = [];
  lines.push(`📈 월매수 캡처 파싱 결과 (${todayStr()})`);
  if (validated.reportedTotal != null) {
    lines.push(`화면 월 총 매수금액: ${Math.round(validated.reportedTotal).toLocaleString()}원`);
  }
  for (const h of validated.holdings) {
    const label = h.matchedName || h.name;
    const symbolPart = h.matchedSymbol ? ` (${h.matchedSymbol})` : "";
    const issuePart = h.issues && h.issues.length ? ` [⚠️ ${h.issues.join("; ")}]` : " [정상]";
    const acctPart = ` [${h.matchedAccount || h.rawAccountLabel || "계좌 미지정"}]`;
    lines.push(`-${acctPart} ${label}${symbolPart}: 1회 ${h.buyQtyPerTime ?? "?"}주 × ${h.buyFreq || "?"}${h.buyDay ? ` (${h.buyDay})` : ""}${issuePart}`);
  }
  lines.push("");
  lines.push(`이 결과를 ${sopTargetLabel()}에 붙여넣어 노션 "월자동매수 현황"에 반영해줘.`);
  return lines.join("\n");
}
