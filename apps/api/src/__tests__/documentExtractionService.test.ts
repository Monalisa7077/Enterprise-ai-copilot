import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mammoth from 'mammoth';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DocumentExtractionError,
  extractDocument,
} from '../services/documentExtractionService.js';

vi.mock('mammoth', () => ({
  default: {
    extractRawText: vi.fn(),
  },
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: vi.fn(),
}));

const pdfGetDocument = vi.mocked(getDocument);
const mammothExtractRawText = vi.mocked(mammoth.extractRawText);
const testStorageKey = {
  pdf: 'f2d9352c-44fd-4be2-bf8a-1058d64e2231.pdf',
  docx: 'b998a735-b411-4634-9d7e-43a13993bf0f.docx',
  txt: 'a174f3b8-f029-4b5d-bfb9-1ddb74f03625.txt',
};

let uploadDirectory: string;

async function createStoredFile(storageKey: string, contents: Buffer | string): Promise<void> {
  await writeFile(path.join(uploadDirectory, storageKey), contents);
}

function mockPdf(pages: Array<Array<{ str: string; hasEOL?: boolean }>>) {
  const getPage = vi.fn(async (pageNumber: number) => ({
    getTextContent: vi.fn(async () => ({ items: pages[pageNumber - 1] })),
  }));

  pdfGetDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage,
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof getDocument>);

  return getPage;
}

beforeEach(async () => {
  uploadDirectory = await mkdtemp(path.join(os.tmpdir(), 'copilot-extraction-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(uploadDirectory, { recursive: true, force: true });
});

describe('document text extraction', () => {
  it('extracts PDF text with one-based page metadata', async () => {
    await createStoredFile(testStorageKey.pdf, '%PDF-test');
    const getPage = mockPdf([
      [
        { str: 'Welcome', hasEOL: false },
        { str: 'team', hasEOL: true },
        { str: 'First paragraph', hasEOL: true },
        { str: 'Second paragraph', hasEOL: false },
      ],
      [{ str: 'Page two', hasEOL: false }],
    ]);

    const result = await extractDocument(testStorageKey.pdf, uploadDirectory);

    expect(result).toEqual({
      text: 'Welcome team\nFirst paragraph\nSecond paragraph\n\nPage two',
      pages: [
        { pageNumber: 1, text: 'Welcome team\nFirst paragraph\nSecond paragraph' },
        { pageNumber: 2, text: 'Page two' },
      ],
    });
    expect(getPage).toHaveBeenCalledTimes(2);
  });

  it('returns readable DOCX text without inventing page numbers', async () => {
    await createStoredFile(testStorageKey.docx, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    mammothExtractRawText.mockResolvedValue({
      value: '  Heading  \r\n\r\n  A\tparagraph. ',
      messages: [],
    });

    const result = await extractDocument(testStorageKey.docx, uploadDirectory);

    expect(result).toEqual({
      text: 'Heading\n\nA paragraph.',
      pages: [],
    });
    expect(mammothExtractRawText).toHaveBeenCalledWith({
      buffer: expect.any(Buffer),
    });
  });

  it('reads UTF-8 text and normalizes whitespace without joining paragraphs', async () => {
    await createStoredFile(testStorageKey.txt, '  Policy   overview \r\n\r\n  Applies to all staff.  ');

    const result = await extractDocument(testStorageKey.txt, uploadDirectory);

    expect(result).toEqual({
      text: 'Policy overview\n\nApplies to all staff.',
      pages: [],
    });
  });

  it('rejects empty stored files', async () => {
    await createStoredFile(testStorageKey.txt, Buffer.alloc(0));

    await expect(extractDocument(testStorageKey.txt, uploadDirectory)).rejects.toMatchObject({
      code: 'EMPTY_DOCUMENT',
      message: 'Document contains no extractable text',
    });
  });

  it('rejects text files that contain only whitespace', async () => {
    await createStoredFile(testStorageKey.txt, ' \r\n\t ');

    await expect(extractDocument(testStorageKey.txt, uploadDirectory)).rejects.toMatchObject({
      code: 'EMPTY_DOCUMENT',
    });
  });

  it('rejects invalid UTF-8 text', async () => {
    await createStoredFile(testStorageKey.txt, Buffer.from([0xc3, 0x28]));

    await expect(extractDocument(testStorageKey.txt, uploadDirectory)).rejects.toMatchObject({
      code: 'INVALID_TEXT_ENCODING',
    });
  });

  it('reports missing files without exposing their paths', async () => {
    await expect(extractDocument(testStorageKey.txt, uploadDirectory)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
      message: 'Uploaded document file was not found',
    });
  });

  it('rejects unsupported formats and arbitrary storage paths', async () => {
    await expect(
      extractDocument('f2d9352c-44fd-4be2-bf8a-1058d64e2231.csv', uploadDirectory),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });

    await expect(extractDocument('../outside.txt', uploadDirectory)).rejects.toMatchObject({
      code: 'INVALID_STORAGE_KEY',
    });
  });

  it('maps PDF parser failures to a safe typed error', async () => {
    await createStoredFile(testStorageKey.pdf, '%PDF-corrupt');
    pdfGetDocument.mockImplementation(
      () =>
        ({
          promise: Promise.resolve().then(() => {
            throw new Error(`Parser failed at ${uploadDirectory}\\private.pdf`);
          }),
          destroy: vi.fn().mockResolvedValue(undefined),
        }) as unknown as ReturnType<typeof getDocument>,
    );

    const error = await extractDocument(testStorageKey.pdf, uploadDirectory).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DocumentExtractionError);
    expect(error).toMatchObject({ code: 'CORRUPT_DOCUMENT' });
    expect((error as Error).message).not.toContain(uploadDirectory);
  });

  it('maps DOCX parser failures to a safe typed error', async () => {
    await createStoredFile(testStorageKey.docx, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    mammothExtractRawText.mockRejectedValue(new Error(`Invalid archive at ${uploadDirectory}`));

    const error = await extractDocument(testStorageKey.docx, uploadDirectory).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DocumentExtractionError);
    expect(error).toMatchObject({ code: 'CORRUPT_DOCUMENT' });
    expect((error as Error).message).not.toContain(uploadDirectory);
  });

  it('reports empty extracted PDF and DOCX content', async () => {
    await createStoredFile(testStorageKey.pdf, '%PDF-empty');
    mockPdf([[]]);

    await expect(extractDocument(testStorageKey.pdf, uploadDirectory)).rejects.toMatchObject({
      code: 'EMPTY_DOCUMENT',
    });

    await createStoredFile(testStorageKey.docx, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    mammothExtractRawText.mockResolvedValue({ value: ' \n ', messages: [] });

    await expect(extractDocument(testStorageKey.docx, uploadDirectory)).rejects.toMatchObject({
      code: 'EMPTY_DOCUMENT',
    });
  });
});
