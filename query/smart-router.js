import { DocumentCatalog } from './document-catalog.js';
import { RAGProcessor } from './rag-processor.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Smart Query Router
 * Intelligently routes queries between document lookup and RAG
 */
export class SmartRouter {
    constructor() {
        this.catalog = new DocumentCatalog();
        this.ragProcessor = new RAGProcessor();
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    /**
     * Classify query intent
     * Returns: { intent: 'document' | 'information', confidence: number, reason: string }
     */
    async classifyIntent(query) {
        // Pattern-based detection (fast)
        const documentPatterns = [
            /(?:show|find|get|give|send|share|need)\s+(?:me|the)?\s*(?:a|an|the)?\s*(.+?)(?:deck|card|sheet|doc|document|file)/i,
            /(?:first|second|third|latest|updated?)\s+call\s+deck/i,
            /battle\s*card/i,
            /where\s+(?:is|can i find)\s+(?:the|a)/i,
            /do\s+(?:we|you)\s+have\s+(?:a|an|the)/i,
            /link\s+(?:to|for)/i,
            /product\s+(?:hub|box)/i
        ];

        for (const pattern of documentPatterns) {
            if (pattern.test(query)) {
                return {
                    intent: 'document',
                    confidence: 0.9,
                    reason: 'Pattern match: query is requesting a document'
                };
            }
        }

        // Information patterns
        const informationPatterns = [
            /(?:what|how|why|when|who)\s+/i,
            /(?:explain|describe|tell me about)/i,
            /(?:difference between|compare)/i,
            /(?:pricing|cost|price)\s+(?:for|of)/i
        ];

        for (const pattern of informationPatterns) {
            if (pattern.test(query)) {
                return {
                    intent: 'information',
                    confidence: 0.8,
                    reason: 'Pattern match: query is asking for information'
                };
            }
        }

        // Use GPT-4 for ambiguous cases
        return await this.classifyWithGPT(query);
    }

    /**
     * Use GPT-4 to classify intent for ambiguous queries
     */
    async classifyWithGPT(query) {
        const prompt = `Classify this sales enablement query into one of two intents:

Query: "${query}"

Intent Types:
1. "document" - User wants to find/get a specific document, deck, file, or battlecard
2. "information" - User wants to learn information, get answers, or understand concepts

Respond with JSON:
{
  "intent": "document" | "information",
  "confidence": 0.0-1.0,
  "reason": "brief explanation"
}`;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a query classification assistant. Classify user queries accurately.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            });

            return JSON.parse(response.choices[0].message.content);

        } catch (error) {
            console.error('Error classifying with GPT:', error.message);
            // Default to information query
            return {
                intent: 'information',
                confidence: 0.5,
                reason: 'Fallback: classification failed'
            };
        }
    }

    /**
     * Main query routing method
     */
    async query(question) {
        console.log(`\n🎯 Smart Router: "${question}"`);

        // 1. Classify intent
        const classification = await this.classifyIntent(question);
        console.log(`📊 Intent: ${classification.intent} (confidence: ${classification.confidence})`);
        console.log(`   Reason: ${classification.reason}\n`);

        // 2. Route based on intent
        if (classification.intent === 'document') {
            return await this.handleDocumentQuery(question, classification);
        } else {
            return await this.handleInformationQuery(question, classification);
        }
    }

    /**
     * Handle document-seeking queries using the catalog
     */
    async handleDocumentQuery(question, classification) {
        console.log('📁 Using Document Catalog...\n');

        // Load catalog if not loaded
        await this.catalog.loadCatalog();

        // Find matching documents
        const matches = await this.catalog.findDocuments(question);

        if (matches.length === 0) {
            return {
                type: 'document',
                intent: classification,
                answer: "I couldn't find any documents matching your request. Here are all available document types:\n" +
                    this.getDocumentTypesList(),
                documents: [],
                confidence: 'none'
            };
        }

        // Format response
        const topMatches = matches.slice(0, 5);
        let answer = `I found ${matches.length} document${matches.length > 1 ? 's' : ''} matching your request:\n\n`;

        topMatches.forEach((doc, idx) => {
            answer += `${idx + 1}. **${doc.name}**\n`;
            answer += `   Type: ${doc.documentType || doc.type || 'N/A'}\n`;
            answer += `   Purpose: ${doc.documentPurpose || doc.purpose || 'N/A'}\n`;
            if (doc.url) {
                answer += `   Link: ${doc.url}\n`;
            }
            answer += '\n';
        });

        return {
            type: 'document',
            intent: classification,
            answer: answer.trim(),
            documents: topMatches,
            totalMatches: matches.length,
            confidence: topMatches[0].score > 10 ? 'high' : topMatches[0].score > 5 ? 'medium' : 'low'
        };
    }

    /**
     * Handle information-seeking queries using RAG
     */
    async handleInformationQuery(question, classification) {
        console.log('🔍 Using RAG Search...\n');

        // Use the existing RAG processor
        const ragResult = await this.ragProcessor.query(question, 10);

        return {
            type: 'information',
            intent: classification,
            ...ragResult
        };
    }

    /**
     * Get hybrid results (both documents and information)
     * Useful for queries that might benefit from both
     */
    async queryHybrid(question) {
        console.log(`\n🔀 Hybrid Query: "${question}"\n`);

        const [documentResults, ragResults] = await Promise.all([
            this.catalog.loadCatalog().then(() => this.catalog.findDocuments(question)),
            this.ragProcessor.query(question, 5)
        ]);

        return {
            type: 'hybrid',
            documents: documentResults.slice(0, 3),
            information: ragResults,
            answer: this.formatHybridResponse(documentResults, ragResults)
        };
    }

    /**
     * Format hybrid response
     */
    formatHybridResponse(documents, ragResult) {
        let response = '';

        // Add relevant documents
        if (documents.length > 0) {
            response += '📄 **Relevant Documents:**\n\n';
            documents.slice(0, 3).forEach((doc, idx) => {
                response += `${idx + 1}. **${doc.name}**\n`;
                if (doc.url) response += `   ${doc.url}\n`;
                response += '\n';
            });
        }

        // Add information from RAG
        if (ragResult.answer) {
            response += '\n💡 **Information:**\n\n';
            response += ragResult.answer;
        }

        return response;
    }

    /**
     * Get list of document types for suggestions
     */
    getDocumentTypesList() {
        const stats = this.catalog.getCatalogStats();
        if (!stats) return '';

        let list = '\n';
        for (const [type, count] of Object.entries(stats.typeBreakdown)) {
            list += `- ${type}: ${count} document${count > 1 ? 's' : ''}\n`;
        }
        return list;
    }

    /**
     * Refresh the document catalog
     */
    async refreshCatalog() {
        console.log('🔄 Refreshing document catalog...\n');
        return await this.catalog.buildCatalog();
    }

    /**
     * Get catalog statistics
     */
    getCatalogStats() {
        return this.catalog.getCatalogStats();
    }
}
