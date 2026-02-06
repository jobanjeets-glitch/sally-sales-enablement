/**
 * Delete a specific file from Pinecone index
 * Usage: npm run delete-file "File Name Here"
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

async function deleteFile() {
    const fileName = process.argv[2];

    if (!fileName) {
        console.log('\n❌ Usage: npm run delete-file "File Name Here"\n');
        console.log('Example: npm run delete-file "Profitero Competitive Battle Card (Updated May 24)"');
        process.exit(1);
    }

    console.log('\n🗑️  Delete File from Pinecone Index\n');
    console.log('File to delete: ' + fileName);

    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Find vectors for this file
    console.log('\nSearching for vectors...');

    const response = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: fileName
    });

    const result = await index.query({
        vector: response.data[0].embedding,
        topK: 500,
        includeMetadata: true,
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

    // Confirm deletion
    const confirm = await ask('\n⚠️  Delete these ' + vectors.length + ' vectors? (yes/no): ');

    if (confirm.toLowerCase() !== 'yes') {
        console.log('\n❌ Cancelled.\n');
        rl.close();
        return;
    }

    // Delete vectors
    console.log('\nDeleting...');
    const ids = vectors.map(v => v.id);
    await index.deleteMany(ids);

    // Verify
    const stats = await index.describeIndexStats();
    console.log('\n✅ Deleted ' + ids.length + ' vectors');
    console.log('Remaining vectors in index: ' + stats.totalRecordCount + '\n');

    rl.close();
}

deleteFile().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
