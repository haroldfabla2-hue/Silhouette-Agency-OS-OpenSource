/**
 * Federated Memory Routes — P2P knowledge sharing between Silhouette instances.
 *
 *  - POST /v1/federated/sync    → receive a SyncPayload from a peer
 *  - GET  /v1/federated/peers   → list authorized peers
 *  - POST /v1/federated/peers   → authorize a peer { url, trustLevel }
 *  - POST /v1/federated/broadcast → push local DEEP memories to all peers
 *  - GET  /v1/federated/stats   → sync statistics
 *
 * Routes are behind the normal API auth. When FEDERATED_SYNC_TOKEN is set, the
 * inbound /sync endpoint additionally requires a matching X-Federated-Token
 * header (defense in depth for cross-instance pushes).
 */
import { Router, Request, Response } from 'express';
import { federatedMemory } from '../../../services/federatedMemory';

const router = Router();

router.post('/sync', async (req: Request, res: Response) => {
    const required = process.env.FEDERATED_SYNC_TOKEN;
    if (required && req.headers['x-federated-token'] !== required) {
        return res.status(403).json({ ok: false, reason: 'invalid federated token' });
    }
    try {
        const result = await federatedMemory.receiveSync(req.body);
        return res.status(result.ok ? 200 : 400).json(result);
    } catch (error: any) {
        return res.status(500).json({ ok: false, reason: error.message });
    }
});

router.get('/peers', (_req: Request, res: Response) => {
    return res.json({ peers: federatedMemory.getPeers(), instanceId: federatedMemory.getInstanceId() });
});

router.post('/peers', (req: Request, res: Response) => {
    const { url, trustLevel } = req.body || {};
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: "Missing 'url'" });
    }
    const peer = federatedMemory.authorizePeer(url, typeof trustLevel === 'number' ? trustLevel : 0.5);
    return res.json({ peer });
});

router.post('/broadcast', async (_req: Request, res: Response) => {
    await federatedMemory.initiateSwarmSync();
    return res.json({ ok: true, stats: federatedMemory.getStats() });
});

router.get('/stats', (_req: Request, res: Response) => {
    return res.json(federatedMemory.getStats());
});

export default router;
