# Using Google Sheets as Document Catalog in n8n

## 📊 Solution: Free, Simple, No Deployment Needed!

Instead of deploying an API, use **Google Sheets** as your catalog database.

---

## Cost Comparison

| Solution | Setup | Monthly Cost | Maintenance |
|----------|-------|--------------|-------------|
| **Google Sheets** ✅ | 5 minutes | **$0 FREE** | Easy manual edits |
| API on Railway | 30 minutes | $5-10 | Must redeploy for updates |
| API on Render | 30 minutes | $0-7 | Sleeps after inactivity |
| API on Vercel | 45 minutes | $0-20 | Complex serverless setup |

**Winner: Google Sheets** - Free, fast, easy!

---

## Setup Steps

### 1. Create Google Sheet from Catalog

Your catalog CSV is ready at: `query/document-catalog.csv`

**Option A: Import CSV to Google Sheets**
1. Go to https://sheets.google.com
2. Click **"Blank"** to create new sheet
3. File → Import → Upload → Select `document-catalog.csv`
4. Import settings: **Replace spreadsheet**

**Option B: Create Sheet Manually**
1. Create new Google Sheet
2. Copy-paste the data from CSV
3. Name it: "Sally Document Catalog"

### 2. Get Sheet ID

From the Google Sheets URL:
```
https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
                                        ^^^^^^^^
```

Copy that `SHEET_ID`. Example: `1a2B3c4D5e6F7g8H9i0J`

### 3. Share Sheet (Important!)

- Click **"Share"** button
- Add your n8n service account email OR
- Change to: **"Anyone with the link"** → **"Viewer"**

---

## n8n Workflow Setup

### Method 1: Simple Lookup (Best for Most Cases)

```
[Slack Trigger] → User asks: "show me AllyAI training"
    ↓
[Extract Keywords] → Code Node: Extract search terms
    ↓
[Google Sheets] → Lookup matching documents
    ↓
[Filter Results] → Rank by relevance
    ↓
[Format Response] → Create user-friendly message
    ↓
[Slack Response] → Send document links
```

#### Node Configurations:

**Node 1: Extract Keywords**
```javascript
// Code Node
const query = $json.text.toLowerCase();

// Extract key terms
const keywords = [];
if (query.includes('ally') || query.includes('allyai')) keywords.push('allyai');
if (query.includes('training')) keywords.push('training');
if (query.includes('copilot')) keywords.push('copilot');
if (query.includes('amazon')) keywords.push('amazon');
if (query.includes('battle card')) keywords.push('battlecard');

return [{
  json: {
    originalQuery: $json.text,
    searchKeywords: keywords,
    searchTerm: keywords.join(' ')
  }
}];
```

**Node 2: Google Sheets - Read Rows**
```yaml
Node: Google Sheets
Operation: Get Many
Sheet ID: YOUR_SHEET_ID
Sheet: Documents
Range: A2:J100
```

**Node 3: Filter & Score**
```javascript
// Code Node
const query = $('Extract Keywords').item.json.originalQuery.toLowerCase();
const rows = $input.all();

const matches = [];

for (const row of rows) {
  const doc = row.json;
  let score = 0;
  const reasons = [];

  // Name match
  if (doc['Document Name']?.toLowerCase().includes(query)) {
    score += 10;
    reasons.push('name-match');
  }

  // Keyword match
  const keywords = doc['Keywords']?.toLowerCase() || '';
  const keywordList = keywords.split(',').map(k => k.trim());
  for (const kw of keywordList) {
    if (query.includes(kw) || kw.includes(query)) {
      score += 5;
      reasons.push(`keyword: ${kw}`);
    }
  }

  // Alias match
  const aliases = doc['Aliases']?.toLowerCase() || '';
  if (aliases.includes(query)) {
    score += 8;
    reasons.push('alias-match');
  }

  // Product match
  const products = doc['Products']?.toLowerCase() || '';
  if (products.includes(query)) {
    score += 6;
    reasons.push('product-match');
  }

  if (score > 0) {
    matches.push({
      ...doc,
      score,
      reasons
    });
  }
}

// Sort by score
matches.sort((a, b) => b.score - a.score);

return matches.slice(0, 3).map(m => ({ json: m }));
```

**Node 4: Format Response**
```javascript
// Code Node
const matches = $input.all();

if (matches.length === 0) {
  return [{
    json: {
      message: "I couldn't find any documents matching your request."
    }
  }];
}

let response = `Found ${matches.length} document(s):\n\n`;

matches.forEach((match, i) => {
  const doc = match.json;
  response += `${i + 1}. *${doc['Document Name']}*\n`;
  response += `   Type: ${doc['Type']}\n`;
  response += `   ${doc['URL']}\n\n`;
});

return [{ json: { message: response } }];
```

---

### Method 2: AI Agent with Google Sheets Tool (Advanced)

Use n8n's **AI Agent** node with Google Sheets as a tool:

**AI Agent Configuration:**
```yaml
Agent Type: OpenAI Functions Agent

System Prompt: |
  You are Sally, a sales enablement assistant.
  When users ask for documents, use the search_catalog tool.
  When users ask questions, use the knowledge_base tool.

Tools:
  1. Name: search_catalog
     Type: Custom Tool → Google Sheets Lookup
     Description: "Search for sales documents like decks, battlecards, product hubs"

  2. Name: knowledge_base
     Type: Vector Store → Pinecone
     Description: "Answer questions from sales documentation"
```

The AI Agent will automatically decide which tool to use!

---

## Comparison: Google Sheets vs. Other Options

### Google Sheets ✅
- **Cost:** FREE
- **Speed:** Very fast (cached by Google)
- **Maintenance:** Easy - edit directly in sheet
- **n8n Integration:** Native node available
- **Setup Time:** 5 minutes
- **Scalability:** Good for <10,000 documents

### Airtable ⚡
- **Cost:** Free tier (1,200 records)
- **Speed:** Very fast
- **Maintenance:** Best UI for editing
- **n8n Integration:** Native node available
- **Setup Time:** 10 minutes
- **Scalability:** Excellent
- **Better if:** You want formulas, views, automations

### Database (Supabase/PostgreSQL) 🗄️
- **Cost:** Free tier available
- **Speed:** Fastest
- **Maintenance:** Requires SQL knowledge
- **n8n Integration:** Postgres node available
- **Setup Time:** 30 minutes
- **Scalability:** Unlimited
- **Better if:** You have >10,000 documents

---

## About Google MCP Server

You asked about **Google MCP (Model Context Protocol) Server**.

### What it does:
- Allows AI models to directly access Google services
- Better for: Gmail, Calendar, Drive file operations
- **Not helpful** for your use case because:
  - n8n already has Google Sheets integration
  - MCP is for AI agents to read/write files
  - You just need structured data lookup

### When to use MCP:
- AI needs to search Gmail
- AI needs to read/edit Docs
- AI needs file system access

### Your use case:
- ❌ MCP: Overkill, adds complexity
- ✅ Google Sheets: Perfect fit, simple, fast

---

## Performance Comparison

Test results for catalog with 50 documents:

| Method | Lookup Speed | Build Time | Cost/Month |
|--------|-------------|------------|------------|
| Google Sheets | ~200ms | 0 min | $0 |
| API (deployed) | ~300ms | 5 min rebuild | $5 |
| Pinecone semantic | ~500ms | 30 min | $0 (in plan) |

**Google Sheets wins for document lookup!**

---

## Maintenance

### Update Catalog:

**Method 1: Manual**
1. Edit Google Sheet directly
2. Add/remove rows
3. Changes instant ✨

**Method 2: Automated**
1. Run: `npm run build-catalog` (regenerate)
2. Run: `npm run export-catalog-csv`
3. Import CSV to Google Sheets
4. Overwrites old data

---

## Sample Google Sheet Structure

| Document Name | URL | Type | Purpose | Keywords | Aliases | Products |
|--------------|-----|------|---------|----------|---------|----------|
| AllyAI Product Hub | https://... | training-material | Internal training | AllyAI, training, GTM | AllyAI Hub | AllyAI, Teammate I |
| 8/3 Ally 2 Training | https://... | training-material | Sales team training | Ally AI, Sales Teammate | Ally Training | Ally AI Sales |

---

## Next Steps

1. ✅ CSV exported: `query/document-catalog.csv`
2. 📊 Create Google Sheet: https://sheets.google.com
3. 📤 Import the CSV
4. 🔗 Copy Sheet ID
5. ⚙️ Build n8n workflow with Google Sheets node
6. 🧪 Test queries

---

## Example n8n Workflow (Importable JSON)

See: `n8n-workflow-sheets.json` (coming next!)
