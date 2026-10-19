import { describe, expect, it } from 'vitest';
import DocumentModel, {
  documentFailureCodes,
  documentStatuses,
  sanitizeFailureMessage,
} from '../models/Document.js';

describe('document processing metadata', () => {
  const validDocument = {
    ownerId: '507f1f77bcf86cd799439011',
    workspaceId: '507f191e810c19729de860ea',
    fileName: 'policies.txt',
    mimeType: 'text/plain',
    size: 12,
    checksum: 'a'.repeat(64),
    storageKey: '05ef3443-fd0f-4eb3-96ea-498918f6f36a.txt',
  };

  it('retains all four processing statuses', () => {
    expect(documentStatuses).toEqual(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']);
  });

  it('allows processing timestamps and a known failure code', () => {
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const completedAt = new Date('2026-01-01T00:00:01.000Z');
    const document = new DocumentModel({
      ...validDocument,
      status: 'FAILED',
      processingStartedAt: startedAt,
      processingCompletedAt: completedAt,
      failureCode: 'EXTRACTION_FAILED',
      failureMessage: 'Unable to extract text',
    });

    expect(document.validateSync()).toBeUndefined();
    expect(document.processingStartedAt).toEqual(startedAt);
    expect(document.processingCompletedAt).toEqual(completedAt);
    expect(document.failureCode).toBe('EXTRACTION_FAILED');
    expect(documentFailureCodes).toContain(document.failureCode);
  });

  it('rejects unknown status and failure codes', () => {
    const invalidStatus = new DocumentModel({ ...validDocument, status: 'QUEUED' });
    const invalidFailureCode = new DocumentModel({
      ...validDocument,
      failureCode: 'PROVIDER_SECRET',
    });

    expect(invalidStatus.validateSync()?.errors.status).toBeDefined();
    expect(invalidFailureCode.validateSync()?.errors.failureCode).toBeDefined();
  });

  it('sanitizes control characters and common API bearer secrets in failure messages', () => {
    expect(sanitizeFailureMessage('Request failed\nBearer abc123 sk-abcdefgh12345678')).toBe(
      'Request failed Bearer [REDACTED] [REDACTED]',
    );
  });

  it('limits stored failure messages to 300 characters', () => {
    const document = new DocumentModel({
      ...validDocument,
      failureMessage: 'x'.repeat(400),
    });

    expect(document.failureMessage).toHaveLength(300);
    expect(document.validateSync()).toBeUndefined();
  });
});
