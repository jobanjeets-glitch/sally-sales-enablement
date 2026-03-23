# Catalog Description Comparison - Identity-Focused vs Generic

## Example 1: RMM Second Call Deck

### ❌ OLD (Generic):
```json
{
  "name": "RMM Second call deck",
  "type": "training-material",
  "detailedDescription": "A comprehensive presentation designed to educate sales teams on Retail Media Management capabilities, featuring key metrics, use cases, and value propositions for customer meetings.",
  "specificKeywords": ["RMM", "retail media", "presentation", "sales deck", "training"]
}
```

**Problem:** User asks "show me the second call deck" → matches with multiple "presentation", "sales deck" documents

### ✅ NEW (Identity-Focused):
```json
{
  "name": "RMM Second call deck",
  "type": "presentation-second-call",
  "detailedDescription": "This is the SECOND CALL DECK for Retail Media Management (RMM). Use this specific deck when conducting the second customer meeting for RMM sales. This deck follows the initial discovery call and goes deeper into RMM product capabilities, implementation, and ROI. If someone asks for 'RMM second call deck', 'second call deck for retail media', or 'follow-up deck for RMM', this is the document they need.",
  "documentPurpose": "Second customer meeting presentation for RMM product",
  "whenToUse": "Second sales call after initial RMM discovery meeting"
}
```

**Benefit:** Direct match when user asks "second call deck" - agent knows this IS the second call deck

---

## Example 2: Content Agent Training Deck

### ❌ OLD (Generic):
```json
{
  "name": "Content Agent Training Deck",
  "type": "training-material",
  "detailedDescription": "The Content Agent Training Deck is a comprehensive guide designed to educate users on the deployment and utilization of Retail AI Agents, specifically focusing on the Content Agent...",
  "specificKeywords": ["Content Agent", "training deck", "Retail AI Agents", "deployment"]
}
```

**Problem:** Generic "training deck" keyword matches with ALL training decks

### ✅ NEW (Identity-Focused):
```json
{
  "name": "Content Agent Training Deck",
  "type": "training-deck",
  "detailedDescription": "This is the CONTENT AGENT TRAINING DECK - the primary internal training material for Content Agent product. Use this when someone asks for 'Content Agent training', 'how to use Content Agent', or 'Content Agent enablement materials'. This deck covers Content Agent deployment, PDP optimization, retailer-specific content recommendations, and the GTM schedule with 100% deployment target by Q1 2026. Key differentiator: This is specifically about the CONTENT AGENT, not Media Agent, Sales Agent, or other agents.",
  "documentPurpose": "Internal training on Content Agent product features and deployment",
  "whenToUse": "Training sales teams or CSMs on Content Agent capabilities",
  "notToConfuseWith": "Content Agent Product Box (which is positioning/messaging, not training)"
}
```

**Benefit:** Agent knows this is THE Content Agent training deck, not a product box or other content

---

## Example 3: DRAFT CommerceIQ Sales Agent - Product Box

### ❌ OLD (Generic):
```json
{
  "name": "DRAFT CommerceIQ Sales Agent - Product Box January 26 Internal",
  "type": "product-box",
  "detailedDescription": "An internal draft document designed to provide a comprehensive service description for a tool that enhances strategic, tailored, and measurable outcomes...",
  "specificKeywords": ["Sales Agent", "Product Box", "CARS metrics", "internal"]
}
```

**Problem:** What IS a "product box"? Description doesn't explain document type clearly

### ✅ NEW (Identity-Focused):
```json
{
  "name": "DRAFT CommerceIQ Sales Agent - Product Box January 26 Internal",
  "type": "product-box",
  "detailedDescription": "This is the SALES AGENT PRODUCT BOX - a product positioning and messaging document that defines what Sales Agent is, its value proposition, and key features. A 'Product Box' is an internal document that answers: What is this product? Who is it for? What problems does it solve? This specific Product Box covers the CommerceIQ Sales Agent effective January 2026, focusing on CARS metrics (Content, Availability, Ratings & Reviews, Share of Search), customer-branded PowerPoint presentations, and Retailer Access Instructions. If someone asks 'what is Sales Agent', 'Sales Agent positioning', or 'Sales Agent product definition', use this document.",
  "documentPurpose": "Product positioning and messaging reference for Sales Agent",
  "whenToUse": "When needing to explain Sales Agent product definition, features, or positioning",
  "notToConfuseWith": "Sales Agent Training Deck (which is for learning HOW to use it)"
}
```

**Benefit:** Agent understands what a "product box" document type is and when to use it

---

## Example 4: Content Agent_Product Box_WIP

### ❌ OLD (Generic):
```json
{
  "name": "Content Agent_Product Box_WIP",
  "type": "product-box",
  "detailedDescription": "An internal, work-in-progress document designed to enhance product visibility in conversational shopping environments by optimizing Product Detail Page content...",
  "specificKeywords": ["Content Agent", "Product Box", "PDP content", "work in progress"]
}
```

**Problem:** Similar name to training deck, unclear distinction, WIP status not prominent

### ✅ NEW (Identity-Focused):
```json
{
  "name": "Content Agent_Product Box_WIP",
  "type": "product-box",
  "detailedDescription": "This is the CONTENT AGENT PRODUCT BOX (Work In Progress version) - the product positioning and messaging document for Content Agent. Unlike the Content Agent Training Deck which teaches HOW to use the product, this Product Box defines WHAT Content Agent is: a tool that optimizes PDP content for AI-driven platforms like Amazon Rufus and Walmart Sparky. This document answers questions like 'what does Content Agent do?', 'Content Agent features', and 'Content Agent value proposition'. Key features documented: Content Validation (DAM/PIM/PDP connections), Content Compliance (discrepancy detection), and Agent Training (natural language input). NOTE: This is WIP (Work In Progress), check for newer versions.",
  "documentPurpose": "Product definition and positioning for Content Agent",
  "whenToUse": "When needing Content Agent product overview, feature list, or value prop",
  "notToConfuseWith": "Content Agent Training Deck (training material, not product definition)",
  "status": "Work In Progress - may have newer version"
}
```

**Benefit:** Clear distinction between Product Box vs Training Deck, WIP status highlighted

---

## Example 5: DSO Product Description_v2.1_Jul2025_INTERNAL

### ❌ OLD (Generic):
```json
{
  "name": "DSO Product Description_v2.1_Jul2025_INTERNAL",
  "type": "product-documentation",
  "detailedDescription": "A detailed product description document outlining the features, capabilities, and value propositions of Digital Shelf Optimization (DSO) product...",
  "specificKeywords": ["DSO", "Digital Shelf Optimization", "product description", "internal"]
}
```

**Problem:** "Product description" vs "Product Box" - what's the difference?

### ✅ NEW (Identity-Focused):
```json
{
  "name": "DSO Product Description_v2.1_Jul2025_INTERNAL",
  "type": "product-description",
  "detailedDescription": "This is the official DSO (Digital Shelf Optimization) PRODUCT DESCRIPTION document version 2.1 from July 2025. A 'Product Description' is a comprehensive technical document that details product features, specifications, capabilities, and implementation details - more detailed than a Product Box. Use this when someone asks 'what is DSO?', 'DSO features', 'DSO capabilities', 'Digital Shelf Optimization product details', or 'DSO specifications'. This is the authoritative source for DSO product information as of July 2025 (v2.1). If someone asks for DSO product info, this is the PRIMARY document to reference.",
  "documentPurpose": "Authoritative technical product description for DSO",
  "whenToUse": "When needing detailed DSO product features, specs, or capabilities",
  "version": "v2.1",
  "effectiveDate": "July 2025",
  "notToConfuseWith": "DSO Product Box (shorter positioning doc) or DSO training materials"
}
```

**Benefit:** Agent knows this is THE authoritative DSO product document (version 2.1)

---

## Key Improvements Summary:

### 1. **Document Identity**
- OLD: "A comprehensive guide designed to..."
- NEW: "This is the SECOND CALL DECK for RMM..."

### 2. **Explicit Use Cases**
- OLD: Generic keywords
- NEW: "If someone asks 'X', 'Y', or 'Z', use this document"

### 3. **Clear Distinctions**
- OLD: No differentiation between similar docs
- NEW: "Not to confuse with: Training Deck (which is for...)"

### 4. **Document Type Explanation**
- OLD: Assumes you know what "Product Box" means
- NEW: "A 'Product Box' is a document that answers: What is this product?..."

### 5. **Version & Status**
- OLD: Version buried in filename
- NEW: Explicit "version", "effectiveDate", "status: WIP"

---

## How This Helps Queries:

| User Query | OLD Result | NEW Result |
|------------|-----------|------------|
| "second call deck" | Returns multiple "deck" documents | ✅ Directly identifies RMM Second Call Deck |
| "what is Sales Agent" | Returns training materials | ✅ Returns Sales Agent Product Box (positioning) |
| "Content Agent training" | Returns both training + product box | ✅ Returns only Training Deck, notes difference |
| "DSO product info" | Generic match on "DSO" | ✅ Returns v2.1 Product Description as authoritative source |
| "product box for content agent" | Matches multiple docs | ✅ Returns Content Agent Product Box, explains WIP status |

