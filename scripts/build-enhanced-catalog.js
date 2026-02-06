#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

/**
 * Build enhanced catalog with DETAILED descriptions (Gemini-style)
 */
async function buildEnhancedCatalog() {
    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const index = pc.index(process.env.PINECONE_INDEX_NAME);

    console.log('🏗️  Building ENHANCED Catalog with detailed descriptions...\n');

    // Sample documents
    const dummyResponse = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: 'sales enablement training product documentation'
    });

    const results = await index.query({
        vector: dummyResponse.data[0].embedding,
        topK: 100,
        includeMetadata: true
    });

    // Extract unique documents with MORE content
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
            // Get MORE chunks (up to 10) for better context
            if (doc.sampleChunks.length < 10) {
                doc.sampleChunks.push(match.metadata.text || '');
            }
        }
    }

    // Take first 10 documents (or all if less)
    const docsToCharacterize = Array.from(docMap.values()).slice(0, 10);

    console.log(`📚 Characterizing ${docsToCharacterize.length} documents with DETAILED descriptions...\n`);

    const catalog = {
        lastUpdated: new Date().toISOString(),
        totalDocuments: docsToCharacterize.length,
        documents: []
    };

    for (const doc of docsToCharacterize) {
        console.log(`🔍 Characterizing: ${doc.name}`);

        const characterization = await characterizeDocumentDetailed(openai, doc);
        catalog.documents.push(characterization);

        console.log(`   ✓ Type: ${characterization.type}`);
        console.log(`   ✓ Specific Keywords: ${characterization.specificKeywords.slice(0, 3).join(', ')}`);
        console.log(`   ✓ Description length: ${characterization.detailedDescription.length} chars`);
        console.log('');
    }

    // Save catalog
    const catalogPath = './query/document-catalog-enhanced.json';
    await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));

    console.log('✅ Enhanced catalog saved!\n');
    console.log('📊 Summary:');
    console.log(`   Total Documents: ${catalog.totalDocuments}`);
    console.log(`   Catalog Path: ${catalogPath}\n`);

    return catalog;
}

async function characterizeDocumentDetailed(openai, doc) {
    // Use MORE content for better context
    const contentSample = doc.sampleChunks.slice(0, 5).join('\n\n---\n\n').substring(0, 4000);

    const prompt = `Analyze this sales/product document and provide a COMPREHENSIVE characterization.

Document Name: ${doc.name}

Content Sample (multiple sections):
${contentSample}

Provide a JSON response with:
{
  "type": "pitch-deck | battlecard | product-documentation | training-material | messaging-framework | product-box | other",

  "detailedDescription": "Write a DETAILED 3-5 sentence description like this example:

  'The CommerceIQ Sales Agent - Product Box is an internal, draft service description effective January 2026, which outlines a tool focusing on strategic, tailored, and measured outcomes, primarily by providing deep insights and data-driven, customer-branded PowerPoint presentations with measurable Recommended Actions to improve CARS metrics (Content, Availability, Ratings & Reviews, Share of Search) across 110 supported countries and Omni-channel retailers. Key features include AskAlly: Agent Query, which allows users to query reports for business-ready answers and tailor output for different audiences (C-suite, Commercial teams, Analysts), and Retailer-Specific Insight Packs that provide business-ready, customizable decks with deeper insights.'

  Include: What it is, what it does, key features by name, metrics/capabilities, target use cases, what it does NOT support if mentioned.",

  "specificKeywords": [
    "Use SPECIFIC terms from the document, NOT generic ones",
    "Examples: 'AskAlly', 'CARS metrics', 'Insight Packs', 'Sales Teammate II'",
    "Include: Feature names, product versions, metrics, capabilities, retailer names, country counts",
    "AVOID: generic terms like 'training', 'sales', 'product' unless very specific",
    "15-25 keywords"
  ],

  "searchableTerms": [
    "How would someone actually search for this document?",
    "Examples: 'sales agent product box', 'ally teammate pricing', 'copilot amazon features'",
    "Include common misspellings or variations",
    "5-10 terms"
  ],

  "keyFeatures": [
    "List specific features mentioned by name",
    "Example: 'AskAlly: Agent Query', 'Retailer-Specific Insight Packs', 'CARS Analytics'",
    "5-10 features"
  ],

  "metrics": [
    "Any metrics or KPIs mentioned",
    "Example: 'CARS (Content, Availability, Ratings & Reviews, Share of Search)', '110 countries'",
    "List each separately"
  ],

  "products": ["Specific product names mentioned"],
  "competitors": ["Specific competitor names"],
  "category": "sales-enablement | competitive-intel | product-info | training | pricing | messaging",
  "targetAudience": "Specific roles/teams this is for",

  "doesSupport": ["What this document/product DOES support or help with"],
  "doesNotSupport": ["What it explicitly does NOT support - if mentioned"]
}

CRITICAL:
- detailedDescription must be 3-5 sentences with SPECIFIC details
- specificKeywords must be ACTUAL terms from the document, not generic categories
- Include numbers, versions, feature names, metrics`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert document analyst. Create DETAILED, SPECIFIC characterizations with concrete terms, not generic descriptions. Return ONLY valid JSON.'
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
            detailedDescription: 'Unknown',
            specificKeywords: [],
            searchableTerms: [],
            keyFeatures: [],
            metrics: [],
            products: [],
            competitors: [],
            category: 'other',
            targetAudience: 'Unknown',
            doesSupport: [],
            doesNotSupport: []
        };
    }
}

buildEnhancedCatalog().catch(console.error);
