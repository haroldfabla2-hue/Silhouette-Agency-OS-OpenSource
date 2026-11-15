import { performance } from 'node:perf_hooks';
import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { ApiKey } from '../../services/apiKeyService';

// Deliberately conservative limits for a zero-tool, category-list-only surface.
export const MCP_LIMITS = Object.freeze({ sessions: 32, perKey: 4,
    lifetimeMs: 15 * 60_000, idleMs: 5 * 60_000, sweepMs: 1000,
    bodyBytes: 64 * 1024, elements: 4096, depth: 64,
    pending: 8, responseMs: 30_000, outputBytes: 128 * 1024 });
interface Session {
    server: McpServer; transport: SSEServerTransport; keyId: string;
    principal: string; born: number; touched: number; busy: boolean;
    pending: Map<string | number, number>;
}
export class MCPWrapper {
    private readonly sessions = new Map<string, Session>();
    private sweep?: ReturnType<typeof setInterval>;
    private mounted = false;
    private stopped = false;

    public async initialize(): Promise<void> { /* No shared SDK server or tool registration. */ }
    private createServer(): McpServer {
        const server = new McpServer({ name: 'Silhouette Agency OS', version: '1.0.0' },
            { maxToolInputElements: MCP_LIMITS.elements, capabilities: { tools: {} } });
        // Zero external tools. Preserve only the existing category-list resource.
        server.resource('prompts', 'mcp://prompts', async uri => {
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            let categories: string[] = [];
            try {
                categories = (await fs.readdir(path.join(process.cwd(), 'universalprompts'), { withFileTypes: true }))
                    .filter(d => d.isDirectory()).map(d => d.name);
            } catch { /* Existing absent-directory behavior. */ }
            return { contents: [{ uri: uri.href, text: JSON.stringify({ available_categories: categories,
                description: 'Universal prompts from top AI models. Use mcp://prompts/{category} for specific prompts.' }, null, 2) }] };
        });
        return server;
    }
    private async drop(id: string): Promise<void> {
        const session = this.sessions.get(id);
        if (!session) return;
        this.sessions.delete(id); // Idempotent even when SDK close triggers response close.
        if (!this.sessions.size && this.sweep) { clearInterval(this.sweep); this.sweep = undefined; }
        try { await session.server.close(); } catch { await session.transport.close(); }
    }
    public async close(): Promise<void> {
        this.stopped = true;
        await Promise.all([...this.sessions.keys()].map(id => this.drop(id)));
    }
    private expired(session: Session): boolean {
        const now = performance.now();
        return sessionExpired(now, session.born, session.touched) ||
            [...session.pending.values()].some(at => now - at >= MCP_LIMITS.responseMs);
    }
    private startSweep(): void {
        if (this.sweep) return;
        this.sweep = setInterval(() => { void this.checkSessions(); }, MCP_LIMITS.sweepMs);
        this.sweep.unref();
    }
    private async checkSessions(): Promise<void> {
        try {
            const { apiKeyService } = await import('../../services/apiKeyService');
            for (const [id, session] of this.sessions) {
                const key = apiKeyService.readActiveKey(session.keyId);
                if (this.expired(session) || !key || !apiKeyService.hasPermission(key, 'tools:read')) await this.drop(id);
            }
        } catch { // A failed/corrupt store never leaves authenticated streams open.
            await Promise.all([...this.sessions.keys()].map(id => this.drop(id)));
        }
    }
    public mount(app: Application): void {
        if (this.mounted) throw new Error('MCP already mounted');
        this.mounted = true;
        const router = express.Router();
        const principal = (req: Request): string | null => {
            const id: unknown = (req as Request & { user?: { id?: unknown } }).user?.id;
            return typeof id === 'string' && id.length > 0 ? id : null;
        };
        // Mounted AFTER unchanged identity auth, BEFORE generic body parser/fallback.
        router.use(async (req: Request, res: Response, next: NextFunction) => {
            if (this.stopped) { res.status(503).json({ error: 'MCP shutting down' }); return; }
            const owner = principal(req);
            if (!owner) { res.status(401).json({ error: 'Authenticated identity required' }); return; }
            const explicit = req.headers['x-mcp-api-key'];
            const bearer = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '');
            const raw = explicit === undefined ? bearer?.[1] : (typeof explicit === 'string' ? explicit : undefined);
            if (!raw) { res.status(401).json({ error: 'Managed MCP API key required' }); return; }
            try {
                const { apiKeyService } = await import('../../services/apiKeyService');
                const validated = apiKeyService.validateMcpKey(raw); // Transactional usage write is intentional.
                const key = validated && apiKeyService.readActiveKey(validated.id);
                if (!key || key.keyHash !== validated?.keyHash) { res.status(403).json({ error: 'Invalid MCP key' }); return; }
                const permission = req.method === 'POST' ? 'tools:execute' : 'tools:read';
                if (!apiKeyService.hasPermission(key, permission) || !apiKeyService.hasPermission(key, 'tools:read')) {
                    res.status(403).json({ error: 'Missing MCP permission' }); return;
                }
                res.locals.mcpKey = key;
                next();
            } catch { res.status(503).json({ error: 'MCP key store unavailable' }); }
        });
        router.get('/sse', async (req, res) => {
            await this.checkSessions();
            const { apiKeyService } = await import('../../services/apiKeyService');
            const key = apiKeyService.readActiveKey((res.locals.mcpKey as ApiKey).id);
            if (!key || !apiKeyService.hasPermission(key, 'tools:read')) {
                res.status(403).json({ error: 'MCP key no longer authorized' }); return;
            }
            if (res.destroyed) return;
            // No async gap between admission count and reservation below.
            if (this.stopped || this.sessions.size >= MCP_LIMITS.sessions ||
                [...this.sessions.values()].filter(s => s.keyId === key.id).length >= MCP_LIMITS.perKey) {
                res.set('Retry-After', '60').status(503).json({ error: 'MCP session capacity reached' }); return;
            }
            const server = this.createServer();
            const transport = new SSEServerTransport('/mcp/messages', res);
            const id = transport.sessionId;
            this.sessions.set(id, { server, transport, keyId: key.id, principal: principal(req)!,
                born: performance.now(), touched: performance.now(), busy: false, pending: new Map() });
            const send = transport.send.bind(transport);
            transport.send = async message => {
                if (res.writableLength > MCP_LIMITS.outputBytes) {
                    await this.drop(id); throw new Error('MCP slow consumer');
                }
                await send(message);
                if ('id' in message && ('result' in message || 'error' in message)) {
                    this.sessions.get(id)?.pending.delete(message.id);
                }
            };
            res.once('close', () => { void this.drop(id); });
            this.startSweep();
            try { await server.connect(transport); }
            catch { await this.drop(id); if (!res.headersSent) res.status(503).json({ error: 'MCP connection failed' }); }
        });
        // Authorize session BEFORE reading any request body. Another key/identity
        // gets the same404 as an unknown ID. No latest-session fallback.
        router.post('/messages', (req, res, next) => {
            const id = req.query.sessionId;
            const session = typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? this.sessions.get(id) : undefined;
            if (!session || session.keyId !== (res.locals.mcpKey as ApiKey).id || session.principal !== principal(req) || this.expired(session)) {
                if (session && this.expired(session)) void this.drop(id as string);
                res.status(404).json({ error: 'MCP session not found' }); return;
            }
            if (session.busy) { res.status(503).json({ error: 'MCP message already in progress' }); return; }
            session.busy = true;
            const bodyDeadline = setTimeout(() => {
                if (!res.headersSent) res.status(408).json({ error: 'MCP body timed out' });
                req.destroy();
            }, 15_000);
            res.locals.mcpSession = session;
            const release = () => { session.busy = false; };
            const done = () => { clearTimeout(bodyDeadline); release(); };
            res.once('finish', done); res.once('close', done);
            next();
        }, express.json({ limit: MCP_LIMITS.bodyBytes, strict: true, inflate: false }), async (req, res) => {
            const session = res.locals.mcpSession as Session;
            if (!boundedMessage(req.body)) { res.status(400).json({ error: 'Single bounded JSON-RPC object required' }); return; }
            // Recheck key and stream after parsing, including revocation/expiry
            // while a slow body arrived. Do not trust admission-time metadata.
            try {
                const { apiKeyService } = await import('../../services/apiKeyService');
                const key = apiKeyService.readActiveKey(session.keyId);
                if (!key || !apiKeyService.hasPermission(key, 'tools:read') || !apiKeyService.hasPermission(key, 'tools:execute') ||
                    this.expired(session) || this.sessions.get(session.transport.sessionId) !== session) {
                    await this.drop(session.transport.sessionId); res.status(403).json({ error: 'MCP session no longer authorized' }); return;
                }
                const message = req.body as { method?: unknown; id?: unknown };
                const id = message.id;
                const tracked = typeof message.method === 'string' && (typeof id === 'string' || typeof id === 'number');
                if (tracked && (session.pending.has(id as string | number) || session.pending.size >= MCP_LIMITS.pending)) {
                    res.status(503).json({ error: 'MCP response capacity reached' }); return;
                }
                if (tracked) session.pending.set(id as string | number, performance.now());
                await session.transport.handlePostMessage(req, res, req.body);
                if (tracked && res.statusCode !== 202) session.pending.delete(id as string | number);
                if (res.statusCode === 202) session.touched = performance.now();
            } catch { await this.drop(session.transport.sessionId); if (!res.headersSent) res.status(503).json({ error: 'MCP message unavailable' }); }
        });
        router.use((_req, res) => { res.status(404).json({ error: 'MCP endpoint not found' }); });
        router.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
            const status = err.status === 400 || err.status === 413 || err.status === 415 ? err.status : 503;
            res.status(status).json({ error: status === 503 ? 'MCP unavailable' : 'Invalid MCP JSON body' });
        });
        app.use('/mcp', router);
    }
}
export function sessionExpired(now: number, born: number, touched: number): boolean {
    return now - born >= MCP_LIMITS.lifetimeMs || now - touched >= MCP_LIMITS.idleMs;
}
export function boundedMessage(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const stack: Array<[unknown, number]> = [[value, 0]];
    let count = 0;
    while (stack.length) {
        const [node, depth] = stack.pop()!;
        if (++count > MCP_LIMITS.elements || depth > MCP_LIMITS.depth) return false;
        if (node && typeof node === 'object') for (const child of Object.values(node)) stack.push([child, depth + 1]);
    }
    return true;
}
export const mcpWrapper = new MCPWrapper();
