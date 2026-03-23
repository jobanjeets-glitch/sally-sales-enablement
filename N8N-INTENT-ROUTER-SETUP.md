# How to Create Intent Router in n8n

## Overview
The Intent Router determines if a user wants a **document** (like "show me X deck") or **information** (like "how does X work?") and routes accordingly.

---

## Step-by-Step Setup

### Step 1: Add OpenAI Node (Intent Classifier)

1. **Add Node:** Click `+` → Search "OpenAI" → Select **"OpenAI Chat Model"**
2. **Rename Node:** Click node → Rename to `Intent Router`
3. **Configure Node:**

```yaml
Node: OpenAI Chat Model
Name: Intent Router

Credentials:
  - Select your OpenAI credentials (same one you use for AI Agent)

Model:
  - gpt-5.2-chat-latest (or gpt-4o-mini for cost savings)

Messages:
  System Message:
    "You are an intent classifier for a sales enablement assistant.

    Analyze the user's query and determine their intent:

    - Return 'document' if user wants a SPECIFIC FILE/DOCUMENT:
      Examples: 'show me X', 'send me Y deck', 'Z product box', 'battle card for A'
      Keywords: 'show', 'send', 'give me', 'deck', 'box', 'card', 'training', 'doc'

    - Return 'information' if user wants CONTENT/KNOWLEDGE:
      Examples: 'how does X work?', 'what is Y?', 'explain Z', 'compare A vs B'
      Keywords: 'how', 'what', 'why', 'explain', 'compare', 'tell me about'

    Respond with ONLY ONE WORD: 'document' or 'information'"

  User Message:
    {{ $json.body.query }}

    (Or if coming from Slack:)
    {{ $json.text }}

Options:
  - Temperature: 0 (for consistent classification)
  - Max Tokens: 10 (only need one word)
```

**n8n Node Configuration Screenshot:**
```
┌─────────────────────────────────────────┐
│ OpenAI Chat Model                       │
├─────────────────────────────────────────┤
│ Node Name: Intent Router                │
│                                         │
│ Credentials: [Your OpenAI API Key]     │
│ Model: gpt-5.2-chat-latest             │
│                                         │
│ System Message:                         │
│ ┌─────────────────────────────────────┐ │
│ │ You are an intent classifier...     │ │
│ │ (paste prompt above)                │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ User Message:                           │
│ ┌─────────────────────────────────────┐ │
│ │ {{ $json.body.query }}              │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Temperature: 0                          │
│ Max Tokens: 10                          │
└─────────────────────────────────────────┘
```

---

### Step 2: Add IF Node (Branch Logic)

1. **Add Node:** Click `+` after Intent Router → Search "IF" → Select **"IF"**
2. **Rename Node:** Click node → Rename to `Route: Document or Info`
3. **Configure Condition:**

```yaml
Node: IF
Name: Route: Document or Info

Conditions:
  Condition 1:
    - Value 1: {{ $json.choices[0].message.content }}
    - Operation: Equal
    - Value 2: document

Logic:
  - If TRUE → Go to Document Catalog path
  - If FALSE → Go to RAG Vector Search path
```

**n8n IF Node Configuration:**
```
┌─────────────────────────────────────────┐
│ IF                                      │
├─────────────────────────────────────────┤
│ Node Name: Route: Document or Info     │
│                                         │
│ Condition:                              │
│ ┌─────────────────────────────────────┐ │
│ │ Value 1:                            │ │
│ │ {{ $json.choices[0].message.content }}│ │
│ │                                     │ │
│ │ Operation: Equal                    │ │
│ │                                     │ │
│ │ Value 2: document                   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ TRUE → Document Catalog                 │
│ FALSE → RAG Vector Search               │
└─────────────────────────────────────────┘
```

---

### Step 3: Test the Intent Router

Add a **Webhook** or **Manual Trigger** to test:

**Test Queries:**

```javascript
// Should return "document"
{ "query": "show me the DSO product box" }
{ "query": "send me RMM second call deck" }
{ "query": "battle card for Pacvue" }
{ "query": "Content Agent training" }

// Should return "information"
{ "query": "how does DSO work?" }
{ "query": "what is CARS metrics?" }
{ "query": "compare Pacvue vs CommerceIQ" }
{ "query": "explain incrementality" }
```

**Testing Steps:**
1. Add Manual Trigger node before Intent Router
2. Click "Execute Node" on Manual Trigger
3. Provide test JSON: `{ "body": { "query": "show me DSO product box" } }`
4. Check Intent Router output → Should see: `{ "choices": [{ "message": { "content": "document" }}]}`
5. Check IF node → Should route to TRUE branch

---

## Complete Flow After Intent Router

```
Slack Webhook
    ↓
Intent Router (OpenAI)
    ↓
IF (Route: Document or Info)
    ↓
    ├─ TRUE (document) → Document Catalog Search
    │                       ↓
    │                    Format Document Response
    │                       ↓
    └─ FALSE (information) → Pinecone RAG Search
                               ↓
                            Format Info Response
                               ↓
                            Slack Reply
```

---

## Cost Optimization Tips

### Use Cheaper Model for Intent Router

Since intent classification is simple, you can use a cheaper model:

```yaml
Model Options (by cost):
  1. gpt-4o-mini ($0.00015/1K tokens) ← RECOMMENDED for intent routing
  2. gpt-5.2-chat-latest ($0.003/1K tokens)

Typical cost per query:
  - gpt-4o-mini: ~$0.0001 (practically free)
  - gpt-5.2: ~$0.001
```

**Updated Intent Router Config for Cost Savings:**
```yaml
Model: gpt-4o-mini
Temperature: 0
Max Tokens: 10
```

This saves 95% on intent classification while maintaining accuracy.

---

## Alternative: Simple JavaScript Intent Router (Free!)

If you want to avoid OpenAI calls for intent routing, use a simple JavaScript node:

### Node: Code (JavaScript)

```javascript
// Get user query
const query = $input.item.json.body.query.toLowerCase();

// Document request keywords
const docKeywords = [
  'show me', 'send me', 'give me', 'share',
  'deck', 'box', 'card', 'training',
  'document', 'doc', 'slide', 'presentation',
  'datasheet', 'one-pager', 'guide'
];

// Information request keywords
const infoKeywords = [
  'how', 'what', 'why', 'when', 'where',
  'explain', 'compare', 'tell me about',
  'difference between', 'describe'
];

// Check for document keywords
const isDocRequest = docKeywords.some(keyword => query.includes(keyword));

// Check for information keywords (but only if not doc request)
const isInfoRequest = !isDocRequest && infoKeywords.some(keyword => query.includes(keyword));

// Default to info request if unclear
const intent = isDocRequest ? 'document' : 'information';

return {
  json: {
    intent: intent,
    query: $input.item.json.body.query,
    confidence: isDocRequest || isInfoRequest ? 'high' : 'low'
  }
};
```

**Benefits:**
- ✅ Free (no API costs)
- ✅ Instant (no network latency)
- ✅ ~85% accuracy (good enough for most cases)

**Drawbacks:**
- ❌ Less sophisticated than GPT (can't handle edge cases as well)
- ❌ Requires manual keyword updates

**When to use:**
- High query volume (cost savings)
- Simple document naming patterns
- Want instant routing

**When to use GPT:**
- Complex queries
- Natural language flexibility
- Higher accuracy needed (95%+)

---

## Recommended Setup

### Option 1: GPT-4o-mini (Best Balance)
```yaml
Model: gpt-4o-mini
Cost: ~$0.0001/query
Accuracy: ~95%
Speed: 1-2 seconds
```

### Option 2: JavaScript (Cost-Optimized)
```yaml
Model: None (JavaScript)
Cost: $0
Accuracy: ~85%
Speed: <100ms
```

### Option 3: GPT-5.2 (Highest Accuracy)
```yaml
Model: gpt-5.2-chat-latest
Cost: ~$0.001/query
Accuracy: ~98%
Speed: 1-2 seconds
```

**My Recommendation:** Start with **gpt-4o-mini** - it's cheap, fast, and accurate enough.

---

## Troubleshooting

### Issue: Intent Router returns wrong intent

**Debug steps:**
1. Check the exact output: `{{ $json.choices[0].message.content }}`
2. Should be ONLY: `document` or `information` (no extra text)
3. If returning full sentence, update system prompt to emphasize "ONLY ONE WORD"

**Fixed prompt:**
```
"Return EXACTLY one of these words with no punctuation or explanation:
document
information

Respond with ONLY that word, nothing else."
```

### Issue: IF node not routing correctly

**Debug steps:**
1. Add a "Sticky Note" or "Set" node after Intent Router to see exact output
2. Check if output is `document` (lowercase, no spaces)
3. IF condition must exactly match: `document` (case-sensitive)

### Issue: Coming from Slack, query is in different field

**Check Slack payload structure:**
```javascript
// Could be in:
{{ $json.text }}           // Slack message text
{{ $json.event.text }}     // Slack event payload
{{ $json.body.text }}      // If wrapped in body
```

**Add a "Set" node before Intent Router to normalize:**
```javascript
return {
  json: {
    query: $json.text || $json.event.text || $json.body.query
  }
};
```

---

## Next Steps

Once Intent Router is working:
1. ✅ Test with 10-20 queries
2. ✅ Connect TRUE branch to Document Catalog Search (next guide)
3. ✅ Connect FALSE branch to your existing Pinecone RAG
4. ✅ Add response formatting
5. ✅ Connect to Slack reply

Need help with Document Catalog Search node? Let me know!
