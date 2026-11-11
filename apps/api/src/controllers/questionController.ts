import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import ConversationModel from '../models/Conversation.js';
import WorkspaceModel from '../models/Workspace.js';
import { AnswerGenerationError, generateGroundedAnswer } from '../services/answerGenerationService.js';
import { QuestionRetrievalError, retrieveQuestionChunks } from '../services/questionRetrievalService.js';
import { VectorStoreError } from '../services/qdrantVectorStore.js';

const defaultConversationTitle = 'New conversation';

const createQuestionSchema = z.object({
  question: z.string().trim().min(1, 'Question is required'),
  workspaceId: z.string().refine(mongoose.isValidObjectId, 'Invalid workspace ID'),
  conversationId: z.string().refine(mongoose.isValidObjectId, 'Invalid conversation ID').optional(),
  topK: z.number().int().min(1).max(100).optional(),
});

function createConversationTitle(question: string): string {
  let title = question.normalize('NFKC').replace(/\s+/g, ' ').trim();
  title = title.replace(/^[\s"'`]+|[\s"'`?!.,;:]+$/g, '');

  const commandPrefix =
    /^(?:(?:please\s+)?(?:can|could|would)\s+you\s+)?(?:please\s+)?(?:give me|show me|tell me|list|provide|find|explain|summarize|describe|help me)\s+(?:(?:all|some)\s+)?(?:of\s+)?(?:the\s+)?/i;
  title = title.replace(commandPrefix, '').trim();
  title = title.replace(/^questions?\s+(?:about|on|regarding|concerning)\s+(.+)$/i, '$1 questions');
  title = title.replace(/\bJS\b/gi, 'JavaScript');

  const normalizedTitle = title || question.trim();
  const minorWords = new Set([
    'a',
    'an',
    'and',
    'as',
    'at',
    'but',
    'by',
    'for',
    'in',
    'nor',
    'of',
    'on',
    'or',
    'the',
    'to',
    'up',
    'with',
  ]);
  const titleCased = normalizedTitle
    .split(' ')
    .map((word, index) => {
      if (index > 0 && minorWords.has(word.toLowerCase())) {
        return word.toLowerCase();
      }
      if (/^[A-Z\d]+$/.test(word) || /[a-z][A-Z]/.test(word)) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  if (titleCased.length <= 60) {
    return titleCased;
  }

  const shortened = titleCased.slice(0, 57).replace(/\s+\S*$/, '').trim();
  return `${shortened || titleCased.slice(0, 57)}...`;
}

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

  const { question, workspaceId, conversationId, topK } = parsed.data;
  const ownerId = req.user!.id;

  try {
    const workspace = await WorkspaceModel.findOne({
      _id: workspaceId,
      ownerId,
    });
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    let isFirstQuestion = false;
    if (conversationId) {
      const conversation = await ConversationModel.findOne({
        _id: conversationId,
        ownerId,
        workspaceId,
      });
      if (!conversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
      }
      isFirstQuestion =
        conversation.messages.length === 0 &&
        (!conversation.title || conversation.title === defaultConversationTitle);
    }

    const chunks = await retrieveQuestionChunks(question, ownerId, workspaceId, topK);
    const result = await generateGroundedAnswer(question, chunks);

    if (conversationId) {
      const timestamp = new Date();
      const filter = { _id: conversationId, ownerId, workspaceId };
      const update = {
        $push: {
          messages: {
            $each: [
              { role: 'user', content: question, timestamp },
              {
                role: 'assistant',
                content: result.answer,
                timestamp,
                sources: result.sources,
              },
            ],
          },
        },
        $set: { updatedAt: timestamp },
      };
      const options = { new: true, runValidators: true };
      let savedConversation = isFirstQuestion
        ? await ConversationModel.findOneAndUpdate(
            { ...filter, title: defaultConversationTitle, messages: { $size: 0 } },
            {
              ...update,
              $set: {
                ...update.$set,
                title: createConversationTitle(question),
              },
            },
            options,
          )
        : null;

      if (!savedConversation) {
        savedConversation = await ConversationModel.findOneAndUpdate(filter, update, options);
      }
      if (!savedConversation) {
        return res.status(404).json({ success: false, message: 'Conversation not found' });
      }
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const serviceErrorResponse = respondWithServiceError(error, res);
    if (serviceErrorResponse) {
      return serviceErrorResponse;
    }
    return next(error);
  }
}
