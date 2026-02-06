#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Add File.lastSyncDate metadata to all existing vectors
 * Uses today's date for all files
 */
class MetadataUpdater {
    constructor() {
        this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        this.index = this.pinecone.index(process.env.PINECONE_INDEX_NAME);
    }

    async updateAllVectors() {
        console.log('═══════════════════════════════════════════════════════════');
        console.log('      ADD SYNC DATE METADATA TO ALL VECTORS');
        console.log('═══════════════════════════════════════════════════════════\n');

        const today = new Date().toISOString().split('T')[0];
        console.log(`Using sync date: ${today}\n`);

        // Query all vectors (including values for re-upload)
        console.log('📊 Fetching all vectors from Pinecone...\n');
        const results = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 10000,
            includeMetadata: true,
            includeValues: true  // Need vector values for re-upload
        });

        console.log(`✓ Found ${results.matches.length} vectors\n`);

        // Group by file
        const fileGroups = new Map();
        let alreadyHasSyncDate = 0;
        let needsUpdate = 0;

        for (const match of results.matches) {
            const fileId = match.metadata['File.id'];
            const fileName = match.metadata['File.name'];
            const hasSyncDate = match.metadata['File.lastSyncDate'] ? true : false;

            if (hasSyncDate) {
                alreadyHasSyncDate++;
                continue;
            }

            needsUpdate++;

            const key = fileId || fileName;
            if (!fileGroups.has(key)) {
                fileGroups.set(key, []);
            }
            fileGroups.get(key).push(match);
        }

        console.log(`📊 Status:`);
        console.log(`   Already have sync date: ${alreadyHasSyncDate} vectors`);
        console.log(`   Need update: ${needsUpdate} vectors`);
        console.log(`   Files to update: ${fileGroups.size}\n`);

        if (needsUpdate === 0) {
            console.log('✅ All vectors already have sync date metadata!\n');
            return;
        }

        // Update vectors in batches (smaller batch size to avoid 2MB limit)
        console.log('🔄 Updating vectors...\n');
        let updatedCount = 0;
        const batchSize = 50;  // Reduced from 200 to avoid request size limits

        for (const [key, vectors] of fileGroups) {
            const fileName = vectors[0].metadata['File.name'];
            console.log(`   Updating ${vectors.length} vectors for: ${fileName}`);

            // Prepare update batch
            const updates = vectors.map(v => ({
                id: v.id,
                values: v.values,
                metadata: {
                    ...v.metadata,
                    'File.lastSyncDate': today
                }
            }));

            // Upload in batches
            for (let i = 0; i < updates.length; i += batchSize) {
                const batch = updates.slice(i, i + batchSize);
                await this.index.upsert(batch);
                updatedCount += batch.length;
            }
        }

        console.log(`\n✅ Successfully updated ${updatedCount} vectors!\n`);

        console.log('═══════════════════════════════════════════════════════════');
        console.log('                    SUMMARY');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`Sync date added: ${today}`);
        console.log(`Files updated: ${fileGroups.size}`);
        console.log(`Vectors updated: ${updatedCount}`);
        console.log(`Vectors unchanged: ${alreadyHasSyncDate}`);
        console.log('═══════════════════════════════════════════════════════════\n');
    }
}

const updater = new MetadataUpdater();
updater.updateAllVectors().catch(error => {
    console.error('❌ Error:', error.message);
    process.exit(1);
});
