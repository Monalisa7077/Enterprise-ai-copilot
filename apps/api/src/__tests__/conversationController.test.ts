import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
} from '../controllers/conversationController.js';

const mocks = vi.hoisted(() => ({
  findWorkspace: vi.fn(),
  createConversation: vi.fn(),
  findConversations: vi.fn(),
  countConversations: vi.fn(),
  findConversation: vi.fn(),
  removeConversation: vi.fn(),
}));

vi.mock('../models/Workspace.js', () => ({
  default: { findOne: mocks.findWorkspace },
}));

vi.mock('../models/Conversation.js', () => ({
  default: {
    create: mocks.createConversation,
    find: mocks.findConversations,
    countDocuments: mocks.countConversations,
    findOne: mocks.findConversation,
    findOneAndDelete: mocks.removeConversation,
  },
}));

const ownerId = '507f1f77bcf86cd799439011';
const otherUserId = '507f1f77bcf86cd799439012';
const workspaceId = '507f191e810c19729de860ea';
const conversationId = '507f191e810c19729de860eb';
const conversation = {
  _id: conversationId,
  ownerId,
  workspaceId,
  title: 'ExpressJS Questions',
  messages: [],
};

function makeRequest(options: {
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
  userId?: string;
} = {}): Request {
  return {
    user: {
      id: options.userId ?? ownerId,
      email: 'owner@example.com',
      role: 'USER',
    },
    body: options.body ?? {},
    params: options.params ?? {},
    query: options.query ?? {},
  } as unknown as Request;
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

async function invoke(
  controller: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
  request: Request,
) {
  const response = makeResponse();
  const next = vi.fn() as unknown as NextFunction;
  await controller(request, response, next);
  return { response, next };
}

describe('conversation controllers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWorkspace.mockResolvedValue({ _id: workspaceId });
    mocks.createConversation.mockResolvedValue(conversation);
    mocks.findConversations.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([conversation]),
        }),
      }),
    });
    mocks.countConversations.mockResolvedValue(1);
    mocks.findConversation.mockResolvedValue(conversation);
    mocks.removeConversation.mockResolvedValue(conversation);
  });

  it('creates a conversation using the authenticated owner and an owned workspace', async () => {
    const { response, next } = await invoke(
      createConversation,
      makeRequest({
        body: { workspaceId, title: 'Policy', ownerId: otherUserId },
      }),
    );

    expect(mocks.findWorkspace).toHaveBeenCalledWith({ _id: workspaceId, ownerId });
    expect(mocks.createConversation).toHaveBeenCalledWith({
      ownerId,
      workspaceId,
      title: 'Policy',
      messages: [],
    });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: conversation });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid workspace IDs and workspaces owned by someone else', async () => {
    const invalid = await invoke(createConversation, makeRequest({ body: { workspaceId: 'bad' } }));
    expect(invalid.response.status).toHaveBeenCalledWith(400);
    expect(mocks.findWorkspace).not.toHaveBeenCalled();

    mocks.findWorkspace.mockResolvedValueOnce(null);
    const foreign = await invoke(createConversation, makeRequest({ body: { workspaceId } }));
    expect(mocks.findWorkspace).toHaveBeenCalledWith({ _id: workspaceId, ownerId });
    expect(foreign.response.status).toHaveBeenCalledWith(404);
    expect(mocks.createConversation).not.toHaveBeenCalled();
  });

  it('lists only the authenticated owner’s conversations in the requested workspace', async () => {
    const { response } = await invoke(
      listConversations,
      makeRequest({ query: { workspaceId, ownerId: otherUserId } }),
    );

    expect(mocks.findWorkspace).toHaveBeenCalledWith({ _id: workspaceId, ownerId });
    expect(mocks.findConversations).toHaveBeenCalledWith({ ownerId, workspaceId });
    expect(mocks.countConversations).toHaveBeenCalledWith({ ownerId, workspaceId });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: [conversation],
      pagination: { page: 1, limit: 20, total: 1 },
    });
  });

  it('rejects invalid or foreign workspaces when listing', async () => {
    const invalid = await invoke(listConversations, makeRequest({ query: { workspaceId: 'bad' } }));
    expect(invalid.response.status).toHaveBeenCalledWith(400);

    mocks.findWorkspace.mockResolvedValueOnce(null);
    const foreign = await invoke(listConversations, makeRequest({ query: { workspaceId } }));
    expect(foreign.response.status).toHaveBeenCalledWith(404);
    expect(mocks.findConversations).not.toHaveBeenCalled();
  });

  it('retrieves a conversation scoped to the authenticated user', async () => {
    const { response } = await invoke(getConversation, makeRequest({ params: { id: conversationId } }));

    expect(mocks.findConversation).toHaveBeenCalledWith({ _id: conversationId, ownerId });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: conversation });
  });

  it('does not reveal a conversation owned by another user', async () => {
    mocks.findConversation.mockResolvedValueOnce(null);
    const { response } = await invoke(
      getConversation,
      makeRequest({ params: { id: conversationId }, userId: otherUserId }),
    );

    expect(mocks.findConversation).toHaveBeenCalledWith({ _id: conversationId, ownerId: otherUserId });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ success: false, message: 'Conversation not found' });
  });

  it('rejects invalid conversation IDs when retrieving or deleting', async () => {
    const retrieved = await invoke(getConversation, makeRequest({ params: { id: 'bad' } }));
    const deleted = await invoke(deleteConversation, makeRequest({ params: { id: 'bad' } }));

    expect(retrieved.response.status).toHaveBeenCalledWith(400);
    expect(deleted.response.status).toHaveBeenCalledWith(400);
    expect(mocks.findConversation).not.toHaveBeenCalled();
    expect(mocks.removeConversation).not.toHaveBeenCalled();
  });

  it('deletes only the authenticated user’s conversation', async () => {
    const { response } = await invoke(
      deleteConversation,
      makeRequest({ params: { id: conversationId } }),
    );

    expect(mocks.removeConversation).toHaveBeenCalledWith({ _id: conversationId, ownerId });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      message: 'Conversation deleted successfully',
    });
  });

  it('returns not found when deleting a conversation owned by another user', async () => {
    mocks.removeConversation.mockResolvedValueOnce(null);
    const { response } = await invoke(
      deleteConversation,
      makeRequest({ params: { id: conversationId }, userId: otherUserId }),
    );

    expect(mocks.removeConversation).toHaveBeenCalledWith({ _id: conversationId, ownerId: otherUserId });
    expect(response.status).toHaveBeenCalledWith(404);
  });
});
