import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';
import { ResourceScope } from '../../server/runtime/resourceScope';

interface TerminalSession {
    id: string;
    process: ChildProcessWithoutNullStreams;
    closed: Promise<void>;
    stop(): Promise<void>;
}

export class TerminalService extends EventEmitter {
    private static instance: TerminalService;
    private readonly operations = new ResourceScope('terminal-service');
    private readonly sessions = new Map<string, TerminalSession>();
    private constructor() { super(); }
    public static getInstance(): TerminalService {
        if (!TerminalService.instance) TerminalService.instance = new TerminalService();
        return TerminalService.instance;
    }
    public getLifecycleStatus() {
        return { sessions: this.sessions.size, failures: this.operations.getFailures(), diagnostics: this.operations.getDiagnostics() };
    }
    public shutdown() { return this.operations.close(); }

    public createSession(sessionId: string): void {
        this.operations.assertAccepting();
        if (this.sessions.has(sessionId)) return;
        const isWin = os.platform() === 'win32';
        const shell = isWin ? 'cmd.exe' : 'bash';
        // One actual shell, not the old discarded first spawn plus a second one.
        const proc = spawn(shell, [], { cwd: process.cwd(), env: process.env, shell: false });
        let ended = false;
        let resolveClosed!: () => void;
        const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
        let stopTask: Promise<void> | undefined;
        const stop = () => {
            if (stopTask) return stopTask;
            stopTask = Promise.resolve().then(async () => {
                if (ended || proc.exitCode !== null || proc.signalCode !== null) return;
                if (isWin && proc.pid) {
                    // Retain the actual taskkill completion, not a detached exec.
                    try {
                        await new Promise<void>((resolve, reject) => {
                            execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], error => error ? reject(error) : resolve());
                        });
                    } catch (error) {
                        this.operations.recordFailure('terminal-taskkill', error);
                        if (!ended && proc.exitCode === null && proc.signalCode === null) proc.kill();
                    }
                } else if (!proc.kill()) {
                    this.operations.recordFailure('terminal-kill-signal', new Error('Child did not accept termination signal'));
                }
            });
            return stopTask;
        };
        let release: () => Promise<void> = async () => undefined;
        const onData = (data: Buffer) => this.emit('data', sessionId, data.toString());
        const onError = (error: Error) => {
            this.operations.recordFailure('terminal-child', error);
            if (this.listenerCount('error')) this.emit('error', sessionId, error);
            else console.error(`[Terminal] Session ${sessionId} failed`, error);
        };
        const onClose = (code: number | null) => {
            ended = true;
            proc.stdout.off('data', onData);
            proc.stderr.off('data', onData);
            proc.off('error', onError);
            proc.stdin.off('error', onError);
            proc.stdout.off('error', onError);
            proc.stderr.off('error', onError);
            this.sessions.delete(sessionId);
            resolveClosed();
            // Release remains tracked even when peer/session cleanup ignores it.
            void release();
            this.emit('close', sessionId, code);
        };
        // Own the real process immediately, before adding application callbacks.
        release = this.operations.own({
            name: `terminal-child:${sessionId}`,
            stopIntake: stop,
            close: async () => {
                await stop();
                await closed; // Direct child AND its stdio close, not kill() return.
                // Shell descendants are not certified by direct-child closure.
                return { state: 'UNVERIFIED' as const, detail: 'Direct shell/stdio closed; descendant process-tree release unverified' };
            },
        });
        this.sessions.set(sessionId, { id: sessionId, process: proc, closed, stop });
        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.once('close', onClose);
        proc.on('error', onError);
        proc.stdin.on('error', onError);
        proc.stdout.on('error', onError);
        proc.stderr.on('error', onError);
    }
    public write(sessionId: string, data: string): Promise<void> {
        return this.operations.run('terminal-stdin', async () => {
            const session = this.sessions.get(sessionId);
            if (!session?.process.stdin) throw new Error('Terminal session unavailable');
            await new Promise<void>((resolve, reject) => {
                session.process.stdin.write(data, error => error ? reject(error) : resolve());
            });
        });
    }
    public resize(_sessionId: string, _cols: number, _rows: number): void {
        this.operations.assertWorkAccepted();
        // Standard spawn is not a PTY; resizing was and remains unsupported.
    }
    public kill(sessionId: string): Promise<void> {
        return this.operations.run('terminal-kill', async () => {
            const session = this.sessions.get(sessionId);
            if (!session) return;
            await session.stop();
            await session.closed;
        });
    }
}
