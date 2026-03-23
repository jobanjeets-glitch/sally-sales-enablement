#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const FILE_NAME = 'First Call Deck - Agentic Commerce';

async function checkPineconeFile() {
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

    console.log(`Searching Pinecone for: "${FILE_NAME}"\n`);

    // Try to find vectors with this file name
    const results = await index.query({
        vector: new Array(3072).fill(0),
        topK: 100,
        filter: { 'File.name': { $eq: FILE_NAME } },
        includeMetadata: true
    });

    if (results.matches.length === 0) {
        console.log('❌ No vectors found in Pinecone for this file!');
        return;
    }

    console.log(`✅ Found ${results.matches.length} vectors for this file\n`);

    const firstMatch = results.matches[0];
    console.log('Metadata from first vector:');
    console.log(JSON.stringify(firstMatch.metadata, null, 2));
    console.log();

    // Get unique metadata values across all vectors
    const uniqueMetadata = {
        fileIds: new Set(),
        modifiedDates: new Set(),
        syncDates: new Set(),
        versions: new Set(),
        sizes: new Set()
    };

    for (const match of results.matches) {
        if (match.metadata['File.id']) uniqueMetadata.fileIds.add(match.metadata['File.id']);
        if (match.metadata['File.modifiedDate']) uniqueMetadata.modifiedDates.add(match.metadata['File.modifiedDate']);
        if (match.metadata['File.lastSyncDate']) uniqueMetadata.syncDates.add(match.metadata['File.lastSyncDate']);
        if (match.metadata['File.version']) uniqueMetadata.versions.add(match.metadata['File.version']);
        if (match.metadata['File.size']) uniqueMetadata.sizes.add(match.metadata['File.size']);
    }

    console.log('Summary across all vectors:');
    console.log(`  Unique File.id values: ${Array.from(uniqueMetadata.fileIds).join(', ') || 'None'}`);
    console.log(`  Unique modified dates: ${Array.from(uniqueMetadata.modifiedDates).join(', ')}`);
    console.log(`  Unique sync dates: ${Array.from(uniqueMetadata.syncDates).join(', ') || 'None'}`);
    console.log(`  Unique versions: ${Array.from(uniqueMetadata.versions).join(', ') || 'None'}`);
    console.log(`  Unique sizes: ${Array.from(uniqueMetadata.sizes).join(', ') || 'None'}`);
    console.log();

    // Show first 3 text chunks
    console.log('First 3 text chunks (200 chars each):');
    results.matches.slice(0, 3).forEach((match, i) => {
        console.log(`\nChunk ${i + 1}:`);
        console.log(match.metadata.text ? match.metadata.text.substring(0, 200) : 'No text');
    });
}

checkPineconeFile().catch(console.error);
