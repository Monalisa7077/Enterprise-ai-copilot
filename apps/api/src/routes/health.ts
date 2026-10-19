import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    service: 'enterprise-knowledge-copilot-api',
    timestamp: new Date().toISOString(),
  });
});

router.get('/ready', async (_req, res) => {
  try {
    res.status(200).json({ success: true, status: 'ready' });
  } catch (error) {
    res.status(503).json({ success: false, status: 'not-ready' });
  }
});

export default router;
