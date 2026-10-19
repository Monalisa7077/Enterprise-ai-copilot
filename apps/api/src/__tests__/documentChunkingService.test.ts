import { describe, expect, it } from 'vitest';
import {
  chunkDocument,
  DocumentChunkingError,
  type ChunkDocumentMetadata,
  type ChunkingConfig,
} from '../services/documentChunkingService.js';
import type { DocumentExtractionResult } from '../services/documentExtractionService.js';

const metadata: ChunkDocumentMetadata = {
  documentId: 'document-123',
  workspaceId: 'workspace-456',
  ownerId: 'owner-789',
};

const baseConfig: ChunkingConfig = {
  chunkSize: 40,
  chunkOverlap: 0,
};

function extraction(text: string, pages: DocumentExtractionResult['pages'] = []): DocumentExtractionResult {
  return { text, pages };
}

describe('document text chunking', () => {
  it('returns a single trimmed chunk when the document is shorter than the configured size', () => {
    const chunks = chunkDocument(extraction('  A short document.  '), metadata, baseConfig);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      text: 'A short document.',
      documentId: metadata.documentId,
      workspaceId: metadata.workspaceId,
      ownerId: metadata.ownerId,
      chunkIndex: 0,
    });
    expect(chunks[0].pageNumbers).toBeUndefined();
  });

  it('prefers paragraph boundaries when splitting text', () => {
    const source = 'First paragraph has a few words.\n\nSecond paragraph has some words.';
    const chunks = chunkDocument(extraction(source), metadata, {
      chunkSize: 40,
      chunkOverlap: 0,
    });

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'First paragraph has a few words.',
      'Second paragraph has some words.',
    ]);
  });

  it('prefers sentence boundaries when a paragraph exceeds the chunk size', () => {
    const source = 'First sentence is complete. Second sentence is also complete.';
    const chunks = chunkDocument(extraction(source), metadata, {
      chunkSize: 35,
      chunkOverlap: 0,
    });

    expect(chunks.map((chunk) => chunk.text)).toEqual([
      'First sentence is complete.',
      'Second sentence is also complete.',
    ]);
  });

  it('retains overlapping context between chunks without starting mid-word when possible', () => {
    const source = 'alpha beta gamma delta epsilon zeta eta theta';
    const chunks = chunkDocument(extraction(source), metadata, {
      chunkSize: 20,
      chunkOverlap: 5,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].text.startsWith('gamma')).toBe(true);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_chunk, index) => index));
  });

  it('splits long text into bounded chunks and preserves all content without overlap', () => {
    const source = Array.from({ length: 60 }, (_item, index) => `word${index}`).join(' ');
    const chunks = chunkDocument(extraction(source), metadata, {
      chunkSize: 32,
      chunkOverlap: 0,
    });

    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every((chunk) => chunk.text.length <= 32)).toBe(true);
    expect(chunks.map((chunk) => chunk.text).join(' ')).toBe(source);
  });

  it('preserves page provenance for PDF chunks and never adds pages to unpaginated text', () => {
    const paged = extraction('First page content.\n\nSecond page content.', [
      { pageNumber: 1, text: 'First page content.' },
      { pageNumber: 2, text: 'Second page content.' },
    ]);
    const pdfChunks = chunkDocument(paged, metadata, {
      chunkSize: 12,
      chunkOverlap: 0,
    });

    expect(pdfChunks.map((chunk) => chunk.pageNumbers)).toEqual([[1], [1], [2], [2]]);
    expect(chunkDocument(extraction('Unpaginated document text.'), metadata, baseConfig)[0].pageNumbers).toBeUndefined();
  });

  it('throws a typed error for empty or whitespace-only input', () => {
    for (const text of ['', ' \n\t  ']) {
      expect(() => chunkDocument(extraction(text), metadata, baseConfig)).toThrowError(
        expect.objectContaining({ code: 'EMPTY_INPUT' }),
      );
    }
  });

  it('rejects invalid size and overlap settings', () => {
    const invalidConfigs: ChunkingConfig[] = [
      { chunkSize: 0, chunkOverlap: 0 },
      { chunkSize: -1, chunkOverlap: 0 },
      { chunkSize: 10, chunkOverlap: -1 },
      { chunkSize: 10, chunkOverlap: 10 },
      { chunkSize: 10, chunkOverlap: 1.5 },
    ];

    for (const config of invalidConfigs) {
      expect(() => chunkDocument(extraction('some content'), metadata, config)).toThrowError(
        expect.objectContaining({ code: 'INVALID_CONFIGURATION' }),
      );
    }
  });

  it('rejects missing metadata and malformed page provenance', () => {
    expect(() =>
      chunkDocument(extraction('some content'), { ...metadata, documentId: ' ' }, baseConfig),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_METADATA' }));

    expect(() =>
      chunkDocument(extraction('some content', [{ pageNumber: 0, text: 'bad page' }]), metadata, baseConfig),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_EXTRACTION_RESULT' }));
  });

  it('throws an instance of the exported chunking error type', () => {
    try {
      chunkDocument(extraction(''), metadata, baseConfig);
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentChunkingError);
      return;
    }

    throw new Error('Expected chunking to fail for empty input');
  });
});
