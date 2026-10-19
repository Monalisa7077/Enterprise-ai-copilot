import mongoose from 'mongoose';
import logger from './config/logger.js';
import { startupErrorDetails } from './config/startupError.js';
import { connectMongo } from './lib/mongo.js';
import { closeDocumentIngestionQueue } from './services/documentIngestionQueue.js';
import { createDocumentIngestionWorker } from './services/documentIngestionWorker.js';

async function startWorker(): Promise<void> {
  try {
    await connectMongo();
    const worker = createDocumentIngestionWorker();

    const shutdown = async (signal: string) => {
      logger.info(`Document ingestion worker shutting down (${signal})`);
      await worker.close();
      await closeDocumentIngestionQueue();
      await mongoose.disconnect();
      process.exit(0);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    logger.info('Document ingestion worker started');
  } catch (error) {
    logger.error('Document ingestion worker failed to start', startupErrorDetails(error));
    process.exit(1);
  }
}

void startWorker();
