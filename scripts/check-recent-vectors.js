#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX_NAME);

// Get total stats first
const stats = await index.describeIndexStats();
console.log('Total vectors:', stats.namespaces.default?.vectorCount || 0);
console.log();

// Search for Content Agent Training Deck
const results = await index.query({
  vector: new Array(3072).fill(0),
  topK: 100,
  includeMetadata: true,
  filter: { 'File.name': { $eq: 'Content Agent Training Deck' } }
});

console.log('Content Agent Training Deck vectors found:', results.matches.length);

if (results.matches.length > 0) {
  console.log('\nVector details:');
  const grouped = {};

  for (const match of results.matches) {
    const id = match.id;
    const modDate = match.metadata['File.modifiedDate'];
    const fileId = match.metadata['File.id'];
    const key = `${modDate}_${fileId}`;

    if (!grouped[key]) {
      grouped[key] = {
        modifiedDate: modDate,
        fileId: fileId,
        ids: []
      };
    }
    grouped[key].ids.push(id);
  }

  console.log('\nGrouped by modified date and file ID:');
  for (const [key, data] of Object.entries(grouped)) {
    console.log(`\n${data.modifiedDate} (File ID: ${data.fileId}): ${data.ids.length} vectors`);
    console.log('Sample IDs:', data.ids.slice(0, 2).join(', '));
  }

  // Check if there are duplicates (multiple groups)
  if (Object.keys(grouped).length > 1) {
    console.log('\n⚠️  WARNING: Multiple versions found! You may want to delete old versions.');
  }
}
