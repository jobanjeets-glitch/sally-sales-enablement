#!/usr/bin/env node

import { google } from 'googleapis';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Index missing files from Google Drive to Pinecone
 */
class DriveIndexer {
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

        this.stats = {
            total: 0,
            success: 0,
            failed: 0,
            skipped: 0,
            totalChunks: 0
        };
    }

    /**
     * Main indexing function
     */
    async indexMissingFiles(priority = null) {
        console.log('🚀 Starting Batch Indexer for Missing Files\n');
        console.log('='.repeat(80) + '\n');

        // Load files to index
        const report = JSON.parse(await fs.readFile('./query/files-to-index.json', 'utf-8'));
        let filesToIndex = report.filesToIndex;

        // Filter by priority if specified
        if (priority) {
            filesToIndex = filesToIndex.filter(f =>
                f.priority.toLowerCase() === priority.toLowerCase()
            );
            console.log(`🎯 Filtering for ${priority} priority files\n`);
        }

        this.stats.total = filesToIndex.length;
        console.log(`📊 Total files to index: ${filesToIndex.length}\n`);
        console.log('='.repeat(80) + '\n');

        // Index each file
        for (let i = 0; i < filesToIndex.length; i++) {
            const file = filesToIndex[i];
            console.log(`\n[${i + 1}/${filesToIndex.length}] Processing: ${file.docName}`);
            console.log(`   Priority: ${file.priority} | Type: ${file.fileType}`);

            try {
                await this.indexFile(file);
                this.stats.success++;
                console.log(`   ✅ SUCCESS\n`);
            } catch (error) {
                this.stats.failed++;
                console.error(`   ❌ FAILED: ${error.message}\n`);
            }
        }

        // Print summary
        this.printSummary();
    }

    /**
     * Index a single file
     */
    async indexFile(file) {
        if (!file.fileId) {
            throw new Error('No file ID provided');
        }

        // Get file metadata
        const metadata = await this.drive.files.get({
            fileId: file.fileId,
            fields: 'id,name,mimeType,createdTime,modifiedTime,webViewLink',
            supportsAllDrives: true
        });

        const mimeType = metadata.data.mimeType;
        console.log(`   MIME Type: ${mimeType}`);

        // Extract text based on file type
        let text = '';

        if (mimeType === 'application/vnd.google-apps.document') {
            text = await this.extractGoogleDoc(file.fileId);
        } else if (mimeType === 'application/vnd.google-apps.presentation') {
            text = await this.extractGoogleSlides(file.fileId);
        } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
            text = await this.extractGoogleSheets(file.fileId);
        } else if (mimeType === 'application/pdf') {
            text = await this.extractPDF(file.fileId);
        } else if (mimeType.includes('wordprocessingml')) {
            text = await this.extractDocx(file.fileId);
        } else if (mimeType.includes('presentationml')) {
            text = await this.extractPptx(file.fileId);
        } else {
            throw new Error(`Unsupported file type: ${mimeType}`);
        }

        if (!text || text.trim().length < 50) {
            throw new Error('Extracted text too short or empty');
        }

        console.log(`   📝 Extracted ${text.length} characters`);

        // Chunk text
        const chunks = this.chunkText(text);
        console.log(`   ✂️  Created ${chunks.length} chunks`);

        // Create vectors
        const vectors = await this.createVectors(chunks, file, metadata.data);
        console.log(`   🔢 Created ${vectors.length} vectors`);

        // Upload to Pinecone
        await this.uploadToPinecone(vectors);
        console.log(`   ☁️  Uploaded to Pinecone`);

        this.stats.totalChunks += chunks.length;
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
     * Extract text from DOCX
     */
    async extractDocx(fileId) {
        const response = await this.drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );

        const result = await mammoth.extractRawText({ buffer: Buffer.from(response.data) });
        return result.value;
    }

    /**
     * Extract text from PPTX
     */
    async extractPptx(fileId) {
        // For PPTX, export as plain text using Drive API
        const response = await this.drive.files.export({
            fileId,
            mimeType: 'text/plain',
            supportsAllDrives: true
        });

        return response.data;
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
     * Create vectors with embeddings
     */
    async createVectors(chunks, file, metadata) {
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
                id: `${file.fileId}_chunk_${i}_${uuidv4()}`,
                values: embedding,
                metadata: {
                    'File.name': metadata.name,
                    'File.id': metadata.id,
                    'File.webviewlink': metadata.webViewLink,
                    'File.createdDate': metadata.createdTime?.split('T')[0] || '',
                    'File.modifiedDate': metadata.modifiedTime?.split('T')[0] || '',
                    text: chunk.text,
                    blobType: metadata.mimeType,
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
        }
    }

    /**
     * Print summary
     */
    printSummary() {
        console.log('\n' + '='.repeat(80));
        console.log('\n📊 INDEXING COMPLETE!\n');
        console.log('='.repeat(80) + '\n');
        console.log(`✅ Success: ${this.stats.success}/${this.stats.total} files`);
        console.log(`❌ Failed: ${this.stats.failed}/${this.stats.total} files`);
        console.log(`📦 Total chunks created: ${this.stats.totalChunks}`);
        console.log(`\n🎯 Next steps:`);
        console.log(`   1. Run: npm run build-enhanced-catalog`);
        console.log(`   2. Run: npm run export-catalog-csv`);
        console.log(`   3. Test searches!\n`);
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    const priority = args.includes('--priority')
        ? args[args.indexOf('--priority') + 1]
        : null;

    const indexer = new DriveIndexer();
    await indexer.indexMissingFiles(priority);
}

main().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
});
