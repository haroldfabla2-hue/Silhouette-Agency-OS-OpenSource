// =============================================================================
// DOCTOR ENDPOINT
// System diagnostics REST API endpoint.
// Implementation of comprehensive system health checks.
// =============================================================================

import { Router, Request, Response } from 'express';
import { getConfig, validateConfig } from '../config/configSchema';
import { skillRegistry } from '../../services/skills/skillRegistry';
import { securityManager } from '../../services/security/securityManager';

const doctorRouter = Router();

interface DiagnosticCheck {
    name: string;
    status: 'ok' | 'warning' | 'error';
    message: string;
    metadata?: Record<string, unknown>;
}

/**
 * GET /v1/system/doctor
 * Comprehensive system health check that goes beyond basic health.
 */
doctorRouter.get('/doctor', async (_req: Request, res: Response) => {
    const config = getConfig();
    const checks: DiagnosticCheck[] = [];
    const startTime = Date.now();

    // 1. Configuration Validation
    const configIssues = validateConfig(config);
    checks.push({
        name: 'Configuration',
        status: configIssues.length === 0 ? 'ok' : 'warning',
        message: configIssues.length === 0 ? 'Valid' : `${configIssues.length} issue(s)`,
        metadata: configIssues.length > 0 ? { issues: configIssues } : undefined,
    });

    // 2. LLM Providers
    const providers = Object.entries(config.llm.providers)
        .filter(([, v]) => v && ((v as any).apiKey || (v as any).baseUrl))
        .map(([k]) => k);
    checks.push({
        name: 'LLM Providers',
        status: providers.length > 0 ? 'ok' : 'error',
        message: providers.length > 0 ? `Active: ${providers.join(', ')}` : 'None configured',
        metadata: { count: providers.length, providers },
    });

    // 3. Memory: Neo4j
    try {
        if (config.memory.neo4j.uri) {
            // Just check if the driver config is present (actual ping is expensive)
            checks.push({
                name: 'Neo4j',
                status: 'ok',
                message: `Configured: ${config.memory.neo4j.uri}`,
            });
        } else {
            checks.push({ name: 'Neo4j', status: 'warning', message: 'Not configured' });
        }
    } catch {
        checks.push({ name: 'Neo4j', status: 'error', message: 'Connection failed' });
    }

    // 4. Memory: Redis
    try {
        const redisCheck = config.memory.redis.host ? 'ok' : 'warning';
        checks.push({
            name: 'Redis',
            status: redisCheck as any,
            message: `${config.memory.redis.host}:${config.memory.redis.port}`,
        });
    } catch {
        checks.push({ name: 'Redis', status: 'error', message: 'Connection failed' });
    }

    // 5. Skills
    const skillStats = skillRegistry.getStats();
    checks.push({
        name: 'Skills',
        status: skillStats.total > 0 ? 'ok' : 'warning',
        message: `${skillStats.total} loaded (${skillStats.bundled}B/${skillStats.managed}M/${skillStats.workspace}W)`,
        metadata: skillStats,
    });

    // 6. Security
    const secStats = securityManager.getStats();
    checks.push({
        name: 'Security',
        status: secStats.requireApproval ? 'ok' : 'warning',
        message: secStats.requireApproval ? 'Approval required for dangerous tools' : 'WARNING: No approval required',
        metadata: secStats,
    });

    // 7. Channels
    try {
        const { channelRouter } = await import('../channels/channelRouter');
        const channels = channelRouter.getStatus();
        const connected = channels.filter(c => c.connected);
        checks.push({
            name: 'Channels',
            status: channels.length > 0 ? (connected.length === channels.length ? 'ok' : 'warning') : 'warning',
            message: channels.length > 0
                ? `${connected.length}/${channels.length} connected`
                : 'No channels configured',
            metadata: { channels: channels.map(c => ({ name: c.channel, connected: c.connected })) },
        });
    } catch {
        checks.push({ name: 'Channels', status: 'warning', message: 'Not initialized' });
    }

    // 8. WebSocket Gateway
    try {
        const { gateway } = await import('../gateway');
        const diagnostics = (gateway as any).runDoctor?.() ?? {};
        checks.push({
            name: 'WebSocket Gateway',
            status: diagnostics ? 'ok' : 'warning',
            message: 'Active',
            metadata: diagnostics,
        });
    } catch {
        checks.push({ name: 'WebSocket Gateway', status: 'warning', message: 'Not initialized' });
    }

    // 9. Disk space (uploads dir)
    const fs = await import('fs');
    const uploadsDir = config.media.uploadsDir;
    checks.push({
        name: 'Uploads Directory',
        status: fs.existsSync(uploadsDir) ? 'ok' : 'warning',
        message: fs.existsSync(uploadsDir) ? `Exists: ${uploadsDir}` : `Missing: ${uploadsDir}`,
    });

    // 10. Process Health
    const mem = process.memoryUsage();
    checks.push({
        name: 'Process',
        status: 'ok',
        message: `RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB, Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB`,
        metadata: {
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            uptime: process.uptime(),
            pid: process.pid,
            nodeVersion: process.version,
        },
    });

    const elapsed = Date.now() - startTime;
    const hasErrors = checks.some(c => c.status === 'error');
    const hasWarnings = checks.some(c => c.status === 'warning');

    res.json({
        overall: hasErrors ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy',
        timestamp: new Date().toISOString(),
        diagnosticMs: elapsed,
        checks,
        system: {
            name: config.system.name,
            version: config.system.version,
            env: config.system.env,
        },
    });
});

export default doctorRouter;
