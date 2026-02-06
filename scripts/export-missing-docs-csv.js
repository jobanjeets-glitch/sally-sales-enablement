#!/usr/bin/env node

import fs from 'fs/promises';

/**
 * Create CSV of missing documents with URLs from Drive sheet
 */
async function exportMissingDocsCsv() {
    console.log('📊 Creating CSV of missing documents...\n');

    // Read comparison report
    const report = JSON.parse(await fs.readFile('./query/pinecone-drive-comparison.json', 'utf-8'));

    // Read original Drive sheet
    const csvPath = process.env.HOME + '/Downloads/test gtm collateral - Sheet1.csv';
    const driveData = await fs.readFile(csvPath, 'utf-8');
    const driveLines = driveData.split('\n');

    // Parse Drive sheet into map
    const driveMap = new Map();
    for (let i = 1; i < driveLines.length; i++) {
        const line = driveLines[i].trim();
        if (!line) continue;

        // Parse CSV line (handle quoted fields)
        const parts = line.match(/(?:"([^"]*)"|([^,]+))(?:,|$)/g);
        if (parts && parts.length >= 3) {
            const fileName = parts[0].replace(/^"|"$/g, '').replace(/,$/, '').trim();
            const url = parts[1].replace(/^"|"$/g, '').replace(/,$/, '').trim();
            const fileId = parts[2].replace(/^"|"$/g, '').replace(/,$/, '').trim();

            if (fileName && fileName.length > 0) {
                driveMap.set(fileName, { url, fileId });
            }
        }
    }

    // Build missing docs CSV with categories
    const rows = [
        ['Document Name', 'URL', 'File ID', 'Category', 'Priority', 'Notes']
    ];

    for (const docName of report.missingDocuments) {
        const driveInfo = driveMap.get(docName);
        const url = driveInfo?.url || 'NOT FOUND';
        const fileId = driveInfo?.fileId || '';

        // Categorize
        let category = 'Other';
        let priority = 'Medium';
        let notes = '';

        if (docName.includes('Deck') || docName.includes('deck')) {
            category = 'Presentation/Deck';
            priority = 'High';
        } else if (docName.includes('Battle Card') || docName.includes('Competitive')) {
            category = 'Battle Card';
            priority = 'High';
        } else if (docName.includes('Case Study')) {
            category = 'Case Study';
            priority = 'Medium';
        } else if (docName.endsWith('.pdf') || docName.endsWith('.PDF')) {
            category = 'PDF Document';
            priority = 'High';
        } else if (docName.includes('Framework') || docName.endsWith('.docx')) {
            category = 'Framework/Doc';
            priority = 'High';
        } else if (docName.includes('Training')) {
            category = 'Training Material';
            priority = 'High';
        } else if (docName.includes('Industry') || docName.includes('Report') || docName.includes('Insights')) {
            category = 'Industry Report';
            priority = 'Low';
        } else if (docName.includes('Video') || docName.includes('Demo')) {
            category = 'Video';
            priority = 'Low';
            notes = 'Videos cannot be indexed';
        } else if (!url || url === 'NOT FOUND' || url.includes('folders')) {
            category = 'Folder';
            priority = 'Skip';
            notes = 'Folder, not a document';
        }

        rows.push([
            docName,
            url,
            fileId,
            category,
            priority,
            notes
        ]);
    }

    // Convert to CSV
    const csv = rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // Save
    await fs.writeFile('./query/missing-documents.csv', csv);

    console.log('✅ Missing documents CSV created!\n');
    console.log('📊 Summary by Category:\n');

    // Count by category
    const categoryCounts = {};
    const priorityCounts = {};
    for (let i = 1; i < rows.length; i++) {
        const category = rows[i][3];
        const priority = rows[i][4];
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
    }

    console.log('By Category:');
    for (const [cat, count] of Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${cat}: ${count}`);
    }

    console.log('\nBy Priority:');
    for (const [pri, count] of Object.entries(priorityCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${pri}: ${count}`);
    }

    console.log('\n📝 File saved to: query/missing-documents.csv\n');

    // Also create priority list
    console.log('🎯 HIGH PRIORITY Documents to Index (33):');
    console.log('='.repeat(60));
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][4] === 'High' && count < 33) {
            console.log(`   ${count + 1}. ${rows[i][0]}`);
            count++;
        }
    }
}

exportMissingDocsCsv().catch(console.error);
