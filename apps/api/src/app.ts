import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { parseCorsOrigins } from './config/cors.js';
import env from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import apiRoutes from './routes/index.js';

export function createApp(): Express {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: parseCorsOrigins(env.CORS_ORIGINS),
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan('combined'));

  app.get('/health', (_req, res) => {
    res.status(200).json({ success: true, status: 'ok' });
  });

  app.use('/api/v1', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
