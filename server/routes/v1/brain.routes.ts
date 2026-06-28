/**
 * Brain Routes — External silhouette-brain 4-Tier memory integration
 * ===================================================================
 * Thin authenticated proxy/health surface over the external `silhouette-brain`
 * HTTP service (https://github.com/haroldfabla2-hue/silhouette-brain).
 *
 * Endpoints:
 *  - GET  /v1/brain/status              → integration + remote service status
 *  - GET  /v1/brain/context?query=...   → unified reasoning context (read)
 *  - GET  /v1/brain/semantic?query=...  → vector semantic search
 *  - GET  /v1/brain/entities            → tracked entities
 *  - GET  /v1/brain/graph?entity=...    → Neo4j relationship graph
 *  - POST /v1/brain/memory              → store a memory into the Brain
 *  - POST /v1/brain/feedback            → record source-ranking feedback
 */

import { Router, Request, Response } from 'express';
import { brainClient } from '../../../services/brain';

const router = Router();

router.get('/status', async (_req: Request, res: Response) => {
    try {
        if (!brainClient.isEnabled()) {
            return res.json({ enabled: false, available: false, baseUrl: brainClient.getBaseUrl() });
        }
        const status = await brainClient.getStatus();
        return res.json({
            enabled: true,
            available: Boolean(status && status.status === 'ok'),
            baseUrl: brainClient.getBaseUrl(),
            remote: status,
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/context', async (req: Request, res: Response) => {
    const query = (req.query.query || req.query.q) as string | undefined;
    if (!query) return res.status(400).json({ error: "Missing 'query' parameter" });
    if (!brainClient.isEnabled()) return res.status(503).json({ error: 'Brain integration disabled' });
    try {
        const ctx = await brainClient.getReasoningContext(query, {
            synthesize: req.query.synthesize === 'true',
            includeGraph: req.query.graph === 'true',
            includeTiers: req.query.tiers === 'true',
        });
        if (!ctx) return res.status(502).json({ error: 'Brain unavailable' });
        return res.json(ctx);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/semantic', async (req: Request, res: Response) => {
    const query = (req.query.query || req.query.q) as string | undefined;
    if (!query) return res.status(400).json({ error: "Missing 'query' parameter" });
    if (!brainClient.isEnabled()) return res.status(503).json({ error: 'Brain integration disabled' });
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
        const minScore = req.query.min_score ? parseFloat(req.query.min_score as string) : 0;
        const results = await brainClient.semanticSearch(query, limit, minScore);
        return res.json({ query, results, count: results.length });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/entities', async (req: Request, res: Response) => {
    if (!brainClient.isEnabled()) return res.status(503).json({ error: 'Brain integration disabled' });
    try {
        const type = req.query.type as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
        const entities = await brainClient.getEntities(type, limit);
        return res.json({ entities, count: entities.length });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/graph', async (req: Request, res: Response) => {
    if (!brainClient.isEnabled()) return res.status(503).json({ error: 'Brain integration disabled' });
    try {
        const entity = req.query.entity as string | undefined;
        const result = await brainClient.getGraph(entity);
        return res.json(result);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

router.post('/memory', async (req: Request, res: Response) => {
    if (!brainClient.isEnabled()) return res.status(503).json({ error: 'Brain integration disabled' });
    const { text, importance, tags, tier } = req.body || {};
    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: "Missing 'text' field" });
    }
    try {
        const result = await brainClient.addMemory(text, { importance, tags, tier });
        if (!result) return res.status(502).json({ error: 'Brain unavailable' });
        return res.json(result);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

router.post('/feedback', async (req: Request, res: Response) => {
    if (!brainClient.isEnabled()) return res.status(503).json({ error: 'Brain integration disabled' });
    const { sources, outcome, reason } = req.body || {};
    if (!Array.isArray(sources) || !outcome) {
        return res.status(400).json({ error: "Missing 'sources' (array) or 'outcome'" });
    }
    try {
        const ok = await brainClient.recordFeedback(sources, outcome, reason || '');
        return res.json({ ok });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
