/**
 * enrich-catalog-metadata.js
 *
 * For each document with missing metadata:
 *  1. Extracts text content from Google Drive
 *  2. Calls Claude to generate structured catalog metadata
 *  3. Updates the Google Sheet row
 *  4. Updates the local catalog JSON
 *
 * Usage: node scripts/enrich-catalog-metadata.js
 */

import { google } from 'googleapis';
import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
import { readFileSync, writeFileSync } from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const SHEET_ID = process.env.CATALOG_SHEET_ID || '1zwmfU-b2ADXWUYYAYdMEYSPHqetUfgSIsQEwnYnyeu4';
const SHEET_TAB = 'Sheet1';
const CATALOG_PATH = './query/document-catalog-identity-focused.json';

const COL = {
  NAME: 0, URL: 1, FILE_ID: 2, DOC_TYPE: 3, PURPOSE: 4,
  IDENTITY: 5, WHEN_TO_USE: 6, TARGET_AUDIENCE: 7,
  MAIN_TOPICS: 8, SPECIFIC_DETAILS: 9, KEY_TAKEAWAYS: 10,
  SEARCH_QUERIES: 11, NOT_TO_CONFUSE: 12, PRODUCT_NAMES: 13,
  COMPETITOR_NAMES: 14, CUSTOMER_NAMES: 15, KEY_METRICS: 16,
  KEY_FEATURES: 17, VERSION: 18, EFFECTIVE_DATE: 19, STATUS: 20,
};

// ─── Google Auth ──────────────────────────────────────────────────────────────

function getAuth(scopes) {
  if (process.env.GOOGLE_CREDS) {
    return new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_CREDS), scopes });
  }
  const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
  return new google.auth.GoogleAuth({ credentials: JSON.parse(readFileSync(credPath, 'utf8')), scopes });
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function extractTextFromDocContent(content) {
  if (!content) return '';
  let text = '';
  for (const el of content) {
    if (el.paragraph) {
      for (const pe of el.paragraph.elements || []) {
        if (pe.textRun) text += pe.textRun.content;
      }
    } else if (el.textRun) {
      text += el.textRun.content;
    }
  }
  return text;
}

async function extractText(drive, docs, slides, sheets, fileId, mimeType) {
  if (mimeType === 'application/vnd.google-apps.document') {
    const doc = await docs.documents.get({ documentId: fileId });
    return extractTextFromDocContent(doc.data.body.content);
  }

  if (mimeType === 'application/vnd.google-apps.presentation') {
    const pres = await slides.presentations.get({ presentationId: fileId });
    let text = '';
    for (const slide of pres.data.slides || []) {
      for (const el of slide.pageElements || []) {
        if (el.shape?.text) {
          text += extractTextFromDocContent(el.shape.text.textElements) + '\n\n';
        }
      }
    }
    return text;
  }

  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const ss = await sheets.spreadsheets.get({ spreadsheetId: fileId });
    let text = '';
    for (const sh of ss.data.sheets || []) {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: fileId, range: sh.properties.title });
      if (res.data.values) text += res.data.values.map(r => r.join(' | ')).join('\n') + '\n\n';
    }
    return text;
  }

  // Binary (docx, pdf) — download and parse
  const res = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  const buffer = Buffer.from(res.data);

  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const r = await mammoth.extractRawText({ buffer });
    return r.value;
  }

  // PDF
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  return data.text;
}

// ─── Claude metadata generation ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a sales enablement catalog specialist at CommerceIQ.
You analyze sales documents and produce structured metadata so reps can find the right document quickly.

CommerceIQ product abbreviations:
DSA = Digital Shelf Analytics, RMM = Retail Media Management, AC = Amazon Copilot,
OCC = Omnichannel Command Center, PRA = Profit Recovery Automation,
MI = Market Insights, ESM = Ecommerce Sales Management,
Ally/AllyAI = AllyAI agentic offerings (Sales Agent, Shelf Agent, Content Agent, Media Agent)

Respond ONLY with a JSON object — no preamble, no markdown fences.`;

async function generateMetadata(anthropic, docName, docText) {
  const truncated = docText.slice(0, 80000); // keep within context

  const prompt = `Document name: "${docName}"

Document content:
${truncated}

Generate catalog metadata for this document. Return a JSON object with these exact keys:
{
  "documentType": "one of: battle-card | first-call-deck | second-call-deck | case-study-library | enablement-guide | legal-contract | product-hub | training-deck | other",
  "documentIdentity": "One comprehensive paragraph (3-5 sentences) describing exactly what this document is, what it contains, and what makes it unique. Start with 'This is the [name] —'",
  "documentPurpose": "One sentence: the primary job this document does for a sales rep",
  "whenToUse": "Specific situations when a rep would reach for this document (2-4 sentences)",
  "targetAudience": "Comma-separated roles: e.g. Account Executives, Sales Engineers, Customer Success",
  "mainTopics": ["array", "of", "5-10", "main", "topics"],
  "specificDetails": ["array", "of", "5-10", "specific", "facts", "figures", "or", "details"],
  "keyTakeaways": ["array", "of", "3-5", "key", "takeaways"],
  "searchQueries": ["array", "of", "8-12", "example", "search", "queries", "a", "rep", "might", "type"],
  "notToConfuseWith": "Brief note about similar documents this might be confused with",
  "productNames": ["array", "of", "CIQ", "products", "mentioned"],
  "competitorNames": ["array", "of", "competitor", "names", "mentioned"],
  "customerNames": ["array", "of", "customer", "or", "brand", "names", "mentioned"],
  "keyMetrics": ["array", "of", "specific", "numbers", "stats", "or", "metrics"],
  "keyFeatures": ["array", "of", "key", "features", "or", "capabilities"],
  "version": "version string or empty string",
  "effectiveDate": "YYYY-MM-DD or empty string",
  "status": "Active"
}`;

  const response = await anthropic.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  // Strip any accidental markdown fences
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

// ─── Sheet helpers ────────────────────────────────────────────────────────────

async function readSheetRows(sheets) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${SHEET_TAB}!A:U` });
  return res.data.values || [];
}

async function updateSheetRow(sheets, rowIndex, values) {
  const sheetRow = rowIndex + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A${sheetRow}:U${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [values] },
  });
}

function fmt(val) {
  if (!val) return '';
  if (Array.isArray(val)) {
    return val.length === 0 ? '' : '• ' + val.join('\n• ');
  }
  return String(val);
}

function metaToRow(existing, meta) {
  const row = [...existing];
  while (row.length < 21) row.push('');

  if (meta.documentType) row[COL.DOC_TYPE] = meta.documentType;
  if (meta.documentPurpose) row[COL.PURPOSE] = meta.documentPurpose;
  if (meta.documentIdentity) row[COL.IDENTITY] = meta.documentIdentity;
  if (meta.whenToUse) row[COL.WHEN_TO_USE] = meta.whenToUse;
  if (meta.targetAudience) row[COL.TARGET_AUDIENCE] = fmt(meta.targetAudience);
  if (meta.mainTopics?.length) row[COL.MAIN_TOPICS] = fmt(meta.mainTopics);
  if (meta.specificDetails?.length) row[COL.SPECIFIC_DETAILS] = fmt(meta.specificDetails);
  if (meta.keyTakeaways?.length) row[COL.KEY_TAKEAWAYS] = fmt(meta.keyTakeaways);
  if (meta.searchQueries?.length) row[COL.SEARCH_QUERIES] = fmt(meta.searchQueries);
  if (meta.notToConfuseWith) row[COL.NOT_TO_CONFUSE] = fmt(meta.notToConfuseWith);
  if (meta.productNames?.length) row[COL.PRODUCT_NAMES] = fmt(meta.productNames);
  if (meta.competitorNames?.length) row[COL.COMPETITOR_NAMES] = fmt(meta.competitorNames);
  if (meta.customerNames?.length) row[COL.CUSTOMER_NAMES] = fmt(meta.customerNames);
  if (meta.keyMetrics?.length) row[COL.KEY_METRICS] = fmt(meta.keyMetrics);
  if (meta.keyFeatures?.length) row[COL.KEY_FEATURES] = fmt(meta.keyFeatures);
  if (meta.version) row[COL.VERSION] = meta.version;
  if (meta.effectiveDate) row[COL.EFFECTIVE_DATE] = meta.effectiveDate;
  row[COL.STATUS] = meta.status || 'Active';

  return row;
}

// ─── Catalog JSON update ──────────────────────────────────────────────────────

function updateCatalogEntry(fileId, name, meta) {
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  let entry = catalog.documents.find(d => d.fileId === fileId) ||
              catalog.documents.find(d => d.name?.trim().toLowerCase() === name.trim().toLowerCase());

  if (!entry) {
    // Add new entry
    entry = { name, fileId };
    catalog.documents.push(entry);
    catalog.totalDocuments = catalog.documents.length;
  }

  entry.documentType = meta.documentType || entry.documentType;
  entry.documentIdentity = meta.documentIdentity || entry.documentIdentity;
  entry.documentPurpose = meta.documentPurpose || entry.documentPurpose;
  entry.whenToUse = meta.whenToUse || entry.whenToUse;
  entry.targetAudience = meta.targetAudience || entry.targetAudience;
  entry.contentSummary = {
    mainTopics: meta.mainTopics || [],
    specificDetails: meta.specificDetails || [],
    keyTakeaways: meta.keyTakeaways || [],
  };
  entry.searchQueries = meta.searchQueries || entry.searchQueries;
  entry.notToConfuseWith = meta.notToConfuseWith || entry.notToConfuseWith;
  entry.productNames = meta.productNames || entry.productNames;
  entry.competitorNames = meta.competitorNames || entry.competitorNames;
  entry.customerNames = meta.customerNames || entry.customerNames;
  entry.keyMetrics = meta.keyMetrics || entry.keyMetrics;
  entry.keyFeatures = meta.keyFeatures || entry.keyFeatures;
  entry.version = meta.version || entry.version;
  entry.effectiveDate = meta.effectiveDate || entry.effectiveDate;
  entry.status = meta.status || 'Active';

  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('       ENRICH CATALOG METADATA (Claude-powered)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Setup clients
  const driveAuth = getAuth([
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/presentations.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]);
  const sheetsAuth = getAuth(['https://www.googleapis.com/auth/spreadsheets']);

  const drive = google.drive({ version: 'v3', auth: driveAuth });
  const docs = google.docs({ version: 'v1', auth: driveAuth });
  const slides = google.slides({ version: 'v1', auth: driveAuth });
  const sheetsRead = google.sheets({ version: 'v4', auth: driveAuth });
  const sheetsWrite = google.sheets({ version: 'v4', auth: sheetsAuth });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Read current sheet
  const rows = await readSheetRows(sheetsWrite);
  console.log(`Sheet has ${rows.length - 1} data rows\n`);

  // Find rows that need enrichment (no identity or "Needs Review")
  const toEnrich = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = row[COL.NAME]?.trim();
    const fileId = row[COL.FILE_ID]?.trim();
    const hasIdentity = (row[COL.IDENTITY] || '').trim().length > 0;
    const status = (row[COL.STATUS] || '').trim();

    if (!hasIdentity || status === 'Needs Review') {
      toEnrich.push({ rowIndex: i, name, fileId, row });
    }
  }

  console.log(`Found ${toEnrich.length} rows to enrich:\n`);
  toEnrich.forEach(r => console.log(`  • Row ${r.rowIndex + 1}: "${r.name}"`));
  console.log('');

  let success = 0;
  let failed = 0;

  for (const { rowIndex, name, fileId, row } of toEnrich) {
    console.log(`\n[${success + failed + 1}/${toEnrich.length}] Processing: "${name}"`);

    try {
      // Get mimeType from Drive
      const fileInfo = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });
      const mimeType = fileInfo.data.mimeType;
      console.log(`   Type: ${mimeType}`);

      // Extract text
      console.log('   Extracting text...');
      const text = await extractText(drive, docs, slides, sheetsRead, fileId, mimeType);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      console.log(`   Extracted ${wordCount} words`);

      if (wordCount < 20) {
        console.log(`   ⚠️  Too short to analyze, skipping`);
        failed++;
        continue;
      }

      // Generate metadata via Claude
      console.log('   Generating metadata with Claude...');
      const meta = await generateMetadata(anthropic, name, text);
      console.log(`   ✓ Got metadata (type: ${meta.documentType}, ${meta.mainTopics?.length || 0} topics)`);

      // Update sheet
      const updatedRow = metaToRow(row, meta);
      await updateSheetRow(sheetsWrite, rowIndex, updatedRow);
      console.log(`   ✅ Sheet row ${rowIndex + 1} updated`);

      // Update catalog JSON
      updateCatalogEntry(fileId, name, meta);
      console.log(`   ✅ Catalog JSON updated`);

      success++;

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  ✅ Enriched: ${success}  ❌ Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
