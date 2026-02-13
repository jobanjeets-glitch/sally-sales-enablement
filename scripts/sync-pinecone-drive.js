#!/usr/bin/env node

import { google } from 'googleapis';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { createWorker } from 'tesseract.js';
import { pdfToPng } from 'pdf-to-png-converter';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

dotenv.config();

/**
 * Full Sync Script - Indexes NEW and MODIFIED files
 */
class IntelligentSync {
    constructor() {
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
        this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        this.index = this.pinecone.index(process.env.PINECONE_INDEX_NAME);
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.folderTree = new Map();
    }

    async scanGoogleDrive(rootFolderId) {
        const allFiles = [];

        const scanFolder = async (folderId, path = '') => {
            const response = await this.drive.files.list({
                q: `'${folderId}' in parents and trashed=false`,
                fields: 'files(id, name, mimeType, modifiedTime, createdTime, webViewLink, parents, size, version, md5Checksum)',
                pageSize: 1000,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });

            for (const item of response.data.files) {
                if (item.mimeType === 'application/vnd.google-apps.folder') {
                    const folderPath = path ? `${path}/${item.name}` : item.name;
                    this.folderTree.set(item.id, { id: item.id, name: item.name, path: folderPath });
                    await scanFolder(item.id, folderPath);
                } else {
                    const filePath = path || 'Root';
                    allFiles.push({ ...item, path: filePath, folderId: folderId });
                }
            }
        };

        await scanFolder(rootFolderId);
        return allFiles;
    }

    async loadPineconeState() {
        const pineconeFiles = new Map();
        const pineconeFilesByName = new Map();
        let latestSyncDate = null;

        const sampleResults = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 10000,
            includeMetadata: true
        });

        for (const match of sampleResults.matches) {
            const fileId = match.metadata['File.id'];
            const fileName = match.metadata['File.name'];
            const lastSyncDate = match.metadata['File.lastSyncDate'];

            // Track the latest sync date across all files
            if (lastSyncDate && (!latestSyncDate || lastSyncDate > latestSyncDate)) {
                latestSyncDate = lastSyncDate;
            }

            if (fileId) {
                if (!pineconeFiles.has(fileId)) {
                    pineconeFiles.set(fileId, {
                        'File.id': fileId,
                        'File.name': fileName,
                        'File.modifiedDate': match.metadata['File.modifiedDate'],
                        'File.lastSyncDate': lastSyncDate,
                        'File.version': match.metadata['File.version'] || 0,
                        'File.md5': match.metadata['File.md5'],
                        'File.size': match.metadata['File.size'],
                        vectorCount: 1,
                        hasFileId: true
                    });
                } else {
                    pineconeFiles.get(fileId).vectorCount++;
                }
            } else if (fileName) {
                if (!pineconeFilesByName.has(fileName)) {
                    pineconeFilesByName.set(fileName, {
                        'File.id': null,
                        'File.name': fileName,
                        'File.modifiedDate': match.metadata['File.modifiedDate'],
                        'File.lastSyncDate': lastSyncDate,
                        'File.version': match.metadata['File.version'] || 0,
                        'File.md5': match.metadata['File.md5'],
                        'File.size': match.metadata['File.size'],
                        vectorCount: 1,
                        hasFileId: false
                    });
                } else {
                    pineconeFilesByName.get(fileName).vectorCount++;
                }
            }
        }

        return { pineconeFiles, pineconeFilesByName, latestSyncDate };
    }

    filterFiles(files) {
        const shouldSkipFile = (file) => {
            const nameFilters = [
                { pattern: /archived/i, reason: 'Contains "archived"' },
                { pattern: /\(old\)/i, reason: 'Contains "(old)"' },
                { pattern: /deprecated/i, reason: 'Contains "deprecated"' },
                { pattern: /^Copy of/i, reason: 'Copy of another file' },
                { pattern: /\(copy\s*\d*\)/i, reason: 'Contains "(copy)"' },
                { pattern: /\~\$/, reason: 'Temporary file' }
            ];

            for (const filter of nameFilters) {
                if (filter.pattern.test(file.name)) return filter.reason;
            }

            if (/case\s*study/i.test(file.name) && !/case study slide library/i.test(file.name)) {
                return 'Individual case study (master library only)';
            }

            if (file.name === 'Profitero Comparison') {
                return 'Legacy file (superseded by Profitero Competitive Battle Card)';
            }

            return null;
        };

        const indexableMimeTypes = new Set([
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.presentation',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf'
        ]);

        const keep = [];

        for (const file of files) {
            if (file.mimeType === 'application/vnd.google-apps.shortcut') {
                continue;
            }

            const skipReason = shouldSkipFile(file);
            if (skipReason) continue;

            if (!indexableMimeTypes.has(file.mimeType)) {
                continue;
            }

            keep.push(file);
        }

        return keep;
    }

    detectDuplicates(files) {
        const normalizeName = (fileName) => {
            return fileName
                .replace(/\.(pdf|pptx?|docx?|xlsx?|gslides?|gdocs?|gsheet?)$/i, '')
                .replace(/[_\-\s]+/g, ' ')
                .replace(/\(copy\s*\d*\)/gi, '')
                .replace(/\s+version\s+\d+/gi, '')
                .toLowerCase()
                .trim();
        };

        const mimeTypePriority = [
            'application/vnd.google-apps.presentation',
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ];

        const groups = new Map();

        for (const file of files) {
            const normalizedName = normalizeName(file.name);
            if (!groups.has(normalizedName)) {
                groups.set(normalizedName, []);
            }
            groups.get(normalizedName).push(file);
        }

        const winners = [];

        for (const [name, group] of groups) {
            if (group.length === 1) {
                winners.push(group[0]);
            } else {
                const sorted = group.sort((a, b) => {
                    const priorityA = mimeTypePriority.indexOf(a.mimeType);
                    const priorityB = mimeTypePriority.indexOf(b.mimeType);
                    if (priorityA === priorityB) {
                        return new Date(b.modifiedTime) - new Date(a.modifiedTime);
                    }
                    return priorityA - priorityB;
                });
                winners.push(sorted[0]);
            }
        }

        return winners;
    }

    normalizeName(fileName) {
        return fileName
            .replace(/\.(pdf|pptx?|docx?|xlsx?|gslides?|gdocs?|gsheet?)$/i, '')
            .replace(/[_\-:]+/g, ' ')
            .replace(/\(copy\s*\d*\)/gi, '')
            .replace(/\s+v[a-z]\b/gi, '')
            .replace(/\s+v\d+(\.\d+)*/gi, '')
            .replace(/\s+_v\d+(\.\d+)*/gi, '')
            .replace(/\s+version\s+\d+/gi, '')
            .replace(/\bquarterly\s+industry\s+trends\b/gi, 'state of retail ecommerce')
            .replace(/\bthe\s+state\s+of\s+retail\s+ecommerce\b/gi, 'state of retail ecommerce')
            .replace(/\bindustry\s*trends\b/gi, 'state of retail ecommerce')
            .replace(/\bgen\s+ai\b/gi, 'generative ai')
            .replace(/\bai\s+goal\s+optimizer\b/gi, 'aigo')
            .replace(/\b202[0-9]\b/gi, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    isSimilarName(name1, name2) {
        const n1 = this.normalizeName(name1);
        const n2 = this.normalizeName(name2);

        if (n1 === n2) return true;

        if (n1.length >= 30 || n2.length >= 30) {
            if (n1.includes(n2) || n2.includes(n1)) return true;
        }

        return false;
    }

    classifyChanges(driveFiles, { pineconeFiles, pineconeFilesByName, latestSyncDate }) {
        const newFiles = [];
        const modifiedFiles = [];
        const unchangedFiles = [];

        // Use the latest sync date from Pinecone, or default to 30 days ago if none exists
        const cutoffDate = latestSyncDate
            ? new Date(latestSyncDate + 'T00:00:00Z')
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

        const allPineconeFiles = [];
        for (const data of pineconeFiles.values()) {
            allPineconeFiles.push(data);
        }
        for (const data of pineconeFilesByName.values()) {
            allPineconeFiles.push(data);
        }

        for (const file of driveFiles) {
            let pineconeData = pineconeFiles.get(file.id);

            if (!pineconeData) {
                pineconeData = pineconeFilesByName.get(file.name);
            }

            if (!pineconeData) {
                pineconeData = allPineconeFiles.find(p =>
                    this.isSimilarName(file.name, p['File.name'])
                );
            }

            if (!pineconeData) {
                newFiles.push(file);
                continue;
            }

            const fileModifiedDate = new Date(file.modifiedTime);
            if (fileModifiedDate <= cutoffDate) {
                unchangedFiles.push({
                    file,
                    reason: `Not modified since last sync (${cutoffDate.toISOString().split('T')[0]})`
                });
                continue;
            }

            if (!pineconeData.hasFileId) {
                modifiedFiles.push({
                    file,
                    signals: { legacyFile: true, needsFileId: true },
                    pineconeData,
                    reason: 'Legacy file without File.id - needs re-indexing'
                });
                continue;
            }

            const signals = {
                versionChanged: file.version && pineconeData['File.version'] &&
                                file.version > pineconeData['File.version'],
                dateChanged: new Date(file.modifiedTime) > new Date(pineconeData['File.modifiedDate'] + 'T00:00:00Z'),
                hashChanged: file.md5Checksum && pineconeData['File.md5'] &&
                            file.md5Checksum !== pineconeData['File.md5'],
                nameChanged: file.name !== pineconeData['File.name'],
                sizeChanged: file.size && pineconeData['File.size'] &&
                            Math.abs(file.size - pineconeData['File.size']) > 100
            };

            if (signals.versionChanged || signals.hashChanged || signals.sizeChanged || signals.dateChanged) {
                modifiedFiles.push({
                    file,
                    signals,
                    pineconeData
                });
            } else {
                unchangedFiles.push({
                    file,
                    reason: 'No changes detected'
                });
            }
        }

        return { newFiles, modifiedFiles, unchangedFiles };
    }

    // === INDEXING METHODS ===

    async extractGoogleDoc(fileId) {
        const doc = await this.docs.documents.get({ documentId: fileId });
        return this.extractTextFromDocContent(doc.data.body.content);
    }

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

    async extractPDF(fileId) {
        const response = await this.drive.files.get(
            {
                fileId,
                alt: 'media',
                supportsAllDrives: true
            },
            { responseType: 'arraybuffer' }
        );

        const buffer = Buffer.from(response.data);
        const data = await pdfParse(buffer);

        const trimmedText = data.text.trim();
        if (trimmedText.length > 50) {
            return data.text;
        }

        // OCR fallback
        console.log(`   ⚠️  Using OCR for ${fileId}...`);
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-'));
        const pdfPath = path.join(tempDir, 'document.pdf');
        await fs.writeFile(pdfPath, buffer);

        try {
            const pngPages = await pdfToPng(pdfPath, {
                outputFolder: tempDir,
                viewportScale: 2.0
            });

            const worker = await createWorker('eng');
            let fullText = '';
            for (let i = 0; i < pngPages.length; i++) {
                const { data: { text } } = await worker.recognize(pngPages[i].content);
                fullText += text + '\n\n';
            }

            await worker.terminate();
            await fs.rm(tempDir, { recursive: true, force: true });
            return fullText;
        } catch (error) {
            await fs.rm(tempDir, { recursive: true, force: true });
            throw error;
        }
    }

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

    chunkText(text, chunkSize = 1000, overlap = 200) {
        const chunks = [];
        const lines = text.split('\n');
        let currentChunk = '';
        let currentLines = [];

        for (const line of lines) {
            const lineLength = line.length + 1;

            if (currentChunk.length + lineLength > chunkSize && currentChunk.length > 0) {
                chunks.push({
                    text: currentChunk.trim(),
                    lineFrom: currentLines[0] || 1,
                    lineTo: currentLines[currentLines.length - 1] || 1
                });

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

    async createVectors(file, chunks) {
        const vectors = [];
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            const embeddingResponse = await this.openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: chunk.text
            });

            const embedding = embeddingResponse.data[0].embedding;

            vectors.push({
                id: `${file.id}_chunk_${i}_${uuidv4()}`,
                values: embedding,
                metadata: {
                    'File.name': file.name,
                    'File.id': file.id,
                    'File.webviewlink': file.webViewLink || file.webviewLink,
                    'File.createdDate': file.createdTime?.split('T')[0] || '',
                    'File.modifiedDate': file.modifiedTime?.split('T')[0] || '',
                    'File.lastSyncDate': today,  // Track when this file was indexed/synced
                    'text': chunk.text,
                    'blobType': file.mimeType,
                    'loc.lines.from': chunk.lineFrom,
                    'loc.lines.to': chunk.lineTo
                }
            });
        }

        return vectors;
    }

    async uploadToPinecone(vectors) {
        const batchSize = 200;

        for (let i = 0; i < vectors.length; i += batchSize) {
            const batch = vectors.slice(i, i + batchSize);
            await this.index.upsert(batch);
        }
    }

    async deleteFileVectors(fileId) {
        // Query all vectors for this file
        const results = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 10000,
            includeMetadata: true,
            filter: { 'File.id': { $eq: fileId } }
        });

        if (results.matches.length === 0) {
            return 0;
        }

        // Delete vectors
        const vectorIds = results.matches.map(m => m.id);
        await this.index.deleteMany(vectorIds);

        return vectorIds.length;
    }

    async indexFile(file) {
        console.log(`\n📄 Indexing: ${file.name}`);

        try {
            // Extract text
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
                console.log(`   ⚠️  Extracted text too short (${text.trim().length} chars), skipping`);
                return { success: false, reason: 'Text too short' };
            }

            // Chunk text
            const chunks = this.chunkText(text);
            console.log(`   ✓ Created ${chunks.length} chunks`);

            // Create vectors
            const vectors = await this.createVectors(file, chunks);
            console.log(`   ✓ Created ${vectors.length} embeddings`);

            // Upload to Pinecone
            await this.uploadToPinecone(vectors);
            console.log(`   ✅ Uploaded ${vectors.length} vectors`);

            return { success: true, chunks: chunks.length, vectors: vectors.length };

        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
            return { success: false, reason: error.message };
        }
    }

    async run() {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('           INTELLIGENT SYNC - FULL RUN');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log('📊 Phase 1: Scanning and Analysis\n');

        const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        const allFiles = await this.scanGoogleDrive(rootFolderId);
        console.log(`✓ Scanned ${allFiles.length} files from Drive`);

        const pineconeState = await this.loadPineconeState();
        console.log(`✓ Loaded ${pineconeState.pineconeFiles.size} files from Pinecone`);
        if (pineconeState.latestSyncDate) {
            console.log(`✓ Last sync date: ${pineconeState.latestSyncDate}`);
        } else {
            console.log(`⚠️  No previous sync date found (using 30-day lookback)`);
        }

        const filtered = this.filterFiles(allFiles);
        console.log(`✓ Filtered to ${filtered.length} indexable files`);

        const deduplicated = this.detectDuplicates(filtered);
        console.log(`✓ Deduplicated to ${deduplicated.length} files`);

        const { newFiles, modifiedFiles } = this.classifyChanges(deduplicated, pineconeState);

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log(`📊 Analysis Results:`);
        console.log(`   Last sync: ${pineconeState.latestSyncDate || 'Never (30-day lookback)'}`);
        console.log(`   NEW files: ${newFiles.length}`);
        console.log(`   MODIFIED files: ${modifiedFiles.length}`);
        console.log(`   TOTAL to process: ${newFiles.length + modifiedFiles.length}`);
        console.log('═══════════════════════════════════════════════════════════\n');

        const results = {
            newIndexed: 0,
            newFailed: 0,
            modifiedReIndexed: 0,
            modifiedFailed: 0
        };

        // Index NEW files
        if (newFiles.length > 0) {
            console.log('🆕 Phase 2: Indexing NEW Files\n');

            for (let i = 0; i < newFiles.length; i++) {
                const file = newFiles[i];
                console.log(`[${i + 1}/${newFiles.length}] ${file.name}`);

                const result = await this.indexFile(file);
                if (result.success) {
                    results.newIndexed++;
                } else {
                    results.newFailed++;
                }
            }
        }

        // Re-index MODIFIED files
        if (modifiedFiles.length > 0) {
            console.log('\n🔄 Phase 3: Re-indexing MODIFIED Files\n');

            for (let i = 0; i < modifiedFiles.length; i++) {
                const { file, pineconeData } = modifiedFiles[i];
                console.log(`[${i + 1}/${modifiedFiles.length}] ${file.name}`);

                // Delete old vectors
                const deleted = await this.deleteFileVectors(file.id);
                if (deleted > 0) {
                    console.log(`   🗑️  Deleted ${deleted} old vectors`);
                }

                // Re-index
                const result = await this.indexFile(file);
                if (result.success) {
                    results.modifiedReIndexed++;
                } else {
                    results.modifiedFailed++;
                }
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('                    FINAL SUMMARY');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`NEW files:`);
        console.log(`   ✅ Indexed: ${results.newIndexed}`);
        console.log(`   ❌ Failed: ${results.newFailed}`);
        console.log(`\nMODIFIED files:`);
        console.log(`   ✅ Re-indexed: ${results.modifiedReIndexed}`);
        console.log(`   ❌ Failed: ${results.modifiedFailed}`);
        console.log(`\nTOTAL:`);
        console.log(`   ✅ Success: ${results.newIndexed + results.modifiedReIndexed}`);
        console.log(`   ❌ Failed: ${results.newFailed + results.modifiedFailed}`);
        console.log('═══════════════════════════════════════════════════════════\n');

        // Return proper exit code
        const totalFailed = results.newFailed + results.modifiedFailed;
        if (totalFailed > 0) {
            console.log(`⚠️  Exiting with code 1 due to ${totalFailed} failed file(s)\n`);
            return 1;
        }

        console.log('✅ All files synced successfully!\n');
        return 0;
    }
}

const sync = new IntelligentSync();
sync.run()
    .then((exitCode) => {
        process.exit(exitCode);
    })
    .catch((error) => {
        console.error('\n❌ FATAL ERROR:', error);
        process.exit(1);
    });
