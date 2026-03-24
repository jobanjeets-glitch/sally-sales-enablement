/**
 * update-catalog-sheet.js
 *
 * Syncs the Google Sheet catalog with what's actually in Pinecone.
 * Appends rows for any files indexed in Pinecone that are missing from the sheet.
 *
 * Usage:
 *   node scripts/update-catalog-sheet.js           # runs and updates
 *   node scripts/update-catalog-sheet.js --dry-run # shows what would change, no writes
 *
 * Called automatically by GitHub Actions after each daily sync.
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const SHEET_ID = process.env.CATALOG_SHEET_ID || '1zwmfU-b2ADXWUYYAYdMEYSPHqetUfgSIsQEwnYnyeu4';
const SHEET_TAB = 'Sheet1';
const DRY_RUN = process.argv.includes('--dry-run');

// Column order must match the sheet exactly
const COLUMNS = [
  'Document Name', 'URL', 'fileId', 'Document Type',
  'documentPurpose', 'documentIdentity', 'When to Use', 'targetAudience',
  'mainTopics', 'specificDetails', 'keyTakeaways', 'Search Queries',
  'notToConfuseWith', 'productNames', 'competitorNames', 'customerNames',
  'keyMetrics', 'keyFeatures', 'version', 'effectiveDate', 'status',
];

function inferDocType(name) {
  const n = name.toLowerCase();
  if (n.includes('battle card') || n.includes('battlecard')) return 'battle-card';
  if (n.includes('comparison') && (n.includes('vs') || n.includes('competitive'))) return 'battle-card';
  if (n.includes('first call') || n.includes('1st call') || n.includes('1. ')) return 'first-call-deck';
  if (n.includes('second call') || n.includes('2nd call') || n.includes('2. ')) return 'second-call-deck';
  if (n.includes('case study') || n.includes('cssl')) return 'case-study-library';
  if (n.includes('faq')) return 'enablement-guide';
  if (n.includes('training') || n.includes('certification')) return 'enablement-guide';
  if (n.includes('datasheet') || n.includes('sell sheet') || n.includes('data sheet')) return 'enablement-guide';
  if (n.includes('product box') || n.includes('product hub')) return 'enablement-guide';
  if (n.includes('competitive') || n.includes('comparison')) return 'battle-card';
  return '';
}

function buildRow(file) {
  const row = new Array(COLUMNS.length).fill('');
  row[0] = file.name;
  row[1] = file.link || '';
  row[2] = file.id;
  row[3] = inferDocType(file.name);
  // Leave 4-19 blank — needs human review
  row[20] = 'Needs Review'; // status
  return row;
}

async function getGoogleAuth() {
  if (process.env.GOOGLE_CREDS) {
    // GitHub Actions: credentials passed as env var
    const creds = JSON.parse(process.env.GOOGLE_CREDS);
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  // Local: credentials file
  const credsPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
  const creds = JSON.parse(readFileSync(credsPath, 'utf8'));
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getAllPineconeFiles() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const idx = pc.index(process.env.PINECONE_INDEX_NAME);

  const res = await idx.query({
    vector: new Array(3072).fill(0),
    topK: 1000,
    includeMetadata: true,
  });

  const fileMap = {};
  for (const m of res.matches) {
    const id = m.metadata?.['File.id'];
    if (!id || id === 'UNKNOWN') continue;
    if (!fileMap[id]) {
      fileMap[id] = {
        id,
        name: m.metadata?.['File.name'] || 'Unknown',
        link: m.metadata?.['File.webviewlink'] || '',
        syncDate: m.metadata?.['File.lastSyncDate'] || 'n8n',
        vectorCount: 0,
      };
    }
    fileMap[id].vectorCount++;
  }

  return fileMap;
}

async function getSheetFileIds(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:C`, // Name, URL, fileId
  });

  const rows = res.data.values || [];
  // row[0]=header, row[1+]=data. fileId is column C (index 2).
  const sheetFileIds = new Set();
  const sheetNames = new Set();

  for (let i = 1; i < rows.length; i++) {
    const fileId = rows[i]?.[2]?.trim();
    const name = rows[i]?.[0]?.trim();
    if (fileId) sheetFileIds.add(fileId);
    if (name) sheetNames.add(name.toLowerCase());
  }

  return { sheetFileIds, sheetNames };
}

async function main() {
  console.log('=== Catalog Sheet Sync ===');
  if (DRY_RUN) console.log('DRY RUN — no changes will be written\n');

  // 1. Get all files from Pinecone
  console.log('Querying Pinecone...');
  const pineconeFiles = await getAllPineconeFiles();
  console.log(`Found ${Object.keys(pineconeFiles).length} unique files in Pinecone`);

  // 2. Get existing entries from sheet
  const auth = await getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const { sheetFileIds, sheetNames } = await getSheetFileIds(sheets);
  console.log(`Found ${sheetFileIds.size} entries in catalog sheet`);

  // 3. Find files missing from sheet
  const missing = Object.values(pineconeFiles).filter(f => {
    // Missing if: fileId not in sheet AND name not in sheet
    return !sheetFileIds.has(f.id) && !sheetNames.has(f.name.toLowerCase());
  });

  if (missing.length === 0) {
    console.log('\n✅ Catalog is up to date — no new files to add');
    writeOutputForActions(0, []);
    return;
  }

  console.log(`\n📝 ${missing.length} file(s) in Pinecone but missing from catalog:`);
  missing.forEach(f => {
    console.log(`  + "${f.name}" | ${f.vectorCount} vectors | synced ${f.syncDate}`);
  });

  if (DRY_RUN) {
    console.log('\nDry run complete. Run without --dry-run to apply changes.');
    return;
  }

  // 4. Append missing rows to sheet
  const newRows = missing.map(buildRow);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:U`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: newRows },
  });

  console.log(`\n✅ Added ${missing.length} new row(s) to catalog sheet`);
  console.log(`   These rows have status "Needs Review" — fill in details at:`);
  console.log(`   https://docs.google.com/spreadsheets/d/${SHEET_ID}`);

  writeOutputForActions(missing.length, missing);
}

function writeOutputForActions(count, files) {
  // Write outputs for GitHub Actions summary
  const output = process.env.GITHUB_STEP_SUMMARY;
  if (!output) return;

  const lines = [
    '',
    '## 📋 Catalog Sheet Update',
    '',
  ];

  if (count === 0) {
    lines.push('✅ Catalog is up to date — no new entries added');
  } else {
    lines.push(`Added **${count}** new file(s) to the catalog sheet (status: Needs Review):`);
    lines.push('');
    files.forEach(f => lines.push(`- \`${f.name}\` (${f.vectorCount} vectors)`));
    lines.push('');
    lines.push(`[Open catalog sheet →](https://docs.google.com/spreadsheets/d/${SHEET_ID})`);
  }

  const fs = { appendFileSync: (p, d) => require('fs').appendFileSync(p, d) };
  try {
    import('fs').then(({ appendFileSync }) => appendFileSync(output, lines.join('\n') + '\n'));
  } catch {}
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
