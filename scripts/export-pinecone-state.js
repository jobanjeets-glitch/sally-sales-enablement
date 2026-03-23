#!/usr/bin/env node
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX_NAME);

const result = await index.query({
    vector: new Array(3072).fill(0),
    topK: 10000,
    includeMetadata: true
});

const fileMap = new Map();
for (const m of result.matches) {
    const meta = m.metadata;
    const name = meta['File.name'] || 'unknown';
    if (fileMap.has(name) === false) {
        fileMap.set(name, {
            name,
            fileId: meta['File.id'] || '',
            webViewLink: meta['File.webviewlink'] || meta['File.webViewLink'] || '',
            createdDate: meta['File.createdDate'] || '',
            modifiedDate: meta['File.modifiedDate'] || '',
            lastSyncDate: meta['File.lastSyncDate'] || '',
            blobType: meta['blobType'] || '',
            vectorCount: 0
        });
    }
    fileMap.get(name).vectorCount++;
}

const files = [...fileMap.values()].sort((a, b) => a.name.localeCompare(b.name));

const escape = v => '"' + String(v || '').replace(/"/g, '""') + '"';
const headers = ['File Name','File ID','Has File ID','Vector Count','Modified Date','Last Sync Date','Created Date','Type','Web View Link'];
const rows = [headers.join(',')];
for (const f of files) {
    rows.push([
        escape(f.name),
        escape(f.fileId),
        escape(f.fileId ? 'Yes' : 'No'),
        escape(f.vectorCount),
        escape(f.modifiedDate),
        escape(f.lastSyncDate),
        escape(f.createdDate),
        escape(f.blobType),
        escape(f.webViewLink)
    ].join(','));
}

fs.writeFileSync('./reports/pinecone-state-latest.csv', rows.join('\n'));
console.log('Total unique files:', files.length);
console.log('Total vectors:', result.matches.length);
console.log('Files with File.id:', files.filter(f => f.fileId).length);
console.log('Files without File.id:', files.filter(f => !f.fileId).length);
console.log('CSV saved to reports/pinecone-state-latest.csv');
