import { PineconeClient } from '../query/pinecone-client.js';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

async function cleanupIndex() {
    console.log('\n🧹 Sally Index Cleanup Script\n');

    try {
        const pineconeClient = new PineconeClient();

        // Get current stats
        console.log('📊 Fetching current index stats...\n');
        const stats = await pineconeClient.getStats();

        console.log('Current Index Status:');
        console.log('─'.repeat(40));
        console.log(`Index name: ${process.env.PINECONE_INDEX_NAME || 'sally-sales-enablement'}`);
        console.log(`Total vectors: ${stats.totalRecordCount || 0}`);
        console.log(`Dimensions: ${stats.dimension || 'N/A'}`);

        if (stats.namespaces) {
            console.log('\nNamespaces:');
            for (const [ns, data] of Object.entries(stats.namespaces)) {
                console.log(`  ${ns || '(default)'}: ${data.recordCount} vectors`);
            }
        }
        console.log('─'.repeat(40));

        if (stats.totalRecordCount === 0) {
            console.log('\n✅ Index is already empty. Nothing to clean up.\n');
            rl.close();
            return;
        }

        // Ask what to do
        console.log('\nOptions:');
        console.log('  1. Delete ALL vectors (complete wipe)');
        console.log('  2. Exit without changes');

        const choice = await ask('\nEnter your choice (1 or 2): ');

        if (choice === '1') {
            const confirm = await ask('\n⚠️  Are you sure you want to delete ALL vectors? (type "yes" to confirm): ');

            if (confirm.toLowerCase() === 'yes') {
                console.log('\n🗑️  Deleting all vectors...');
                await pineconeClient.deleteAll();

                // Verify deletion
                const newStats = await pineconeClient.getStats();
                console.log(`\n✅ Cleanup complete! Vectors remaining: ${newStats.totalRecordCount || 0}\n`);
            } else {
                console.log('\n❌ Cleanup cancelled.\n');
            }
        } else {
            console.log('\n👋 Exiting without changes.\n');
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error.stack);
    } finally {
        rl.close();
    }
}

cleanupIndex();
