// capture/capture-parse.js — 캡처 이미지 → AI 비전 파싱 → 교차검증 (M2)
// capture 앱 전용(index.html/shared에는 없음). state.listedEtfs/state.metaBySymbol에 의존(초기화 후 호출).

const CAPTURE_AI_PROVIDER_KEY = "capture_ai_provider"; // "claude" | "gemini"
const CAPTURE_CLAUDE_KEY = "capture_claude_key";
const CAPTURE_GEMINI_KEY = "capture_gemini_key";
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

async function callVisionAPI(images, promptText) {
  const provider = localStorage.getItem(CAPTURE_AI_PROVIDER_KEY) || "claude";
  const key = localStorage.getItem(provider === "gemini" ? CAPTURE_GEMINI_KEY : CAPTURE_CLAUDE_KEY);
  if (!key) throw new Error(`${provider === "gemini" ? "Gemini" : "Claude"} API 키가 설정탭에 입력되어 있지 않습니다.`);
  return provider === "gemini" ? callGeminiVision(images, promptText, key) : callClaudeVision(images, promptText, key);
}

/* ---------- 프롬프트·스키마 (이번 세션 수동 전사 패턴을 그대로 명문화) ---------- */
const ACCOUNT_CAPTURE_PROMPT = `역할: 한국 증권사 앱의 "계좌 잔고" 화면 스크린샷 여러 장을 순서대로 받는다.
각 장에서 보이는 모든 보유 종목 행에 대해 다음을 추출:
- 종목명(화면 표시 그대로, 축약 없이)
- 종목코드(화면에 보이면, 없으면 null)
- 보유수량(정수)
- 평가금액(원, 정수)
- 매입단가 또는 평균단가(있으면, 없으면 null)
- 현재가(있으면, 없으면 null)
장 하단/상단에 "총 평가금액", "자산" 등 계좌 합계가 보이면 별도 필드로 추출.
스크린샷에 없는 값은 절대 추정하지 말고 null로 둘 것.
같은 종목이 여러 장에 걸쳐 반복 표시되면(스크롤 캡처) 중복 제거하지 말고 각 장에서 본 그대로 보고할 것.
출력은 아래 JSON만, 설명·마크다운 코드블록 없이 그대로:
{"account_label":"화면에 보이는 계좌명(없으면 null)","page_count":이미지수,"holdings":[{"page":1,"name":"...","symbol":"...","qty":0,"avgPrice":null,"currentPrice":null,"evalAmount":0}],"reported_total":숫자 또는 null}`;

const BUY_PLAN_CAPTURE_PROMPT = `역할: 한국 ETF모으기(월자동매수) 현황 화면 스크린샷을 받는다.
각 행에서 종목명, 종목코드(있으면), 1회 매수수량, 매수주기(매월/매주/매일 중 화면 표기 그대로), 매수일(있으면), 다음 매수 예정일(있으면)을 추출.
화면에 월 총 매수금액이 보이면 별도 필드로 추출. 없는 값은 null.
출력은 아래 JSON만, 설명·마크다운 코드블록 없이 그대로:
{"holdings":[{"name":"...","symbol":"...","buyQtyPerTime":0,"buyFreq":"매월","buyDay":null,"nextBuyDate":null}],"reported_total_monthly_amount":숫자 또는 null}`;

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
    return { ...h, issues, matchedSymbol: match ? match.symbol : null, matchedName: match ? match.name : null };
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
    return { ...h, issues, matchedSymbol: match ? match.symbol : null, matchedName: match ? match.name : null };
  });
  return { holdings, reportedTotal: parsed.reported_total_monthly_amount ?? null };
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
