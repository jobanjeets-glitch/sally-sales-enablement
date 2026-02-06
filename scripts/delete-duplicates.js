#!/usr/bin/env node

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX_NAME);

// Search for Content Agent Training Deck
const results = await index.query({
  vector: new Array(3072).fill(0),
  topK: 100,
  includeMetadata: true,
  filter: { 'File.name': { $eq: 'Content Agent Training Deck' } }
});

console.log('Total Content Agent Training Deck vectors found:', results.matches.length);

// Find vectors without File.id (n8n versions)
const toDelete = [];
const toKeep = [];

for (const match of results.matches) {
  if (!match.metadata['File.id']) {
    toDelete.push(match.id);
  } else {
    toKeep.push(match.id);
  }
}

console.log(`\nVectors to keep (with File.id): ${toKeep.length}`);
console.log(`Vectors to delete (no File.id): ${toDelete.length}`);

if (toDelete.length > 0) {
  console.log('\nDeleting old n8n versions...');
  await index.deleteMany(toDelete);
  console.log('✅ Deleted', toDelete.length, 'duplicate vectors');
} else {
  console.log('\nNo duplicates to delete.');
}
