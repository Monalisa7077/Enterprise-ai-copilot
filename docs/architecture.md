# Enterprise Knowledge Copilot architecture

## Assumptions and defaults

- Users belong to a multi-tenant system with workspaces and shared knowledge bases.
- Authentication uses access and refresh JWTs protected by environment secrets.
- MongoDB stores operational metadata and project records.
- Qdrant stores vector embeddings and metadata required for retrieval.
- Retrieval is grounded and answer generation is intentionally citation-aware.
- The app is designed for junior MERN + AI learners and keeps abstractions simple and readable.

## Threat model

- Secrets are sourced from environment variables only.
- Passwords are stored using bcrypt hashing.
- JWT refresh tokens are rotated and revoked on logout.
- Retrieved document text is treated as untrusted input and is never allowed to act as system instructions.
- File validation prevents unsupported upload types and oversized input.
- Role checks are enforced before document, workspace, and admin operations.

## Data flow

1. User registers or logs in.
2. The API issues access and refresh tokens.
3. A workspace owner uploads a file.
4. The backend stores metadata and queues ingestion.
5. Text extraction, chunking, and embedding generation happen in the ingestion pipeline.
6. Chunks are stored in Qdrant with metadata references.
7. The chat flow retrieves authorized chunks for a workspace.
8. The LLM is prompted with grounded context and source citations.
9. The UI renders streamed responses and evidence cards.

## Text chunking

The ingestion chunker reads `CHUNK_SIZE` and `CHUNK_OVERLAP` from the validated
API configuration. Both settings are measured in JavaScript string
UTF-16 code units (`string.length`), not tokens. Actual token counts vary by
language and embedding model, so these character limits must not be interpreted
as token limits.

Chunk boundaries prefer paragraph breaks, then sentence endings, then
whitespace, with a hard size boundary as a fallback. Overlap carries preceding
text into the next chunk; where a boundary falls inside a word, the chunker
aligns to the preceding word boundary when possible. For page-aware PDF
extraction, chunks are created within individual pages and carry that source
page number. DOCX and TXT chunks have no page numbers unless the extractor
provides them.

## Embedding providers

The API supports OpenAI and Gemini through a shared embedding-provider
interface. `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, and the corresponding
`OPENAI_API_KEY` or `GEMINI_API_KEY` select the provider. The defaults are
OpenAI `text-embedding-3-small` (1536 dimensions) and Gemini
`gemini-embedding-2` (3072 dimensions). OpenAI is sent a batch `input` array
with `encoding_format: "float"` and uses bearer authentication. Gemini uses
`batchEmbedContents`, with one `EmbedContentRequest` per text and the
`x-goog-api-key` header. Each provider's response format is parsed separately.

The service checks that vectors are finite, non-empty, consistently sized, and
the default model's documented default dimension. Custom models are checked
for consistent dimensions but must be verified against their model's published
dimension before storage. Before Qdrant integration, record the provider, model,
and dimension as collection configuration. Do not mix OpenAI and Gemini vectors
in one collection: equal vector dimensions alone do not make their vector
spaces compatible. Changing provider/model requires a migration and re-embedding
strategy. Gemini's embedding guide recommends task-aware input formatting for
retrieval; document and query formatting must be designed consistently when
retrieval is implemented.

## Background ingestion worker

The API enqueue service and the separately started BullMQ worker share the
`document-ingestion` Redis queue. Job data contains only a MongoDB document ID;
the worker loads the trusted document record and uses its stored `storageKey`,
owner, and workspace references. It verifies the workspace owner before reading
the file under `UPLOAD_DIR`.

The worker moves a valid document through `PROCESSING` and then `COMPLETED`,
recording processing timestamps. Failures are stored with a constrained failure
code and a sanitized message. Permanent errors (such as invalid document data,
unsupported content, invalid vectors, and incompatible collection settings)
are not retried. Network, rate-limit, database-connectivity, and vector-write
failures are retried up to four attempts with exponential backoff starting at
one second and jitter.

Reprocessing uses deterministic point IDs so an upsert replaces matching chunk
points. After a successful upsert, points at chunk indices beyond the new
chunk count are deleted using document, workspace, and owner filters. This
keeps a shorter replacement run from leaving old vectors behind.

Redis is configured through `REDIS_URL` (the existing Compose default is
`redis://localhost:6379`). BullMQ uses a parsed Redis connection with
`maxRetriesPerRequest: null`, as required for worker operation. Start the
standalone worker with `npm run dev:worker --workspace apps/api` in development
or `npm run worker --workspace apps/api` after building. The worker requires
MongoDB, Redis, Qdrant, `UPLOAD_DIR`, and the selected provider's API key.

## Qdrant vector collection

The vector-store service builds its client from `QDRANT_URL`. It only creates
collections for model/dimension pairs with explicitly verified dimensions:
OpenAI `text-embedding-3-small` uses 1536, and Gemini `gemini-embedding-2`
uses 3072. An unrecognized model is rejected rather than assigned a guessed
size. Collection names include provider, normalized model name, and dimension
(for example, `knowledge_chunks_openai_text_embedding_3_small_1536`) so that
the two embedding spaces cannot silently share a collection.

Collections use one unnamed dense vector with the verified size and cosine
distance. Before writing, the service checks the existing collection's vector
size and distance; mismatched collections fail rather than being recreated.
Point IDs are deterministic UUIDs derived from document ID and chunk index, so
reprocessing the same document replaces the corresponding points instead of
duplicating them.

Each point payload contains `documentId`, `workspaceId`, `ownerId`,
`chunkIndex`, `text`, `embeddingProvider`, `embeddingModel`, and
`vectorDimensions`; `pageNumbers` is present only when extraction supplied page
provenance. Document-point deletion requires all three document/workspace/owner
identifiers and applies all of them as Qdrant filter conditions.

## Core schemas

### User

- name: string
- email: string
- passwordHash: string
- role: ADMIN | USER
- timestamps

### RefreshToken

- userId: ObjectId
- tokenHash: string
- expiresAt: Date
- revoked: boolean
- family: string

### Workspace

- name: string
- ownerId: ObjectId
- members: ObjectId[]
- createdAt: Date

### Document

- workspaceId: ObjectId
- ownerId: ObjectId
- filename: string
- originalName: string
- mimeType: string
- checksum: string
- status: PENDING | PROCESSING | COMPLETED | FAILED
- storagePath: string
- createdAt: Date

### ChatSession

- workspaceId: ObjectId
- userId: ObjectId
- title: string
- createdAt: Date

### Message

- sessionId: ObjectId
- role: user | assistant
- content: string
- references: object[]
- latencyMs: number
- model: string
- createdAt: Date

### Feedback

- userId: ObjectId
- sessionId: ObjectId
- rating: 1 | -1
- comment: string
- createdAt: Date

## API surface

- /api/v1/auth
- /api/v1/users
- /api/v1/workspaces
- /api/v1/documents
- /api/v1/chats
- /api/v1/search
- /api/v1/feedback
- /api/v1/admin
- /health and /ready

## Learning map

- Auth and credential security
- Document ingestion and metadata design
- Embedding and vector storage
- Retrieval quality and citations
- Prompt grounding and injection defense
- Frontend experience and analytics
