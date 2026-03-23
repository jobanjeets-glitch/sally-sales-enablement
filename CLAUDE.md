# Sally - Sales Enablement RAG Agent

## Quick Reference
```yaml
project: sally-sales-enablement
type: RAG chatbot for sales docs
stack: Node.js, Pinecone, OpenAI, Slack

commands:
  npm start: Start Slack bot
  npm run list-files: List indexed files
  npm run delete-file "name": Delete file
  npm run move-to-archive "name": Archive file
  npm run cleanup: Interactive cleanup
  npm run test-query: Test RAG queries
```

## Pinecone Config
```yaml
index: knowledge-store-v4-n8n
host: knowledge-store-v4-n8n-xa1rt3d.svc.aped-4627-b74a.pinecone.io
dimension: 3072
metric: cosine
embedding_model: text-embedding-3-large

namespaces:
  default: 3445 vectors (current docs)
  archive: 18 vectors (fallback docs)

other_indexes:
  - sally-knowledge-store-v4-claude (3072, backup)
  - knowledgestore3 (1536, legacy)
  - voice-of-customer (1536)
  - calltranscripts (1536)
```

## Vector Metadata Schema
```yaml
# n8n indexed format (current)
File.name: "Document Name"
File.id: "google-drive-id"
File.webviewlink: "https://docs.google.com/..."
File.createdDate: "2025-12-11"
File.modifiedDate: "2025-12-11"
text: "chunk content"
blobType: "application/pdf"
loc.lines.from: 1
loc.lines.to: 12
```

## Environment Variables
```yaml
required:
  PINECONE_API_KEY: pcsk_...
  PINECONE_INDEX_NAME: knowledge-store-v4-n8n
  OPENAI_API_KEY: sk-proj-...
  GOOGLE_CREDENTIALS_PATH: ./google-credentials.json
  GOOGLE_DRIVE_FOLDER_ID: folder-id
  SALLY_SLACK_BOT_TOKEN: xoxb-...
  SALLY_SLACK_APP_TOKEN: xapp-...
  SALLY_SLACK_SIGNING_SECRET: secret
  PORT: 3001
```

## Product Abbreviations
```yaml
DSA: Digital Shelf Analytics
DSO: Digital Shelf Optimization
AC: Amazon Copilot / CommerceIQ Copilot
RMM: Retail Media Management
OCC: Omnichannel Command Center
MS: Market Share
PRA: Profit Recovery Automation
MI: Market Insights
Ally: AllyAI agentic offerings
ESM: Ecommerce Sales Management
```

## Directory Structure
```yaml
indexer/:
  google-drive.js: Google Drive API scanner
  chunker.js: Document chunking

query/:
  pinecone-client.js: Pinecone CRUD operations
  rag-processor.js: Main RAG logic + GPT-4

slack-bot/:
  server.js: Slack Bolt server

scripts/:
  initial-index.js: Index from Google Drive
  cleanup-index.js: Interactive cleanup
  list-indexed-files.js: List all files
  delete-file.js: Delete specific file
  move-to-archive.js: Move to archive namespace
  test-query.js: Test RAG queries
```

## Key Methods
```yaml
PineconeClient:
  - createEmbedding(text): Create 3072-dim embedding
  - query(text, topK, filter): Search vectors
  - upsertVectors(vectors): Add vectors
  - deleteVectors(ids): Delete by IDs
  - getStats(): Index statistics

RAGProcessor:
  - expandQuery(query): Expand abbreviations
  - query(question, topK=10): Main RAG method
  returns: { answer, citations, confidence, relevanceScores }
```

## Common Operations
```yaml
check_stats: |
  node -e "import { Pinecone } from '@pinecone-database/pinecone'; import dotenv from 'dotenv'; dotenv.config(); const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY }); const s = await pc.index(process.env.PINECONE_INDEX_NAME).describeIndexStats(); console.log(JSON.stringify(s, null, 2));"

query_archive: |
  Use namespace: index.namespace('archive').query({...})

filter_by_filename: |
  filter: { 'File.name': { $eq: 'filename' } }
```

## Pending Features
```yaml
two_stage_retrieval:
  status: designed, not implemented
  flow: query primary → score < 0.55 → query archive → merge
  blocker: needs n8n workflow update

brand_market_share:
  status: planned
  data: 200k brands, 136 L2 categories, 25 L1 categories
  approach: SQLite + text-to-SQL
  blocker: waiting on CSV data
```

## Recent Cleanup (2025-01-14)
```yaml
deleted_files:
  - Copy of Data Impact Competitive Battle Card DSA (5)
  - Copy of Data Impact Competitive Battle Card MS (4)
  - Copy of Pacvue Competitive Battle Card ESM (5)
  - Copy of Pacvue Competitive Battle Card RMM (9)
  - Copy of Profitero Competitive Battle Card DSA (5)
  - Copy of Profitero Competitive Battle Card ESM (4)
  - Copy of Profitero Competitive Battle Card MS (4)
  - Copy of Profitero Competitive Battle Card PRA (4)
  - Copy of Profitero Competitive Battle Card RMM (5)
  - Profitero Competitive Battle Card (Updated May 24) (56)
  - Data Impact Competitive Battle Card (Updated May 24) (39)

archived_files:
  - Supplypike Competitive Battle Card (Updated May 2024) (18)

total_deleted: 140 vectors
```

## Notes
```yaml
indexing: Done via n8n, not Sally's indexer (no Google creds)
metadata_format: n8n uses 'File.name', Sally uses 'fileName'
rag_processor: Handles both formats
pinecone_limit: 5 indexes max (using namespaces instead)
```
