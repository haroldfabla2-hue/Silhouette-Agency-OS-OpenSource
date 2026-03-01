/**
 * HEALTH CHECK ENDPOINT
 * 
 * Returns service status for Neo4j, Redis, Qdrant, and SQLite.
 * Mounted BEFORE auth middleware so Docker HEALTHCHECK can hit it without a token.
 */

import { Router, Request, Response } from 'express';

export const healthRouter = Router();

interface ServiceCheck {
    status: 'up' | 'down';
    latencyMs?: number;
    error?: string;
}

healthRouter.get('/', async (_req: Request, res: Response) => {
    const checks: Record<string, ServiceCheck> = {};
    let overallHealthy = true;

    // 1. Redis
    try {
        const start = Date.now();
        const { redisClient } = await import('../../services/redisClient');
        // Redis has no ping() — use a set/get roundtrip as liveness check
        await redisClient.set('health:check', 'ok', 10);
        const val = await redisClient.get('health:check');
        checks.redis = { status: val === 'ok' ? 'up' : 'down', latencyMs: Date.now() - start };
        if (val !== 'ok') overallHealthy = false;
    } catch (e: any) {
        checks.redis = { status: 'down', error: e.message };
        overallHealthy = false;
    }

    // 2. Neo4j (Graph)
    try {
        const start = Date.now();
        const { graph } = await import('../../services/graphService');
        await graph.runQuery('RETURN 1 AS ping');
        checks.neo4j = { status: 'up', latencyMs: Date.now() - start };
    } catch (e: any) {
        checks.neo4j = { status: 'down', error: e.message };
        overallHealthy = false;
    }

    // 3. Qdrant (Vector Memory)
    try {
        const start = Date.now();
        const { vectorMemory } = await import('../../services/vectorMemoryService');
        if (vectorMemory) {
            checks.qdrant = { status: 'up', latencyMs: Date.now() - start };
        } else {
            checks.qdrant = { status: 'down', error: 'Not initialized' };
            overallHealthy = false;
        }
    } catch (e: any) {
        checks.qdrant = { status: 'down', error: e.message };
        overallHealthy = false;
    }

    // 4. SQLite (Event Log)
    try {
        const start = Date.now();
        const { sqliteService } = await import('../../services/sqliteService');
        sqliteService.getLogs(1); // Quick read test
        checks.sqlite = { status: 'up', latencyMs: Date.now() - start };
    } catch (e: any) {
        checks.sqlite = { status: 'down', error: e.message };
        // SQLite failure is degraded, not down
    }

    // 5. Daemon Status
    try {
        const { unifiedDaemon } = await import('../../services/daemon/unifiedDaemon');
        checks.daemon = { status: unifiedDaemon ? 'up' : 'down' };
    } catch {
        checks.daemon = { status: 'down' };
    }

    const status = overallHealthy ? 'healthy' : 'degraded';
    const httpCode = overallHealthy ? 200 : 503;

    res.status(httpCode).json({
        status,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        services: checks
    });
});
