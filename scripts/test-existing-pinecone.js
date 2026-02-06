import { PineconeClient } from '../query/pinecone-client.js';
import dotenv from 'dotenv';

dotenv.config();

async function testExistingPinecone() {
    console.log('\n🔍 Testing Existing Pinecone Data\n');

    try {
        const pineconeClient = new PineconeClient();

        // 1. Check index stats
        console.log('📊 Checking index stats...');
        const stats = await pineconeClient.getStats();
        console.log(`   Total vectors: ${stats.totalRecordCount || 0}`);
        console.log(`   Dimensions: ${stats.dimension || 'unknown'}`);

        if (stats.totalRecordCount === 0) {
            console.log('\n⚠️  Index is empty. You need to index documents first.');
            console.log('   Options:');
            console.log('   1. Run: npm run index (to index from Google Drive)');
            console.log('   2. Or populate from your existing data source');
            return;
        }

        // 2. Test a sample query
        console.log('\n🧪 Testing sample query...');
        const testQuery = "What is pricing?";
        console.log(`   Query: "${testQuery}"`);

        const matches = await pineconeClient.query(testQuery, 3);

        if (matches.length === 0) {
            console.log('   ❌ No matches found. Check your data.');
            return;
        }

        console.log(`\n✅ Found ${matches.length} matches!\n`);

        // 3. Check metadata structure
        matches.forEach((match, idx) => {
            console.log(`Match ${idx + 1}:`);
            console.log(`   Score: ${(match.score * 100).toFixed(1)}%`);
            console.log(`   Metadata keys: ${Object.keys(match.metadata).join(', ')}`);

            // Check for required fields
            const hasText = match.metadata.text;
            const hasFileName = match.metadata.fileName;
            const hasPage = match.metadata.pageNumber || match.metadata.chunkIndex;

            console.log(`   ✓ Has 'text': ${hasText ? 'YES' : '❌ MISSING'}`);
            console.log(`   ✓ Has 'fileName': ${hasFileName ? 'YES' : '❌ MISSING'}`);
            console.log(`   ✓ Has page info: ${hasPage ? 'YES' : '⚠️  Optional but recommended'}`);

            if (hasText && hasText.length > 0) {
                console.log(`   Text preview: "${match.metadata.text.substring(0, 100)}..."`);
            }
            console.log('');
        });

        // 4. Compatibility check
        console.log('─'.repeat(80));
        console.log('\n🎯 COMPATIBILITY ASSESSMENT:\n');

        const firstMatch = matches[0];
        const hasRequiredFields = firstMatch.metadata.text && firstMatch.metadata.fileName;

        if (hasRequiredFields) {
            console.log('✅ Your Pinecone data is COMPATIBLE with Sally!');
            console.log('   You can skip indexing and go straight to:');
            console.log('   → Fill in Slack credentials in .env');
            console.log('   → Run: npm start');
        } else {
            console.log('⚠️  Your Pinecone data needs adjustment.');
            console.log('   Missing required metadata fields:');
            if (!firstMatch.metadata.text) console.log('   - text (REQUIRED)');
            if (!firstMatch.metadata.fileName) console.log('   - fileName (REQUIRED)');
            console.log('\n   Options:');
            console.log('   1. Re-index with npm run index');
            console.log('   2. Or I can help adapt the code to your metadata structure');
        }

    } catch (error) {
        console.error('\n❌ Error:', error.message);

        if (error.message.includes('API key')) {
            console.log('\n💡 Check your PINECONE_API_KEY in .env');
        } else if (error.message.includes('index')) {
            console.log('\n💡 Check your PINECONE_INDEX_NAME in .env');
        }
    }

    console.log('\n');
}

testExistingPinecone().catch(console.error);
