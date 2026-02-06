#!/usr/bin/env node

import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
const auth = new google.auth.GoogleAuth({
    keyFile: credPath,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
});

const drive = google.drive({ version: 'v3', auth });

const scanFolder = async (folderId) => {
    const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 1000,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true
    });
    return response.data.files;
};

const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
const rootFiles = await scanFolder(rootId);
const whitePapersFolder = rootFiles.find(f => f.name === 'White Papers');

if (whitePapersFolder) {
    const files = await scanFolder(whitePapersFolder.id);
    const winning = files.filter(f =>
        f.name.toLowerCase().includes('winning') &&
        f.mimeType !== 'application/vnd.google-apps.shortcut'
    );
    console.log(JSON.stringify(winning, null, 2));
} else {
    console.log('White Papers folder not found');
}
