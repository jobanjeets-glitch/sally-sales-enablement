# Intelligent Sync System - User Guide

## Overview

The intelligent sync system automatically keeps the Pinecone vector database synchronized with Google Drive, detecting new and modified files and indexing them appropriately.

## Features

- **Smart File Detection**: Identifies NEW and MODIFIED files based on multiple signals
- **Advanced Filtering**:
  - Excludes shortcuts, archived files, and legacy documents
  - Filters individual case studies (keeps master library only)
  - Detects and removes duplicate formats (PDF vs Google Slides)
- **Fuzzy Matching**:
  - Handles file renames and format changes
  - Normalizes version indicators (va, vb, v1, v2)
  - Recognizes document aliases (e.g., "Quarterly Industry Trends" = "State of Retail Ecommerce")
- **Metadata-Driven Comparison**: Uses File.id, version, md5, size, and modified date
- **Automatic Date Cutoff**: Uses the latest `File.lastSyncDate` from Pinecone
  - System automatically finds the most recent sync date
  - Only processes files modified since that date
  - Falls back to 30-day lookback if no sync date exists
  - **No manual date configuration needed!**
- **OCR Support**: Automatically falls back to OCR for scanned PDFs

## Commands

### 1. Dry Run (Recommended First)
```bash
npm run sync-test
```
- Scans Drive and Pinecone
- Shows what would be indexed/updated
- Generates CSV reports in `reports/`
- **Does NOT make any changes**

### 2. Full Sync
```bash
npm run sync-full
```
- Performs actual indexing operations
- Indexes NEW files
- Deletes old vectors for MODIFIED files
- Re-indexes MODIFIED files

### 3. Index Single File
```bash
npm run index-single "File Name"
```
- Manually index a specific file by name

### 4. Add Sync Date Metadata (One-time)
```bash
npm run add-sync-date
```
- Adds `File.lastSyncDate` metadata to all existing vectors
- Uses today's date for all files
- **Only needed once** - future syncs automatically add this metadata
- Safe to run multiple times (skips vectors that already have sync date)

## File Classification

### NEW Files
Files that don't exist in Pinecone at all.

### MODIFIED Files
Files that exist but have changed:
- **Legacy files without File.id**: Need re-indexing to add proper metadata
- **Version changed**: Google Drive version number increased
- **Date changed**: Modified after last sync date
- **Hash changed**: MD5 checksum different
- **Size changed**: File size changed by >100 bytes

### Filtered Files
Files that are automatically excluded:
- Shortcuts (all `application/vnd.google-apps.shortcut`)
- Individual case studies (only master "Case Study Slide Library" is kept)
- Archived files (name contains "archived", "(old)", "deprecated")
- Legacy comparison files (superseded by newer versions)
- Duplicate formats (same content in multiple formats - highest priority kept)

## Filters Applied

1. **Shortcut Exclusion**: All Google Drive shortcuts ignored
2. **Case Study Filter**: Regex `/case\s*study/i` - keeps only master library
3. **Duplicate Detection**:
   - Normalizes names (removes extensions, punctuation, version numbers)
   - Prioritizes: Google Slides > Google Docs > PDF
4. **Fuzzy Name Matching**:
   - Strips version indicators (va, vb, v1, v2)
   - Normalizes aliases ("gen AI" → "generative AI")
   - Removes all year references (202X) for comparison
   - Substring matching for truncated titles (>30 chars)
5. **Automatic Date Cutoff**: Only files modified after the last sync date (automatically detected from `File.lastSyncDate` metadata)

## Generated Reports

After running `npm run sync-test`, check:
- `reports/new-files.csv`: Files to be indexed
- `reports/modified-files.csv`: Files to be re-indexed

CSV columns:
- **NEW files**: Name, Folder, Type, Modified, URL
- **MODIFIED files**: Name, Folder, Type, Drive Modified, Pinecone Modified, Change Signals, Reason, URL

## GitHub Actions (Automated Daily Sync)

The workflow runs automatically every day at 2 AM UTC.

### Setup Required Secrets

In GitHub repository settings, add these secrets:

1. **PINECONE_API_KEY**: Your Pinecone API key
2. **PINECONE_INDEX_NAME**: `knowledge-store-v4-n8n`
3. **OPENAI_API_KEY**: Your OpenAI API key
4. **GOOGLE_DRIVE_FOLDER_ID**: Root folder ID to scan
5. **GOOGLE_CREDENTIALS_JSON**: Full JSON content of Google service account credentials

### Manual Trigger

To run sync manually:
1. Go to **Actions** tab in GitHub
2. Select **Daily Pinecone Sync** workflow
3. Click **Run workflow**
4. Select branch and click **Run workflow**

### View Results

- **Logs**: Available in the Actions run details
- **Artifacts**: Sync log saved for 30 days (download from Actions)

## Troubleshooting

### Issue: "File not found in Pinecone but should exist"
- Check if file was indexed by n8n without File.id metadata
- The file will be detected as MODIFIED and flagged for re-indexing

### Issue: "Too many NEW files showing up"
- Run dry-run first to verify filters are working
- Check if Pinecone has files under different names (format variations)
- Verify date cutoff is set correctly

### Issue: "Duplicate files being indexed"
- Check `detectDuplicates()` function - may need to add new mime type priority
- Verify name normalization is handling special characters

### Issue: "OCR taking too long"
- OCR runs automatically for scanned PDFs
- Consider increasing GitHub Actions timeout if needed
- Check if PDF can be re-exported with selectable text

## Best Practices

1. **Always run dry-run first**: `npm run sync-test`
2. **Review CSV reports** before running full sync
3. **Check GitHub Actions logs** after automated runs
4. **Monitor Pinecone index stats** to ensure vectors are being added correctly
5. **Sync date is automatic** - no manual configuration needed! The system tracks the last sync date automatically

## Architecture

### Key Files

- **scripts/sync-dry-run-detailed.js**: Dry run with CSV generation
- **scripts/sync-pinecone-drive.js**: Full sync with actual indexing
- **.github/workflows/daily-sync.yml**: GitHub Actions workflow
- **INTELLIGENT-INDEXING-PLAN-V2.md**: Detailed technical specification

### Data Flow

```
Google Drive → Scan & Filter → Classify (NEW/MODIFIED/UNCHANGED) → Index/Re-index → Pinecone
                    ↓
            Duplicate Detection
                    ↓
            Fuzzy Name Matching
                    ↓
            Date Cutoff Filter
```

### Metadata Schema

```yaml
File.name: "Document Name"
File.id: "google-drive-id"          # Primary key
File.webviewlink: "https://..."
File.createdDate: "2025-12-11"
File.modifiedDate: "2025-12-11"     # When file was last modified in Drive
File.lastSyncDate: "2026-01-22"     # When file was last synced to Pinecone (NEW!)
File.version: 123                    # Google Drive version
File.md5: "abc123..."                # For change detection
File.size: 12345                     # In bytes
text: "chunk content"
blobType: "application/pdf"
loc.lines.from: 1
loc.lines.to: 12
```

**NEW: `File.lastSyncDate` Metadata**
- Automatically added to all vectors during indexing/re-indexing
- Tracks when the file was last synced to Pinecone
- Used to automatically detect files modified since last sync
- Eliminates need for manual date cutoff configuration

## Future Enhancements

- [ ] Slack notifications for sync results
- [ ] Google Sheets catalog auto-update
- [ ] Incremental sync (only check files modified in last 24h)
- [ ] Parallel indexing for faster processing
- [ ] Retry logic for failed indexing operations
- [ ] Detailed metrics dashboard

## Support

For issues or questions:
1. Check the logs in `sync-output.log`
2. Review the CSV reports in `reports/`
3. Verify environment variables are set correctly
4. Check Pinecone index statistics: `npm run stats`
