#!/usr/bin/env node

import { google } from 'googleapis';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const FILE_ID = '1OTAKoxgOvSILDwYb6ev6mzJoVm9EBH8eePk3XL5v_mE'; // First Call Deck - Agentic Commerce
const FILE_NAME = 'First Call Deck - Agentic Commerce';

async function compareContent() {
    // Initialize Google Drive
    const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
    const auth = new google.auth.GoogleAuth({
        keyFile: credPath,
        scopes: [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/presentations.readonly'
        ]
    });

    const drive = google.drive({ version: 'v3', auth });
    const slides = google.slides({ version: 'v1', auth });

    // Get file metadata from Drive
    console.log('Fetching file metadata from Google Drive...\n');
    const fileMetadata = await drive.files.get({
        fileId: FILE_ID,
        fields: 'id, name, modifiedTime, version, md5Checksum, size'
    });

    console.log('Drive Metadata:');
    console.log(`  Name: ${fileMetadata.data.name}`);
    console.log(`  Modified: ${fileMetadata.data.modifiedTime}`);
    console.log(`  Version: ${fileMetadata.data.version || 'N/A'}`);
    console.log(`  Size: ${fileMetadata.data.size || 'N/A'}`);
    console.log();

    // Get presentation content from Drive
    console.log('Fetching presentation content from Google Drive...\n');
    const presentation = await slides.presentations.get({
        presentationId: FILE_ID
    });

    let driveContent = [];
    for (const slide of presentation.data.slides) {
        if (slide.pageElements) {
            for (const element of slide.pageElements) {
                if (element.shape?.text?.textElements) {
                    for (const textElement of element.shape.text.textElements) {
                        if (textElement.textRun?.content) {
                            driveContent.push(textElement.textRun.content.trim());
                        }
                    }
                }
            }
        }
    }

    const driveText = driveContent.filter(t => t.length > 0).join(' ').substring(0, 500);
    console.log('Drive Content (first 500 chars):');
    console.log(driveText);
    console.log(`\nTotal slides: ${presentation.data.slides.length}`);
    console.log();

    // Query Pinecone for this file
    console.log('Fetching content from Pinecone...\n');
    const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);

    const results = await index.query({
        vector: new Array(3072).fill(0),
        topK: 100,
        filter: { 'File.id': { $eq: FILE_ID } },
        includeMetadata: true
    });

    if (results.matches.length === 0) {
        console.log('❌ No vectors found in Pinecone for this file!');
        return;
    }

    console.log('Pinecone Metadata (first vector):');
    const firstMatch = results.matches[0].metadata;
    console.log(`  File.name: ${firstMatch['File.name']}`);
    console.log(`  File.modifiedDate: ${firstMatch['File.modifiedDate']}`);
    console.log(`  File.lastSyncDate: ${firstMatch['File.lastSyncDate'] || 'N/A'}`);
    console.log(`  File.version: ${firstMatch['File.version'] || 'N/A'}`);
    console.log(`  File.size: ${firstMatch['File.size'] || 'N/A'}`);
    console.log(`  Total vectors: ${results.matches.length}`);
    console.log();

    // Get sample content from Pinecone
    const pineconeTexts = results.matches
        .map(m => m.metadata.text)
        .filter(t => t)
        .slice(0, 3);

    console.log('Pinecone Content (first 3 chunks):');
    pineconeTexts.forEach((text, i) => {
        console.log(`\nChunk ${i + 1} (first 200 chars):`);
        console.log(text.substring(0, 200));
    });
    console.log();

    // Compare
    console.log('='.repeat(80));
    console.log('COMPARISON RESULT:');
    console.log('='.repeat(80));

    const driveDate = fileMetadata.data.modifiedTime.split('T')[0];
    const pineconeDate = firstMatch['File.modifiedDate'];

    console.log(`Drive date: ${fileMetadata.data.modifiedTime} (${driveDate})`);
    console.log(`Pinecone date: ${pineconeDate}`);
    console.log(`Dates match (day level): ${driveDate === pineconeDate ? '✅ YES' : '❌ NO'}`);
    console.log();

    // Check if any Drive content appears in Pinecone
    const sampleDriveWords = driveText.split(' ').slice(5, 10).join(' ');
    const appearsInPinecone = pineconeTexts.some(t =>
        t.toLowerCase().includes(sampleDriveWords.toLowerCase())
    );

    console.log(`Sample Drive text appears in Pinecone: ${appearsInPinecone ? '✅ YES' : '❌ NO'}`);
    console.log();

    if (driveDate === pineconeDate && appearsInPinecone) {
        console.log('✅ VERDICT: File has NOT changed - False positive due to timestamp precision');
    } else {
        console.log('⚠️  VERDICT: File MAY have changed - Further investigation needed');
    }
}

compareContent().catch(console.error);
