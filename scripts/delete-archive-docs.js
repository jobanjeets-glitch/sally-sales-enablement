#!/usr/bin/env node
import { Pinecone } from '@pinecone-database/pinecone';
import { google } from 'googleapis';
import fs from 'fs/promises';
import dotenv from 'dotenv';
dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX_NAME);

// Get all vectors
console.log('Fetching all vectors from Pinecone...');
const result = await index.query({
    vector: new Array(3072).fill(0),
    topK: 10000,
    includeMetadata: true
});

// Group by file name
const fileMap = new Map();
for (const m of result.matches) {
    const name = m.metadata['File.name'] || '';
    const fileId = m.metadata['File.id'] || null;
    if (!fileMap.has(name)) {
        fileMap.set(name, { name, fileId, ids: [], hasFileId: !!fileId });
    }
    fileMap.get(name).ids.push(m.id);
}

console.log(`Total unique documents: ${fileMap.size}\n`);

// Step 1: Delete docs with "archive" in their name
const toDeleteByName = [];
for (const [name, data] of fileMap) {
    if (/archive/i.test(name)) {
        toDeleteByName.push(data);
    }
}

console.log(`Documents with "archive" in name: ${toDeleteByName.length}`);
for (const d of toDeleteByName) {
    console.log(`  - ${d.name} (${d.ids.length} vectors)`);
}

// Step 2: Check Google Drive for no-File.id docs to find archive folder ones
// Set up Google auth
let driveArchivedDocs = [];
try {
    const credentials = JSON.parse(await fs.readFile(process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json', 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.readonly']
    });
    const drive = google.drive({ version: 'v3', auth });

    // For each no-File.id doc, search Drive by name and check parent folder
    const noFileIdDocs = [...fileMap.values()].filter(d => !d.hasFileId);
    console.log(`\nChecking ${noFileIdDocs.length} no-File.id docs in Google Drive...`);

    for (const doc of noFileIdDocs) {
        if (/archive/i.test(doc.name)) continue; // already caught above

        try {
            const res = await drive.files.list({
                q: `name = '${doc.name.replace(/'/g, "\\'")}' and trashed = false`,
                fields: 'files(id, name, parents)',
                pageSize: 5
            });

            for (const file of res.data.files || []) {
                // Check parent folder names
                if (file.parents) {
                    for (const parentId of file.parents) {
                        const parent = await drive.files.get({
                            fileId: parentId,
                            fields: 'name'
                        });
                        if (/archive/i.test(parent.data.name)) {
                            console.log(`  Archive folder: ${doc.name} (parent: ${parent.data.name})`);
                            driveArchivedDocs.push(doc);
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            // Skip if can't find file
        }
    }
} catch (e) {
    console.log('\nNo Google credentials available - skipping Drive folder check');
}

// Combine all docs to delete
const allToDelete = [...toDeleteByName, ...driveArchivedDocs];
// Deduplicate
const uniqueToDelete = [...new Map(allToDelete.map(d => [d.name, d])).values()];

console.log(`\n========================================`);
console.log(`Total documents to delete: ${uniqueToDelete.length}`);
const totalVectors = uniqueToDelete.reduce((sum, d) => sum + d.ids.length, 0);
console.log(`Total vectors to delete: ${totalVectors}`);
console.log(`========================================`);

if (uniqueToDelete.length === 0) {
    console.log('Nothing to delete.');
    process.exit(0);
}

for (const doc of uniqueToDelete) {
    console.log(`\nDeleting: ${doc.name} (${doc.ids.length} vectors)`);
    for (let i = 0; i < doc.ids.length; i += 1000) {
        const batch = doc.ids.slice(i, i + 1000);
        await index.deleteMany(batch);
    }
    console.log(`  Deleted`);
}

console.log('\nDone!');
