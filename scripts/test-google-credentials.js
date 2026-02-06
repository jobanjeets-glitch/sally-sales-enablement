#!/usr/bin/env node

import { google } from 'googleapis';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test Google Drive credentials
 */
async function testGoogleCredentials() {
    console.log('🔐 Testing Google Drive credentials...\n');

    try {
        // Check if credentials file exists
        const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';

        try {
            await fs.access(credPath);
            console.log(`✅ Credentials file found: ${credPath}\n`);
        } catch {
            console.error(`❌ Credentials file NOT found at: ${credPath}`);
            console.error('\nPlease:');
            console.error('1. Download service account JSON from Google Cloud Console');
            console.error('2. Save it as: google-credentials.json');
            console.error('3. Or set GOOGLE_CREDENTIALS_PATH in .env\n');
            process.exit(1);
        }

        // Read credentials
        const credentials = JSON.parse(await fs.readFile(credPath, 'utf-8'));
        console.log('📧 Service Account Email:', credentials.client_email);
        console.log('🆔 Project ID:', credentials.project_id);
        console.log('');

        // Initialize Google Drive API
        const auth = new google.auth.GoogleAuth({
            keyFile: credPath,
            scopes: [
                'https://www.googleapis.com/auth/drive.readonly',
                'https://www.googleapis.com/auth/documents.readonly',
                'https://www.googleapis.com/auth/presentations.readonly',
                'https://www.googleapis.com/auth/spreadsheets.readonly'
            ]
        });

        const drive = google.drive({ version: 'v3', auth });

        console.log('🔍 Testing Drive API access...\n');

        // Test: List files (first 5)
        const response = await drive.files.list({
            pageSize: 5,
            fields: 'files(id, name, mimeType)'
        });

        if (response.data.files && response.data.files.length > 0) {
            console.log('✅ Successfully accessed Google Drive!\n');
            console.log('📁 Sample files you have access to:\n');
            response.data.files.forEach((file, i) => {
                console.log(`   ${i + 1}. ${file.name}`);
                console.log(`      Type: ${file.mimeType}`);
                console.log(`      ID: ${file.id}\n`);
            });
        } else {
            console.log('⚠️  API works, but no files found.');
            console.log('\n💡 Make sure to:');
            console.log(`   1. Share your Google Drive folder with: ${credentials.client_email}`);
            console.log('   2. Give it "Viewer" access\n');
        }

        console.log('='.repeat(80));
        console.log('\n✅ CREDENTIALS ARE VALID AND WORKING!\n');
        console.log('🎯 Next step: Run the indexer\n');
        console.log('   npm run index-missing-files\n');

    } catch (error) {
        console.error('❌ Error testing credentials:', error.message);

        if (error.code === 403) {
            console.error('\n💡 Permission denied. Make sure:');
            console.error('   1. APIs are enabled in Google Cloud Console');
            console.error('      - Google Drive API');
            console.error('      - Google Docs API');
            console.error('      - Google Slides API');
            console.error(`   2. Share folder with: ${credentials?.client_email}\n`);
        }

        process.exit(1);
    }
}

testGoogleCredentials().catch(console.error);
