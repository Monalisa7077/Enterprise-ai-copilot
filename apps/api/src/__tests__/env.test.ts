import { describe, expect, it } from 'vitest';
import { envSchema } from '../config/env.js';

describe('environment configuration', () => {
  it('provides valid defaults for chunking and OpenAI embeddings', () => {
    const settings = envSchema.parse({});

    expect(settings.CHUNK_SIZE).toBe(1000);
    expect(settings.CHUNK_OVERLAP).toBe(200);
    expect(settings.EMBEDDING_PROVIDER).toBe('openai');
    expect(settings.EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(settings.GEMINI_GENERATION_MODEL).toBe('gemini-3.5-flash');
  });

  it('selects a Gemini model by default when Gemini is configured', () => {
    const settings = envSchema.parse({ EMBEDDING_PROVIDER: 'gemini' });

    expect(settings.EMBEDDING_PROVIDER).toBe('gemini');
    expect(settings.EMBEDDING_MODEL).toBe('gemini-embedding-2');
  });

  it('accepts a provider-specific key without requiring or exposing one by default', () => {
    expect(envSchema.parse({ OPENAI_API_KEY: 'test-openai-key' }).OPENAI_API_KEY).toBe('test-openai-key');
    expect(envSchema.parse({}).OPENAI_API_KEY).toBeUndefined();
    expect(envSchema.parse({}).GEMINI_API_KEY).toBeUndefined();
  });

  it('rejects a non-positive chunk size', () => {
    expect(() => envSchema.parse({ CHUNK_SIZE: '0' })).toThrow();
  });

  it('rejects a negative overlap', () => {
    expect(() => envSchema.parse({ CHUNK_OVERLAP: '-1' })).toThrow();
  });

  it('rejects overlap equal to or larger than chunk size', () => {
    expect(() => envSchema.parse({ CHUNK_SIZE: '100', CHUNK_OVERLAP: '100' })).toThrow(
      'CHUNK_OVERLAP must be smaller than CHUNK_SIZE',
    );
    expect(() => envSchema.parse({ CHUNK_SIZE: '100', CHUNK_OVERLAP: '101' })).toThrow(
      'CHUNK_OVERLAP must be smaller than CHUNK_SIZE',
    );
  });

  it('rejects an unsupported embedding provider', () => {
    expect(() => envSchema.parse({ EMBEDDING_PROVIDER: 'other' })).toThrow();
  });

  it('rejects an explicitly empty provider key', () => {
    expect(() => envSchema.parse({ OPENAI_API_KEY: '' })).toThrow();
    expect(() => envSchema.parse({ GEMINI_API_KEY: '' })).toThrow();
  });

  it('rejects an empty Gemini generation model', () => {
    expect(() => envSchema.parse({ GEMINI_GENERATION_MODEL: '' })).toThrow();
    expect(() => envSchema.parse({ GEMINI_GENERATION_MODEL: '  ' })).toThrow();
  });
});
