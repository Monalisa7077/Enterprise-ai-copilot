import { Router } from 'express';
import { createAnswer } from '../controllers/questionController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.post('/', createAnswer);

export default router;
