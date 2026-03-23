#!/usr/bin/env node
/**
 * Enrich the document catalog with Google Drive folder info.
 *
 * For each document in the catalog:
 *   1. Extract the file ID from its URL
 *   2. Query Drive API for the file's parent folder
 *   3. Add folderName, folderId, folderUrl to the catalog entry
 *
 * Run: node scripts/enrich-catalog-folders.js
 */
import { google } from 'googleapis';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const CATALOG_PATH = './query/document-catalog-identity-focused.json';

const credentials = JSON.parse(
    fs.readFileSync(process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json', 'utf8')
);
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

// Cache folder lookups to avoid redundant API calls
const folderCache = {};

/**
 * Extract Google Drive file ID from a webViewLink URL.
 * Handles: /document/d/ID, /presentation/d/ID, /spreadsheets/d/ID, /file/d/ID
 */
function extractFileId(url) {
    if (!url) return null;
    const match = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    return match ? match[1] : null;
}

/**
 * Get parent folder info for a file ID.
 * Returns { folderId, folderName, folderUrl } or null.
 */
async function getFolderInfo(fileId) {
    try {
        const fileRes = await drive.files.get({
            fileId,
            fields: 'parents',
            supportsAllDrives: true,
        });

        const parents = fileRes.data.parents;
        if (!parents || parents.length === 0) return null;

        const folderId = parents[0];

        // Use cache
        if (folderCache[folderId]) return folderCache[folderId];

        const folderRes = await drive.files.get({
            fileId: folderId,
            fields: 'id, name, webViewLink, description',
            supportsAllDrives: true,
        });

        const info = {
            folderId,
            folderName: folderRes.data.name,
            folderUrl: folderRes.data.webViewLink,
            folderDescription: folderRes.data.description || null,
        };

        folderCache[folderId] = info;
        return info;

    } catch (err) {
        return null;
    }
}

(async () => {
    console.log(`📂 Enriching catalog with folder info...\n`);

    const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const docs = catalog.documents;

    let enriched = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        const fileId = extractFileId(doc.url);

        if (!fileId) {
            console.log(`  ⚠️  [${i + 1}/${docs.length}] No URL: "${doc.name}"`);
            skipped++;
            continue;
        }

        const folderInfo = await getFolderInfo(fileId);

        if (folderInfo) {
            doc.folderId = folderInfo.folderId;
            doc.folderName = folderInfo.folderName;
            doc.folderUrl = folderInfo.folderUrl;
            if (folderInfo.folderDescription) doc.folderDescription = folderInfo.folderDescription;
            console.log(`  ✅ [${i + 1}/${docs.length}] "${doc.name}" → 📁 ${folderInfo.folderName}`);
            enriched++;
        } else {
            console.log(`  ❌ [${i + 1}/${docs.length}] Could not get folder for: "${doc.name}"`);
            failed++;
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 50));
    }

    // Write back to catalog
    catalog.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));

    console.log(`\n📊 Done:`);
    console.log(`   ✅ Enriched: ${enriched}`);
    console.log(`   ⚠️  Skipped (no URL): ${skipped}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`\n📁 Unique folders found: ${Object.keys(folderCache).length}`);
    console.log('\nFolder breakdown:');
    const folderCounts = {};
    docs.forEach(d => {
        if (d.folderName) folderCounts[d.folderName] = (folderCounts[d.folderName] || 0) + 1;
    });
    Object.entries(folderCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, count]) => console.log(`   ${count}x  ${name}`));
})();
