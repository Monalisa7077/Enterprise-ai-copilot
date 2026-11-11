import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnswer } from '../controllers/questionController.js';
import { QuestionRetrievalError } from '../services/questionRetrievalService.js';
import type { GeneratedAnswer } from '../services/answerGenerationService.js';
import type { VectorSearchResult } from '../services/qdrantVectorStore.js';

const mocks = vi.hoisted(() => ({
  findWorkspace: vi.fn(),
  findConversation: vi.fn(),
  updateConversation: vi.fn(),
  retrieveQuestionChunks: vi.fn(),
  generateGroundedAnswer: vi.fn(),
}));

vi.mock('../models/Workspace.js', () => ({
  default: { findOne: mocks.findWorkspace },
}));

vi.mock('../models/Conversation.js', () => ({
  default: {
    findOne: mocks.findConversation,
    findOneAndUpdate: mocks.updateConversation,
  },
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
    mocks.findConversation.mockResolvedValue({
      _id: '507f191e810c19729de860eb',
      title: 'New conversation',
      messages: [],
    });
    mocks.updateConversation.mockResolvedValue({ _id: '507f191e810c19729de860eb' });
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
    expect(mocks.findConversation).not.toHaveBeenCalled();
    expect(mocks.updateConversation).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: answer });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes an optional topK through to retrieval', async () => {
    await invokeQuestion({ question, workspaceId, topK: 8 });

    expect(mocks.retrieveQuestionChunks).toHaveBeenCalledWith(question, ownerId, workspaceId, 8);
  });

  it('saves user and assistant messages with source metadata for a conversation', async () => {
    const conversationId = '507f191e810c19729de860eb';
    const { response } = await invokeQuestion({ question, workspaceId, conversationId });

    expect(mocks.findConversation).toHaveBeenCalledWith({
      _id: conversationId,
      ownerId,
      workspaceId,
    });
    expect(mocks.updateConversation).toHaveBeenCalledWith(
      {
        _id: conversationId,
        ownerId,
        workspaceId,
        title: 'New conversation',
        messages: { $size: 0 },
      },
      {
        $push: {
          messages: {
            $each: [
              expect.objectContaining({ role: 'user', content: question }),
              expect.objectContaining({
                role: 'assistant',
                content: answer.answer,
                sources: answer.sources,
              }),
            ],
          },
        },
        $set: {
          updatedAt: expect.any(Date),
          title: 'What Are the Main Topics Covered in This Document',
        },
      },
      { new: true, runValidators: true },
    );
    expect(response.json).toHaveBeenCalledWith({ success: true, data: answer });
  });

  it('creates a concise title from the first question and preserves it on follow-up questions', async () => {
    const conversationId = '507f191e810c19729de860eb';
    await invokeQuestion({
      question: 'Give me all the JS questions',
      workspaceId,
      conversationId,
    });

    expect(mocks.updateConversation).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'New conversation', messages: { $size: 0 } }),
      expect.objectContaining({ $set: expect.objectContaining({ title: 'JavaScript Questions' }) }),
      expect.any(Object),
    );

    vi.clearAllMocks();
    mocks.findWorkspace.mockResolvedValue({ _id: workspaceId });
    mocks.findConversation.mockResolvedValue({
      _id: conversationId,
      title: 'JavaScript Questions',
      messages: [{ role: 'user', content: 'Give me all the JS questions' }],
    });
    mocks.updateConversation.mockResolvedValue({ _id: conversationId });
    mocks.retrieveQuestionChunks.mockResolvedValue(chunks);
    mocks.generateGroundedAnswer.mockResolvedValue(answer);

    await invokeQuestion({
      question: 'What about closures?',
      workspaceId,
      conversationId,
    });

    expect(mocks.updateConversation).toHaveBeenCalledWith(
      { _id: conversationId, ownerId, workspaceId },
      expect.objectContaining({
        $push: expect.any(Object),
        $set: expect.objectContaining({ updatedAt: expect.any(Date) }),
      }),
      { new: true, runValidators: true },
    );
    expect(mocks.updateConversation.mock.calls[0][1].$set).not.toHaveProperty('title');
  });

  it('generates different titles for separate conversations from their first questions', async () => {
    await invokeQuestion({
      question: 'Give me all the JS questions',
      workspaceId,
      conversationId: '507f191e810c19729de860eb',
    });
    await invokeQuestion({
      question: 'Give me all the questions about ExpressJS',
      workspaceId,
      conversationId: '507f191e810c19729de860ec',
    });

    expect(mocks.updateConversation.mock.calls.map(([, update]) => update.$set.title)).toEqual([
      'JavaScript Questions',
      'ExpressJS Questions',
    ]);
  });

  it('rejects invalid conversation IDs before retrieval', async () => {
    const { response } = await invokeQuestion({
      question,
      workspaceId,
      conversationId: 'invalid',
    });

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mocks.findConversation).not.toHaveBeenCalled();
    expect(mocks.retrieveQuestionChunks).not.toHaveBeenCalled();
  });

  it('rejects a conversation that is not owned by the user or does not match the workspace', async () => {
    mocks.findConversation.mockResolvedValueOnce(null);

    const { response } = await invokeQuestion({
      question,
      workspaceId,
      conversationId: '507f191e810c19729de860eb',
    });

    expect(mocks.findConversation).toHaveBeenCalledWith({
      _id: '507f191e810c19729de860eb',
      ownerId,
      workspaceId,
    });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      success: false,
      message: 'Conversation not found',
    });
    expect(mocks.retrieveQuestionChunks).not.toHaveBeenCalled();
  });

  it('does not save a question when answer generation fails', async () => {
    mocks.generateGroundedAnswer.mockRejectedValue(new Error('Generation failed'));

    const { next } = await invokeQuestion({
      question,
      workspaceId,
      conversationId: '507f191e810c19729de860eb',
    });

    expect(mocks.updateConversation).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
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
