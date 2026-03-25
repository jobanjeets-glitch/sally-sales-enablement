/**
 * CatalogAgent — document lookup specialist.
 *
 * The full document catalog is injected into the system prompt so the LLM can
 * do direct matching in one step (no tool call needed for most queries).
 * Tools are available as a fallback for fuzzy/ambiguous lookups.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createCatalogMcpServer } from './sally-tools.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PROMPT_TEMPLATE = readFileSync(join(__dirname, 'prompts/catalog.md'), 'utf8');

export class CatalogAgent {
    constructor(documentCatalog) {
        this.catalog = documentCatalog;
        this.mcpServer = null;
        this.systemPrompt = null;
    }

    /**
     * Build a compact catalog listing for the system prompt.
     * Format: name, type, products, competitors, URL, top keywords.
     */
    buildCompactCatalog() {
        const docs = this.catalog.catalog.documents;
        const lines = [`\n## COMPLETE DOCUMENT CATALOG (${docs.length} documents)\n`];

        docs.forEach((doc, i) => {
            const products = doc.productNames?.length ? ` | Products: ${doc.productNames.join(', ')}` : '';
            const competitors = doc.competitorNames?.length ? ` | Competitors: ${doc.competitorNames.join(', ')}` : '';
            const keywords = doc.searchQueries?.length
                ? `\n   Keywords: ${doc.searchQueries.slice(0, 3).join(' | ')}`
                : '';
            const url = doc.url ? `\n   URL: ${doc.url}` : '\n   URL: (no link)';
            const folder = doc.folderName
                ? `\n   Folder: ${doc.folderName}${doc.folderUrl ? ` (${doc.folderUrl})` : ''}`
                : '';
            const type = doc.documentType || 'unknown';

            lines.push(
                `${i + 1}. "${doc.name}" [${type}]${products}${competitors}${url}${folder}${keywords}\n`
            );
        });

        return lines.join('');
    }

    async initialize() {
        this.mcpServer = createCatalogMcpServer(this.catalog);
        this.systemPrompt = CATALOG_PROMPT_TEMPLATE.replace('{{CATALOG}}', this.buildCompactCatalog());
        console.log(`✅ CatalogAgent ready (${this.catalog.catalog.documents.length} docs in prompt)`);
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
                systemPrompt: this.systemPrompt,
                mcpServers: { 'catalog-tools': this.mcpServer },
                allowedTools: [
                    'mcp__catalog-tools__find_document',
                    'mcp__catalog-tools__list_documents',
                    'mcp__catalog-tools__get_document_details',
                ],
                model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
                maxTurns: 3,
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
            agent: 'catalog',
        };
    }
}
