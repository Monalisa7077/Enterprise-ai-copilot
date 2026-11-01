import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingProvider } from '../services/embeddingProvider.js';
import type { QdrantVectorStore, VectorSearchResult } from '../services/qdrantVectorStore.js';
import {
  QuestionRetrievalError,
  retrieveQuestionChunks,
} from '../services/questionRetrievalService.js';

const mocks = vi.hoisted(() => ({
  createConfiguredEmbeddingProvider: vi.fn(),
  createConfiguredVectorStore: vi.fn(),
}));

vi.mock('../services/embeddingProvider.js', () => ({
  createConfiguredEmbeddingProvider: mocks.createConfiguredEmbeddingProvider,
}));

vi.mock('../services/qdrantVectorStore.js', () => ({
  createConfiguredVectorStore: mocks.createConfiguredVectorStore,
}));

const ownerId = 'owner-123';
const workspaceId = 'workspace-456';
const vector = [0.1, 0.2, 0.3];
const results: VectorSearchResult[] = [
  {
    text: 'Relevant source text.',
    documentId: 'document-789',
    chunkIndex: 1,
    pageNumbers: [2],
    score: 0.91,
  },
];

const embed = vi.fn<EmbeddingProvider['embed']>();
const searchChunks = vi.fn<QdrantVectorStore['searchChunks']>();

describe('question retrieval service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embed.mockResolvedValue([vector]);
    searchChunks.mockResolvedValue(results);
    mocks.createConfiguredEmbeddingProvider.mockReturnValue({ embed });
    mocks.createConfiguredVectorStore.mockReturnValue({
      config: { dimensions: vector.length },
      searchChunks,
    });
  });

  it('embeds the question and returns scoped chunks and scores', async () => {
    await expect(
      retrieveQuestionChunks('Where is the policy documented?', ownerId, workspaceId, 8),
    ).resolves.toEqual(results);

    expect(mocks.createConfiguredEmbeddingProvider).toHaveBeenCalledOnce();
    expect(embed).toHaveBeenCalledWith(['Where is the policy documented?']);
    expect(mocks.createConfiguredVectorStore).toHaveBeenCalledOnce();
    expect(searchChunks).toHaveBeenCalledWith(vector, { ownerId, workspaceId }, 8);
  });

  it('rejects an empty or whitespace-only question before creating dependencies', async () => {
    for (const question of ['', ' \t\n ']) {
      await expect(retrieveQuestionChunks(question, ownerId, workspaceId)).rejects.toMatchObject({
        name: 'QuestionRetrievalError',
        code: 'INVALID_QUESTION',
      });
    }

    expect(mocks.createConfiguredEmbeddingProvider).not.toHaveBeenCalled();
    expect(mocks.createConfiguredVectorStore).not.toHaveBeenCalled();
  });

  it('propagates embedding provider failures without searching', async () => {
    const providerError = new Error('Embedding request failed');
    embed.mockRejectedValueOnce(providerError);

    await expect(retrieveQuestionChunks('A valid question?', ownerId, workspaceId)).rejects.toBe(
      providerError,
    );
    expect(searchChunks).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'no vectors', vectors: [] as number[][] },
    { name: 'multiple vectors', vectors: [[1], [2]] },
    { name: 'empty vector', vectors: [[]] },
    { name: 'non-finite values', vectors: [[Number.NaN, 0.2, 0.3]] },
    { name: 'incorrect dimensions', vectors: [[0.1, 0.2]] },
  ])('rejects invalid embedding output: $name', async ({ vectors }) => {
    embed.mockResolvedValueOnce(vectors);

    await expect(retrieveQuestionChunks('A valid question?', ownerId, workspaceId)).rejects.toEqual(
      expect.objectContaining({
        name: 'QuestionRetrievalError',
        code: 'INVALID_EMBEDDING',
      } satisfies Partial<QuestionRetrievalError>),
    );
    expect(searchChunks).not.toHaveBeenCalled();
  });
});
