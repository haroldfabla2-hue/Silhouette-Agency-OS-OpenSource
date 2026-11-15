/**
 * [auth-connections] Operator connection routes. Mounted in server/app.ts
 * AFTER the global authMiddleware AND guarded here by requireCreator: only a
 * CREATOR principal (the master API token maps to role CREATOR; the first
 * setup user is CREATOR) may start/switch/close connections or run OAuth
 * connects. USER/ADMIN sessions get 403; anonymous gets 401 from the global
 * middleware. No account secret ever appears here: secretRef is a pointer
 * (env:/vault:/cli-home:), never the secret itself.
 */
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { AccountStore } from '../../services/auth/accountStore';
import { TokenFileStore } from '../../services/auth/tokenFileStore';
import { ConnectionManager, ConnectionError, type StartConnectionInput } from '../../services/auth/connectionManager';

/** Connection changes rewire provider credentials: CREATOR only. */
function requireCreator(req: import('express').Request, res: import('express').Response, next: () => void): void {
    const user = (req as any).user;
    if (!user || user.role !== 'CREATOR') {
        res.status(403).json({ ok: false, error: 'forbidden-role', required: 'CREATOR', actual: user?.role ?? 'anonymous' });
        return;
    }
    next();
}

export function createConnectionRouter(manager: ConnectionManager): Router {
    const router = Router();
    router.use(requireCreator);

    router.post('/', (req, res) => {
        const { providerId, accountId, label, method, secretRef } = (req.body ?? {}) as Partial<StartConnectionInput>;
        try {
            const account = manager.startConnection({
                providerId: providerId as string, accountId: accountId as string,
                label: label as string, method: method as StartConnectionInput['method'], secretRef: secretRef as string,
            });
            res.status(201).json({ ok: true, account });
        } catch (err) { handleError(err, res); }
    });

    router.get('/', (req, res) => {
        const providerId = typeof req.query.provider === 'string' ? req.query.provider : undefined;
        res.json({ ok: true, principal: (req as any).user?.id ?? null, accounts: manager.listConnections(providerId) });
    });

    router.post('/:providerId/:accountId/activate', (req, res) => {
        try {
            const account = manager.switchConnection(req.params.providerId, req.params.accountId);
            res.json({ ok: true, active: account });
        } catch (err) { handleError(err, res); }
    });

    router.delete('/:providerId/:accountId', (req, res) => {
        try {
            const { account, localTokenPurged } = manager.closeConnection(req.params.providerId, req.params.accountId);
            // localTokenPurged covers OUR encrypted copy only - NOT vendor-side revocation.
            res.json({ ok: true, closed: `${account.providerId}/${account.accountId}`, localTokenPurged });
        } catch (err) { handleError(err, res); }
    });

    // ── OAuth connect (operator-supplied client registration) ──────────────

    router.post('/oauth/start', async (req, res) => {
        const { providerId, accountId, label, method, config } = req.body ?? {};
        try {
            const pending = await manager.startOAuthConnect({ providerId, accountId, label, method, config }, (req as any).user.id);
            res.status(201).json({ ok: true, pending });
        } catch (err) { handleError(err, res); }
    });

    router.post('/oauth/:pendingId/complete', async (req, res) => {
        try {
            const account = await manager.completeOAuthConnect(req.params.pendingId, (req as any).user.id);
            res.json({ ok: true, account });
        } catch (err) { handleError(err, res); }
    });

    router.post('/oauth/:pendingId/cancel', (req, res) => {
        try {
            manager.cancelOAuthConnect(req.params.pendingId, (req as any).user.id);
            res.json({ ok: true, cancelled: req.params.pendingId });
        } catch (err) { handleError(err, res); }
    });

    return router;
}

function handleError(err: unknown, res: import('express').Response): void {
    if (err instanceof ConnectionError) {
        const status = err.code === 'not-found' ? 404 : err.code === 'duplicate' ? 409
            : err.code === 'forbidden-principal' ? 403
            : err.code === 'token-store-unavailable' ? 503 : 400;
        res.status(status).json({ ok: false, error: err.code, message: err.message });
    } else if (err instanceof Error && /OAuthCallbackError|DeviceFlowError/.test(err.name)) {
        res.status(400).json({ ok: false, error: 'oauth-flow', message: err.message });
    } else {
        res.status(500).json({ ok: false, error: 'internal', message: err instanceof Error ? err.message : 'unknown error' });
    }
}

/**
 * Production wiring: lazy singleton behind the routes. Account metadata DB
 * follows the sqliteAdapter convention: SILHOUETTE_ACCOUNTS_DB_PATH override,
 * default <repo>/db/provider-accounts.sqlite. Token custody activates only
 * when SILHOUETTE_TOKEN_KEY is configured (fail-closed otherwise); without it
 * OAuth connect routes answer 503 token-store-unavailable.
 */
let defaultRouter: Router | undefined;

export function connectionRoutes(): Router {
    if (!defaultRouter) {
        const dbPath = process.env.SILHOUETTE_ACCOUNTS_DB_PATH
            ? path.resolve(process.env.SILHOUETTE_ACCOUNTS_DB_PATH)
            : path.join(process.cwd(), 'db', 'provider-accounts.sqlite'); // matches services/database DB_DIR convention
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const tokens = TokenFileStore.isAvailable()
            ? new TokenFileStore(path.join(process.cwd(), 'db'))
            : undefined;
        defaultRouter = createConnectionRouter(new ConnectionManager(new AccountStore(dbPath), tokens));
    }
    return defaultRouter;
}
