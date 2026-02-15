
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

// PA-038: Route: /v1/orchestrator/evolve/:agentId
router.post('/evolve/:agentId', (req, res) => orchestratorController.evolveAgent(req, res));

// PA-039: Route: /v1/orchestrator/evolution-history
router.get('/evolution-history', (req, res) => orchestratorController.getEvolutionHistory(req, res));
router.get('/evolution-history/:agentId', (req, res) => orchestratorController.getEvolutionHistory(req, res));

export default router;
