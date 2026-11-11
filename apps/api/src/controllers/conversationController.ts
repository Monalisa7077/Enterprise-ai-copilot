import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import ConversationModel from '../models/Conversation.js';
import WorkspaceModel from '../models/Workspace.js';

const createConversationSchema = z.object({
  workspaceId: z.string().refine(mongoose.isValidObjectId, 'Invalid workspace ID'),
  title: z.string().trim().min(1).max(200).optional(),
});

const listConversationsSchema = z.object({
  workspaceId: z.string().refine(mongoose.isValidObjectId, 'Invalid workspace ID'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function createConversation(req: Request, res: Response, next: NextFunction) {
  const parsed = createConversationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid conversation payload',
      errors: parsed.error.flatten(),
    });
  }

  const ownerId = req.user!.id;
  const { workspaceId, title } = parsed.data;

  try {
    const workspace = await WorkspaceModel.findOne({ _id: workspaceId, ownerId });
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const conversation = await ConversationModel.create({
      ownerId,
      workspaceId,
      title: title ?? 'New conversation',
      messages: [],
    });

    return res.status(201).json({ success: true, data: conversation });
  } catch (error) {
    return next(error);
  }
}

export async function listConversations(req: Request, res: Response, next: NextFunction) {
  const parsed = listConversationsSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid conversation filters',
      errors: parsed.error.flatten(),
    });
  }

  const { workspaceId, page, limit } = parsed.data;
  const ownerId = req.user!.id;
  const filter = { ownerId, workspaceId };

  try {
    const workspace = await WorkspaceModel.findOne({ _id: workspaceId, ownerId });
    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    const [conversations, total] = await Promise.all([
      ConversationModel.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      ConversationModel.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: conversations,
      pagination: { page, limit, total },
    });
  } catch (error) {
    return next(error);
  }
}

export async function getConversation(req: Request, res: Response, next: NextFunction) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
  }

  try {
    const conversation = await ConversationModel.findOne({
      _id: req.params.id,
      ownerId: req.user!.id,
    });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    return res.status(200).json({ success: true, data: conversation });
  } catch (error) {
    return next(error);
  }
}

export async function deleteConversation(req: Request, res: Response, next: NextFunction) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
  }

  try {
    const conversation = await ConversationModel.findOneAndDelete({
      _id: req.params.id,
      ownerId: req.user!.id,
    });
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    return res.status(200).json({ success: true, message: 'Conversation deleted successfully' });
  } catch (error) {
    return next(error);
  }
}
