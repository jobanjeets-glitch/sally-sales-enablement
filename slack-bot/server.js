import pkg from '@slack/bolt';
const { App } = pkg;
import express from 'express';
import fs from 'fs';
import path from 'path';
import { SallyAgent } from '../agent/sally-agent.js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Sally Agent v2
const sallyAgent = new SallyAgent();
sallyAgent.initialize().catch(err => console.error('❌ Sally init failed:', err));

// Initialize Slack app (Socket Mode — no public URL needed)
const app = new App({
    token: process.env.SALLY_SLACK_BOT_TOKEN,
    signingSecret: process.env.SALLY_SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SALLY_SLACK_APP_TOKEN,
});

// Health check server — required for Render to keep the process alive
const healthApp = express();
healthApp.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '2.0.0', agent: 'sally-v2' });
});
healthApp.listen(process.env.HEALTH_PORT || 3001, () => {
    console.log(`❤️  Health check listening on :${process.env.HEALTH_PORT || 3001}/health`);
});

// Capture bot user ID at startup so we can identify Sally's messages in threads
let BOT_USER_ID = null;
app.client.auth.test({ token: process.env.SALLY_SLACK_BOT_TOKEN })
    .then(r => { BOT_USER_ID = r.user_id; console.log(`🤖 Bot user ID: ${BOT_USER_ID}`); })
    .catch(() => {});

// ─── Feedback log ─────────────────────────────────────────────────────────────

const FEEDBACK_LOG = path.resolve('./var/feedback.jsonl');

/**
 * In-memory store: sent message ts → { question, answer, agent, askedBy, channel, threadTs }
 * Allows feedback handlers to look up the original Q&A when a button is clicked.
 * TTL: kept for 24h, then pruned.
 */
const responseStore = new Map();

function storeResponse(msgTs, data) {
    responseStore.set(msgTs, { ...data, storedAt: Date.now() });

    // Prune entries older than 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [ts, entry] of responseStore.entries()) {
        if (entry.storedAt < cutoff) responseStore.delete(ts);
    }
}

function logFeedback(entry) {
    try {
        fs.mkdirSync(path.dirname(FEEDBACK_LOG), { recursive: true });
        fs.appendFileSync(FEEDBACK_LOG, JSON.stringify(entry) + '\n');
    } catch (err) {
        console.error('Could not write feedback log:', err.message);
    }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * Convert markdown to Slack mrkdwn format.
 * - [text](url) → <url|text>  (hyperlinked document names)
 * - **bold**    → *bold*
 * - ## Header  → *Header*
 * - ---        → removed
 */
function formatForSlack(text) {
    if (!text) return text;

    // Markdown hyperlinks → Slack hyperlinks
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)\s]+)\)/g, '<$2|$1>');

    // **bold** → *bold*
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '*$1*');

    // ## Headers → *bold*
    text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

    // Horizontal rules → remove
    text = text.replace(/^\s*-{3,}\s*$/gm, '');

    // Trim excessive blank lines
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

/**
 * Build Slack Block Kit payload for a Sally response.
 * Includes the answer text + 👍/👎 feedback buttons.
 * Slack section blocks have a 3000 char limit — split if needed.
 */
function buildResponseBlocks(formattedAnswer, feedbackId) {
    const MAX_SECTION = 2900;
    const blocks = [];

    // Split long answers into multiple section blocks
    if (formattedAnswer.length <= MAX_SECTION) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: formattedAnswer } });
    } else {
        // Split on double newlines to avoid breaking mid-paragraph
        const chunks = [];
        let current = '';
        for (const line of formattedAnswer.split('\n')) {
            if ((current + '\n' + line).length > MAX_SECTION) {
                if (current) chunks.push(current.trim());
                current = line;
            } else {
                current = current ? current + '\n' + line : line;
            }
        }
        if (current) chunks.push(current.trim());
        for (const chunk of chunks) {
            blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
        }
    }

    // Feedback buttons
    blocks.push({ type: 'divider' });
    blocks.push({
        type: 'actions',
        block_id: `feedback_${feedbackId}`,
        elements: [
            {
                type: 'button',
                text: { type: 'plain_text', text: '👍 Helpful' },
                action_id: 'feedback_positive',
                style: 'primary',
                value: feedbackId,
            },
            {
                type: 'button',
                text: { type: 'plain_text', text: '👎 Not helpful' },
                action_id: 'feedback_negative',
                value: feedbackId,
            },
        ],
    });

    return blocks;
}

/**
 * Replace the feedback buttons with a "thank you" confirmation after click.
 */
function buildAckBlocks(originalBlocks, ackText) {
    // Keep all blocks except the last actions block + divider
    const contentBlocks = originalBlocks.filter(
        b => b.type !== 'actions' && b.type !== 'divider'
    );
    contentBlocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: ackText }],
    });
    return contentBlocks;
}

// ─── Thread context ───────────────────────────────────────────────────────────

async function buildThreadContext(client, channel, threadTs, currentMsgTs, limit = 10) {
    try {
        const result = await client.conversations.replies({
            channel,
            ts: threadTs,
            inclusive: true,
            limit: limit + 5,
        });

        const messages = (result.messages || [])
            .filter(m => m.ts !== currentMsgTs)
            .slice(-limit);

        if (messages.length === 0) return null;

        return messages.map(m => {
            const isBot = !!(m.bot_id || (BOT_USER_ID && m.user === BOT_USER_ID));
            const role = isBot ? 'Sally' : 'User';
            const text = (m.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
            return `${role}: ${text}`;
        }).join('\n');

    } catch (err) {
        console.warn('Could not fetch thread context:', err.message);
        return null;
    }
}

// ─── Core query + respond helper ─────────────────────────────────────────────

/**
 * Run a Sally query and post the response with feedback buttons.
 * Returns the sent message ts (used as feedbackId).
 */
async function queryAndRespond({ client, channel, threadTs, question, context, askedBy }) {
    const result = await sallyAgent.query(question, context);
    const formatted = formatForSlack(result.answer);

    // Use a timestamp-based ID for the feedback store key
    const feedbackId = `${channel}_${Date.now()}`;
    const blocks = buildResponseBlocks(formatted, feedbackId);

    const sent = await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: formatted,   // fallback for notifications
        blocks,
    });

    // Store Q&A for feedback lookup
    storeResponse(sent.ts, {
        feedbackId,
        question,
        answer: result.answer,
        agent: result.agent,
        askedBy,
        channel,
        threadTs,
    });

    console.log(`   ✅ Response sent (agent: ${result.agent} | tools: ${result.toolsUsed.join(', ') || 'none'})`);
    return sent;
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * Handle app mentions — @Sally <question>
 */
app.event('app_mention', async ({ event, client }) => {
    try {
        console.log(`\n📩 Mention from ${event.user}`);

        const question = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

        if (!question) {
            await client.chat.postMessage({
                channel: event.channel,
                thread_ts: event.ts,
                text: "Hi! I'm Sally, your sales enablement assistant. Ask me anything about our sales documentation!",
            });
            return;
        }

        console.log(`   Question: "${question}"`);

        const threadTs = event.thread_ts || event.ts;

        // Thinking indicator
        await client.chat.postMessage({
            channel: event.channel,
            text: '🔍 Searching sales documentation...',
            thread_ts: threadTs,
        });

        // Thread context
        let context = null;
        if (event.thread_ts) {
            context = await buildThreadContext(client, event.channel, event.thread_ts, event.ts);
            if (context) console.log(`   📜 Thread context: ${context.split('\n').length} messages`);
        }

        await queryAndRespond({
            client,
            channel: event.channel,
            threadTs,
            question,
            context,
            askedBy: event.user,
        });

    } catch (error) {
        console.error('❌ Error handling mention:', error);
        await client.chat.postMessage({
            channel: event.channel,
            text: 'I encountered an error while searching. Please try again.',
            thread_ts: event.thread_ts || event.ts,
        });
    }
});

/**
 * Handle all messages — DMs and channel messages.
 *
 * Sally responds to any message in:
 *   - DMs (no @mention needed)
 *   - Channels she's been added to (no @mention needed, always replies in thread)
 *
 * @mention is handled by app_mention above — skip those here to avoid double-firing.
 * Bot messages are skipped to prevent loops.
 */
app.message(async ({ message, client }) => {
    try {
        // Skip bot messages (prevents Sally responding to herself or other bots)
        if (message.subtype || message.bot_id) return;

        // Skip @mentions — handled by app_mention to avoid double responses
        if (BOT_USER_ID && message.text?.includes(`<@${BOT_USER_ID}>`)) return;

        const question = message.text?.trim();
        if (!question) return;

        const isDM = message.channel_type === 'im';
        const isAskSally = message.channel === 'C09H3DM4KED';

        // In other channels, ignore — @mention is required (handled by app_mention)
        if (!isDM && !isAskSally) return;

        // Skip very short messages in #ask-sally ("ok", "thanks", etc.)
        if (isAskSally && question.length < 10) return;

        console.log(`\n${isDM ? '💬 DM' : '📢 #ask-sally'} from ${message.user}: "${question}"`);

        const threadTs = message.thread_ts || message.ts;

        await client.chat.postMessage({
            channel: message.channel,
            text: '🔍 Searching sales documentation...',
            thread_ts: threadTs,
        });

        let context = null;
        if (message.thread_ts) {
            context = await buildThreadContext(client, message.channel, message.thread_ts, message.ts);
            if (context) console.log(`   📜 Thread context: ${context.split('\n').length} messages`);
        }

        await queryAndRespond({
            client,
            channel: message.channel,
            threadTs,
            question,
            context,
            askedBy: message.user,
        });

    } catch (error) {
        console.error('❌ Error handling message:', error);
        try {
            await client.chat.postMessage({
                channel: message.channel,
                text: 'I encountered an error while searching. Please try again.',
                thread_ts: message.thread_ts || message.ts,
            });
        } catch (_) {}
    }
});

// ─── Feedback actions ─────────────────────────────────────────────────────────

app.action('feedback_positive', async ({ body, ack, client }) => {
    await ack();

    const feedbackId = body.actions[0].value;
    const stored = [...responseStore.values()].find(e => e.feedbackId === feedbackId);

    logFeedback({
        type: 'positive',
        feedbackId,
        question: stored?.question || '(unknown)',
        agent: stored?.agent || '(unknown)',
        askedBy: body.user.id,
        channel: body.channel?.id,
        timestamp: new Date().toISOString(),
    });

    console.log(`   👍 Positive feedback from ${body.user.id}`);

    // Update message — remove buttons, show quiet ack
    try {
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            text: stored?.answer || body.message.text,
            blocks: buildAckBlocks(body.message.blocks, '👍 _Glad that was helpful!_'),
        });
    } catch (err) {
        console.warn('Could not update message after 👍:', err.message);
    }
});

app.action('feedback_negative', async ({ body, ack, client }) => {
    await ack();

    const feedbackId = body.actions[0].value;
    const stored = [...responseStore.values()].find(e => e.feedbackId === feedbackId);

    const entry = {
        type: 'negative',
        feedbackId,
        question: stored?.question || '(unknown)',
        answer: stored?.answer || '(unknown)',
        agent: stored?.agent || '(unknown)',
        askedBy: body.user.id,
        channel: body.channel?.id,
        timestamp: new Date().toISOString(),
    };

    logFeedback(entry);
    console.log(`   👎 Negative feedback from ${body.user.id} on: "${entry.question.substring(0, 60)}"`);

    // 1. Update the message — remove buttons, show ack
    try {
        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            text: stored?.answer || body.message.text,
            blocks: buildAckBlocks(
                body.message.blocks,
                '👎 _Thanks for the feedback — this helps us improve Sally._'
            ),
        });
    } catch (err) {
        console.warn('Could not update message after 👎:', err.message);
    }

    // 2. Ask for more detail in the thread
    try {
        await client.chat.postMessage({
            channel: body.channel.id,
            thread_ts: stored?.threadTs || body.message.ts,
            text: `_What was wrong with this response? Reply here — it goes directly to the Sally team. (Optional but very helpful)_`,
        });
    } catch (err) {
        console.warn('Could not post follow-up after 👎:', err.message);
    }

    // 3. DM the admin
    const adminUserId = process.env.SALLY_ADMIN_USER_ID;
    if (!adminUserId) return;

    try {
        const dmChannel = await client.conversations.open({ users: adminUserId });
        const channelLink = body.channel?.id
            ? `<#${body.channel.id}>`
            : 'DM';

        await client.chat.postMessage({
            channel: dmChannel.channel.id,
            text: `👎 *Sally got a thumbs down*`,
            blocks: [
                {
                    type: 'header',
                    text: { type: 'plain_text', text: '👎 Sally Feedback Alert' },
                },
                {
                    type: 'section',
                    fields: [
                        { type: 'mrkdwn', text: `*Asked by:*\n<@${body.user.id}>` },
                        { type: 'mrkdwn', text: `*Channel:*\n${channelLink}` },
                        { type: 'mrkdwn', text: `*Agent used:*\n${stored?.agent || 'unknown'}` },
                        { type: 'mrkdwn', text: `*Time:*\n${new Date().toLocaleString()}` },
                    ],
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Question asked:*\n>${entry.question}`,
                    },
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Sally's answer (first 500 chars):*\n>${entry.answer.substring(0, 500).replace(/\n/g, '\n>')}${entry.answer.length > 500 ? '…' : ''}`,
                    },
                },
                {
                    type: 'context',
                    elements: [{ type: 'mrkdwn', text: `Feedback log: \`var/feedback.jsonl\`` }],
                },
            ],
        });
    } catch (err) {
        console.error('Could not send admin DM for 👎 feedback:', err.message);
    }
});

// ─── Slash commands ───────────────────────────────────────────────────────────

app.command('/sally-help', async ({ command, ack, client }) => {
    await ack();

    await client.chat.postMessage({
        channel: command.channel_id,
        text: `*Sally v2 — Sales Enablement Assistant*

*How to use:*
• Mention me: \`@Sally your question\`
• Direct message me with your questions
• Follow up in the same thread — I remember the conversation

*What I can help with:*
• Finding specific decks, battle cards, and documents
• Product features, capabilities, and differentiators
• Competitive intel and objection handling
• Proof points, case studies, and ROI data
• Synthesizing multi-source pitches and proposals

*Tips:*
• Ask for specific documents: "Send me the RMM second call deck"
• Ask competitive questions: "How do we beat Pacvue on RMM?"
• Ask for synthesis: "Help me build a pitch for a CPG brand"
• Browse by type: "List all battle cards"

*For case studies, ask about the CSSL — it has all of them.*`,
    });
});

app.command('/sally-stats', async ({ command, ack, client }) => {
    await ack();

    try {
        const [pineconeStats, catalogStats] = await Promise.all([
            sallyAgent.pineconeClient.getStats(),
            Promise.resolve(sallyAgent.catalog.getCatalogStats()),
        ]);

        // Count feedback entries
        let feedbackCount = { positive: 0, negative: 0 };
        try {
            const lines = fs.readFileSync(FEEDBACK_LOG, 'utf8').trim().split('\n').filter(Boolean);
            for (const line of lines) {
                const e = JSON.parse(line);
                if (e.type === 'positive') feedbackCount.positive++;
                if (e.type === 'negative') feedbackCount.negative++;
            }
        } catch (_) {}

        let statsText = `*Sally v2 Knowledge Base Statistics*

📊 *Pinecone Index:*
• Total Vectors: ${pineconeStats.totalRecordCount || 0}
• Index: ${process.env.PINECONE_INDEX_NAME}
• Status: ${pineconeStats.totalRecordCount > 0 ? '✅ Active' : '⚠️ Empty'}`;

        if (catalogStats) {
            statsText += `\n\n📚 *Document Catalog:*
• Total Documents: ${catalogStats.totalDocuments}
• Last Updated: ${new Date(catalogStats.lastUpdated).toLocaleString()}
• Status: ✅ Loaded`;

            if (Object.keys(catalogStats.typeBreakdown).length > 0) {
                statsText += '\n\n📁 *Document Types:*';
                for (const [type, count] of Object.entries(catalogStats.typeBreakdown)) {
                    statsText += `\n• ${type}: ${count}`;
                }
            }
        }

        statsText += `\n\n💬 *Feedback:*\n• 👍 Helpful: ${feedbackCount.positive}\n• 👎 Not helpful: ${feedbackCount.negative}`;
        statsText += '\n\n🤖 *Engine:* Sally v2 (Claude Agent SDK)';

        await client.chat.postMessage({ channel: command.channel_id, text: statsText });

    } catch (error) {
        console.error('Error getting stats:', error);
        await client.chat.postMessage({
            channel: command.channel_id,
            text: 'Unable to retrieve statistics at this time.',
        });
    }
});

// ─── Start ────────────────────────────────────────────────────────────────────

(async () => {
    try {
        await app.start();
        console.log('\n⚡ Sally v2 Sales Enablement Bot is running!');
        console.log('🤖 Powered by Claude Agent SDK');
        console.log('📚 Ready to answer questions from sales documentation\n');
    } catch (error) {
        console.error('❌ Failed to start Sally:', error);
        process.exit(1);
    }
})();
