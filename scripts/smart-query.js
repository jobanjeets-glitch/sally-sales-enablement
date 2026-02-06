#!/usr/bin/env node

import { SmartRouter } from '../query/smart-router.js';
import readline from 'readline';

/**
 * Interactive smart query testing
 * Tests the intelligent routing between document lookup and RAG
 */
async function main() {
    console.log('🎯 Smart Query Router - Interactive Testing\n');

    const router = new SmartRouter();

    // Check if catalog exists
    console.log('📚 Loading document catalog...');
    try {
        await router.catalog.loadCatalog();
        const stats = router.getCatalogStats();
        console.log(`✅ Catalog loaded: ${stats.totalDocuments} documents\n`);
    } catch (error) {
        console.log('⚠️  No catalog found. Run: npm run build-catalog first\n');
        process.exit(1);
    }

    // Test queries if provided as arguments
    const args = process.argv.slice(2);
    if (args.length > 0) {
        const query = args.join(' ');
        await testQuery(router, query);
        return;
    }

    // Interactive mode
    console.log('Examples:');
    console.log('  - "Show me the first call deck"');
    console.log('  - "Find Profitero battle card"');
    console.log('  - "What is AllyAI?"');
    console.log('  - "How does RMM differ from DSA?"\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const askQuestion = () => {
        rl.question('Enter query (or "exit" to quit): ', async (query) => {
            if (query.toLowerCase() === 'exit') {
                console.log('\nGoodbye! 👋\n');
                rl.close();
                return;
            }

            if (query.trim()) {
                await testQuery(router, query);
            }

            askQuestion();
        });
    };

    askQuestion();
}

async function testQuery(router, query) {
    console.log('\n' + '='.repeat(80) + '\n');

    try {
        const result = await router.query(query);

        console.log('📝 RESPONSE:\n');
        console.log(result.answer);

        console.log('\n' + '-'.repeat(80));
        console.log(`\n📊 Metadata:`);
        console.log(`   Type: ${result.type}`);
        console.log(`   Intent: ${result.intent.intent} (${result.intent.confidence})`);
        console.log(`   Confidence: ${result.confidence}`);

        if (result.type === 'document' && result.documents) {
            console.log(`   Documents Found: ${result.totalMatches}`);
        }

        if (result.citations) {
            console.log(`\n📚 Sources: ${result.citations.length} chunks retrieved`);
        }

        console.log('\n' + '='.repeat(80) + '\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.log('');
    }
}

main();
