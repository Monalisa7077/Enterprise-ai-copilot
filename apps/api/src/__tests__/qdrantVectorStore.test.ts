import type { Schemas } from '@qdrant/js-client-rest';
import { describe, expect, it, vi } from 'vitest';
import { envSchema } from '../config/env.js';
import type { DocumentChunk } from '../services/documentChunkingService.js';
import { createConfiguredVectorStore, QdrantVectorStore, type QdrantVectorClient } from '../services/qdrantVectorStore.js';
import { VectorStoreError } from '../services/qdrantVectorStore.js';

const openAiConfig = {
  url: 'http://localhost:6333',
  provider: 'openai' as const,
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

function collectionInfo(size: number, distance = 'Cosine'): Schemas['CollectionInfo'] {
  return {
    config: {
      params: {
        vectors: { size, distance },
      },
    },
  } as Schemas['CollectionInfo'];
}

function makeClient(options: {
  collectionExists?: boolean;
  existingSize?: number;
  existingDistance?: string;
} = {}) {
  let exists = options.collectionExists ?? false;
  const createCollection = vi.fn(
    async (_collectionName: string, _config: { vectors: { size: number; distance: 'Cosine' } }) => {
      exists = true;
      return true;
    },
  );
  const getCollections = vi.fn(async () => ({
    collections: exists ? [{ name: 'knowledge_chunks_openai_text_embedding_3_small_1536' }] : [],
  }));
  const getCollection = vi.fn(async (_collectionName: string) =>
    collectionInfo(options.existingSize ?? 1536, options.existingDistance ?? 'Cosine'),
  );
  const upsert = vi.fn(
    async (
      _collectionName: string,
      _operation: { wait: boolean; points: Schemas['PointStruct'][] },
    ) => ({ status: 'completed' as const }),
  );
  const deletePoints = vi.fn(
    async (
      _collectionName: string,
      _operation: { wait: boolean; filter: Schemas['Filter'] },
    ) => ({ status: 'completed' as const }),
  );
  const client = {
    getCollections,
    getCollection,
    createCollection,
    upsert,
    delete: deletePoints,
  };

  return { client: client as unknown as QdrantVectorClient, mocks: client };
}

function makeChunks(): DocumentChunk[] {
  return [
    {
      documentId: 'doc-123',
      workspaceId: 'workspace-456',
      ownerId: 'owner-789',
      chunkIndex: 0,
      text: 'First chunk text.',
      pageNumbers: [1],
    },
    {
      documentId: 'doc-123',
      workspaceId: 'workspace-456',
      ownerId: 'owner-789',
      chunkIndex: 1,
      text: 'Second chunk text.',
    },
  ];
}

const validVectors = [
  Array.from({ length: 1536 }, () => 0.1),
  Array.from({ length: 1536 }, () => 0.2),
];

describe('Qdrant vector store', () => {
  it('creates a provider/model-specific cosine collection with the verified dimension', async () => {
    const { client, mocks } = makeClient();
    const store = new QdrantVectorStore(client, openAiConfig);

    await store.ensureCollection();

    expect(store.collectionName).toBe('knowledge_chunks_openai_text_embedding_3_small_1536');
    expect(mocks.createCollection).toHaveBeenCalledWith(store.collectionName, {
      vectors: { size: 1536, distance: 'Cosine' },
    });
    expect(mocks.getCollection).toHaveBeenCalledWith(store.collectionName);
  });

  it('does not recreate a compatible collection when setup is repeated', async () => {
    const { client, mocks } = makeClient({ collectionExists: true });
    const store = new QdrantVectorStore(client, openAiConfig);

    await store.ensureCollection();
    await store.ensureCollection();

    expect(mocks.createCollection).not.toHaveBeenCalled();
  });

  it('rejects unverified models and dimensions instead of guessing', () => {
    const { client } = makeClient();

    expect(
      () =>
        new QdrantVectorStore(client, {
          ...openAiConfig,
          model: 'custom-model',
        }),
    ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_MODEL' }));

    expect(
      () =>
        new QdrantVectorStore(client, {
          ...openAiConfig,
          dimensions: 3072,
        }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }));
  });

  it('checks an existing collection and rejects incompatible size or distance', async () => {
    for (const collection of [
      { existingSize: 3072 },
      { existingDistance: 'Dot' },
    ]) {
      const { client } = makeClient({ collectionExists: true, ...collection });
      const store = new QdrantVectorStore(client, openAiConfig);

      await expect(store.ensureCollection()).rejects.toMatchObject({
        code: 'COLLECTION_INCOMPATIBLE',
      });
    }
  });

  it('upserts vectors with stable IDs and required chunk/source payload metadata', async () => {
    const { client, mocks } = makeClient();
    const store = new QdrantVectorStore(client, openAiConfig);

    await store.upsertChunks(makeChunks(), validVectors);
    const firstCall = mocks.upsert.mock.calls[0];
    const points = firstCall[1].points as Array<{
      id: string;
      vector: number[];
      payload: Record<string, unknown>;
    }>;

    expect(firstCall[0]).toBe(store.collectionName);
    expect(firstCall[1].wait).toBe(true);
    expect(points).toHaveLength(2);
    expect(points[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(points[0].payload).toEqual({
      documentId: 'doc-123',
      workspaceId: 'workspace-456',
      ownerId: 'owner-789',
      chunkIndex: 0,
      pageNumbers: [1],
      text: 'First chunk text.',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      vectorDimensions: 1536,
    });
    expect(points[1].payload).not.toHaveProperty('pageNumbers');
    expect(points[1].payload.text).toBe('Second chunk text.');

    await store.upsertChunks(makeChunks(), validVectors);
    const secondPoints = mocks.upsert.mock.calls[1][1].points as Array<{ id: string }>;
    expect(secondPoints.map((point) => point.id)).toEqual(points.map((point) => point.id));
  });

  it('creates a distinct collection for the Gemini model and its verified dimension', () => {
    const settings = envSchema.parse({
      EMBEDDING_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
    });
    const store = createConfiguredVectorStore(settings, makeClient().client);

    expect(store.collectionName).toBe('knowledge_chunks_gemini_gemini_embedding_2_3072');
    expect(store.config.dimensions).toBe(3072);
  });

  it('rejects vector count, dimension, non-finite values, and required metadata errors', async () => {
    const { client } = makeClient();
    const store = new QdrantVectorStore(client, openAiConfig);

    await expect(store.upsertChunks(makeChunks(), validVectors.slice(0, 1))).rejects.toMatchObject({
      code: 'INVALID_VECTOR',
    });

    const wrongSize = [Array.from({ length: 4 }, () => 0.1), Array.from({ length: 4 }, () => 0.2)];
    await expect(store.upsertChunks(makeChunks(), wrongSize)).rejects.toMatchObject({
      code: 'INVALID_VECTOR',
    });

    const nonFinite = validVectors.map((vector) => [...vector]);
    nonFinite[0][0] = Number.NaN;
    await expect(store.upsertChunks(makeChunks(), nonFinite)).rejects.toMatchObject({
      code: 'INVALID_VECTOR',
    });

    await expect(
      store.upsertChunks([{ ...makeChunks()[0], ownerId: '' }, makeChunks()[1]], validVectors),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA' });

    await expect(
      store.upsertChunks([{ ...makeChunks()[0], pageNumbers: [0] }, makeChunks()[1]], validVectors),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA' });
  });

  it('deletes vectors with document, workspace, and owner filters', async () => {
    const { client, mocks } = makeClient();
    const store = new QdrantVectorStore(client, openAiConfig);

    await store.deleteDocumentPoints({
      documentId: 'doc-123',
      workspaceId: 'workspace-456',
      ownerId: 'owner-789',
    });

    expect(mocks.delete).toHaveBeenCalledWith(store.collectionName, {
      wait: true,
      filter: {
        must: [
          { key: 'documentId', match: { value: 'doc-123' } },
          { key: 'workspaceId', match: { value: 'workspace-456' } },
          { key: 'ownerId', match: { value: 'owner-789' } },
        ],
      },
    });
  });

  it('deletes stale chunks by document scope and chunk-index range', async () => {
    const { client, mocks } = makeClient();
    const store = new QdrantVectorStore(client, openAiConfig);

    await store.deleteDocumentChunksFrom(
      { documentId: 'doc-123', workspaceId: 'workspace-456', ownerId: 'owner-789' },
      3,
    );

    expect(mocks.delete).toHaveBeenCalledWith(store.collectionName, {
      wait: true,
      filter: {
        must: [
          { key: 'documentId', match: { value: 'doc-123' } },
          { key: 'workspaceId', match: { value: 'workspace-456' } },
          { key: 'ownerId', match: { value: 'owner-789' } },
          { key: 'chunkIndex', range: { gte: 3 } },
        ],
      },
    });

    await expect(
      store.deleteDocumentChunksFrom(
        { documentId: 'doc-123', workspaceId: 'workspace-456', ownerId: 'owner-789' },
        -1,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA' });
  });

  it('returns safe errors for connection, upsert, and delete failures', async () => {
    const failedConnection = makeClient();
    failedConnection.mocks.getCollections.mockRejectedValue(new Error('private Qdrant URL'));
    const connectionStore = new QdrantVectorStore(failedConnection.client, openAiConfig);
    await expect(connectionStore.ensureCollection()).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
    });

    const failedUpsert = makeClient();
    failedUpsert.mocks.upsert.mockRejectedValue(new Error('private Qdrant response'));
    const upsertStore = new QdrantVectorStore(failedUpsert.client, openAiConfig);
    await expect(upsertStore.upsertChunks(makeChunks(), validVectors)).rejects.toMatchObject({
      code: 'UPSERT_FAILED',
    });

    const failedDelete = makeClient();
    failedDelete.mocks.delete.mockRejectedValue(new Error('private Qdrant response'));
    const deleteStore = new QdrantVectorStore(failedDelete.client, openAiConfig);
    await expect(
      deleteStore.deleteDocumentPoints({
        documentId: 'doc-123',
        workspaceId: 'workspace-456',
        ownerId: 'owner-789',
      }),
    ).rejects.toMatchObject({
      code: 'DELETE_FAILED',
    });
  });

  it('uses a safe typed vector-store error', () => {
    expect(new VectorStoreError('CONNECTION_FAILED')).toMatchObject({
      name: 'VectorStoreError',
      code: 'CONNECTION_FAILED',
      message: 'Could not connect to the vector database',
    });
  });
});
