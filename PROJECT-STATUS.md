# Sally Project Status

## Completed
```yaml
infrastructure:
  - Project scaffolding
  - Pinecone index (knowledge-store-v4-n8n, 3072 dims)
  - OpenAI integration (GPT-4 + text-embedding-3-large)
  - Slack bot (Socket Mode)
  - Environment config

core_features:
  - RAG processor with strict citations
  - Query expansion (DSA, RMM, AC abbreviations)
  - Pinecone client (CRUD)
  - Google Drive scanner
  - Document chunker

indexing:
  - ~100 files indexed via n8n
  - Metadata schema (File.name, File.webviewlink)
  - PDF + Google Docs support

cleanup_2025_01_14:
  deleted:
    - 9x "Copy of" duplicate battle cards
    - Profitero Battle Card (May 24)
    - Data Impact Battle Card (May 24)
  archived:
    - Supplypike Battle Card (May 2024) → archive namespace
  total_removed: 140 vectors

documentation_2025_01_14:
  - CLAUDE.md (YAML, token-efficient)
  - PROJECT-STATUS.md
  - .claude/settings.json (model hints)
  - .claude/commands/ (stats, files, query, delete, archive)
  - Utility scripts (list-files, delete-file, move-to-archive)
```

## In Progress
```yaml
two_stage_retrieval:
  design: complete
  implementation: pending (n8n workflow)
  flow: primary → score < 0.55 → archive → merge
```

## Pending
```yaml
high_priority:
  brand_market_share:
    status: waiting on CSV
    data: 200k brands, 136 L2, 25 L1 categories
    approach: SQLite + text-to-SQL

  archive_fallback:
    status: needs n8n workflow update
    tasks:
      - IF node for score threshold
      - Second Pinecone query (archive)
      - Merge results code node

medium_priority:
  google_drive_reindex:
    blocker: no credentials configured
    files: 11 archived files to re-index

  slack_bot_improvements:
    - Conversation history
    - Feedback collection
    - Response logging

low_priority:
  monitoring:
    - Query logging
    - Retrieval metrics
    - User satisfaction
```

## Empty Directories (Planned)
```yaml
feedback/: User feedback collection (not implemented)
scheduler/: Periodic re-indexing (not implemented)
```

## Index Stats
```yaml
index: knowledge-store-v4-n8n
total_vectors: 3463
namespaces:
  default: 3445
  archive: 18
unique_files: ~93
```
