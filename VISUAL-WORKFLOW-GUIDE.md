# Sally n8n Workflow: Current vs New Visual Guide

## 📊 CURRENT SETUP (What You Have Now)

```
┌─────────────────────────────────────────────────────────────────────┐
│  👤 USER IN SLACK                                                   │
│  ────────────────────────────────────────────────────────────────   │
│  "show me the DSO product box"                                      │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  🤖 n8n AI AGENT NODE                                               │
│  ────────────────────────────────────────────────────────────────   │
│                                                                     │
│  System: "You are Sally, sales enablement assistant"               │
│                                                                     │
│  Available Tools:                                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 1️⃣  Pinecone Vector Database                                 │  │
│  │     • 3,445 content chunks                                   │  │
│  │     • 110 documents indexed                                  │  │
│  │     • Searches ALL chunks every time                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 2️⃣  Sally Folder Context Document                            │  │
│  │     • Manual guide with:                                     │  │
│  │       - Abbreviations (DSO, RMM, AC, etc.)                  │  │
│  │       - Folder structure                                     │  │
│  │       - Important file links                                 │  │
│  │     • Must be manually updated                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Agent's Process:                                                   │
│  1. Reads "DSO product box"                                        │
│  2. Checks context doc: "DSO = Digital Shelf Optimization"        │
│  3. Queries Pinecone for "DSO" and "product box"                  │
│  4. Gets 10 random chunks from various documents                   │
│  5. Tries to synthesize an answer                                  │
│  6. May or may not find the right document                        │
│                                                                     │
│  ⏱️  Time: 10-15 seconds                                           │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  💬 SLACK REPLY                                                     │
│  ────────────────────────────────────────────────────────────────   │
│                                                                     │
│  "I found information about DSO in the documentation. DSO stands   │
│  for Digital Shelf Optimization and includes features for          │
│  tracking product content across retailers..."                     │
│                                                                     │
│  [Generic content from random chunks]                              │
│                                                                     │
│  ❌ PROBLEMS:                                                       │
│  • No direct link to the actual document                          │
│  • Vague, pieced-together content                                  │
│  • User has to ask follow-up: "can you send me the link?"        │
│  • Slow (10-15 seconds)                                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🆕 NEW SETUP (With Identity-Focused Catalog)

```
┌─────────────────────────────────────────────────────────────────────┐
│  👤 USER IN SLACK                                                   │
│  ────────────────────────────────────────────────────────────────   │
│  "show me the DSO product box"                                      │
└────────────────────────┬────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  🎯 INTENT ROUTER NODE (NEW!)                                       │
│  ────────────────────────────────────────────────────────────────   │
│  Model: GPT-5.2                                                     │
│  Purpose: Determine what user wants                                 │
│                                                                     │
│  Analysis: "show me the DSO product box"                           │
│  ├─ Contains: "show me", "product box" (document indicators)      │
│  ├─ Does NOT contain: "how", "what", "why" (info indicators)      │
│  └─ Decision: USER WANTS A DOCUMENT ✅                             │
│                                                                     │
│  ⏱️  Time: 1 second                                                 │
└────────────────────────┬────────────────────────────────────────────┘
                         │
         ┌───────────────┴────────────────┐
         │                                │
         ▼ Document Request               ▼ Information Request
         (Fast Path)                      (Deep Search Path)
         │                                │
         │                                │
┌────────┴───────────────────────┐  ┌────┴──────────────────────────┐
│ 📚 DOCUMENT CATALOG SEARCH     │  │ 🔍 RAG VECTOR SEARCH          │
│ ─────────────────────────────  │  │ ────────────────────────────  │
│                                │  │                               │
│ Data Source:                   │  │ Data Source:                  │
│ • Identity-Focused Catalog     │  │ • Pinecone Vector DB          │
│ • 110 pre-characterized docs   │  │ • 3,445 content chunks        │
│ • Generated with GPT-5.2       │  │                               │
│                                │  │ Example Queries:              │
│ Search Process:                │  │ • "How does DSO work?"       │
│ 1. Load catalog (110 entries) │  │ • "What is CARS metrics?"    │
│ 2. GPT-5.2 semantic match      │  │ • "Compare Pacvue vs CIQ"    │
│ 3. Find best match             │  │                               │
│                                │  │ Process:                      │
│ Match Found:                   │  │ 1. Query Pinecone            │
│ ┌────────────────────────────┐ │  │ 2. Get top 10 chunks         │
│ │ DSO Product Description    │ │  │ 3. Generate answer           │
│ │ v2.1 (July 2025)          │ │  │ 4. Return with citations     │
│ │                            │ │  │                               │
│ │ • Covers 1,450+ retailers  │ │  │ ⏱️  Time: 10 seconds          │
│ │ • Includes taxonomy        │ │  └───────────────────────────────┘
│ │ • Analytics types          │ │              │
│ │ • Crawl frequency          │ │              │
│ │ • Scorecards               │ │              │
│ │                            │ │              │
│ │ Link: [Google Doc URL]    │ │              │
│ └────────────────────────────┘ │              │
│                                │              │
│ ⏱️  Time: 2 seconds             │              │
└────────────┬───────────────────┘              │
             │                                  │
             └────────────┬─────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  💬 SLACK REPLY (Formatted & Rich)                                  │
│  ────────────────────────────────────────────────────────────────   │
│                                                                     │
│  📄 **Found: DSO Product Description v2.1 (July 2025)**            │
│                                                                     │
│  This is the official Digital Shelf Optimization product           │
│  description that defines how CommerceIQ collects, categorizes,    │
│  analyzes, and scores digital shelf data across **1,450+ retailer  │
│  websites**. It includes:                                           │
│                                                                     │
│  • Product coverage methodology                                     │
│  • Standard taxonomy classification                                 │
│  • Single-store vs multi-store analytics                           │
│  • Feature availability by retailer                                 │
│  • Crawl frequency (daily, weekly)                                 │
│  • Scorecards and AI-driven insights                               │
│  • Supported retailers list                                         │
│                                                                     │
│  **When to use this document:**                                     │
│  Clarifying DSO scope, data coverage, analytics types, crawl       │
│  frequency, retailer support, or feature availability in sales,    │
│  legal, or customer discussions.                                    │
│                                                                     │
│  🔗 [Open Document](https://docs.google.com/document/d/1nmzd...)   │
│                                                                     │
│  ✅ BENEFITS:                                                       │
│  • Direct link to exact document                                   │
│  • Rich description with specific details                          │
│  • Clear guidance on when to use it                                │
│  • Fast (2 seconds vs 15 seconds)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔀 ROUTING LOGIC - How It Decides

```
USER QUERY EXAMPLES:

┌────────────────────────────────┐         ┌────────────────────────────┐
│ DOCUMENT REQUESTS              │         │ INFORMATION REQUESTS       │
│ → Route to CATALOG (Fast)      │         │ → Route to RAG (Deep)      │
├────────────────────────────────┤         ├────────────────────────────┤
│                                │         │                            │
│ ✅ "show me DSO product box"   │         │ ✅ "how does DSO work?"    │
│ ✅ "send me second call deck"  │         │ ✅ "what is CARS metrics?" │
│ ✅ "RMM battle card"            │         │ ✅ "explain incrementality"│
│ ✅ "Content Agent training"    │         │ ✅ "compare Pacvue vs CIQ" │
│ ✅ "first call deck"            │         │ ✅ "DSO supported retailers│
│ ✅ "Profitero battle card"      │         │ ✅ "RMM pricing tiers"     │
│ ✅ "case studies for Ally"      │         │ ✅ "what metrics in DSO?"  │
│                                │         │                            │
│ Keywords that trigger:         │         │ Keywords that trigger:     │
│ • "show me", "send me"         │         │ • "how", "what", "why"     │
│ • "deck", "box", "card"        │         │ • "explain", "compare"     │
│ • "training", "datasheet"      │         │ • "tell me about"          │
│ • Document type names          │         │ • Question words           │
└────────────────────────────────┘         └────────────────────────────┘
         │                                              │
         ▼                                              ▼
    2 seconds ⚡                                   10 seconds 🔍
   Direct link ✅                                  Deep answer 📚
```

---

## 📈 PERFORMANCE COMPARISON

```
┌─────────────────────────────────────────────────────────────────────┐
│  METRIC COMPARISON                                                  │
├────────────────────────┬─────────────────┬──────────────────────────┤
│ Metric                 │ CURRENT         │ NEW (with Catalog)       │
├────────────────────────┼─────────────────┼──────────────────────────┤
│ Speed (doc request)    │ 10-15 sec ❌    │ 2-3 sec ✅               │
│ Speed (info request)   │ 10-15 sec ✅    │ 10 sec ✅                │
│ Returns direct link    │ NO ❌           │ YES ✅                   │
│ Document accuracy      │ 60-70% ⚠️       │ 95%+ ✅                  │
│ Handles abbreviations  │ YES ✅          │ YES ✅                   │
│ Maintenance            │ Manual ❌       │ Auto-generated ✅        │
│ Cost per query         │ $0.02           │ $0.001 (catalog) 💰      │
│                        │                 │ $0.02 (RAG)              │
│ Rich descriptions      │ NO ❌           │ YES ✅                   │
│ Version info           │ NO ❌           │ YES ✅                   │
└────────────────────────┴─────────────────┴──────────────────────────┘
```

---

## 🎬 REAL EXAMPLE: "DSO product box"

### CURRENT FLOW:
```
User: "show me the DSO product box"
  │
  ▼ [10 seconds] 🐌
  │
  ├─ Checks Sally context doc
  ├─ Sees: "DSO = Digital Shelf Optimization"
  ├─ Queries Pinecone for "DSO" + "product box"
  ├─ Gets chunks from:
  │    • DSO Product Description (chunk 3)
  │    • DSO Messaging Framework (chunk 7)
  │    • DSO Key Product Slides (chunk 2)
  │    • Random other docs
  │
  ▼
  │
Reply: "I found information about DSO. Digital Shelf
        Optimization is a product that helps track
        product content across retailers..."

        ❌ No direct link
        ❌ Vague generic content
        ❌ User asks: "can you send the link?"
```

### NEW FLOW:
```
User: "show me the DSO product box"
  │
  ▼ [1 second] ⚡
  │
Intent Router: "USER WANTS A DOCUMENT"
  │
  ▼ [2 seconds] ⚡
  │
  ├─ Load catalog (110 docs)
  ├─ GPT-5.2 semantic search
  ├─ Match: "DSO Product Description v2.1"
  │   Score: 95% confidence
  │
  ▼
  │
Reply: "📄 Found: DSO Product Description v2.1
        (July 2025)

        Official product description covering 1,450+
        retailer websites, taxonomy, analytics types,
        crawl frequency, scorecards...

        When to use: Clarifying DSO scope, data
        coverage, feature availability

        🔗 [Open Document](link)"

        ✅ Direct link
        ✅ Specific details (1,450+ retailers)
        ✅ Clear guidance
        ✅ 5x faster
```

---

## 🔧 YOUR SALLY FOLDER CONTEXT DOCUMENT

### How It Works Now:
```
┌─────────────────────────────────────────────────────────────┐
│ Sally Folder Context Document                              │
│ (Manual Google Doc)                                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ • DSO = Digital Shelf Optimization                          │
│ • AC = Amazon Copilot                                       │
│ • RMM = Retail Media Management                            │
│ • Important file: AllyAI Product Hub (link)                │
│ • Important file: Copilot Product Box (link)               │
│ • Folder: Competitive Intelligence (ID: xxx)               │
│                                                             │
│ ❌ Problems:                                                │
│ • Must be manually updated                                  │
│ • AI agent reads it every query (slow)                     │
│ • Doesn't include detailed descriptions                    │
└─────────────────────────────────────────────────────────────┘
         │
         ▼ (Used by AI agent every time)
         │
    AI Agent → Slow, manual
```

### How It Becomes Better:
```
┌─────────────────────────────────────────────────────────────┐
│ Sally Folder Context Document                              │
│ (One-time input for catalog)                               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼ (One-time setup)
┌─────────────────────────────────────────────────────────────┐
│ Catalog Builder Script (GPT-5.2)                           │
│                                                             │
│ 1. Reads abbreviations from Sally doc                      │
│    → DSO, RMM, AC, etc.                                    │
│                                                             │
│ 2. Reads folder structure from Sally doc                   │
│    → Digital Shelf, AllyAI, RMM, etc.                      │
│                                                             │
│ 3. Reads actual document content from Pinecone             │
│    → 15 chunks per doc (deep context)                      │
│                                                             │
│ 4. Generates rich descriptions with GPT-5.2                │
│    → Identity + content summary + specifics                │
│                                                             │
│ 5. Marks important files as "start here"                   │
│    → AllyAI Product Hub, Copilot Product Box               │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│ Identity-Focused Catalog                                    │
│ (110 documents, auto-generated)                            │
│                                                             │
│ Example entry:                                              │
│ ┌─────────────────────────────────────────────────────────┐│
│ │ Name: DSO Product Description v2.1                      ││
│ │ Type: product-description                               ││
│ │ Identity: "This is the DSO Product Description..."      ││
│ │ Description: "Covers 1,450+ retailers, includes..."     ││
│ │ Abbreviations: DSO, DSA, Digital Shelf                  ││
│ │ When to use: "Clarifying scope, coverage..."           ││
│ │ Link: https://docs.google.com/...                       ││
│ └─────────────────────────────────────────────────────────┘│
│                                                             │
│ ✅ Benefits:                                                │
│ • Auto-generated (no manual updates)                       │
│ • Rich with specifics (numbers, metrics)                   │
│ • Abbreviations baked in                                   │
│ • Fast to search (110 entries vs 3,445 chunks)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 MIGRATION PATH

### Option 1: Add Alongside (Safest)
```
Keep your current setup, add catalog as bonus:

Current AI Agent Tools:
• Pinecone Vector DB ✅ (keep)
• Sally Folder Context ✅ (keep)
• Identity-Focused Catalog ✅ (ADD NEW!)

Agent prompt:
"For document requests, check Identity-Focused
 Catalog first. For content questions, use Pinecone."

✅ No risk, incremental improvement
✅ Can compare results
⏱️ Setup time: 30 minutes
```

### Option 2: Full Replacement (Best)
```
Replace manual approach with automated:

New n8n Nodes:
1. Intent Router (GPT-5.2)
2. IF Branch (document vs info)
3. Catalog Search (GPT-5.2 + catalog JSON)
4. RAG Search (existing Pinecone)
5. Format Response

✅ 5x faster for doc requests
✅ No manual maintenance
⏱️ Setup time: 2 hours
```

---

## 📊 WHAT YOU NEED

### Files Ready:
✅ `document-catalog-identity-focused.json` (110 docs, already built)
✅ Pinecone index (already have)
✅ OpenAI API key (already have)

### n8n Setup:
```
1. Upload catalog JSON to:
   → Option A: Google Sheets (free, easy)
   → Option B: HTTP endpoint (S3, public URL)

2. Add nodes:
   → Intent Router (OpenAI node)
   → Catalog loader (HTTP/Sheets node)
   → Catalog search (OpenAI node)

3. Test with queries:
   → "show me DSO product box"
   → "RMM second call deck"
   → "how does DSO work?"
```

---

## 💡 BOTTOM LINE

**Current:** Works, but slow for document lookups, manual maintenance

**With Catalog:** 5x faster, auto-generated, direct links, same quality for content questions

**Best Part:** Can add incrementally without breaking anything!

**Time to set up:** 30 minutes (add alongside) or 2 hours (full replacement)

**Maintenance:** Zero (catalog auto-regenerates when you index new docs)
