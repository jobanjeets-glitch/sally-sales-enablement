#!/usr/bin/env node

import { google } from 'googleapis';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Automated Pinecone & Catalog Sync
 *
 * Keeps Pinecone vector DB and document catalog in sync with Google Drive
 *
 * What it does:
 * 1. Scans Google Drive folder for all files
 * 2. Compares with Pinecone to find new/modified/deleted files
 * 3. Indexes new files
 * 4. Re-indexes modified files (deletes old vectors, adds new)
 * 5. Deletes vectors for files removed from Drive
 * 6. Rebuilds catalog if changes were made
 * 7. Exports catalog to CSV
 * 8. Saves detailed sync log
 */
class PineconeCatalogSyncer {
    constructor(options = {}) {
        // Initialize Google Drive
        const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
        this.auth = new google.auth.GoogleAuth({
            keyFile: credPath,
            scopes: [
                'https://www.googleapis.com/auth/drive.readonly',
                'https://www.googleapis.com/auth/documents.readonly',
                'https://www.googleapis.com/auth/presentations.readonly',
                'https://www.googleapis.com/auth/spreadsheets.readonly'
            ]
        });

        this.drive = google.drive({ version: 'v3', auth: this.auth });
        this.docs = google.docs({ version: 'v1', auth: this.auth });
        this.slides = google.slides({ version: 'v1', auth: this.auth });
        this.sheets = google.sheets({ version: 'v4', auth: this.auth });

        // Initialize Pinecone
        this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        this.index = this.pinecone.index(process.env.PINECONE_INDEX_NAME);

        // Initialize OpenAI
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        this.dryRun = options.dryRun || false;

        this.stats = {
            filesInDrive: 0,
            filesInPinecone: 0,
            newFiles: [],
            modifiedFiles: [],
            deletedFiles: [],
            indexed: 0,
            reindexed: 0,
            deleted: 0,
            errors: []
        };
    }

    /**
     * Main sync process
     */
    async sync() {
        console.log('🔄 Starting Pinecone & Catalog Sync...\n');
        console.log(`📅 Sync started at: ${new Date().toISOString()}`);

        if (this.dryRun) {
            console.log('🔍 DRY RUN MODE - No changes will be made\n');
        } else {
            console.log('💾 LIVE MODE - Changes will be applied\n');
        }

        try {
            // Step 1: Get all files from Google Drive
            console.log('📂 Step 1: Scanning Google Drive folder...');
            const driveFiles = await this.getDriveFiles();
            this.stats.filesInDrive = driveFiles.length;
            console.log(`   ✓ Found ${driveFiles.length} files in Google Drive\n`);

            // Step 2: Get all files currently in Pinecone
            console.log('🗄️  Step 2: Scanning Pinecone index...');
            const pineconeFiles = await this.getPineconeFiles();
            this.stats.filesInPinecone = pineconeFiles.size;
            console.log(`   ✓ Found ${pineconeFiles.size} unique files in Pinecone\n`);

            // Step 3: Compare and identify changes
            console.log('🔍 Step 3: Comparing Drive vs Pinecone...');
            await this.compareFiles(driveFiles, pineconeFiles);

            console.log(`   📊 Comparison results:`);
            console.log(`      New files:      ${this.stats.newFiles.length}`);
            console.log(`      Modified files: ${this.stats.modifiedFiles.length}`);
            console.log(`      Deleted files:  ${this.stats.deletedFiles.length}\n`);

            if (this.stats.newFiles.length > 0) {
                console.log('   📝 New files:');
                this.stats.newFiles.forEach(f => console.log(`      - ${f.name}`));
                console.log();
            }

            if (this.stats.modifiedFiles.length > 0) {
                console.log('   📝 Modified files:');
                this.stats.modifiedFiles.forEach(f => console.log(`      - ${f.name}`));
                console.log();
            }

            if (this.stats.deletedFiles.length > 0) {
                console.log('   📝 Deleted files:');
                this.stats.deletedFiles.forEach(f => console.log(`      - ${f.name}`));
                console.log();
            }

            // Step 4: Process new files
            if (this.stats.newFiles.length > 0) {
                console.log('➕ Step 4: Indexing new files...');
                await this.indexNewFiles();
            } else {
                console.log('➕ Step 4: No new files to index\n');
            }

            // Step 5: Process modified files
            if (this.stats.modifiedFiles.length > 0) {
                console.log('🔄 Step 5: Re-indexing modified files...');
                await this.reindexModifiedFiles();
            } else {
                console.log('🔄 Step 5: No modified files to re-index\n');
            }

            // Step 6: Handle deleted files
            if (this.stats.deletedFiles.length > 0) {
                console.log('🗑️  Step 6: Deleting vectors for removed files...');
                await this.deleteRemovedFiles();
            } else {
                console.log('🗑️  Step 6: No deleted files to handle\n');
            }

            // Step 7: Rebuild catalog if changes were made
            const totalChanges = this.stats.indexed + this.stats.reindexed + this.stats.deleted;
            if (totalChanges > 0 && !this.dryRun) {
                console.log('📚 Step 7: Rebuilding document catalog...');
                await this.rebuildCatalog();

                console.log('📊 Step 8: Exporting catalog to CSV...');
                await this.exportCatalogCSV();
            } else if (totalChanges > 0 && this.dryRun) {
                console.log('📚 Step 7: [DRY RUN] Would rebuild catalog (skipped)\n');
                console.log('📊 Step 8: [DRY RUN] Would export CSV (skipped)\n');
            } else {
                console.log('📚 Step 7: No changes - catalog up to date\n');
            }

            // Step 9: Save sync log
            if (!this.dryRun) {
                await this.saveSyncLog();
            }

            // Final summary
            this.printSummary();

        } catch (error) {
            console.error('\n❌ Sync failed:', error.message);
            console.error(error.stack);
            throw error;
        }
    }

    /**
     * Get all files from Google Drive folder recursively
     */
    async getDriveFiles() {
        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

        if (!folderId) {
            throw new Error('GOOGLE_DRIVE_FOLDER_ID not set in .env');
        }

        console.log(`   📁 Scanning folder: ${folderId}`);

        const allFiles = [];

        // Recursive function to scan folders
        const scanFolder = async (parentId) => {
            const response = await this.drive.files.list({
                q: `'${parentId}' in parents and trashed=false`,
                fields: 'files(id, name, mimeType, modifiedTime, createdTime, webViewLink)',
                pageSize: 1000,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });

            for (const file of response.data.files) {
                if (file.mimeType === 'application/vnd.google-apps.folder') {
                    // Recursively scan subfolder
                    await scanFolder(file.id);
                } else {
                    allFiles.push(file);
                }
            }
        };

        await scanFolder(folderId);

        // Filter to supported file types
        const supportedTypes = [
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.presentation',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf'
        ];

        const supportedFiles = allFiles.filter(f => supportedTypes.includes(f.mimeType));

        console.log(`   📄 Total files: ${allFiles.length}`);
        console.log(`   ✓ Supported files: ${supportedFiles.length}`);

        return supportedFiles;
    }

    /**
     * Get all files currently indexed in Pinecone
     * Returns Map of fileId -> {name, modifiedDate, vectorIds}
     */
    async getPineconeFiles() {
        const filesMap = new Map();

        console.log('   🔍 Querying Pinecone vectors...');

        // Query all vectors with empty vector
        const queryResponse = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 10000,
            includeMetadata: true
        });

        console.log(`   📊 Found ${queryResponse.matches.length} vectors`);

        for (const match of queryResponse.matches) {
            const metadata = match.metadata;
            const fileId = metadata['File.id'];
            const fileName = metadata['File.name'];
            const modifiedDate = metadata['File.modifiedDate'];

            if (!fileId) continue;

            if (!filesMap.has(fileId)) {
                filesMap.set(fileId, {
                    name: fileName,
                    modifiedDate: modifiedDate,
                    vectorIds: []
                });
            }

            filesMap.get(fileId).vectorIds.push(match.id);
        }

        console.log(`   ✓ Unique files: ${filesMap.size}`);

        return filesMap;
    }

    /**
     * Compare Drive files vs Pinecone files
     */
    async compareFiles(driveFiles, pineconeFiles) {
        // Check each Drive file
        for (const driveFile of driveFiles) {
            const fileId = driveFile.id;
            const pineconeFile = pineconeFiles.get(fileId);

            if (!pineconeFile) {
                // New file - not in Pinecone yet
                this.stats.newFiles.push(driveFile);
            } else {
                // File exists - check if modified
                const driveModified = new Date(driveFile.modifiedTime);
                const pineconeModified = new Date(pineconeFile.modifiedDate);

                if (driveModified > pineconeModified) {
                    // File was modified after last index
                    this.stats.modifiedFiles.push({
                        ...driveFile,
                        oldVectorIds: pineconeFile.vectorIds
                    });
                }
            }
        }

        // Check for deleted files (in Pinecone but not in Drive)
        const driveFileIds = new Set(driveFiles.map(f => f.id));
        for (const [fileId, pineconeFile] of pineconeFiles) {
            if (!driveFileIds.has(fileId)) {
                this.stats.deletedFiles.push({
                    fileId,
                    name: pineconeFile.name,
                    vectorIds: pineconeFile.vectorIds
                });
            }
        }
    }

    /**
     * Index new files
     */
    async indexNewFiles() {
        for (let i = 0; i < this.stats.newFiles.length; i++) {
            const file = this.stats.newFiles[i];
            console.log(`   [${i + 1}/${this.stats.newFiles.length}] Indexing: ${file.name}`);

            if (this.dryRun) {
                console.log(`      [DRY RUN] Would index this file\n`);
                continue;
            }

            try {
                // Download and process file
                console.log(`      📥 Downloading...`);
                const content = await this.driveIndexer.downloadFile(file.id, file.mimeType);

                if (!content || content.trim().length < 100) {
                    console.log(`      ⚠️  Skipped: Content too short or empty\n`);
                    this.stats.errors.push({ file: file.name, error: 'Content too short' });
                    continue;
                }

                // Chunk content
                const chunks = this.chunker.chunkText(content);
                console.log(`      ✂️  Created ${chunks.length} chunks`);

                // Create vectors
                const vectors = await this.createVectors(file, chunks);
                console.log(`      🧮 Created ${vectors.length} embeddings`);

                // Upload to Pinecone
                await this.uploadToPinecone(vectors);
                console.log(`      ✅ Uploaded to Pinecone\n`);

                this.stats.indexed++;

            } catch (error) {
                console.log(`      ❌ Error: ${error.message}\n`);
                this.stats.errors.push({ file: file.name, error: error.message });
            }
        }
    }

    /**
     * Re-index modified files
     */
    async reindexModifiedFiles() {
        for (let i = 0; i < this.stats.modifiedFiles.length; i++) {
            const file = this.stats.modifiedFiles[i];
            console.log(`   [${i + 1}/${this.stats.modifiedFiles.length}] Re-indexing: ${file.name}`);

            if (this.dryRun) {
                console.log(`      [DRY RUN] Would delete ${file.oldVectorIds.length} old vectors and re-index\n`);
                continue;
            }

            try {
                // Delete old vectors first
                console.log(`      🗑️  Deleting ${file.oldVectorIds.length} old vectors`);
                await this.index.deleteMany(file.oldVectorIds);

                // Extract text based on file type
                console.log(`      📥 Extracting updated content...`);
                let text = '';

                if (file.mimeType === 'application/vnd.google-apps.document') {
                    text = await this.extractGoogleDoc(file.id);
                } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
                    text = await this.extractGoogleSlides(file.id);
                } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
                    text = await this.extractGoogleSheets(file.id);
                } else if (file.mimeType === 'application/pdf') {
                    text = await this.extractPDF(file.id);
                } else {
                    throw new Error(`Unsupported file type: ${file.mimeType}`);
                }

                if (!text || text.trim().length < 50) {
                    console.log(`      ⚠️  Skipped: Content too short or empty after update\n`);
                    this.stats.errors.push({ file: file.name, error: 'Content too short after update' });
                    continue;
                }

                console.log(`      📝 Extracted ${text.length} characters`);

                // Chunk text
                const chunks = this.chunkText(text);
                console.log(`      ✂️  Created ${chunks.length} new chunks`);

                // Create vectors
                const vectors = await this.createVectors(file, chunks);
                console.log(`      🧮 Created ${vectors.length} embeddings`);

                // Upload to Pinecone
                await this.uploadToPinecone(vectors);
                console.log(`      ✅ Uploaded to Pinecone\n`);

                this.stats.reindexed++;

            } catch (error) {
                console.log(`      ❌ Error: ${error.message}\n`);
                this.stats.errors.push({ file: file.name, error: error.message });
            }
        }
    }

    /**
     * Delete vectors for files removed from Drive
     */
    async deleteRemovedFiles() {
        for (let i = 0; i < this.stats.deletedFiles.length; i++) {
            const file = this.stats.deletedFiles[i];
            console.log(`   [${i + 1}/${this.stats.deletedFiles.length}] Deleting: ${file.name}`);

            if (this.dryRun) {
                console.log(`      [DRY RUN] Would delete ${file.vectorIds.length} vectors\n`);
                continue;
            }

            try {
                console.log(`      🗑️  Deleting ${file.vectorIds.length} vectors`);
                await this.index.deleteMany(file.vectorIds);
                console.log(`      ✅ Deleted from Pinecone\n`);

                this.stats.deleted++;

            } catch (error) {
                console.log(`      ❌ Error: ${error.message}\n`);
                this.stats.errors.push({ file: file.name, error: error.message });
            }
        }
    }

    /**
     * Extract text from Google Doc
     */
    async extractGoogleDoc(fileId) {
        const doc = await this.docs.documents.get({ documentId: fileId });
        return this.extractTextFromDocContent(doc.data.body.content);
    }

    /**
     * Extract text from Google Slides
     */
    async extractGoogleSlides(fileId) {
        const presentation = await this.slides.presentations.get({ presentationId: fileId });
        let text = '';

        for (const slide of presentation.data.slides) {
            if (slide.pageElements) {
                for (const element of slide.pageElements) {
                    if (element.shape && element.shape.text) {
                        text += this.extractTextFromDocContent(element.shape.text.textElements) + '\n\n';
                    }
                }
            }
        }

        return text;
    }

    /**
     * Extract text from Google Sheets
     */
    async extractGoogleSheets(fileId) {
        const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId: fileId });
        let text = '';

        for (const sheet of spreadsheet.data.sheets) {
            const sheetName = sheet.properties.title;
            text += `Sheet: ${sheetName}\n\n`;

            const result = await this.sheets.spreadsheets.values.get({
                spreadsheetId: fileId,
                range: sheetName
            });

            if (result.data.values) {
                for (const row of result.data.values) {
                    text += row.join(' | ') + '\n';
                }
            }

            text += '\n\n';
        }

        return text;
    }

    /**
     * Extract text from PDF
     */
    async extractPDF(fileId) {
        const response = await this.drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );

        const data = await pdfParse(Buffer.from(response.data));
        return data.text;
    }

    /**
     * Helper: Extract text from Google Docs/Slides content
     */
    extractTextFromDocContent(content) {
        if (!content) return '';

        let text = '';
        for (const element of content) {
            if (element.paragraph) {
                for (const textElement of element.paragraph.elements || []) {
                    if (textElement.textRun) {
                        text += textElement.textRun.content;
                    }
                }
            } else if (element.textRun) {
                text += element.textRun.content;
            }
        }

        return text;
    }

    /**
     * Chunk text into smaller pieces (EXACT same logic as index-missing-files.js)
     */
    chunkText(text, chunkSize = 1000, overlap = 200) {
        const chunks = [];
        const lines = text.split('\n');
        let currentChunk = '';
        let currentLines = [];

        for (const line of lines) {
            const lineLength = line.length + 1; // +1 for newline

            if (currentChunk.length + lineLength > chunkSize && currentChunk.length > 0) {
                chunks.push({
                    text: currentChunk.trim(),
                    lineFrom: currentLines[0] || 1,
                    lineTo: currentLines[currentLines.length - 1] || 1
                });

                // Keep overlap
                const overlapLines = [];
                let overlapText = '';
                for (let i = currentLines.length - 1; i >= 0; i--) {
                    const idx = lines.indexOf(lines[currentLines[i]]);
                    if (idx >= 0 && overlapText.length + lines[idx].length < overlap) {
                        overlapLines.unshift(currentLines[i]);
                        overlapText = lines[idx] + '\n' + overlapText;
                    } else {
                        break;
                    }
                }

                currentChunk = overlapText;
                currentLines = overlapLines;
            }

            currentChunk += line + '\n';
            currentLines.push(lines.indexOf(line) + 1);
        }

        if (currentChunk.trim()) {
            chunks.push({
                text: currentChunk.trim(),
                lineFrom: currentLines[0] || 1,
                lineTo: currentLines[currentLines.length - 1] || 1
            });
        }

        return chunks;
    }

    /**
     * Create embedding vectors for chunks (EXACT same format as index-missing-files.js)
     */
    async createVectors(file, chunks) {
        const vectors = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            // Create embedding
            const embeddingResponse = await this.openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: chunk.text
            });

            const embedding = embeddingResponse.data[0].embedding;

            // Create vector - exact same metadata format as index-missing-files.js
            vectors.push({
                id: `${file.id}_chunk_${i}_${uuidv4()}`,
                values: embedding,
                metadata: {
                    'File.name': file.name,
                    'File.id': file.id,
                    'File.webviewlink': file.webViewLink || file.webviewLink,
                    'File.createdDate': file.createdTime?.split('T')[0] || '',
                    'File.modifiedDate': file.modifiedTime?.split('T')[0] || '',
                    'text': chunk.text,
                    'blobType': file.mimeType,
                    'loc.lines.from': chunk.lineFrom,
                    'loc.lines.to': chunk.lineTo
                }
            });
        }

        return vectors;
    }

    /**
     * Upload vectors to Pinecone in batches
     */
    async uploadToPinecone(vectors) {
        const batchSize = 200;

        for (let i = 0; i < vectors.length; i += batchSize) {
            const batch = vectors.slice(i, i + batchSize);
            await this.index.upsert(batch);
        }
    }

    /**
     * Rebuild document catalog
     */
    async rebuildCatalog() {
        console.log('   🔧 Running catalog builder...\n');

        try {
            execSync('node scripts/build-identity-focused-catalog.js', {
                stdio: 'inherit',
                cwd: process.cwd()
            });

            console.log('\n   ✅ Catalog rebuilt successfully\n');
        } catch (error) {
            console.log(`   ❌ Catalog rebuild failed: ${error.message}\n`);
            this.stats.errors.push({ file: 'catalog-rebuild', error: error.message });
        }
    }

    /**
     * Export catalog to CSV
     */
    async exportCatalogCSV() {
        console.log('   📊 Exporting to CSV...\n');

        try {
            execSync('node scripts/export-catalog-csv.js', {
                stdio: 'inherit',
                cwd: process.cwd()
            });

            console.log('\n   ✅ CSV exported successfully\n');
        } catch (error) {
            console.log(`   ❌ CSV export failed: ${error.message}\n`);
            this.stats.errors.push({ file: 'csv-export', error: error.message });
        }
    }

    /**
     * Save sync log
     */
    async saveSyncLog() {
        const logEntry = {
            timestamp: new Date().toISOString(),
            stats: {
                filesInDrive: this.stats.filesInDrive,
                filesInPinecone: this.stats.filesInPinecone,
                newFiles: this.stats.newFiles.map(f => f.name),
                modifiedFiles: this.stats.modifiedFiles.map(f => f.name),
                deletedFiles: this.stats.deletedFiles.map(f => f.name),
                indexed: this.stats.indexed,
                reindexed: this.stats.reindexed,
                deleted: this.stats.deleted,
                errors: this.stats.errors
            }
        };

        // Ensure logs directory exists
        await fs.mkdir('./logs', { recursive: true });

        // Append to log file
        const logPath = './logs/sync-log.jsonl';
        await fs.appendFile(
            logPath,
            JSON.stringify(logEntry) + '\n'
        );

        console.log(`📝 Sync log saved to: ${logPath}\n`);
    }

    /**
     * Print final summary
     */
    printSummary() {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('                    SYNC SUMMARY');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log(`📊 Statistics:`);
        console.log(`   Files in Google Drive:  ${this.stats.filesInDrive}`);
        console.log(`   Files in Pinecone:      ${this.stats.filesInPinecone}`);
        console.log(`   New files indexed:      ${this.stats.indexed}`);
        console.log(`   Modified files updated: ${this.stats.reindexed}`);
        console.log(`   Deleted files removed:  ${this.stats.deleted}`);
        console.log(`   Errors encountered:     ${this.stats.errors.length}\n`);

        if (this.stats.errors.length > 0) {
            console.log(`❌ Errors:`);
            for (const error of this.stats.errors) {
                console.log(`   - ${error.file}: ${error.error}`);
            }
            console.log();
        }

        const totalChanges = this.stats.indexed + this.stats.reindexed + this.stats.deleted;

        if (this.dryRun) {
            console.log(`🔍 DRY RUN - No changes were made`);
            console.log(`   Would have processed ${totalChanges} changes\n`);
        } else if (totalChanges === 0) {
            console.log('✅ Everything is up to date - no changes needed!\n');
        } else {
            console.log(`✅ Sync complete - ${totalChanges} changes processed\n`);
        }

        console.log('═══════════════════════════════════════════════════════════\n');
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');

    const syncer = new PineconeCatalogSyncer({ dryRun });
    await syncer.sync();
}

main().catch(error => {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
});
