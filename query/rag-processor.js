import OpenAI from 'openai';
import { PineconeClient } from './pinecone-client.js';
import dotenv from 'dotenv';

dotenv.config();

export class RAGProcessor {
    constructor() {
        this.pineconeClient = new PineconeClient();
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.model = 'gpt-4';

        // Product abbreviations mapping
        this.abbreviations = {
            'DSA': 'Digital Shelf Analytics',
            'DSO': 'Digital Shelf Optimization',
            'AC': 'Amazon Copilot CommerceIQ Copilot',
            'RMM': 'Retail Media Management',
            'OCC': 'Omnichannel Command Center',
            'MS': 'Market Share',
            'PRA': 'Profit Recovery Automation',
            'MI': 'Market Insights',
            'Ally': 'AllyAI agentic'
        };
    }

    /**
     * Expand query with abbreviations for better retrieval
     */
    expandQuery(query) {
        let expandedQuery = query;

        // Expand known abbreviations
        for (const [abbr, expansion] of Object.entries(this.abbreviations)) {
            // Match abbreviation as whole word (case insensitive)
            const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
            if (regex.test(expandedQuery)) {
                expandedQuery = expandedQuery + ' ' + expansion;
            }
        }

        return expandedQuery;
    }

    /**
     * Process a query with strict RAG - only answer from documents
     * @param {string} question - User's question
     * @param {number} topK - Number of chunks to retrieve
     * @returns {object} - {answer, citations, confidence}
     */
    async query(question, topK = 10) {
        console.log(`\n📝 Query: "${question}"`);

        // Expand query with abbreviations
        const expandedQuestion = this.expandQuery(question);
        if (expandedQuestion !== question) {
            console.log(`🔄 Expanded: "${expandedQuestion}"`);
        }

        console.log(`🔍 Retrieving top ${topK} relevant chunks...`);

        try {
            // 1. Retrieve relevant chunks from Pinecone using expanded query
            const matches = await this.pineconeClient.query(expandedQuestion, topK);

            if (!matches || matches.length === 0) {
                return {
                    answer: "I don't have any information about that in my knowledge base. Please ask about topics covered in our sales enablement documentation.",
                    citations: [],
                    confidence: 'none'
                };
            }

            console.log(`✅ Found ${matches.length} relevant chunks`);

            // 2. Format context with citations
            const contextParts = matches.map((match, idx) => {
                const metadata = match.metadata;
                // Adapt to n8n metadata structure
                const fileName = metadata.fileName || metadata['File.name'] || metadata.source || 'Unknown';
                const pageInfo = metadata.pageNumber || metadata.chunkIndex || metadata['loc.lines.from'] || 'N/A';
                const url = metadata['File.webviewlink'] || metadata.url || null;

                return {
                    index: idx + 1,
                    text: metadata.text,
                    source: fileName,
                    page: pageInfo,
                    score: match.score,
                    url: url,
                    metadata: metadata
                };
            });

            // 3. Build context string for LLM
            const contextString = contextParts.map(part =>
                `[Source ${part.index}: ${part.source}, Page ${part.page}]\n${part.text}`
            ).join('\n\n---\n\n');

            console.log(`📚 Context built from ${contextParts.length} sources`);

            // 4. Create strict RAG prompt with product/folder context
            const systemPrompt = `You are Sally, a helpful sales enablement assistant. Your ONLY job is to answer questions using EXCLUSIVELY the information provided in the context below.

PRODUCT KNOWLEDGE (use to understand abbreviations and redirect searches):
- DSA/DSO = Digital Shelf Analytics/Optimization
- AC = Amazon Copilot = CommerceIQ Copilot for Amazon
- RMM = Retail Media Management
- OCC = Omnichannel Command Center
- MS = Market Share
- PRA = Profit Recovery Automation
- MI = Market Insights
- AllyAI/Ally = AllyAI agentic offerings (Sales/Media/Category teammates)

KEY DOCUMENTS TO PRIORITIZE:
- "First Call Deck - Retail AI" → Latest pitch deck for prospects
- "AllyAI Product Hub" → Start here for ANY AllyAI questions
- "CommerceIQ Copilot for Amazon - Product Box" → Start here for ANY Copilot questions

STRICT RULES:
1. ONLY use information explicitly stated in the provided context
2. If the answer is not in the context, respond with: "I don't have that information in my knowledge base. Please contact the sales enablement team for help with this question."
3. ALWAYS cite your sources using [Source X] notation when providing information
4. Do not make assumptions or infer information not explicitly stated
5. Do not use your general knowledge - ONLY use the provided context
6. Be concise and direct - answer the specific question asked
7. If multiple sources say the same thing, cite all relevant sources
8. When asked for a document or link, look at the SOURCE FILE NAMES in the context - they tell you which document the information is from. If a source name matches what the user is asking for, that's likely the right document to reference.
9. NEVER ask clarifying questions. If the user asks for a document, return the best match directly. If multiple documents could match, list all of them with their links.

Context:
${contextString}`;

            const userPrompt = `Question: ${question}

Remember: Only answer based on the context provided above. Cite sources using [Source X] format.`;

            // 5. Get answer from LLM
            console.log('🤖 Generating answer with GPT-4...');

            const response = await this.openai.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.1, // Low temperature for factual responses
                max_tokens: 500
            });

            const answer = response.choices[0].message.content;

            // 6. Extract citations from sources used
            const citations = contextParts.map(part => ({
                source: part.source,
                page: part.page,
                relevanceScore: Math.round(part.score * 100) / 100,
                url: part.url
            }));

            // 7. Determine confidence based on relevance scores
            const avgScore = contextParts.reduce((sum, p) => sum + p.score, 0) / contextParts.length;
            let confidence;
            if (avgScore > 0.8) confidence = 'high';
            else if (avgScore > 0.6) confidence = 'medium';
            else confidence = 'low';

            console.log(`✅ Answer generated (confidence: ${confidence})\n`);

            return {
                answer,
                citations,
                confidence,
                relevanceScores: contextParts.map(p => p.score)
            };

        } catch (error) {
            console.error('❌ Error processing query:', error.message);
            throw error;
        }
    }

    /**
     * Query with conversation history (for multi-turn conversations)
     */
    async queryWithHistory(question, conversationHistory = [], topK = 5) {
        // For now, just use the current question
        // In future, could use history to provide better context
        return await this.query(question, topK);
    }
}
