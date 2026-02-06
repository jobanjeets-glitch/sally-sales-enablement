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
 * Index a single file by name
 */
class SingleFileIndexer {
    constructor() {
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
    }

    /**
     * Find file in Google Drive by name
     */
    async findFile(fileName) {
        console.log(`🔍 Searching for file: "${fileName}"\n`);

        const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

        // Search recursively
        const allFiles = [];

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
                    await scanFolder(file.id);
                } else {
                    allFiles.push(file);
                }
            }
        };

        await scanFolder(folderId);

        // Find matching file (case-insensitive, partial match)
        const matches = allFiles.filter(f =>
            f.name.toLowerCase().includes(fileName.toLowerCase()) ||
            fileName.toLowerCase().includes(f.name.toLowerCase())
        );

        if (matches.length === 0) {
            throw new Error(`File not found: "${fileName}"`);
        }

        if (matches.length > 1) {
            console.log(`⚠️  Found ${matches.length} matches:\n`);
            matches.forEach((m, i) => {
                console.log(`   ${i + 1}. ${m.name}`);
                console.log(`      ID: ${m.id}`);
                console.log(`      Type: ${m.mimeType}\n`);
            });
            throw new Error('Multiple matches found. Please be more specific.');
        }

        const file = matches[0];
        console.log(`✓ Found file: ${file.name}`);
        console.log(`  ID: ${file.id}`);
        console.log(`  Type: ${file.mimeType}`);
        console.log(`  Modified: ${file.modifiedTime}\n`);

        return file;
    }

    /**
     * Check if file is already indexed
     */
    async checkIfIndexed(fileId) {
        console.log('🔍 Checking if already indexed...\n');

        const result = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 1,
            includeMetadata: true,
            filter: { 'File.id': { $eq: fileId } }
        });

        if (result.matches.length > 0) {
            const existing = result.matches[0].metadata;
            console.log(`⚠️  File is already indexed:`);
            console.log(`   Name: ${existing['File.name']}`);
            console.log(`   Modified Date: ${existing['File.modifiedDate']}`);
            console.log(`   Vectors: Found at least 1 chunk\n`);
            return true;
        }

        console.log('✓ File not indexed yet\n');
        return false;
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
     * Extract text from PDF (with OCR fallback)
     */
    async extractPDF(fileId) {
        // Download the PDF binary
        const response = await this.drive.files.get(
            {
                fileId,
                alt: 'media',
                supportsAllDrives: true
            },
            { responseType: 'arraybuffer' }
        );

        console.log(`   PDF size: ${response.data.byteLength} bytes`);

        // First try pdf-parse (fast path)
        const buffer = Buffer.from(response.data);
        const data = await pdfParse(buffer);

        console.log(`   PDF metadata: ${data.numpages} pages, ${data.text.length} chars extracted`);

        // Check if we got meaningful text (more than just whitespace)
        const trimmedText = data.text.trim();
        if (trimmedText.length > 50) {
            console.log(`   ✓ Text extracted successfully with pdf-parse`);
            return data.text;
        }

        // Fallback to OCR
        console.log(`   ⚠️  pdf-parse extracted no text, using OCR...`);

        // Save PDF to temp file
        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-ocr-'));
        const pdfPath = path.join(tempDir, 'document.pdf');
        await fs.writeFile(pdfPath, buffer);

        try {
            // Convert PDF to images
            console.log(`   📸 Converting PDF to images...`);
            const pngPages = await pdfToPng(pdfPath, {
                outputFolder: tempDir,
                viewportScale: 2.0 // Higher resolution for better OCR
            });

            console.log(`   🔍 Running OCR on ${pngPages.length} page(s)...`);

            // Initialize Tesseract worker
            const worker = await createWorker('eng');

            // OCR each page
            let fullText = '';
            for (let i = 0; i < pngPages.length; i++) {
                console.log(`      Processing page ${i + 1}/${pngPages.length}...`);
                const { data: { text } } = await worker.recognize(pngPages[i].content);
                fullText += text + '\n\n';
            }

            await worker.terminate();

            // Cleanup temp files
            await fs.rm(tempDir, { recursive: true, force: true });

            console.log(`   ✓ OCR completed: ${fullText.trim().length} chars extracted`);
            return fullText;

        } catch (error) {
            // Cleanup on error
            await fs.rm(tempDir, { recursive: true, force: true });
            throw error;
        }
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
     * Chunk text into smaller pieces
     */
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
     * Create vectors with embeddings
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

            // Create vector
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
     * Upload vectors to Pinecone
     */
    async uploadToPinecone(vectors) {
        const batchSize = 200;

        for (let i = 0; i < vectors.length; i += batchSize) {
            const batch = vectors.slice(i, i + batchSize);
            await this.index.upsert(batch);
            console.log(`   Uploaded batch ${Math.floor(i / batchSize) + 1} (${batch.length} vectors)`);
        }
    }

    /**
     * Index the file
     */
    async indexFile(fileName) {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('           INDEX SINGLE FILE');
        console.log('═══════════════════════════════════════════════════════════\n');

        try {
            // Find file
            const file = await this.findFile(fileName);

            // Check if already indexed
            const alreadyIndexed = await this.checkIfIndexed(file.id);
            if (alreadyIndexed) {
                console.log('❌ File is already indexed. Use --force to re-index.\n');
                return;
            }

            // Extract text
            console.log('📥 Extracting content...\n');
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

            console.log(`📊 Extraction result:`);
            console.log(`   Raw length: ${text.length} characters`);
            console.log(`   Trimmed length: ${text.trim().length} characters`);
            console.log(`   Raw text preview: "${text.substring(0, 200)}"`);

            if (text.trim().length > 0) {
                console.log(`   First 200 chars: "${text.trim().substring(0, 200)}..."\n`);
            }

            if (!text || text.trim().length < 50) {
                throw new Error(`Extracted text too short or empty (${text.trim().length} chars)`);
            }

            console.log(`✓ Extracted ${text.length} characters\n`);

            // Chunk text
            console.log('✂️  Chunking text...\n');
            const chunks = this.chunkText(text);
            console.log(`✓ Created ${chunks.length} chunks\n`);

            // Create vectors
            console.log('🧮 Creating embeddings...\n');
            const vectors = await this.createVectors(file, chunks);
            console.log(`✓ Created ${vectors.length} embeddings\n`);

            // Upload to Pinecone
            console.log('☁️  Uploading to Pinecone...\n');
            await this.uploadToPinecone(vectors);
            console.log('\n✅ Successfully indexed file!\n');

            // Summary
            console.log('═══════════════════════════════════════════════════════════');
            console.log('                    SUMMARY');
            console.log('═══════════════════════════════════════════════════════════');
            console.log(`File: ${file.name}`);
            console.log(`ID: ${file.id}`);
            console.log(`Type: ${file.mimeType}`);
            console.log(`Text length: ${text.length} characters`);
            console.log(`Chunks: ${chunks.length}`);
            console.log(`Vectors: ${vectors.length}`);
            console.log('═══════════════════════════════════════════════════════════\n');

        } catch (error) {
            console.error('\n❌ Error:', error.message);
            console.error(error.stack);
            process.exit(1);
        }
    }
}

// Main execution
async function main() {
    const fileName = process.argv[2];

    if (!fileName) {
        console.log('Usage: node scripts/index-single-file.js "File Name"');
        console.log('\nExample:');
        console.log('  node scripts/index-single-file.js "RMM Datasheet"');
        process.exit(1);
    }

    const indexer = new SingleFileIndexer();
    await indexer.indexFile(fileName);
}

main().catch(error => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});
