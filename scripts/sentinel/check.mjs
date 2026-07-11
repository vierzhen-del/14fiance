#!/usr/bin/env node
// SENTINEL static checks for n8n workflow JSON files. Zero dependencies (Node 22+).
// Usage: node scripts/sentinel/check.mjs n8n/workflows/*.json
// Exit 0 = all checks passed, exit 1 = violations found (deploy blocked).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SECRET_PATTERNS = [
  [/sk-[A-Za-z0-9_-]{16,}/, 'API 키(sk-...)'],
  [/ntn_[A-Za-z0-9]{20,}/, 'Notion 토큰(ntn_...)'],
  [/secret_[A-Za-z0-9]{20,}/, 'Notion 토큰(secret_...)'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack 토큰'],
  [/ghp_[A-Za-z0-9]{20,}/, 'GitHub 토큰'],
  [/AKIA[0-9A-Z]{16}/, 'AWS 액세스 키'],
  [/\b\d{8,}:[A-Za-z0-9_-]{30,}/, 'Telegram 봇 토큰'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/, 'Bearer 토큰'],
];

export function checkWorkflow(wf, file) {
  const findings = [];
  const add = (check, node, cause, action) =>
    findings.push({ check, file, node, cause, action });

  for (const node of wf.nodes || []) {
    const params = node.parameters || {};
    const raw = JSON.stringify(params);
    const loc = node.name || node.type;

    // ① 비인증 라우트: webhook without authentication
    if (node.type === 'n8n-nodes-base.webhook') {
      const auth = params.authentication;
      if (!auth || auth === 'none') {
        add('비인증 라우트', loc, 'Webhook 노드에 인증 없음 (cloudflared URL = 공개 URL)',
          'authentication을 headerAuth로 설정 — 비인증 요청은 401');
      }
    }

    // ③ 시크릿 노출: hardcoded credential-looking strings
    for (const [re, label] of SECRET_PATTERNS) {
      const m = raw.match(re);
      if (m && !m[0].includes('REPLACE_ME')) {
        add('시크릿 노출', loc, `${label} 하드코딩 의심: ${m[0].slice(0, 10)}…`,
          'n8n Credentials로 이동, 원문 값은 즉시 로테이션');
      }
    }

    // ④ CORS: wildcard origin
    if (params.options?.allowedOrigins === '*' ||
        /access-control-allow-origin[^}]{0,80}"\*"/i.test(raw)) {
      add('CORS', loc, 'CORS 와일드카드(*) 허용',
        '허용 origin을 명시적 화이트리스트로 제한');
    }

    // ⑤ 파괴적 쿼리 + ② SQL 문자열 보간
    if (node.type === 'n8n-nodes-base.postgres') {
      const q = String(params.query || '');
      const destructive = q.match(/\b(DROP|TRUNCATE|DELETE)\b/i);
      if (destructive) {
        add('파괴적 쿼리', loc, `${destructive[0].toUpperCase()} 문 포함`,
          '대상 명시 + 사람 승인 후만 실행, write 전 dry-run, 스키마 변경 전 pg_dump');
      }
      if (/\{\{[^}]*\$json/.test(q)) {
        add('미검증 입력', loc, 'SQL에 표현식 문자열 보간({{ $json… }}) — 인젝션 가능',
          '쿼리 파라미터($1, $2…) 바인딩으로 교체');
      }
    }

    // ② 미검증 입력: path traversal in any parameter
    if (raw.includes('../')) {
      add('미검증 입력', loc, "파라미터에 경로탐색('../') 포함",
        '절대경로 사용, 상위 디렉토리 참조 제거');
    }
  }
  return findings;
}

function main(files) {
  if (files.length === 0) {
    console.error('사용법: node scripts/sentinel/check.mjs <workflow.json> [...]');
    process.exit(2);
  }
  let total = 0;
  for (const file of files) {
    let wf;
    try {
      wf = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`✗ [JSON] ${file} 파싱 실패 — ${e.message} — 다음 행동: 파일 손상 여부 확인`);
      total += 1;
      continue;
    }
    const findings = checkWorkflow(wf, file);
    total += findings.length;
    for (const f of findings) {
      console.error(`✗ [${f.check}] ${f.cause} — 위치: ${f.file} / ${f.node} — 다음 행동: ${f.action}`);
    }
    if (findings.length === 0) console.log(`✓ ${file} — 정적 검사 통과`);
  }
  if (total > 0) {
    console.error(`\nSENTINEL 차단: 위반 ${total}건. 전부 해결 후 재실행 → 통과 시에만 배포(/go).`);
    process.exit(1);
  }
  console.log('\nSENTINEL 정적 검사 전부 통과. 다음: 동적 검사(Playwright MCP) 후 /go.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
