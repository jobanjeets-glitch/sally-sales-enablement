#!/usr/bin/env node

import fs from 'fs/promises';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Export catalog to Google Sheets format (CSV)
 */
async function exportCatalogToCSV() {
    console.log('📊 Exporting catalog to CSV...\n');

    // Read catalog
    const catalogData = await fs.readFile('./query/document-catalog.json', 'utf-8');
    const catalog = JSON.parse(catalogData);

    // Prepare CSV rows
    const rows = [
        // Header
        [
            'Document Name',
            'URL',
            'Type',
            'Purpose',
            'Keywords',
            'Aliases',
            'Products',
            'Competitors',
            'Category',
            'Target Audience'
        ]
    ];

    // Add document rows
    for (const doc of catalog.documents) {
        rows.push([
            doc.name,
            doc.url || '',
            doc.type,
            doc.purpose,
            doc.keywords.join(', '),
            doc.aliases.join(', '),
            doc.products?.join(', ') || '',
            doc.competitors?.join(', ') || '',
            doc.category,
            doc.targetAudience
        ]);
    }

    // Convert to CSV
    const csv = rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // Save CSV
    await fs.writeFile('./query/document-catalog.csv', csv);

    console.log('✅ CSV exported to: query/document-catalog.csv');
    console.log(`   Total rows: ${rows.length - 1} documents\n`);
    console.log('📋 Next steps:');
    console.log('   1. Create a Google Sheet');
    console.log('   2. Import this CSV file');
    console.log('   3. Use the sheet ID in n8n\n');

    return csv;
}

/**
 * Upload directly to Google Sheets (if credentials available)
 */
async function exportToGoogleSheets() {
    console.log('📊 Exporting catalog to Google Sheets...\n');

    try {
        // Read catalog
        const catalogData = await fs.readFile('./query/document-catalog.json', 'utf-8');
        const catalog = JSON.parse(catalogData);

        // Initialize Google Sheets API
        const auth = new google.auth.GoogleAuth({
            keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // Prepare data
        const values = [
            // Header
            [
                'Document Name',
                'URL',
                'Type',
                'Purpose',
                'Keywords',
                'Aliases',
                'Products',
                'Competitors',
                'Category',
                'Target Audience'
            ]
        ];

        // Add document rows
        for (const doc of catalog.documents) {
            values.push([
                doc.name,
                doc.url || '',
                doc.type,
                doc.purpose,
                doc.keywords.join(', '),
                doc.aliases.join(', '),
                doc.products?.join(', ') || '',
                doc.competitors?.join(', ') || '',
                doc.category,
                doc.targetAudience
            ]);
        }

        // Create new spreadsheet
        const spreadsheet = await sheets.spreadsheets.create({
            requestBody: {
                properties: {
                    title: 'Sally Document Catalog'
                },
                sheets: [
                    {
                        properties: {
                            title: 'Documents'
                        }
                    }
                ]
            }
        });

        const spreadsheetId = spreadsheet.data.spreadsheetId;

        // Write data
        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: 'Documents!A1',
            valueInputOption: 'RAW',
            requestBody: {
                values
            }
        });

        console.log('✅ Catalog uploaded to Google Sheets!');
        console.log(`   Spreadsheet ID: ${spreadsheetId}`);
        console.log(`   URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}\n`);
        console.log('📋 Use this Sheet ID in n8n Google Sheets node\n');

        return spreadsheetId;

    } catch (error) {
        console.error('❌ Error uploading to Google Sheets:', error.message);
        console.log('\n💡 No worries! Use the CSV export instead:');
        console.log('   Run: npm run export-catalog-csv\n');
    }
}

// Check if Google credentials available
const hasGoogleCreds = process.env.GOOGLE_CREDENTIALS_PATH;

if (hasGoogleCreds) {
    exportToGoogleSheets();
} else {
    exportCatalogToCSV();
}
