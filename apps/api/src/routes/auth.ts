import { Router } from 'express';
import { getCurrentUser, loginUser, logoutUser, refreshUserToken, registerUser } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/refresh', refreshUserToken);
router.post('/logout', logoutUser);
router.get('/me', requireAuth, getCurrentUser);

export default router;
