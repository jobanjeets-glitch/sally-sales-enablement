#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Build Identity-Focused Document Catalog
 * Creates descriptions that establish clear document identity and purpose
 */
class IdentityFocusedCatalogBuilder {
    constructor() {
        this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        this.index = this.pinecone.index(process.env.PINECONE_INDEX_NAME);
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    /**
     * Build the complete catalog
     */
    async buildCatalog() {
        console.log('🏗️  Building IDENTITY-FOCUSED Catalog...\n');

        // Get all unique documents from Pinecone
        const documents = await this.getUniqueDocuments();
        console.log(`📚 Found ${documents.length} unique documents\n`);

        console.log('📝 Creating identity-focused characterizations...\n');

        const catalog = [];

        for (let i = 0; i < documents.length; i++) {
            const doc = documents[i];
            console.log(`🔍 [${i + 1}/${documents.length}] Characterizing: ${doc.name}`);

            try {
                // Get sample content
                const sampleContent = await this.getSampleContent(doc.fileId);

                // Create identity-focused characterization
                const characterization = await this.characterizeDocument(doc, sampleContent);

                catalog.push({
                    name: doc.name,
                    url: doc.webViewLink,
                    fileId: doc.fileId,
                    ...characterization
                });

                console.log(`   ✓ Identity: ${characterization.documentIdentity}`);
                console.log(`   ✓ Type: ${characterization.documentType}`);
                console.log();

            } catch (error) {
                console.error(`   ❌ Error: ${error.message}\n`);
            }
        }

        // Save catalog
        const catalogData = {
            lastUpdated: new Date().toISOString(),
            totalDocuments: catalog.length,
            documents: catalog
        };

        await fs.writeFile(
            './query/document-catalog-identity-focused.json',
            JSON.stringify(catalogData, null, 2)
        );

        console.log('✅ Identity-focused catalog saved!\n');
        console.log('📊 Summary:');
        console.log(`   Total Documents: ${catalog.length}`);
        console.log(`   Catalog Path: ./query/document-catalog-identity-focused.json\n`);

        return catalogData;
    }

    /**
     * Get all unique documents from Pinecone
     */
    async getUniqueDocuments() {
        // Query with empty vector to get random samples
        const queryResponse = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 10000,
            includeMetadata: true
        });

        // Extract unique documents
        const uniqueDocs = new Map();

        for (const match of queryResponse.matches) {
            const metadata = match.metadata;
            const fileName = metadata['File.name'];

            if (fileName && !uniqueDocs.has(fileName)) {
                uniqueDocs.set(fileName, {
                    name: fileName,
                    fileId: metadata['File.id'],
                    webViewLink: metadata['File.webviewlink'] || metadata['File.webViewLink']
                });
            }
        }

        return Array.from(uniqueDocs.values());
    }

    /**
     * Get sample content from document (15 chunks for comprehensive analysis)
     */
    async getSampleContent(fileId) {
        const queryResponse = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 20,
            includeMetadata: true,
            filter: { 'File.id': { $eq: fileId } }
        });

        const chunks = queryResponse.matches
            .map(m => m.metadata.text)
            .filter(t => t)
            .slice(0, 15);

        return chunks.join('\n\n---\n\n');
    }

    /**
     * Create identity-focused characterization using GPT-4
     */
    async characterizeDocument(doc, sampleContent) {
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

   Example: "This is the SALES AGENT PRODUCT BOX effective January 2026 - defining the Sales Agent product as an AI-powered tool that generates customer-branded PowerPoint presentations with actionable recommendations to improve CARS metrics (Content, Availability, Ratings & Reviews, Share of Search). The document includes: product positioning ('Your AI sales analyst'), value propositions (saves 10 hours/week, improves win rates by 30%), key features (Retailer Access Instructions for 110 countries, 15+ retailer integrations including Amazon, Walmart, Target), pricing tiers ($5K-$50K annually), competitive differentiators vs manual analysis, and implementation timeline (30-day onboarding)."

2. **What's Inside - Be Specific**
   - List actual sections/topics covered in the document
   - Include specific numbers, percentages, metrics mentioned
   - Name specific case studies, customers, competitors mentioned
   - List specific features, capabilities, integrations discussed
   - Note any pricing, timelines, dates included

3. **Document Type Explanation**
   - Explain what this document type means: "A Product Box is a document that defines..."
   - Clarify when to use it vs similar document types

4. **Explicit Use Cases**
   - "If someone asks 'X', 'Y', or 'Z', use this document"
   - Be specific: "second call deck", "RMM pricing", "competitive comparison with Pacvue"

5. **Clear Distinctions**
   - "Not to confuse with: [Other Doc] which covers [Different Topic]"

**RESPOND WITH JSON:**
{
  "documentIdentity": "This is the [EXPLICIT NAME] - [comprehensive summary of what's inside with specific details]",
  "documentType": "product-box | training-deck | product-description | second-call-deck | first-call-deck | battle-card | pricing-calculator | datasheet | one-pager | enablement-guide | talk-track | case-study-library",
  "comprehensiveDescription": "4-7 paragraph detailed description that includes:
    Paragraph 1: Document identity + type explanation + when to use
    Paragraph 2-4: DETAILED summary of what's inside - specific sections, topics, features, metrics, case studies, numbers
    Paragraph 5: Specific use cases (If someone asks...)
    Paragraph 6: Clear distinctions from similar documents
    Paragraph 7: Version, date, status if applicable",
  "contentSummary": {
    "mainTopics": ["List 5-10 main topics/sections covered"],
    "specificDetails": ["List 10-15 specific details: numbers, metrics, case studies, features, products, competitors mentioned"],
    "keyTakeaways": ["List 3-5 key takeaways someone would learn from this"]
  },
  "documentPurpose": "Short phrase describing primary purpose",
  "whenToUse": "Specific scenarios when this document should be used",
  "searchQueries": ["List 10-15 specific queries this document would answer - be very specific"],
  "notToConfuseWith": ["List similar documents and how they differ"],
  "version": "Version number if present or null",
  "effectiveDate": "Date if present or null",
  "status": "Active | Draft | Work In Progress | Archived or null",
  "productNames": ["Exact product names mentioned"],
  "competitorNames": ["Competitors mentioned"],
  "customerNames": ["Customer/case study names mentioned"],
  "keyMetrics": ["Specific metrics with numbers"],
  "keyFeatures": ["Specific feature names"],
  "targetAudience": "Who uses this document"
}

**EXAMPLE OF COMPREHENSIVE DESCRIPTION:**

"This is the RMM SECOND CALL DECK - a comprehensive 45-slide presentation covering Retail Media Management's full advertising platform capabilities, designed for the second customer meeting. A 'Second Call Deck' is a detailed sales presentation used after the initial discovery call, diving deep into product features, implementation, pricing, and ROI. This specific deck covers: Amazon DSP integration (sponsored products, sponsored brands, sponsored display), Walmart Connect features (on-site advertising, off-site display, video ads), Target Roundel capabilities, bid optimization algorithms (automated bidding rules, dayparting strategies, budget pacing), campaign performance dashboards (real-time metrics, ROAS tracking, attribution models), and competitive positioning against Pacvue (40% lower cost), Flywheel (2x faster implementation), and Skai (better Amazon integration). The deck includes specific customer case studies: Nestlé achieved 30% ROAS improvement and $2M additional revenue in Q1 2025, Unilever reduced advertising costs by 25% while maintaining sales, and P&G saw 40% sales lift during Prime Day 2025. It details pricing tiers ($10K-$100K annually based on ad spend), implementation timeline (30-60 days), and includes a built-in ROI calculator showing average 3.5x return. Use this when someone asks for 'RMM second call deck', 'detailed RMM presentation', 'RMM pricing and features', 'RMM customer examples', or 'RMM vs competitors'. Not to confuse with: RMM First Call Deck (high-level overview for initial meetings), RMM Training Deck (internal team enablement), or RMM Battle Cards (quick competitive comparison sheets)."

**Remember:** Be extremely detailed about what's INSIDE the document. Include numbers, names, metrics, case studies, features - make it rich with content.`;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-5.2-chat-latest',
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert at creating clear, identity-focused document characterizations for sales enablement materials.'
                },
                { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' }
        });

        const characterization = JSON.parse(response.choices[0].message.content);
        return characterization;
    }
}

// Main execution
async function main() {
    const builder = new IdentityFocusedCatalogBuilder();
    await builder.buildCatalog();
}

main().catch(error => {
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
});
