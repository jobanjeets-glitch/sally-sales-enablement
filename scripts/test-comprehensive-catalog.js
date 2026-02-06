#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Test with 3 specific documents
const testDocs = [
    'RMM Second call deck',
    'Content Agent Training Deck',
    'DRAFT CommerceIQ Sales Agent - Product Box January 26 Internal'
];

async function getSampleContent(fileId) {
    const queryResponse = await index.query({
        vector: new Array(3072).fill(0),
        topK: 5,
        includeMetadata: true,
        filter: { 'File.id': { $eq: fileId } }
    });

    const chunks = queryResponse.matches
        .map(m => m.metadata.text)
        .filter(t => t)
        .slice(0, 3);

    return chunks.join('\n\n---\n\n');
}

async function characterizeDocument(doc, sampleContent) {
    const prompt = `You are analyzing a sales enablement document to create a COMPREHENSIVE IDENTITY-FOCUSED description.

**DOCUMENT NAME:** ${doc.name}

**SAMPLE CONTENT:**
${sampleContent.substring(0, 10000)}

**YOUR TASK:**
Create a comprehensive characterization that:
1. CLEARLY establishes what this document IS (identity)
2. SUMMARIZES what's INSIDE the document (content)
3. Makes it easy to find when users search

**CRITICAL REQUIREMENTS:**

1. **Document Identity + Content Summary** (MOST IMPORTANT)
   Start with: "This is the [EXPLICIT NAME] - [what it contains]"

   Example: "This is the RMM SECOND CALL DECK - a 45-slide presentation covering Retail Media Management's advertising platform capabilities, bid optimization strategies, campaign performance metrics, and ROI calculator. The deck includes specific case studies from Nestlé (30% ROAS improvement), Unilever (25% cost reduction), and P&G (40% sales lift). It covers Amazon DSP integration, Walmart Connect features, Target Roundel capabilities, and competitive positioning against Pacvue, Flywheel, and Skai."

2. **What's Inside - Be Specific**
   - List actual sections/topics covered
   - Include specific numbers, percentages, metrics
   - Name specific case studies, customers, competitors
   - List specific features, capabilities
   - Note any pricing, timelines, dates

3. **Explicit Use Cases**
   - "If someone asks 'X', 'Y', or 'Z', use this document"

**RESPOND WITH JSON:**
{
  "documentIdentity": "This is the [EXPLICIT NAME] - [comprehensive summary]",
  "documentType": "product-box | training-deck | second-call-deck | etc",
  "comprehensiveDescription": "4-7 paragraphs with identity, what's inside, use cases, distinctions",
  "contentSummary": {
    "mainTopics": ["5-10 main topics covered"],
    "specificDetails": ["10-15 specific details with numbers/names"],
    "keyTakeaways": ["3-5 key takeaways"]
  },
  "searchQueries": ["10-15 specific queries this answers"],
  "productNames": ["Products mentioned"],
  "competitorNames": ["Competitors mentioned"],
  "keyMetrics": ["Metrics with numbers"],
  "keyFeatures": ["Specific features"]
}`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: 'You create comprehensive, detailed document characterizations.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
}

console.log('🧪 Testing Comprehensive Catalog on 3 Documents\n');
console.log('='.repeat(80) + '\n');

for (const docName of testDocs) {
    console.log(`\n📄 Document: ${docName}\n`);
    console.log('─'.repeat(80));

    // Get document info
    const queryResponse = await index.query({
        vector: new Array(3072).fill(0),
        topK: 1,
        includeMetadata: true,
        filter: { 'File.name': { $eq: docName } }
    });

    if (queryResponse.matches.length === 0) {
        console.log('❌ Not found in Pinecone\n');
        continue;
    }

    const doc = {
        name: docName,
        fileId: queryResponse.matches[0].metadata['File.id']
    };

    const sampleContent = await getSampleContent(doc.fileId);
    const result = await characterizeDocument(doc, sampleContent);

    console.log('\n✅ DOCUMENT IDENTITY:');
    console.log(result.documentIdentity);

    console.log('\n📋 DOCUMENT TYPE:');
    console.log(result.documentType);

    console.log('\n📝 COMPREHENSIVE DESCRIPTION:');
    console.log(result.comprehensiveDescription);

    console.log('\n📚 CONTENT SUMMARY:');
    console.log('Main Topics:', result.contentSummary.mainTopics.slice(0, 5).join(', '));
    console.log('Specific Details:', result.contentSummary.specificDetails.slice(0, 5).join(', '));

    console.log('\n🔍 SAMPLE SEARCH QUERIES:');
    result.searchQueries.slice(0, 5).forEach(q => console.log(`   • ${q}`));

    console.log('\n' + '='.repeat(80) + '\n');
}
