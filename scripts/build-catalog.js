#!/usr/bin/env node

import { DocumentCatalog } from '../query/document-catalog.js';

/**
 * Build the document catalog
 * This scans all documents in Pinecone and characterizes them
 * Run this whenever you add new documents to the index
 */
async function main() {
    console.log('🚀 Building Document Catalog\n');
    console.log('This will scan all documents in Pinecone and characterize them.');
    console.log('This may take a few minutes depending on the number of documents.\n');

    const catalog = new DocumentCatalog();

    try {
        const result = await catalog.buildCatalog();

        console.log('\n✅ Catalog Build Complete!\n');
        console.log('📊 Statistics:');
        console.log(`   Total Documents: ${result.totalDocuments}`);
        console.log(`   Last Updated: ${result.lastUpdated}\n`);

        // Show breakdown by type
        const typeBreakdown = {};
        result.documents.forEach(doc => {
            typeBreakdown[doc.type] = (typeBreakdown[doc.type] || 0) + 1;
        });

        console.log('📁 Document Types:');
        for (const [type, count] of Object.entries(typeBreakdown)) {
            console.log(`   ${type}: ${count}`);
        }

        console.log('\n🎯 Sample Characterizations:');
        result.documents.slice(0, 3).forEach(doc => {
            console.log(`\n   📄 ${doc.name}`);
            console.log(`      Type: ${doc.type}`);
            console.log(`      Keywords: ${doc.keywords.join(', ')}`);
            if (doc.aliases.length > 0) {
                console.log(`      Aliases: ${doc.aliases.join(', ')}`);
            }
        });

        console.log('\n✨ Catalog is ready to use!');
        console.log('   Run: npm run smart-query to test intelligent routing\n');

    } catch (error) {
        console.error('\n❌ Error building catalog:', error.message);
        process.exit(1);
    }
}

main();
