import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnswer } from '../controllers/questionController.js';
import { QuestionRetrievalError } from '../services/questionRetrievalService.js';
import type { GeneratedAnswer } from '../services/answerGenerationService.js';
import type { VectorSearchResult } from '../services/qdrantVectorStore.js';

const mocks = vi.hoisted(() => ({
  findWorkspace: vi.fn(),
  retrieveQuestionChunks: vi.fn(),
  generateGroundedAnswer: vi.fn(),
}));

vi.mock('../models/Workspace.js', () => ({
  default: { findOne: mocks.findWorkspace },
}));

vi.mock('../services/questionRetrievalService.js', () => ({
  QuestionRetrievalError: class QuestionRetrievalError extends Error {
    constructor(readonly code: 'INVALID_QUESTION' | 'INVALID_EMBEDDING') {
      super(
        code === 'INVALID_QUESTION'
          ? 'Question must be a non-empty string'
          : 'Embedding provider returned an invalid question vector',
      );
    }
  },
  retrieveQuestionChunks: mocks.retrieveQuestionChunks,
}));

vi.mock('../services/answerGenerationService.js', () => ({
  AnswerGenerationError: class AnswerGenerationError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  generateGroundedAnswer: mocks.generateGroundedAnswer,
}));

vi.mock('../services/qdrantVectorStore.js', () => ({
  VectorStoreError: class VectorStoreError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

const ownerId = '507f1f77bcf86cd799439011';
const workspaceId = '507f191e810c19729de860ea';
const question = 'What are the main topics covered in this document?';
const chunks: VectorSearchResult[] = [
  {
    text: 'The document covers security and data retention.',
    documentId: 'document-123',
    chunkIndex: 2,
    pageNumbers: [1],
    score: 0.94,
  },
];
const answer: GeneratedAnswer = {
  answer: 'The document covers security and data retention.',
  sources: [{ documentId: 'document-123', chunkIndex: 2, pageNumbers: [1], score: 0.94 }],
};

function makeRequest(body: unknown = { question, workspaceId }): Request {
  return {
    user: { id: ownerId, email: 'owner@example.com', role: 'USER' },
    body,
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

async function invokeQuestion(body?: unknown) {
  const response = makeResponse();
  const next = vi.fn() as unknown as NextFunction;
  await createAnswer(makeRequest(body), response, next);
  return { response, next };
}

describe('createAnswer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWorkspace.mockResolvedValue({ _id: workspaceId });
    mocks.retrieveQuestionChunks.mockResolvedValue(chunks);
    mocks.generateGroundedAnswer.mockResolvedValue(answer);
  });

  it('retrieves owner-scoped chunks, generates an answer, and returns source references', async () => {
    const { response, next } = await invokeQuestion({
      question,
      workspaceId,
      ownerId: 'attacker-controlled-owner-id',
    });

    expect(mocks.findWorkspace).toHaveBeenCalledWith({ _id: workspaceId, ownerId });
    expect(mocks.retrieveQuestionChunks).toHaveBeenCalledWith(question, ownerId, workspaceId, undefined);
    expect(mocks.generateGroundedAnswer).toHaveBeenCalledWith(question, chunks);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: answer });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes an optional topK through to retrieval', async () => {
    await invokeQuestion({ question, workspaceId, topK: 8 });

    expect(mocks.retrieveQuestionChunks).toHaveBeenCalledWith(question, ownerId, workspaceId, 8);
  });

  it.each([
    ['missing question', { workspaceId }],
    ['empty question', { question: ' \t ', workspaceId }],
  ])('rejects an %s', async (_name, body) => {
    const { response, next } = await invokeQuestion(body);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      message: 'Invalid question payload',
    }));
    expect(mocks.findWorkspace).not.toHaveBeenCalled();
    expect(mocks.retrieveQuestionChunks).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid workspace ID before querying workspace ownership', async () => {
    const { response, next } = await invokeQuestion({ question, workspaceId: 'invalid' });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mocks.findWorkspace).not.toHaveBeenCalled();
    expect(mocks.retrieveQuestionChunks).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['missing', 'owned by another user'])(
    'returns 404 if the workspace is %s',
    async () => {
      mocks.findWorkspace.mockResolvedValue(null);

      const { response, next } = await invokeQuestion();

      expect(mocks.findWorkspace).toHaveBeenCalledWith({ _id: workspaceId, ownerId });
      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledWith({ success: false, message: 'Workspace not found' });
      expect(mocks.retrieveQuestionChunks).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('returns a safe response for expected retrieval errors', async () => {
    mocks.retrieveQuestionChunks.mockRejectedValue(new QuestionRetrievalError('INVALID_EMBEDDING'));

    const { response, next } = await invokeQuestion();

    expect(response.status).toHaveBeenCalledWith(502);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: 'Embedding provider returned an invalid question vector',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes unexpected errors to next', async () => {
    const unexpectedError = new Error('Database unavailable');
    mocks.findWorkspace.mockRejectedValue(unexpectedError);

    const { next } = await invokeQuestion();

    expect(next).toHaveBeenCalledWith(unexpectedError);
  });
});
