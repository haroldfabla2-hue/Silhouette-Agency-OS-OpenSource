import { Router } from 'express';
import { chatController } from '../../controllers/chatController';

const router = Router();

router.get('/sessions', (req, res) => chatController.getSessions(req, res));
router.post('/sessions', (req, res) => chatController.createSession(req, res)); // [NEW]
router.get('/sessions/:sessionId', (req, res) => chatController.getHistory(req, res));
router.delete('/sessions/:sessionId', (req, res) => chatController.deleteSession(req, res)); // [NEW]
router.post('/message', (req, res) => chatController.sendMessage(req, res));

// SSE Streaming endpoint for real-time chat
router.post('/stream', (req, res) => chatController.streamMessage(req, res));

// Provider health status - shows which LLMs are available
router.get('/providers', (req, res) => chatController.getProviderStatus(req, res));

export default router;
