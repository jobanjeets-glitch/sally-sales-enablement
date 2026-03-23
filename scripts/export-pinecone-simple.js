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
            mimeType: meta['blobType'] || ''
        });
    }
}

const files = [...fileMap.values()].sort((a, b) => a.name.localeCompare(b.name));

const escape = v => '"' + String(v || '').replace(/"/g, '""') + '"';
const headers = ['File Name', 'File ID', 'Web View URL', 'MIME Type'];
const rows = [headers.join(',')];
for (const f of files) {
    rows.push([
        escape(f.name),
        escape(f.fileId),
        escape(f.webViewLink),
        escape(f.mimeType)
    ].join(','));
}

fs.writeFileSync('./reports/pinecone-files-review.csv', rows.join('\n'));
console.log('Total files:', files.length);
console.log('CSV saved to reports/pinecone-files-review.csv');
