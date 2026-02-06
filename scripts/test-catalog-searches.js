#!/usr/bin/env node

import fs from 'fs/promises';

/**
 * Test catalog with real search queries
 */
async function testCatalogSearches() {
    console.log('🧪 Testing Enhanced Catalog with Real Queries\n');
    console.log('='.repeat(80) + '\n');

    // Load enhanced catalog
    const catalog = JSON.parse(await fs.readFile('./query/document-catalog-enhanced.json', 'utf-8'));

    // Real search queries salespeople might use
    const testQueries = [
        'sales agent product box',
        'CARS metrics',
        'AllyAI pricing',
        'copilot for amazon',
        'teammate training',
        'battle card',
        'first call deck',
        'ExpertIQ',
        'media teammate',
        'product success plan'
    ];

    for (const query of testQueries) {
        console.log(`\n🔍 Query: "${query}"`);
        console.log('-'.repeat(80));

        const matches = searchCatalog(catalog, query);

        if (matches.length === 0) {
            console.log('   ❌ No matches found\n');
            continue;
        }

        matches.slice(0, 3).forEach((match, i) => {
            console.log(`\n   ${i + 1}. ${match.name} (score: ${match.score})`);
            console.log(`      Match reasons: ${match.matchReasons.join(', ')}`);
        });

        console.log('');
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n✅ Testing complete!\n');
}

function searchCatalog(catalog, query) {
    const queryLower = query.toLowerCase();
    const matches = [];

    for (const doc of catalog.documents) {
        let score = 0;
        let matchReasons = [];

        // Name match
        if (doc.name.toLowerCase().includes(queryLower)) {
            score += 15;
            matchReasons.push('name-match');
        }

        // Detailed description match
        if (doc.detailedDescription?.toLowerCase().includes(queryLower)) {
            score += 12;
            matchReasons.push('description-match');
        }

        // Specific keywords match
        for (const keyword of doc.specificKeywords || []) {
            if (queryLower.includes(keyword.toLowerCase()) ||
                keyword.toLowerCase().includes(queryLower)) {
                score += 8;
                matchReasons.push(`keyword: ${keyword}`);
            }
        }

        // Searchable terms match
        for (const term of doc.searchableTerms || []) {
            if (queryLower.includes(term.toLowerCase()) ||
                term.toLowerCase().includes(queryLower)) {
                score += 10;
                matchReasons.push(`searchable: ${term}`);
            }
        }

        // Key features match
        for (const feature of doc.keyFeatures || []) {
            if (queryLower.includes(feature.toLowerCase())) {
                score += 7;
                matchReasons.push(`feature: ${feature}`);
            }
        }

        // Metrics match
        for (const metric of doc.metrics || []) {
            if (queryLower.includes(metric.toLowerCase())) {
                score += 9;
                matchReasons.push(`metric: ${metric}`);
            }
        }

        // Products match
        for (const product of doc.products || []) {
            if (queryLower.includes(product.toLowerCase())) {
                score += 7;
                matchReasons.push(`product: ${product}`);
            }
        }

        if (score > 0) {
            matches.push({
                name: doc.name,
                score,
                matchReasons: [...new Set(matchReasons)].slice(0, 5) // Remove duplicates
            });
        }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);
    return matches;
}

testCatalogSearches().catch(console.error);
