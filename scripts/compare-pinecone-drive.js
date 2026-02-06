#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Compare Pinecone index with Google Drive GTM collateral
 */
async function comparePineconeDrive() {
    console.log('🔍 Comparing Pinecone DB with Google Drive GTM Collateral\n');
    console.log('='.repeat(80) + '\n');

    const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const index = pc.index(process.env.PINECONE_INDEX_NAME);

    // 1. Read Google Drive sheet
    console.log('📊 Reading Google Drive sheet...');
    const csvPath = process.env.HOME + '/Downloads/test gtm collateral - Sheet1.csv';
    const csvData = await fs.readFile(csvPath, 'utf-8');
    const lines = csvData.split('\n');

    // Parse CSV and extract file names (skip header, skip folders)
    const driveFiles = new Set();
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV parsing (handle quoted fields)
        const match = line.match(/^"?([^",]+)"?,/);
        if (match) {
            const fileName = match[1].trim();
            // Skip folders and videos
            if (!fileName.startsWith('http') &&
                !fileName.endsWith('/') &&
                fileName !== 'Archive' &&
                fileName !== 'Internal' &&
                !fileName.endsWith('.mp4') &&
                !fileName.endsWith('.MOV') &&
                fileName.length > 0) {
                driveFiles.add(fileName);
            }
        }
    }

    console.log(`   ✅ Found ${driveFiles.size} documents in Drive\n`);

    // 2. Get all unique documents from Pinecone
    console.log('🗄️  Querying Pinecone for all documents...');
    const dummyResponse = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: 'document file content'
    });

    // Query multiple times to get better coverage
    const allMatches = [];
    const queries = [
        'sales enablement training product',
        'battlecard competitive analysis',
        'first call deck presentation',
        'pricing product box documentation',
        'case study report industry'
    ];

    for (const query of queries) {
        const queryEmbed = await openai.embeddings.create({
            model: 'text-embedding-3-large',
            input: query
        });
        const results = await index.query({
            vector: queryEmbed.data[0].embedding,
            topK: 1000,
            includeMetadata: true
        });
        allMatches.push(...results.matches);
    }

    // Extract unique file names from Pinecone
    const pineconeFiles = new Set();
    for (const match of allMatches) {
        const fileName = match.metadata['File.name'] || match.metadata.fileName;
        if (fileName && fileName.length > 0) {
            pineconeFiles.add(fileName);
        }
    }

    console.log(`   ✅ Found ${pineconeFiles.size} documents in Pinecone\n`);

    // 3. Find what's in Drive but NOT in Pinecone
    const missingInPinecone = [];
    for (const driveFile of driveFiles) {
        if (!pineconeFiles.has(driveFile)) {
            missingInPinecone.push(driveFile);
        }
    }

    // 4. Find what's in Pinecone but NOT in Drive (orphaned)
    const orphanedInPinecone = [];
    for (const pineconeFile of pineconeFiles) {
        if (!driveFiles.has(pineconeFile)) {
            orphanedInPinecone.push(pineconeFile);
        }
    }

    // 5. Print results
    console.log('='.repeat(80));
    console.log('\n📊 COMPARISON RESULTS\n');
    console.log('='.repeat(80) + '\n');

    console.log(`📁 Google Drive:     ${driveFiles.size} documents`);
    console.log(`🗄️  Pinecone Index:  ${pineconeFiles.size} documents`);
    console.log(`❌ Missing (Drive → Pinecone): ${missingInPinecone.length} documents`);
    console.log(`⚠️  Orphaned (Pinecone only): ${orphanedInPinecone.length} documents\n`);

    // Show missing documents
    if (missingInPinecone.length > 0) {
        console.log('='.repeat(80));
        console.log('\n❌ MISSING IN PINECONE (Need to index these):\n');
        console.log('='.repeat(80) + '\n');

        // Group by type
        const missing = {
            decks: [],
            battlecards: [],
            docs: [],
            pdfs: [],
            other: []
        };

        for (const file of missingInPinecone) {
            if (file.includes('Deck') || file.includes('deck')) {
                missing.decks.push(file);
            } else if (file.includes('Battle Card') || file.includes('Competitive')) {
                missing.battlecards.push(file);
            } else if (file.endsWith('.pdf') || file.endsWith('.PDF')) {
                missing.pdfs.push(file);
            } else if (file.endsWith('.docx') || file.includes('Framework')) {
                missing.docs.push(file);
            } else {
                missing.other.push(file);
            }
        }

        if (missing.decks.length > 0) {
            console.log(`📊 Decks & Presentations (${missing.decks.length}):`);
            missing.decks.slice(0, 20).forEach(f => console.log(`   - ${f}`));
            if (missing.decks.length > 20) console.log(`   ... and ${missing.decks.length - 20} more\n`);
        }

        if (missing.battlecards.length > 0) {
            console.log(`\n⚔️  Battle Cards & Competitive (${missing.battlecards.length}):`);
            missing.battlecards.slice(0, 20).forEach(f => console.log(`   - ${f}`));
            if (missing.battlecards.length > 20) console.log(`   ... and ${missing.battlecards.length - 20} more\n`);
        }

        if (missing.docs.length > 0) {
            console.log(`\n📄 Documents & Frameworks (${missing.docs.length}):`);
            missing.docs.slice(0, 20).forEach(f => console.log(`   - ${f}`));
            if (missing.docs.length > 20) console.log(`   ... and ${missing.docs.length - 20} more\n`);
        }

        if (missing.pdfs.length > 0) {
            console.log(`\n📑 PDFs (${missing.pdfs.length}):`);
            missing.pdfs.slice(0, 20).forEach(f => console.log(`   - ${f}`));
            if (missing.pdfs.length > 20) console.log(`   ... and ${missing.pdfs.length - 20} more\n`);
        }

        if (missing.other.length > 0) {
            console.log(`\n📋 Other (${missing.other.length}):`);
            missing.other.slice(0, 20).forEach(f => console.log(`   - ${f}`));
            if (missing.other.length > 20) console.log(`   ... and ${missing.other.length - 20} more\n`);
        }
    }

    // Show orphaned documents
    if (orphanedInPinecone.length > 0) {
        console.log('\n' + '='.repeat(80));
        console.log('\n⚠️  ORPHANED IN PINECONE (Not in current Drive):\n');
        console.log('='.repeat(80) + '\n');
        console.log('These might be old/renamed documents:\n');
        orphanedInPinecone.slice(0, 20).forEach(f => console.log(`   - ${f}`));
        if (orphanedInPinecone.length > 20) {
            console.log(`   ... and ${orphanedInPinecone.length - 20} more`);
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n💡 RECOMMENDATIONS:\n');
    console.log('1. Index missing documents using your n8n workflow');
    console.log('2. Clean up orphaned documents from Pinecone (if needed)');
    console.log('3. Run: npm run build-enhanced-catalog after indexing\n');

    // Save detailed list to file
    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            driveDocuments: driveFiles.size,
            pineconeDocuments: pineconeFiles.size,
            missingInPinecone: missingInPinecone.length,
            orphanedInPinecone: orphanedInPinecone.length
        },
        missingDocuments: missingInPinecone,
        orphanedDocuments: orphanedInPinecone
    };

    await fs.writeFile('./query/pinecone-drive-comparison.json', JSON.stringify(report, null, 2));
    console.log('📝 Detailed report saved to: query/pinecone-drive-comparison.json\n');
}

comparePineconeDrive().catch(console.error);
