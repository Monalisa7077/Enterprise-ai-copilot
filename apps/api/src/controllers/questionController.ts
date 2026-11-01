import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import WorkspaceModel from '../models/Workspace.js';
import { AnswerGenerationError, generateGroundedAnswer } from '../services/answerGenerationService.js';
import { QuestionRetrievalError, retrieveQuestionChunks } from '../services/questionRetrievalService.js';
import { VectorStoreError } from '../services/qdrantVectorStore.js';

const createQuestionSchema = z.object({
  question: z.string().trim().min(1, 'Question is required'),
  workspaceId: z.string().refine(mongoose.isValidObjectId, 'Invalid workspace ID'),
  topK: z.number().int().min(1).max(100).optional(),
});

function respondWithServiceError(error: unknown, res: Response) {
  if (error instanceof QuestionRetrievalError) {
    const statusCode = error.code === 'INVALID_QUESTION' ? 400 : 502;
    return res.status(statusCode).json({ success: false, message: error.message });
  }

  if (error instanceof AnswerGenerationError) {
    const statusCode =
      error.code === 'INVALID_QUESTION'
        ? 400
        : error.code === 'REQUEST_TIMEOUT'
          ? 504
          : error.code === 'RATE_LIMITED' ||
              error.code === 'MISSING_CONFIGURATION' ||
              error.code === 'INVALID_CONFIGURATION'
            ? 503
            : 502;
    return res.status(statusCode).json({ success: false, message: error.message });
  }

  if (error instanceof VectorStoreError) {
    return res.status(503).json({ success: false, message: error.message });
  }

  return undefined;
}

export async function createAnswer(req: Request, res: Response, next: NextFunction) {
  const parsed = createQuestionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid question payload',
      errors: parsed.error.flatten(),
    });
  }

  const { question, workspaceId, topK } = parsed.data;

  try {
    const workspace = await WorkspaceModel.findOne({
      _id: workspaceId,
      ownerId: req.user!.id,
    });
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const chunks = await retrieveQuestionChunks(question, req.user!.id, workspaceId, topK);
    const result = await generateGroundedAnswer(question, chunks);

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const serviceErrorResponse = respondWithServiceError(error, res);
    if (serviceErrorResponse) {
      return serviceErrorResponse;
    }
    return next(error);
  }
}
