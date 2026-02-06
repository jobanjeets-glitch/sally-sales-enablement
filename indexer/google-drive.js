import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

export class GoogleDriveScanner {
    constructor(credentialsPath) {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        
        this.auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.readonly'],
        });
        
        this.drive = google.drive({ version: 'v3', auth: this.auth });
    }

    // Check if folder/file should be excluded (archived)
    shouldExclude(name) {
        const excludePatterns = [
            /archived?/i,
            /old/i,
            /deprecated/i,
            /\[archived?\]/i,
            /_archived?_/i,
            /archived?[_-]/i,
            /[_-]archived?/i,
            /backup/i
        ];
        
        return excludePatterns.some(pattern => pattern.test(name));
    }

    async listFiles(folderId) {
        const allFiles = [];
        
        async function scanFolder(drive, parentId, parentPath = '') {
            const response = await drive.files.list({
                q: `'${parentId}' in parents and trashed=false`,
                fields: 'files(id, name, mimeType, modifiedTime, parents)',
                pageSize: 1000
            });

            for (const file of response.data.files) {
                const currentPath = path.join(parentPath, file.name);
                
                // Skip if archived
                if (this.shouldExclude(file.name)) {
                    console.log(`⏭️  Skipping archived: ${currentPath}`);
                    continue;
                }
                
                if (file.mimeType === 'application/vnd.google-apps.folder') {
                    // Recursively scan subfolder
                    await scanFolder(drive, file.id, currentPath);
                } else {
                    // Add file to list
                    allFiles.push({
                        id: file.id,
                        name: file.name,
                        mimeType: file.mimeType,
                        modifiedTime: file.modifiedTime,
                        path: currentPath,
                        url: `https://drive.google.com/file/d/${file.id}/view`
                    });
                }
            }
        }

        await scanFolder.call(this, this.drive, folderId);
        return allFiles;
    }

    async downloadFile(fileId, destPath) {
        const dest = fs.createWriteStream(destPath);
        
        const response = await this.drive.files.get(
            { fileId, alt: 'media' },
            { responseType: 'stream' }
        );

        return new Promise((resolve, reject) => {
            response.data
                .on('end', () => resolve())
                .on('error', reject)
                .pipe(dest);
        });
    }

    async exportGoogleDoc(fileId, destPath, mimeType) {
        // Export Google Docs/Sheets/Slides as PDF
        const exportMimeType = 'application/pdf';
        
        const dest = fs.createWriteStream(destPath);
        const response = await this.drive.files.export(
            { fileId, mimeType: exportMimeType },
            { responseType: 'stream' }
        );

        return new Promise((resolve, reject) => {
            response.data
                .on('end', () => resolve())
                .on('error', reject)
                .pipe(dest);
        });
    }
}
