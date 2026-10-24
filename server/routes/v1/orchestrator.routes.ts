
import { Router } from 'express';
import { orchestratorController } from '../../controllers/orchestratorController';
// We need a middleware for auth. For now, we'll assume it's passed or imported.
// In a full refactor, we'd export the middleware from a shared location.

const router = Router();

// Route: /v1/orchestrator/state
router.get('/state', (req, res) => orchestratorController.getState(req, res));

// Route: /v1/orchestrator/category
router.post('/category', (req, res) => orchestratorController.toggleCategory(req, res));

// Route: /v1/orchestrator/reassign
router.post('/reassign', (req, res) => orchestratorController.reassignAgent(req, res));

// Route: /v1/squads (Technically orchestrator related, keeping cohesive)
router.get('/squads', (req, res) => orchestratorController.getSquads(req, res));

// Route: /v1/agents
router.get('/agents', (req, res) => orchestratorController.getAgents(req, res));

// [LEDGER-INTEGRITY] Explicit, attributed reconciliation for durable
// abandoned-step uncertainty (writer gone, partial effects uncertain).
// The retry gate blocks new plans until this attestation exists.
// AuthN/Z is inherited from the existing authMiddleware (all /v1 routes);
// attribution comes from the authenticated principal (session user or the
// master-token identity), role CREATOR - never from the request body.
router.post('/tasks/reconcile-abandoned', async (req, res) => {
    try {
        const { reconcileAbandonedStepEffects, reconcileAttributionFor } = await import('../../../services/execution/taskLedger');
        const attributedTo = reconcileAttributionFor((req as any).user);
        const { planId, stepOrder, note, attemptId, legacy, eventId, digest, decision } = req.body ?? {};
        if ((attemptId !== undefined && typeof attemptId !== 'string') || (legacy !== undefined && typeof legacy !== 'boolean') || (eventId !== undefined && typeof eventId !== 'string') || (digest !== undefined && typeof digest !== 'string')) return res.status(400).json({ ok: false, error: 'Invalid evidence selector' });
        const row = reconcileAbandonedStepEffects(String(planId ?? ''), Number(stepOrder), attributedTo, String(note ?? ''), { attemptId, legacy, eventId, digest, decision });
        res.json({ ok: true, task: row });
    } catch (e: any) {
        res.status(e?.statusCode ?? 500).json({ ok: false, error: e?.message, ...(e?.statusCode === 409 && e?.candidates ? { candidates: e.candidates } : {}) });
    }
});

// PA-038: Route: /v1/orchestrator/evolve/:agentId
router.post('/evolve/:agentId', (req, res) => orchestratorController.evolveAgent(req, res));

// PA-039: Route: /v1/orchestrator/evolution-history
router.get('/evolution-history', (req, res) => orchestratorController.getEvolutionHistory(req, res));
router.get('/evolution-history/:agentId', (req, res) => orchestratorController.getEvolutionHistory(req, res));

export default router;
