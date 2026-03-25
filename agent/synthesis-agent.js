/**
 * SynthesisAgent — composition and pitch-building specialist.
 *
 * Handles complex multi-step requests: building pitches, drafting emails,
 * preparing account-specific materials, combining multiple sources.
 * Has access to all 4 tools.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createSynthesisMcpServer } from './sally-tools.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNTHESIS_SYSTEM_PROMPT = readFileSync(join(__dirname, 'prompts/synthesis.md'), 'utf8');

export class SynthesisAgent {
    constructor(pineconeClient, documentCatalog) {
        this.pineconeClient = pineconeClient;
        this.catalog = documentCatalog;
        this.mcpServer = null;
    }

    async initialize() {
        this.mcpServer = createSynthesisMcpServer(this.pineconeClient, this.catalog);
        console.log('✅ SynthesisAgent ready');
    }

    async query(userQuestion, conversationContext = null) {
        if (!this.mcpServer) await this.initialize();

        const prompt = conversationContext
            ? `[Previous messages]\n${conversationContext}\n\n[Current request]\n${userQuestion}`
            : userQuestion;

        let finalAnswer = null;
        const toolsUsed = [];

        for await (const message of query({
            prompt,
            options: {
                systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
                mcpServers: { 'synthesis-tools': this.mcpServer },
                allowedTools: [
                    'mcp__synthesis-tools__vector_search',
                    'mcp__synthesis-tools__find_document',
                    'mcp__synthesis-tools__list_documents',
                    'mcp__synthesis-tools__get_document_details',
                ],
                model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
                maxTurns: 8,
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
            agent: 'synthesis',
        };
    }
}
