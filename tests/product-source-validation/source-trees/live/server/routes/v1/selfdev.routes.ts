/**
 * SELF-DEV CYCLE ROUTES — Wave 2, P0
 * ═══════════════════════════════════════════════════════════════
 * HTTP surface for the self-dev cycle service. Thin layer: all state
 * and guardrails live in services/selfdev/cycleService.ts.
 *
 *   POST /v1/self/dev/cycles            { issue, scope[], acceptance:{kind:'vitest',target} }
 *   GET  /v1/self/dev/cycles            list (compact)
 *   GET  /v1/self/dev/cycles/:id        full cycle (picks up publisher result)
 *   POST /v1/self/dev/cycles/:id/attempt   { ops? } — explicit ops or LLM planner
 *   POST /v1/self/dev/cycles/:id/execute   apply in clone + verify twice
 *   POST /v1/self/dev/cycles/:id/pr        { approvedBy } — operator-approved PR
 *   POST /v1/self/dev/cycles/:id/abandon   { reason? }
 *   GET  /v1/self/dev/cycles/:id/journal   cycle journal entries
 */

import { Router, Request, Response } from 'express';
import { selfDevCycleService } from '../../../services/selfdev/cycleService';

const router = Router();

function handle(res: Response, fn: () => unknown | Promise<unknown>) {
    Promise.resolve()
        .then(fn)
        .then(out => res.json({ success: true, cycle: out }))
        .catch(err => res.status(err.statusCode ?? 500).json({ success: false, error: err.message }));
}

router.post('/cycles', (req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.create(req.body ?? {})));

router.get('/cycles', (_req: Request, res: Response) => {
    res.json({ success: true, cycles: selfDevCycleService.list() });
});

router.get('/cycles/:id', (req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.refresh(req.params.id)));

router.post('/cycles/:id/attempt', (req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.attempt(req.params.id, req.body?.ops)));

router.post('/cycles/:id/execute', (req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.execute(req.params.id)));

router.post('/cycles/:id/pr', (req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.requestPR(req.params.id, req.body?.approvedBy)));

router.get('/metrics', (_req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.metrics()));

router.post('/cycles/:id/sync-outcome', (req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.syncOutcome(req.params.id)));

router.post('/cycles/:id/abandon', (req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.abandon(req.params.id, req.body?.reason)));

router.get('/cycles/:id/journal', (req: Request, res: Response) => handle(res, () =>
    selfDevCycleService.journalEntries(req.params.id)));

export default router;
