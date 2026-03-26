# Sally Project Status

## Current State: Sally v2 — Built, NOT Yet Tested
```yaml
status: code complete, blocked on ANTHROPIC_API_KEY
last_updated: 2026-03-26
```

## Completed ✅
```yaml
sally_v2_architecture:
  - Claude Agent SDK integration (@anthropic-ai/claude-agent-sdk)
  - SallyAgent orchestrator (agent/sally-agent.js)
  - Intent router — rule-based + gpt-4o-mini fallback (agent/router.js)
    test_score: 19/20 (95%) — node agent/test-router.js
  - CatalogAgent — document lookup (agent/catalog-agent.js)
  - RAGAgent — vector search (agent/rag-agent.js)
  - SynthesisAgent — pitches/email/meeting prep (agent/synthesis-agent.js) [catch-all]
  - 4 MCP tools: vector_search, find_document, list_documents, get_document_details
  - System prompts in agent/prompts/*.md (catalog.md, rag.md, synthesis.md)
  - Local test script: agent/test-agent.js (npm run agent-test)

slack_bot:
  - Socket Mode (no public URL)
  - Thread context (last 10 messages)
  - Markdown → Slack mrkdwn conversion
  - 👍/👎 feedback buttons + var/feedback.jsonl log
  - Admin DM on 👎 (SALLY_ADMIN_USER_ID)
  - Leaked-reasoning filter
  - /sally-help and /sally-stats slash commands
  - Responds to: @mentions, DMs, #ask-sally

daily_sync:
  - GitHub Actions (.github/workflows/daily-sync.yml)
  - Full file lifecycle: add/rename/modify/archive/delete
  - Google Sheet sync: row add, name update, status update, row DELETE
  - Commits catalog JSON back to repo [skip ci] → Render auto-redeploys

document_catalog:
  - 116 docs in query/document-catalog-identity-focused.json
  - Google Sheet: 1zwmfU-b2ADXWUYYAYdMEYSPHqetUfgSIsQEwnYnyeu4
  - Enrich/fix scripts: npm run fix-names, npm run enrich-catalog
```

## Immediate Blocker 🚨
```yaml
missing: ANTHROPIC_API_KEY
action: Get from console.anthropic.com → API Keys
add_to_env:
  ANTHROPIC_API_KEY: sk-ant-...
  CLAUDE_MODEL: claude-sonnet-4-6
  HEALTH_PORT: 3001
then: npm start → test in Slack
```

## Next Steps (in order)
```yaml
1_unblock:
  - Add ANTHROPIC_API_KEY to .env
  - Run npm start locally
  - Test 5 queries in Slack (document, info, synthesis, ambiguous, meeting prep)

2_deploy_to_render:
  - Add all env vars to Render dashboard
  - Confirm /health endpoint responds
  - Confirm Sally responds in Slack via Render

3_retire_n8n:
  - Disable n8n Slack answering workflow (GitHub Actions already handles sync)
  - Confirm only Sally v2 responds in #ask-sally

4_improve_router_optional:
  - Swap gpt-4o-mini → claude-haiku-4-5 (cheaper, faster, on-brand)
  - Requires ANTHROPIC_API_KEY to be set

5_future:
  - brand_market_share: SQLite + text-to-SQL (waiting on CSV data)
  - query logging / analytics dashboard
```

## Index Stats (last checked 2026-03-25)
```yaml
index: knowledge-store-v4-n8n
namespaces:
  default: ~3445 vectors
  archive: 18 vectors
catalog_docs: 116
```
