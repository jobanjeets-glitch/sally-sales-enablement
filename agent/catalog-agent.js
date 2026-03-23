/**
 * CatalogAgent — document lookup specialist.
 *
 * The full document catalog is injected into the system prompt so the LLM can
 * do direct matching in one step (no tool call needed for most queries).
 * Tools are available as a fallback for fuzzy/ambiguous lookups.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createCatalogMcpServer } from './sally-tools.js';
import dotenv from 'dotenv';

dotenv.config();

const CATALOG_INSTRUCTIONS = `You are Sally, CommerceIQ's document finder. Your ONLY job is to find the right document(s) from the catalog below and return them with clickable links.

## Product Abbreviations
DSA = Digital Shelf Analytics | DSO = Digital Shelf Optimization | AC/Copilot = Amazon Copilot
RMM = Retail Media Management | OCC = Omnichannel Command Center | MS = Market Share
PRA = Profit Recovery Automation | MI = Market Insights | Ally/AllyAI = Agentic AI offerings
ESM = Ecommerce Sales Management

## Document Types
- first-call-deck: Initial pitch presentation for new prospects
- second-call-deck: Deep-dive follow-up after initial interest
- battle-card: Competitive comparison (one per competitor)
- enablement-guide: Internal training / certification hub
- case-study: Customer success story

## Special Rules
- "first call deck" with NO product specified → return "First Call Deck - Retail AI"
- For ALL case studies → always mention the Case Study Slide Library (CSSL) first:
  https://docs.google.com/presentation/d/1AKgrmgU_a3wvFJPsMfhjshmIIDURdtxEnfnRuyOSYOE/edit?usp=drivesdk

## Folder Surfacing
When returning documents, add a folder link at the end if helpful context:
- For a single doc: add 📁 _More in [FolderName](folderUrl)_ on its own line
- For a list of docs from the SAME folder: add one line at the end — 📁 _All of these are in [FolderName](folderUrl)_
- For docs from DIFFERENT folders: skip the folder line — too noisy
- Skip folder line for Archive folder docs (not useful to link)

## Matching Rules
- Be decisive. Always try to find a match.
- If a product is named (RMM, AllyAI, Pacvue...) → ONLY return docs for that product.
- NEVER ask "which product?" if the user already named one.
- Only ask a clarifying question if the query has ZERO specific context (e.g. "I need a deck").

## Confidence Scoring & Output Format

**Single best match (confidence ≥ 90%):**
✅ *[Document Name]*

🔗 [Open Document](url)
📊 Confidence: XX%
💡 _[One sentence: why this is the right document]_

**Multiple options (confidence 70–89%) — NO clarifying question:**
Here are the most relevant documents:

*1. [Document Name]*
🔗 [Open Document](url)
💡 _[Why relevant]_

*2. [Document Name]*
🔗 [Open Document](url)
💡 _[Why relevant]_

**Truly ambiguous (below 70%, query has zero specific context):**
🤔 [One short question — e.g. "Which product? (RMM, DSO, AllyAI, PRA?)"]

Use the catalog below for matching. Use the find_document or list_documents tools only if you cannot find a confident match from the catalog directly.

`;

const CATALOG_SUFFIX = `
## CRITICAL: No Process Narration
Never say "I will search", "Let me look", "I'm going to call a tool", etc. Return the formatted document response directly.`;

export class CatalogAgent {
    constructor(documentCatalog) {
        this.catalog = documentCatalog;
        this.mcpServer = null;
        this.systemPrompt = null;
    }

    /**
     * Build a compact catalog listing for the system prompt.
     * Format: name, type, products, competitors, URL, top keywords.
     */
    buildCompactCatalog() {
        const docs = this.catalog.catalog.documents;
        const lines = [`\n## COMPLETE DOCUMENT CATALOG (${docs.length} documents)\n`];

        docs.forEach((doc, i) => {
            const products = doc.productNames?.length ? ` | Products: ${doc.productNames.join(', ')}` : '';
            const competitors = doc.competitorNames?.length ? ` | Competitors: ${doc.competitorNames.join(', ')}` : '';
            const keywords = doc.searchQueries?.length
                ? `\n   Keywords: ${doc.searchQueries.slice(0, 3).join(' | ')}`
                : '';
            const url = doc.url ? `\n   URL: ${doc.url}` : '\n   URL: (no link)';
            const folder = doc.folderName
                ? `\n   Folder: ${doc.folderName}${doc.folderUrl ? ` (${doc.folderUrl})` : ''}`
                : '';
            const type = doc.documentType || 'unknown';

            lines.push(
                `${i + 1}. "${doc.name}" [${type}]${products}${competitors}${url}${folder}${keywords}\n`
            );
        });

        return lines.join('');
    }

    async initialize() {
        this.mcpServer = createCatalogMcpServer(this.catalog);
        this.systemPrompt = CATALOG_INSTRUCTIONS + this.buildCompactCatalog() + CATALOG_SUFFIX;
        console.log(`✅ CatalogAgent ready (${this.catalog.catalog.documents.length} docs in prompt)`);
    }

    async query(userQuestion, conversationContext = null) {
        if (!this.mcpServer) await this.initialize();

        const prompt = conversationContext
            ? `[Previous messages]\n${conversationContext}\n\n[Current request]\n${userQuestion}`
            : userQuestion;

        let finalAnswer = null;
        const toolsUsed = [];

        for await (const message of query({
            prompt,
            options: {
                systemPrompt: this.systemPrompt,
                mcpServers: { 'catalog-tools': this.mcpServer },
                allowedTools: [
                    'mcp__catalog-tools__find_document',
                    'mcp__catalog-tools__list_documents',
                    'mcp__catalog-tools__get_document_details',
                ],
                model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
                maxTurns: 3,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
            },
        })) {
            if (message.type === 'assistant') {
                for (const block of (message.message?.content || [])) {
                    if (block.type === 'tool_use') {
                        const name = block.name.split('__').pop();
                        if (name && !toolsUsed.includes(name)) toolsUsed.push(name);
                    }
                }
            }
            if ('result' in message) finalAnswer = message.result;
        }

        return {
            answer: finalAnswer || 'No response generated.',
            toolsUsed,
            agent: 'catalog',
        };
    }
}
