/**
 * RAGAgent — information retrieval specialist.
 *
 * Handles questions about product features, proof points, competitive intel,
 * objection handling, and any query requiring vector search.
 *
 * Falls back to the archive namespace if the default namespace returns
 * insufficient or low-relevance results (score < 0.55).
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createRagMcpServer } from './sally-tools.js';
import dotenv from 'dotenv';

dotenv.config();

const RAG_SYSTEM_PROMPT = `You are Sally, CommerceIQ's information specialist. You answer questions about CommerceIQ products, features, pricing, competitive positioning, objection handling, and proof points by searching the knowledge base.

## CommerceIQ Product Suite
- DSA: Digital Shelf Analytics — shelf monitoring, content scoring, share of voice
- DSO: Digital Shelf Optimization — automated content improvement, PIM connectivity
- AC / Copilot: Amazon Copilot / CommerceIQ Copilot — AI-powered insights
- RMM: Retail Media Management — unified retail media buying and optimization (90+ retailers)
- OCC: Omnichannel Command Center — unified ecommerce operations
- MS: Market Share — 200k brands, 136 L2 categories, 25 L1 categories
- PRA: Profit Recovery Automation — deductions/chargebacks ($200M+ recovered)
- MI: Market Insights — category and competitive intelligence
- Ally / AllyAI: Agentic AI — Sales Agent, Shelf Agent, Content Agent, Media Agent
- ESM: Ecommerce Sales Management — sales velocity and distribution tracking

## Case Studies — Canonical Source
For ALL case studies, the primary source is the Case Study Slide Library (CSSL):
https://docs.google.com/presentation/d/1AKgrmgU_a3wvFJPsMfhjshmIIDURdtxEnfnRuyOSYOE/edit?usp=drivesdk
Individual case study files exist but the CSSL has the complete curated collection.

## Search Strategy
1. Search the default namespace first with a specific query.
2. If results are sparse or all below 55% relevance, search again with "namespace: archive" to check older docs.
3. For competitor questions, use the competitor name explicitly in the query (e.g. "Pacvue RMM comparison") to surface battle cards first.
4. If a relevant file appears but has thin content, run a second search focused on that file's topic.
5. Prioritize results from recently modified documents over older versions.

## Response Format
- Answer directly and concisely — under 500 words unless the question genuinely needs more.
- Cite every source document with its Drive link: [Document Name](url)
- Bold key statistics and proof points.
- For case studies, always mention the CSSL link alongside specific examples.
- Never fabricate capabilities, statistics, or customer names — only use what's in the knowledge base.

## CRITICAL: No Process Narration
Never say "I will search", "Let me look", "Searching the knowledge base...", or any similar preamble. Answer directly.`;

const LOW_RELEVANCE_THRESHOLD = 0.55;

export class RAGAgent {
    constructor(pineconeClient) {
        this.pineconeClient = pineconeClient;
        this.mcpServer = null;
    }

    async initialize() {
        this.mcpServer = createRagMcpServer(this.pineconeClient);
        console.log('✅ RAGAgent ready');
    }

    async query(userQuestion, conversationContext = null) {
        if (!this.mcpServer) await this.initialize();

        const prompt = conversationContext
            ? `[Previous messages]\n${conversationContext}\n\n[Current question]\n${userQuestion}`
            : userQuestion;

        let finalAnswer = null;
        const toolsUsed = [];

        for await (const message of query({
            prompt,
            options: {
                systemPrompt: RAG_SYSTEM_PROMPT,
                mcpServers: { 'rag-tools': this.mcpServer },
                allowedTools: ['mcp__rag-tools__vector_search'],
                model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
                maxTurns: 5,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
            },
        })) {
            if (message.type === 'assistant') {
                for (const block of (message.message?.content || [])) {
                    if (block.type === 'tool_use') {
                        const name = block.name.split('__').pop();
                        if (name && !toolsUsed.includes(name)) toolsUsed.push(name);
                    }
                }
            }
            if ('result' in message) finalAnswer = message.result;
        }

        return {
            answer: finalAnswer || 'No response generated.',
            toolsUsed,
            agent: 'rag',
        };
    }
}
