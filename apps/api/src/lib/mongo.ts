import mongoose from 'mongoose';
import env from '../config/env.js';
import logger from '../config/logger.js';

export async function connectMongo(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  await mongoose.connect(env.MONGODB_URI);
  logger.info('MongoDB connected successfully');
}
