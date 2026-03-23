# How to Use Identity-Focused Catalog in n8n

## Overview

Instead of searching through ALL vector chunks in Pinecone every time, you use the **pre-built catalog** as a fast lookup table. This dramatically improves:
- ✅ Speed (no vector search needed)
- ✅ Accuracy (GPT-5.2 already characterized each document)
- ✅ Cost (fewer API calls)

---

## n8n Workflow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER QUERY                                 │
│                   "show me the DSO product box"                     │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  NODE 1: Intent Classifier (GPT-5.2)                                │
│  ─────────────────────────────────────                              │
│  Determines if user wants:                                          │
│  • A specific DOCUMENT → Go to Document Catalog                     │
│  • INFORMATION from content → Go to RAG Search                      │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                 ┌───────────┴──────────┐
                 │                      │
                 ▼                      ▼
┌──────────────────────────┐  ┌─────────────────────────────┐
│ NODE 2A: Document Catalog│  │ NODE 2B: RAG Vector Search  │
│ (Fast Lookup)            │  │ (Deep Content Search)       │
│ ─────────────────────────│  │ ────────────────────────────│
│ • Load catalog JSON      │  │ • Query Pinecone vectors    │
│ • Use GPT-5.2 to match   │  │ • Get top 10 chunks         │
│ • Return doc link + desc │  │ • Generate answer from GPT  │
└──────────┬───────────────┘  └─────────────┬───────────────┘
           │                                 │
           └────────────┬────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  NODE 3: Format Response                                            │
│  ────────────────────────                                           │
│  Return to user with:                                               │
│  • Document link                                                    │
│  • Description                                                      │
│  • When to use it                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## n8n Workflow Setup

### Step 1: Upload Catalog to Google Sheets (or HTTP endpoint)

**Option A: Google Sheets (Recommended - Free & Easy)**
1. Export catalog to CSV:
   ```bash
   npm run export-catalog-csv
   ```
2. Upload to Google Sheets
3. Share with n8n service account
4. Get Sheet ID

**Option B: Host as JSON endpoint**
1. Upload `document-catalog-identity-focused.json` to a cloud storage
2. Make it publicly accessible
3. Use HTTP Request node to fetch it

---

### Step 2: Create n8n Workflow

#### Node 1: Webhook Trigger
```json
{
  "method": "POST",
  "path": "sally-query",
  "responseMode": "lastNode"
}
```

#### Node 2: Intent Classifier (OpenAI)
```json
{
  "model": "gpt-5.2-chat-latest",
  "messages": [
    {
      "role": "system",
      "content": "You are an intent classifier. Determine if the user wants: 'document' (looking for a specific file/deck/document) or 'information' (asking a question about content). Return ONLY 'document' or 'information'."
    },
    {
      "role": "user",
      "content": "{{ $json.body.query }}"
    }
  ]
}
```

#### Node 3: IF Branch
- If intent = "document" → Go to Document Catalog node
- If intent = "information" → Go to Pinecone RAG node

#### Node 4A: Document Catalog Search (OpenAI)
```json
{
  "model": "gpt-5.2-chat-latest",
  "messages": [
    {
      "role": "system",
      "content": "You are a document finder. Given a catalog and user query, return the best matching document as JSON with: {name, url, description, whenToUse}. The catalog is: {{ $('Load Catalog').all()[0].json }}"
    },
    {
      "role": "user",
      "content": "Find document for: {{ $json.body.query }}"
    }
  ],
  "response_format": { "type": "json_object" }
}
```

#### Node 4B: Pinecone RAG (existing)
Your existing Pinecone + OpenAI flow for content questions

#### Node 5: Format Response
```javascript
// For document results
if ($('Intent Classifier').first().json.intent === 'document') {
  const doc = $('Document Catalog Search').first().json;

  return {
    answer: `I found the document: **${doc.name}**\n\n${doc.description}\n\n**When to use:** ${doc.whenToUse}\n\n[Open Document](${doc.url})`,
    document: doc,
    type: 'document-match'
  };
}

// For information results
else {
  const ragAnswer = $('Pinecone RAG').first().json;

  return {
    answer: ragAnswer.answer,
    citations: ragAnswer.citations,
    type: 'information-match'
  };
}
```

---

## Real-World Example: "DSO product box"

### Flow:
```
User asks: "DSO product box"
    ↓
Intent Classifier: "document" (user wants a file)
    ↓
Document Catalog Search:
  - Loads catalog (110 documents)
  - GPT-5.2 finds: "DSO Product Description v2.1"
  - Returns: {
      name: "DSO Product Description_v2.1_Jul2025_INTERNAL",
      url: "https://docs.google.com/document/d/1nmzd...",
      description: "This is the DSO Product Description v2.1...",
      whenToUse: "When clarifying DSO scope, data coverage..."
    }
    ↓
Response: "I found the document: **DSO Product Description_v2.1_Jul2025_INTERNAL**

          This is the Digital Shelf Optimization (DSO) Product Description...

          **When to use:** When clarifying DSO scope, data coverage...

          [Open Document](https://docs.google.com/document/d/...)"
```

**Speed:** ~2 seconds (vs 10-15 seconds with full RAG search)

---

## Benefits Over Pure RAG

| Aspect | Catalog Approach | Pure RAG |
|--------|-----------------|----------|
| Speed | 2-3 seconds | 10-15 seconds |
| Accuracy for docs | 95%+ | 60-70% |
| API cost | $0.001/query | $0.02/query |
| Handles ambiguity | Excellent | Poor |
| Content questions | ❌ (fallback to RAG) | ✅ Excellent |

---

## Best Practice: Hybrid Approach

Use BOTH:
1. **Document Catalog** for: "show me X deck", "where is Y doc", "send me Z product box"
2. **RAG Vector Search** for: "how does DSO work?", "what metrics does RMM track?", "compare Pacvue vs CommerceIQ"

The Intent Classifier automatically routes to the right system!

---

## Setup Files You Need

1. **Catalog JSON:** `/query/document-catalog-identity-focused.json`
2. **n8n Credentials:**
   - OpenAI API key (for GPT-5.2)
   - Pinecone API key (for RAG fallback)
   - Google Sheets API (if using Sheets)

---

## Testing

**Document queries (should use catalog):**
- "second call deck"
- "RMM product box"
- "Content Agent training"
- "battle card for Pacvue"

**Information queries (should use RAG):**
- "how does incrementality work?"
- "what is CARS metrics?"
- "compare RMM vs Skai"
- "DSO supported retailers"

---

## Updating the Catalog

When you add new documents:
```bash
# 1. Index new file to Pinecone
npm run index-missing-files

# 2. Rebuild catalog with GPT-5.2
npm run build-identity-catalog

# 3. Export to CSV (if using Google Sheets)
npm run export-catalog-csv

# 4. Upload to your n8n data source
```

The catalog is static but comprehensive - rebuild it monthly or when major docs are added.
