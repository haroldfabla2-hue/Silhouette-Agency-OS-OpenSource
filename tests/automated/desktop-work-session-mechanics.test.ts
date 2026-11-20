/** SOURCE-ONLY, NOT RUN. Coordinator mechanics with actual fs/timers/sockets.
 * No fake providers, channels, orchestrator, timers, or product success claims.
 * These unit cases do NOT prove a Desktop/product path or natural process exit.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Socket } from 'node:net';
import { createWorkSession } from '../../server/desktop/workSession.js';
import { isDesktopRefusal } from '../../services/lifecycle/desktopRefusal.js';
import { attemptDelivery } from '../../services/lifecycle/deliveryReceipt';

const latch = () => {
    let open!: () => void;
    const promise = new Promise<void>(resolve => { open = resolve; });
    return { promise, open };
};

describe('Desktop shared work graph mechanics, not product integration', () => {
    it('exhausts transferred release descendants before a later producer phase', async () => {
        const session = createWorkSession();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-phase-'));
        const entered = latch(), continueChild = latch();
        let child: Promise<void> | undefined;
        session.closeRoots();
        await session.drain();
        try {
            const phase = session.runFinalPhase(async () => {
                // A release transfers an independent task before returning.
                // This exercises the coordinator API, NOT a mocked bus/plugin.
                child = session.run('release-descendant', async () => {
                    entered.open();
                    await continueChild.promise;
                    await fs.writeFile(path.join(dir, 'final-original.txt'), 'original work');
                });
            });
            await entered.promise;
            expect(session.snapshot().active).toBeGreaterThan(0);
            continueChild.open();
            await phase;
            await session.runFinalPhase(async () => {
                // Real file operation must have completed, not a local owner
                // snapshot or a flag set when the release callback returned.
                expect(await fs.readFile(path.join(dir, 'final-original.txt'), 'utf8')).toBe('original work');
            });
            session.producersPreserved();
        } finally {
            continueChild.open(); await child;
            await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('counts a never-started root separately from a live cross-owner child', async () => {
        const session = createWorkSession();
        const continueRoot = latch();
        const root = session.root('http-unit-root', async () => {
            await continueRoot.promise;
            return session.run('plugin-unit-child', async () => {
                await session.run('channel-unit-child', async () => undefined);
            });
        });
        session.closeRoots();
        const refused = await session.root('new-ingress', async () => { throw new Error('must never execute'); }).catch(error => error);
        expect(isDesktopRefusal(refused)).toBe(true);
        expect(session.ownerSnapshot('new-ingress').notStarted).toBe(1);
        expect(session.snapshot().debts).toEqual([]);
        continueRoot.open(); await root; await session.drain();
        expect(session.ownerSnapshot('channel-unit-child').settled).toBe(1);
    });

    it('does not call an entered parent never-started when a child refusal propagates', async () => {
        const session = createWorkSession();
        const continueParent = latch();
        let entered = false;
        const parent = session.root('entered-parent', async () => {
            entered = true;
            await continueParent.promise;
            return session.root('late-child-root', async () => undefined);
        });
        session.closeRoots(); continueParent.open();
        const error = await parent.catch(error => error);
        expect(entered).toBe(true);
        expect(isDesktopRefusal(error)).toBe(true);
        expect(session.ownerSnapshot('entered-parent').accepted).toBe(1);
        expect(session.ownerSnapshot('entered-parent').notStarted).toBe(0);
        expect(session.ownerSnapshot('entered-parent').rejected).toBe(1);
        expect(session.ownerSnapshot('late-child-root').notStarted).toBe(1);
        // Bus wrappers use THEIR own entered flag, not this error's identity
        // alone, to classify the already-executed parent as failed transfer.
    });

    it('keeps an accepted writer ticket and real store handle after timeout', async () => {
        const session = createWorkSession();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-timeout-'));
        const handle = await fs.open(path.join(dir, 'store.txt'), 'w+');
        const continueWriter = latch();
        const writer = session.root('store-writer', async () => {
            await continueWriter.promise;
            await handle.writeFile('not abandoned');
        });
        session.closeRoots();
        try {
            await expect(session.drain(5)).rejects.toThrow('DESKTOP_WORK_STILL_OWNED');
            expect(session.snapshot().active).toBe(1);
            // This does not assert appAdapter stores are open. It shows this
            // coordinator did not release or cancel an actual owned handle.
            continueWriter.open(); await writer;
            await session.drain();
            expect(await fs.readFile(path.join(dir, 'store.txt'), 'utf8')).toBe('not abandoned');
        } finally {
            continueWriter.open(); await writer;
            await handle.close(); await fs.rm(dir, { recursive: true, force: true });
        }
    });

    it('records an actual rejected socket write as uncertain, without retry', async () => {
        const socket = new Socket();
        const socketErrors: Error[] = [];
        // Record a real error event if this Node version emits one in addition
        // to the callback error. It never changes the expected uncertain result.
        socket.on('error', error => socketErrors.push(error));
        socket.destroy();
        let attempts = 0;
        const result = await attemptDelivery(async () => {
            attempts++;
            return new Promise<string>((resolve, reject) => {
                socket.write('reply', error => error ? reject(error) : resolve('socket-write-receipt'));
            });
        });
        expect(attempts).toBe(1);
        expect(result.kind).toBe('unknown');
        if (result.kind === 'unknown') expect(result.reason).toBe('transport-threw');
        // Boundary unit only. Orchestrator fault-before-catch/no-second-send
        // remains a source review and later real integration requirement.
    });

    it('separates receipted read rejection from actual failed persistence debt', async () => {
        const session = createWorkSession();
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-debt-'));
        try {
            await session.root('read', () => fs.readFile(path.join(dir, 'absent'))).catch(() => undefined);
            expect(session.ownerSnapshot('read').rejected).toBe(1);
            expect(session.snapshot().debts).toEqual([]);
            await session.root('write', async () => {
                try { await fs.writeFile(dir, 'cannot replace a directory'); }
                catch (error) { session.fault('write', 'actual-write-failed'); throw error; }
            }).catch(() => undefined);
            session.closeRoots();
            await expect(session.drain()).rejects.toThrow('DESKTOP_PERSISTENCE_OR_OWNERSHIP_UNRESOLVED');
            expect(session.snapshot().active).toBe(0);
            expect(session.snapshot().debts).toHaveLength(1);
        } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });
});
