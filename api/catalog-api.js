#!/usr/bin/env node

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const CATALOG_PATH = path.join(process.cwd(), 'query', 'document-catalog.json');

/**
 * Load catalog from disk
 */
async function loadCatalog() {
    try {
        const data = await fs.readFile(CATALOG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading catalog:', error.message);
        return null;
    }
}

/**
 * Search catalog for matching documents
 */
function searchCatalog(catalog, query) {
    if (!catalog) return [];

    const queryLower = query.toLowerCase();
    const matches = [];

    for (const doc of catalog.documents) {
        let score = 0;
        let matchReasons = [];

        // Name match
        if (doc.name.toLowerCase().includes(queryLower)) {
            score += 10;
            matchReasons.push('name-match');
        }

        // Keyword match
        for (const keyword of doc.keywords) {
            if (queryLower.includes(keyword.toLowerCase()) ||
                keyword.toLowerCase().includes(queryLower)) {
                score += 5;
                matchReasons.push(`keyword: ${keyword}`);
            }
        }

        // Alias match
        for (const alias of doc.aliases) {
            if (queryLower.includes(alias.toLowerCase()) ||
                alias.toLowerCase().includes(queryLower)) {
                score += 8;
                matchReasons.push(`alias: ${alias}`);
            }
        }

        // Type match
        if (queryLower.includes(doc.type.replace('-', ' '))) {
            score += 3;
            matchReasons.push('type-match');
        }

        // Product match
        for (const product of doc.products || []) {
            if (queryLower.includes(product.toLowerCase())) {
                score += 6;
                matchReasons.push(`product: ${product}`);
            }
        }

        // Competitor match
        for (const competitor of doc.competitors || []) {
            if (queryLower.includes(competitor.toLowerCase())) {
                score += 7;
                matchReasons.push(`competitor: ${competitor}`);
            }
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

// ==================== API ENDPOINTS ====================

/**
 * GET /health - Health check
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'catalog-api' });
});

/**
 * GET /api/catalog - Get full catalog
 */
app.get('/api/catalog', async (req, res) => {
    try {
        const catalog = await loadCatalog();
        if (!catalog) {
            return res.status(500).json({ error: 'Catalog not found' });
        }
        res.json(catalog);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/catalog/stats - Get catalog statistics
 */
app.get('/api/catalog/stats', async (req, res) => {
    try {
        const catalog = await loadCatalog();
        if (!catalog) {
            return res.status(500).json({ error: 'Catalog not found' });
        }

        const stats = {
            totalDocuments: catalog.totalDocuments,
            lastUpdated: catalog.lastUpdated,
            typeBreakdown: {},
            categoryBreakdown: {},
            productsList: new Set(),
            competitorsList: new Set()
        };

        for (const doc of catalog.documents) {
            stats.typeBreakdown[doc.type] = (stats.typeBreakdown[doc.type] || 0) + 1;
            stats.categoryBreakdown[doc.category] = (stats.categoryBreakdown[doc.category] || 0) + 1;

            doc.products?.forEach(p => stats.productsList.add(p));
            doc.competitors?.forEach(c => stats.competitorsList.add(c));
        }

        stats.productsList = Array.from(stats.productsList);
        stats.competitorsList = Array.from(stats.competitorsList);

        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/catalog/search - Search catalog
 * Body: { query: "search query", topK: 5 }
 */
app.post('/api/catalog/search', async (req, res) => {
    try {
        const { query, topK = 5 } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }

        const catalog = await loadCatalog();
        if (!catalog) {
            return res.status(500).json({ error: 'Catalog not found' });
        }

        const matches = searchCatalog(catalog, query);
        const topMatches = matches.slice(0, topK);

        res.json({
            query,
            totalMatches: matches.length,
            topK: topMatches.length,
            results: topMatches.map(doc => ({
                name: doc.name,
                url: doc.url,
                type: doc.type,
                purpose: doc.purpose,
                score: doc.score,
                matchReasons: doc.matchReasons,
                keywords: doc.keywords,
                products: doc.products,
                competitors: doc.competitors
            }))
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/catalog/documents/:name - Get specific document
 */
app.get('/api/catalog/documents/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const catalog = await loadCatalog();

        if (!catalog) {
            return res.status(500).json({ error: 'Catalog not found' });
        }

        const doc = catalog.documents.find(d =>
            d.name.toLowerCase() === name.toLowerCase()
        );

        if (!doc) {
            return res.status(404).json({ error: 'Document not found' });
        }

        res.json(doc);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/catalog/refresh - Trigger catalog rebuild (webhook)
 */
app.post('/api/catalog/refresh', async (req, res) => {
    try {
        // In a real implementation, this would trigger the catalog rebuild
        // For now, just return a success message
        res.json({
            message: 'Catalog refresh triggered',
            note: 'Run: npm run build-catalog to rebuild'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start server
const PORT = process.env.CATALOG_API_PORT || 3002;

app.listen(PORT, () => {
    console.log('\n🚀 Catalog API Server Started\n');
    console.log(`📡 Listening on: http://localhost:${PORT}`);
    console.log('\n📚 Available Endpoints:');
    console.log(`   GET  /health                    - Health check`);
    console.log(`   GET  /api/catalog               - Get full catalog`);
    console.log(`   GET  /api/catalog/stats         - Get catalog stats`);
    console.log(`   POST /api/catalog/search        - Search catalog`);
    console.log(`   GET  /api/catalog/documents/:id - Get specific document`);
    console.log(`   POST /api/catalog/refresh       - Trigger catalog rebuild`);
    console.log('\n💡 Example Usage:');
    console.log(`   curl http://localhost:${PORT}/api/catalog/stats`);
    console.log(`   curl -X POST http://localhost:${PORT}/api/catalog/search -H "Content-Type: application/json" -d '{"query": "AllyAI"}'`);
    console.log('');
});

export default app;
