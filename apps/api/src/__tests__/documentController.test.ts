import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../middleware/error.js';
import { uploadDocument } from '../controllers/documentController.js';

const mocks = vi.hoisted(() => ({
  findWorkspace: vi.fn(),
  findExistingDocument: vi.fn(),
  createDocument: vi.fn(),
  updateDocument: vi.fn(),
  validateUpload: vi.fn(),
  checksumUpload: vi.fn(),
  saveUpload: vi.fn(),
  removeUpload: vi.fn(),
  enqueueDocumentIngestion: vi.fn(),
}));

vi.mock('../models/Document.js', () => ({
  default: {
    findOne: mocks.findExistingDocument,
    create: mocks.createDocument,
    findByIdAndUpdate: mocks.updateDocument,
  },
}));

vi.mock('../models/Workspace.js', () => ({
  default: { findOne: mocks.findWorkspace },
}));

vi.mock('../services/documentUploadService.js', () => ({
  checksumUpload: mocks.checksumUpload,
  removeUpload: mocks.removeUpload,
  saveUpload: mocks.saveUpload,
  validateUpload: mocks.validateUpload,
}));

vi.mock('../services/documentIngestionQueue.js', () => ({
  enqueueDocumentIngestion: mocks.enqueueDocumentIngestion,
}));

vi.mock('../config/logger.js', () => ({
  default: { error: vi.fn() },
}));

const ownerId = '507f1f77bcf86cd799439011';
const workspaceId = '507f191e810c19729de860ea';
const documentId = '507f1f77bcf86cd799439012';
const document = {
  _id: { toString: () => documentId },
  status: 'PENDING',
};

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    user: { id: ownerId, email: 'owner@example.com', role: 'USER' },
    body: { workspaceId },
    file: {
      originalname: 'policy.txt',
      mimetype: 'text/plain',
      size: 6,
      buffer: Buffer.from('policy'),
    } as Express.Multer.File,
    ...overrides,
  } as Request;
}

function makeResponse(): Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return response as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

async function invokeUpload(request = makeRequest()) {
  const response = makeResponse();
  const next = vi.fn() as unknown as NextFunction;
  await uploadDocument(request, response, next);
  return { response, next };
}

describe('uploadDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWorkspace.mockResolvedValue({ _id: workspaceId });
    mocks.findExistingDocument.mockResolvedValue(null);
    mocks.validateUpload.mockReturnValue({
      fileName: 'policy.txt',
      extension: '.txt',
      mimeType: 'text/plain',
    });
    mocks.checksumUpload.mockReturnValue('a'.repeat(64));
    mocks.saveUpload.mockResolvedValue('05ef3443-fd0f-4eb3-96ea-498918f6f36a.txt');
    mocks.createDocument.mockResolvedValue(document);
    mocks.updateDocument.mockResolvedValue({ ...document, status: 'FAILED' });
    mocks.enqueueDocumentIngestion.mockResolvedValue(`document-${documentId}`);
  });

  it('creates the document and enqueues only its ID before returning success', async () => {
    const { response, next } = await invokeUpload();

    expect(mocks.findWorkspace).toHaveBeenCalledWith({ _id: workspaceId, ownerId });
    expect(mocks.createDocument).toHaveBeenCalledWith(expect.objectContaining({
      ownerId,
      workspaceId,
      status: 'PENDING',
    }));
    expect(mocks.enqueueDocumentIngestion).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueDocumentIngestion).toHaveBeenCalledWith(documentId);
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: document });
    expect(next).not.toHaveBeenCalled();
  });

  it('marks the saved document failed and returns 503 if enqueueing fails', async () => {
    mocks.enqueueDocumentIngestion.mockRejectedValue(new Error('Redis unavailable'));

    const { response, next } = await invokeUpload();

    expect(mocks.updateDocument).toHaveBeenCalledWith(
      documentId,
      {
        $set: {
          status: 'FAILED',
          processingCompletedAt: expect.any(Date),
          failureCode: 'UNKNOWN',
          failureMessage: 'Could not queue document for processing',
        },
      },
      { new: true },
    );
    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: 'Document was saved but could not be queued for processing',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not save or enqueue when the authenticated owner cannot access the workspace', async () => {
    mocks.findWorkspace.mockResolvedValue(null);

    const { response, next } = await invokeUpload();

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ success: false, message: 'Workspace not found' });
    expect(mocks.saveUpload).not.toHaveBeenCalled();
    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(mocks.enqueueDocumentIngestion).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not save or enqueue when file validation fails', async () => {
    mocks.validateUpload.mockImplementation(() => {
      throw new AppError('Only matching PDF, DOCX, and TXT files are supported', 400);
    });

    const { response, next } = await invokeUpload();

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: 'Only matching PDF, DOCX, and TXT files are supported',
    });
    expect(mocks.saveUpload).not.toHaveBeenCalled();
    expect(mocks.createDocument).not.toHaveBeenCalled();
    expect(mocks.enqueueDocumentIngestion).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid workspace ID without querying ownership or enqueueing', async () => {
    const { response, next } = await invokeUpload(makeRequest({ body: { workspaceId: 'invalid' } }));

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: 'A valid workspaceId is required',
    });
    expect(mocks.findWorkspace).not.toHaveBeenCalled();
    expect(mocks.enqueueDocumentIngestion).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
