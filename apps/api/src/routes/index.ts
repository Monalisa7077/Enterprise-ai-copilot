import { Router } from 'express';
import authRoutes from './auth.js';
import documentRoutes from './documents.js';
import healthRoutes from './health.js';
import workspaceRoutes from './workspaces.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/workspaces', workspaceRoutes);
router.use('/documents', documentRoutes);
router.use('/', healthRoutes);

export default router;
