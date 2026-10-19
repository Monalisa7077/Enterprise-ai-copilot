import { Queue } from 'bullmq';
import mongoose from 'mongoose';
import env from '../config/env.js';

export const documentIngestionQueueName = 'document-ingestion';
export const documentIngestionJobName = 'ingest-document';

export interface DocumentIngestionJobData {
  documentId: string;
}

export interface DocumentIngestionQueue {
  add(
    name: string,
    data: DocumentIngestionJobData,
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: 'exponential'; delay: number; jitter: number };
      removeOnComplete: boolean;
      removeOnFail: { age: number; count: number };
    },
  ): Promise<{ id?: string }>;
  getJob(jobId: string): Promise<{
    id?: string;
    getState(): Promise<string>;
    remove(): Promise<void>;
  } | undefined>;
}

export type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
  tls?: { servername: string };
};

export class DocumentIngestionQueueError extends Error {
  constructor(readonly code: 'INVALID_DOCUMENT_ID' | 'QUEUE_FAILED') {
    super(
      code === 'INVALID_DOCUMENT_ID'
        ? 'Document ID is invalid'
        : 'Could not enqueue document for ingestion',
    );
    this.name = 'DocumentIngestionQueueError';
  }
}

export function parseRedisConnection(redisUrl: string): RedisConnectionOptions {
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    throw new Error('Redis connection configuration is invalid');
  }

  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error('Redis connection configuration is invalid');
  }

  const dbSegment = parsed.pathname.replace(/^\/+/, '');
  const db = dbSegment ? Number(dbSegment) : undefined;
  if (db !== undefined && (!Number.isInteger(db) || db < 0)) {
    throw new Error('Redis connection configuration is invalid');
  }

  const port = parsed.port ? Number(parsed.port) : 6379;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !parsed.hostname) {
    throw new Error('Redis connection configuration is invalid');
  }

  return {
    host: parsed.hostname,
    port,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db === undefined ? {} : { db }),
    maxRetriesPerRequest: null,
    ...(parsed.protocol === 'rediss:' ? { tls: { servername: parsed.hostname } } : {}),
  };
}

let defaultQueue: Queue<DocumentIngestionJobData> | undefined;

export function createDocumentIngestionQueue(
  redisUrl: string = env.REDIS_URL,
): Queue<DocumentIngestionJobData> {
  return new Queue<DocumentIngestionJobData>(documentIngestionQueueName, {
    connection: parseRedisConnection(redisUrl),
    defaultJobOptions: {
      attempts: 4,
      backoff: { type: 'exponential', delay: 1000, jitter: 0.2 },
      removeOnComplete: true,
      removeOnFail: { age: 24 * 60 * 60, count: 1000 },
    },
  });
}

function getDefaultQueue(): Queue<DocumentIngestionJobData> {
  defaultQueue ??= createDocumentIngestionQueue();
  return defaultQueue;
}

function stableJobId(documentId: string): string {
  return `document-${documentId}`;
}

export async function enqueueDocumentIngestion(
  documentId: string,
  queue: DocumentIngestionQueue = getDefaultQueue(),
): Promise<string> {
  if (!mongoose.isValidObjectId(documentId)) {
    throw new DocumentIngestionQueueError('INVALID_DOCUMENT_ID');
  }

  const jobId = stableJobId(documentId);
  try {
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (['active', 'waiting', 'delayed', 'paused', 'waiting-children'].includes(state)) {
        return existingJob.id ?? jobId;
      }
      await existingJob.remove();
    }

    const job = await queue.add(
      documentIngestionJobName,
      { documentId },
      {
        jobId,
        attempts: 4,
        backoff: { type: 'exponential', delay: 1000, jitter: 0.2 },
        removeOnComplete: true,
        removeOnFail: { age: 24 * 60 * 60, count: 1000 },
      },
    );
    return job.id ?? jobId;
  } catch {
    throw new DocumentIngestionQueueError('QUEUE_FAILED');
  }
}

export async function closeDocumentIngestionQueue(): Promise<void> {
  if (defaultQueue) {
    await defaultQueue.close();
    defaultQueue = undefined;
  }
}
