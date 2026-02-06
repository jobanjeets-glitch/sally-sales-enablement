# Sally - Sales Enablement Agent

Sally is an AI-powered sales enablement assistant that provides accurate, citation-backed answers from your sales documentation using Retrieval-Augmented Generation (RAG).

## Features

- **Strict RAG**: Only answers from indexed documents - no hallucinations
- **Citation-backed**: Every answer includes document sources and page numbers
- **Google Drive Integration**: Auto-indexes documents from specified Google Drive folders
- **Pinecone Vector Database**: Fast semantic search across all your sales docs
- **Slack Integration**: Natural conversation interface for sales teams
- **Smart Chunking**: Intelligently splits documents while preserving context

## Architecture

```
sally-sales-enablement/
├── indexer/           # Google Drive scanning and document processing
│   ├── google-drive.js    # Drive API integration
│   └── chunker.js         # Smart document chunking
├── query/             # RAG query engine with Pinecone
├── slack-bot/         # Slack bot server
├── scripts/           # Indexing and testing scripts
├── feedback/          # User feedback collection
└── scheduler/         # Periodic re-indexing
```

## Tech Stack

- **Vector Database**: Pinecone
- **LLM**: OpenAI GPT-4
- **Embeddings**: OpenAI text-embedding-3-small
- **Messaging**: Slack Bolt
- **Storage**: Google Drive
- **Runtime**: Node.js 18+

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.template .env
   # Edit .env with your credentials
   ```

3. **Set up Google Drive credentials**
   - Create a service account in Google Cloud Console
   - Download credentials JSON
   - Share your Drive folder with the service account email

4. **Create Pinecone index**
   - Create index with 1536 dimensions (OpenAI embedding size)
   - Use cosine similarity

5. **Index your documents**
   ```bash
   npm run index
   ```

6. **Start the Slack bot**
   ```bash
   npm start
   ```

## Usage

In Slack, mention Sally:
```
@Sally What is our pricing model for enterprise customers?
@Sally How do we handle objections about security?
@Sally What are the key differentiators vs competitors?
```

Sally will respond with:
- Direct answer from documentation
- Source citations (document name, page/section)
- "I don't know" if information isn't in indexed docs

## Scripts

- `npm start` - Start Slack bot server
- `npm run index` - Run initial indexing of Google Drive folder
- `npm run test-query` - Test query engine with sample questions

## Project Goals

Compare Sally's strict RAG approach with existing n8n workflow to evaluate:
- Answer accuracy
- Citation quality
- Response speed
- Hallucination prevention
- User satisfaction

## License

Internal use only - CommerceIQ
