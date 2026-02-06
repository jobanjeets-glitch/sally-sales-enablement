import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import fs from 'fs';

export class DocumentChunker {
    constructor(chunkSize = 1000, overlap = 200) {
        this.chunkSize = chunkSize;
        this.overlap = overlap;
    }

    async extractText(filePath, mimeType) {
        const fileBuffer = fs.readFileSync(filePath);
        
        if (mimeType === 'application/pdf') {
            const data = await pdf(fileBuffer);
            return { text: data.text, pages: data.numpages };
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({ buffer: fileBuffer });
            return { text: result.value, pages: Math.ceil(result.value.length / 3000) };
        } else if (mimeType === 'text/plain') {
            const text = fs.readFileSync(filePath, 'utf8');
            return { text, pages: Math.ceil(text.length / 3000) };
        }
        
        return { text: '', pages: 0 };
    }

    chunkText(text, fileMetadata) {
        const chunks = [];
        const words = text.split(/\s+/);
        
        let currentChunk = [];
        let currentLength = 0;
        let chunkIndex = 0;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const wordLength = word.length;

            if (currentLength + wordLength > this.chunkSize && currentChunk.length > 0) {
                // Save current chunk
                const chunkText = currentChunk.join(' ');
                chunks.push({
                    text: chunkText,
                    metadata: {
                        ...fileMetadata,
                        chunk_index: chunkIndex,
                        char_start: i - currentChunk.length,
                        char_end: i
                    }
                });

                // Create next chunk with overlap
                const overlapWords = Math.floor(this.overlap / 5); // Rough estimate: 5 chars per word
                currentChunk = currentChunk.slice(-overlapWords);
                currentLength = currentChunk.join(' ').length;
                chunkIndex++;
            }

            currentChunk.push(word);
            currentLength += wordLength + 1; // +1 for space
        }

        // Add final chunk
        if (currentChunk.length > 0) {
            chunks.push({
                text: currentChunk.join(' '),
                metadata: {
                    ...fileMetadata,
                    chunk_index: chunkIndex,
                    char_start: words.length - currentChunk.length,
                    char_end: words.length
                }
            });
        }

        return chunks;
    }

    async processDocument(filePath, fileMetadata) {
        try {
            const { text, pages } = await this.extractText(filePath, fileMetadata.mimeType);
            
            if (!text || text.length === 0) {
                console.log(`⚠️  No text extracted from ${fileMetadata.name}`);
                return [];
            }

            const chunks = this.chunkText(text, {
                ...fileMetadata,
                total_pages: pages
            });

            console.log(`✅ Processed ${fileMetadata.name}: ${chunks.length} chunks`);
            return chunks;
        } catch (error) {
            console.error(`❌ Error processing ${fileMetadata.name}:`, error.message);
            return [];
        }
    }
}
