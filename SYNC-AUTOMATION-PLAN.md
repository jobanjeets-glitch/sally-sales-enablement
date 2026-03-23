# Pinecone & Catalog Sync Automation - Implementation Plan

## Problem Statement

**Current State:**
- Manual indexing of new files
- Manual catalog rebuilding
- n8n workflow exists but doesn't work well for new files
- No way to detect when files are updated in Google Drive
- Catalog can become stale

**Goal:**
Create an automated daily sync system that:
1. Detects new files in Google Drive → Index to Pinecone
2. Detects modified files → Re-index (delete old, add new)
3. Detects deleted files → Handle appropriately
4. Rebuilds catalog when changes occur
5. Runs automatically every day
6. Provides logs and monitoring

---

## Solution Approaches

### Approach 1: Node.js Script + GitHub Actions (RECOMMENDED)

**Architecture:**
```
Google Drive (source of truth)
    ↓
Sync Script (Node.js)
    ├─ Compare Drive vs Pinecone
    ├─ Index new/modified files
    └─ Rebuild catalog
    ↓
Pinecone (updated)
    ↓
Catalog JSON (regenerated)

Scheduled via: GitHub Actions (daily at 2 AM UTC)
```

**Pros:**
- ✅ Free (GitHub Actions free tier: 2,000 min/month)
- ✅ No server maintenance needed
- ✅ Git-based - version control for scripts
- ✅ Easy to monitor (GitHub UI)
- ✅ Secrets management built-in
- ✅ Can run on-demand or scheduled
- ✅ Logs stored in GitHub
- ✅ Email notifications on failure

**Cons:**
- ⚠️ Requires pushing code to GitHub
- ⚠️ 6-hour max run time (plenty for this use case)

**Components:**
```yaml
Sync Script:
  - scripts/sync-pinecone-catalog.js (main sync logic)
  - Uses existing: google-drive.js, chunker.js
  - Outputs: sync-log.jsonl

GitHub Action:
  - .github/workflows/daily-sync.yml
  - Runs: node scripts/sync-pinecone-catalog.js
  - Schedule: cron '0 2 * * *' (2 AM UTC daily)
  - Secrets: PINECONE_API_KEY, OPENAI_API_KEY, GOOGLE_CREDENTIALS

Monitoring:
  - GitHub Actions UI (shows success/failure)
  - Email alerts on failure
  - Sync log saved as artifact
```

**Estimated Setup Time:** 2-3 hours

---

### Approach 2: Cron Job on Cloud VM

**Architecture:**
```
Cloud VM (AWS EC2 / GCP Compute / DigitalOcean)
    ↓
Cron job (runs daily at 2 AM)
    ↓
Node.js sync script
    ↓
Updates Pinecone + Catalog
```

**Pros:**
- ✅ Full control over environment
- ✅ Can run heavy workloads
- ✅ No time limits
- ✅ Traditional approach

**Cons:**
- ❌ Costs money ($5-10/month for small VM)
- ❌ Need to maintain server (updates, security)
- ❌ Setup SSH, deploy scripts, manage credentials
- ❌ Need separate monitoring tool

**Components:**
```bash
Setup:
1. Provision cloud VM
2. Install Node.js
3. Clone project
4. Set up environment variables
5. Configure cron: 0 2 * * * cd /path/to/project && node scripts/sync.js
6. Set up log rotation

Monitoring:
- cron emails
- Log files
- Optional: Datadog, New Relic
```

**Estimated Setup Time:** 4-5 hours

---

### Approach 3: Google Cloud Functions + Cloud Scheduler

**Architecture:**
```
Cloud Scheduler (daily trigger)
    ↓
Cloud Function (serverless Node.js)
    ↓
Executes sync script
    ↓
Updates Pinecone + Catalog
    ↓
Saves catalog to Cloud Storage
```

**Pros:**
- ✅ Serverless (only pay when running)
- ✅ Native Google Cloud integration
- ✅ Good for Google Drive API access
- ✅ Built-in monitoring (Cloud Logging)
- ✅ Scales automatically

**Cons:**
- ⚠️ Requires Google Cloud account
- ⚠️ 9-minute max execution time (2nd gen: 60 min)
- ⚠️ Need to deploy function
- ⚠️ Learning curve if not familiar with GCP

**Components:**
```yaml
Cloud Function:
  - Runtime: Node.js 20
  - Trigger: Cloud Scheduler
  - Memory: 2 GB
  - Timeout: 540s (9 min) or 3600s for 2nd gen

Cloud Scheduler:
  - Schedule: 0 2 * * * (daily 2 AM)
  - Target: Cloud Function URL

Storage:
  - Catalog JSON saved to Cloud Storage bucket
  - Logs in Cloud Logging
```

**Estimated Setup Time:** 3-4 hours
**Cost:** ~$1-2/month

---

### Approach 4: n8n Scheduled Workflow (Fix Existing)

**Architecture:**
```
n8n Schedule Trigger (daily)
    ↓
Custom n8n nodes:
    ├─ List Google Drive files
    ├─ Compare with Pinecone
    ├─ Index new/modified files
    └─ Rebuild catalog
```

**Pros:**
- ✅ Already have n8n set up
- ✅ Visual workflow
- ✅ No code deployment needed

**Cons:**
- ❌ You mentioned it doesn't work well for new files
- ❌ Complex logic hard to debug in n8n
- ❌ Limited error handling
- ❌ Harder to version control

**Recommendation:** Not recommended based on your experience

---

### Approach 5: Apache Airflow (Your Friend's Approach)

**Architecture:**
```
Apache Airflow (workflow orchestration)
    ↓
DAG (Directed Acyclic Graph):
    Task 1: Scan Drive
    Task 2: Compare with Pinecone
    Task 3: Index new files
    Task 4: Re-index modified
    Task 5: Rebuild catalog
    ↓
Monitoring Dashboard
```

**Pros:**
- ✅ Enterprise-grade orchestration
- ✅ Powerful monitoring/alerting
- ✅ Task dependencies
- ✅ Retry logic
- ✅ Great for complex workflows

**Cons:**
- ❌ OVERKILL for this use case
- ❌ Complex setup (requires database, web server, scheduler)
- ❌ Steep learning curve
- ❌ Resource-heavy
- ❌ Costs money to host

**Recommendation:** Only if you're already using Airflow for other things

**Estimated Setup Time:** 8-10 hours
**Cost:** $20-50/month for managed (Cloud Composer, MWAA)

---

## Google Drive MCP Server - Should We Build It?

### What is MCP Server?

Model Context Protocol (MCP) server would let Claude Code directly access Google Drive files in real-time during conversations.

**Example:**
```
User: "Check if DSO Product Description was updated today"
    ↓
Claude uses MCP server to:
    - List files in Drive
    - Check modified dates
    - Read file content if needed
```

### Pros of Building MCP Server:
- ✅ Real-time Drive access during Claude sessions
- ✅ No need to manually run scripts
- ✅ Interactive debugging
- ✅ Can check file status on-demand

### Cons of MCP Server:
- ❌ Doesn't solve automation problem (still need scheduled sync)
- ❌ Only works during interactive Claude sessions
- ❌ Can't run headless/automated
- ❌ Setup complexity

### **Recommendation: NOT needed for this use case**

**Why?**
- Your goal is **automated daily sync**, not interactive Drive access
- MCP is great for "during conversation" needs, not batch processing
- You already have Google Drive API working in scripts
- MCP would be an additional complexity without solving the core problem

**When MCP would be useful:**
- If you wanted Claude to interactively explore Drive during conversations
- If you wanted to manually check files before syncing
- If you needed ad-hoc Drive operations

---

## Recommended Solution: GitHub Actions + Node.js Script

### Why This Is Best For You:

1. **Free** - GitHub Actions free tier is generous
2. **No server maintenance** - GitHub handles infrastructure
3. **Version controlled** - All code in Git
4. **Easy monitoring** - GitHub UI shows all runs
5. **Notifications** - Email on failure
6. **Secrets management** - GitHub Secrets for API keys
7. **On-demand runs** - Can trigger manually anytime
8. **Logs preserved** - 90 days by default

### Architecture Diagram:

```
┌─────────────────────────────────────────────────────────────┐
│                   GOOGLE DRIVE                              │
│             (GTM Collateral Folder)                         │
│                                                             │
│  • New files added                                          │
│  • Existing files modified                                  │
│  • Files deleted                                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              GITHUB ACTIONS (Scheduler)                     │
│                                                             │
│  Trigger: Daily at 2 AM UTC (cron: 0 2 * * *)             │
│  OR: Manual trigger (workflow_dispatch)                    │
│  OR: On push to main branch                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│           SYNC SCRIPT (Node.js)                             │
│           scripts/sync-pinecone-catalog.js                  │
│                                                             │
│  Step 1: Get all files from Google Drive                   │
│    ├─ Use google-drive.js                                  │
│    └─ Filter to supported types (Docs, Slides, PDF)       │
│                                                             │
│  Step 2: Get all files from Pinecone                       │
│    ├─ Query with empty vector (top 10K)                   │
│    └─ Build map of fileId -> metadata                     │
│                                                             │
│  Step 3: Compare Drive vs Pinecone                         │
│    ├─ Identify new files (in Drive, not in Pinecone)     │
│    ├─ Identify modified files (modifiedDate changed)      │
│    └─ Identify deleted files (in Pinecone, not in Drive) │
│                                                             │
│  Step 4: Process Changes                                    │
│    ├─ NEW: Index to Pinecone                              │
│    │   └─ Download → Chunk → Embed → Upsert              │
│    ├─ MODIFIED: Re-index                                   │
│    │   └─ Delete old vectors → Re-index new content       │
│    └─ DELETED: Move to archive or delete                  │
│                                                             │
│  Step 5: Rebuild Catalog (if changes)                      │
│    └─ Run build-identity-focused-catalog.js               │
│                                                             │
│  Step 6: Export Catalog CSV                                 │
│    └─ Run export-catalog-csv.js                           │
│                                                             │
│  Step 7: Save Sync Log                                      │
│    └─ Append to logs/sync-log.jsonl                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 PINECONE (Updated)                          │
│                                                             │
│  • New file vectors added                                   │
│  • Modified file vectors updated                            │
│  • Total vectors: ~3,640+                                   │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│          CATALOG FILES (Regenerated)                        │
│                                                             │
│  • document-catalog-identity-focused.json                   │
│  • document-catalog-identity-focused.csv                    │
│  • Upload CSV to Google Sheets (manual or automated)       │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              SYNC LOG (Tracking)                            │
│              logs/sync-log.jsonl                            │
│                                                             │
│  • Timestamp                                                │
│  • Files processed                                          │
│  • Errors encountered                                       │
│  • Statistics                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Components

### 1. Sync Script (`scripts/sync-pinecone-catalog.js`)

**What it does:**
- Scans Google Drive for all files
- Compares with Pinecone index
- Identifies: new, modified, deleted files
- Indexes/re-indexes as needed
- Rebuilds catalog if changes made
- Saves detailed log

**Key Features:**
- **Idempotent:** Safe to run multiple times
- **Incremental:** Only processes changes
- **Logged:** Detailed logs for debugging
- **Error handling:** Continues on error, logs failures
- **Dry-run mode:** Preview changes without applying

### 2. GitHub Actions Workflow (`.github/workflows/daily-sync.yml`)

**What it does:**
- Runs sync script on schedule
- Provides manual trigger button
- Uploads logs as artifacts
- Sends notifications on failure

**Features:**
- **Scheduled:** Daily at 2 AM UTC
- **Manual:** Click "Run workflow" button anytime
- **Secrets:** API keys stored securely
- **Artifacts:** Logs saved for 90 days
- **Notifications:** Email on failure (optional: Slack)

### 3. Monitoring & Logs

**GitHub Actions UI:**
- See all workflow runs
- Check success/failure status
- Download log artifacts
- View execution time

**Sync Log File (`logs/sync-log.jsonl`):**
```json
{
  "timestamp": "2026-01-17T02:00:00Z",
  "stats": {
    "filesInDrive": 115,
    "filesInPinecone": 110,
    "newFiles": ["New Product Deck.pptx"],
    "modifiedFiles": ["DSO Product Description_v2.1_Jul2025_INTERNAL"],
    "deletedFiles": [],
    "indexed": 1,
    "reindexed": 1,
    "errors": []
  }
}
```

---

## Comparison Matrix

| Feature | GitHub Actions | Cloud VM + Cron | Cloud Functions | Airflow | MCP Server |
|---------|---------------|----------------|----------------|---------|------------|
| **Cost** | FREE ✅ | $5-10/mo ❌ | $1-2/mo ⚠️ | $20-50/mo ❌ | N/A |
| **Setup Time** | 2-3 hours ✅ | 4-5 hours ⚠️ | 3-4 hours ⚠️ | 8-10 hours ❌ | 4-5 hours ⚠️ |
| **Maintenance** | None ✅ | High ❌ | Low ⚠️ | High ❌ | Medium ⚠️ |
| **Monitoring** | Built-in ✅ | Manual ❌ | Built-in ✅ | Excellent ✅ | N/A |
| **Scalability** | Good ✅ | Limited ⚠️ | Excellent ✅ | Excellent ✅ | N/A |
| **Learning Curve** | Low ✅ | Medium ⚠️ | Medium ⚠️ | High ❌ | Medium ⚠️ |
| **Automation** | Yes ✅ | Yes ✅ | Yes ✅ | Yes ✅ | No ❌ |
| **Best For** | This use case! | Heavy workloads | GCP users | Complex pipelines | Interactive use |

---

## Recommended Implementation Plan

### Phase 1: Build Sync Script (2 hours)
- ✅ Create `scripts/sync-pinecone-catalog.js`
- ✅ Implement Drive scanning
- ✅ Implement Pinecone comparison
- ✅ Implement indexing logic
- ✅ Add logging

### Phase 2: Test Locally (1 hour)
- ✅ Run sync script manually
- ✅ Verify new files get indexed
- ✅ Verify modified files get re-indexed
- ✅ Check catalog rebuilds correctly
- ✅ Review logs

### Phase 3: Set Up GitHub Actions (30 min)
- ✅ Create `.github/workflows/daily-sync.yml`
- ✅ Add GitHub Secrets (API keys)
- ✅ Configure schedule
- ✅ Test manual trigger

### Phase 4: Monitor & Iterate (ongoing)
- ✅ Check first few automated runs
- ✅ Review logs for errors
- ✅ Adjust schedule if needed
- ✅ Add notifications (Slack, email)

---

## Decision: What Should We Build?

### ✅ Build This:
1. **Sync Script** (`scripts/sync-pinecone-catalog.js`) - Core logic
2. **GitHub Actions Workflow** (`.github/workflows/daily-sync.yml`) - Scheduler
3. **Sync Log** (`logs/sync-log.jsonl`) - Tracking

### ❌ Don't Build This:
1. **MCP Server** - Not needed for automation
2. **Airflow DAG** - Overkill
3. **Cloud VM Setup** - Unnecessary cost/maintenance

---

## Next Steps

**If you approve this plan, I will:**
1. Create the sync script with full logic
2. Create GitHub Actions workflow file
3. Test locally first
4. Help you set up GitHub Secrets
5. Run first sync and monitor results

**Estimated total time:** 3-4 hours (including testing)
**Ongoing cost:** $0 (free GitHub Actions)
**Maintenance:** Minimal (just check logs occasionally)

---

## Questions to Confirm

1. **Do you have a GitHub repo for this project?** (If not, we can create one)
2. **Is GitHub Actions approach acceptable?** (Free, easy, automated)
3. **What should we do with deleted files?**
   - Option A: Keep in Pinecone (move to archive namespace)
   - Option B: Delete from Pinecone (clean up)
   - Option C: Log only, manual review
4. **Preferred sync time?** (Default: 2 AM UTC = 6 PM PST)
5. **Notification preference?**
   - Option A: GitHub email only
   - Option B: Also send to Slack
   - Option C: No notifications unless error

---

## Summary

**Recommended Solution:** GitHub Actions + Node.js Sync Script

**Why:**
- ✅ Free
- ✅ No server maintenance
- ✅ Easy to monitor
- ✅ Version controlled
- ✅ Automated daily runs
- ✅ Can run on-demand
- ✅ Perfect for this use case

**Not Recommended:**
- ❌ MCP Server (not for automation)
- ❌ Airflow (overkill)
- ❌ Cloud VM (unnecessary cost)

**Ready to build?** Let me know if you approve this plan and I'll start implementing!
