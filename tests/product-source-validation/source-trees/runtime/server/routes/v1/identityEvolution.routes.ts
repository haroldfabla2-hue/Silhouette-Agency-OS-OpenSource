/**
 * Identity Evolution Routes — auditable identity/personality history
 * ===================================================================
 * Read-only surface over the versioned identity ledger
 * (services/identity/identityEvolution.ts). Makes the entity's personality
 * evolution visible: who changed what, when, why, and what it looked like before.
 *
 * Endpoints:
 *  - GET /v1/identity-evolution/:agentId/history                     → full audit trail (oldest first) + parked proposals
 *  - GET /v1/identity-evolution/:agentId/snapshot/:file/:version     → exact previous content
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const router = Router();

const VALID_FILES = ['IDENTITY', 'SOUL'] as const;
type SnapshotFile = typeof VALID_FILES[number];

router.get('/:agentId/history', async (req: Request, res: Response) => {
    try {
        const agentId = String(req.params.agentId || '');
        if (!/^[\w.-]+$/.test(agentId)) return res.status(400).json({ error: 'invalid agentId' });

        const { agentFileSystem } = await import('../../../services/agents/agentFileSystem');
        const { createIdentityEvolution } = await import('../../../services/identity/identityEvolution');
        const evolution = createIdentityEvolution({
            read: (id, file) => agentFileSystem.readFile(id, file),
            write: (id, file, content) => agentFileSystem.writeFile(id, file, content),
            getAgentDir: (id) => agentFileSystem.getAgentDir(id)
        });
        return res.json({
            agentId,
            history: evolution.getHistory(agentId),
            pending: evolution.getPendingAdjustments(agentId)
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/:agentId/snapshot/:file/:version', async (req: Request, res: Response) => {
    try {
        const agentId = String(req.params.agentId || '');
        const file = String(req.params.file || '').toUpperCase() as SnapshotFile;
        const version = Number(req.params.version);
        if (!/^[\w.-]+$/.test(agentId)) return res.status(400).json({ error: 'invalid agentId' });
        if (!VALID_FILES.includes(file)) return res.status(400).json({ error: `file must be one of ${VALID_FILES.join('|')}` });
        if (!Number.isInteger(version) || version < 1) return res.status(400).json({ error: 'version must be a positive integer' });

        const { agentFileSystem } = await import('../../../services/agents/agentFileSystem');
        const snapshotPath = path.join(agentFileSystem.getAgentDir(agentId), 'identity-history', `${file}.v${version}.md`);
        if (!fs.existsSync(snapshotPath)) return res.status(404).json({ error: 'snapshot not found' });
        return res.type('text/markdown').send(fs.readFileSync(snapshotPath, 'utf-8'));
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
