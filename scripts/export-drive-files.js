#!/usr/bin/env node
import { IntelligentSync } from './sync-pinecone-drive.js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const sync = new IntelligentSync();
console.log('Scanning Google Drive...\n');

const files = await sync.scanGoogleDrive(process.env.GOOGLE_DRIVE_FOLDER_ID);

// Filter archive-named files
const filtered = files.filter(f => /archive/i.test(f.name) === false);
const skipped = files.length - filtered.length;

console.log(`Total files: ${files.length}`);
console.log(`Archive files skipped: ${skipped}`);
console.log(`Clean files: ${filtered.length}`);

const escape = v => '"' + String(v || '').replace(/"/g, '""') + '"';
const headers = ['File ID', 'File Name', 'Web View URL', 'MIME Type', 'Modified Date', 'Folder Path'];
const rows = [headers.join(',')];

for (const f of filtered.sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push([
        escape(f.id),
        escape(f.name),
        escape(f.webViewLink || ''),
        escape(f.mimeType),
        escape(f.modifiedTime),
        escape(f.path || 'Root')
    ].join(','));
}

fs.writeFileSync('./reports/google-drive-files.csv', rows.join('\n'));
console.log('\nCSV saved to reports/google-drive-files.csv');
