# Intelligent Indexing System - Professional Implementation Plan

## Executive Summary
Production-ready automated indexing system that handles real-world complexities: duplicate file formats, archived content, mime-type specific processing, and accurate change tracking across Google Drive and Pinecone.

---

## 1. METADATA SCHEMA & COMPARISON STRATEGY

### 1.1 Google Drive Metadata to Scrape
```javascript
const driveFileMetadata = {
  // Identity
  id: string,                    // Unique, immutable (PRIMARY KEY)
  name: string,                  // Can change, use for duplicate detection
  mimeType: string,              // Critical for processing logic

  // Change tracking
  modifiedTime: ISO8601,         // For detecting modifications
  createdTime: ISO8601,          // For audit trail
  md5Checksum: string,           // For content-based comparison (when available)
  size: number,                  // For validation
  version: number,               // Google Drive version number

  // Organization
  parents: [string],             // Parent folder IDs
  webViewLink: string,           // For citations

  // Computed fields
  path: string,                  // Computed: folder path from root
  subfolder: string,             // Immediate parent folder name
  isArchived: boolean            // Computed: name contains "archived"
}
```

### 1.2 Pinecone Metadata Stored
```javascript
const pineconeMetadata = {
  // Identity (from Drive)
  'File.id': string,             // PRIMARY KEY for lookups
  'File.name': string,
  'File.mimeType': string,       // Store for debugging

  // Change tracking
  'File.modifiedDate': 'YYYY-MM-DD',
  'File.createdDate': 'YYYY-MM-DD',
  'File.version': number,        // Google Drive version
  'File.md5': string,            // For content verification
  'File.size': number,

  // Organization
  'File.webviewlink': string,
  'File.subfolder': string,      // NEW: track which subfolder
  'File.path': string,           // NEW: full path

  // Content metadata
  'text': string,                // Chunk text
  'blobType': string,            // Mime type
  'loc.lines.from': number,
  'loc.lines.to': number,

  // Processing metadata
  'indexed.timestamp': ISO8601,  // When indexed
  'indexed.method': string       // 'direct' | 'ocr' | 'api'
}
```

### 1.3 Comparison Logic

```javascript
// STEP 1: Build file identity map
const fileIdentity = {
  primaryKey: fileId,
  secondaryKey: `${sanitizedName}_${mimeType}`,
  contentHash: md5Checksum || null
}

// STEP 2: Detect duplicates (same content, different format)
// Example: "Industry Report.pptx" vs "Industry Report.pdf"
const isDuplicate = (file1, file2) => {
  const name1 = file1.name.replace(/\.(pdf|pptx|ppt)$/i, '').toLowerCase().trim()
  const name2 = file2.name.replace(/\.(pdf|pptx|ppt)$/i, '').toLowerCase().trim()

  return name1 === name2 &&
         ['pdf', 'ppt', 'pptx'].includes(getExtension(file1)) &&
         ['pdf', 'ppt', 'pptx'].includes(getExtension(file2))
}

// STEP 3: Determine which format to index (preference order)
const formatPriority = {
  'application/vnd.google-apps.presentation': 1,  // Google Slides (best)
  'application/pdf': 2,                           // PDF (good)
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 3  // PPTX (needs conversion)
}

// STEP 4: Change detection
const hasChanged = (driveFile, pineconeMetadata) => {
  // Primary: Version number
  if (driveFile.version > pineconeMetadata['File.version']) return true

  // Secondary: Modified date
  const driveDate = new Date(driveFile.modifiedTime)
  const pineconeDate = new Date(pineconeMetadata['File.modifiedDate'])
  if (driveDate > pineconeDate) return true

  // Tertiary: Content hash (if available)
  if (driveFile.md5Checksum &&
      driveFile.md5Checksum !== pineconeMetadata['File.md5']) return true

  return false
}
```

---

## 2. FILE TYPE BUCKETING & PROCESSING RULES

### 2.1 Mime Type Categories

```yaml
Google Native (Indexable):
  application/vnd.google-apps.document:
    priority: high
    method: Google Docs API
    speed: fast
    reliability: 99%

  application/vnd.google-apps.presentation:
    priority: high
    method: Google Slides API
    speed: fast
    reliability: 99%

  application/vnd.google-apps.spreadsheet:
    priority: medium
    method: Google Sheets API
    speed: medium
    reliability: 95%
    notes: "Large sheets may timeout"

PDF Files (Indexable with Conditions):
  application/pdf:
    priority: high
    method: pdf-parse → OCR fallback
    speed: slow (with OCR)
    reliability: 85%
    notes: "Text-based: fast, Image-based: OCR required"
    conditions:
      - Skip if Google Slides version exists
      - Skip if PPTX version exists and is newer

Uploaded Office Files (Needs Conversion):
  application/vnd.openxmlformats-officedocument.presentationml.presentation:
    priority: low
    method: Skip (prefer PDF or Slides version)
    notes: "Requires conversion, skip if duplicate exists"

  application/vnd.openxmlformats-officedocument.wordprocessingml.document:
    priority: low
    method: Skip (prefer Google Doc version)

  application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
    priority: low
    method: Skip (prefer Google Sheets version)

Shortcuts (Resolve First):
  application/vnd.google-apps.shortcut:
    priority: n/a
    method: Resolve to target file
    notes: "Get shortcutDetails.targetId and process target"

Ignored Types:
  audio/wav:
    reason: "Not text-based"
  video/mp4:
    reason: "Not text-based"
  image/png:
    reason: "Use OCR only if document scan"
  application/vnd.google-apps.folder:
    reason: "Not a file"
```

### 2.2 Processing Strategy by Category

```javascript
const processingStrategy = {
  'google-native': {
    index: true,
    method: 'api',
    priority: 1
  },

  'pdf-text-based': {
    index: true,
    method: 'pdf-parse',
    priority: 2,
    skipIfExists: ['google-slides', 'google-doc']
  },

  'pdf-image-based': {
    index: true,
    method: 'ocr',
    priority: 3,
    skipIfExists: ['google-slides', 'google-doc', 'pdf-text-based']
  },

  'uploaded-office': {
    index: false,  // Skip unless no alternative
    method: 'skip',
    priority: 99,
    skipIfExists: ['google-native', 'pdf']
  },

  'shortcuts': {
    index: false,
    method: 'resolve',
    action: 'resolve to target and reprocess'
  },

  'media-files': {
    index: false,
    method: 'skip',
    reason: 'not text-based'
  }
}
```

---

## 3. DUPLICATE DETECTION & HANDLING

### 3.1 Duplicate Detection Rules

```javascript
class DuplicateDetector {
  constructor() {
    this.seenContent = new Map() // name_normalized -> [files]
  }

  /**
   * Normalize file name for duplicate detection
   * "Industry Report - Q4.pdf" → "industry report q4"
   * "Industry Report - Q4.pptx" → "industry report q4"
   */
  normalizeName(fileName) {
    return fileName
      .replace(/\.(pdf|pptx?|docx?|xlsx?)$/i, '')  // Remove extension
      .replace(/[_\-\s]+/g, ' ')                     // Normalize separators
      .replace(/\(copy\s*\d*\)/gi, '')              // Remove "(Copy)" markers
      .replace(/\s+version\s+\d+/gi, '')             // Remove version numbers
      .toLowerCase()
      .trim()
  }

  /**
   * Check if two files are duplicates
   */
  areDuplicates(file1, file2) {
    const name1 = this.normalizeName(file1.name)
    const name2 = this.normalizeName(file2.name)

    if (name1 !== name2) return false

    // Same name, different formats = duplicate
    const formats = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'slides', 'document']
    const ext1 = this.getFormat(file1)
    const ext2 = this.getFormat(file2)

    return formats.includes(ext1) && formats.includes(ext2) && ext1 !== ext2
  }

  /**
   * Select which duplicate to index (priority order)
   */
  selectPreferredFormat(duplicates) {
    const priority = [
      'application/vnd.google-apps.presentation',  // Google Slides
      'application/vnd.google-apps.document',       // Google Docs
      'application/pdf',                            // PDF
      'application/vnd.google-apps.spreadsheet',    // Google Sheets
      // Uploaded office files last
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]

    return duplicates.sort((a, b) => {
      const priorityA = priority.indexOf(a.mimeType)
      const priorityB = priority.indexOf(b.mimeType)

      // If same priority, prefer newer modified date
      if (priorityA === priorityB) {
        return new Date(b.modifiedTime) - new Date(a.modifiedTime)
      }

      return priorityA - priorityB
    })[0]
  }

  /**
   * Group files by content and select winners
   */
  deduplicateFiles(files) {
    const groups = new Map()

    // Group by normalized name
    for (const file of files) {
      const key = this.normalizeName(file.name)
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key).push(file)
    }

    // Select one file per group
    const winners = []
    const skipped = []

    for (const [key, group] of groups) {
      if (group.length === 1) {
        winners.push(group[0])
      } else {
        const winner = this.selectPreferredFormat(group)
        winners.push(winner)

        for (const file of group) {
          if (file.id !== winner.id) {
            skipped.push({
              file,
              reason: `Duplicate of ${winner.name} (${winner.mimeType})`,
              preferred: winner.id
            })
          }
        }
      }
    }

    return { winners, skipped }
  }
}
```

### 3.2 Duplicate Handling Examples

```yaml
Example 1 - Industry Report:
  Files Found:
    - "Industry Report Q4.pdf" (PDF)
    - "Industry Report Q4.pptx" (PowerPoint)
    - "Industry Report Q4" (Google Slides)

  Decision: Index only Google Slides version
  Reason: Google Slides has highest priority, same content

Example 2 - Product Datasheet:
  Files Found:
    - "RMM Datasheet July 25.pdf" (PDF, image-based)
    - "RMM Datasheet July 25" (Google Doc version)

  Decision: Index only Google Doc version
  Reason: Google Doc is faster, more reliable than OCR

Example 3 - No Duplicates:
  Files Found:
    - "RMM Datasheet July 25.pdf" (PDF)
    - "DSO Datasheet July 25.pdf" (PDF)

  Decision: Index both
  Reason: Different content (different products)
```

---

## 4. FILTERING RULES

### 4.1 Name-Based Filters

```javascript
const shouldSkipFile = (file) => {
  const nameFilters = [
    /archived/i,           // "Archived 2024", "Old - Archived"
    /\(old\)/i,            // "(Old)", "(old version)"
    /deprecated/i,         // "Deprecated - Use new version"
    /\~\$/,                // "~$Document.docx" (temp files)
    /^~\$/,                // Excel temp files
    /^Copy of/i,           // "Copy of Document"
    /\(copy\s*\d*\)/i      // "(Copy)", "(Copy 2)"
  ]

  return nameFilters.some(pattern => pattern.test(file.name))
}

const shouldSkipFolder = (folderName) => {
  const folderFilters = [
    /archived/i,
    /old/i,
    /backup/i,
    /trash/i,
    /temp/i,
    /draft/i  // Optional: skip drafts folder
  ]

  return folderFilters.some(pattern => pattern.test(folderName))
}
```

### 4.2 Mime Type Filters

```javascript
const indexableMimeTypes = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.spreadsheet',
  'application/pdf'
])

const shouldIndexMimeType = (mimeType) => {
  return indexableMimeTypes.has(mimeType)
}

// Special handling for shortcuts
const isShortcut = (mimeType) => {
  return mimeType === 'application/vnd.google-apps.shortcut'
}
```

---

## 5. CHANGE DETECTION STRATEGY

### 5.1 File State Classification

```javascript
const classifyFileState = (driveFile, pineconeData) => {
  // NEW: File ID not in Pinecone
  if (!pineconeData) {
    return {
      state: 'NEW',
      action: 'INDEX',
      reason: 'File not found in Pinecone'
    }
  }

  // DELETED: File ID in Pinecone but not in Drive (handled separately)

  // MODIFIED: Check multiple signals
  const signals = {
    versionChanged: driveFile.version > pineconeData['File.version'],
    dateChanged: new Date(driveFile.modifiedTime) > new Date(pineconeData['File.modifiedDate']),
    hashChanged: driveFile.md5Checksum && driveFile.md5Checksum !== pineconeData['File.md5'],
    nameChanged: driveFile.name !== pineconeData['File.name'],
    sizeChanged: Math.abs(driveFile.size - pineconeData['File.size']) > 100  // Allow 100 byte diff
  }

  if (signals.versionChanged || signals.hashChanged) {
    return {
      state: 'MODIFIED',
      action: 'REINDEX',
      reason: 'Content changed',
      signals
    }
  }

  if (signals.dateChanged) {
    return {
      state: 'MODIFIED',
      action: 'REINDEX',
      reason: 'Modified date changed',
      signals
    }
  }

  if (signals.nameChanged) {
    return {
      state: 'RENAMED',
      action: 'UPDATE_METADATA',
      reason: 'Name changed but content same',
      signals
    }
  }

  return {
    state: 'UNCHANGED',
    action: 'SKIP',
    reason: 'No changes detected',
    signals
  }
}
```

### 5.2 Action Strategy by State

```javascript
const executeAction = async (file, classification) => {
  switch (classification.action) {
    case 'INDEX':
      // Full indexing pipeline
      await extractText(file)
      await chunkText(text)
      await createEmbeddings(chunks)
      await upsertToPinecone(vectors)
      break

    case 'REINDEX':
      // Delete old vectors first
      await deleteVectorsByFileId(file.id)
      // Then full index
      await extractText(file)
      await chunkText(text)
      await createEmbeddings(chunks)
      await upsertToPinecone(vectors)
      break

    case 'UPDATE_METADATA':
      // Update metadata only, no re-embedding
      await updatePineconeMetadata(file.id, {
        'File.name': file.name,
        'File.modifiedDate': file.modifiedTime.split('T')[0]
      })
      break

    case 'SKIP':
      // No action needed
      break
  }
}
```

---

## 6. SUBFOLDER TRACKING & REPORTING

### 6.1 Folder Structure Scanning

```javascript
class FolderTracker {
  constructor() {
    this.folderStats = new Map()  // folderId -> stats
    this.folderPaths = new Map()  // folderId -> path
  }

  /**
   * Build folder hierarchy and paths
   */
  async buildFolderTree(rootFolderId, drive) {
    const folders = await this.getAllFolders(rootFolderId, drive)

    // Build path for each folder
    for (const folder of folders) {
      const path = await this.buildPath(folder, folders)
      this.folderPaths.set(folder.id, path)
      this.folderStats.set(folder.id, {
        id: folder.id,
        name: folder.name,
        path: path,
        files: {
          total: 0,
          indexed: 0,
          skipped: 0,
          failed: 0
        }
      })
    }
  }

  /**
   * Track file processing by folder
   */
  recordFile(file, result) {
    const folderId = file.parents?.[0]
    if (!folderId) return

    const stats = this.folderStats.get(folderId)
    if (!stats) return

    stats.files.total++

    if (result.status === 'indexed') stats.files.indexed++
    else if (result.status === 'skipped') stats.files.skipped++
    else if (result.status === 'failed') stats.files.failed++
  }

  /**
   * Generate report by folder
   */
  generateReport() {
    const report = []

    for (const [folderId, stats] of this.folderStats) {
      report.push({
        folder: stats.name,
        path: stats.path,
        total: stats.files.total,
        indexed: stats.files.indexed,
        skipped: stats.files.skipped,
        failed: stats.files.failed,
        coverage: stats.files.total > 0
          ? (stats.files.indexed / stats.files.total * 100).toFixed(1) + '%'
          : '0%'
      })
    }

    // Sort by path
    return report.sort((a, b) => a.path.localeCompare(b.path))
  }
}
```

### 6.2 Report Format

```yaml
Sync Report - 2026-01-21 10:00:00

Overall Summary:
  Total Files Scanned: 164
  Files Indexed: 89
  Files Skipped: 71
  Files Failed: 4
  Duration: 8m 23s

By Folder:
  /GTM Enablement/Product Datasheets:
    Total: 23
    Indexed: 18
    Skipped: 5 (4 archived, 1 duplicate PDF)
    Failed: 0
    Coverage: 78.3%

  /GTM Enablement/Competitive Battle Cards:
    Total: 45
    Indexed: 32
    Skipped: 12 (10 archived, 2 duplicates)
    Failed: 1 (OCR timeout)
    Coverage: 71.1%

  /GTM Enablement/Training Materials:
    Total: 67
    Indexed: 39
    Skipped: 27 (15 archived, 8 duplicates, 4 unsupported)
    Failed: 1 (API error)
    Coverage: 58.2%

  /GTM Enablement/Case Studies:
    Total: 29
    Indexed: 0
    Skipped: 29 (all archived)
    Failed: 0
    Coverage: 0%

By Mime Type:
  application/vnd.google-apps.document: 45 indexed
  application/vnd.google-apps.presentation: 28 indexed
  application/vnd.google-apps.spreadsheet: 8 indexed
  application/pdf: 8 indexed (3 OCR, 5 direct)

Skipped Files Breakdown:
  Archived (name filter): 29
  Duplicates (format): 15
  Unsupported type: 4
  Already up-to-date: 23

Failed Files:
  - "Old Industry Report.pdf" (Reason: OCR timeout)
  - "Large Spreadsheet.gsheet" (Reason: API timeout)

Actions Taken:
  New files indexed: 12
  Modified files re-indexed: 77
  Deleted file vectors removed: 3
  Metadata-only updates: 5
```

---

## 7. PRODUCTION-READY SYNC ALGORITHM

### 7.1 Main Sync Flow

```javascript
async function intelligentSync(options = {}) {
  const {
    dryRun = false,
    rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID
  } = options

  // PHASE 1: DISCOVERY
  console.log('Phase 1: Discovery')
  const folderTracker = new FolderTracker()
  await folderTracker.buildFolderTree(rootFolderId, drive)

  const allDriveFiles = await scanGoogleDrive(rootFolderId)
  console.log(`Found ${allDriveFiles.length} files in Google Drive`)

  // PHASE 2: FILTERING
  console.log('Phase 2: Filtering')
  const filteredFiles = allDriveFiles.filter(file => {
    // Skip archived
    if (shouldSkipFile(file)) {
      folderTracker.recordFile(file, { status: 'skipped', reason: 'archived' })
      return false
    }

    // Skip unsupported mime types
    if (!shouldIndexMimeType(file.mimeType) && !isShortcut(file.mimeType)) {
      folderTracker.recordFile(file, { status: 'skipped', reason: 'unsupported' })
      return false
    }

    return true
  })
  console.log(`After filtering: ${filteredFiles.length} files`)

  // PHASE 3: DUPLICATE DETECTION
  console.log('Phase 3: Duplicate Detection')
  const duplicateDetector = new DuplicateDetector()
  const { winners, skipped } = duplicateDetector.deduplicateFiles(filteredFiles)

  for (const skip of skipped) {
    folderTracker.recordFile(skip.file, { status: 'skipped', reason: 'duplicate' })
  }
  console.log(`After deduplication: ${winners.length} unique files`)
  console.log(`Skipped ${skipped.length} duplicates`)

  // PHASE 4: RESOLVE SHORTCUTS
  console.log('Phase 4: Resolve Shortcuts')
  const resolvedFiles = await resolveShortcuts(winners, drive)

  // PHASE 5: LOAD PINECONE STATE
  console.log('Phase 5: Load Pinecone State')
  const pineconeFiles = await getAllPineconeFiles(index)
  console.log(`Found ${pineconeFiles.size} files in Pinecone`)

  // PHASE 6: CLASSIFY CHANGES
  console.log('Phase 6: Classify Changes')
  const classifications = []

  for (const file of resolvedFiles) {
    const pineconeData = pineconeFiles.get(file.id)
    const classification = classifyFileState(file, pineconeData)
    classifications.push({ file, classification })
  }

  // Find deleted files (in Pinecone but not in Drive)
  const driveFileIds = new Set(resolvedFiles.map(f => f.id))
  for (const [fileId, metadata] of pineconeFiles) {
    if (!driveFileIds.has(fileId)) {
      classifications.push({
        file: { id: fileId, name: metadata['File.name'] },
        classification: { state: 'DELETED', action: 'DELETE_VECTORS' }
      })
    }
  }

  // Group by action
  const byAction = {
    INDEX: classifications.filter(c => c.classification.action === 'INDEX'),
    REINDEX: classifications.filter(c => c.classification.action === 'REINDEX'),
    UPDATE_METADATA: classifications.filter(c => c.classification.action === 'UPDATE_METADATA'),
    DELETE_VECTORS: classifications.filter(c => c.classification.action === 'DELETE_VECTORS'),
    SKIP: classifications.filter(c => c.classification.action === 'SKIP')
  }

  console.log('\nClassification Summary:')
  console.log(`  New files to index: ${byAction.INDEX.length}`)
  console.log(`  Modified files to re-index: ${byAction.REINDEX.length}`)
  console.log(`  Files with metadata updates: ${byAction.UPDATE_METADATA.length}`)
  console.log(`  Deleted files to remove: ${byAction.DELETE_VECTORS.length}`)
  console.log(`  Unchanged files: ${byAction.SKIP.length}`)

  if (dryRun) {
    console.log('\nDRY RUN - No changes will be made')
    return generateDryRunReport(byAction, folderTracker)
  }

  // PHASE 7: EXECUTE ACTIONS
  console.log('\nPhase 7: Execute Actions')
  const results = {
    indexed: [],
    failed: [],
    deleted: []
  }

  // Process new files
  for (const { file, classification } of byAction.INDEX) {
    try {
      await executeAction(file, classification)
      results.indexed.push(file)
      folderTracker.recordFile(file, { status: 'indexed' })
    } catch (error) {
      results.failed.push({ file, error: error.message })
      folderTracker.recordFile(file, { status: 'failed' })
    }
  }

  // Process modified files
  for (const { file, classification } of byAction.REINDEX) {
    try {
      await executeAction(file, classification)
      results.indexed.push(file)
      folderTracker.recordFile(file, { status: 'indexed' })
    } catch (error) {
      results.failed.push({ file, error: error.message })
      folderTracker.recordFile(file, { status: 'failed' })
    }
  }

  // Process metadata updates
  for (const { file, classification } of byAction.UPDATE_METADATA) {
    try {
      await executeAction(file, classification)
      folderTracker.recordFile(file, { status: 'indexed' })
    } catch (error) {
      results.failed.push({ file, error: error.message })
      folderTracker.recordFile(file, { status: 'failed' })
    }
  }

  // Process deletions
  for (const { file, classification } of byAction.DELETE_VECTORS) {
    try {
      await deleteVectorsByFileId(file.id)
      results.deleted.push(file)
    } catch (error) {
      results.failed.push({ file, error: error.message })
    }
  }

  // PHASE 8: GENERATE REPORT
  console.log('\nPhase 8: Generate Report')
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      filesScanned: allDriveFiles.length,
      filesIndexed: results.indexed.length,
      filesDeleted: results.deleted.length,
      filesFailed: results.failed.length
    },
    byFolder: folderTracker.generateReport(),
    byAction,
    results
  }

  // Save report
  await fs.writeFile(
    `./reports/sync-${new Date().toISOString().split('T')[0]}.json`,
    JSON.stringify(report, null, 2)
  )

  return report
}
```

---

## 8. IMPLEMENTATION CHECKLIST

### Phase 1: Core Improvements (Week 1)
- [ ] Add comprehensive metadata scraping (version, md5, parents, size)
- [ ] Implement mime type bucketing and processing rules
- [ ] Build duplicate detection logic
- [ ] Add "archived" file filtering
- [ ] Implement subfolder tracking
- [ ] Create detailed reporting system

### Phase 2: Testing & Validation (Week 2)
- [ ] Test with duplicate files (PDF + PPT of same content)
- [ ] Test with archived files (should be skipped)
- [ ] Test with shortcuts (should be resolved)
- [ ] Verify subfolder counts are accurate
- [ ] Test change detection with version numbers
- [ ] Run dry-run on full folder

### Phase 3: Production Deploy (Week 3)
- [ ] Run full sync (not dry-run)
- [ ] Validate indexed files in Pinecone
- [ ] Verify no duplicates indexed
- [ ] Confirm archived files skipped
- [ ] Review folder-by-folder report
- [ ] Test RAG queries on newly indexed files

### Phase 4: Automation (Week 4)
- [ ] Create GitHub Actions workflow
- [ ] Set up daily scheduled run
- [ ] Configure notifications
- [ ] Monitor first automated runs

---

## 9. KEY DIFFERENCES FROM V1

| Aspect | V1 (Amateur) | V2 (Professional) |
|--------|-------------|-------------------|
| **Metadata** | Only file ID + modifiedDate | ID, version, md5, size, path, subfolder |
| **Duplicates** | Would index both PDF + PPT | Detects and skips duplicates |
| **Archived** | Would index archived files | Filters out archived files |
| **Mime Types** | Basic support only | Full bucketing with priority |
| **Shortcuts** | Would fail | Resolves to target file |
| **Reporting** | Basic counts | Per-folder breakdown with coverage |
| **Change Detection** | Date only | Version + Date + Hash multi-signal |
| **Modified Files** | Delete + Re-index all | Smart: metadata-only for renames |

---

## 10. SUCCESS CRITERIA

### Correctness
- ✅ No duplicate files indexed (same content, different format)
- ✅ All archived files skipped
- ✅ Shortcuts resolved correctly
- ✅ Change detection catches all modifications
- ✅ Unchanged files not reprocessed

### Completeness
- ✅ All indexable files discovered
- ✅ All subfolders tracked
- ✅ All mime types handled
- ✅ Failed files logged with reason

### Performance
- ✅ Sync completes in <15 minutes for 164 files
- ✅ Duplicate detection in <5 seconds
- ✅ Change detection in <10 seconds

### Reporting
- ✅ Per-folder file counts
- ✅ Coverage percentages
- ✅ Skip reasons breakdown
- ✅ Failed files with errors
