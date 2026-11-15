import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';

interface TerminalSession {
    id: string;
    process: ChildProcessWithoutNullStreams;
    buffer: string;
    closed: Promise<void>;
    settleClosed: () => void;
}

export class TerminalService extends EventEmitter {
    private static instance: TerminalService;
    private sessions: Map<string, TerminalSession> = new Map();

    private constructor() {
        super();
    }

    public static getInstance(): TerminalService {
        if (!TerminalService.instance) {
            TerminalService.instance = new TerminalService();
        }
        return TerminalService.instance;
    }

    public createSession(sessionId: string): void {
        if (this.sessions.has(sessionId)) {
            return; // Session already exists
        }

        const isWin = os.platform() === 'win32';
        const shell = isWin ? 'cmd.exe' : 'bash';

        console.log(`[Terminal] Spawning ${shell} for session ${sessionId}`);

        // One child per terminal session. The former unused spawn allocated a
        // second shell that was never entered in sessions, so kill()/socket
        // close could not reach it. Keep the original tracked process below.
        const proc = spawn(shell, [], {
            cwd: process.cwd(),
            env: process.env,
            shell: false // We are spawning the shell directly
        });

        let settleClosed!: () => void;
        const closed = new Promise<void>(resolve => { settleClosed = resolve; });
        const session: TerminalSession = {
            id: sessionId,
            process: proc,
            buffer: '',
            closed,
            settleClosed
        };

        this.sessions.set(sessionId, session);

        // Handle Output
        proc.stdout.on('data', (data) => {
            this.emit('data', sessionId, data.toString());
        });

        proc.stderr.on('data', (data) => {
            this.emit('data', sessionId, data.toString());
        });

        proc.on('close', (code) => {
            console.log(`[Terminal] Session ${sessionId} closed with code ${code}`);
            // Retire only this exact child after its actual close event. An
            // observer throwing must not strand ownership or erase a successor.
            if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
            session.settleClosed();
            this.emit('close', sessionId, code);
        });

        proc.on('error', (err) => {
            console.error(`[Terminal] Session ${sessionId} error:`, err);
            this.emit('error', sessionId, err);
        });
    }

    public write(sessionId: string, data: string): void {
        const session = this.sessions.get(sessionId);
        if (session && session.process.stdin) {
            session.process.stdin.write(data);
        }
    }

    public resize(sessionId: string, cols: number, rows: number): void {
        // Not supported with standard spawn, but we keep the method signature for future
        // integration with node-pty if enabled.
        // console.log(`[Terminal] Resize request ignored (spawn mode): ${cols}x${rows}`);
    }

    public kill(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            console.log(`[Terminal] Killing session ${sessionId} (PID: ${session.process.pid})`);

            if (os.platform() === 'win32' && session.process.pid) {
                // Windows: Taskkill /T (Tree) /F (Force)
                try {
                    const { exec } = require('child_process');
                    exec(`taskkill /pid ${session.process.pid} /T /F`, (err: any) => {
                        if (err) console.warn(`[Terminal] Taskkill warning: ${err.message}`);
                    });
                } catch (e) {
                    session.process.kill(); // Fallback
                }
            } else {
                // Unix: Kill just the process (usually shell handles its children, but tree-kill is better if available)
                session.process.kill();
            }

            // Ownership remains until proc.close, including after a failed
            // signal request. Failure is not proof that the process ended.
        }
    }

    /** Joins the exact currently-owned shell, not a descendant-tree proof. */
    public sessionClosed(sessionId: string): Promise<void> {
        return this.sessions.get(sessionId)?.closed ?? Promise.resolve();
    }
}
