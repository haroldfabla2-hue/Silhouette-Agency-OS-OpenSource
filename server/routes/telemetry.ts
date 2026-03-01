import { Router } from 'express';
import { continuum } from '../../services/continuumMemory';
import { sessionManager } from '../../server/gateway/sessionManager';
import { redisClient } from '../../services/redisClient';
import { thoughtNarrator } from '../../services/cognitive/thoughtNarrator';

const router = Router();

/**
 * GET /api/v1/telemetry/brain
 * 
 * Exposes the internal state of the Cognitive Daemon and Silhouette OS.
 * Used for production observability, ensuring the 4-Tier Memory system is healthy.
 */
router.get('/brain', async (req, res) => {
    try {
        const memoryStats = await continuum.getStats();
        const sessionStats = sessionManager.getStats();

        const latestNarrative = await thoughtNarrator.generateNarrative(); // Forces a stream thought if none recently

        // Return a unified view of the OS's cognitive health
        res.json({
            status: "ok",
            uptime_seconds: process.uptime(),
            cognitive_state: {
                working_memory_items: memoryStats.workingMemoryItems,
                latest_narrative: latestNarrative,
            },
            memory_health: {
                redis_connected: !redisClient.isMockMode(),
            },
            sessions: sessionStats
        });
    } catch (e: any) {
        console.error('[TELEMETRY] Failed to fetch brain stats:', e.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export const telemetryRouter = router;
