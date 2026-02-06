#!/usr/bin/env node

import fs from 'fs/promises';

/**
 * Generate report showing which of the 22 files were successfully indexed vs failed
 */
async function generateStatusReport() {
    const report = JSON.parse(await fs.readFile('./query/files-to-index.json', 'utf-8'));
    const filesToIndex = report.filesToIndex;

    console.log('📊 INDEXING STATUS REPORT - 22 Files\n');
    console.log('='.repeat(80) + '\n');

    // Successfully indexed files
    const success = [
        'CommerceIQ Sales Agent Messaging Framework.docx',
        'Content Agent Training Deck',
        'RMM Second call deck',
        'Content Agent_Product Box_WIP',
        'AllyAI Teammate I S&S Dashboard Example Generic'
    ];

    console.log('✅ SUCCESSFULLY INDEXED (5 files):\n');
    const successFiles = filesToIndex.filter(f => success.some(s => f.docName.includes(s)));
    successFiles.forEach((f, i) => {
        console.log(`${i+1}. ${f.docName}`);
        console.log(`   Priority: ${f.priority}`);
        console.log(`   Type: ${f.fileType}`);
        console.log(`   File ID: ${f.fileId}`);
        console.log();
    });

    console.log('='.repeat(80) + '\n');

    // Failed files
    const failed = filesToIndex.filter(f => !success.some(s => f.docName.includes(s)));

    console.log(`❌ FAILED TO INDEX (${failed.length} files):\n`);

    // Group by failure reason
    const shortcuts = [];
    const pdfs = [];
    const audio = [];
    const pptx = [];

    failed.forEach(f => {
        if (f.fileType.includes('Drive File')) {
            // Check if it's audio
            if (f.docName.toLowerCase().includes('.wav')) {
                audio.push(f);
            } else if (f.docName.toLowerCase().includes('.pdf')) {
                pdfs.push(f);
            } else {
                shortcuts.push(f);
            }
        } else if (f.fileType.includes('PDF')) {
            pdfs.push(f);
        } else if (f.docName.toLowerCase().includes('.pptx')) {
            pptx.push(f);
        } else {
            shortcuts.push(f);
        }
    });

    if (shortcuts.length > 0) {
        console.log(`🔗 SHORTCUTS WITH BAD FILE IDs (${shortcuts.length} files):`);
        console.log('   Issue: These are shortcuts to other files, file IDs are incorrect/inaccessible\n');
        shortcuts.forEach((f, i) => {
            console.log(`   ${i+1}. ${f.docName}`);
            console.log(`      Priority: ${f.priority}`);
            console.log(`      File ID: ${f.fileId}`);
            console.log(`      URL: ${f.url}`);
            console.log();
        });
    }

    if (pdfs.length > 0) {
        console.log(`📄 PDFs WITH EXTRACTION ISSUES (${pdfs.length} files):`);
        console.log('   Issue: File IDs not found or PDF is image-based (no extractable text)\n');
        pdfs.forEach((f, i) => {
            console.log(`   ${i+1}. ${f.docName}`);
            console.log(`      Priority: ${f.priority}`);
            console.log(`      File ID: ${f.fileId}`);
            console.log(`      URL: ${f.url}`);
            console.log();
        });
    }

    if (audio.length > 0) {
        console.log(`🎵 AUDIO FILES (${audio.length} files):`);
        console.log('   Issue: Audio files (.wav) are not supported\n');
        audio.forEach((f, i) => {
            console.log(`   ${i+1}. ${f.docName}`);
            console.log(`      Priority: ${f.priority}`);
            console.log(`      URL: ${f.url}`);
            console.log();
        });
    }

    if (pptx.length > 0) {
        console.log(`📊 PPTX FILES (${pptx.length} files):`);
        console.log('   Issue: PPTX export via Drive API failed\n');
        pptx.forEach((f, i) => {
            console.log(`   ${i+1}. ${f.docName}`);
            console.log(`      Priority: ${f.priority}`);
            console.log(`      File ID: ${f.fileId}`);
            console.log(`      URL: ${f.url}`);
            console.log();
        });
    }

    console.log('='.repeat(80));
    console.log('\n📈 SUMMARY:\n');
    console.log(`   ✅ Successfully indexed: ${successFiles.length}/22 files (${Math.round(successFiles.length/22*100)}%)`);
    console.log(`   ❌ Failed to index: ${failed.length}/22 files (${Math.round(failed.length/22*100)}%)`);
    console.log(`   📦 Total chunks created: 50`);

    // Breakdown by priority
    const highSuccess = successFiles.filter(f => f.priority === 'High').length;
    const highTotal = filesToIndex.filter(f => f.priority === 'High').length;
    const mediumSuccess = successFiles.filter(f => f.priority === 'Medium').length;
    const mediumTotal = filesToIndex.filter(f => f.priority === 'Medium').length;

    console.log(`\n   High Priority: ${highSuccess}/${highTotal} indexed`);
    console.log(`   Medium Priority: ${mediumSuccess}/${mediumTotal} indexed`);

    console.log('\n' + '='.repeat(80));

    console.log('\n💡 NEXT STEPS:\n');
    console.log('   1. For shortcuts: Get the correct target file IDs from Google Drive');
    console.log('   2. For PDFs: Check if they are image-based (may need OCR)');
    console.log('   3. For audio: Audio indexing not currently supported');
    console.log('   4. For PPTX: Try converting to Google Slides or PDF first\n');
}

generateStatusReport().catch(console.error);
