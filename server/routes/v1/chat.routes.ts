import { ownedHttpHandler } from '../../runtime/ownedHttpIngress';
import { Router } from 'express';
import { chatController } from '../../controllers/chatController';
import { authMiddleware } from '../../middleware/authMiddleware';

const router = Router();

// Apply auth middleware to ALL chat routes
router.use(authMiddleware);

router.get('/sessions', ownedHttpHandler('chat:GET:/sessions',(req, res) => chatController.getSessions(req, res)));
router.post('/sessions', ownedHttpHandler('chat:POST:/sessions',(req, res) => chatController.createSession(req, res)));
router.get('/sessions/:sessionId', ownedHttpHandler('chat:GET:/sessions/:sessionId',(req, res) => chatController.getHistory(req, res)));
router.delete('/sessions/:sessionId', ownedHttpHandler('chat:DELETE:/sessions/:sessionId',(req, res) => chatController.deleteSession(req, res)));
router.post('/message', ownedHttpHandler('chat:POST:/message',(req, res) => chatController.sendMessage(req, res)));

// SSE Streaming endpoint for real-time chat
router.post('/stream', ownedHttpHandler('chat:POST:/stream',(req, res) => chatController.streamMessage(req, res)));

// Provider health status - shows which LLMs are available
router.get('/providers', ownedHttpHandler('chat:GET:/providers',(req, res) => chatController.getProviderStatus(req, res)));

export default router;

export {getChatFactLifecycleStatus,shutdownChatFactsAfterHttpDrain} from '../../controllers/chatController';

export {prepareChatCodebaseAwareness,shutdownChatCodebaseAfterConsumers,getChatCodebaseLifecycleStatus} from '../../controllers/chatController';
