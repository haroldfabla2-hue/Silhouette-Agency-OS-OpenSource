/**
 * [auth-connections] Operator connection routes. Mounted in server/app.ts
 * AFTER the global authMiddleware, so every endpoint requires the operator
 * Bearer token - same convention as /v1/system and /v1/self/exec. No account
 * secret ever appears here: secretRef is a pointer (env:/file:/vault:), never
 * the secret itself, and nothing in these handlers reads or returns secrets.
 */
import { Router } from 'express';
import { ConnectionManager, ConnectionError, type StartConnectionInput } from '../../services/auth/connectionManager';

export function createConnectionRouter(manager: ConnectionManager): Router {
    const router = Router();

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
        res.json({ ok: true, accounts: manager.listConnections(providerId) });
    });

    router.post('/:providerId/:accountId/activate', (req, res) => {
        try {
            const account = manager.switchConnection(req.params.providerId, req.params.accountId);
            res.json({ ok: true, active: account });
        } catch (err) { handleError(err, res); }
    });

    router.delete('/:providerId/:accountId', (req, res) => {
        try {
            manager.closeConnection(req.params.providerId, req.params.accountId);
            res.json({ ok: true, closed: `${req.params.providerId}/${req.params.accountId}` });
        } catch (err) { handleError(err, res); }
    });

    return router;
}

function handleError(err: unknown, res: import('express').Response): void {
    if (err instanceof ConnectionError) {
        const status = err.code === 'not-found' ? 404 : err.code === 'duplicate' ? 409 : 400;
        res.status(status).json({ ok: false, error: err.code, message: err.message });
    } else {
        res.status(500).json({ ok: false, error: 'internal', message: err instanceof Error ? err.message : 'unknown error' });
    }
}

/**
 * Production wiring: lazy singleton behind the routes. Account metadata DB
 * follows the sqliteAdapter convention: SILHOUETTE_ACCOUNTS_DB_PATH override,
 * default <repo>/data/provider-accounts.sqlite. Metadata only - no secrets.
 */
import path from 'node:path';
import fs from 'node:fs';
import { AccountStore } from '../../services/auth/accountStore';

let defaultRouter: Router | undefined;

export function connectionRoutes(): Router {
    if (!defaultRouter) {
        const dbPath = process.env.SILHOUETTE_ACCOUNTS_DB_PATH
            ? path.resolve(process.env.SILHOUETTE_ACCOUNTS_DB_PATH)
            : path.join(process.cwd(), 'db', 'provider-accounts.sqlite') // matches services/database DB_DIR convention;
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        defaultRouter = createConnectionRouter(new ConnectionManager(new AccountStore(dbPath)));
    }
    return defaultRouter;
}
