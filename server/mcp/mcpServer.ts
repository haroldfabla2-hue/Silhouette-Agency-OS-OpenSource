import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Application, Request, Response } from 'express';
import { ResourceScope, type ScopeReport } from '../runtime/resourceScope';
import type { ApiKey } from '../../services/apiKeyService';

interface MCPSession {
    keyId: string;
    server: McpServer;
    transport: SSEServerTransport;
    scope: ResourceScope;
    release(): Promise<void>;
}

/** Each transport belongs to its own SDK server. No shared last-client pointer.
 * Tools remain unregistered, as on6b49. Internal SDK protocol work remains an
 * explicit UNVERIFIED boundary, not inferred drained from handlePostMessage. */
export class MCPWrapper {
    private readonly operations = new ResourceScope('mcp-wrapper');
    private initialized = false;
    private mountTask?: Promise<void>;
    private mountedApp?: Application;
    private readonly sessions = new Map<string, MCPSession>();
    private readonly sessionReports: ScopeReport[] = [];

    public initialize(): Promise<void> {
        return this.operations.run('mcp-prepare', async () => { this.initialized = true; });
    }
    public getLifecycleStatus() {
        return { initialized: this.initialized, sessions: this.sessions.size, failures: this.operations.getFailures(), diagnostics: this.operations.getDiagnostics(), sessionReports: [...this.sessionReports] };
    }
    public async shutdown() {
        const resources = await this.operations.close();
        return { resources, sessionReports: [...this.sessionReports] };
    }
    private configureServer(server: McpServer, scope: ResourceScope): void {
        // No tools or private webhook/toolset resources registered. Same prompts
        // resource surface as baseline; no widening of API-key permissions.
        server.resource('prompts', 'mcp://prompts', async uri => scope.run('mcp-prompts-read', async () => {
            const fs = await import('fs/promises');
            const path = await import('path');
            const promptsDir = path.join(process.cwd(), 'universalprompts');
            const categories: string[] = [];
            try {
                const dirs = await fs.readdir(promptsDir, { withFileTypes: true });
                for (const dir of dirs) if (dir.isDirectory()) categories.push(dir.name);
            } catch (error) {
                scope.recordDiagnostic('mcp-prompts-directory', error, 'DEGRADED_FALLBACK', 'UNAVAILABLE');
            }
            return { contents: [{ uri: uri.href, text: JSON.stringify({ available_categories: categories, description: 'Universal prompts from top AI models. Use mcp://prompts/{category} for specific prompts.' }, null, 2) }] };
        }));
    }
    private async openSession(keyId: string, res: Response): Promise<void> {
        this.operations.assertAccepting();
        const scope = new ResourceScope('mcp-session');
        let sessionId: string | undefined;
        const release = this.operations.own({ name: 'mcp-session', stopIntake: () => { void scope.close(); }, close: async () => {
            const report = await scope.close();
            this.sessionReports.push(report);
            if (sessionId) this.sessions.delete(sessionId);
            if (report.failures.length) throw new AggregateError(report.failures.map(f => f.error), 'MCP session cleanup failed');
            return { state: 'UNVERIFIED' as const, detail: 'Application callbacks drained and SSE response ended; internal SDK protocol continuations unverified' };
        } });
        try {
        const server = new McpServer({ name: 'Silhouette Agency OS', version: '1.0.0' });
        // Register actual SDK owner before any awaited setup/transport allocation.
        scope.own({ name: 'mcp-sdk-server', closeRank: 100, close: async () => {
            await server.close();
            return { state: 'UNVERIFIED' as const, detail: 'SDK close ends transport; hidden protocol request/notification continuations have no awaited drain contract' };
        } });
        const transport = new SSEServerTransport('/mcp/messages', res);
        let responseClosed = res.destroyed || res.writableFinished;
        let resolveResponse!: () => void;
        const responseDone = responseClosed ? Promise.resolve() : new Promise<void>(resolve => { resolveResponse = resolve; });
        const onResponseDone = () => {
            if (!responseClosed) { responseClosed = true; resolveResponse(); }
            void release();
        };
        res.once('close', onResponseDone);
        res.once('finish', onResponseDone);
        const onResponseError = (error: Error) => scope.recordFailure('mcp-sse-response', error);
        res.on('error', onResponseError);
        scope.own({ name: 'mcp-sse-response', closeRank: -100, close: async () => {
            if (!res.writableEnded && !res.destroyed) res.end();
            await responseDone;
            res.off('close', onResponseDone);
            res.off('finish', onResponseDone);
            res.off('error', onResponseError);
        } });
        sessionId = transport.sessionId;
        const session: MCPSession = { keyId, server, transport, scope, release };
        this.sessions.set(sessionId, session);
        // SDK owns transport callbacks after connect. Do not overwrite its close chain.
        server.server.onerror = error => scope.recordDiagnostic('mcp-sdk-protocol', error, 'OPERATION_REJECTED', 'UNVERIFIED');
            await scope.run('mcp-connect', async () => {
                this.configureServer(server, scope);
                await server.connect(transport);
            });
            if (!this.operations.accepting || !scope.accepting || responseClosed) await release();
        } catch (error) {
            scope.recordFailure('mcp-connect', error);
            await release();
            throw error;
        }
    }
    private async dispatchPost(session: MCPSession, req: Request, res: Response): Promise<void> {
        session.scope.assertAccepting();
        let finished = res.writableFinished || res.destroyed;
        let resolveDone!: () => void;
        const done = finished ? Promise.resolve() : new Promise<void>(resolve => { resolveDone = resolve; });
        let release: () => Promise<void> = async () => undefined;
        const onDone = () => {
            if (!finished) { finished = true; resolveDone(); }
            void release();
        };
        const onError = (error: Error) => session.scope.recordDiagnostic('mcp-post-http', error, 'OPERATION_REJECTED', 'UNAVAILABLE');
        req.on('error', onError);
        res.on('error', onError);
        res.once('finish', onDone);
        res.once('close', onDone);
        release = session.scope.own({
            name: 'mcp-post-http',
            stopIntake: () => { if (!req.complete && !req.destroyed) req.destroy(); },
            close: async () => {
                if (!res.writableEnded && !res.destroyed) res.end();
                await done;
                req.off('error', onError);
                res.off('error', onError);
                res.off('finish', onDone);
                res.off('close', onDone);
            },
        });
        try {
            // Includes actual body/dispatch promise only. SDK onmessage returns void.
            await session.scope.run('mcp-post-dispatch', () => session.transport.handlePostMessage(req, res, req.body));
        } catch (error) {
            if (!res.headersSent) res.status(503).json({ error: 'MCP message unavailable' });
            throw error;
        } finally { await release(); }
    }
    public mount(app: Application): Promise<void> {
        this.operations.assertWorkAccepted();
        if (this.mountedApp && this.mountedApp !== app) return Promise.reject(new Error('MCPWrapper already mounted on another application'));
        if (!this.mountTask) {
            this.mountedApp = app;
            this.mountTask = this.operations.run('mcp-mount', async () => {
                await this.initialize();
                const { apiKeyService } = await import('../../services/apiKeyService.ts');
                const authenticateMcp = (req: Request, res: Response, next: () => void) => {
                    if (!this.operations.accepting) { res.status(503).json({ error: 'MCP shutting down' }); return; }
                    const header = req.headers.authorization;
                    if (!header || !header.startsWith('Bearer ')) { res.status(401).json({ error: 'Authentication required. Use Bearer <api_key>' }); return; }
                    const key = apiKeyService.validateKey(header.substring(7));
                    if (!key) { res.status(403).json({ error: 'Invalid or expired API key' }); return; }
                    (req as Request & { apiKey: ApiKey }).apiKey = key;
                    next();
                };
                app.get('/mcp/sse', authenticateMcp, (req: Request, res: Response) => {
                    void this.operations.run('mcp-sse-open', async () => {
                        const key = (req as Request & { apiKey: ApiKey }).apiKey;
                        if (!apiKeyService.hasPermission(key, 'tools:read')) { res.status(403).json({ error: 'Missing permission: tools:read' }); return; }
                        await this.openSession(key.id, res);
                    }).catch(error => {
                        this.operations.recordDiagnostic('mcp-sse-open', error, 'OPERATION_REJECTED', 'UNAVAILABLE');
                        if (!res.headersSent) res.status(503).json({ error: 'MCP session unavailable' });
                        else if (!res.writableEnded) res.end();
                    });
                });
                app.post('/mcp/messages', authenticateMcp, (req: Request, res: Response) => {
                    void this.operations.run('mcp-post', async () => {
                        const key = (req as Request & { apiKey: ApiKey }).apiKey;
                        if (!apiKeyService.hasPermission(key, 'tools:execute')) { res.status(403).json({ error: 'Missing permission: tools:execute' }); return; }
                        const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
                        const session = this.sessions.get(sessionId);
                        if (!session || session.keyId !== key.id || !session.scope.accepting) { res.status(404).json({ error: 'MCP session unavailable' }); return; }
                        // HTTP body/dispatch receipt only, NOT SDK request completion.
                        await this.dispatchPost(session, req, res);
                    }).catch(error => {
                        this.operations.recordDiagnostic('mcp-post', error, 'OPERATION_REJECTED', 'UNAVAILABLE');
                        if (!res.headersSent) res.status(503).json({ error: 'MCP message unavailable' });
                        else if (!res.writableEnded) res.end();
                    });
                });
            });
        }
        return this.mountTask;
    }
}
export const mcpWrapper = new MCPWrapper();
