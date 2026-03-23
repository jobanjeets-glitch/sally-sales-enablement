/**
 * SallyAgent — orchestrator.
 *
 * Routes each query to the right specialist:
 *   'document'    → CatalogAgent    (document lookup, links)
 *   'information' → RAGAgent        (product info, proof points, competitive intel)
 *   'synthesis'   → SynthesisAgent  (pitches, emails, multi-source composition)
 */
import { PineconeClient } from '../query/pinecone-client.js';
import { DocumentCatalog } from '../query/document-catalog.js';
import { classifyIntent } from './router.js';
import { CatalogAgent } from './catalog-agent.js';
import { RAGAgent } from './rag-agent.js';
import { SynthesisAgent } from './synthesis-agent.js';
import dotenv from 'dotenv';

dotenv.config();

// Simple filter to catch any leaked tool reasoning that slips past the system prompt
const LEAK_PATTERNS = [
    /(?:I(?:'ll| will| am going to| am))\s+(?:search|use|call|check|query|look up|scan)\b[^.!?\n]*/gi,
    /(?:Let me|Let's)\s+(?:search|use|call|check|query|look up|scan)\b[^.!?\n]*/gi,
    /(?:Searching|Looking up|Calling|Using|Querying)\s+(?:the\s+)?(?:knowledge base|vector|catalog|database|tool)\b[^.!?\n]*/gi,
];

function filterLeakedReasoning(text) {
    if (!text) return text;
    let filtered = text;
    let changed = false;
    for (const pattern of LEAK_PATTERNS) {
        const next = filtered.replace(pattern, (match) => {
            console.warn(`[Sally] Filtered leaked reasoning: "${match.substring(0, 60)}..."`);
            changed = true;
            return '';
        });
        filtered = next;
    }
    if (changed) {
        filtered = filtered.replace(/\n{3,}/g, '\n\n').trim();
    }
    return filtered || text;
}

export class SallyAgent {
    constructor() {
        this.pineconeClient = new PineconeClient();
        this.catalog = new DocumentCatalog();
        this.catalogAgent = null;
        this.ragAgent = null;
        this.synthesisAgent = null;
        this.initialized = false;
    }

    async initialize() {
        await this.catalog.loadCatalog();
        this.catalogAgent = new CatalogAgent(this.catalog);
        this.ragAgent = new RAGAgent(this.pineconeClient);
        this.synthesisAgent = new SynthesisAgent(this.pineconeClient, this.catalog);

        await Promise.all([
            this.catalogAgent.initialize(),
            this.ragAgent.initialize(),
            this.synthesisAgent.initialize(),
        ]);

        this.initialized = true;
        console.log('✅ Sally v2 ready (Router + CatalogAgent + RAGAgent + SynthesisAgent)');
    }

    async query(userQuestion, conversationContext = null) {
        if (!this.initialized) await this.initialize();

        const intent = await classifyIntent(userQuestion);

        let result;
        switch (intent) {
            case 'document':
                result = await this.catalogAgent.query(userQuestion, conversationContext);
                break;
            case 'synthesis':
                result = await this.synthesisAgent.query(userQuestion, conversationContext);
                break;
            default:
                result = await this.ragAgent.query(userQuestion, conversationContext);
        }

        return {
            answer: filterLeakedReasoning(result.answer),
            toolsUsed: result.toolsUsed,
            agent: result.agent,
        };
    }
}
