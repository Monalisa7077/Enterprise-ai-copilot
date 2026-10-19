import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import {
  DocumentExtractionError,
  type DocumentExtractionResult,
} from '../services/documentExtractionService.js';
import {
  EmbeddingProviderError,
} from '../services/embeddingProvider.js';
import {
  DocumentIngestionQueueError,
  enqueueDocumentIngestion,
  parseRedisConnection,
  type DocumentIngestionQueue,
} from '../services/documentIngestionQueue.js';
import {
  processDocumentIngestion,
  type DocumentIngestionDependencies,
  type IngestionFailure,
  type IngestionDocumentRecord,
} from '../services/documentIngestionWorker.js';
import { VectorStoreError } from '../services/qdrantVectorStore.js';
import type { DocumentChunk } from '../services/documentChunkingService.js';

const documentId = '507f1f77bcf86cd799439011';
const document: IngestionDocumentRecord = {
  id: documentId,
  workspaceId: '507f191e810c19729de860ea',
  ownerId: '507f1f77bcf86cd799439012',
  storageKey: '05ef3443-fd0f-4eb3-96ea-498918f6f36a.txt',
};

const extraction: DocumentExtractionResult = { text: 'stored text', pages: [] };
const chunks: DocumentChunk[] = [
  {
    documentId,
    workspaceId: document.workspaceId,
    ownerId: document.ownerId,
    chunkIndex: 0,
    text: 'stored chunk',
  },
];

function makeDependencies(
  overrides: Partial<DocumentIngestionDependencies> = {},
): DocumentIngestionDependencies & {
  calls: string[];
  failures: IngestionFailure[];
} {
  const calls: string[] = [];
  const failures: IngestionFailure[] = [];

  const dependencies: DocumentIngestionDependencies = {
    loadDocument: vi.fn(async () => {
      calls.push('load');
      return document;
    }),
    verifyOwnership: vi.fn(async () => {
      calls.push('verify');
      return true;
    }),
    markProcessing: vi.fn(async () => {
      calls.push('processing');
    }),
    extract: vi.fn(async (storageKey) => {
      calls.push(`extract:${storageKey}`);
      return extraction;
    }),
    chunk: vi.fn(() => {
      calls.push('chunk');
      return chunks;
    }),
    embed: vi.fn(async () => {
      calls.push('embed');
      return [[0.1, 0.2]];
    }),
    upsert: vi.fn(async () => {
      calls.push('upsert');
    }),
    removeStaleChunks: vi.fn(async (_scope, firstStaleIndex) => {
      calls.push(`remove-stale:${firstStaleIndex}`);
    }),
    markCompleted: vi.fn(async () => {
      calls.push('completed');
    }),
    markFailed: vi.fn(async (_failedId, failure) => {
      failures.push(failure);
      calls.push('failed');
    }),
  };

  return { ...dependencies, ...overrides, calls, failures };
}

describe('document ingestion worker pipeline', () => {
  it('processes stored document data in order and removes stale chunks before completion', async () => {
    const dependencies = makeDependencies();

    await expect(processDocumentIngestion(documentId, dependencies)).resolves.toEqual({
      chunksProcessed: 1,
    });

    expect(dependencies.calls).toEqual([
      'load',
      'verify',
      'processing',
      `extract:${document.storageKey}`,
      'chunk',
      'embed',
      'upsert',
      'remove-stale:1',
      'completed',
    ]);
    expect(dependencies.failures).toHaveLength(0);
    expect(dependencies.chunk).toHaveBeenCalledWith(extraction, {
      documentId,
      workspaceId: document.workspaceId,
      ownerId: document.ownerId,
    });
    expect(dependencies.embed).toHaveBeenCalledWith(['stored chunk']);
  });

  it('fails permanently when the document no longer exists', async () => {
    const dependencies = makeDependencies({
      loadDocument: vi.fn().mockResolvedValue(null),
    });

    await expect(processDocumentIngestion(documentId, dependencies)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(dependencies.markProcessing).not.toHaveBeenCalled();
    expect(dependencies.markFailed).not.toHaveBeenCalled();
  });

  it('marks invalid ownership references failed without reading the file', async () => {
    const dependencies = makeDependencies({
      verifyOwnership: vi.fn().mockResolvedValue(false),
    });

    await expect(processDocumentIngestion(documentId, dependencies)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(dependencies.extract).not.toHaveBeenCalled();
    expect(dependencies.failures[0]).toMatchObject({
      failureCode: 'UNKNOWN',
      retryable: false,
    });
  });

  it('records extraction failures using a safe failure and does not retry permanent corrupt files', async () => {
    const dependencies = makeDependencies({
      extract: vi.fn().mockRejectedValue(new DocumentExtractionError('CORRUPT_DOCUMENT')),
    });

    await expect(processDocumentIngestion(documentId, dependencies)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(dependencies.failures[0]).toMatchObject({
      failureCode: 'EXTRACTION_FAILED',
      message: 'Document is corrupt or could not be parsed',
      retryable: false,
    });
  });

  it('allows transient extraction failures to reach BullMQ retry handling', async () => {
    const dependencies = makeDependencies({
      extract: vi.fn().mockRejectedValue(new DocumentExtractionError('FILE_ACCESS_FAILED')),
    });

    await expect(processDocumentIngestion(documentId, dependencies)).rejects.toMatchObject({
      message: 'Uploaded document file could not be read',
    });
    expect(dependencies.failures[0]).toMatchObject({
      failureCode: 'EXTRACTION_FAILED',
      retryable: true,
    });
  });

  it('records embedding failures without persisting provider secrets or raw error details', async () => {
    const dependencies = makeDependencies({
      embed: vi.fn().mockRejectedValue(
        new EmbeddingProviderError('HTTP_ERROR', 401),
      ),
    });

    await expect(processDocumentIngestion(documentId, dependencies)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(dependencies.failures[0]).toMatchObject({
      failureCode: 'EMBEDDING_FAILED',
      message: 'Embedding provider request failed',
      retryable: false,
    });
  });

  it('retries transient embedding and vector-store failures', async () => {
    const embeddingFailure = makeDependencies({
      embed: vi.fn().mockRejectedValue(new EmbeddingProviderError('RATE_LIMITED', 429)),
    });
    await expect(processDocumentIngestion(documentId, embeddingFailure)).rejects.toMatchObject({
      message: 'Embedding provider rate limit was reached',
    });
    expect(embeddingFailure.failures[0]).toMatchObject({ retryable: true });

    const vectorFailure = makeDependencies({
      upsert: vi.fn().mockRejectedValue(new VectorStoreError('CONNECTION_FAILED')),
    });
    await expect(processDocumentIngestion(documentId, vectorFailure)).rejects.toMatchObject({
      message: 'Could not connect to the vector database',
    });
    expect(vectorFailure.failures[0]).toMatchObject({
      failureCode: 'VECTOR_STORAGE_FAILED',
      retryable: true,
    });
  });

  it('marks Qdrant upsert failures and does not delete stale chunks before an upsert succeeds', async () => {
    const dependencies = makeDependencies({
      upsert: vi.fn().mockRejectedValue(new VectorStoreError('UPSERT_FAILED')),
    });

    await expect(processDocumentIngestion(documentId, dependencies)).rejects.toMatchObject({
      message: 'Could not store document vectors',
    });
    expect(dependencies.failures[0]).toMatchObject({
      failureCode: 'VECTOR_STORAGE_FAILED',
      retryable: true,
    });
    expect(dependencies.removeStaleChunks).not.toHaveBeenCalled();
    expect(dependencies.markCompleted).not.toHaveBeenCalled();
  });

  it('records stale-vector cleanup errors as retryable vector-storage failures', async () => {
    const dependencies = makeDependencies({
      removeStaleChunks: vi.fn().mockRejectedValue(new VectorStoreError('DELETE_FAILED')),
    });

    await expect(processDocumentIngestion(documentId, dependencies)).rejects.toMatchObject({
      message: 'Could not delete document vectors',
    });
    expect(dependencies.failures[0]).toMatchObject({
      failureCode: 'VECTOR_STORAGE_FAILED',
      retryable: true,
    });
    expect(dependencies.markCompleted).not.toHaveBeenCalled();
  });

  it('maps unknown errors to a safe message without logging document text or paths', async () => {
    const dependencies = makeDependencies({
      extract: vi.fn().mockRejectedValue(
        new Error(`private document text at C:\\private\\document.txt`),
      ),
    });

    await expect(processDocumentIngestion(documentId, dependencies)).rejects.toMatchObject({
      message: 'Document ingestion failed',
    });
    expect(dependencies.failures[0]).toMatchObject({
      failureCode: 'UNKNOWN',
      message: 'Document ingestion failed',
    });
  });
});

describe('document ingestion queue', () => {
  it('parses the existing Redis URL for BullMQ and supports TLS URLs', () => {
    expect(parseRedisConnection('redis://user:pass@localhost:6380/2')).toEqual({
      host: 'localhost',
      port: 6380,
      username: 'user',
      password: 'pass',
      db: 2,
      maxRetriesPerRequest: null,
    });
    expect(parseRedisConnection('rediss://redis.internal:6379')).toEqual({
      host: 'redis.internal',
      port: 6379,
      maxRetriesPerRequest: null,
      tls: { servername: 'redis.internal' },
    });
    expect(() => parseRedisConnection('http://localhost:6379')).toThrow(
      'Redis connection configuration is invalid',
    );
  });

  it('enqueues using a stable document job ID and bounded retry/backoff settings', async () => {
    const add = vi.fn(async (_name: string, _data: { documentId: string }, options: { jobId: string }) => ({
      id: options.jobId,
    }));
    const queue: DocumentIngestionQueue = {
      add,
      getJob: vi.fn().mockResolvedValue(undefined),
    };

    const jobId = await enqueueDocumentIngestion(documentId, queue);

    expect(jobId).toBe(`document-${documentId}`);
    expect(add).toHaveBeenCalledWith(
      'ingest-document',
      { documentId },
      {
        jobId: `document-${documentId}`,
        attempts: 4,
        backoff: { type: 'exponential', delay: 1000, jitter: 0.2 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 60 * 60, count: 1000 },
      },
    );
  });

  it('reuses active jobs and removes terminal jobs before adding a new run', async () => {
    const add = vi.fn(async (_name: string, _data: { documentId: string }, options: { jobId: string }) => ({
      id: options.jobId,
    }));
    const activeJob = { id: 'existing-job', getState: vi.fn().mockResolvedValue('active'), remove: vi.fn() };
    const queue: DocumentIngestionQueue = {
      add,
      getJob: vi.fn().mockResolvedValue(activeJob),
    };

    await expect(enqueueDocumentIngestion(documentId, queue)).resolves.toBe('existing-job');
    expect(activeJob.remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();

    const failedJob = { id: 'failed-job', getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn() };
    const terminalQueue: DocumentIngestionQueue = {
      add,
      getJob: vi.fn().mockResolvedValue(failedJob),
    };
    await enqueueDocumentIngestion(documentId, terminalQueue);
    expect(failedJob.remove).toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid document IDs and wraps queue errors safely', async () => {
    await expect(enqueueDocumentIngestion('not-an-id', {
      add: vi.fn(),
      getJob: vi.fn(),
    })).rejects.toBeInstanceOf(DocumentIngestionQueueError);

    const brokenQueue: DocumentIngestionQueue = {
      add: vi.fn().mockRejectedValue(new Error('private Redis credentials')),
      getJob: vi.fn().mockResolvedValue(undefined),
    };
    const error = await enqueueDocumentIngestion(documentId, brokenQueue).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(DocumentIngestionQueueError);
    expect((error as Error).message).toBe('Could not enqueue document for ingestion');
    expect((error as Error).message).not.toContain('credentials');
  });
});
