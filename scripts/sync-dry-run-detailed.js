#!/usr/bin/env node

import { google } from 'googleapis';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

/**
 * Detailed Dry Run - Shows complete lists of NEW and MODIFIED files
 */

class DetailedDryRun {
    constructor() {
        const credPath = process.env.GOOGLE_CREDENTIALS_PATH || './google-credentials.json';
        this.auth = new google.auth.GoogleAuth({
            keyFile: credPath,
            scopes: [
                'https://www.googleapis.com/auth/drive.readonly',
                'https://www.googleapis.com/auth/documents.readonly',
                'https://www.googleapis.com/auth/presentations.readonly',
                'https://www.googleapis.com/auth/spreadsheets.readonly'
            ]
        });

        this.drive = google.drive({ version: 'v3', auth: this.auth });
        this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        this.index = this.pinecone.index(process.env.PINECONE_INDEX_NAME);
        this.folderTree = new Map();
    }

    async scanGoogleDrive(rootFolderId) {
        const allFiles = [];

        const scanFolder = async (folderId, path = '') => {
            const response = await this.drive.files.list({
                q: `'${folderId}' in parents and trashed=false`,
                fields: 'files(id, name, mimeType, modifiedTime, createdTime, webViewLink, parents, size, version, md5Checksum)',
                pageSize: 1000,
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });

            for (const item of response.data.files) {
                if (item.mimeType === 'application/vnd.google-apps.folder') {
                    const folderPath = path ? `${path}/${item.name}` : item.name;
                    this.folderTree.set(item.id, { id: item.id, name: item.name, path: folderPath });
                    await scanFolder(item.id, folderPath);
                } else {
                    const filePath = path || 'Root';
                    allFiles.push({ ...item, path: filePath, folderId: folderId });
                }
            }
        };

        await scanFolder(rootFolderId);
        return allFiles;
    }

    async loadPineconeState() {
        const pineconeFiles = new Map(); // fileId -> metadata
        const pineconeFilesByName = new Map(); // fileName -> metadata (for legacy files without File.id)
        let latestSyncDate = null;

        const sampleResults = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 10000,
            includeMetadata: true
        });

        for (const match of sampleResults.matches) {
            const fileId = match.metadata['File.id'];
            const fileName = match.metadata['File.name'];
            const lastSyncDate = match.metadata['File.lastSyncDate'];

            // Track the latest sync date across all files
            if (lastSyncDate && (!latestSyncDate || lastSyncDate > latestSyncDate)) {
                latestSyncDate = lastSyncDate;
            }

            if (fileId) {
                // Files with File.id (properly indexed)
                if (!pineconeFiles.has(fileId)) {
                    pineconeFiles.set(fileId, {
                        'File.id': fileId,
                        'File.name': fileName,
                        'File.modifiedDate': match.metadata['File.modifiedDate'],
                        'File.lastSyncDate': lastSyncDate,
                        'File.version': match.metadata['File.version'] || 0,
                        'File.md5': match.metadata['File.md5'],
                        'File.size': match.metadata['File.size'],
                        vectorCount: 1,
                        hasFileId: true
                    });
                } else {
                    pineconeFiles.get(fileId).vectorCount++;
                }
            } else if (fileName) {
                // Legacy files without File.id (indexed by n8n)
                if (!pineconeFilesByName.has(fileName)) {
                    pineconeFilesByName.set(fileName, {
                        'File.id': null,
                        'File.name': fileName,
                        'File.modifiedDate': match.metadata['File.modifiedDate'],
                        'File.lastSyncDate': lastSyncDate,
                        'File.version': match.metadata['File.version'] || 0,
                        'File.md5': match.metadata['File.md5'],
                        'File.size': match.metadata['File.size'],
                        vectorCount: 1,
                        hasFileId: false
                    });
                } else {
                    pineconeFilesByName.get(fileName).vectorCount++;
                }
            }
        }

        return { pineconeFiles, pineconeFilesByName, latestSyncDate };
    }

    filterFiles(files) {
        const shouldSkipFile = (file) => {
            const nameFilters = [
                { pattern: /archived/i, reason: 'Contains "archived"' },
                { pattern: /\(old\)/i, reason: 'Contains "(old)"' },
                { pattern: /deprecated/i, reason: 'Contains "deprecated"' },
                { pattern: /^Copy of/i, reason: 'Copy of another file' },
                { pattern: /\(copy\s*\d*\)/i, reason: 'Contains "(copy)"' },
                { pattern: /\~\$/, reason: 'Temporary file' }
            ];

            for (const filter of nameFilters) {
                if (filter.pattern.test(file.name)) return filter.reason;
            }

            // Skip individual case studies, but keep the master "Case Study Slide Library"
            // Match both "case study" (with space) and "casestudy" (without space)
            if (/case\s*study/i.test(file.name) && !/case study slide library/i.test(file.name)) {
                return 'Individual case study (master library only)';
            }

            // Skip old legacy files that have been superseded
            if (file.name === 'Profitero Comparison') {
                return 'Legacy file (superseded by Profitero Competitive Battle Card)';
            }

            return null;
        };

        const indexableMimeTypes = new Set([
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.presentation',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf'
        ]);

        const keep = [];

        for (const file of files) {
            // Skip shortcuts completely
            if (file.mimeType === 'application/vnd.google-apps.shortcut') {
                continue;
            }

            const skipReason = shouldSkipFile(file);
            if (skipReason) continue;

            if (!indexableMimeTypes.has(file.mimeType)) {
                continue;
            }

            keep.push(file);
        }

        return keep;
    }

    detectDuplicates(files) {
        const normalizeName = (fileName) => {
            return fileName
                .replace(/\.(pdf|pptx?|docx?|xlsx?|gslides?|gdocs?|gsheet?)$/i, '')
                .replace(/[_\-\s]+/g, ' ')
                .replace(/\(copy\s*\d*\)/gi, '')
                .replace(/\s+version\s+\d+/gi, '')
                .toLowerCase()
                .trim();
        };

        const mimeTypePriority = [
            'application/vnd.google-apps.presentation',
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ];

        const groups = new Map();

        for (const file of files) {
            const normalizedName = normalizeName(file.name);
            if (!groups.has(normalizedName)) {
                groups.set(normalizedName, []);
            }
            groups.get(normalizedName).push(file);
        }

        const winners = [];

        for (const [name, group] of groups) {
            if (group.length === 1) {
                winners.push(group[0]);
            } else {
                const sorted = group.sort((a, b) => {
                    const priorityA = mimeTypePriority.indexOf(a.mimeType);
                    const priorityB = mimeTypePriority.indexOf(b.mimeType);
                    if (priorityA === priorityB) {
                        return new Date(b.modifiedTime) - new Date(a.modifiedTime);
                    }
                    return priorityA - priorityB;
                });
                winners.push(sorted[0]);
            }
        }

        return winners;
    }

    normalizeName(fileName) {
        return fileName
            .replace(/\.(pdf|pptx?|docx?|xlsx?|gslides?|gdocs?|gsheet?)$/i, '')
            .replace(/[_\-:]+/g, ' ')
            .replace(/\(copy\s*\d*\)/gi, '')
            // Strip version indicators (va, vb, v1, v2, v1.1, etc.)
            .replace(/\s+v[a-z]\b/gi, '')  // va, vb, vc
            .replace(/\s+v\d+(\.\d+)*/gi, '')  // v1, v2, v1.1
            .replace(/\s+_v\d+(\.\d+)*/gi, '')  // _v1
            .replace(/\s+version\s+\d+/gi, '')
            // Normalize common document aliases
            .replace(/\bquarterly\s+industry\s+trends\b/gi, 'state of retail ecommerce')
            .replace(/\bthe\s+state\s+of\s+retail\s+ecommerce\b/gi, 'state of retail ecommerce')
            .replace(/\bindustry\s*trends\b/gi, 'state of retail ecommerce')
            // Normalize common abbreviations
            .replace(/\bgen\s+ai\b/gi, 'generative ai')
            .replace(/\bai\s+goal\s+optimizer\b/gi, 'aigo')
            // Remove ALL years for better matching (202X)
            .replace(/\b202[0-9]\b/gi, '')
            .toLowerCase()
            .replace(/\s+/g, ' ')  // Collapse multiple spaces
            .trim();
    }

    // Check if two normalized names are similar (fuzzy matching)
    isSimilarName(name1, name2) {
        const n1 = this.normalizeName(name1);
        const n2 = this.normalizeName(name2);

        // Exact match
        if (n1 === n2) return true;

        // One is a substring of the other (handles truncated titles)
        // But require at least 30 characters to avoid false positives
        if (n1.length >= 30 || n2.length >= 30) {
            if (n1.includes(n2) || n2.includes(n1)) return true;
        }

        return false;
    }

    classifyChanges(driveFiles, { pineconeFiles, pineconeFilesByName, latestSyncDate }) {
        const newFiles = [];
        const modifiedFiles = [];
        const unchangedFiles = [];

        // Use the latest sync date from Pinecone, or default to 30 days ago if none exists
        const cutoffDate = latestSyncDate
            ? new Date(latestSyncDate + 'T00:00:00Z')
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

        // Collect all Pinecone files for fuzzy matching
        const allPineconeFiles = [];
        for (const data of pineconeFiles.values()) {
            allPineconeFiles.push(data);
        }
        for (const data of pineconeFilesByName.values()) {
            allPineconeFiles.push(data);
        }

        for (const file of driveFiles) {
            // Try to match by File.id first (primary key)
            let pineconeData = pineconeFiles.get(file.id);

            // Fallback: match by exact name if no File.id match (legacy n8n files)
            if (!pineconeData) {
                pineconeData = pineconeFilesByName.get(file.name);
            }

            // Fallback: fuzzy matching by similar names
            if (!pineconeData) {
                pineconeData = allPineconeFiles.find(p =>
                    this.isSimilarName(file.name, p['File.name'])
                );
            }

            if (!pineconeData) {
                newFiles.push(file);
                continue;
            }

            // Check if file was modified after last sync date
            const fileModifiedDate = new Date(file.modifiedTime);
            if (fileModifiedDate <= cutoffDate) {
                unchangedFiles.push({
                    file,
                    reason: `Not modified since last sync (${cutoffDate.toISOString().split('T')[0]})`
                });
                continue;
            }

            // If matched by name only (no File.id), mark for re-indexing
            if (!pineconeData.hasFileId) {
                modifiedFiles.push({
                    file,
                    signals: { legacyFile: true, needsFileId: true },
                    pineconeData,
                    reason: 'Legacy file without File.id - needs re-indexing'
                });
                continue;
            }

            const signals = {
                versionChanged: file.version && pineconeData['File.version'] &&
                                file.version > pineconeData['File.version'],
                dateChanged: new Date(file.modifiedTime) > new Date(pineconeData['File.modifiedDate'] + 'T00:00:00Z'),
                hashChanged: file.md5Checksum && pineconeData['File.md5'] &&
                            file.md5Checksum !== pineconeData['File.md5'],
                nameChanged: file.name !== pineconeData['File.name'],
                sizeChanged: file.size && pineconeData['File.size'] &&
                            Math.abs(file.size - pineconeData['File.size']) > 100
            };

            if (signals.versionChanged || signals.hashChanged || signals.sizeChanged || signals.dateChanged) {
                modifiedFiles.push({
                    file,
                    signals,
                    pineconeData
                });
            } else {
                unchangedFiles.push({
                    file,
                    reason: 'No changes detected'
                });
            }
        }

        return { newFiles, modifiedFiles, unchangedFiles };
    }

    async run() {
        console.log('Scanning...\n');

        const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
        const allFiles = await this.scanGoogleDrive(rootFolderId);
        const pineconeState = await this.loadPineconeState();

        const filtered = this.filterFiles(allFiles);
        const deduplicated = this.detectDuplicates(filtered);
        const { newFiles, modifiedFiles } = this.classifyChanges(deduplicated, pineconeState);

        // Output NEW files
        console.log('='.repeat(100));
        console.log('NEW FILES TO INDEX (' + newFiles.length + ' files)');
        console.log('='.repeat(100));
        console.log();

        const newFilesList = newFiles.map(f => ({
            name: f.name,
            type: f.mimeType,
            folder: f.path,
            modified: f.modifiedTime?.split('T')[0] || 'N/A',
            url: f.webViewLink
        }));

        newFilesList.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));

        for (const file of newFilesList) {
            console.log(`File: ${file.name}`);
            console.log(`  Folder: ${file.folder}`);
            console.log(`  Type: ${file.type}`);
            console.log(`  Modified: ${file.modified}`);
            console.log(`  URL: ${file.url}`);
            console.log();
        }

        // Output MODIFIED files
        console.log('='.repeat(100));
        console.log('MODIFIED FILES TO RE-INDEX (' + modifiedFiles.length + ' files)');
        console.log('='.repeat(100));
        console.log();

        const modifiedFilesList = modifiedFiles.map(m => ({
            name: m.file.name,
            type: m.file.mimeType,
            folder: m.file.path,
            driveModified: m.file.modifiedTime?.split('T')[0] || 'N/A',
            pineconeModified: m.pineconeData['File.modifiedDate'] || 'N/A',
            url: m.file.webViewLink,
            signals: Object.entries(m.signals).filter(([k, v]) => v).map(([k]) => k),
            reason: m.reason || ''
        }));

        modifiedFilesList.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));

        for (const file of modifiedFilesList) {
            console.log(`File: ${file.name}`);
            console.log(`  Folder: ${file.folder}`);
            console.log(`  Type: ${file.type}`);
            console.log(`  Drive Modified: ${file.driveModified}`);
            console.log(`  Pinecone Modified: ${file.pineconeModified}`);
            console.log(`  Change Signals: ${file.signals.join(', ')}`);
            if (file.reason) {
                console.log(`  Reason: ${file.reason}`);
            }
            console.log(`  URL: ${file.url}`);
            console.log();
        }

        // Save to CSV
        const newCSV = [
            'Name,Folder,Type,Modified,URL',
            ...newFilesList.map(f => `"${f.name}","${f.folder}","${f.type}","${f.modified}","${f.url}"`)
        ].join('\n');

        const modifiedCSV = [
            'Name,Folder,Type,Drive Modified,Pinecone Modified,Change Signals,Reason,URL',
            ...modifiedFilesList.map(f => `"${f.name}","${f.folder}","${f.type}","${f.driveModified}","${f.pineconeModified}","${f.signals.join('; ')}","${f.reason}","${f.url}"`)
        ].join('\n');

        await fs.writeFile('./reports/new-files.csv', newCSV);
        await fs.writeFile('./reports/modified-files.csv', modifiedCSV);

        console.log('='.repeat(100));
        console.log('CSV files saved:');
        console.log('  - reports/new-files.csv');
        console.log('  - reports/modified-files.csv');
        console.log('='.repeat(100));
    }
}

const runner = new DetailedDryRun();
runner.run().catch(console.error);
