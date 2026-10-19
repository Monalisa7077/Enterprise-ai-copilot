import { Router } from 'express';
import { createWorkspace, getWorkspace, listWorkspaces } from '../controllers/workspaceController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/', listWorkspaces);
router.post('/', createWorkspace);
router.get('/:id', getWorkspace);

export default router;
