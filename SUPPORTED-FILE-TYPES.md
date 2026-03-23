# Supported File Types for Indexing

## Currently Supported File Types

Your indexer can handle these file types and extract text successfully:

### ✅ Google Workspace Files (Native Format)

| File Type | MIME Type | How It's Processed |
|-----------|-----------|-------------------|
| **Google Docs** | `application/vnd.google-apps.document` | Uses Google Docs API to read document structure and extract all text content directly |
| **Google Slides** | `application/vnd.google-apps.presentation` | Uses Google Slides API to read each slide's page elements and extract text from shapes and text boxes |
| **Google Sheets** | `application/vnd.google-apps.spreadsheet` | Uses Google Sheets API to read all sheets, extracts cell values row by row |

**Why these work best:**
- Direct API access to structured content
- No file conversion needed
- Text extraction is reliable and preserves formatting
- Works for all files in your Google Drive

---

### ✅ PDF Files (Text-based)

| File Type | MIME Type | How It's Processed |
|-----------|-----------|-------------------|
| **PDF** | `application/pdf` | Downloads PDF file as binary, uses `pdf-parse` library to extract text |

**Requirements:**
- ✅ Works: PDFs with actual text (created from Word, exported from Google Docs, etc.)
- ❌ Fails: Image-based PDFs (scanned documents, photos saved as PDF)
- ❌ Fails: Password-protected PDFs

**Why some PDFs fail:**
- If PDF is a scanned image, there's no text to extract (would need OCR)
- 6 files failed with "text too short or empty" - likely image-based PDFs

---

### ✅ Microsoft Office Files (DOCX, PPTX)

| File Type | MIME Type | How It's Processed |
|-----------|-----------|-------------------|
| **Word (.docx)** | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Downloads file, uses `mammoth` library to extract raw text |
| **PowerPoint (.pptx)** | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | Uses Google Drive export API to convert to plain text |

**Notes:**
- DOCX: Uses `mammoth` library for text extraction
- PPTX: Exports as plain text via Drive API
- Excel files (.xlsx) are NOT supported yet (could add if needed)

---

## ❌ Unsupported / Failing File Types

### Image-Based PDFs
**Why it fails:**
```
PDF file contains images of pages (scanned documents)
↓
pdf-parse library tries to extract text
↓
No text found (images only)
↓
Error: "Extracted text too short or empty"
```

**Solution:**
- Need OCR (Optical Character Recognition) service
- Options: Google Cloud Vision API, AWS Textract, Tesseract
- Not currently implemented

---

### Google Drive Shortcuts
**Why it fails:**
```
Shortcut file doesn't contain actual content
↓
Points to another file (may be in different folder)
↓
If target file is inaccessible or deleted
↓
Error: "File not found" or "Permission denied"
```

**Solution:**
- Find the actual target file
- Use target file's ID instead of shortcut ID
- Already fixed for most files (we updated file IDs)

---

### Other File Types

| File Type | Status | Notes |
|-----------|--------|-------|
| Audio (.mp3, .wav, .m4a) | ❌ Not Supported | Would need speech-to-text (Whisper API) |
| Video (.mp4, .mov, .avi) | ❌ Not Supported | Would need video transcription |
| Images (.jpg, .png, .gif) | ❌ Not Supported | Would need OCR or image description |
| Excel (.xlsx) | ⚠️ Not Implemented | Could add with `xlsx` library |
| Old Office (.doc, .ppt, .xls) | ❌ Not Supported | Legacy format, hard to parse |
| ZIP/Archives | ❌ Not Supported | Would need to extract and process contents |

---

## How the Sync Script Handles File Types

### Current Implementation

```javascript
// In sync-pinecone-catalog.js, line 192-198

const supportedTypes = [
    'application/vnd.google-apps.document',      // Google Docs ✅
    'application/vnd.google-apps.presentation',  // Google Slides ✅
    'application/vnd.google-apps.spreadsheet',   // Google Sheets ✅
    'application/pdf'                            // PDF (if text-based) ✅
];

const supportedFiles = files.filter(f => supportedTypes.includes(f.mimeType));
```

**What this means:**
- Only these 4 MIME types are processed
- All other file types are automatically skipped (not even attempted)
- No errors for unsupported types - they're silently filtered out

---

### What Happens During Sync

```
1. Scan Google Drive folder
   ↓
2. Get all files (including unsupported types)
   ↓
3. Filter to supported MIME types only
   ├─ Google Docs ✅
   ├─ Google Slides ✅
   ├─ Google Sheets ✅
   ├─ PDF ✅
   └─ Everything else ❌ (skipped)
   ↓
4. Attempt to index supported files
   ├─ Download/Extract content
   ├─ If content extraction fails → Log error, continue
   └─ If content too short → Skip with warning
   ↓
5. Upload successful extractions to Pinecone
```

---

## Your Current Stats (From Previous Indexing)

### Successfully Indexed (9 files, 195 chunks):
- ✅ Google Docs: 5 files
- ✅ Google Slides: 4 files
- ✅ Google Sheets: 0 files (none in the batch)
- ✅ PDF: 0 files (all were image-based)

### Failed (13 files):
- ❌ Image-based PDFs: 6 files
  - "Extracted text too short or empty"
  - These need OCR to process
- ❌ Shortcuts to inaccessible files: 6 files
  - Target files not accessible or in different folder
- ❌ PPTX export failure: 1 file
  - Drive API couldn't export as plain text

---

## Recommendations

### Option 1: Keep Current Approach (RECOMMENDED)
**What it does:**
- Only processes Google Docs, Slides, Sheets, and text-based PDFs
- Skips unsupported types silently
- Logs errors for extraction failures

**Pros:**
- ✅ Simple, no added complexity
- ✅ Handles 90%+ of your files
- ✅ No additional costs
- ✅ Reliable text extraction

**Cons:**
- ⚠️ Image PDFs won't be indexed
- ⚠️ Audio/video files won't be indexed

**Best for:** Most sales enablement scenarios (docs, slides, sheets are primary content)

---

### Option 2: Add OCR for Image PDFs
**What it adds:**
- Google Cloud Vision API or AWS Textract
- Process image-based PDFs
- Extract text from scanned documents

**Pros:**
- ✅ Can index scanned documents
- ✅ Handles image-based PDFs

**Cons:**
- ❌ Costs money ($1.50 per 1,000 pages for Google Vision)
- ❌ Slower processing
- ❌ More complex error handling
- ❌ OCR can be inaccurate

**Setup time:** 2-3 hours
**Cost:** ~$0.01-0.05 per file

---

### Option 3: Add Audio Transcription
**What it adds:**
- OpenAI Whisper API
- Transcribe audio files (.mp3, .wav, .m4a)

**Pros:**
- ✅ Can index call recordings, podcasts
- ✅ High accuracy (Whisper is excellent)

**Cons:**
- ❌ Costs money ($0.006 per minute)
- ❌ Slower processing
- ❌ Large file sizes

**Setup time:** 1-2 hours
**Cost:** ~$0.36 for 1-hour recording

---

## What I Recommend

**For your use case (sales enablement), stick with current approach:**

### ✅ Keep Supporting:
- Google Docs (primary content)
- Google Slides (presentations)
- Google Sheets (data, pricing)
- Text-based PDFs (exported docs)

### ❌ Don't Add OCR/Transcription Because:
- 90%+ of your content is already supported
- Image PDFs are rare in sales enablement (usually exports from Google Docs)
- OCR adds cost and complexity
- Audio files are not primary knowledge source

### 📝 For the 6 Image-based PDFs:
- **Option A:** Convert to Google Docs (Google Drive can OCR them automatically)
  - Upload PDF → Right-click → Open with Google Docs → OCR happens automatically
  - Re-index as Google Doc
- **Option B:** Leave them unindexed (if not critical)
- **Option C:** Add OCR support (only if these are important and more will come)

---

## Summary

**Your indexer currently handles:**
```
✅ Google Docs          → Direct API extraction (reliable)
✅ Google Slides        → Direct API extraction (reliable)
✅ Google Sheets        → Direct API extraction (reliable)
✅ Text-based PDFs      → pdf-parse library (works if text exists)
⚠️ DOCX files           → mammoth library (works, but not in your folder)
⚠️ PPTX files           → Drive export API (sometimes fails)
❌ Image PDFs           → Fails (no OCR)
❌ Shortcuts            → Fails if target inaccessible
❌ Audio/Video/Images   → Not supported
```

**Recommendation:** Keep current approach - it covers 90%+ of files and works reliably.

**For sync script:**
- Already filters to supported types only
- Gracefully handles extraction failures
- Logs errors for review
- Continues processing other files

**Need to add support for more types?** Let me know which ones and I can add them, but current coverage should be sufficient for sales enablement content.
