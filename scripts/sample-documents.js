#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

async function sampleDocuments() {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const index = pc.index(process.env.PINECONE_INDEX_NAME);

    console.log('🔍 Sampling documents from Pinecone...\n');

    // Create a dummy embedding to query
    const dummyResponse = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: 'overview sales enablement product information'
    });

    const embedding = dummyResponse.data[0].embedding;

    // Query to get sample documents
    const results = await index.query({
        vector: embedding,
        topK: 100,
        includeMetadata: true
    });

    // Extract unique documents
    const docMap = new Map();
    for (const match of results.matches) {
        const fileName = match.metadata['File.name'] || match.metadata.fileName || 'Unknown';
        if (!docMap.has(fileName)) {
            docMap.set(fileName, {
                name: fileName,
                url: match.metadata['File.webviewlink'] || null,
                fileId: match.metadata['File.id'] || null,
                sampleChunks: [match.metadata.text || '']
            });
        } else {
            // Add more sample chunks
            const doc = docMap.get(fileName);
            if (doc.sampleChunks.length < 3) {
                doc.sampleChunks.push(match.metadata.text || '');
            }
        }
    }

    console.log(`✅ Found ${docMap.size} unique documents\n`);
    console.log('='.repeat(80) + '\n');

    // Show first 10 documents
    let count = 0;
    for (const [name, doc] of docMap.entries()) {
        if (count++ >= 10) break;

        console.log(`📄 Document ${count}: ${name}`);
        console.log(`   URL: ${doc.url || 'N/A'}`);
        console.log(`   File ID: ${doc.fileId || 'N/A'}`);
        console.log(`   Sample chunks: ${doc.sampleChunks.length}`);

        if (doc.sampleChunks[0]) {
            const preview = doc.sampleChunks[0].substring(0, 150).replace(/\n/g, ' ');
            console.log(`   Preview: ${preview}...`);
        }
        console.log('');
    }

    console.log('='.repeat(80));
    console.log(`\nTotal documents sampled: ${docMap.size}`);

    return Array.from(docMap.values());
}

sampleDocuments().catch(console.error);
