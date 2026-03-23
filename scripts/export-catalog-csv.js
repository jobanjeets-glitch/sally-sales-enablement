#!/usr/bin/env node

import fs from 'fs/promises';

/**
 * Export identity-focused catalog to CSV for Google Sheets import
 */
async function exportCatalogToCSV() {
    console.log('📊 Exporting identity-focused catalog to CSV...\n');

    // Read catalog
    const catalogData = await fs.readFile('./query/document-catalog-identity-focused.json', 'utf-8');
    const catalog = JSON.parse(catalogData);

    console.log(`📚 Found ${catalog.totalDocuments} documents\n`);

    // Prepare CSV rows
    const rows = [
        // Header - exact column names requested
        [
            'Document Name',
            'URL',
            'fileId',
            'Document Type',
            'documentPurpose',
            'documentIdentity',
            'When to Use',
            'targetAudience',
            'mainTopics',
            'specificDetails',
            'keyTakeaways',
            'Search Queries',
            'notToConfuseWith',
            'productNames',
            'competitorNames',
            'customerNames',
            'keyMetrics',
            'keyFeatures',
            'version',
            'effectiveDate',
            'status'
        ]
    ];

    // Add document rows
    for (const doc of catalog.documents) {
        rows.push([
            doc.name || '',
            doc.url || '',
            doc.fileId || '',
            doc.documentType || '',
            doc.documentPurpose || '',
            doc.documentIdentity || '',
            doc.whenToUse || '',
            doc.targetAudience || '',
            doc.contentSummary?.mainTopics?.join('; ') || '',
            doc.contentSummary?.specificDetails?.join('; ') || '',
            doc.contentSummary?.keyTakeaways?.join('; ') || '',
            doc.searchQueries?.join('; ') || '',
            doc.notToConfuseWith?.join('; ') || '',
            doc.productNames?.join('; ') || '',
            doc.competitorNames?.join('; ') || '',
            doc.customerNames?.join('; ') || '',
            doc.keyMetrics?.join('; ') || '',
            doc.keyFeatures?.join('; ') || '',
            doc.version || '',
            doc.effectiveDate || '',
            doc.status || ''
        ]);
    }

    // Convert to CSV
    const csv = rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // Save CSV
    await fs.writeFile('./query/document-catalog-identity-focused.csv', csv);

    console.log('✅ CSV exported successfully!\n');
    console.log('📁 File: ./query/document-catalog-identity-focused.csv');
    console.log(`📊 Rows: ${rows.length - 1} documents\n`);

    console.log('📋 Next steps:');
    console.log('   1. Go to https://sheets.google.com');
    console.log('   2. Create a new sheet (or File → Import)');
    console.log('   3. File → Import → Upload');
    console.log('   4. Select: ./query/document-catalog-identity-focused.csv');
    console.log('   5. Import location: "Replace spreadsheet"');
    console.log('   6. Share the sheet with your n8n service account:');
    console.log('      google-drive-service-account@gtm-collateral.iam.gserviceaccount.com');
    console.log('   7. Copy the Sheet ID from URL');
    console.log('   8. Use Google Sheets node in n8n\n');

    console.log('💡 Preview (first document):');
    console.log(`   Name: ${catalog.documents[0].name}`);
    console.log(`   Type: ${catalog.documents[0].documentType}`);
    console.log(`   URL: ${catalog.documents[0].url}\n`);

    return csv;
}

exportCatalogToCSV().catch(console.error);
