import { GoogleDriveScanner } from '../indexer/google-drive.js';
import { DocumentChunker } from '../indexer/chunker.js';
import { PineconeClient } from '../query/pinecone-client.js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

async function initialIndex() {
    console.log('\n🚀 Sally Initial Indexing Script\n');
    console.log('This will scan your Google Drive folder and index all documents into Pinecone.\n');

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';

    if (!folderId) {
        console.error('❌ GOOGLE_DRIVE_FOLDER_ID not set in .env');
        process.exit(1);
    }

    try {
        // 1. Initialize clients
        console.log('📡 Initializing Google Drive scanner...');
        const driveScanner = new GoogleDriveScanner(credentialsPath);

        console.log('🔧 Initializing Pinecone client...');
        const pineconeClient = new PineconeClient();

        console.log('📚 Initializing document chunker...');
        const chunker = new DocumentChunker();

        // 2. Get current index stats
        console.log('\n📊 Current Pinecone index stats:');
        const stats = await pineconeClient.getStats();
        console.log(`   Total vectors: ${stats.totalRecordCount || 0}`);

        // 3. Scan Google Drive
        console.log(`\n📂 Scanning Google Drive folder: ${folderId}`);
        const files = await driveScanner.listFiles(folderId);
        console.log(`✅ Found ${files.length} files to process\n`);

        if (files.length === 0) {
            console.log('⚠️  No files found. Check your folder ID and permissions.');
            return;
        }

        // 4. Process each file
        let totalChunks = 0;
        let processedFiles = 0;
        let skippedFiles = 0;

        for (const file of files) {
            console.log(`\n📄 Processing: ${file.name}`);
            console.log(`   Type: ${file.mimeType}`);
            console.log(`   Path: ${file.path}`);

            try {
                // Download file content
                const content = await driveScanner.downloadFile(file.id, file.mimeType);

                if (!content || content.trim().length === 0) {
                    console.log(`   ⏭️  Skipping - no extractable text content`);
                    skippedFiles++;
                    continue;
                }

                // Chunk the document
                const chunks = chunker.chunkText(content, {
                    maxChunkSize: 1000,
                    overlap: 200
                });

                console.log(`   ✂️  Created ${chunks.length} chunks`);

                // Create embeddings and prepare vectors
                const vectors = [];

                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];

                    // Show progress for large files
                    if (chunks.length > 10 && (i + 1) % 10 === 0) {
                        console.log(`   🔄 Processing chunk ${i + 1}/${chunks.length}...`);
                    }

                    // Create embedding
                    const embedding = await pineconeClient.createEmbedding(chunk);

                    // Prepare vector with metadata
                    vectors.push({
                        id: `${file.id}-chunk-${i}-${uuidv4()}`,
                        values: embedding,
                        metadata: {
                            fileName: file.name,
                            filePath: file.path,
                            fileId: file.id,
                            mimeType: file.mimeType,
                            modifiedTime: file.modifiedTime,
                            chunkIndex: i,
                            totalChunks: chunks.length,
                            text: chunk,
                            indexedAt: new Date().toISOString()
                        }
                    });
                }

                // Upsert to Pinecone
                console.log(`   ⬆️  Upserting ${vectors.length} vectors to Pinecone...`);
                await pineconeClient.upsertVectors(vectors);

                totalChunks += vectors.length;
                processedFiles++;
                console.log(`   ✅ Done! (${vectors.length} chunks indexed)`);

            } catch (error) {
                console.error(`   ❌ Error processing file: ${error.message}`);
                skippedFiles++;
            }
        }

        // 5. Final summary
        console.log('\n' + '='.repeat(60));
        console.log('📊 INDEXING COMPLETE');
        console.log('='.repeat(60));
        console.log(`✅ Files processed: ${processedFiles}`);
        console.log(`⏭️  Files skipped: ${skippedFiles}`);
        console.log(`📦 Total chunks indexed: ${totalChunks}`);

        // Get final stats
        const finalStats = await pineconeClient.getStats();
        console.log(`🎯 Total vectors in index: ${finalStats.totalRecordCount || 0}`);
        console.log('\n🎉 Sally is ready to answer questions!\n');

    } catch (error) {
        console.error('\n❌ Fatal error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the script
initialIndex().catch(console.error);
