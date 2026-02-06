#!/usr/bin/env node

import { google } from 'googleapis';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Intelligent Sync - Dry Run
 *
 * Scans Google Drive and Pinecone, shows what WOULD happen without making changes
 */

class SyncDryRun {
    constructor() {
        // Initialize Google Drive
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

        // Initialize Pinecone
        this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
        this.index = this.pinecone.index(process.env.PINECONE_INDEX_NAME);

        // Tracking
        this.folderTree = new Map(); // folderId -> folder info
        this.folderStats = new Map(); // folderId -> stats
    }

    /**
     * PHASE 1: Scan Google Drive and build folder tree
     */
    async scanGoogleDrive(rootFolderId) {
        console.log('📁 Phase 1: Scanning Google Drive folder structure...\n');

        const allFolders = [];
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
                    // It's a folder
                    const folderPath = path ? `${path}/${item.name}` : item.name;

                    this.folderTree.set(item.id, {
                        id: item.id,
                        name: item.name,
                        path: folderPath,
                        parent: folderId
                    });

                    this.folderStats.set(item.id, {
                        name: item.name,
                        path: folderPath,
                        files: {
                            total: 0,
                            toIndex: 0,
                            toReindex: 0,
                            toSkip: 0,
                            toDelete: 0
                        },
                        skipReasons: {}
                    });

                    allFolders.push({ ...item, path: folderPath });

                    // Recurse into subfolder
                    await scanFolder(item.id, folderPath);
                } else {
                    // It's a file
                    const filePath = path || 'Root';
                    allFiles.push({
                        ...item,
                        path: filePath,
                        folderId: folderId
                    });
                }
            }
        };

        await scanFolder(rootFolderId);

        console.log(`✓ Found ${allFolders.length} folders`);
        console.log(`✓ Found ${allFiles.length} files\n`);

        // Show folder structure
        console.log('Folder Structure:');
        const sortedFolders = Array.from(this.folderTree.values()).sort((a, b) => a.path.localeCompare(b.path));
        for (const folder of sortedFolders) {
            const indent = '  '.repeat((folder.path.match(/\//g) || []).length);
            console.log(`${indent}📁 ${folder.path}`);
        }
        console.log();

        return { folders: allFolders, files: allFiles };
    }

    /**
     * PHASE 2: Load Pinecone state
     */
    async loadPineconeState() {
        console.log('🔍 Phase 2: Loading Pinecone index state...\n');

        // Get all unique file IDs from Pinecone
        const pineconeFiles = new Map(); // fileId -> metadata

        // Query with zero vector to get all files
        const stats = await this.index.describeIndexStats();
        const totalVectors = stats.namespaces?.default?.vectorCount || 0;

        console.log(`Total vectors in Pinecone: ${totalVectors}`);

        // Sample query to get file list
        const sampleResults = await this.index.query({
            vector: new Array(3072).fill(0),
            topK: 10000,
            includeMetadata: true
        });

        for (const match of sampleResults.matches) {
            const fileId = match.metadata['File.id'];
            if (!fileId) continue;

            if (!pineconeFiles.has(fileId)) {
                pineconeFiles.set(fileId, {
                    'File.id': fileId,
                    'File.name': match.metadata['File.name'],
                    'File.modifiedDate': match.metadata['File.modifiedDate'],
                    'File.version': match.metadata['File.version'] || 0,
                    'File.md5': match.metadata['File.md5'],
                    'File.size': match.metadata['File.size'],
                    vectorCount: 1
                });
            } else {
                pineconeFiles.get(fileId).vectorCount++;
            }
        }

        console.log(`✓ Found ${pineconeFiles.size} unique files in Pinecone\n`);

        return pineconeFiles;
    }

    /**
     * PHASE 3: Filter files
     */
    filterFiles(files) {
        console.log('🔎 Phase 3: Filtering files...\n');

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
                if (filter.pattern.test(file.name)) {
                    return filter.reason;
                }
            }

            // Skip individual case studies, but keep the master "Case Study Slide Library"
            if (/case study/i.test(file.name) && !/case study slide library/i.test(file.name)) {
                return 'Individual case study (master library only)';
            }

            return null;
        };

        const indexableMimeTypes = new Set([
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.presentation',
            'application/vnd.google-apps.spreadsheet',
            'application/pdf'
        ]);

        const filtered = {
            keep: [],
            skip: []
        };

        for (const file of files) {
            // Track in folder stats
            const stats = this.folderStats.get(file.folderId);
            if (stats) stats.files.total++;

            // Skip shortcuts completely
            if (file.mimeType === 'application/vnd.google-apps.shortcut') {
                filtered.skip.push({ file, reason: 'Shortcut (ignored)' });
                if (stats) {
                    stats.files.toSkip++;
                    stats.skipReasons['Shortcut (ignored)'] = (stats.skipReasons['Shortcut (ignored)'] || 0) + 1;
                }
                continue;
            }

            // Check name filters
            const skipReason = shouldSkipFile(file);
            if (skipReason) {
                filtered.skip.push({ file, reason: skipReason });
                if (stats) {
                    stats.files.toSkip++;
                    stats.skipReasons[skipReason] = (stats.skipReasons[skipReason] || 0) + 1;
                }
                continue;
            }

            // Check mime type
            if (!indexableMimeTypes.has(file.mimeType)) {
                filtered.skip.push({ file, reason: `Unsupported type: ${file.mimeType}` });
                if (stats) {
                    stats.files.toSkip++;
                    stats.skipReasons['Unsupported mime type'] = (stats.skipReasons['Unsupported mime type'] || 0) + 1;
                }
                continue;
            }

            filtered.keep.push(file);
        }

        console.log(`✓ Files to process: ${filtered.keep.length}`);
        console.log(`✓ Files to skip: ${filtered.skip.length}\n`);

        return filtered;
    }

    /**
     * PHASE 4: Detect duplicates
     */
    detectDuplicates(files) {
        console.log('🔍 Phase 4: Detecting duplicate formats...\n');

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
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];

        // Group by normalized name
        const groups = new Map();

        for (const file of files) {
            const normalizedName = normalizeName(file.name);
            if (!groups.has(normalizedName)) {
                groups.set(normalizedName, []);
            }
            groups.get(normalizedName).push(file);
        }

        // Select winners
        const result = {
            winners: [],
            duplicates: []
        };

        for (const [name, group] of groups) {
            if (group.length === 1) {
                result.winners.push(group[0]);
            } else {
                // Sort by priority
                const sorted = group.sort((a, b) => {
                    const priorityA = mimeTypePriority.indexOf(a.mimeType);
                    const priorityB = mimeTypePriority.indexOf(b.mimeType);

                    if (priorityA === priorityB) {
                        // Same priority, prefer newer
                        return new Date(b.modifiedTime) - new Date(a.modifiedTime);
                    }

                    return priorityA - priorityB;
                });

                const winner = sorted[0];
                result.winners.push(winner);

                for (let i = 1; i < sorted.length; i++) {
                    result.duplicates.push({
                        file: sorted[i],
                        reason: `Duplicate of "${winner.name}" (${winner.mimeType})`,
                        winner: winner.id
                    });

                    // Track in folder stats
                    const stats = this.folderStats.get(sorted[i].folderId);
                    if (stats) {
                        stats.files.toSkip++;
                        stats.skipReasons['Duplicate format'] = (stats.skipReasons['Duplicate format'] || 0) + 1;
                    }
                }
            }
        }

        console.log(`✓ Unique files after deduplication: ${result.winners.length}`);
        console.log(`✓ Duplicate formats skipped: ${result.duplicates.length}\n`);

        if (result.duplicates.length > 0) {
            console.log('Duplicate Examples:');
            for (const dup of result.duplicates.slice(0, 5)) {
                console.log(`  ❌ ${dup.file.name} (${dup.file.mimeType})`);
                console.log(`     → Using: ${dup.reason}\n`);
            }
            if (result.duplicates.length > 5) {
                console.log(`  ... and ${result.duplicates.length - 5} more\n`);
            }
        }

        return result;
    }

    /**
     * PHASE 5: Classify changes
     */
    classifyChanges(driveFiles, pineconeFiles) {
        console.log('🔄 Phase 5: Classifying file changes...\n');

        const classifications = {
            NEW: [],
            MODIFIED: [],
            RENAMED: [],
            UNCHANGED: [],
            DELETED: []
        };

        // Check each Drive file
        for (const file of driveFiles) {
            const pineconeData = pineconeFiles.get(file.id);

            if (!pineconeData) {
                classifications.NEW.push({
                    file,
                    reason: 'Not found in Pinecone'
                });

                const stats = this.folderStats.get(file.folderId);
                if (stats) stats.files.toIndex++;
                continue;
            }

            // Check for changes
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

            if (signals.versionChanged || signals.hashChanged || signals.sizeChanged) {
                classifications.MODIFIED.push({
                    file,
                    reason: 'Content changed',
                    signals,
                    pineconeData
                });

                const stats = this.folderStats.get(file.folderId);
                if (stats) stats.files.toReindex++;
            } else if (signals.dateChanged && !signals.nameChanged) {
                classifications.MODIFIED.push({
                    file,
                    reason: 'Modified date changed',
                    signals,
                    pineconeData
                });

                const stats = this.folderStats.get(file.folderId);
                if (stats) stats.files.toReindex++;
            } else if (signals.nameChanged) {
                classifications.RENAMED.push({
                    file,
                    reason: 'Name changed, content same',
                    signals,
                    pineconeData
                });

                const stats = this.folderStats.get(file.folderId);
                if (stats) stats.files.toReindex++;
            } else {
                classifications.UNCHANGED.push({
                    file,
                    reason: 'No changes detected',
                    pineconeData
                });

                const stats = this.folderStats.get(file.folderId);
                if (stats) stats.files.toSkip++;
                if (stats) stats.skipReasons['Already up-to-date'] = (stats.skipReasons['Already up-to-date'] || 0) + 1;
            }
        }

        // Find deleted files (in Pinecone but not in Drive)
        const driveFileIds = new Set(driveFiles.map(f => f.id));
        for (const [fileId, metadata] of pineconeFiles) {
            if (!driveFileIds.has(fileId)) {
                classifications.DELETED.push({
                    fileId,
                    name: metadata['File.name'],
                    vectorCount: metadata.vectorCount
                });
            }
        }

        console.log('Classification Summary:');
        console.log(`  📄 NEW files (will index): ${classifications.NEW.length}`);
        console.log(`  🔄 MODIFIED files (will re-index): ${classifications.MODIFIED.length}`);
        console.log(`  ✏️  RENAMED files (will update metadata): ${classifications.RENAMED.length}`);
        console.log(`  ✓ UNCHANGED files (will skip): ${classifications.UNCHANGED.length}`);
        console.log(`  🗑️  DELETED files (will remove vectors): ${classifications.DELETED.length}\n`);

        return classifications;
    }

    /**
     * Generate detailed report
     */
    generateReport(classifications, skippedFiles, duplicates) {
        console.log('\n' + '='.repeat(80));
        console.log('                         DRY RUN REPORT');
        console.log('='.repeat(80) + '\n');

        // Overall summary
        console.log('📊 OVERALL SUMMARY\n');
        console.log(`  Files in Google Drive: ${Array.from(this.folderStats.values()).reduce((sum, s) => sum + s.files.total, 0)}`);
        console.log(`  Files in Pinecone: ${classifications.UNCHANGED.length + classifications.MODIFIED.length + classifications.RENAMED.length + classifications.DELETED.length}`);
        console.log();
        console.log(`  Will INDEX (new): ${classifications.NEW.length}`);
        console.log(`  Will RE-INDEX (modified): ${classifications.MODIFIED.length}`);
        console.log(`  Will UPDATE (renamed): ${classifications.RENAMED.length}`);
        console.log(`  Will DELETE (removed from Drive): ${classifications.DELETED.length}`);
        console.log(`  Will SKIP (unchanged): ${classifications.UNCHANGED.length}`);
        console.log(`  Will SKIP (filtered): ${skippedFiles.length}`);
        console.log(`  Will SKIP (duplicates): ${duplicates.length}`);
        console.log();

        // By folder
        console.log('📁 BY FOLDER\n');
        const sortedFolders = Array.from(this.folderStats.entries())
            .sort((a, b) => a[1].path.localeCompare(b[1].path))
            .filter(([id, stats]) => stats.files.total > 0);

        for (const [folderId, stats] of sortedFolders) {
            console.log(`  ${stats.path}:`);
            console.log(`    Total files: ${stats.files.total}`);
            console.log(`    Will index: ${stats.files.toIndex}`);
            console.log(`    Will re-index: ${stats.files.toReindex}`);
            console.log(`    Will skip: ${stats.files.toSkip}`);

            if (Object.keys(stats.skipReasons).length > 0) {
                console.log(`    Skip reasons:`);
                for (const [reason, count] of Object.entries(stats.skipReasons)) {
                    console.log(`      - ${reason}: ${count}`);
                }
            }
            console.log();
        }

        // New files details
        if (classifications.NEW.length > 0) {
            console.log('📄 NEW FILES TO INDEX\n');
            for (const { file, reason } of classifications.NEW.slice(0, 10)) {
                console.log(`  ✓ ${file.name}`);
                console.log(`    Type: ${file.mimeType}`);
                console.log(`    Folder: ${file.path}`);
                console.log();
            }
            if (classifications.NEW.length > 10) {
                console.log(`  ... and ${classifications.NEW.length - 10} more\n`);
            }
        }

        // Modified files details
        if (classifications.MODIFIED.length > 0) {
            console.log('🔄 MODIFIED FILES TO RE-INDEX\n');
            for (const { file, reason, signals } of classifications.MODIFIED.slice(0, 10)) {
                console.log(`  ✓ ${file.name}`);
                console.log(`    Reason: ${reason}`);
                console.log(`    Folder: ${file.path}`);
                const changedSignals = Object.entries(signals).filter(([k, v]) => v).map(([k]) => k);
                if (changedSignals.length > 0) {
                    console.log(`    Changes: ${changedSignals.join(', ')}`);
                }
                console.log();
            }
            if (classifications.MODIFIED.length > 10) {
                console.log(`  ... and ${classifications.MODIFIED.length - 10} more\n`);
            }
        }

        // Deleted files
        if (classifications.DELETED.length > 0) {
            console.log('🗑️  DELETED FILES (WILL REMOVE VECTORS)\n');
            for (const { name, vectorCount } of classifications.DELETED) {
                console.log(`  ✗ ${name}`);
                console.log(`    Vectors to delete: ${vectorCount}`);
                console.log();
            }
        }

        // Skip summary
        console.log('⏭️  SKIPPED FILES BREAKDOWN\n');
        const skipReasonTotals = {};
        for (const stats of this.folderStats.values()) {
            for (const [reason, count] of Object.entries(stats.skipReasons)) {
                skipReasonTotals[reason] = (skipReasonTotals[reason] || 0) + count;
            }
        }
        for (const [reason, count] of Object.entries(skipReasonTotals)) {
            console.log(`  ${reason}: ${count}`);
        }
        console.log();

        console.log('='.repeat(80));
        console.log('This was a DRY RUN - no changes were made to Pinecone');
        console.log('Run with --execute flag to apply these changes');
        console.log('='.repeat(80) + '\n');
    }

    /**
     * Main execution
     */
    async run() {
        const startTime = Date.now();

        try {
            const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
            if (!rootFolderId) {
                throw new Error('GOOGLE_DRIVE_FOLDER_ID not set in .env');
            }

            // Phase 1: Scan Drive
            const { files } = await this.scanGoogleDrive(rootFolderId);

            // Phase 2: Load Pinecone
            const pineconeFiles = await this.loadPineconeState();

            // Phase 3: Filter
            const { keep: filteredFiles, skip: skippedFiles } = this.filterFiles(files);

            // Phase 4: Detect duplicates
            const { winners, duplicates } = this.detectDuplicates(filteredFiles);

            // Phase 5: Classify changes
            const classifications = this.classifyChanges(winners, pineconeFiles);

            // Generate report
            this.generateReport(classifications, skippedFiles, duplicates);

            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`⏱️  Total time: ${duration}s\n`);

        } catch (error) {
            console.error('\n❌ Error:', error.message);
            console.error(error.stack);
            process.exit(1);
        }
    }
}

// Run
const dryRun = new SyncDryRun();
dryRun.run();
