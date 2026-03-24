/**
 * fix-names-and-details.js
 *
 * One-time fix script that:
 * 1. Scans Google Drive for current file names + IDs
 * 2. Finds name mismatches in Pinecone (same fileId, different name)
 * 3. Updates Pinecone metadata with correct Drive name
 * 4. Updates stale names in the Google Sheet catalog
 * 5. Fills in enhanced metadata for sparse rows in the Google Sheet
 *
 * Does NOT trigger a full re-index.
 *
 * Usage: node scripts/fix-names-and-details.js [--dry-run]
 */

import { google } from 'googleapis';
import { Pinecone } from '@pinecone-database/pinecone';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const SHEET_ID = process.env.CATALOG_SHEET_ID || '1zwmfU-b2ADXWUYYAYdMEYSPHqetUfgSIsQEwnYnyeu4';
const SHEET_TAB = 'Sheet1';

// Column indices (0-based)
const COL = {
  NAME: 0,
  URL: 1,
  FILE_ID: 2,
  DOC_TYPE: 3,
  PURPOSE: 4,
  IDENTITY: 5,
  WHEN_TO_USE: 6,
  TARGET_AUDIENCE: 7,
  MAIN_TOPICS: 8,
  SPECIFIC_DETAILS: 9,
  KEY_TAKEAWAYS: 10,
  SEARCH_QUERIES: 11,
  NOT_TO_CONFUSE: 12,
  PRODUCT_NAMES: 13,
  COMPETITOR_NAMES: 14,
  CUSTOMER_NAMES: 15,
  KEY_METRICS: 16,
  KEY_FEATURES: 17,
  VERSION: 18,
  EFFECTIVE_DATE: 19,
  STATUS: 20,
};

// ─── Google Auth ──────────────────────────────────────────────────────────────

function getAuth(scopes) {
  if (process.env.GOOGLE_CREDS) {
    const creds = JSON.parse(process.env.GOOGLE_CREDS);
    return new google.auth.GoogleAuth({ credentials: creds, scopes });
  }
  const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
  const creds = JSON.parse(readFileSync(credPath, 'utf8'));
  return new google.auth.GoogleAuth({ credentials: creds, scopes });
}

// ─── Drive: scan all files ────────────────────────────────────────────────────

async function scanDriveFiles(drive, rootFolderId) {
  const files = [];

  const scan = async (folderId) => {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const item of res.data.files) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        if (/archive/i.test(item.name)) continue;
        await scan(item.id);
      } else {
        files.push({ id: item.id, name: item.name });
      }
    }
  };

  await scan(rootFolderId);
  return files;
}

// ─── Pinecone: get stored name for a fileId ──────────────────────────────────

async function getPineconeNameByFileId(index, fileId) {
  const res = await index.query({
    vector: new Array(3072).fill(0),
    topK: 1,
    includeMetadata: true,
    filter: { 'File.id': { $eq: fileId } },
  });

  if (res.matches.length === 0) return null;
  return res.matches[0].metadata?.['File.name'] || null;
}

// ─── Pinecone: update File.name for all vectors of a fileId ──────────────────

async function updatePineconeName(index, fileId, newName) {
  const res = await index.query({
    vector: new Array(3072).fill(0),
    topK: 300,
    includeMetadata: false,
    filter: { 'File.id': { $eq: fileId } },
  });

  if (res.matches.length === 0) return 0;

  for (const match of res.matches) {
    await index.update({ id: match.id, metadata: { 'File.name': newName } });
  }

  return res.matches.length;
}

// ─── Google Sheet: read all rows ──────────────────────────────────────────────

async function readSheetRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:U`,
  });
  return res.data.values || [];
}

// ─── Google Sheet: update a single cell range ────────────────────────────────

async function updateSheetRow(sheets, rowIndex, values) {
  // rowIndex is 0-based from the rows array (row 0 = header = sheet row 1)
  const sheetRow = rowIndex + 1; // convert to 1-based
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A${sheetRow}:U${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  });
}

// ─── Catalog JSON: load ───────────────────────────────────────────────────────

function loadCatalog() {
  try {
    return JSON.parse(readFileSync('./query/document-catalog-identity-focused.json', 'utf8'));
  } catch {
    return null;
  }
}

// ─── Format array or string for sheet cell ───────────────────────────────────

function fmt(val) {
  if (!val) return '';
  if (Array.isArray(val)) return val.join('\n• ').replace(/^/, '• ');
  return String(val);
}

// ─── Build full row from catalog entry ───────────────────────────────────────

function buildEnhancedRow(catalogEntry, existingRow) {
  const row = [...existingRow];
  while (row.length < 21) row.push('');

  const e = catalogEntry;
  const cs = e.contentSummary || {};

  if (e.name && !row[COL.NAME]) row[COL.NAME] = e.name;
  if (e.url && !row[COL.URL]) row[COL.URL] = e.url;
  if (e.fileId && !row[COL.FILE_ID]) row[COL.FILE_ID] = e.fileId;
  if (e.documentType) row[COL.DOC_TYPE] = fmt(e.documentType);
  if (e.documentPurpose) row[COL.PURPOSE] = fmt(e.documentPurpose);
  if (e.documentIdentity) row[COL.IDENTITY] = fmt(e.documentIdentity);
  if (e.whenToUse) row[COL.WHEN_TO_USE] = fmt(e.whenToUse);
  if (e.targetAudience) row[COL.TARGET_AUDIENCE] = fmt(e.targetAudience);
  if (cs.mainTopics?.length) row[COL.MAIN_TOPICS] = fmt(cs.mainTopics);
  if (cs.specificDetails?.length) row[COL.SPECIFIC_DETAILS] = fmt(cs.specificDetails);
  if (cs.keyTakeaways?.length) row[COL.KEY_TAKEAWAYS] = fmt(cs.keyTakeaways);
  if (e.searchQueries?.length) row[COL.SEARCH_QUERIES] = fmt(e.searchQueries);
  if (e.notToConfuseWith) row[COL.NOT_TO_CONFUSE] = fmt(e.notToConfuseWith);
  if (e.productNames?.length) row[COL.PRODUCT_NAMES] = fmt(e.productNames);
  if (e.competitorNames?.length) row[COL.COMPETITOR_NAMES] = fmt(e.competitorNames);
  if (e.customerNames?.length) row[COL.CUSTOMER_NAMES] = fmt(e.customerNames);
  if (e.keyMetrics?.length) row[COL.KEY_METRICS] = fmt(e.keyMetrics);
  if (e.keyFeatures?.length) row[COL.KEY_FEATURES] = fmt(e.keyFeatures);
  if (e.version) row[COL.VERSION] = e.version;
  if (e.effectiveDate) row[COL.EFFECTIVE_DATE] = e.effectiveDate;

  // Update status if it was "Needs Review" and we now have identity
  if (row[COL.STATUS] === 'Needs Review' && e.documentIdentity) {
    row[COL.STATUS] = 'Active';
  }

  return row;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('         FIX NAMES + ENHANCED DETAILS');
  if (DRY_RUN) console.log('         *** DRY RUN — no changes will be written ***');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Set up Google clients
  const driveAuth = getAuth([
    'https://www.googleapis.com/auth/drive.readonly',
  ]);
  const sheetsAuth = getAuth([
    'https://www.googleapis.com/auth/spreadsheets',
  ]);

  const drive = google.drive({ version: 'v3', auth: driveAuth });
  const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

  // ── Phase 1: Scan Drive ──────────────────────────────────────────────────
  console.log('📁 Phase 1: Scanning Google Drive...');
  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const driveFiles = await scanDriveFiles(drive, rootFolderId);
  const driveById = new Map(driveFiles.map(f => [f.id, f.name]));
  console.log(`   Found ${driveFiles.length} files in Drive\n`);

  // ── Phase 2: Check + fix Pinecone names ─────────────────────────────────
  console.log('🔍 Phase 2: Checking Pinecone name alignment...');
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const idx = pc.index(process.env.PINECONE_INDEX_NAME);

  let pineconeFixed = 0;
  let pineconeChecked = 0;

  for (const file of driveFiles) {
    const pineconeStoredName = await getPineconeNameByFileId(idx, file.id);
    if (!pineconeStoredName) continue; // not indexed yet

    pineconeChecked++;
    const normalizedStored = pineconeStoredName.trim();
    if (normalizedStored !== file.name) {
      console.log(`   MISMATCH: "${pineconeStoredName}" → "${file.name}"`);
      if (!DRY_RUN) {
        const updated = await updatePineconeName(idx, file.id, file.name);
        console.log(`   ✅ Updated ${updated} vectors in Pinecone`);
      } else {
        console.log(`   [DRY RUN] Would update Pinecone`);
      }
      pineconeFixed++;
    }
  }

  if (pineconeFixed === 0) {
    console.log(`   ✅ All ${pineconeChecked} Pinecone names match Drive — no fixes needed`);
  } else {
    console.log(`\n   Fixed ${pineconeFixed} name(s) in Pinecone`);
  }

  // ── Phase 3: Fix Google Sheet names ─────────────────────────────────────
  console.log('\n📊 Phase 3: Fixing Google Sheet names...');
  const rows = await readSheetRows(sheets);
  // rows[0] = header
  let sheetNameFixed = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const fileId = row[COL.FILE_ID]?.trim();
    const sheetName = row[COL.NAME]?.trim();

    if (!fileId || fileId === 'UNKNOWN') continue;

    const driveName = driveById.get(fileId);
    if (!driveName) continue; // file not in Drive (deleted or not in folder)

    if (sheetName !== driveName) {
      console.log(`   ROW ${i + 1}: "${sheetName}" → "${driveName}"`);
      if (!DRY_RUN) {
        const updatedRow = [...row];
        while (updatedRow.length < 21) updatedRow.push('');
        updatedRow[COL.NAME] = driveName;
        await updateSheetRow(sheets, i, updatedRow);
        rows[i][COL.NAME] = driveName; // update in-memory for phase 4
      } else {
        console.log(`   [DRY RUN] Would update sheet row ${i + 1}`);
      }
      sheetNameFixed++;
    }
  }

  if (sheetNameFixed === 0) {
    console.log('   ✅ All sheet names match Drive — no fixes needed');
  } else {
    console.log(`\n   Fixed ${sheetNameFixed} name(s) in Google Sheet`);
  }

  // ── Phase 4: Fill enhanced details from catalog JSON ────────────────────
  console.log('\n📝 Phase 4: Filling enhanced details for sparse rows...');

  const catalog = loadCatalog();
  if (!catalog) {
    console.log('   ⚠️  Could not load catalog JSON, skipping');
  } else {
    // Build catalog lookup by fileId and by name
    const catalogByFileId = new Map();
    const catalogByName = new Map();
    for (const doc of catalog.documents) {
      if (doc.fileId) catalogByFileId.set(doc.fileId, doc);
      if (doc.name) catalogByName.set(doc.name.trim().toLowerCase(), doc);
    }

    let detailsAdded = 0;
    let detailsSkipped = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const fileId = row[COL.FILE_ID]?.trim();
      const sheetName = row[COL.NAME]?.trim();
      const hasIdentity = (row[COL.IDENTITY] || '').trim().length > 0;

      if (hasIdentity) {
        detailsSkipped++;
        continue; // already has details
      }

      // Find catalog entry
      let catalogEntry = null;
      if (fileId) catalogEntry = catalogByFileId.get(fileId);
      if (!catalogEntry && sheetName) catalogEntry = catalogByName.get(sheetName.toLowerCase());

      if (!catalogEntry) {
        console.log(`   ⚠️  Row ${i + 1}: "${sheetName}" — no catalog entry found, skipping`);
        continue;
      }

      if (!catalogEntry.documentIdentity) {
        console.log(`   ⚠️  Row ${i + 1}: "${sheetName}" — catalog entry exists but has no identity yet`);
        continue;
      }

      console.log(`   ROW ${i + 1}: Adding enhanced details for "${sheetName}"`);
      const enhancedRow = buildEnhancedRow(catalogEntry, row);

      if (!DRY_RUN) {
        await updateSheetRow(sheets, i, enhancedRow);
      } else {
        console.log(`   [DRY RUN] Would fill ${Object.keys(catalogEntry).length} fields`);
      }
      detailsAdded++;
    }

    console.log(`\n   ✅ Enhanced details added: ${detailsAdded} rows`);
    if (detailsSkipped > 0) {
      console.log(`   ⏭️  Skipped ${detailsSkipped} rows (already had details)`);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('                       DONE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Pinecone names fixed : ${pineconeFixed}`);
  console.log(`  Sheet names fixed    : ${sheetNameFixed}`);
  console.log(`  Enhanced details added to sheet rows (above)`);
  if (DRY_RUN) console.log('\n  [DRY RUN] No changes were written.');
  console.log('');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
