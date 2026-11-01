import { createConfiguredEmbeddingProvider } from './embeddingProvider.js';
import { createConfiguredVectorStore } from './qdrantVectorStore.js';

export type QuestionRetrievalErrorCode = 'INVALID_QUESTION' | 'INVALID_EMBEDDING';

const errorMessages: Record<QuestionRetrievalErrorCode, string> = {
  INVALID_QUESTION: 'Question must be a non-empty string',
  INVALID_EMBEDDING: 'Embedding provider returned an invalid question vector',
};

export class QuestionRetrievalError extends Error {
  constructor(readonly code: QuestionRetrievalErrorCode) {
    super(errorMessages[code]);
    this.name = 'QuestionRetrievalError';
  }
}

export async function retrieveQuestionChunks(
  question: string,
  ownerId: string,
  workspaceId: string,
  topK?: number,
) {
  if (typeof question !== 'string' || !question.trim()) {
    throw new QuestionRetrievalError('INVALID_QUESTION');
  }

  const embeddingProvider = createConfiguredEmbeddingProvider();
  const vectors = await embeddingProvider.embed([question]);
  const vectorStore = createConfiguredVectorStore();

  if (
    !Array.isArray(vectors) ||
    vectors.length !== 1 ||
    !Array.isArray(vectors[0]) ||
    vectors[0].length !== vectorStore.config.dimensions ||
    vectors[0].some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new QuestionRetrievalError('INVALID_EMBEDDING');
  }

  return vectorStore.searchChunks(vectors[0], { ownerId, workspaceId }, topK);
}
