/**
 * Sally tool definitions — individual tool factories + per-agent MCP server factories.
 *
 * Three MCP servers:
 *   createCatalogMcpServer   → find_document, list_documents, get_document_details
 *   createRagMcpServer       → vector_search (+ archive fallback)
 *   createSynthesisMcpServer → all 4 tools
 */
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

// ─── Tool factories ────────────────────────────────────────────────────────────

function makeVectorSearchTool(pineconeClient) {
    return tool(
        'vector_search',
        'Search the sales knowledge base for information, proof points, product features, competitive details, and objection handling. Returns text chunks with source document name, Drive link, and relevance score. Also supports searching the archive namespace for older/fallback content.',
        {
            query: z.string().describe('The search query — be specific for best results'),
            topK: z.number().optional().describe('Results to return (default: 8)'),
            namespace: z.string().optional().describe('Pinecone namespace: "default" (current docs) or "archive" (older docs). Default: "default"'),
        },
        async (args) => {
            const topK = args.topK || 8;
            const ns = args.namespace || 'default';

            let index = pineconeClient.index;
            if (ns === 'archive') {
                index = pineconeClient.pinecone
                    .index(pineconeClient.indexName)
                    .namespace('archive');
            }

            const embedding = await pineconeClient.createEmbedding(args.query);
            const results = await index.query({
                vector: embedding,
                topK,
                includeMetadata: true,
            });
            const matches = results.matches || [];

            if (matches.length === 0) {
                return { content: [{ type: 'text', text: `No results found in ${ns} namespace.` }] };
            }

            const formatted = matches.map((match, idx) => {
                const meta = match.metadata;
                const fileName = meta['File.name'] || meta.fileName || 'Unknown';
                const url = meta['File.webviewlink'] || meta.url || null;
                const text = (meta.text || '').substring(0, 600);
                const relevance = Math.round((match.score || 0) * 100);
                const link = url ? ` | ${url}` : '';
                return `[${idx + 1}] ${fileName}${link} (${relevance}%)\n${text}`;
            }).join('\n\n---\n\n');

            return { content: [{ type: 'text', text: `Results from ${ns} namespace:\n\n${formatted}` }] };
        }
    );
}

function makeFindDocumentTool(documentCatalog) {
    return tool(
        'find_document',
        'Find documents in the catalog by name, type, product, or competitor. Returns document name, type, Drive link, purpose, and when to use it. Use as a fallback when the catalog in context is not specific enough.',
        {
            query: z.string().describe('Document search query'),
            maxResults: z.number().optional().describe('Max results (default: 5)'),
        },
        async (args) => {
            const results = await documentCatalog.findDocuments(args.query);
            const top = results.slice(0, args.maxResults || 5);

            if (top.length === 0) {
                return { content: [{ type: 'text', text: 'No matching documents found.' }] };
            }

            const formatted = top.map((doc, idx) => {
                const link = doc.url ? `\n   Link: ${doc.url}` : '';
                const type = doc.documentType || doc.type || 'unknown';
                const when = doc.whenToUse ? `\n   When: ${doc.whenToUse}` : '';
                const products = doc.productNames?.length ? `\n   Products: ${doc.productNames.join(', ')}` : '';
                const competitors = doc.competitorNames?.length ? `\n   Competitors: ${doc.competitorNames.join(', ')}` : '';
                return `${idx + 1}. ${doc.name}\n   Type: ${type}${link}${when}${products}${competitors}`;
            }).join('\n\n');

            return { content: [{ type: 'text', text: formatted }] };
        }
    );
}

function makeListDocumentsTool(documentCatalog) {
    return tool(
        'list_documents',
        'List catalog documents filtered by type, product, or competitor.',
        {
            filterType: z.string().optional().describe('Filter by type (e.g. "battle-card", "first-call-deck", "case-study")'),
            filterProduct: z.string().optional().describe('Filter by product (e.g. "RMM", "AllyAI", "DSA")'),
            filterCompetitor: z.string().optional().describe('Filter by competitor (e.g. "Pacvue", "Profitero")'),
            maxResults: z.number().optional().describe('Max results (default: 20)'),
        },
        async (args) => {
            if (!documentCatalog.catalog) await documentCatalog.loadCatalog();

            let docs = documentCatalog.catalog.documents;

            if (args.filterType) {
                const ft = args.filterType.toLowerCase();
                docs = docs.filter(d => (d.documentType || d.type || '').toLowerCase().includes(ft));
            }
            if (args.filterProduct) {
                const fp = args.filterProduct.toLowerCase();
                docs = docs.filter(d =>
                    (d.productNames || []).some(p => p.toLowerCase().includes(fp)) ||
                    d.name.toLowerCase().includes(fp)
                );
            }
            if (args.filterCompetitor) {
                const fc = args.filterCompetitor.toLowerCase();
                docs = docs.filter(d =>
                    (d.competitorNames || []).some(c => c.toLowerCase().includes(fc)) ||
                    d.name.toLowerCase().includes(fc)
                );
            }

            const top = docs.slice(0, args.maxResults || 20);

            if (top.length === 0) {
                return { content: [{ type: 'text', text: 'No documents found matching your filters.' }] };
            }

            const formatted = top.map((doc, idx) => {
                const link = doc.url ? ` → ${doc.url}` : '';
                return `${idx + 1}. ${doc.name} [${doc.documentType || 'unknown'}]${link}`;
            }).join('\n');

            return { content: [{ type: 'text', text: `Found ${top.length} documents:\n\n${formatted}` }] };
        }
    );
}

function makeGetDocumentDetailsTool(documentCatalog) {
    return tool(
        'get_document_details',
        'Get full metadata for a specific document by name.',
        {
            nameOrPartial: z.string().describe('Exact or partial document name'),
        },
        async (args) => {
            if (!documentCatalog.catalog) await documentCatalog.loadCatalog();

            const q = args.nameOrPartial.toLowerCase();
            const doc = documentCatalog.catalog.documents.find(d =>
                d.name.toLowerCase().includes(q) || q.includes(d.name.toLowerCase())
            );

            if (!doc) {
                return { content: [{ type: 'text', text: `No document found matching "${args.nameOrPartial}"` }] };
            }

            const parts = [
                `Name: ${doc.name}`,
                doc.url ? `Link: ${doc.url}` : null,
                doc.documentType ? `Type: ${doc.documentType}` : null,
                doc.documentPurpose ? `Purpose: ${doc.documentPurpose}` : null,
                doc.whenToUse ? `When to use: ${doc.whenToUse}` : null,
                doc.productNames?.length ? `Products: ${doc.productNames.join(', ')}` : null,
                doc.competitorNames?.length ? `Competitors: ${doc.competitorNames.join(', ')}` : null,
                doc.searchQueries?.length ? `Keywords: ${doc.searchQueries.slice(0, 5).join(' | ')}` : null,
            ].filter(Boolean).join('\n');

            return { content: [{ type: 'text', text: parts }] };
        }
    );
}

// ─── MCP server factories ──────────────────────────────────────────────────────

export function createCatalogMcpServer(documentCatalog) {
    return createSdkMcpServer({
        name: 'catalog-tools',
        tools: [
            makeFindDocumentTool(documentCatalog),
            makeListDocumentsTool(documentCatalog),
            makeGetDocumentDetailsTool(documentCatalog),
        ],
    });
}

export function createRagMcpServer(pineconeClient) {
    return createSdkMcpServer({
        name: 'rag-tools',
        tools: [makeVectorSearchTool(pineconeClient)],
    });
}

export function createSynthesisMcpServer(pineconeClient, documentCatalog) {
    return createSdkMcpServer({
        name: 'synthesis-tools',
        tools: [
            makeVectorSearchTool(pineconeClient),
            makeFindDocumentTool(documentCatalog),
            makeListDocumentsTool(documentCatalog),
            makeGetDocumentDetailsTool(documentCatalog),
        ],
    });
}
