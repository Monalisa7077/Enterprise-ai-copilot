import { createHash } from 'node:crypto';
import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';
import env from '../config/env.js';
import type { DocumentChunk } from './documentChunkingService.js';
import {
  getEmbeddingDimensions,
  type EmbeddingProviderName,
} from './embeddingProvider.js';

export interface VectorStoreConfig {
  url: string;
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
}

export interface DocumentVectorScope {
  documentId: string;
  workspaceId: string;
  ownerId: string;
}

export interface VectorSearchScope {
  workspaceId: string;
  ownerId: string;
}

export interface VectorSearchResult {
  text: string;
  documentId: string;
  chunkIndex: number;
  pageNumbers?: number[];
  score: number;
}

export type VectorStoreErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'UNSUPPORTED_MODEL'
  | 'CONNECTION_FAILED'
  | 'COLLECTION_SETUP_FAILED'
  | 'COLLECTION_INCOMPATIBLE'
  | 'COLLECTION_NOT_READY'
  | 'INVALID_VECTOR'
  | 'INVALID_METADATA'
  | 'INVALID_TOP_K'
  | 'UPSERT_FAILED'
  | 'SEARCH_FAILED'
  | 'DELETE_FAILED';

const vectorStoreErrorMessages: Record<VectorStoreErrorCode, string> = {
  INVALID_CONFIGURATION: 'Vector store configuration is invalid',
  UNSUPPORTED_MODEL: 'Vector dimensions are not verified for this embedding model',
  CONNECTION_FAILED: 'Could not connect to the vector database',
  COLLECTION_SETUP_FAILED: 'Could not set up the vector collection',
  COLLECTION_INCOMPATIBLE: 'Existing vector collection has incompatible configuration',
  COLLECTION_NOT_READY: 'Vector collection is not ready for writes',
  INVALID_VECTOR: 'Vector data does not match the configured collection dimensions',
  INVALID_METADATA: 'Chunk metadata is invalid',
  INVALID_TOP_K: 'Search result limit is invalid',
  UPSERT_FAILED: 'Could not store document vectors',
  SEARCH_FAILED: 'Could not search document vectors',
  DELETE_FAILED: 'Could not delete document vectors',
};

const defaultSearchTopK = 5;
const maximumSearchTopK = 100;

export class VectorStoreError extends Error {
  constructor(readonly code: VectorStoreErrorCode) {
    super(vectorStoreErrorMessages[code]);
    this.name = 'VectorStoreError';
  }
}

export interface QdrantVectorClient {
  getCollections(): Promise<Schemas['CollectionsResponse']>;
  getCollection(collectionName: string): Promise<Schemas['CollectionInfo']>;
  createCollection(
    collectionName: string,
    config: { vectors: { size: number; distance: 'Cosine' } },
  ): Promise<boolean>;
  upsert(
    collectionName: string,
    operation: { wait: boolean; points: Schemas['PointStruct'][] },
  ): Promise<Schemas['UpdateResult']>;
  delete(
    collectionName: string,
    operation: {
      wait: boolean;
      filter: Schemas['Filter'];
    },
  ): Promise<Schemas['UpdateResult']>;
  search(
    collectionName: string,
    operation: {
      vector: number[];
      limit: number;
      filter: Schemas['Filter'];
      with_payload: boolean;
    },
  ): Promise<Schemas['ScoredPoint'][]>;
}

function collectionNameFor(config: VectorStoreConfig): string {
  const modelSlug = config.model
    .replace(/^models\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `knowledge_chunks_${config.provider}_${modelSlug}_${config.dimensions}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readVectorConfiguration(collection: Schemas['CollectionInfo']): {
  size: number;
  distance: string;
} | undefined {
  if (!isRecord(collection.config) || !isRecord(collection.config.params)) {
    return undefined;
  }

  const vectors = collection.config.params.vectors;
  if (!isRecord(vectors) || typeof vectors.size !== 'number' || typeof vectors.distance !== 'string') {
    return undefined;
  }

  return { size: vectors.size, distance: vectors.distance };
}

function validateScope(scope: DocumentVectorScope): void {
  if (
    !scope ||
    typeof scope.documentId !== 'string' ||
    !scope.documentId.trim() ||
    typeof scope.workspaceId !== 'string' ||
    !scope.workspaceId.trim() ||
    typeof scope.ownerId !== 'string' ||
    !scope.ownerId.trim()
  ) {
    throw new VectorStoreError('INVALID_METADATA');
  }
}

function validateSearchScope(scope: VectorSearchScope): void {
  if (
    !scope ||
    typeof scope.workspaceId !== 'string' ||
    !scope.workspaceId.trim() ||
    typeof scope.ownerId !== 'string' ||
    !scope.ownerId.trim()
  ) {
    throw new VectorStoreError('INVALID_METADATA');
  }
}

function searchResultFromPoint(point: Schemas['ScoredPoint']): VectorSearchResult {
  const payload = point.payload;
  if (
    !isRecord(payload) ||
    typeof payload.text !== 'string' ||
    !payload.text.trim() ||
    typeof payload.documentId !== 'string' ||
    !payload.documentId.trim() ||
    !Number.isInteger(payload.chunkIndex) ||
    (payload.chunkIndex as number) < 0 ||
    !Number.isFinite(point.score) ||
    (payload.pageNumbers !== undefined &&
      (!Array.isArray(payload.pageNumbers) ||
        payload.pageNumbers.some((pageNumber) => !Number.isInteger(pageNumber) || pageNumber < 1)))
  ) {
    throw new VectorStoreError('INVALID_METADATA');
  }

  return {
    text: payload.text,
    documentId: payload.documentId,
    chunkIndex: payload.chunkIndex as number,
    ...(payload.pageNumbers === undefined ? {} : { pageNumbers: payload.pageNumbers as number[] }),
    score: point.score,
  };
}

function pointId(documentId: string, chunkIndex: number): string {
  const hash = createHash('sha256')
    .update(`${documentId}\0${chunkIndex}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createConfiguredVectorStore(
  configuration: typeof env = env,
  client?: QdrantVectorClient,
): QdrantVectorStore {
  let dimensions: number;
  try {
    dimensions = getEmbeddingDimensions(configuration.EMBEDDING_PROVIDER, configuration.EMBEDDING_MODEL);
  } catch {
    throw new VectorStoreError('UNSUPPORTED_MODEL');
  }

  const config: VectorStoreConfig = {
    url: configuration.QDRANT_URL,
    provider: configuration.EMBEDDING_PROVIDER,
    model: configuration.EMBEDDING_MODEL,
    dimensions,
  };

  return new QdrantVectorStore(
    client ?? new QdrantClient({ url: config.url }),
    config,
  );
}

export class QdrantVectorStore {
  readonly collectionName: string;
  readonly config: VectorStoreConfig;

  constructor(
    private readonly client: QdrantVectorClient,
    config: VectorStoreConfig,
  ) {
    let verifiedDimensions: number;
    try {
      verifiedDimensions = getEmbeddingDimensions(config.provider, config.model);
    } catch {
      throw new VectorStoreError('UNSUPPORTED_MODEL');
    }

    let parsedUrl: URL | undefined;
    try {
      parsedUrl = new URL(config.url);
    } catch {
      throw new VectorStoreError('INVALID_CONFIGURATION');
    }

    if (
      !['http:', 'https:'].includes(parsedUrl.protocol) ||
      !Number.isInteger(config.dimensions) ||
      config.dimensions <= 0 ||
      config.dimensions !== verifiedDimensions
    ) {
      throw new VectorStoreError('INVALID_CONFIGURATION');
    }

    this.config = { ...config };
    this.collectionName = collectionNameFor(config);
  }

  async ensureCollection(): Promise<void> {
    let collections: Schemas['CollectionsResponse'];
    try {
      collections = await this.client.getCollections();
    } catch {
      throw new VectorStoreError('CONNECTION_FAILED');
    }

    const exists = collections.collections.some((collection) => collection.name === this.collectionName);
    if (!exists) {
      try {
        const created = await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.config.dimensions,
            distance: 'Cosine',
          },
        });
        if (!created) {
          throw new VectorStoreError('COLLECTION_SETUP_FAILED');
        }
      } catch (error) {
        if (error instanceof VectorStoreError) {
          throw error;
        }

        // Another API instance may have created this collection concurrently.
        try {
          const latestCollections = await this.client.getCollections();
          if (!latestCollections.collections.some((collection) => collection.name === this.collectionName)) {
            throw new VectorStoreError('COLLECTION_SETUP_FAILED');
          }
        } catch {
          throw new VectorStoreError('COLLECTION_SETUP_FAILED');
        }
      }
    }

    let collection: Schemas['CollectionInfo'];
    try {
      collection = await this.client.getCollection(this.collectionName);
    } catch {
      throw new VectorStoreError('CONNECTION_FAILED');
    }

    const vectorConfig = readVectorConfiguration(collection);
    if (
      !vectorConfig ||
      vectorConfig.size !== this.config.dimensions ||
      vectorConfig.distance !== 'Cosine'
    ) {
      throw new VectorStoreError('COLLECTION_INCOMPATIBLE');
    }
  }

  async upsertChunks(chunks: readonly DocumentChunk[], vectors: readonly number[][]): Promise<void> {
    if (chunks.length !== vectors.length) {
      throw new VectorStoreError('INVALID_VECTOR');
    }
    if (chunks.length === 0) {
      return;
    }

    const points: Schemas['PointStruct'][] = chunks.map((chunk, index) => {
      validateScope({
        documentId: chunk.documentId,
        workspaceId: chunk.workspaceId,
        ownerId: chunk.ownerId,
      });

      if (
        !Number.isInteger(chunk.chunkIndex) ||
        chunk.chunkIndex < 0 ||
        typeof chunk.text !== 'string' ||
        !chunk.text.trim() ||
        (chunk.pageNumbers !== undefined &&
          (!Array.isArray(chunk.pageNumbers) ||
            chunk.pageNumbers.some((pageNumber) => !Number.isInteger(pageNumber) || pageNumber < 1)))
      ) {
        throw new VectorStoreError('INVALID_METADATA');
      }

      const vector = vectors[index];
      if (
        !Array.isArray(vector) ||
        vector.length !== this.config.dimensions ||
        vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throw new VectorStoreError('INVALID_VECTOR');
      }

      return {
        id: pointId(chunk.documentId, chunk.chunkIndex),
        vector,
        payload: {
          documentId: chunk.documentId,
          workspaceId: chunk.workspaceId,
          ownerId: chunk.ownerId,
          chunkIndex: chunk.chunkIndex,
          ...(chunk.pageNumbers ? { pageNumbers: chunk.pageNumbers } : {}),
          text: chunk.text,
          embeddingProvider: this.config.provider,
          embeddingModel: this.config.model,
          vectorDimensions: this.config.dimensions,
        },
      };
    });

    await this.ensureCollection();
    try {
      await this.client.upsert(this.collectionName, { wait: true, points });
    } catch {
      throw new VectorStoreError('UPSERT_FAILED');
    }
  }

  async searchChunks(
    queryVector: readonly number[],
    scope: VectorSearchScope,
    topK = defaultSearchTopK,
  ): Promise<VectorSearchResult[]> {
    validateSearchScope(scope);
    if (
      !Number.isInteger(topK) ||
      topK < 1 ||
      topK > maximumSearchTopK
    ) {
      throw new VectorStoreError('INVALID_TOP_K');
    }
    if (
      !Array.isArray(queryVector) ||
      queryVector.length !== this.config.dimensions ||
      queryVector.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    ) {
      throw new VectorStoreError('INVALID_VECTOR');
    }

    await this.ensureCollection();
    let points: Schemas['ScoredPoint'][];
    try {
      points = await this.client.search(this.collectionName, {
        vector: [...queryVector],
        limit: topK,
        filter: {
          must: [
            { key: 'ownerId', match: { value: scope.ownerId } },
            { key: 'workspaceId', match: { value: scope.workspaceId } },
          ],
        },
        with_payload: true,
      });
    } catch {
      throw new VectorStoreError('SEARCH_FAILED');
    }

    return points.map(searchResultFromPoint);
  }

  async deleteDocumentPoints(scope: DocumentVectorScope): Promise<void> {
    await this.deleteMatchingDocumentPoints(scope, []);
  }

  async deleteDocumentChunksFrom(scope: DocumentVectorScope, firstChunkIndex: number): Promise<void> {
    if (!Number.isInteger(firstChunkIndex) || firstChunkIndex < 0) {
      throw new VectorStoreError('INVALID_METADATA');
    }

    await this.deleteMatchingDocumentPoints(scope, [
      { key: 'chunkIndex', range: { gte: firstChunkIndex } },
    ]);
  }

  private async deleteMatchingDocumentPoints(
    scope: DocumentVectorScope,
    extraConditions: Schemas['Condition'][],
  ): Promise<void> {
    validateScope(scope);
    await this.ensureCollection();

    try {
      await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: [
            { key: 'documentId', match: { value: scope.documentId } },
            { key: 'workspaceId', match: { value: scope.workspaceId } },
            { key: 'ownerId', match: { value: scope.ownerId } },
            ...extraConditions,
          ],
        },
      });
    } catch {
      throw new VectorStoreError('DELETE_FAILED');
    }
  }
}
