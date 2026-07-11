// node --test scripts/sentinel/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkflow } from './check.mjs';

const FAKE_TOKEN = 'ghp_' + 'x'.repeat(24); // obviously fake, matches pattern shape only

const badWorkflow = {
  nodes: [
    {
      name: 'Open Webhook',
      type: 'n8n-nodes-base.webhook',
      parameters: { path: 'hook', authentication: 'none' },
    },
    {
      name: 'Leaky HTTP',
      type: 'n8n-nodes-base.httpRequest',
      parameters: { headerParameters: { Authorization: `Bearer ${FAKE_TOKEN}` } },
    },
    {
      name: 'Wildcard CORS',
      type: 'n8n-nodes-base.respondToWebhook',
      parameters: { options: { responseHeaders: { 'Access-Control-Allow-Origin': '*' } } },
    },
    {
      name: 'Raw Delete',
      type: 'n8n-nodes-base.postgres',
      parameters: { query: "DELETE FROM users WHERE id = '{{ $json.id }}'" },
    },
    {
      name: 'Traversal Write',
      type: 'n8n-nodes-base.readWriteFile',
      parameters: { fileName: '/vault/../etc/passwd' },
    },
  ],
};

const goodWorkflow = {
  nodes: [
    {
      name: 'Safe Query',
      type: 'n8n-nodes-base.postgres',
      parameters: {
        query: 'INSERT INTO sync_state (page_id) VALUES ($1) ON CONFLICT DO NOTHING',
        options: { queryReplacement: '={{ [$json.page_id] }}' },
      },
    },
    {
      name: 'Safe Write',
      type: 'n8n-nodes-base.readWriteFile',
      parameters: { fileName: 'REPLACE_ME_VAULT_PATH/notion-sync/note.md' },
    },
  ],
};

test('bad workflow: all five SENTINEL checks fire', () => {
  const findings = checkWorkflow(badWorkflow, 'bad.json');
  const checks = new Set(findings.map((f) => f.check));
  assert.ok(checks.has('비인증 라우트'), 'unauthenticated webhook detected');
  assert.ok(checks.has('시크릿 노출'), 'hardcoded secret detected');
  assert.ok(checks.has('CORS'), 'CORS wildcard detected');
  assert.ok(checks.has('파괴적 쿼리'), 'destructive SQL detected');
  assert.ok(checks.has('미검증 입력'), 'interpolated SQL / path traversal detected');
  assert.ok(findings.length >= 5);
  for (const f of findings) {
    assert.ok(f.cause && f.node && f.action, 'finding has cause + location + next action');
  }
});

test('good workflow: no findings, placeholders allowed', () => {
  assert.equal(checkWorkflow(goodWorkflow, 'good.json').length, 0);
});
