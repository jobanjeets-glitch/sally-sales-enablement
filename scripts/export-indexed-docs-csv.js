#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Export all indexed documents from Pinecone to CSV
 */
async function exportIndexedDocsCsv() {
    console.log('🗄️  Exporting indexed documents from Pinecone...\n');

    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const index = pc.index(process.env.PINECONE_INDEX_NAME);

    // Query multiple times with different queries to get better coverage
    console.log('📊 Querying Pinecone (this may take a minute)...');

    const queries = [
        'sales enablement training product documentation',
        'battlecard competitive analysis intelligence',
        'first call deck presentation customer',
        'pricing product box messaging framework',
        'case study report industry insights',
        'ally teammate copilot agent',
        'DSO RMM retail media management',
        'expert insights advisory training'
    ];

    const allMatches = [];

    for (let i = 0; i < queries.length; i++) {
        const queryEmbed = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: queries[i]
        });

        const results = await index.query({
            vector: queryEmbed.data[0].embedding,
            topK: 1000,
            includeMetadata: true
        });

        allMatches.push(...results.matches);
        console.log(`   Query ${i + 1}/${queries.length}: Found ${results.matches.length} chunks`);
    }

    console.log(`\n   Total chunks retrieved: ${allMatches.length}`);

    // Extract unique documents with metadata
    const docMap = new Map();

    for (const match of allMatches) {
        const metadata = match.metadata;
        const fileName = metadata['File.name'] || metadata.fileName;

        if (!fileName || fileName.length === 0) continue;

        if (!docMap.has(fileName)) {
            docMap.set(fileName, {
                name: fileName,
                url: metadata['File.webviewlink'] || metadata.url || '',
                fileId: metadata['File.id'] || metadata.fileId || '',
                blobType: metadata.blobType || '',
                createdDate: metadata['File.createdDate'] || '',
                modifiedDate: metadata['File.modifiedDate'] || '',
                chunkCount: 1,
                firstSeen: match.score
            });
        } else {
            // Increment chunk count
            docMap.get(fileName).chunkCount++;
        }
    }

    const documents = Array.from(docMap.values());
    console.log(`\n✅ Found ${documents.size} unique documents\n`);

    // Categorize documents
    for (const doc of documents) {
        let category = 'Other';

        if (doc.name.includes('Deck') || doc.name.includes('deck')) {
            category = 'Presentation/Deck';
        } else if (doc.name.includes('Battle Card') || doc.name.includes('Competitive')) {
            category = 'Battle Card';
        } else if (doc.name.includes('Case Study')) {
            category = 'Case Study';
        } else if (doc.name.includes('Training')) {
            category = 'Training Material';
        } else if (doc.name.includes('Framework') || doc.name.includes('Messaging')) {
            category = 'Framework/Messaging';
        } else if (doc.name.includes('Product Hub') || doc.name.includes('Product Box')) {
            category = 'Product Documentation';
        } else if (doc.name.includes('Industry') || doc.name.includes('Report') || doc.name.includes('Insights')) {
            category = 'Industry Report';
        } else if (doc.blobType?.includes('pdf')) {
            category = 'PDF Document';
        }

        doc.category = category;
    }

    // Sort by name
    documents.sort((a, b) => a.name.localeCompare(b.name));

    // Create CSV
    const rows = [
        ['Document Name', 'URL', 'File ID', 'Category', 'Chunk Count', 'Blob Type', 'Created Date', 'Modified Date']
    ];

    for (const doc of documents) {
        rows.push([
            doc.name,
            doc.url,
            doc.fileId,
            doc.category,
            doc.chunkCount,
            doc.blobType,
            doc.createdDate,
            doc.modifiedDate
        ]);
    }

    // Convert to CSV
    const csv = rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // Save
    await fs.writeFile('./query/indexed-documents.csv', csv);

    console.log('✅ Indexed documents CSV created!\n');
    console.log('📊 Summary by Category:\n');

    // Count by category
    const categoryCounts = {};
    for (const doc of documents) {
        categoryCounts[doc.category] = (categoryCounts[doc.category] || 0) + 1;
    }

    for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${cat}: ${count}`);
    }

    console.log(`\n📊 Total documents indexed: ${documents.length}`);
    console.log(`📦 Total chunks: ${allMatches.length}`);
    console.log(`📝 File saved to: query/indexed-documents.csv\n`);

    // Show sample
    console.log('📄 Sample (first 10 documents):');
    console.log('='.repeat(80));
    documents.slice(0, 10).forEach((doc, i) => {
        console.log(`${i + 1}. ${doc.name}`);
        console.log(`   Category: ${doc.category} | Chunks: ${doc.chunkCount}`);
        console.log(`   URL: ${doc.url || 'N/A'}`);
        console.log('');
    });
}

exportIndexedDocsCsv().catch(console.error);
