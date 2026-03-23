# Catalog API Guide

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Build Catalog
```bash
# Build mini catalog (5 documents - for demo)
npm run build-mini-catalog

# OR build full catalog (all documents)
npm run build-catalog
```

### 3. Start API Server
```bash
npm run api
```

Server will start on `http://localhost:3002`

---

## API Endpoints

### Health Check
```bash
GET /health
```

**Example:**
```bash
curl http://localhost:3002/health
```

**Response:**
```json
{
  "status": "ok",
  "service": "catalog-api"
}
```

---

### Get Full Catalog
```bash
GET /api/catalog
```

**Example:**
```bash
curl http://localhost:3002/api/catalog
```

**Response:**
```json
{
  "lastUpdated": "2026-01-14T14:02:32.066Z",
  "totalDocuments": 5,
  "documents": [...]
}
```

---

### Get Catalog Statistics
```bash
GET /api/catalog/stats
```

**Example:**
```bash
curl http://localhost:3002/api/catalog/stats
```

**Response:**
```json
{
  "totalDocuments": 5,
  "lastUpdated": "2026-01-14T14:02:32.066Z",
  "typeBreakdown": {
    "training-material": 4,
    "product-documentation": 1
  },
  "categoryBreakdown": {
    "sales-enablement": 4,
    "training": 1
  },
  "productsList": ["AllyAI", "Teammate I", "Teammate II", ...],
  "competitorsList": ["Seismic", "Retail Media Platforms", ...]
}
```

---

### Search Catalog
```bash
POST /api/catalog/search
Content-Type: application/json

{
  "query": "search query",
  "topK": 5  // optional, defaults to 5
}
```

**Example:**
```bash
curl -X POST http://localhost:3002/api/catalog/search \
  -H "Content-Type: application/json" \
  -d '{"query": "AllyAI training"}'
```

**Response:**
```json
{
  "query": "AllyAI training",
  "totalMatches": 4,
  "topK": 4,
  "results": [
    {
      "name": "AllyAI Product Hub",
      "url": "https://docs.google.com/...",
      "type": "training-material",
      "purpose": "Internal training and updates on AllyAI products...",
      "score": 29,
      "matchReasons": [
        "keyword: AllyAI",
        "keyword: training",
        "alias: AllyAI Hub"
      ],
      "keywords": ["AllyAI", "Teammate I", "training", ...],
      "products": ["AllyAI", "Teammate I", "Teammate II"],
      "competitors": []
    },
    ...
  ]
}
```

---

### Get Specific Document
```bash
GET /api/catalog/documents/:name
```

**Example:**
```bash
curl http://localhost:3002/api/catalog/documents/AllyAI%20Product%20Hub
```

**Response:**
```json
{
  "name": "AllyAI Product Hub",
  "url": "https://docs.google.com/...",
  "type": "training-material",
  "purpose": "Internal training...",
  "keywords": [...],
  "aliases": [...],
  "products": [...],
  "competitors": [...]
}
```

---

### Refresh Catalog (Webhook)
```bash
POST /api/catalog/refresh
```

**Example:**
```bash
curl -X POST http://localhost:3002/api/catalog/refresh
```

**Response:**
```json
{
  "message": "Catalog refresh triggered",
  "note": "Run: npm run build-catalog to rebuild"
}
```

---

## Using with n8n

### Method 1: HTTP Request Node

#### Node Configuration:
```yaml
Node Type: HTTP Request
Method: POST
URL: http://localhost:3002/api/catalog/search

Headers:
  Content-Type: application/json

Body:
  {
    "query": "{{ $json.userQuery }}",
    "topK": 3
  }
```

#### n8n Workflow Example:
```
[Slack Trigger]
    ↓
[Set Variable: userQuery]
    ↓
[HTTP Request] → POST /api/catalog/search
    ↓
[Code Node] → Format results
    ↓
[Slack Response]
```

---

### Method 2: AI Agent Tool

#### Tool Configuration:
```json
{
  "name": "search_document_catalog",
  "description": "Search for specific sales documents by name, product, or type. Use when user asks for a deck, battlecard, or specific document.",
  "type": "httpRequest",
  "method": "POST",
  "url": "http://localhost:3002/api/catalog/search",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "query": "{{$parameter.query}}",
    "topK": 3
  }
}
```

#### AI Agent Workflow:
```
[Slack Trigger]
    ↓
[AI Agent Node]
  ├── Tool 1: search_document_catalog (catalog API)
  └── Tool 2: search_knowledge_base (Pinecone RAG)
    ↓
[Agent auto-selects which tool to use]
    ↓
[Slack Response]
```

---

## Example Queries & Results

### Query: "AllyAI training"
**Matches:**
1. AllyAI Product Hub (score: 29)
2. 8/3 Ally 2 Training Deckv2 (score: 18)
3. Ally I Teammate Training (score: 13)

### Query: "Copilot Amazon"
**Matches:**
1. CommerceIQ Copilot for Amazon - Product Hub (score: 21)

### Query: "Product Success"
**Matches:**
1. Product Success Plan + Training Deck (score: 18)

---

## Scoring System

The search uses a scoring system to rank documents:

| Match Type | Points | Example |
|------------|--------|---------|
| Name match | 10 | Query contains document name |
| Alias match | 8 | Query matches alternative name |
| Competitor match | 7 | Query mentions competitor |
| Product match | 6 | Query mentions product |
| Keyword match | 5 | Query contains keyword |
| Type match | 3 | Query mentions document type |

**Higher score = Better match**

---

## Deployment Options

### Option 1: Local (Development)
```bash
npm run api
# Accessible at http://localhost:3002
```

### Option 2: Docker
```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3002
CMD ["npm", "run", "api"]
```

### Option 3: Cloud (Vercel/Railway/Render)
Deploy as a Node.js API service:
- Set `CATALOG_API_PORT` env variable
- Ensure `query/document-catalog.json` is in deployment
- Use webhook to trigger catalog refresh

### Option 4: Ngrok (For n8n Testing)
```bash
# Terminal 1: Start API
npm run api

# Terminal 2: Expose with ngrok
ngrok http 3002

# Use ngrok URL in n8n
# Example: https://abc123.ngrok.io/api/catalog/search
```

---

## Configuration

### Environment Variables

```bash
# .env
CATALOG_API_PORT=3002
```

---

## Maintenance

### Rebuild Catalog After Document Updates
```bash
npm run build-catalog
```

### Check Catalog Stats
```bash
curl http://localhost:3002/api/catalog/stats
```

### Monitor API Health
```bash
curl http://localhost:3002/health
```

---

## Troubleshooting

### "Catalog not found" error
**Solution:** Build the catalog first
```bash
npm run build-mini-catalog
```

### Port already in use
**Solution:** Change port in .env
```bash
CATALOG_API_PORT=3003
```

### n8n can't reach API
**Solutions:**
1. Use ngrok for local testing
2. Deploy API to cloud service
3. Use n8n self-hosted on same network

---

## Next Steps

1. ✅ Build catalog: `npm run build-mini-catalog`
2. ✅ Start API: `npm run api`
3. 🔧 Test endpoint: `curl http://localhost:3002/api/catalog/stats`
4. 🔗 Connect to n8n using HTTP Request node
5. 🤖 Add as AI Agent tool for intelligent routing
