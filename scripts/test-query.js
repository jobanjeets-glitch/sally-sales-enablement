import { RAGProcessor } from '../query/rag-processor.js';
import dotenv from 'dotenv';

dotenv.config();

async function testQuery() {
    console.log('\n🧪 Sally RAG Query Test\n');
    console.log('This script tests the RAG query engine without Slack.\n');

    const ragProcessor = new RAGProcessor();

    // Sample test questions
    const testQuestions = [
        "What is our pricing model?",
        "How do we handle security objections?",
        "Who are our main competitors?",
        "What are the key features of our platform?",
        "What is the implementation timeline?"
    ];

    console.log('📋 Running test queries...\n');
    console.log('=' .repeat(80));

    for (let i = 0; i < testQuestions.length; i++) {
        const question = testQuestions[i];

        console.log(`\n\n🔍 TEST ${i + 1}/${testQuestions.length}`);
        console.log(`Question: "${question}"\n`);

        try {
            const result = await ragProcessor.query(question, 5);

            // Display answer
            console.log('💬 ANSWER:');
            console.log('-'.repeat(80));
            console.log(result.answer);
            console.log('-'.repeat(80));

            // Display metadata
            console.log(`\n📊 METADATA:`);
            console.log(`   Confidence: ${result.confidence}`);
            console.log(`   Sources found: ${result.citations.length}`);

            if (result.relevanceScores && result.relevanceScores.length > 0) {
                const avgScore = result.relevanceScores.reduce((a, b) => a + b, 0) / result.relevanceScores.length;
                console.log(`   Avg relevance score: ${(avgScore * 100).toFixed(1)}%`);
            }

            // Display citations
            if (result.citations && result.citations.length > 0) {
                console.log(`\n📚 CITATIONS:`);
                result.citations.forEach((citation, idx) => {
                    console.log(`   ${idx + 1}. ${citation.source} (Page ${citation.page}) - ${(citation.relevanceScore * 100).toFixed(1)}%`);
                });
            }

        } catch (error) {
            console.error(`\n❌ ERROR: ${error.message}`);
            console.error(error.stack);
        }

        // Separator between tests
        if (i < testQuestions.length - 1) {
            console.log('\n' + '='.repeat(80));
        }
    }

    console.log('\n\n✅ Test completed!\n');
}

// Run the test
testQuery().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
});
