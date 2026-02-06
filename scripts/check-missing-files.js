#!/usr/bin/env node

import fs from 'fs/promises';

const missing = [
  'Agent Deployment Tracker',
  'CommerceIQ-AllyAI-Content-Agent-OnePager.pdf',
  'CommerceIQ Pro-Cat: A global content management tool',
  'Command Center talktrack',
  'CommerceIQ Copilot for Amazon - Datasheet July 25',
  'CommerceIQ Copilot for Amazon - Pricing August 25 Internal',
  'AllyAI-Sales-Teammate Datasheet July 25',
  'RMM Datasheet July 25',
  'DSO_OnePager_Jul25.PDF',
  'AI Goal Optimizer Media Teammate Sell Sheet June 2025',
  'ExpertIQ-Datasheet.pdf',
  'Ally Teammate I Training v2',
  'DSO_Product Box_v2.1_Jul2025_INTERNAL',
  'RMM Pricing Calculator August 25 Internal',
  'Buyer Personas - v2_7.20.22.pptx'
];

const catalog = JSON.parse(await fs.readFile('./query/document-catalog-identity-focused.json', 'utf-8'));

const results = [];
for (const file of missing) {
  const cleanFile = file.toLowerCase().replace(/\.pdf|\.pptx/g, '').trim();

  // Try to find match in catalog
  const match = catalog.documents.find(d => {
    const catalogName = d.name.toLowerCase().trim();

    // Exact match
    if (catalogName === cleanFile) return true;

    // Contains match
    if (catalogName.includes(cleanFile) || cleanFile.includes(catalogName)) return true;

    // Check for variations (datasheet vs data sheet, etc)
    const cleanFileParts = cleanFile.replace(/[_-]/g, ' ').split(/\s+/);
    const catalogParts = catalogName.replace(/[_-]/g, ' ').split(/\s+/);

    // Check if all significant parts match
    const significantParts = cleanFileParts.filter(p => p.length > 3);
    if (significantParts.length > 0) {
      const matchCount = significantParts.filter(part =>
        catalogParts.some(cp => cp.includes(part) || part.includes(cp))
      ).length;

      return matchCount >= Math.min(3, significantParts.length);
    }

    return false;
  });

  results.push({
    file,
    inCatalog: match ? 'Yes' : 'No',
    catalogName: match ? match.name : 'N/A'
  });
}

// Output CSV
console.log('Document Name (Missing from Pinecone),In Catalog,Catalog Name (if different)');
for (const r of results) {
  const catalogNameDisplay = r.catalogName === 'N/A' ? 'N/A' : r.catalogName;
  console.log(`"${r.file}",${r.inCatalog},"${catalogNameDisplay}"`);
}

// Save to file
const csvContent = [
  'Document Name (Missing from Pinecone),In Catalog,Catalog Name (if different)',
  ...results.map(r => `"${r.file}",${r.inCatalog},"${r.catalogName}"`)
].join('\n');

await fs.writeFile('./query/missing-files-status.csv', csvContent);
console.log('\n✅ CSV saved to: ./query/missing-files-status.csv');
