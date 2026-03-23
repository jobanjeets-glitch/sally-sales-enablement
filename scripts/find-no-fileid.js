#!/usr/bin/env node
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX_NAME);

const result = await index.query({
    vector: new Array(3072).fill(0),
    topK: 10000,
    includeMetadata: true
});

const noFileId = new Map();
for (const m of result.matches) {
    const name = m.metadata['File.name'] || 'unknown';
    const hasId = m.metadata['File.id'] ? true : false;
    if (hasId === false) {
        noFileId.set(name, (noFileId.get(name) || 0) + 1);
    }
}

console.log('Documents with NO File.id:', noFileId.size);
const sorted = [...noFileId.entries()].sort((a, b) => b[1] - a[1]);
for (const [name, count] of sorted) {
    console.log(count + ' vectors - ' + name);
}
