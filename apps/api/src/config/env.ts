import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(5000),
    JWT_SECRET: z.string().min(32).default('development-secret-key-32-characters-!'),
    JWT_REFRESH_SECRET: z.string().min(32).default('development-refresh-secret-key-32-characters-!'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/enterprise_knowledge_copilot'),
    UPLOAD_DIR: z.string().min(1).default('./uploads'),
    CHUNK_SIZE: z.coerce.number().int().positive().default(1000),
    CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(200),
    EMBEDDING_PROVIDER: z.enum(['openai', 'gemini']).default('openai'),
    EMBEDDING_MODEL: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),
    QDRANT_URL: z.string().url().default('http://localhost:6333'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    CLIENT_URL: z.string().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    LOG_LEVEL: z.string().default('info'),
  })
  .superRefine((settings, context) => {
    if (settings.CHUNK_OVERLAP >= settings.CHUNK_SIZE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CHUNK_OVERLAP'],
        message: 'CHUNK_OVERLAP must be smaller than CHUNK_SIZE',
      });
    }
  })
  .transform((settings) => ({
    ...settings,
    EMBEDDING_MODEL:
      settings.EMBEDDING_MODEL ??
      (settings.EMBEDDING_PROVIDER === 'openai' ? 'text-embedding-3-small' : 'gemini-embedding-2'),
  }));

export function parseEnv(environment: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(environment);
}

const env = parseEnv();

export default env;
export type AppEnv = z.output<typeof envSchema>;
