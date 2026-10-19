import { UnrecoverableError, Worker } from 'bullmq';
import mongoose from 'mongoose';
import env from '../config/env.js';
import logger from '../config/logger.js';
import DocumentModel, {
  sanitizeFailureMessage,
  type DocumentFailureCode,
} from '../models/Document.js';
import WorkspaceModel from '../models/Workspace.js';
import { chunkDocument, type DocumentChunk } from './documentChunkingService.js';
import {
  DocumentExtractionError,
  extractDocument,
  type DocumentExtractionResult,
} from './documentExtractionService.js';
import {
  createConfiguredEmbeddingProvider,
  EmbeddingProviderError,
} from './embeddingProvider.js';
import {
  DocumentIngestionJobData,
  documentIngestionJobName,
  documentIngestionQueueName,
  parseRedisConnection,
} from './documentIngestionQueue.js';
import {
  createConfiguredVectorStore,
  VectorStoreError,
} from './qdrantVectorStore.js';
import type { DocumentVectorScope, QdrantVectorClient } from './qdrantVectorStore.js';
import { createQueueErrorLogger } from './queueErrorLogger.js';

const logQueueError = createQueueErrorLogger((message, details) => {
  logger.error(message, details);
});

export interface IngestionDocumentRecord {
  id: string;
  workspaceId: string;
  ownerId: string;
  storageKey: string;
}

export interface IngestionFailure {
  failureCode: DocumentFailureCode;
  message: string;
  retryable: boolean;
}

export interface DocumentIngestionDependencies {
  loadDocument(documentId: string): Promise<IngestionDocumentRecord | null>;
  verifyOwnership(document: IngestionDocumentRecord): Promise<boolean>;
  markProcessing(documentId: string): Promise<void>;
  extract(storageKey: string): Promise<DocumentExtractionResult>;
  chunk(
    extraction: DocumentExtractionResult,
    metadata: { documentId: string; workspaceId: string; ownerId: string },
  ): DocumentChunk[];
  embed(texts: readonly string[]): Promise<number[][]>;
  upsert(chunks: readonly DocumentChunk[], vectors: readonly number[][]): Promise<void>;
  removeStaleChunks(scope: DocumentVectorScope, firstStaleIndex: number): Promise<void>;
  markCompleted(documentId: string): Promise<void>;
  markFailed(documentId: string, failure: IngestionFailure): Promise<void>;
}

export class IngestionOwnershipError extends Error {
  constructor() {
    super('Document ownership references are invalid');
    this.name = 'IngestionOwnershipError';
  }
}

function isRetryableFailure(error: unknown): boolean {
  if (error instanceof DocumentExtractionError) {
    return error.code === 'FILE_ACCESS_FAILED';
  }
  if (error instanceof EmbeddingProviderError) {
    return (
      error.code === 'NETWORK_ERROR' ||
      error.code === 'REQUEST_TIMEOUT' ||
      error.code === 'RATE_LIMITED' ||
      (error.code === 'HTTP_ERROR' && (error.status ?? 0) >= 500)
    );
  }
  if (error instanceof VectorStoreError) {
    return ['CONNECTION_FAILED', 'COLLECTION_SETUP_FAILED', 'UPSERT_FAILED', 'DELETE_FAILED'].includes(
      error.code,
    );
  }
  if (error instanceof IngestionOwnershipError) {
    return false;
  }
  return true;
}

function failureFor(error: unknown): IngestionFailure {
  let failureCode: DocumentFailureCode = 'UNKNOWN';
  let message = 'Document ingestion failed';

  if (error instanceof DocumentExtractionError) {
    failureCode = 'EXTRACTION_FAILED';
    message = error.message;
  } else if (error instanceof EmbeddingProviderError) {
    failureCode = 'EMBEDDING_FAILED';
    message = error.message;
  } else if (error instanceof VectorStoreError) {
    failureCode = 'VECTOR_STORAGE_FAILED';
    message = error.message;
  } else if (error instanceof IngestionOwnershipError) {
    message = error.message;
  }

  return {
    failureCode,
    message: sanitizeFailureMessage(message),
    retryable: isRetryableFailure(error),
  };
}

export function createDefaultIngestionDependencies(
  vectorClient?: QdrantVectorClient,
): DocumentIngestionDependencies {
  const embeddingProvider = createConfiguredEmbeddingProvider();
  const vectorStore = createConfiguredVectorStore(env, vectorClient);

  return {
    async loadDocument(documentId) {
      const document = await DocumentModel.findById(documentId);
      if (!document) return null;
      return {
        id: document._id.toString(),
        workspaceId: document.workspaceId.toString(),
        ownerId: document.ownerId.toString(),
        storageKey: document.storageKey,
      };
    },
    async verifyOwnership(document) {
      if (
        !mongoose.isValidObjectId(document.id) ||
        !mongoose.isValidObjectId(document.workspaceId) ||
        !mongoose.isValidObjectId(document.ownerId)
      ) {
        return false;
      }

      const workspace = await WorkspaceModel.findOne({
        _id: document.workspaceId,
        ownerId: document.ownerId,
      }).select('_id');
      return workspace !== null;
    },
    async markProcessing(documentId) {
      const result = await DocumentModel.findByIdAndUpdate(
        documentId,
        {
          $set: { status: 'PROCESSING', processingStartedAt: new Date() },
          $unset: { processingCompletedAt: 1, failureCode: 1, failureMessage: 1 },
        },
        { new: true },
      );
      if (!result) throw new IngestionOwnershipError();
    },
    extract: (storageKey) => extractDocument(storageKey, env.UPLOAD_DIR),
    chunk: chunkDocument,
    async embed(texts) {
      return embeddingProvider.embed(texts);
    },
    async upsert(chunks, vectors) {
      await vectorStore.upsertChunks(chunks, vectors);
    },
    async removeStaleChunks(scope, firstStaleIndex) {
      await vectorStore.deleteDocumentChunksFrom(scope, firstStaleIndex);
    },
    async markCompleted(documentId) {
      const result = await DocumentModel.findByIdAndUpdate(
        documentId,
        {
          $set: { status: 'COMPLETED', processingCompletedAt: new Date() },
          $unset: { failureCode: 1, failureMessage: 1 },
        },
        { new: true },
      );
      if (!result) throw new IngestionOwnershipError();
    },
    async markFailed(documentId, failure) {
      await DocumentModel.findByIdAndUpdate(documentId, {
        $set: {
          status: 'FAILED',
          processingCompletedAt: new Date(),
          failureCode: failure.failureCode,
          failureMessage: sanitizeFailureMessage(failure.message),
        },
      });
    },
  };
}

export async function processDocumentIngestion(
  documentId: string,
  dependencies: DocumentIngestionDependencies,
): Promise<{ chunksProcessed: number }> {
  if (!mongoose.isValidObjectId(documentId)) {
    throw new UnrecoverableError('Document ID is invalid');
  }

  let document: IngestionDocumentRecord | null = null;
  try {
    document = await dependencies.loadDocument(documentId);
    if (!document) {
      throw new UnrecoverableError('Document no longer exists');
    }

    if (!document.storageKey || !(await dependencies.verifyOwnership(document))) {
      throw new IngestionOwnershipError();
    }

    await dependencies.markProcessing(document.id);

    const extracted = await dependencies.extract(document.storageKey);
    const scope: DocumentVectorScope = {
      documentId: document.id,
      workspaceId: document.workspaceId,
      ownerId: document.ownerId,
    };
    const chunks = dependencies.chunk(extracted, scope);
    const vectors = await dependencies.embed(chunks.map((chunk) => chunk.text));

    await dependencies.upsert(chunks, vectors);
    await dependencies.removeStaleChunks(scope, chunks.length);
    await dependencies.markCompleted(document.id);

    return { chunksProcessed: chunks.length };
  } catch (error) {
    if (document) {
      const failure = failureFor(error);
      try {
        await dependencies.markFailed(document.id, failure);
      } catch {
        throw new Error('Could not update document processing status');
      }

      logger.warn('Document ingestion attempt failed', {
        documentId: document.id,
        failureCode: failure.failureCode,
        retryable: failure.retryable,
      });

      if (error instanceof UnrecoverableError || !failure.retryable) {
        throw new UnrecoverableError(failure.message);
      }
      throw new Error(failure.message);
    }

    if (error instanceof UnrecoverableError) {
      throw error;
    }
    throw new Error('Could not load document for ingestion');
  }
}

export function createDocumentIngestionWorker(
  dependencies: DocumentIngestionDependencies = createDefaultIngestionDependencies(),
  redisUrl: string = env.REDIS_URL,
): Worker<DocumentIngestionJobData, { chunksProcessed: number }, typeof documentIngestionJobName> {
  const worker = new Worker<
    DocumentIngestionJobData,
    { chunksProcessed: number },
    typeof documentIngestionJobName
  >(
    documentIngestionQueueName,
    async (job) => {
      if (job.name !== documentIngestionJobName || !job.data?.documentId) {
        throw new UnrecoverableError('Document ingestion job payload is invalid');
      }
      return processDocumentIngestion(job.data.documentId, dependencies);
    },
    {
      connection: parseRedisConnection(redisUrl),
      concurrency: 2,
      maxStalledCount: 1,
    },
  );

  worker.on('error', logQueueError);
  worker.on('failed', (job, error) => {
    logger.warn('Document ingestion job failed', {
      jobId: job?.id,
      error: sanitizeFailureMessage(error.message),
    });
  });

  return worker;
}
