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
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAG_SYSTEM_PROMPT = readFileSync(join(__dirname, 'prompts/rag.md'), 'utf8');

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
