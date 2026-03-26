# Sally — Sales Enablement Agent v2

## Quick Reference
```yaml
project: sally-sales-enablement
version: v2 (Claude Agent SDK)
stack: Node.js, Pinecone, OpenAI (embeddings + router), Claude (agents), Slack

commands:
  npm start:               Start Slack bot (production)
  npm run dev:             Start with nodemon (hot reload)
  npm run agent-test:      Test agents locally (no Slack)
  node agent/test-router.js: Run 20-case intent router accuracy test
  npm run list-files:      List indexed files
  npm run delete-file "name": Delete file from Pinecone
  npm run move-to-archive "name": Archive file
  npm run cleanup:         Interactive cleanup
  npm run test-query:      Test RAG queries (legacy)
  npm run fix-names:       Fix Drive↔Pinecone↔Sheet name mismatches
  npm run enrich-catalog:  Fill empty metadata via Claude
```

## Sally v2 Architecture
```
Slack message
  ↓
slack-bot/server.js  (Slack Bolt + Socket Mode + Express health check)
  ↓
agent/sally-agent.js  (SallyAgent — orchestrator + leaked-reasoning filter)
  ↓
agent/router.js  (rule-based → gpt-4o-mini fallback, default=synthesis)
  ├── 'document'    → CatalogAgent     agent/catalog-agent.js
  ├── 'information' → RAGAgent         agent/rag-agent.js
  └── 'synthesis'   → SynthesisAgent   agent/synthesis-agent.js  ← CATCH-ALL

agent/sally-tools.js  (MCP tool factories, 3 server variants)
  ├── vector_search       → query/pinecone-client.js
  ├── find_document       → query/document-catalog.js
  ├── list_documents      → document-catalog-identity-focused.json
  └── get_document_details → document-catalog-identity-focused.json
```

## Agents
```yaml
CatalogAgent (agent/catalog-agent.js):
  prompt: agent/prompts/catalog.md  # {{CATALOG}} replaced at init
  tools: find_document, list_documents, get_document_details
  maxTurns: 3
  triggers: "send me", "find me", "battle card", "deck", "link to", "list all", "do we have"
  special: full 116-doc catalog injected in system prompt → usually 0 tool calls

RAGAgent (agent/rag-agent.js):
  prompt: agent/prompts/rag.md
  tools: vector_search (supports namespace: default | archive)
  maxTurns: 5
  triggers: product questions, features, competitive intel, proof points, objections

SynthesisAgent (agent/synthesis-agent.js):
  prompt: agent/prompts/synthesis.md
  tools: ALL 4 (vector_search + find_document + list_documents + get_document_details)
  maxTurns: 8
  triggers: create/draft/build/write, meeting prep, pitch for, account plan, email for
  note: CATCH-ALL — ambiguous queries always route here
```

## Intent Router (agent/router.js)
```yaml
strategy: rule-based first (zero latency) → gpt-4o-mini fallback
default: synthesis (has all 4 tools, can handle anything)
test_score: 19/20 (95%) — run: node agent/test-router.js
llm_fallback: gpt-4o-mini (uses OPENAI_API_KEY)
upgrade_path: swap to claude-haiku-4-5 when ANTHROPIC_API_KEY available
```

## Environment Variables
```yaml
required:
  ANTHROPIC_API_KEY: sk-ant-...  # For Claude agents — get from console.anthropic.com
  CLAUDE_MODEL: claude-sonnet-4-6
  PINECONE_API_KEY: pcsk_...
  PINECONE_INDEX_NAME: knowledge-store-v4-n8n
  OPENAI_API_KEY: sk-proj-...    # Embeddings + router gpt-4o-mini fallback
  SALLY_SLACK_BOT_TOKEN: xoxb-...
  SALLY_SLACK_APP_TOKEN: xapp-...
  SALLY_SLACK_SIGNING_SECRET: ...
  HEALTH_PORT: 3001
optional:
  SALLY_ADMIN_USER_ID: U...      # Slack user ID to DM on 👎 feedback
  GOOGLE_CREDENTIALS_PATH: ./google-credentials.json
  GOOGLE_DRIVE_FOLDER_ID: ...
  CATALOG_SHEET_ID: 1zwmfU-b2ADXWUYYAYdMEYSPHqetUfgSIsQEwnYnyeu4
```

## Pinecone Config
```yaml
index: knowledge-store-v4-n8n
dimension: 3072 (text-embedding-3-large)
metric: cosine
namespaces:
  default: ~3445 vectors (current docs)
  archive: 18 vectors (score < 0.55 fallback)
metadata_keys: File.name, File.id, File.webviewlink, File.createdDate, text
```

## Document Catalog
```yaml
file: query/document-catalog-identity-focused.json
count: 116 docs (as of 2026-03-25)
google_sheet: 1zwmfU-b2ADXWUYYAYdMEYSPHqetUfgSIsQEwnYnyeu4
class: query/document-catalog.js

scripts (run manually only — NOT in daily sync):
  build-identity-focused-catalog.js: full rebuild from Pinecone + GPT-4
  update-catalog-sheet.js: add new rows to Sheet for untracked files
  fix-names-and-details.js: fix name mismatches (npm run fix-names)
  enrich-catalog-metadata.js: Claude fills empty metadata (npm run enrich-catalog)
```

## Daily Sync (GitHub Actions)
```yaml
file: .github/workflows/daily-sync.yml
phases:
  2. Rename  → update Pinecone name + Sheet column A
  3. Add new → index new file + add Sheet row → enrich
  4. Modified → re-index + mark Sheet "Needs Review"
  5. Archive → delete Pinecone vectors + DELETE Sheet row
  6. Delete  → delete Pinecone vectors + DELETE Sheet row
  8. Commit catalog JSON [skip ci] → Render auto-redeploys
```

## Slack Bot (slack-bot/server.js)
```yaml
mode: Socket Mode (no public URL, outbound WebSocket)
health: GET /health on HEALTH_PORT (Render keep-alive)
responds_to:
  - @Sally in any channel
  - Direct messages
  - #ask-sally (channel ID: C09H3DM4KED)
features:
  - Thread context (last 10 messages passed to agent)
  - Markdown → Slack mrkdwn conversion
  - 👍/👎 feedback buttons → var/feedback.jsonl
  - Admin DM on 👎 (SALLY_ADMIN_USER_ID)
  - Leaked-reasoning regex filter on all outputs
slash_commands: /sally-help, /sally-stats
```

## CSSL — Canonical Case Studies
```
https://docs.google.com/presentation/d/1AKgrmgU_a3wvFJPsMfhjshmIIDURdtxEnfnRuyOSYOE/edit?usp=drivesdk
Always reference CSSL first for any case study request.
```

## Product Abbreviations
```yaml
DSA: Digital Shelf Analytics | DSO: Digital Shelf Optimization
AC/Copilot: Amazon Copilot / CommerceIQ Copilot
RMM: Retail Media Management | OCC: Omnichannel Command Center
MS: Market Share | PRA: Profit Recovery Automation
MI: Market Insights | ESM: Ecommerce Sales Management
Ally/AllyAI: Agentic AI (Sales/Shelf/Content/Media Agent)
```

## Install Notes
```yaml
cmd: npm install --legacy-peer-deps
reason: openai@4 has optional zod@3 peer dep; Claude Agent SDK needs zod@4
```

## Deployment (Render)
```yaml
type: Web Service
build: npm install
start: npm start
health_path: /health
port: 3001
auto_deploy: push to main → Render redeploys (catalog JSON commit triggers this)
```
