#!/usr/bin/env node
import { google } from 'googleapis';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json', 'utf8'));
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
});
const drive = google.drive({ version: 'v3', auth });

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
let skippedFolders = 0;
let totalFiles = 0;

async function scanFolder(folderId, folderPath = '') {
    const files = [];

    let pageToken = null;
    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime)',
            pageSize: 1000,
            pageToken: pageToken,
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            corpora: 'allDrives'
        });

        for (const item of res.data.files || []) {
            if (item.mimeType === 'application/vnd.google-apps.folder') {
                if (/archive/i.test(item.name)) {
                    console.log(`Skipping archive folder: ${folderPath}/${item.name}`);
                    skippedFolders++;
                    continue;
                }
                const subFiles = await scanFolder(item.id, `${folderPath}/${item.name}`);
                files.push(...subFiles);
            } else {
                files.push({
                    id: item.id,
                    name: item.name,
                    mimeType: item.mimeType,
                    webViewLink: item.webViewLink || '',
                    modifiedTime: item.modifiedTime || '',
                    folder: folderPath || '/'
                });
                totalFiles++;
            }
        }

        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return files;
}

console.log('Scanning Google Drive...\n');
const files = await scanFolder(FOLDER_ID);

// Filter out archive-named files
const filtered = files.filter(f => {
    if (/archive/i.test(f.name)) {
        console.log(`Skipping archive file: ${f.name}`);
        return false;
    }
    return true;
});

console.log(`\nTotal files found: ${files.length}`);
console.log(`Archive files skipped: ${files.length - filtered.length}`);
console.log(`Archive folders skipped: ${skippedFolders}`);
console.log(`Clean files: ${filtered.length}`);

// Write CSV
const escape = v => '"' + String(v || '').replace(/"/g, '""') + '"';
const headers = ['File ID', 'File Name', 'Web View URL', 'MIME Type', 'Modified Date', 'Folder'];
const rows = [headers.join(',')];
for (const f of filtered.sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push([
        escape(f.id),
        escape(f.name),
        escape(f.webViewLink),
        escape(f.mimeType),
        escape(f.modifiedTime),
        escape(f.folder)
    ].join(','));
}

fs.writeFileSync('./reports/google-drive-files.csv', rows.join('\n'));
console.log('\nCSV saved to reports/google-drive-files.csv');
