#!/usr/bin/env node
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX_NAME);

const filesToDelete = [
    'CommerceIQ Copilot for Amazon - Product Features ',
    'CommerceIQ Copilot for Amazon - Product Features',
    'CommerceIQ Copilot for Amazon - Second Call Deck'
];

const result = await index.query({
    vector: new Array(3072).fill(0),
    topK: 10000,
    includeMetadata: true
});

const fileMap = new Map();
for (const m of result.matches) {
    const name = m.metadata['File.name'] || '';
    if (!fileMap.has(name)) fileMap.set(name, []);
    fileMap.get(name).push(m.id);
}

let totalDeleted = 0;
for (const fileName of filesToDelete) {
    const ids = fileMap.get(fileName);
    if (!ids || ids.length === 0) {
        console.log(`⚠️  Not found: ${fileName}`);
        continue;
    }
    for (let i = 0; i < ids.length; i += 1000) {
        await index.deleteMany(ids.slice(i, i + 1000));
    }
    totalDeleted += ids.length;
    console.log(`🗑️  Deleted: ${fileName} (${ids.length} vectors)`);
}

console.log(`\n✅ Done. Total vectors deleted: ${totalDeleted}`);
