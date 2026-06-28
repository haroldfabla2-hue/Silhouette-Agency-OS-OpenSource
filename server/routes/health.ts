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

// Helper function to perform lightweight TCP socket checks
import net from 'net';

function checkPort(port: number, host: string = '127.0.0.1', timeout = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let status = false;

        socket.setTimeout(timeout);

        socket.once('connect', () => {
            status = true;
            socket.destroy();
        });

        socket.once('timeout', () => {
            socket.destroy();
        });

        socket.once('error', () => {
            socket.destroy();
        });

        socket.once('close', () => {
            resolve(status);
        });

        socket.connect(port, host);
    });
}

healthRouter.get('/diagnostics', async (_req: Request, res: Response) => {
    // Parse Redis details from env
    let redisHost = '127.0.0.1';
    let redisPort = 6379;

    if (process.env.REDIS_URL) {
        const redisMatch = process.env.REDIS_URL.match(/redis:\/\/(?:[^@\n]+@)?([^:/\n]+):(\d+)/);
        if (redisMatch) {
            redisHost = redisMatch[1];
            redisPort = parseInt(redisMatch[2]);
        }
    } else {
        redisHost = process.env.REDIS_HOST || '127.0.0.1';
        redisPort = parseInt(process.env.REDIS_PORT || '6499');
    }

    // Parse Neo4j details from env
    let neo4jHost = '127.0.0.1';
    let neo4jPort = 7687;

    if (process.env.NEO4J_URI) {
        const neo4jMatch = process.env.NEO4J_URI.match(/(?:bolt|neo4j|neo4j\+s):\/\/([^:/\n]+):(\d+)/);
        if (neo4jMatch) {
            neo4jHost = neo4jMatch[1];
            neo4jPort = parseInt(neo4jMatch[2]);
        }
    }

    const brainHost = '127.0.0.1';
    const brainPort = 9876;

    const [redisOpen, neo4jOpen, brainOpen] = await Promise.all([
        checkPort(redisPort, redisHost),
        checkPort(neo4jPort, neo4jHost),
        checkPort(brainPort, brainHost)
    ]);

    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            node: { status: 'up' },
            redis: { status: redisOpen ? 'up' : 'down', host: redisHost, port: redisPort },
            neo4j: { status: neo4jOpen ? 'up' : 'down', host: neo4jHost, port: neo4jPort },
            brain: { status: brainOpen ? 'up' : 'down', host: brainHost, port: brainPort }
        }
    });
});

