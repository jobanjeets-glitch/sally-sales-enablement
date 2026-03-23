/**
 * Intent router — classifies a user query into one of three agent types.
 *
 * Priority: rule-based first (fast, zero latency), haiku fallback for ambiguous.
 *
 * Returns: 'document' | 'information' | 'synthesis'
 */
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Signals that a user wants a specific file/deck/link
const DOC_SIGNALS = [
    'send me', 'get me', 'find me', 'show me', 'give me',
    'i need a deck', 'i need the deck', 'need a link', 'need the link',
    'first call deck', 'second call deck', '1st call deck', '2nd call deck',
    'first call slide', 'second call slide',
    'battle card', 'battlecard',
    'product hub',
    'case study slide', 'cssl',
    'list all', 'list the', 'what decks', 'what documents', 'do we have a',
    'share the', 'share a',
    'link to', 'link for',
    'pitch deck', 'sales deck',
    'datasheet', 'one-pager', 'one pager',
];

// Signals that a user wants something composed or drafted
const SYNTHESIS_SIGNALS = [
    'create a', 'create an',
    'build a', 'build an',
    'draft a', 'draft an',
    'write a', 'write an',
    'put together',
    'prepare a pitch', 'help me pitch',
    'help me build', 'help me create', 'help me write', 'help me prepare',
    'generate a', 'generate an',
    'make a pitch', 'make an email',
    'outreach for', 'email for',
    // Meeting prep
    'prep me for', 'prepare me for', 'prepare for my',
    'meeting with', 'meeting prep', 'meeting brief',
    'i have a call with', 'i have a meeting with',
    'briefing for', 'account brief', 'account plan',
    'call with', 'demo for', 'pitch for',
];

/**
 * Rule-based classification — returns a result instantly if confident.
 * Returns null if the query is ambiguous (let haiku decide).
 */
function classifyByRules(question) {
    const q = question.toLowerCase();

    // Synthesis takes priority — it's the most specific signal
    for (const sig of SYNTHESIS_SIGNALS) {
        if (q.includes(sig)) return 'synthesis';
    }

    // Document lookup
    for (const sig of DOC_SIGNALS) {
        if (q.includes(sig)) return 'document';
    }

    return null; // ambiguous
}

/**
 * Haiku fallback for queries the rules can't confidently classify.
 */
async function classifyWithHaiku(question) {
    try {
        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5',
            max_tokens: 10,
            messages: [{
                role: 'user',
                content: `Classify this sales assistant query into exactly one word:
- "document" = user wants a specific file, deck, battle card, or link
- "information" = user wants facts, features, comparisons, or explanations
- "synthesis" = user wants you to create, draft, or compose something new

Query: "${question}"

Reply with only the single category word.`,
            }],
        });
        const text = response.content[0].text.trim().toLowerCase();
        if (text.startsWith('document')) return 'document';
        if (text.startsWith('synthesis')) return 'synthesis';
        return 'information';
    } catch (err) {
        console.warn('[Router] Haiku fallback failed, defaulting to information:', err.message);
        return 'information';
    }
}

/**
 * Main classification entry point.
 * @param {string} question
 * @returns {Promise<'document'|'information'|'synthesis'>}
 */
export async function classifyIntent(question) {
    const ruleResult = classifyByRules(question);
    if (ruleResult) {
        console.log(`   🔀 Route: ${ruleResult} (rules)`);
        return ruleResult;
    }

    const haikuResult = await classifyWithHaiku(question);
    console.log(`   🔀 Route: ${haikuResult} (haiku)`);
    return haikuResult;
}
