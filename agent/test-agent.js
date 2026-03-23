/**
 * Sally v2 Agent Test Script
 * Run: node agent/test-agent.js
 *
 * Tests all 3 agents (catalog, rag, synthesis) via the SallyAgent orchestrator.
 */
import { SallyAgent } from './sally-agent.js';

const testQueries = [
    {
        label: 'Document lookup → CatalogAgent',
        query: 'Send me the AllyAI first call deck',
        expectedAgent: 'catalog',
    },
    {
        label: 'Document browse → CatalogAgent',
        query: 'List all battle cards we have',
        expectedAgent: 'catalog',
    },
    {
        label: 'Product question → RAGAgent',
        query: 'What is the difference between DSA and DSO?',
        expectedAgent: 'rag',
    },
    {
        label: 'Competitive intel → RAGAgent',
        query: 'What are the key differentiators of RMM against Pacvue?',
        expectedAgent: 'rag',
    },
    {
        label: 'Synthesis task → SynthesisAgent',
        query: 'Create a pitch for Nike leveraging our CPG case studies',
        expectedAgent: 'synthesis',
    },
];

const agent = new SallyAgent();

(async () => {
    console.log('🚀 Sally v2 Agent Test\n');

    try {
        await agent.initialize();
    } catch (err) {
        console.error('❌ Initialization failed:', err.message);
        process.exit(1);
    }

    let passed = 0;
    let failed = 0;

    for (const test of testQueries) {
        console.log('\n' + '═'.repeat(70));
        console.log(`TEST: ${test.label}`);
        console.log(`QUERY: "${test.query}"`);
        console.log('─'.repeat(70));

        const start = Date.now();
        try {
            const result = await agent.query(test.query);
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const agentMatch = result.agent === test.expectedAgent ? '✅' : `⚠️  (expected: ${test.expectedAgent})`;

            console.log(`⏱  ${elapsed}s | 🤖 Agent: ${result.agent} ${agentMatch} | 🔧 Tools: ${result.toolsUsed.join(', ') || 'none'}`);
            console.log('\nANSWER:');
            console.log(result.answer);

            if (result.agent === test.expectedAgent) {
                passed++;
            } else {
                failed++;
            }
        } catch (err) {
            console.error(`❌ Query failed: ${err.message}`);
            failed++;
        }
    }

    console.log('\n' + '═'.repeat(70));
    console.log(`✅ ${passed}/${testQueries.length} routed correctly | ❌ ${failed} misrouted`);
    console.log('Test run complete');
})();
