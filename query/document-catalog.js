import { PineconeClient } from './pinecone-client.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

/**
 * Document Catalog System
 * Pre-processes and characterizes all documents in the index
 * Provides intelligent document lookup without real-time search
 */
export class DocumentCatalog {
    constructor() {
        this.pineconeClient = new PineconeClient();
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.catalogPath = path.join(process.cwd(), 'query', 'document-catalog-identity-focused.json');
        this.catalog = null;
    }

    /**
     * Build or refresh the document catalog
     * Scans all documents and characterizes them
     */
    async buildCatalog() {
        console.log('🏗️  Building document catalog...\n');

        try {
            // 1. Get all unique documents from Pinecone
            const documents = await this.getUniqueDocuments();
            console.log(`📚 Found ${documents.length} unique documents\n`);

            // 2. Characterize each document using GPT-4
            const catalog = {
                lastUpdated: new Date().toISOString(),
                totalDocuments: documents.length,
                documents: []
            };

            for (const doc of documents) {
                console.log(`🔍 Characterizing: ${doc.name}`);
                const characterization = await this.characterizeDocument(doc);
                catalog.documents.push(characterization);
                console.log(`   Type: ${characterization.type}`);
                console.log(`   Keywords: ${characterization.keywords.join(', ')}\n`);
            }

            // 3. Save catalog to disk
            await fs.writeFile(this.catalogPath, JSON.stringify(catalog, null, 2));
            console.log(`✅ Catalog saved to ${this.catalogPath}\n`);

            this.catalog = catalog;
            return catalog;

        } catch (error) {
            console.error('❌ Error building catalog:', error.message);
            throw error;
        }
    }

    /**
     * Load catalog from disk
     */
    async loadCatalog() {
        try {
            const data = await fs.readFile(this.catalogPath, 'utf-8');
            this.catalog = JSON.parse(data);
            console.log(`✅ Loaded catalog with ${this.catalog.totalDocuments} documents`);
            return this.catalog;
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('📝 No catalog found. Building new catalog...');
                return await this.buildCatalog();
            }
            throw error;
        }
    }

    /**
     * Get all unique documents from Pinecone
     */
    async getUniqueDocuments() {
        // Query Pinecone with a generic vector to get sample of all documents
        const dummyQuery = "overview summary";
        const matches = await this.pineconeClient.query(dummyQuery, 1000);

        // Extract unique documents by File.name or fileName
        const docMap = new Map();

        for (const match of matches) {
            const metadata = match.metadata;
            const fileName = metadata['File.name'] || metadata.fileName || 'Unknown';
            const url = metadata['File.webviewlink'] || metadata.url || null;
            const fileId = metadata['File.id'] || null;

            if (!docMap.has(fileName)) {
                docMap.set(fileName, {
                    name: fileName,
                    url: url,
                    fileId: fileId,
                    sampleChunks: [metadata.text]
                });
            } else {
                // Add more sample chunks
                const doc = docMap.get(fileName);
                if (doc.sampleChunks.length < 5) {
                    doc.sampleChunks.push(metadata.text);
                }
            }
        }

        return Array.from(docMap.values());
    }

    /**
     * Characterize a document using GPT-4
     * Returns: type, purpose, keywords, aliases, target audience
     */
    async characterizeDocument(doc) {
        const prompt = `Analyze this document and provide a structured characterization.

Document Name: ${doc.name}

Sample Content:
${doc.sampleChunks.slice(0, 3).join('\n\n---\n\n')}

Provide a JSON response with:
{
  "type": "pitch-deck | battlecard | product-documentation | pricing-sheet | case-study | training-material | other",
  "purpose": "brief description of document purpose",
  "keywords": ["keyword1", "keyword2", ...], // terms users might search for
  "aliases": ["alternative name 1", ...], // other ways users might refer to this
  "category": "sales-enablement | competitive-intel | product-info | customer-success | other",
  "targetAudience": "who this document is for",
  "competitors": ["competitor1", ...] // if battlecard, list competitors mentioned
}

Focus on making keywords and aliases reflect how salespeople actually search:
- "first call deck" for initial pitch decks
- "second call deck" for follow-up presentations
- "[Competitor] battle card" for competitive docs
- Product abbreviations (DSA, RMM, AC, etc.)`;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a document classification assistant. Analyze sales enablement documents and return structured JSON characterizations.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                response_format: { type: "json_object" }
            });

            const characterization = JSON.parse(response.choices[0].message.content);

            return {
                name: doc.name,
                url: doc.url,
                fileId: doc.fileId,
                ...characterization
            };

        } catch (error) {
            console.error(`Error characterizing ${doc.name}:`, error.message);
            // Return basic characterization
            return {
                name: doc.name,
                url: doc.url,
                fileId: doc.fileId,
                type: 'other',
                purpose: 'Unknown',
                keywords: [],
                aliases: [],
                category: 'other',
                targetAudience: 'Unknown',
                competitors: []
            };
        }
    }

    /**
     * Find documents matching a query using the catalog
     * This is the intelligent lookup - no vector search needed
     */
    async findDocuments(query) {
        if (!this.catalog) {
            await this.loadCatalog();
        }

        const queryLower = query.toLowerCase();
        const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
        const matches = [];

        for (const doc of this.catalog.documents) {
            let score = 0;
            let matchReasons = [];

            // Exact name match (highest priority)
            if (doc.name.toLowerCase().includes(queryLower)) {
                score += 20;
                matchReasons.push('name-match');
            }

            // Partial word match on name
            for (const word of queryWords) {
                if (doc.name.toLowerCase().includes(word)) {
                    score += 3;
                    matchReasons.push(`name-word: ${word}`);
                }
            }

            // documentType match (e.g. "second-call-deck", "battle-card")
            const docType = (doc.documentType || '').toLowerCase().replace(/-/g, ' ');
            if (docType && queryLower.includes(docType)) {
                score += 5;
                matchReasons.push(`type: ${doc.documentType}`);
            }

            // searchQueries match (replaces old keywords/aliases)
            for (const sq of doc.searchQueries || []) {
                const sqLower = sq.toLowerCase();
                if (queryLower.includes(sqLower) || sqLower.includes(queryLower)) {
                    score += 8;
                    matchReasons.push(`searchQuery: ${sq}`);
                    break; // one match from searchQueries is enough
                }
                // partial word overlap
                const sqWords = sqLower.split(/\s+/);
                const overlap = queryWords.filter(w => sqWords.includes(w)).length;
                if (overlap >= 2) {
                    score += overlap * 2;
                    matchReasons.push(`query-overlap(${overlap}): ${sq}`);
                    break;
                }
            }

            // productNames match
            for (const product of doc.productNames || []) {
                if (queryLower.includes(product.toLowerCase())) {
                    score += 4;
                    matchReasons.push(`product: ${product}`);
                }
            }

            // competitorNames match
            for (const competitor of doc.competitorNames || []) {
                if (queryLower.includes(competitor.toLowerCase())) {
                    score += 7;
                    matchReasons.push(`competitor: ${competitor}`);
                }
            }

            // documentIdentity substring match
            if ((doc.documentIdentity || '').toLowerCase().includes(queryLower)) {
                score += 6;
                matchReasons.push('identity-match');
            }

            if (score > 0) {
                matches.push({
                    ...doc,
                    score,
                    matchReasons
                });
            }
        }

        // Sort by score descending
        matches.sort((a, b) => b.score - a.score);

        return matches;
    }

    /**
     * Get catalog statistics
     */
    getCatalogStats() {
        if (!this.catalog) {
            return null;
        }

        const stats = {
            totalDocuments: this.catalog.totalDocuments,
            lastUpdated: this.catalog.lastUpdated,
            typeBreakdown: {},
            categoryBreakdown: {}
        };

        for (const doc of this.catalog.documents) {
            const type = doc.documentType || doc.type || 'other';
            stats.typeBreakdown[type] = (stats.typeBreakdown[type] || 0) + 1;
        }

        return stats;
    }
}
