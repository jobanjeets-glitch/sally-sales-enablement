#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

/**
 * Build a mini catalog with just a few documents for demonstration
 */
async function buildMiniCatalog() {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const index = pc.index(process.env.PINECONE_INDEX_NAME);

    console.log('🏗️  Building Mini Catalog (5 documents)...\n');

    // Sample documents
    const dummyResponse = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: 'sales enablement training product'
    });

    const results = await index.query({
        vector: dummyResponse.data[0].embedding,
        topK: 50,
        includeMetadata: true
    });

    // Extract unique documents
    const docMap = new Map();
    for (const match of results.matches) {
        const fileName = match.metadata['File.name'] || match.metadata.fileName || 'Unknown';
        if (!docMap.has(fileName)) {
            docMap.set(fileName, {
                name: fileName,
                url: match.metadata['File.webviewlink'] || null,
                fileId: match.metadata['File.id'] || null,
                sampleChunks: [match.metadata.text || '']
            });
        } else {
            const doc = docMap.get(fileName);
            if (doc.sampleChunks.length < 3) {
                doc.sampleChunks.push(match.metadata.text || '');
            }
        }
    }

    // Take first 5 documents
    const docsToCharacterize = Array.from(docMap.values()).slice(0, 5);

    console.log(`📚 Characterizing ${docsToCharacterize.length} documents...\n`);

    const catalog = {
        lastUpdated: new Date().toISOString(),
        totalDocuments: docsToCharacterize.length,
        documents: []
    };

    for (const doc of docsToCharacterize) {
        console.log(`🔍 Characterizing: ${doc.name}`);

        const characterization = await characterizeDocument(openai, doc);
        catalog.documents.push(characterization);

        console.log(`   ✓ Type: ${characterization.type}`);
        console.log(`   ✓ Keywords: ${characterization.keywords.slice(0, 5).join(', ')}`);
        console.log('');
    }

    // Save catalog
    const catalogPath = './query/document-catalog.json';
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    console.log('✅ Mini catalog saved!\n');
    console.log('📊 Summary:');
    console.log(`   Total Documents: ${catalog.totalDocuments}`);
    console.log(`   Catalog Path: ${catalogPath}\n`);

    return catalog;
}

async function characterizeDocument(openai, doc) {
    const prompt = `Analyze this sales enablement document and provide a structured characterization.

Document Name: ${doc.name}

Sample Content:
${doc.sampleChunks.slice(0, 2).join('\n\n---\n\n').substring(0, 2000)}

Provide a JSON response with:
{
  "type": "pitch-deck | battlecard | product-documentation | training-material | messaging-framework | other",
  "purpose": "brief description of document purpose",
  "keywords": ["keyword1", "keyword2", ...],
  "aliases": ["alternative name 1", ...],
  "category": "sales-enablement | competitive-intel | product-info | training | other",
  "targetAudience": "who this document is for",
  "competitors": ["competitor1", ...],
  "products": ["product1", ...]
}

Focus on making keywords reflect how salespeople actually search.`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: 'You are a document classification assistant. Return ONLY valid JSON.'
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.1,
            response_format: { type: "json_object" }
        });

        const characterization = JSON.parse(response.choices[0].message.content);

        return {
            name: doc.name,
            url: doc.url,
            fileId: doc.fileId,
            ...characterization
        };

    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return {
            name: doc.name,
            url: doc.url,
            fileId: doc.fileId,
            type: 'other',
            purpose: 'Unknown',
            keywords: [],
            aliases: [],
            category: 'other',
            targetAudience: 'Unknown',
            competitors: [],
            products: []
        };
    }
}

buildMiniCatalog().catch(console.error);
