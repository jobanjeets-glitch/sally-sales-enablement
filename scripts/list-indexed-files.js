/**
 * List all indexed files in Pinecone
 * Usage: npm run list-files
 */

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

async function listIndexedFiles() {
    console.log('\n📁 Listing all indexed files in Pinecone\n');

    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Get index stats first
    const stats = await index.describeIndexStats();
    console.log('Index: ' + process.env.PINECONE_INDEX_NAME);
    console.log('Total vectors: ' + stats.totalRecordCount);
    console.log('Namespaces:');
    for (const [ns, data] of Object.entries(stats.namespaces || {})) {
        console.log('  ' + (ns || '(default)') + ': ' + data.recordCount + ' vectors');
    }
    console.log('');

    // Query with various terms to discover files
    const searchTerms = [
        'sales', 'competitive', 'battle card', 'profitero', 'pacvue',
        'data impact', 'stackline', 'pricing', 'product', 'training',
        'deck', 'retail', 'media', 'amazon', 'copilot', 'ally',
        'ecommerce', 'digital shelf', 'optimization', 'report',
        'industry', 'category', 'brand', 'comparison', 'overview',
        'messaging', 'framework', 'RMM', 'DSO', 'DSA', 'ESM'
    ];

    const allFiles = new Map();

    console.log('Scanning index...');

    for (const term of searchTerms) {
        try {
            const response = await openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: term
            });

            const result = await index.query({
                vector: response.data[0].embedding,
                topK: 100,
                includeMetadata: true
            });

            result.matches?.forEach(m => {
                const name = m.metadata?.['File.name'] || m.metadata?.fileName || 'UNKNOWN';
                if (!allFiles.has(name)) {
                    allFiles.set(name, {
                        count: 1,
                        modifiedDate: m.metadata?.['File.modifiedDate'] || m.metadata?.modifiedTime || 'N/A',
                        weblink: m.metadata?.['File.webviewlink'] || m.metadata?.url || null
                    });
                } else {
                    allFiles.get(name).count++;
                }
            });
        } catch (e) {
            // Skip errors for individual terms
        }
    }

    // Sort alphabetically
    const sortedFiles = Array.from(allFiles.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
    );

    console.log('\n' + '═'.repeat(80));
    console.log('INDEXED FILES (' + sortedFiles.length + ' unique files)');
    console.log('═'.repeat(80) + '\n');

    sortedFiles.forEach(([name, info], i) => {
        console.log(String(i + 1).padStart(3) + '. ' + name);
        console.log('     Chunks: ~' + info.count + ' | Modified: ' + info.modifiedDate);
        if (info.weblink) {
            console.log('     Link: ' + info.weblink);
        }
        console.log('');
    });

    console.log('═'.repeat(80));
    console.log('Total: ' + sortedFiles.length + ' files | ' + stats.totalRecordCount + ' vectors');
    console.log('═'.repeat(80) + '\n');
}

listIndexedFiles().catch(console.error);
