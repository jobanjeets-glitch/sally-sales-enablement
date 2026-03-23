import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

export class PineconeClient {
    constructor() {
        // Initialize Pinecone
        this.pinecone = new Pinecone({
            apiKey: process.env.PINECONE_API_KEY
        });

        this.indexName = process.env.PINECONE_INDEX_NAME || 'sally-sales-enablement';
        this.index = this.pinecone.index(this.indexName);

        // Initialize OpenAI for embeddings
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        this.embeddingModel = 'text-embedding-3-large'; // 3072 dimensions (matching n8n)
    }

    /**
     * Create embedding for a text using OpenAI
     */
    async createEmbedding(text) {
        try {
            const response = await this.openai.embeddings.create({
                model: this.embeddingModel,
                input: text
            });

            return response.data[0].embedding;
        } catch (error) {
            console.error('Error creating embedding:', error.message);
            throw error;
        }
    }

    /**
     * Upsert vectors to Pinecone
     * @param {Array} vectors - Array of {id, values, metadata}
     */
    async upsertVectors(vectors) {
        try {
            const batchSize = 100; // Pinecone batch limit

            for (let i = 0; i < vectors.length; i += batchSize) {
                const batch = vectors.slice(i, i + batchSize);
                await this.index.upsert(batch);
                console.log(`✅ Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)}`);
            }

            return { success: true, count: vectors.length };
        } catch (error) {
            console.error('Error upserting vectors:', error.message);
            throw error;
        }
    }

    /**
     * Query similar vectors from Pinecone
     * @param {string} queryText - The query text
     * @param {number} topK - Number of results to return
     * @param {object} filter - Optional metadata filter
     */
    async query(queryText, topK = 5, filter = null) {
        try {
            // Create embedding for query
            const queryEmbedding = await this.createEmbedding(queryText);

            // Query Pinecone
            const queryOptions = {
                vector: queryEmbedding,
                topK: topK,
                includeMetadata: true
            };

            if (filter) {
                queryOptions.filter = filter;
            }

            const results = await this.index.query(queryOptions);

            return results.matches || [];
        } catch (error) {
            console.error('Error querying vectors:', error.message);
            throw error;
        }
    }

    /**
     * Delete vectors by IDs
     */
    async deleteVectors(ids) {
        try {
            await this.index.deleteMany(ids);
            console.log(`🗑️  Deleted ${ids.length} vectors`);
            return { success: true, count: ids.length };
        } catch (error) {
            console.error('Error deleting vectors:', error.message);
            throw error;
        }
    }

    /**
     * Delete all vectors (use with caution!)
     */
    async deleteAll() {
        try {
            await this.index.deleteAll();
            console.log('🗑️  Deleted all vectors from index');
            return { success: true };
        } catch (error) {
            console.error('Error deleting all vectors:', error.message);
            throw error;
        }
    }

    /**
     * Get index statistics
     */
    async getStats() {
        try {
            const stats = await this.index.describeIndexStats();
            return stats;
        } catch (error) {
            console.error('Error getting stats:', error.message);
            throw error;
        }
    }
}
