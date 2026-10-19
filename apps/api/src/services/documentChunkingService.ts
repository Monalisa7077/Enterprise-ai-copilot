import env from '../config/env.js';
import type { DocumentExtractionResult } from './documentExtractionService.js';
import { normalizeExtractedText } from './documentExtractionService.js';

export interface ChunkDocumentMetadata {
  documentId: string;
  workspaceId: string;
  ownerId: string;
}

export interface ChunkingConfig {
  chunkSize: number;
  chunkOverlap: number;
}

export interface DocumentChunk extends ChunkDocumentMetadata {
  text: string;
  chunkIndex: number;
  pageNumbers?: number[];
}

export type ChunkingErrorCode =
  | 'EMPTY_INPUT'
  | 'INVALID_CONFIGURATION'
  | 'INVALID_EXTRACTION_RESULT'
  | 'INVALID_METADATA';

const chunkingErrorMessages: Record<ChunkingErrorCode, string> = {
  EMPTY_INPUT: 'Document contains no text to chunk',
  INVALID_CONFIGURATION: 'Chunk size and overlap settings are invalid',
  INVALID_EXTRACTION_RESULT: 'Document extraction result is invalid',
  INVALID_METADATA: 'Document metadata is invalid',
};

export class DocumentChunkingError extends Error {
  constructor(readonly code: ChunkingErrorCode) {
    super(chunkingErrorMessages[code]);
    this.name = 'DocumentChunkingError';
  }
}

const defaultConfig: ChunkingConfig = {
  chunkSize: env.CHUNK_SIZE,
  chunkOverlap: env.CHUNK_OVERLAP,
};

function validateConfig(config: ChunkingConfig): void {
  if (
    !Number.isInteger(config.chunkSize) ||
    config.chunkSize <= 0 ||
    !Number.isInteger(config.chunkOverlap) ||
    config.chunkOverlap < 0 ||
    config.chunkOverlap >= config.chunkSize
  ) {
    throw new DocumentChunkingError('INVALID_CONFIGURATION');
  }
}

function validateMetadata(metadata: ChunkDocumentMetadata): void {
  if (
    !metadata ||
    typeof metadata.documentId !== 'string' ||
    !metadata.documentId.trim() ||
    typeof metadata.workspaceId !== 'string' ||
    !metadata.workspaceId.trim() ||
    typeof metadata.ownerId !== 'string' ||
    !metadata.ownerId.trim()
  ) {
    throw new DocumentChunkingError('INVALID_METADATA');
  }
}

function findSentenceBoundary(text: string, start: number, end: number): number | undefined {
  const section = text.slice(start, end);
  const sentenceEndings = /[.!?]["')\]]?\s+/g;
  let boundary: number | undefined;
  let match: RegExpExecArray | null;

  while ((match = sentenceEndings.exec(section)) !== null) {
    boundary = start + match.index + match[0].length;
  }

  return boundary;
}

function findNaturalBoundary(text: string, start: number, end: number, minimumEnd: number): number {
  const paragraphBoundary = text.lastIndexOf('\n\n', end - 1);
  if (paragraphBoundary >= minimumEnd) {
    return Math.min(paragraphBoundary + 2, end);
  }

  const sentenceBoundary = findSentenceBoundary(text, minimumEnd, end);
  if (sentenceBoundary !== undefined) {
    return sentenceBoundary;
  }

  const whitespaceBoundary = Math.max(
    text.lastIndexOf(' ', end - 1),
    text.lastIndexOf('\n', end - 1),
    text.lastIndexOf('\t', end - 1),
  );
  if (whitespaceBoundary >= minimumEnd) {
    return whitespaceBoundary + 1;
  }

  return end > start ? end : start + 1;
}

function getNextChunkStart(text: string, chunkEnd: number, overlap: number, previousStart: number): number {
  const overlapStart = chunkEnd - overlap;
  if (overlap === 0) {
    return chunkEnd;
  }

  const previousWordBoundary = Math.max(
    text.lastIndexOf(' ', overlapStart - 1),
    text.lastIndexOf('\n', overlapStart - 1),
    text.lastIndexOf('\t', overlapStart - 1),
  );
  const alignedStart = previousWordBoundary >= previousStart ? previousWordBoundary + 1 : overlapStart;

  return Math.max(previousStart + 1, alignedStart);
}

function chunkText(
  text: string,
  metadata: ChunkDocumentMetadata,
  config: ChunkingConfig,
  pageNumber?: number,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const endLimit = Math.min(start + config.chunkSize, text.length);
    const end =
      endLimit === text.length
        ? text.length
        : findNaturalBoundary(
            text,
            start,
            endLimit,
            Math.min(
              endLimit,
              start + Math.max(1, Math.floor(config.chunkSize / 2), config.chunkOverlap + 1),
            ),
          );
    const chunk = text.slice(start, end).trim();

    if (chunk) {
      chunks.push({
        ...metadata,
        text: chunk,
        chunkIndex: 0,
        ...(pageNumber === undefined ? {} : { pageNumbers: [pageNumber] }),
      });
    }

    if (end >= text.length) {
      break;
    }

    start = getNextChunkStart(text, end, config.chunkOverlap, start);
  }

  return chunks;
}

export function chunkDocument(
  extraction: DocumentExtractionResult,
  metadata: ChunkDocumentMetadata,
  config: ChunkingConfig = defaultConfig,
): DocumentChunk[] {
  validateConfig(config);
  validateMetadata(metadata);

  if (
    !extraction ||
    typeof extraction.text !== 'string' ||
    !Array.isArray(extraction.pages)
  ) {
    throw new DocumentChunkingError('INVALID_EXTRACTION_RESULT');
  }

  const normalizedPages = extraction.pages.map((page) => {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || typeof page.text !== 'string') {
      throw new DocumentChunkingError('INVALID_EXTRACTION_RESULT');
    }
    return {
      pageNumber: page.pageNumber,
      text: normalizeExtractedText(page.text),
    };
  });

  const pageTexts = normalizedPages.filter((page) => page.text.length > 0);
  let chunks = pageTexts.length
    ? pageTexts.flatMap((page) => chunkText(page.text, metadata, config, page.pageNumber))
    : chunkText(normalizeExtractedText(extraction.text), metadata, config);

  if (chunks.length === 0) {
    throw new DocumentChunkingError('EMPTY_INPUT');
  }

  chunks = chunks.map((chunk, chunkIndex) => ({
    ...chunk,
    chunkIndex,
  }));
  return chunks;
}
