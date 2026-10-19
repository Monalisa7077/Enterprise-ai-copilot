import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import logger from '../config/logger.js';
import DocumentModel from '../models/Document.js';
import WorkspaceModel from '../models/Workspace.js';
import { AppError } from '../middleware/error.js';
import {
  checksumUpload,
  removeUpload,
  saveUpload,
  validateUpload,
} from '../services/documentUploadService.js';
import { enqueueDocumentIngestion } from '../services/documentIngestionQueue.js';

const listDocumentsSchema = z.object({
  workspaceId: z.string().optional(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

export async function uploadDocument(req: Request, res: Response, next: NextFunction) {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'A document file is required' });
  }

  const workspaceId = z.string().refine(mongoose.isValidObjectId, 'Invalid workspace ID').safeParse(req.body.workspaceId);
  if (!workspaceId.success) {
    return res.status(400).json({ success: false, message: 'A valid workspaceId is required' });
  }

  let storageKey: string | undefined;
  try {
    const workspace = await WorkspaceModel.findOne({
      _id: workspaceId.data,
      ownerId: req.user!.id,
    });
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const validatedFile = validateUpload(req.file);
    const checksum = checksumUpload(req.file.buffer);
    const existingDocument = await DocumentModel.findOne({
      ownerId: req.user!.id,
      workspaceId: workspace._id,
      checksum,
    });
    if (existingDocument) {
      return res.status(409).json({ success: false, message: 'This file has already been uploaded to this workspace' });
    }

    storageKey = await saveUpload(req.file.buffer, validatedFile.extension);
    const document = await DocumentModel.create({
      ownerId: req.user!.id,
      workspaceId: workspace._id,
      fileName: validatedFile.fileName,
      mimeType: validatedFile.mimeType,
      size: req.file.size,
      checksum,
      storageKey,
      status: 'PENDING',
    });
    storageKey = undefined;

    try {
      await enqueueDocumentIngestion(document._id.toString());
    } catch (error) {
      const documentId = document._id.toString();
      logger.error('Failed to enqueue document for ingestion', { documentId });

      try {
        const failedDocument = await DocumentModel.findByIdAndUpdate(
          documentId,
          {
            $set: {
              status: 'FAILED',
              processingCompletedAt: new Date(),
              failureCode: 'UNKNOWN',
              failureMessage: 'Could not queue document for processing',
            },
          },
          { new: true },
        );
        if (!failedDocument) {
          throw new Error('Document no longer exists after queue failure');
        }
      } catch (statusError) {
        logger.error('Failed to record document ingestion enqueue failure', { documentId, error: statusError });
        return next(statusError);
      }

      return res.status(503).json({
        success: false,
        message: 'Document was saved but could not be queued for processing',
      });
    }

    return res.status(201).json({ success: true, data: document });
  } catch (error) {
    if (storageKey) {
      try {
        await removeUpload(storageKey);
      } catch (cleanupError) {
        logger.error('Failed to remove an unrecorded document upload', { storageKey, error: cleanupError });
      }
    }

    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ success: false, message: 'This file has already been uploaded to this workspace' });
    }

    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

export async function listDocuments(req: Request, res: Response, next: NextFunction) {
  const parsed = listDocumentsSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid document filters',
      errors: parsed.error.flatten(),
    });
  }

  const { workspaceId, status, page, limit } = parsed.data;
  if (workspaceId && !mongoose.isValidObjectId(workspaceId)) {
    return res.status(400).json({ success: false, message: 'Invalid workspace ID' });
  }

  try {
    if (workspaceId) {
      const workspace = await WorkspaceModel.findOne({ _id: workspaceId, ownerId: req.user!.id });
      if (!workspace) {
        return res.status(404).json({ success: false, message: 'Workspace not found' });
      }
    }

    const filter: Record<string, unknown> = { ownerId: req.user!.id };
    if (workspaceId) filter.workspaceId = workspaceId;
    if (status) filter.status = status;

    const [documents, total] = await Promise.all([
      DocumentModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      DocumentModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: documents,
      pagination: { page, limit, total },
    });
  } catch (error) {
    return next(error);
  }
}

export async function getDocument(req: Request, res: Response, next: NextFunction) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid document ID' });
  }

  try {
    const document = await DocumentModel.findOne({ _id: req.params.id, ownerId: req.user!.id });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    return res.status(200).json({ success: true, data: document });
  } catch (error) {
    return next(error);
  }
}

export async function deleteDocument(req: Request, res: Response, next: NextFunction) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid document ID' });
  }

  try {
    const document = await DocumentModel.findOneAndDelete({
      _id: req.params.id,
      ownerId: req.user!.id,
    });
    if (!document) {
      return res.status(404).json({ success: false, message: 'Document not found' });
    }

    await removeUpload(document.storageKey);
    return res.status(200).json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    return next(error);
  }
}
