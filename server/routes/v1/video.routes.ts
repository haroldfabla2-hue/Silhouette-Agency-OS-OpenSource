import { ownedHttpHandler, awaitHttpMiddleware } from '../../runtime/ownedHttpIngress';
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { videoStudioService } from '../../../services/videoStudioService';

const router = Router();
router.use(authMiddleware);

/** Fase 1 Video Studio: idea -> brief validado, gate AWAITING_SCRIPT_OK. */
router.post('/brief', ownedHttpHandler('video:POST:/brief',async (req, res) => {
    try {
        const { idea } = req.body || {};
        if (!idea || typeof idea !== 'string') {
            return res.status(400).json({ error: 'idea (string) is required' });
        }
        const row = await videoStudioService.generateBriefFromIdea(idea);
        return res.status(row.status === 'FAILED' ? 422 : 200).json(row);
    } catch (e: any) {
        console.error('[VIDEO] brief generation failed:', e);
        return res.status(500).json({ error: e.message });
    }
}));

router.get('/brief', ownedHttpHandler('video:GET:/brief',(_req, res) => {
    return res.json(videoStudioService.listBriefs());
}));

router.get('/brief/:id', ownedHttpHandler('video:GET:/brief/:id',(req, res) => {
    const row = videoStudioService.getBrief(req.params.id);
    if (!row) return res.status(404).json({ error: 'brief not found' });
    return res.json(row);
}));

router.post('/brief/:id/approve', ownedHttpHandler('video:POST:/brief/:id/approve',(req, res) => {
    try {
        return res.json(videoStudioService.approve(req.params.id));
    } catch (e: any) {
        return res.status(409).json({ error: e.message });
    }
}));

router.post('/brief/:id/reject', ownedHttpHandler('video:POST:/brief/:id/reject',(req, res) => {
    try {
        return res.json(videoStudioService.reject(req.params.id));
    } catch (e: any) {
        return res.status(409).json({ error: e.message });
    }
}));

export default router;
