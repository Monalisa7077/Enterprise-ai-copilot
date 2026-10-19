import { describe, expect, it, vi } from 'vitest';
import { envSchema } from '../config/env.js';
import {
  createConfiguredEmbeddingProvider,
  createEmbeddingProvider,
  EmbeddingProviderError,
} from '../services/embeddingProvider.js';

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const openAiVector = (value: number) => Array.from({ length: 1536 }, () => value);
const geminiVector = (value: number) => Array.from({ length: 3072 }, () => value);

describe('embedding providers', () => {
  it('sends OpenAI batch requests using bearer authentication and restores order by response index', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      mockResponse({
        object: 'list',
        data: [
          { object: 'embedding', index: 1, embedding: openAiVector(2) },
          { object: 'embedding', index: 0, embedding: openAiVector(1) },
        ],
      }),
    );
    const provider = createEmbeddingProvider(
      { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-openai-secret' },
      { fetcher },
    );

    const vectors = await provider.embed(['first chunk', 'second chunk']);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;

    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(init?.headers).toEqual({
      Authorization: 'Bearer test-openai-secret',
      'Content-Type': 'application/json',
    });
    expect(body).toEqual({
      input: ['first chunk', 'second chunk'],
      model: 'text-embedding-3-small',
      encoding_format: 'float',
    });
    expect(vectors).toHaveLength(2);
    expect(vectors[0][0]).toBe(1);
    expect(vectors[1][0]).toBe(2);
    expect(vectors[0]).toHaveLength(1536);
  });

  it('sends Gemini batch requests with its model resource and API-key header', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      mockResponse({
        embeddings: [{ values: geminiVector(3) }, { values: geminiVector(4) }],
      }),
    );
    const provider = createEmbeddingProvider(
      { provider: 'gemini', model: 'gemini-embedding-2', apiKey: 'test-gemini-secret' },
      { fetcher },
    );

    const vectors = await provider.embed(['first chunk', 'second chunk']);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      requests: Array<{ model: string; content: { parts: Array<{ text: string }> } }>;
    };

    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:batchEmbedContents',
    );
    expect(init?.headers).toEqual({
      'x-goog-api-key': 'test-gemini-secret',
      'Content-Type': 'application/json',
    });
    expect(body).toEqual({
      model: 'models/gemini-embedding-2',
      requests: [
        { model: 'models/gemini-embedding-2', content: { parts: [{ text: 'first chunk' }] } },
        { model: 'models/gemini-embedding-2', content: { parts: [{ text: 'second chunk' }] } },
      ],
    });
    expect(vectors.map((vector) => vector[0])).toEqual([3, 4]);
    expect(vectors[0]).toHaveLength(3072);
  });

  it('uses the validated provider-specific API key and model configuration', async () => {
    const configuration = envSchema.parse({
      EMBEDDING_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-gemini-secret',
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      mockResponse({ embeddings: [{ values: geminiVector(1) }] }),
    );
    const provider = createConfiguredEmbeddingProvider(configuration, { fetcher });

    await provider.embed(['a chunk']);

    expect(provider.provider).toBe('gemini');
    expect(provider.model).toBe('gemini-embedding-2');
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({
      'x-goog-api-key': 'test-gemini-secret',
      'Content-Type': 'application/json',
    });
  });

  it('rejects missing API keys without making a request', () => {
    expect(() =>
      createEmbeddingProvider({ provider: 'openai', model: 'text-embedding-3-small' }),
    ).toThrowError(expect.objectContaining({ code: 'MISSING_CONFIGURATION' }));
  });

  it('rejects empty text chunks before making a request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = createEmbeddingProvider(
      { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-secret' },
      { fetcher },
    );

    await expect(provider.embed(['valid text', '  '])).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.embed([])).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects missing, duplicate, and out-of-range OpenAI response indices', async () => {
    const invalidResponses = [
      [{ index: 0, embedding: openAiVector(1) }],
      [
        { index: 0, embedding: openAiVector(1) },
        { index: 0, embedding: openAiVector(2) },
      ],
      [
        { index: 0, embedding: openAiVector(1) },
        { index: 2, embedding: openAiVector(2) },
      ],
    ];

    for (const data of invalidResponses) {
      const provider = createEmbeddingProvider(
        { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-secret' },
        { fetcher: vi.fn<typeof fetch>().mockResolvedValue(mockResponse({ data })) },
      );
      await expect(provider.embed(['one', 'two'])).rejects.toMatchObject({
        code: 'MALFORMED_RESPONSE',
      });
    }
  });

  it('rejects non-finite, inconsistent-dimension, or default-model-size vectors', async () => {
    const invalidVectorResponse = mockResponse({
      data: [{ index: 0, embedding: [Number.NaN, 1] }],
    });
    const nonFiniteProvider = createEmbeddingProvider(
      { provider: 'openai', model: 'custom-model', apiKey: 'test-secret' },
      { fetcher: vi.fn<typeof fetch>().mockResolvedValue(invalidVectorResponse) },
    );
    await expect(nonFiniteProvider.embed(['one'])).rejects.toMatchObject({ code: 'INVALID_VECTOR' });

    const inconsistentProvider = createEmbeddingProvider(
      { provider: 'openai', model: 'custom-model', apiKey: 'test-secret' },
      {
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          mockResponse({
            data: [
              { index: 0, embedding: [1, 2] },
              { index: 1, embedding: [3] },
            ],
          }),
        ),
      },
    );
    await expect(inconsistentProvider.embed(['one', 'two'])).rejects.toMatchObject({
      code: 'INVALID_VECTOR',
    });

    const wrongDefaultDimensionProvider = createEmbeddingProvider(
      { provider: 'gemini', model: 'gemini-embedding-2', apiKey: 'test-secret' },
      {
        fetcher: vi.fn<typeof fetch>().mockResolvedValue(
          mockResponse({ embeddings: [{ values: [1, 2] }] }),
        ),
      },
    );
    await expect(wrongDefaultDimensionProvider.embed(['one'])).rejects.toMatchObject({
      code: 'INVALID_VECTOR',
    });
  });

  it('returns safe provider errors for HTTP failures and rate limits', async () => {
    for (const [status, code] of [
      [401, 'HTTP_ERROR'],
      [429, 'RATE_LIMITED'],
      [503, 'HTTP_ERROR'],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        mockResponse({ error: { message: 'secret token must not appear' } }, status),
      );
      const provider = createEmbeddingProvider(
        { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-secret' },
        { fetcher },
      );

      const error = await provider.embed(['chunk']).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(EmbeddingProviderError);
      expect(error).toMatchObject({ code });
      expect((error as Error).message).not.toContain('secret');
    }
  });

  it('maps malformed JSON, network errors, and timeouts to safe errors', async () => {
    const malformedProvider = createEmbeddingProvider(
      { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-secret' },
      {
        fetcher: vi.fn<typeof fetch>().mockResolvedValue({
          ok: true,
          status: 200,
          json: vi.fn().mockRejectedValue(new Error('private response body')),
        } as unknown as Response),
      },
    );
    await expect(malformedProvider.embed(['chunk'])).rejects.toMatchObject({
      code: 'MALFORMED_RESPONSE',
    });

    const networkProvider = createEmbeddingProvider(
      { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-secret' },
      { fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('private network detail')) },
    );
    await expect(networkProvider.embed(['chunk'])).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });

    const timeoutProvider = createEmbeddingProvider(
      { provider: 'openai', model: 'text-embedding-3-small', apiKey: 'test-secret' },
      {
        timeoutMs: 5,
        fetcher: vi.fn<typeof fetch>(
          (_input, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            }),
        ),
      },
    );
    await expect(timeoutProvider.embed(['chunk'])).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT',
    });
  });
});
