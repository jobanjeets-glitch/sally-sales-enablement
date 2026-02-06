#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX_NAME);

// Files we just indexed
const indexedFiles = [
  'RMM Datasheet July 25',
  'ExpertIQ-Datasheet.pdf',
  'AllyAI-Sales-Teammate Datasheet July 25',
  'DSO_OnePager_Jul25.PDF',
  'CommerceIQ Copilot for Amazon - Datasheet July 25',
  'AI Goal Optimizer Media Teammate Sell Sheet June 2025',
  'CommerceIQ-AllyAI-Content-Agent-OnePager.pdf'
];

const csvRows = [];
csvRows.push([
  'name',
  'url',
  'fileId',
  'type',
  'detailedDescription',
  'specificKeywords',
  'searchableTerms',
  'keyFeatures',
  'metrics',
  'products',
  'competitors',
  'category',
  'targetAudience',
  'doesSupport',
  'doesNotSupport'
]);

for (const fileName of indexedFiles) {
  // Query Pinecone for this file
  const results = await index.query({
    vector: new Array(3072).fill(0),
    topK: 10,
    includeMetadata: true,
    filter: { 'File.name': { $eq: fileName } }
  });

  if (results.matches.length === 0) {
    console.log(`⚠️  File not found in Pinecone: ${fileName}`);
    continue;
  }

  const metadata = results.matches[0].metadata;

  // Combine all text chunks to create a description
  const allText = results.matches.map(m => m.metadata.text).join(' ');
  const shortDescription = allText.substring(0, 500).trim() + '...';

  // Extract product/feature names from the text
  let products = [];
  let keyFeatures = [];
  let category = 'product-info';
  let targetAudience = 'Sales teams, ecommerce leaders';

  // Product detection
  if (fileName.includes('RMM')) {
    products = ['Retail Media Management (RMM)'];
    keyFeatures = ['Incrementality Optimization', 'Guided Campaign Builder', 'AI Market Insights'];
    category = 'datasheet';
    targetAudience = 'Retail media managers, ecommerce leaders';
  } else if (fileName.includes('ExpertIQ')) {
    products = ['ExpertIQ'];
    keyFeatures = ['Advanced insights and advisory services', 'Planning to execution support'];
    category = 'datasheet';
    targetAudience = 'Strategy teams, product success teams';
  } else if (fileName.includes('AllyAI-Sales-Teammate')) {
    products = ['AllyAI Sales Teammate'];
    keyFeatures = ['Always-on AI partner', 'Risk detection', 'Decision acceleration'];
    category = 'datasheet';
    targetAudience = 'Sales teams, account managers';
  } else if (fileName.includes('DSO')) {
    products = ['Digital Shelf Optimization (DSO)'];
    keyFeatures = ['Share of voice tracking', 'Insights & automation', 'Content optimization'];
    category = 'one-pager';
    targetAudience = 'Digital shelf managers, ecommerce teams';
  } else if (fileName.includes('Copilot for Amazon')) {
    products = ['CommerceIQ Copilot for Amazon'];
    keyFeatures = ['Digital POS recommendations', 'Performance tracking', 'AI-driven insights'];
    category = 'datasheet';
    targetAudience = 'Amazon sellers, ecommerce leaders';
  } else if (fileName.includes('AI Goal Optimizer')) {
    products = ['AI Goal Optimizer', 'Media Teammate'];
    keyFeatures = ['Goal-based optimization', 'Media spend automation', 'Real-time adjustments'];
    category = 'sell-sheet';
    targetAudience = 'Media buyers, retail media teams';
  } else if (fileName.includes('Content-Agent')) {
    products = ['Ally Content Agent'];
    keyFeatures = ['Content optimization', 'PDP matching', 'Chat-based interface'];
    category = 'one-pager';
    targetAudience = 'Content managers, merchandising teams';
  }

  csvRows.push([
    metadata['File.name'],
    metadata['File.webviewlink'] || '',
    metadata['File.id'],
    category,
    shortDescription,
    products.join('; '),
    products.map(p => p.toLowerCase().replace(/[()]/g, '')).join('; '),
    keyFeatures.join('; '),
    '', // metrics
    products.join('; '),
    '', // competitors
    category,
    targetAudience,
    keyFeatures.join('; '),
    '' // doesNotSupport
  ]);

  console.log(`✓ Added ${fileName}`);
}

// Convert to CSV
const csvContent = csvRows.map(row =>
  row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
).join('\n');

await fs.writeFile('./query/newly-indexed-catalog.csv', csvContent);
console.log('\n✅ CSV saved to: ./query/newly-indexed-catalog.csv');
console.log(`Total entries: ${csvRows.length - 1}`);
