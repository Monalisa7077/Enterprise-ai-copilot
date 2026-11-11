import { Router } from 'express';
import authRoutes from './auth.js';
import conversationRoutes from './conversations.js';
import documentRoutes from './documents.js';
import healthRoutes from './health.js';
import questionRoutes from './questions.js';
import workspaceRoutes from './workspaces.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/conversations', conversationRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/documents', documentRoutes);
router.use('/questions', questionRoutes);
router.use('/', healthRoutes);

export default router;
