import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import ConversationModel from '../models/Conversation.js';

const ownerId = '507f1f77bcf86cd799439011';
const workspaceId = '507f191e810c19729de860ea';

describe('Conversation model', () => {
  it('stores an owner-scoped workspace, title, and ordered messages with source metadata', () => {
    const timestamp = new Date('2026-01-01T00:00:00.000Z');
    const conversation = new ConversationModel({
      ownerId,
      workspaceId,
      title: 'Retention policy',
      messages: [
        { role: 'user', content: 'How long are records kept?', timestamp },
        {
          role: 'assistant',
          content: 'Records are kept for seven years.',
          timestamp,
          sources: [
            {
              documentId: '507f191e810c19729de860eb',
              chunkIndex: 2,
              pageNumbers: [4, 5],
              score: 0.94,
            },
          ],
        },
      ],
    });

    expect(conversation.validateSync()).toBeUndefined();
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[1].sources?.[0]).toMatchObject({
      documentId: '507f191e810c19729de860eb',
      chunkIndex: 2,
      pageNumbers: [4, 5],
      score: 0.94,
    });
    expect(ConversationModel.schema.path('createdAt').instance).toBe('Date');
    expect(ConversationModel.schema.path('updatedAt').instance).toBe('Date');
  });

  it('applies the default title and empty messages', () => {
    const conversation = new ConversationModel({ ownerId, workspaceId });

    expect(conversation.title).toBe('New conversation');
    expect(conversation.messages).toHaveLength(0);
    expect(conversation.validateSync()).toBeUndefined();
  });

  it('rejects invalid roles and malformed source metadata', () => {
    const invalidRole = new ConversationModel({
      ownerId,
      workspaceId,
      messages: [{ role: 'system', content: 'Not allowed' }],
    });
    const invalidSource = new ConversationModel({
      ownerId,
      workspaceId,
      messages: [
        {
          role: 'assistant',
          content: 'Answer',
          sources: [{ documentId: 'doc', chunkIndex: -1, score: 2 }],
        },
      ],
    });

    expect(invalidRole.validateSync()?.errors['messages.0.role']).toBeDefined();
    expect(invalidSource.validateSync()).toBeDefined();
  });

  it('uses ObjectIds for ownership references', () => {
    const conversation = new ConversationModel({ ownerId, workspaceId });

    expect(conversation.ownerId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(conversation.workspaceId).toBeInstanceOf(mongoose.Types.ObjectId);
  });
});
