# Intelligent Indexing System - Project Plan

## Executive Summary
Automated system to keep Pinecone vector database and Google Sheets catalog synchronized with Google Drive sales collateral without manual intervention. Runs on-demand or on schedule.

## Current State (as of 2026-01-21)

### Completed Components
- ✅ Sync script (`scripts/sync-pinecone-catalog.js`)
- ✅ OCR support for image-based PDFs (Tesseract.js)
- ✅ Single file indexer (`scripts/index-single-file.js`)
- ✅ Google Drive recursive scanning
- ✅ File type support: Google Docs, Slides, Sheets, PDFs
- ✅ Metadata format matches n8n indexed files
- ✅ Text chunking (1000 chars, 200 overlap, line-based)
- ✅ OpenAI embeddings (text-embedding-3-large, 3072 dims)

### Current Index Stats
```yaml
Pinecone Index: knowledge-store-v4-n8n
Total Vectors: ~4,165 (after recent indexing)
Namespaces:
  - default: 4,147 vectors
  - archive: 18 vectors
Unique Files: ~100
```

### Recently Indexed Files (with OCR)
1. RMM Datasheet July 25 - 4 vectors
2. ExpertIQ-Datasheet.pdf - 3 vectors
3. AllyAI-Sales-Teammate Datasheet July 25 - 3 vectors
4. DSO_OnePager_Jul25.PDF - 4 vectors
5. CommerceIQ Copilot for Amazon - Datasheet July 25 - 4 vectors
6. AI Goal Optimizer Media Teammate Sell Sheet June 2025 - 3 vectors
7. CommerceIQ-AllyAI-Content-Agent-OnePager.pdf - 3 vectors

## System Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│              Google Drive (Source of Truth)             │
│           GTM Enablement Shared Drive Folder            │
│              0AJegFCCy8JzZUk9PVA                        │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ Scan & Compare
                     ▼
┌─────────────────────────────────────────────────────────┐
│           Intelligent Indexing System                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │  1. Drive Scanner                                 │  │
│  │     - Recursive folder scan                       │  │
│  │     - File metadata extraction                    │  │
│  │     - Supported types filtering                   │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  2. Change Detection                              │  │
│  │     - Compare Drive files vs Pinecone             │  │
│  │     - Identify: New, Modified, Deleted            │  │
│  │     - Use File.id + modifiedDate                  │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  3. Content Extraction                            │  │
│  │     - Google Docs API                             │  │
│  │     - Google Slides API                           │  │
│  │     - Google Sheets API                           │  │
│  │     - PDF extraction (pdf-parse)                  │  │
│  │     - OCR fallback (Tesseract.js)                 │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  4. Text Processing                               │  │
│  │     - Chunking (1000 chars, 200 overlap)          │  │
│  │     - Line-based splitting                        │  │
│  │     - Metadata preservation                       │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  5. Vector Generation                             │  │
│  │     - OpenAI embeddings API                       │  │
│  │     - Model: text-embedding-3-large               │  │
│  │     - Dimensions: 3072                            │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  6. Pinecone Sync                                 │  │
│  │     - Upsert new vectors                          │  │
│  │     - Delete modified/removed file vectors        │  │
│  │     - Batch operations (200 vectors)              │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  7. Catalog Update (Future)                       │  │
│  │     - Generate catalog entries                    │  │
│  │     - Update Google Sheets                        │  │
│  │     - Export to CSV                               │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                     │
                     │ Store
                     ▼
┌─────────────────────────────────────────────────────────┐
│         Pinecone Vector Database                         │
│         knowledge-store-v4-n8n                          │
└─────────────────────────────────────────────────────────┘
                     │
                     │ Query
                     ▼
┌─────────────────────────────────────────────────────────┐
│         Sally Slack Bot (RAG System)                    │
└─────────────────────────────────────────────────────────┘
```

## File Type Support

### ✅ Supported
- Google Docs (.gdoc)
- Google Slides (.gslides)
- Google Sheets (.gsheet)
- PDFs with text layer
- PDFs without text layer (via OCR)

### ❌ Not Supported
- Google Drive Shortcuts → Need to resolve to target file
- Audio files (.wav, .mp3)
- Video files (.mp4)
- PowerPoint (.pptx) uploaded files → Need conversion support
- Excel (.xlsx) uploaded files → Need conversion support

### 🔄 Partially Supported
- Image-based PDFs → OCR works but slower, ~95% accuracy

## Metadata Schema

```yaml
Vector Metadata (matches n8n format):
  File.name: "Document Name"
  File.id: "google-drive-file-id"
  File.webviewlink: "https://drive.google.com/..."
  File.createdDate: "2025-12-11"
  File.modifiedDate: "2025-12-11"
  text: "chunk content"
  blobType: "application/pdf" | "application/vnd.google-apps.document" | etc
  loc.lines.from: 1
  loc.lines.to: 12
```

## Sync Logic

### Change Detection Rules

1. **New File**: File.id exists in Drive but NOT in Pinecone
   - Action: Extract → Chunk → Embed → Upsert

2. **Modified File**: File.id exists in both, but Drive modifiedDate > Pinecone modifiedDate
   - Action: Delete old vectors → Extract → Chunk → Embed → Upsert

3. **Deleted File**: File.id exists in Pinecone but NOT in Drive
   - Action: Delete all vectors for that File.id

4. **Unchanged File**: File.id exists in both, modifiedDate matches
   - Action: Skip

### Comparison Method
```javascript
// Get all Drive files
driveFiles = scanGoogleDrive(folderId)

// Get all Pinecone files
pineconeFiles = queryPinecone() // Group by File.id

// Compare
newFiles = driveFiles.filter(df => !pineconeFiles.has(df.id))
modifiedFiles = driveFiles.filter(df =>
  pineconeFiles.has(df.id) &&
  df.modifiedTime > pineconeFiles.get(df.id).modifiedDate
)
deletedFiles = pineconeFiles.filter(pf => !driveFiles.has(pf.id))
```

## Run Modes

### 1. Dry Run (Review Changes Only)
```bash
npm run sync-dry-run
```
- Scans Drive and Pinecone
- Reports: New (X), Modified (X), Deleted (X)
- No actual changes made
- Use for: Testing, verification, reporting

### 2. Full Sync (Apply All Changes)
```bash
npm run sync
```
- Indexes new files
- Re-indexes modified files
- Deletes vectors for removed files
- Generates sync report
- Use for: Scheduled updates, manual sync

### 3. Single File Index (Test/Fix Specific File)
```bash
npm run index-single "File Name"
```
- Indexes one specific file by name
- Shows detailed extraction logs
- Use for: Testing, fixing specific files, debugging

## Implementation Phases

### Phase 1: Core Sync (COMPLETED ✅)
- [x] Google Drive scanner
- [x] Pinecone comparison
- [x] Change detection (new/modified/deleted)
- [x] Content extraction (Docs, Slides, Sheets, PDF)
- [x] OCR for image-based PDFs
- [x] Text chunking
- [x] Vector generation
- [x] Pinecone upsert/delete
- [x] Dry-run mode
- [x] Single file indexer

### Phase 2: Automation (NEXT)
- [ ] GitHub Actions workflow
  - [ ] Daily scheduled run
  - [ ] Manual trigger option
  - [ ] Email/Slack notifications on changes
- [ ] Error handling & retry logic
- [ ] Detailed logging system
- [ ] Sync history tracking

### Phase 3: Catalog Integration
- [ ] Auto-generate catalog entries for new files
- [ ] Google Sheets API integration
- [ ] Update catalog with new files
- [ ] CSV export automation
- [ ] Catalog validation

### Phase 4: Intelligence & Optimization
- [ ] Smart file prioritization (index frequently accessed first)
- [ ] Incremental updates (update only changed chunks)
- [ ] Duplicate detection (same content, different names)
- [ ] Content quality scoring
- [ ] Auto-categorization using GPT-4

### Phase 5: Monitoring & Reporting
- [ ] Dashboard for sync status
- [ ] Metrics: files indexed, vectors created, errors
- [ ] Alert system for failures
- [ ] Weekly summary reports
- [ ] Cost tracking (OpenAI API usage)

## GitHub Actions Workflow

### Trigger Options
1. **Scheduled**: Daily at 2 AM UTC
2. **Manual**: On-demand via GitHub Actions UI
3. **Webhook**: Triggered by Google Drive changes (future)

### Workflow Steps
```yaml
name: Sync Pinecone & Catalog

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:      # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - Checkout code
      - Setup Node.js 18
      - Install dependencies
      - Run sync script
      - Upload sync report as artifact
      - Send notification (Slack/Email) if changes
```

### Required Secrets
```yaml
PINECONE_API_KEY
OPENAI_API_KEY
GOOGLE_CREDENTIALS_JSON (base64 encoded)
GOOGLE_DRIVE_FOLDER_ID
SLACK_WEBHOOK_URL (optional, for notifications)
```

## Configuration

### Environment Variables
```bash
# Required
PINECONE_API_KEY=pcsk_...
PINECONE_INDEX_NAME=knowledge-store-v4-n8n
OPENAI_API_KEY=sk-proj-...
GOOGLE_CREDENTIALS_PATH=./google-credentials.json
GOOGLE_DRIVE_FOLDER_ID=0AJegFCCy8JzZUk9PVA

# Optional
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
BATCH_SIZE=200
OCR_ENABLED=true
DRY_RUN=false
LOG_LEVEL=info
```

### Sync Configuration Options
```javascript
const syncOptions = {
  dryRun: false,              // Preview only, no changes
  skipOCR: false,             // Skip OCR for faster sync (may miss some PDFs)
  batchSize: 200,             // Vectors per batch
  maxFilesPerRun: 0,          // 0 = unlimited, set limit for testing
  includeArchive: false,      // Sync to archive namespace
  rebuildCatalog: true,       // Regenerate catalog after sync
  notifyOnChanges: true       // Send notification if files changed
}
```

## Error Handling

### Retry Logic
- API failures: 3 retries with exponential backoff
- Rate limits: Automatic throttling
- Transient errors: Skip and continue

### Failure Scenarios
1. **Google API Error**: Log error, skip file, continue
2. **OpenAI API Error**: Retry 3x, then fail
3. **Pinecone Error**: Retry 3x, then fail
4. **OCR Timeout**: Skip file, log warning
5. **Out of Memory**: Process in smaller batches

### Notifications
- Success: Summary (X new, Y modified, Z deleted)
- Partial Failure: List of failed files
- Complete Failure: Full error log + alert

## Logging & Reporting

### Sync Report Format
```yaml
syncReport:
  timestamp: "2026-01-21T10:00:00Z"
  status: "success" | "partial" | "failed"

  summary:
    filesScanned: 164
    newFiles: 5
    modifiedFiles: 2
    deletedFiles: 1
    unchangedFiles: 156

  operations:
    vectorsCreated: 45
    vectorsDeleted: 12
    apiCalls:
      openai: 47
      google: 164
      pinecone: 5

  timing:
    totalDuration: "5m 23s"
    scanDuration: "1m 10s"
    indexDuration: "4m 13s"

  errors:
    - file: "Problem File.pdf"
      error: "OCR timeout"
      action: "skipped"

  costs:
    openai: "$0.45"
    estimated: true
```

### Log Files
- `logs/sync-YYYY-MM-DD.log` - Detailed sync log
- `logs/errors-YYYY-MM-DD.log` - Error-only log
- `reports/sync-report-YYYY-MM-DD.json` - Machine-readable report

## Testing Strategy

### Unit Tests
- [ ] Text chunking logic
- [ ] Metadata extraction
- [ ] Change detection algorithm

### Integration Tests
- [ ] Google Drive API mocking
- [ ] Pinecone API mocking
- [ ] End-to-end sync with test data

### Manual Testing Checklist
- [ ] New file added to Drive → Appears in Pinecone
- [ ] Existing file modified → Old vectors deleted, new created
- [ ] File deleted from Drive → Vectors removed
- [ ] PDF without text → OCR triggered
- [ ] Large file (>10MB) → Processed correctly
- [ ] Invalid file type → Skipped gracefully

## Performance Optimization

### Current Performance
- Google Drive scan: ~30 files/second
- Content extraction: 1-5 seconds/file
- OCR: 5-15 seconds/page
- Embeddings: ~1 second/chunk
- Total sync time: ~5-10 minutes for 164 files (with changes)

### Optimization Opportunities
1. **Parallel Processing**: Process multiple files simultaneously
2. **Caching**: Cache Drive metadata, refresh only if modified
3. **Selective Sync**: Only sync files modified in last X days
4. **Incremental Embeddings**: Update only changed chunks
5. **OCR Optimization**: Pre-process PDFs to detect text layer

## Cost Estimation

### Per File Costs
```yaml
Text-based file (2000 chars):
  - Chunks: 2-3
  - Embeddings: $0.0003 (3 chunks × $0.0001)

Image-based PDF (1 page):
  - OCR: Free (Tesseract)
  - Embeddings: $0.0003

Total per file: ~$0.0003-0.0005
```

### Monthly Costs (164 files, daily sync)
```yaml
Scenario 1: No changes (dry run only)
  - Cost: $0 (no API calls)

Scenario 2: 5 new files/day average
  - Files/month: 150
  - Embeddings: 150 × $0.0003 = $0.045
  - OpenAI API: ~$2-5/month (includes RAG queries)

Scenario 3: Full re-index monthly
  - Files: 164
  - Embeddings: 164 × $0.0003 = $0.05
  - One-time cost
```

## Security & Access

### Authentication
- Google Drive: Service account with read-only access
- Pinecone: API key with read/write access
- OpenAI: API key with embeddings access

### Secrets Management
- Local: `.env` file (gitignored)
- GitHub Actions: Repository secrets
- Production: AWS Secrets Manager / HashiCorp Vault

### Access Control
- Google Drive folder: Shared with service account
- Pinecone index: Single project, team access
- Logs: Private repository, limited access

## Future Enhancements

### Phase 6: Advanced Features
- [ ] Multi-language support (detect language, use appropriate model)
- [ ] Version control (keep history of document changes)
- [ ] Content-based search (find similar documents)
- [ ] Auto-tagging (extract tags from content)
- [ ] Sentiment analysis for customer feedback docs

### Phase 7: Enterprise Features
- [ ] Multi-folder support (different folders = different namespaces)
- [ ] Role-based access control
- [ ] Audit logging
- [ ] SLA monitoring
- [ ] Disaster recovery

## Success Metrics

### Key Performance Indicators
1. **Sync Reliability**: >99% successful syncs
2. **Sync Speed**: <10 minutes for full sync
3. **Data Freshness**: <24 hours lag
4. **Error Rate**: <1% files failing
5. **Cost Efficiency**: <$10/month operational cost

### Monitoring Dashboards
- Sync frequency & success rate
- Files indexed over time
- Vector count growth
- API usage & costs
- Error types & frequency

## Dependencies

### NPM Packages
```json
{
  "@pinecone-database/pinecone": "^2.0.1",
  "googleapis": "^131.0.0",
  "openai": "^4.26.0",
  "dotenv": "^16.4.1",
  "pdf-parse": "^1.1.1",
  "tesseract.js": "^5.0.0",
  "pdf-to-png-converter": "^3.0.0",
  "uuid": "^9.0.1"
}
```

### External Services
- Google Drive API
- Google Docs/Slides/Sheets APIs
- Pinecone (Serverless)
- OpenAI Embeddings API
- GitHub Actions (for automation)

## Rollout Plan

### Week 1: Testing & Validation
- Run daily dry-runs to monitor for issues
- Validate change detection accuracy
- Test on subset of files

### Week 2: Pilot Launch
- Enable full sync, manual trigger only
- Monitor for 1 week
- Collect metrics & feedback

### Week 3: Automation
- Enable GitHub Actions daily schedule
- Set up notifications
- Monitor automated runs

### Week 4: Optimization
- Analyze performance data
- Optimize slow operations
- Reduce costs where possible

## Support & Maintenance

### Maintenance Tasks
- Weekly: Review sync reports
- Monthly: Analyze costs & optimize
- Quarterly: Update dependencies
- Annually: Full system audit

### Troubleshooting Guide
1. **Sync Failing**: Check API keys, credentials, permissions
2. **Files Not Indexing**: Check file type support, OCR logs
3. **Wrong Results**: Verify metadata schema, chunking logic
4. **High Costs**: Review batch sizes, reduce sync frequency

## Contact & Documentation

### Key Files
- `INTELLIGENT-INDEXING-PLAN.md` - This document
- `CLAUDE.md` - System configuration & commands
- `PROJECT-STATUS.md` - Current status
- `scripts/sync-pinecone-catalog.js` - Main sync script
- `scripts/index-single-file.js` - Single file indexer

### Team
- Owner: Jobanjeet Singh
- Repository: sally-sales-enablement
- GitHub: jobanjeets-glitch
