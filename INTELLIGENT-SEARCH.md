# Intelligent Document Search System

## Overview

Sally now uses an **intelligent dual-mode search system** that automatically detects whether you're looking for a specific document or asking for information, similar to how Perplexity handles queries.

### How It Works

```
User Query
    ↓
[Intent Detection] → Classifies as "document" or "information"
    ↓
┌─────────────────┴─────────────────┐
│                                    │
[Document Mode]              [Information Mode]
↓                                    ↓
Uses pre-built catalog         Uses semantic RAG search
Fast metadata lookup           Deep content search
Returns documents              Returns answers + citations
```

## The Two Modes

### 📁 Document Mode (Fast Catalog Lookup)

**When it activates:**
- "Show me the first call deck"
- "Find Profitero battle card"
- "Give me the AllyAI product hub"
- "Where is the pricing sheet?"
- "Do we have a deck for second calls?"

**How it works:**
1. Uses a pre-built catalog that has already characterized all documents
2. Matches against document names, types, keywords, and aliases
3. Returns direct links to matching documents
4. **No real-time vector search needed** - instant results

**What the catalog knows:**
- Document type (pitch-deck, battlecard, product-docs, etc.)
- Purpose and target audience
- Keywords and aliases (how salespeople actually search)
- Competitors mentioned (for battlecards)
- Related topics

### 💡 Information Mode (Semantic RAG Search)

**When it activates:**
- "What is AllyAI?"
- "How does RMM differ from DSA?"
- "Explain our pricing model"
- "What are the key features of Amazon Copilot?"

**How it works:**
1. Creates semantic embeddings of your query
2. Searches through document chunks for relevant content
3. Uses GPT-4 to synthesize an answer
4. Provides citations with relevance scores

## Setup & Usage

### 1️⃣ Build the Document Catalog (One-Time Setup)

```bash
npm run build-catalog
```

This will:
- Scan all documents in your Pinecone index
- Use GPT-4 to characterize each document
- Create a catalog file at `query/document-catalog.json`
- Take 2-5 minutes depending on document count

**When to rebuild:**
- After adding new documents to Pinecone
- After major updates to existing documents
- Recommended: Once per week or after bulk updates

### 2️⃣ Test the Smart Router

Interactive mode:
```bash
npm run smart-query
```

Single query:
```bash
npm run smart-query "show me the first call deck"
```

### 3️⃣ Use in Slack

The Slack bot automatically uses the smart router:

```
@Sally show me the first call deck
→ Document Mode: Returns the deck with direct link

@Sally what is AllyAI?
→ Information Mode: Provides explanation with citations
```

## Example Queries & Results

### Document Queries (Catalog Mode)

| Query | What Happens |
|-------|-------------|
| "first call deck" | Matches documents with "first call" or "pitch deck" keywords |
| "Profitero battle card" | Matches battlecards mentioning Profitero competitor |
| "AllyAI product hub" | Matches by exact name and product documentation type |
| "second call deck" | Matches documents tagged for follow-up presentations |
| "DSA battlecard" | Expands DSA → finds Digital Shelf Analytics battlecards |

### Information Queries (RAG Mode)

| Query | What Happens |
|-------|-------------|
| "What is AllyAI?" | Searches chunks, synthesizes answer from multiple sources |
| "How does pricing work?" | Finds pricing info across multiple documents |
| "DSA vs MS comparison" | Finds comparative information in content |
| "What objections do we hear about RMM?" | Searches for objection handling content |

## Architecture

### Files Created

```yaml
query/
  document-catalog.js     # Catalog builder and search
  smart-router.js         # Intent detection and routing
  rag-processor.js        # Existing RAG (now used by router)
  pinecone-client.js      # Existing Pinecone client
  document-catalog.json   # Generated catalog (not in git)

scripts/
  build-catalog.js        # CLI to build catalog
  smart-query.js          # CLI to test smart routing

slack-bot/
  server.js              # Updated to use smart router
```

### Intent Detection Logic

**Pattern-based (Fast):**
```javascript
Document patterns:
- "show|find|get|give me a deck/card/document"
- "first|second|third call deck"
- "battle card"
- "where is the..."
- "do we have a..."

Information patterns:
- "what|how|why|when|who..."
- "explain|describe|tell me about..."
- "difference between|compare..."
```

**GPT-4 Fallback:**
- For ambiguous queries, uses GPT-4o-mini to classify
- Fast and cost-effective
- Provides confidence scores

### Catalog Schema

```json
{
  "lastUpdated": "2025-01-14T10:30:00Z",
  "totalDocuments": 45,
  "documents": [
    {
      "name": "First Call Deck - Retail AI",
      "url": "https://docs.google.com/...",
      "type": "pitch-deck",
      "purpose": "Initial prospect presentation for Retail AI suite",
      "keywords": ["first call", "pitch", "retail ai", "overview"],
      "aliases": ["first call deck", "initial pitch", "prospect deck"],
      "category": "sales-enablement",
      "targetAudience": "Prospects, new customers",
      "competitors": []
    }
  ]
}
```

## Benefits Over Real-Time Search

### ❌ Old Approach (n8n Google Drive Search Tool)
- Searches Google Drive API in real-time
- Matches file names literally
- Doesn't understand context or synonyms
- Can miss documents with different naming
- Slow (API round-trip every time)

### ✅ New Approach (Intelligent Catalog)
- Pre-characterized by GPT-4
- Understands keywords, aliases, categories
- Instant lookup (no API calls)
- Semantic understanding built in
- Learns how your team actually searches

## Advanced Usage

### Hybrid Mode (Both Document + Information)

```javascript
import { SmartRouter } from './query/smart-router.js';

const router = new SmartRouter();
const result = await router.queryHybrid("AllyAI");

// Returns:
// - Top 3 related documents
// - Information from RAG search
// - Combined response
```

### Custom Intent Override

```javascript
// Force document mode
const docs = await router.handleDocumentQuery("AllyAI", classification);

// Force information mode
const info = await router.handleInformationQuery("first call deck", classification);
```

### Refresh Catalog Programmatically

```javascript
await router.refreshCatalog();
```

## Monitoring & Stats

Check catalog stats:
```bash
# Via Slack
/sally-stats

# Via CLI
node -e "import {SmartRouter} from './query/smart-router.js'; const r = new SmartRouter(); await r.catalog.loadCatalog(); console.log(r.getCatalogStats());"
```

## Troubleshooting

### "Catalog not found" error
```bash
# Build the catalog first
npm run build-catalog
```

### Documents not matching
```bash
# Rebuild catalog to refresh characterizations
npm run build-catalog

# Check what keywords were assigned
cat query/document-catalog.json | grep -A 5 "YourDocName"
```

### Poor intent detection
- Check the query patterns in `smart-router.js:classifyIntent()`
- Add custom patterns for your team's terminology
- Rebuild catalog if document types changed

### Slow catalog build
- Normal: 2-5 minutes for 50 documents
- Uses GPT-4o for characterization (high quality)
- Only needs to run after document updates

## Integration with n8n

Your n8n workflow now benefits from this without changes:

**Before:**
- n8n indexes documents → Pinecone
- Sally searches chunks → Often misses document-name queries

**Now:**
- n8n indexes documents → Pinecone (same)
- Sally builds catalog → Understands document organization
- Queries automatically routed to best search method
- Document queries use catalog (fast, accurate)
- Content queries use RAG (comprehensive)

## Future Enhancements

Potential additions:
- **Two-stage retrieval**: Try primary namespace, fall back to archive
- **Usage analytics**: Track which documents are requested most
- **Auto-categorization**: Automatically group related documents
- **Conversation context**: Use chat history to improve routing
- **Custom taxonomies**: Define your own document categories

## Cost Implications

**Catalog build:**
- One GPT-4o call per document
- ~50 documents = 50 API calls (~$0.25)
- Only runs on-demand (not per query)

**Query routing:**
- Pattern matching: Free (instant)
- GPT-4o-mini classification: $0.0001 per query (ambiguous cases only)

**Net savings:**
- Document queries: No vector search needed (saves OpenAI embedding costs)
- Faster response times
- More accurate results = fewer retry queries
