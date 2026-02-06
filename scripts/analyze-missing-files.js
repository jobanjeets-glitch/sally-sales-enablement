#!/usr/bin/env node

import fs from 'fs/promises';

/**
 * Analyze the missing files status CSV
 */
async function analyzeMissingFiles() {
    console.log('📊 Analyzing Missing Files Status...\n');

    const csvPath = process.env.HOME + '/Downloads/test gtm collateral - missing files status.csv';
    const csvData = await fs.readFile(csvPath, 'utf-8');
    const lines = csvData.split('\n');

    const needsIndexing = [];
    const available = [];
    const notRequired = [];
    const maybe = [];

    // Parse CSV (skip header)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',');
        if (parts.length < 5) continue;

        const docName = parts[0].replace(/^"|"$/g, '');
        const status = parts[1].replace(/^"|"$/g, '');
        const url = parts[3].replace(/^"|"$/g, '');
        const fileId = parts[4].replace(/^"|"$/g, '');
        const category = parts[5]?.replace(/^"|"$/g, '') || 'Other';
        const priority = parts[6]?.replace(/^"|"$/g, '') || 'Medium';

        const doc = { docName, status, url, fileId, category, priority };

        if (status === 'NA') {
            needsIndexing.push(doc);
        } else if (status === 'Available' || status.includes('Available')) {
            available.push(doc);
        } else if (status.includes('Not required')) {
            notRequired.push(doc);
        } else if (status === 'Maybe') {
            maybe.push(doc);
        }
    }

    console.log('='.repeat(80));
    console.log('\n📈 SUMMARY\n');
    console.log('='.repeat(80) + '\n');
    console.log(`🔴 NEEDS INDEXING (NA):                ${needsIndexing.length} files`);
    console.log(`🟢 ALREADY AVAILABLE:                  ${available.length} files`);
    console.log(`⚪ NOT REQUIRED (Case Study Library):  ${notRequired.length} files`);
    console.log(`🟡 MAYBE (Uncertain):                  ${maybe.length} files`);

    // Analyze needs indexing by category
    console.log('\n' + '='.repeat(80));
    console.log('\n🔴 FILES THAT NEED INDEXING (22)\n');
    console.log('='.repeat(80) + '\n');

    const byCategory = {};
    const byPriority = {};
    const byFileType = {};

    for (const doc of needsIndexing) {
        byCategory[doc.category] = (byCategory[doc.category] || []);
        byCategory[doc.category].push(doc);

        byPriority[doc.priority] = (byPriority[doc.priority] || []);
        byPriority[doc.priority].push(doc);

        // Determine file type from URL
        let fileType = 'unknown';
        if (doc.url.includes('docs.google.com/document')) {
            fileType = 'Google Doc';
        } else if (doc.url.includes('docs.google.com/presentation')) {
            fileType = 'Google Slides';
        } else if (doc.url.includes('docs.google.com/spreadsheets')) {
            fileType = 'Google Sheets';
        } else if (doc.url.includes('drive.google.com/file')) {
            if (doc.docName.endsWith('.pdf') || doc.docName.endsWith('.PDF')) {
                fileType = 'PDF';
            } else if (doc.docName.includes('.docx')) {
                fileType = 'Google Doc (docx)';
            } else if (doc.docName.includes('.pptx')) {
                fileType = 'Google Slides (pptx)';
            } else {
                fileType = 'Drive File';
            }
        }

        doc.fileType = fileType;
        byFileType[fileType] = (byFileType[fileType] || []);
        byFileType[fileType].push(doc);
    }

    console.log('By Priority:');
    for (const [pri, docs] of Object.entries(byPriority).sort((a, b) => {
        const order = { 'High': 0, 'Medium': 1, 'Low': 2 };
        return order[a[0]] - order[b[0]];
    })) {
        console.log(`   ${pri}: ${docs.length}`);
    }

    console.log('\nBy File Type:');
    for (const [type, docs] of Object.entries(byFileType).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`   ${type}: ${docs.length}`);
    }

    console.log('\nBy Category:');
    for (const [cat, docs] of Object.entries(byCategory).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`   ${cat}: ${docs.length}`);
    }

    // Show high priority files
    console.log('\n' + '='.repeat(80));
    console.log('\n🔥 HIGH PRIORITY FILES (must index):\n');
    console.log('='.repeat(80) + '\n');

    const highPriority = needsIndexing.filter(d => d.priority === 'High');
    highPriority.forEach((doc, i) => {
        console.log(`${i + 1}. ${doc.docName}`);
        console.log(`   Type: ${doc.fileType} | Category: ${doc.category}`);
        console.log(`   File ID: ${doc.fileId || 'N/A'}`);
        console.log('');
    });

    // Show medium priority files
    console.log('='.repeat(80));
    console.log('\n🟡 MEDIUM PRIORITY FILES:\n');
    console.log('='.repeat(80) + '\n');

    const mediumPriority = needsIndexing.filter(d => d.priority === 'Medium');
    mediumPriority.forEach((doc, i) => {
        console.log(`${i + 1}. ${doc.docName} (${doc.fileType})`);
    });

    // Save detailed report
    const report = {
        summary: {
            needsIndexing: needsIndexing.length,
            available: available.length,
            notRequired: notRequired.length,
            maybe: maybe.length
        },
        byPriority,
        byFileType,
        byCategory,
        filesToIndex: needsIndexing
    };

    await fs.writeFile('./query/files-to-index.json', JSON.stringify(report, null, 2));
    console.log('\n📝 Detailed report saved to: query/files-to-index.json\n');

    return report;
}

analyzeMissingFiles().catch(console.error);
