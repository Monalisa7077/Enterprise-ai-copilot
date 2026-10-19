import env from './config/env.js';
import logger from './config/logger.js';
import { createApp } from './app.js';
import { connectMongo } from './lib/mongo.js';

async function startServer() {
  try {
    await connectMongo();
    const app = createApp();

    app.listen(env.PORT, () => {
      logger.info(`API listening on http://localhost:${env.PORT}`);
    });
  } catch (error) {
    logger.error('Server failed to start', error);
    process.exit(1);
  }
}

startServer();
