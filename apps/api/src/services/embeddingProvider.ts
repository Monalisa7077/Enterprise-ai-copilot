import env from '../config/env.js';

export const embeddingProviders = ['openai', 'gemini'] as const;
export type EmbeddingProviderName = (typeof embeddingProviders)[number];

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderName;
  model: string;
  apiKey?: string;
}

export interface EmbeddingProvider {
  readonly provider: EmbeddingProviderName;
  readonly model: string;
  embed(texts: readonly string[]): Promise<number[][]>;
}

export type EmbeddingProviderErrorCode =
  | 'MISSING_CONFIGURATION'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_MODEL'
  | 'REQUEST_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'RATE_LIMITED'
  | 'HTTP_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'INVALID_VECTOR';

const errorMessages: Record<EmbeddingProviderErrorCode, string> = {
  MISSING_CONFIGURATION: 'Embedding provider API key is not configured',
  INVALID_CONFIGURATION: 'Embedding provider configuration is invalid',
  INVALID_INPUT: 'Embedding input must contain non-empty text chunks',
  UNSUPPORTED_MODEL: 'Embedding model dimensions are not configured',
  REQUEST_TIMEOUT: 'Embedding provider request timed out',
  NETWORK_ERROR: 'Embedding provider could not be reached',
  RATE_LIMITED: 'Embedding provider rate limit was reached',
  HTTP_ERROR: 'Embedding provider request failed',
  MALFORMED_RESPONSE: 'Embedding provider returned an invalid response',
  INVALID_VECTOR: 'Embedding provider returned invalid vector data',
};

export class EmbeddingProviderError extends Error {
  constructor(
    readonly code: EmbeddingProviderErrorCode,
    readonly status?: number,
  ) {
    super(errorMessages[code]);
    this.name = 'EmbeddingProviderError';
  }
}

export interface EmbeddingProviderOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const defaultTimeoutMs = 30_000;
const defaultDimensions: Partial<Record<EmbeddingProviderName, Record<string, number>>> = {
  openai: {
    'text-embedding-3-small': 1536,
  },
  gemini: {
    'gemini-embedding-2': 3072,
  },
};

function getExpectedDimensions(provider: EmbeddingProviderName, model: string): number | undefined {
  const normalizedModel = model.replace(/^models\//, '');
  return defaultDimensions[provider]?.[normalizedModel];
}

export function getEmbeddingDimensions(provider: EmbeddingProviderName, model: string): number {
  const dimensions = getExpectedDimensions(provider, model);
  if (dimensions === undefined) {
    throw new EmbeddingProviderError('UNSUPPORTED_MODEL');
  }
  return dimensions;
}

function validateConfiguration(config: EmbeddingProviderConfig, timeoutMs: number): void {
  if (!config.model.trim() || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new EmbeddingProviderError('INVALID_CONFIGURATION');
  }
  if (!config.apiKey?.trim()) {
    throw new EmbeddingProviderError('MISSING_CONFIGURATION');
  }
}

function validateInputs(texts: readonly string[]): void {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string' || text.trim().length === 0)) {
    throw new EmbeddingProviderError('INVALID_INPUT');
  }
}

function parseVector(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((number) => typeof number !== 'number' || !Number.isFinite(number))
  ) {
    throw new EmbeddingProviderError('INVALID_VECTOR');
  }
  return value;
}

function validateVectors(vectors: number[][], expectedCount: number, expectedDimensions?: number): number[][] {
  if (vectors.length !== expectedCount || vectors.length === 0) {
    throw new EmbeddingProviderError('MALFORMED_RESPONSE');
  }

  const dimensions = vectors[0].length;
  if (
    vectors.some((vector) => vector.length !== dimensions) ||
    (expectedDimensions !== undefined && dimensions !== expectedDimensions)
  ) {
    throw new EmbeddingProviderError('INVALID_VECTOR');
  }

  return vectors;
}

async function sendRequest(
  fetcher: typeof fetch,
  timeoutMs: number,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let readingResponse = false;
    try {
      const response = await fetcher(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new EmbeddingProviderError('RATE_LIMITED', response.status);
        }
        if (response.status === 408 || response.status === 504) {
          throw new EmbeddingProviderError('REQUEST_TIMEOUT', response.status);
        }
        throw new EmbeddingProviderError('HTTP_ERROR', response.status);
      }

      readingResponse = true;
      return await response.json();
    } catch (error) {
      if (error instanceof EmbeddingProviderError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new EmbeddingProviderError('REQUEST_TIMEOUT');
      }
      throw new EmbeddingProviderError(readingResponse ? 'MALFORMED_RESPONSE' : 'NETWORK_ERROR');
    }
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'openai' as const;
  readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: EmbeddingProviderConfig,
    options: EmbeddingProviderOptions,
  ) {
    this.model = config.model;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    validateConfiguration(config, this.timeoutMs);
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    validateInputs(texts);
    if (texts.length === 0) return [];

    const response = await sendRequest(this.fetcher, this.timeoutMs, 'https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        encoding_format: 'float',
      }),
    });

    if (!isRecord(response) || !Array.isArray(response.data)) {
      throw new EmbeddingProviderError('MALFORMED_RESPONSE');
    }

    const orderedVectors: Array<number[] | undefined> = new Array(texts.length).fill(undefined);
    for (const item of response.data) {
      if (
        !isRecord(item) ||
        !Number.isInteger(item.index) ||
        (item.index as number) < 0 ||
        (item.index as number) >= texts.length ||
        orderedVectors[item.index as number] !== undefined
      ) {
        throw new EmbeddingProviderError('MALFORMED_RESPONSE');
      }
      orderedVectors[item.index as number] = parseVector(item.embedding);
    }

    if (orderedVectors.some((vector) => vector === undefined)) {
      throw new EmbeddingProviderError('MALFORMED_RESPONSE');
    }

    return validateVectors(
      orderedVectors.map((vector) => {
        if (!vector) {
          throw new EmbeddingProviderError('MALFORMED_RESPONSE');
        }
        return vector;
      }),
      texts.length,
      getExpectedDimensions(this.provider, this.model),
    );
  }
}

class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'gemini' as const;
  readonly model: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: EmbeddingProviderConfig,
    options: EmbeddingProviderOptions,
  ) {
    this.model = config.model.replace(/^models\//, '');
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    validateConfiguration(config, this.timeoutMs);
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    validateInputs(texts);
    if (texts.length === 0) return [];

    const modelResource = `models/${this.model}`;
    const response = await sendRequest(
      this.fetcher,
      this.timeoutMs,
      `https://generativelanguage.googleapis.com/v1beta/${modelResource}:batchEmbedContents`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.config.apiKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelResource,
          requests: texts.map((text) => ({
            model: modelResource,
            content: {
              parts: [{ text }],
            },
          })),
        }),
      },
    );

    if (!isRecord(response) || !Array.isArray(response.embeddings)) {
      throw new EmbeddingProviderError('MALFORMED_RESPONSE');
    }

    const vectors = response.embeddings.map((item) => {
      if (!isRecord(item)) {
        throw new EmbeddingProviderError('MALFORMED_RESPONSE');
      }
      return parseVector(item.values);
    });

    return validateVectors(vectors, texts.length, getExpectedDimensions(this.provider, this.model));
  }
}

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig,
  options: EmbeddingProviderOptions = {},
): EmbeddingProvider {
  if (config.provider === 'openai') {
    return new OpenAIEmbeddingProvider(config, options);
  }
  if (config.provider === 'gemini') {
    return new GeminiEmbeddingProvider(config, options);
  }
  throw new EmbeddingProviderError('INVALID_CONFIGURATION');
}

export function createConfiguredEmbeddingProvider(
  configuration: typeof env = env,
  options: EmbeddingProviderOptions = {},
): EmbeddingProvider {
  const apiKey =
    configuration.EMBEDDING_PROVIDER === 'openai'
      ? configuration.OPENAI_API_KEY
      : configuration.GEMINI_API_KEY;

  return createEmbeddingProvider(
    {
      provider: configuration.EMBEDDING_PROVIDER,
      model: configuration.EMBEDDING_MODEL,
      apiKey,
    },
    options,
  );
}
