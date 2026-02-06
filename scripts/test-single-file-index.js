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
 * Test indexing a single file
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
     * Index a single file
     */
    async indexFile(file) {
        console.log('🚀 Testing Single File Indexer\n');
        console.log('='.repeat(80) + '\n');
        console.log(`📄 File: ${file.docName}`);
        console.log(`🆔 File ID: ${file.fileId}`);
        console.log(`📂 Type: ${file.fileType}`);
        console.log(`⭐ Priority: ${file.priority}\n`);
        console.log('='.repeat(80) + '\n');

        if (!file.fileId) {
            throw new Error('No file ID provided');
        }

        try {
            // Step 1: Get file metadata
            console.log('📋 Step 1: Getting file metadata...');
            const metadata = await this.drive.files.get({
                fileId: file.fileId,
                fields: 'id,name,mimeType,createdTime,modifiedTime,webViewLink',
                supportsAllDrives: true
            });

            const mimeType = metadata.data.mimeType;
            console.log(`   ✓ Name: ${metadata.data.name}`);
            console.log(`   ✓ MIME Type: ${mimeType}`);
            console.log(`   ✓ Created: ${metadata.data.createdTime}`);
            console.log(`   ✓ Modified: ${metadata.data.modifiedTime}\n`);

            // Step 2: Extract text
            console.log('📝 Step 2: Extracting text content...');
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

            console.log(`   ✓ Extracted ${text.length} characters`);
            console.log(`   ✓ Preview: ${text.substring(0, 150)}...\n`);

            // Step 3: Chunk text
            console.log('✂️  Step 3: Chunking text (size=1000, overlap=200)...');
            const chunks = this.chunkText(text);
            console.log(`   ✓ Created ${chunks.length} chunks\n`);

            // Step 4: Create embeddings
            console.log('🔢 Step 4: Creating embeddings (text-embedding-3-large)...');
            const vectors = await this.createVectors(chunks, file, metadata.data);
            console.log(`   ✓ Created ${vectors.length} vectors`);
            console.log(`   ✓ Vector dimension: ${vectors[0].values.length}`);
            console.log(`   ✓ Sample metadata:`, JSON.stringify(vectors[0].metadata, null, 2).substring(0, 200) + '...\n');

            // Step 5: Upload to Pinecone
            console.log('☁️  Step 5: Uploading to Pinecone (batch size=200)...');
            await this.uploadToPinecone(vectors);
            console.log(`   ✓ Uploaded ${vectors.length} vectors\n`);

            // Success summary
            console.log('='.repeat(80));
            console.log('\n✅ SUCCESS! File indexed successfully\n');
            console.log('='.repeat(80) + '\n');
            console.log('📊 Summary:');
            console.log(`   • File: ${file.docName}`);
            console.log(`   • Characters extracted: ${text.length}`);
            console.log(`   • Chunks created: ${chunks.length}`);
            console.log(`   • Vectors uploaded: ${vectors.length}`);
            console.log(`   • Embedding model: text-embedding-3-large`);
            console.log(`   • Vector dimension: 3072\n`);

        } catch (error) {
            console.error('\n❌ ERROR:', error.message);
            throw error;
        }
    }

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
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );

        const data = await pdfParse(Buffer.from(response.data));
        return data.text;
    }

    async extractDocx(fileId) {
        const response = await this.drive.files.get(
            { fileId, alt: 'media', supportsAllDrives: true },
            { responseType: 'arraybuffer' }
        );

        const result = await mammoth.extractRawText({ buffer: Buffer.from(response.data) });
        return result.value;
    }

    async extractPptx(fileId) {
        const response = await this.drive.files.export({
            fileId,
            mimeType: 'text/plain',
            supportsAllDrives: true
        });

        return response.data;
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

    async createVectors(chunks, file, metadata) {
        const vectors = [];

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];

            const embeddingResponse = await this.openai.embeddings.create({
                model: 'text-embedding-3-large',
                input: chunk.text
            });

            const embedding = embeddingResponse.data[0].embedding;

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

    async uploadToPinecone(vectors) {
        const batchSize = 200;

        for (let i = 0; i < vectors.length; i += batchSize) {
            const batch = vectors.slice(i, i + batchSize);
            await this.index.upsert(batch);
        }
    }
}

// Main execution
async function main() {
    // Load files to index
    const report = JSON.parse(await fs.readFile('./query/files-to-index.json', 'utf-8'));
    const highPriorityFiles = report.filesToIndex.filter(f => f.priority === 'High');

    // Get the first high-priority file
    const testFile = highPriorityFiles[0];

    const indexer = new SingleFileIndexer();
    await indexer.indexFile(testFile);
}

main().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
});
