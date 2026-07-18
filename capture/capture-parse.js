// capture/capture-parse.js — 캡처 이미지 → AI 비전 파싱 → 교차검증 (M2)
// capture 앱 전용(index.html/shared에는 없음). state.listedEtfs/state.metaBySymbol에 의존(초기화 후 호출).

const CAPTURE_AI_PROVIDER_KEY = "capture_ai_provider"; // "claude" | "gemini"
const CAPTURE_CLAUDE_KEY = "capture_claude_key";
const CAPTURE_GEMINI_KEY = "capture_gemini_key";
const CAPTURE_CLAUDE_MODEL_KEY = "capture_claude_model"; // A19: 소넷/하이쿠 선택(2026-07-18 프롬프트 비교테스트 후속)
const CAPTURE_CLAUDE_MODEL_DEFAULT = "claude-sonnet-5";
const CAPTURE_GEMINI_MODEL_DEFAULT = "gemini-2.5-flash";

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
  const reason = status === 401 || status === 403 ? "키가 잘못됐거나 권한이 없습니다"
    : status === 429 ? "요청이 너무 많습니다(잠시 후 재시도)"
    : status === 400 ? "요청 형식 오류"
    : status ? `오류(HTTP ${status})`
    : "네트워크 오류(연결 확인 필요)";
  const detail = err && err.message ? ` — ${err.message}` : "";
  return `❌ ${providerLabel} ${reason}${detail}`;
}

/* 설정탭에서 선택한 provider(기본)로 파싱하되, 반대쪽 provider 키도 저장돼 있으면
   같은 이미지를 동시에 보내 결과를 대조한다(A3d 듀얼 비전 교차검증) — 키가 하나뿐이면
   기존과 동일하게 단일 호출(회귀 없음). 비용: 양쪽 키가 있을 때만 API 호출이 2배가 됨.
   prompts는 {claude, gemini} 형태 — 두 AI사가 서로 다른 프롬프트 문구를 받을 수 있게
   분리했다(2026-07-18 소넷/하이쿠 비교테스트 후속 — Gemini 전용 문구 도입 대비).
   Claude 모델(소넷/하이쿠)은 설정탭에서 고른 값을 여기서 읽어 callClaudeVision에 전달한다. */
async function callVisionAPI(images, prompts) {
  const provider = localStorage.getItem(CAPTURE_AI_PROVIDER_KEY) || "claude";
  const claudeKey = localStorage.getItem(CAPTURE_CLAUDE_KEY);
  const geminiKey = localStorage.getItem(CAPTURE_GEMINI_KEY);
  const claudeModel = localStorage.getItem(CAPTURE_CLAUDE_MODEL_KEY) || CAPTURE_CLAUDE_MODEL_DEFAULT;
  const primaryKey = provider === "gemini" ? geminiKey : claudeKey;
  if (!primaryKey) throw new Error(`${provider === "gemini" ? "Gemini" : "Claude"} API 키가 설정탭에 입력되어 있지 않습니다.`);

  const callPrimary = () => (provider === "gemini" ? callGeminiVision(images, prompts.gemini, primaryKey) : callClaudeVision(images, prompts.claude, primaryKey, claudeModel));
  const otherKey = provider === "gemini" ? claudeKey : geminiKey;
  if (!otherKey) return { primaryText: await callPrimary(), crossText: null, crossProvider: null, crossError: null };

  const crossProvider = provider === "gemini" ? "claude" : "gemini";
  const callOther = () => (crossProvider === "gemini" ? callGeminiVision(images, prompts.gemini, otherKey) : callClaudeVision(images, prompts.claude, otherKey, claudeModel));
  const [primaryResult, otherResult] = await Promise.allSettled([callPrimary(), callOther()]);
  if (primaryResult.status === "rejected") throw primaryResult.reason;
  return {
    primaryText: primaryResult.value,
    crossText: otherResult.status === "fulfilled" ? otherResult.value : null,
    crossProvider,
    crossError: otherResult.status === "rejected" ? otherResult.reason.message : null,
  };
}

/* ---------- 프롬프트·스키마 (이번 세션 수동 전사 패턴을 그대로 명문화) ----------
   2026-07-18 소넷/하이쿠 36장 비교테스트 결과 반영(A19): 하이쿠에서 실측된 4가지
   오류 패턴 — ①계좌번호 자릿수 누락 ②화면에 없는 회사명 추측 ③다른 계좌·다른 장에서
   본 값을 가져다 채우는 교차오염 ④달러 종목 소수점 자릿수 오류 — 을 막기 위한 문구를
   추가했다. 기존 스키마·필드는 그대로, 지침 본문만 강화. */
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
스크린샷에 없는 값은 절대 추정하지 말고 null로 둘 것. 특히 보유수량(qty)은 평가금액÷현재가 등으로 역산해서 채우지 말 것 — 화면에 숫자가 안 보이면 반드시 null.
각 필드 값은 반드시 그 장(page)에 실제로 보이는 값만 사용할 것. 같은 종목이 다른 계좌·다른 장에도 나온다고 해서 그 값을 가져다 쓰지 말 것 — 계좌마다 매입단가·수량·평가금액이 서로 다르다.
계좌번호는 화면에 보이는 숫자를 한 자리도 빠짐없이 그대로 옮겨 적을 것(자릿수를 줄이거나 늘리지 말 것). 증권사명(회사명)은 로고·배지 이미지가 아니라 화면에 글자(텍스트)로 실제로 쓰여 있을 때만 적고, 글자가 안 보이면 계좌명 필드에 계좌번호만 쓰고 증권사명은 "미확인"으로 둘 것(다른 계좌의 증권사명을 보고 짐작하지 말 것).
달러(USD)로 표시된 가격은 소수점 자리를 원본 그대로 유지할 것(예: 11.418을 11418로 쓰지 말 것 — 1000배 차이가 나는 오류다).
같은 종목이 여러 장에 걸쳐 반복 표시되면(스크롤 캡처) 중복 제거하지 말고 각 장에서 본 그대로 보고할 것.
출력은 아래 JSON만, 설명·마크다운 코드블록 없이 그대로:
{"account_label":"화면에 보이는 대표 계좌명(없으면 null, 여러 계좌가 섞여 있으면 첫 계좌명)","page_count":이미지수,"holdings":[{"page":1,"account":"이 홀딩의 계좌명(섞여 있을 때만 채우고, 한 계좌뿐이면 null 가능)","name":"...","symbol":"...","qty":0,"avgPrice":null,"currentPrice":null,"evalAmount":0}],"reported_total":숫자 또는 null}`;

/* Gemini 전용 변형 — 내용은 Claude용과 동일하되, Gemini가 설명 문장이나 마크다운 펜스를
   덧붙이는 경향이 있어 "JSON만" 지시를 앞뒤로 한 번씩 더 반복해 강조한다(2026-07-18). */
const ACCOUNT_CAPTURE_PROMPT_GEMINI = `중요: 아래 지시를 따르되, 응답은 순수 JSON 객체 하나만 출력한다. 설명 문장, 인사말, \`\`\`json 같은 코드펜스를 절대 붙이지 말 것 — 첫 글자부터 "{"로 시작해야 한다.

${ACCOUNT_CAPTURE_PROMPT}

다시 강조: 위 JSON 객체 외의 텍스트(설명, 코드펜스, 주석)를 응답에 포함하지 말 것.`;

const BUY_PLAN_CAPTURE_PROMPT = `역할: 한국 ETF모으기(월자동매수) 현황 화면 스크린샷을 받는다. 여러 계좌의 화면이 섞여 있을 수 있다.
각 행에서 계좌명(그 장 화면에 보이는 계좌명·탭명 그대로, 여러 계좌가 섞여 있으면 반드시 구분할 것), 종목명, 종목코드(있으면), 1회 매수수량, 매수주기(매월/매주/매일 중 화면 표기 그대로), 매수일(있으면), 다음 매수 예정일(있으면)을 추출.
화면에 월 총 매수금액이 보이면 별도 필드로 추출. 없는 값은 null — 다른 장·다른 계좌에서 본 값을 가져다 채우지 말 것.
출력은 아래 JSON만, 설명·마크다운 코드블록 없이 그대로:
{"holdings":[{"account":"이 행의 계좌명(섞여 있을 때만 채우고, 한 계좌뿐이면 null 가능)","name":"...","symbol":"...","buyQtyPerTime":0,"buyFreq":"매월","buyDay":null,"nextBuyDate":null}],"reported_total_monthly_amount":숫자 또는 null}`;

const BUY_PLAN_CAPTURE_PROMPT_GEMINI = `중요: 아래 지시를 따르되, 응답은 순수 JSON 객체 하나만 출력한다. 설명 문장, 인사말, \`\`\`json 같은 코드펜스를 절대 붙이지 말 것 — 첫 글자부터 "{"로 시작해야 한다.

${BUY_PLAN_CAPTURE_PROMPT}

다시 강조: 위 JSON 객체 외의 텍스트(설명, 코드펜스, 주석)를 응답에 포함하지 말 것.`;

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
  if (targetName) {
    const loose = state.listedEtfs.find((e) => norm(e.name).includes(targetName) || targetName.includes(norm(e.name)));
    if (loose) return loose;
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

/* ---------- A3d: 듀얼 AI 교차검증 결과를 primary 파싱 결과에 덧붙인다 ----------
   qtyField는 계좌캡처="qty", 월매수캡처="buyQtyPerTime". 상대 provider가 같은
   종목을 다른 수량으로 읽었으면 "mismatch", 아예 못 찾았으면 "missing" — 두 경우
   모두 h.crossCheck에 기록해 화면에서 채우기 체크박스를 기본 해제하는 근거로 쓴다. */
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

const CROSS_CHECK_PROVIDER_LABEL = { claude: "Claude", gemini: "Gemini" };

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
    lines.push(`- ${label}${symbolPart}: ${h.qty ?? "?"}주, 평가액 ${h.evalAmount != null ? Math.round(h.evalAmount).toLocaleString() : "?"}원${issuePart}`);
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
    lines.push(`- ${label}${symbolPart}: 1회 ${h.buyQtyPerTime ?? "?"}주 × ${h.buyFreq || "?"}${h.buyDay ? ` (${h.buyDay})` : ""}${issuePart}`);
  }
  lines.push("");
  lines.push(`이 결과를 ${sopTargetLabel()}에 붙여넣어 노션 "월자동매수 현황"에 반영해줘.`);
  return lines.join("\n");
}
