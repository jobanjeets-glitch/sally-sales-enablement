/**
 * Move a file from default namespace to archive namespace
 * Usage: npm run move-to-archive "File Name Here"
 */

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
}

async function moveToArchive() {
    const fileName = process.argv[2];

    if (!fileName) {
        console.log('\n❌ Usage: npm run move-to-archive "File Name Here"\n');
        console.log('Example: npm run move-to-archive "Profitero Competitive Battle Card (Updated May 24)"');
        process.exit(1);
    }

    console.log('\n📦 Move File to Archive Namespace\n');
    console.log('File to archive: ' + fileName);

    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Find vectors for this file (with values for transfer)
    console.log('\nSearching for vectors...');

    const response = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: fileName
    });

    const result = await index.query({
        vector: response.data[0].embedding,
        topK: 500,
        includeMetadata: true,
        includeValues: true,
        filter: { 'File.name': { $eq: fileName } }
    });

    const vectors = result.matches || [];

    if (vectors.length === 0) {
        console.log('\n⚠️  No vectors found for: ' + fileName);
        console.log('Check the exact file name using: npm run list-files\n');
        rl.close();
        return;
    }

    console.log('Found: ' + vectors.length + ' vectors');

    // Confirm move
    const confirm = await ask('\n⚠️  Move these ' + vectors.length + ' vectors to archive? (yes/no): ');

    if (confirm.toLowerCase() !== 'yes') {
        console.log('\n❌ Cancelled.\n');
        rl.close();
        return;
    }

    // Step 1: Upsert to archive namespace
    console.log('\n1. Copying to archive namespace...');
    const vectorsToUpsert = vectors.map(v => ({
        id: v.id,
        values: v.values,
        metadata: v.metadata
    }));

    const archiveNs = index.namespace('archive');
    await archiveNs.upsert(vectorsToUpsert);
    console.log('   Copied ' + vectorsToUpsert.length + ' vectors to archive');

    // Step 2: Delete from default namespace
    console.log('\n2. Deleting from default namespace...');
    const ids = vectors.map(v => v.id);
    await index.deleteMany(ids);
    console.log('   Deleted ' + ids.length + ' vectors from default');

    // Verify
    console.log('\n3. Verifying...');
    const stats = await index.describeIndexStats();
    console.log('   Default namespace: ' + (stats.namespaces?.['']?.recordCount || 0) + ' vectors');
    console.log('   Archive namespace: ' + (stats.namespaces?.['archive']?.recordCount || 0) + ' vectors');

    console.log('\n✅ Successfully moved "' + fileName + '" to archive\n');

    rl.close();
}

moveToArchive().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
