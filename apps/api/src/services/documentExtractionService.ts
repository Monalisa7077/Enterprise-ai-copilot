import { realpath, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import env from '../config/env.js';
import logger from '../config/logger.js';

export type ExtractionErrorCode =
  | 'INVALID_STORAGE_KEY'
  | 'UNSUPPORTED_FORMAT'
  | 'FILE_NOT_FOUND'
  | 'FILE_ACCESS_FAILED'
  | 'INVALID_TEXT_ENCODING'
  | 'EMPTY_DOCUMENT'
  | 'CORRUPT_DOCUMENT';

const errorMessages: Record<ExtractionErrorCode, string> = {
  INVALID_STORAGE_KEY: 'Document storage reference is invalid',
  UNSUPPORTED_FORMAT: 'Document format is not supported for text extraction',
  FILE_NOT_FOUND: 'Uploaded document file was not found',
  FILE_ACCESS_FAILED: 'Uploaded document file could not be read',
  INVALID_TEXT_ENCODING: 'Text document is not valid UTF-8',
  EMPTY_DOCUMENT: 'Document contains no extractable text',
  CORRUPT_DOCUMENT: 'Document is corrupt or could not be parsed',
};

export class DocumentExtractionError extends Error {
  constructor(readonly code: ExtractionErrorCode) {
    super(errorMessages[code]);
    this.name = 'DocumentExtractionError';
  }
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface DocumentExtractionResult {
  text: string;
  pages: ExtractedPage[];
}

type DocumentFormat = '.pdf' | '.docx' | '.txt';

function getDocumentFormat(storageKey: string): DocumentFormat {
  const match = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z0-9]+)$/i.exec(
    storageKey,
  );
  if (!match) {
    throw new DocumentExtractionError('INVALID_STORAGE_KEY');
  }

  const extension = `.${match[1].toLowerCase()}`;
  if (extension !== '.pdf' && extension !== '.docx' && extension !== '.txt') {
    throw new DocumentExtractionError('UNSUPPORTED_FORMAT');
  }

  return extension;
}

async function resolveStoredFile(storageKey: string, uploadDirectory: string): Promise<string> {
  try {
    const resolvedDirectory = await realpath(path.resolve(uploadDirectory));
    const candidate = path.resolve(resolvedDirectory, storageKey);
    const relativePath = path.relative(resolvedDirectory, candidate);

    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new DocumentExtractionError('INVALID_STORAGE_KEY');
    }

    const resolvedFile = await realpath(candidate);
    const resolvedRelativePath = path.relative(resolvedDirectory, resolvedFile);
    if (!resolvedRelativePath || resolvedRelativePath.startsWith('..') || path.isAbsolute(resolvedRelativePath)) {
      throw new DocumentExtractionError('INVALID_STORAGE_KEY');
    }

    const fileInfo = await stat(resolvedFile);
    if (!fileInfo.isFile()) {
      throw new DocumentExtractionError('FILE_ACCESS_FAILED');
    }

    return resolvedFile;
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw error;
    }
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new DocumentExtractionError('FILE_NOT_FOUND');
    }
    throw new DocumentExtractionError('FILE_ACCESS_FAILED');
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildPdfItemText(items: unknown[]): string {
  let text = '';
  for (const item of items) {
    if (typeof item !== 'object' || item === null || !('str' in item) || typeof item.str !== 'string') {
      continue;
    }

    text += item.str;
    text += 'hasEOL' in item && item.hasEOL ? '\n' : ' ';
  }
  return normalizeExtractedText(text);
}

async function extractPdf(buffer: Buffer): Promise<DocumentExtractionResult> {
  let loadingTask: ReturnType<typeof getDocument> | undefined;
  try {
    loadingTask = getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    const pages: ExtractedPage[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({
        pageNumber,
        text: buildPdfItemText(content.items),
      });
    }

    const text = pages
      .map((page) => page.text)
      .filter((pageText) => pageText.length > 0)
      .join('\n\n');

    if (!text) {
      throw new DocumentExtractionError('EMPTY_DOCUMENT');
    }

    return { text, pages };
  } catch (error) {
    if (error instanceof DocumentExtractionError) {
      throw error;
    }
    throw new DocumentExtractionError('CORRUPT_DOCUMENT');
  } finally {
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {
        logger.warn('PDF parser cleanup failed');
      }
    }
  }
}

export async function extractDocument(
  storageKey: string,
  uploadDirectory: string = env.UPLOAD_DIR,
): Promise<DocumentExtractionResult> {
  const format = getDocumentFormat(storageKey);
  const filePath = await resolveStoredFile(storageKey, uploadDirectory);

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new DocumentExtractionError('FILE_NOT_FOUND');
    }
    throw new DocumentExtractionError('FILE_ACCESS_FAILED');
  }

  if (buffer.length === 0) {
    throw new DocumentExtractionError('EMPTY_DOCUMENT');
  }

  if (format === '.pdf') {
    return extractPdf(buffer);
  }

  if (format === '.docx') {
    let extractedText: string;
    try {
      const result = await mammoth.extractRawText({
        buffer,
      });
      extractedText = normalizeExtractedText(result.value);
    } catch {
      throw new DocumentExtractionError('CORRUPT_DOCUMENT');
    }

    if (!extractedText) {
      throw new DocumentExtractionError('EMPTY_DOCUMENT');
    }

    return { text: extractedText, pages: [] };
  }

  let extractedText: string;
  try {
    extractedText = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new DocumentExtractionError('INVALID_TEXT_ENCODING');
  }

  const text = normalizeExtractedText(extractedText);
  if (!text) {
    throw new DocumentExtractionError('EMPTY_DOCUMENT');
  }

  return { text, pages: [] };
}
