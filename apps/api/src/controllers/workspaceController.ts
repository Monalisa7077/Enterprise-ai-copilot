import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import WorkspaceModel from '../models/Workspace.js';

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
});

export async function listWorkspaces(req: Request, res: Response, next: NextFunction) {
  try {
    const workspaces = await WorkspaceModel.find({ ownerId: req.user!.id }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: workspaces });
  } catch (error) {
    return next(error);
  }
}

export async function createWorkspace(req: Request, res: Response, next: NextFunction) {
  const parsed = createWorkspaceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid workspace payload',
      errors: parsed.error.flatten(),
    });
  }

  try {
    const workspace = await WorkspaceModel.create({
      ...parsed.data,
      ownerId: req.user!.id,
    });
    return res.status(201).json({ success: true, data: workspace });
  } catch (error) {
    return next(error);
  }
}

export async function getWorkspace(req: Request, res: Response, next: NextFunction) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid workspace ID' });
  }

  try {
    const workspace = await WorkspaceModel.findOne({
      _id: req.params.id,
      ownerId: req.user!.id,
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: 'Workspace not found' });
    }

    return res.status(200).json({ success: true, data: workspace });
  } catch (error) {
    return next(error);
  }
}
