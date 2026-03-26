/**
 * test-router.js
 *
 * 20 test cases evaluating the intent router's classification accuracy.
 * Run: node agent/test-router.js
 */

import { classifyIntent } from './router.js';
import dotenv from 'dotenv';
dotenv.config();

const TEST_CASES = [
    // ── EASY: Document ──────────────────────────────────────────────────────────
    {
        id: 1,
        query: 'Send me the AllyAI first call deck',
        expected: 'document',
        difficulty: 'easy',
        note: 'Classic document request — "send me" + deck type',
    },
    {
        id: 2,
        query: 'Find me the Pacvue battle card',
        expected: 'document',
        difficulty: 'easy',
        note: '"find me" + "battle card" — two strong signals',
    },
    {
        id: 3,
        query: 'Give me the PRA one-pager',
        expected: 'document',
        difficulty: 'easy',
        note: '"give me" + "one-pager"',
    },
    {
        id: 4,
        query: 'List all battle cards we have',
        expected: 'document',
        difficulty: 'easy',
        note: '"list all" is a document signal',
    },
    {
        id: 5,
        query: 'I need a deck for my call tomorrow',
        expected: 'document',
        difficulty: 'easy',
        note: '"i need a deck" — explicit document request',
    },

    // ── EASY: Information ───────────────────────────────────────────────────────
    {
        id: 6,
        query: 'What are the key features of RMM?',
        expected: 'information',
        difficulty: 'easy',
        note: 'Pure product question, no action signals',
    },
    {
        id: 7,
        query: 'How does DSA compare to Profitero?',
        expected: 'information',
        difficulty: 'easy',
        note: 'Competitive comparison question',
    },
    {
        id: 8,
        query: 'What is Profit Recovery Automation?',
        expected: 'information',
        difficulty: 'easy',
        note: 'Basic product definition question',
    },

    // ── EASY: Synthesis ─────────────────────────────────────────────────────────
    {
        id: 9,
        query: 'Create a pitch for Nike',
        expected: 'synthesis',
        difficulty: 'easy',
        note: '"create a" + "pitch" — two strong synthesis signals',
    },
    {
        id: 10,
        query: 'Draft an outreach email for Walmart',
        expected: 'synthesis',
        difficulty: 'easy',
        note: '"draft" + "email" — clear synthesis',
    },
    {
        id: 11,
        query: 'Build me an account plan for Target',
        expected: 'synthesis',
        difficulty: 'easy',
        note: '"build" + "account plan"',
    },
    {
        id: 12,
        query: 'I have a meeting with Unilever tomorrow, help me prepare',
        expected: 'synthesis',
        difficulty: 'easy',
        note: '"meeting with" + "prepare"',
    },

    // ── TOUGH: Ambiguous or cross-intent ────────────────────────────────────────
    {
        id: 13,
        query: 'What case studies do we have for CPG brands?',
        expected: 'document',
        difficulty: 'tough',
        note: '"do we have" is a doc signal but "what case studies" sounds like info. Should find CSSL.',
    },
    {
        id: 14,
        query: 'How do we compare against Pacvue for a mid-market retailer?',
        expected: 'information',
        difficulty: 'tough',
        note: 'Competitive question — no doc/synthesis signals, but phrased conversationally',
    },
    {
        id: 15,
        query: 'What should I lead with on a first call with a grocery chain?',
        expected: 'synthesis',
        difficulty: 'tough',
        note: 'Meeting prep intent — but no explicit synthesis keyword. Needs Haiku.',
    },
    {
        id: 16,
        query: 'Pull together our best proof points against Salsify',
        expected: 'synthesis',
        difficulty: 'tough',
        note: '"pull together" is a composition signal but not in keyword list',
    },
    {
        id: 17,
        query: 'AllyAI vs Salesforce — what\'s our story?',
        expected: 'information',
        difficulty: 'tough',
        note: 'Competitive question with no doc/synthesis signals. Ambiguous phrasing.',
    },
    {
        id: 18,
        query: 'I need something for my demo with Amazon next week',
        expected: 'synthesis',
        difficulty: 'tough',
        note: '"demo for" is a synthesis signal, but "I need something" is vague — could mis-classify as document',
    },
    {
        id: 19,
        query: 'Can you help me get ready for a Kraft Heinz renewal conversation?',
        expected: 'synthesis',
        difficulty: 'tough',
        note: 'No explicit synthesis keyword — "get ready" and "renewal conversation" need Haiku to parse',
    },
    {
        id: 20,
        query: 'What deck should I use for a beauty brand that\'s never heard of us?',
        expected: 'document',
        difficulty: 'tough',
        note: 'Document request phrased as a question — no "send me / find me" signal, needs Haiku',
    },
];

const COLORS = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
    bold: '\x1b[1m',
};

async function runTests() {
    console.log(`\n${'═'.repeat(70)}`);
    console.log('  INTENT ROUTER — 20 TEST CASES');
    console.log(`${'═'.repeat(70)}\n`);

    let passed = 0;
    let failed = 0;
    const failures = [];

    for (const tc of TEST_CASES) {
        const difficulty = tc.difficulty === 'easy'
            ? `${COLORS.dim}easy${COLORS.reset}`
            : `${COLORS.yellow}tough${COLORS.reset}`;

        const result = await classifyIntent(tc.query);
        const ok = result === tc.expected;

        if (ok) {
            passed++;
            console.log(`${COLORS.green}✅ #${tc.id}${COLORS.reset} [${difficulty}] → ${result}`);
        } else {
            failed++;
            failures.push(tc);
            console.log(`${COLORS.red}❌ #${tc.id}${COLORS.reset} [${difficulty}] → got: ${COLORS.red}${result}${COLORS.reset}, expected: ${COLORS.green}${tc.expected}${COLORS.reset}`);
        }
        console.log(`   ${COLORS.dim}"${tc.query}"${COLORS.reset}`);
        console.log(`   ${COLORS.dim}${tc.note}${COLORS.reset}\n`);
    }

    // ── Summary ────────────────────────────────────────────────────────────────
    const easyTotal = TEST_CASES.filter(t => t.difficulty === 'easy').length;
    const toughTotal = TEST_CASES.filter(t => t.difficulty === 'tough').length;
    const easyPassed = TEST_CASES.filter(t => t.difficulty === 'easy' && !failures.find(f => f.id === t.id)).length;
    const toughPassed = TEST_CASES.filter(t => t.difficulty === 'tough' && !failures.find(f => f.id === t.id)).length;

    console.log(`${'═'.repeat(70)}`);
    console.log(`${COLORS.bold}  RESULTS${COLORS.reset}`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`  Overall : ${passed}/${TEST_CASES.length} (${Math.round(passed/TEST_CASES.length*100)}%)`);
    console.log(`  Easy    : ${easyPassed}/${easyTotal}`);
    console.log(`  Tough   : ${toughPassed}/${toughTotal}`);

    if (failures.length > 0) {
        console.log(`\n  ${COLORS.red}Failed:${COLORS.reset}`);
        failures.forEach(f => {
            console.log(`  • #${f.id}: "${f.query}"`);
            console.log(`    ${COLORS.dim}${f.note}${COLORS.reset}`);
        });
    }

    console.log(`${'═'.repeat(70)}\n`);
}

runTests().catch(err => {
    console.error('Test runner error:', err.message);
    process.exit(1);
});
