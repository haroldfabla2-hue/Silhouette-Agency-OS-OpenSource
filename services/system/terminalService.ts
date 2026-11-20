import { execFile, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import os from 'os';
import { desktopRun, desktopFault, desktopRootsOpen, desktopContinuation } from '../lifecycle/desktopWork.js';
import { registerStarted } from '../../server/desktop/startedResources.js';

interface TerminalSession {
    id: string;
    process: ChildProcessWithoutNullStreams;
    accepting: boolean;
    writes: Set<Promise<void>>;
    outputs: Set<Promise<void>>;
    controlPending: number;
    statusPending: number;
    closed: Promise<void>;
    // Output custody plus unknown descendants cannot be discharged by shell.close.
    custody: Promise<void>;
    releaseCustody: () => void;
    closeRequested: boolean;
    closeObserved: boolean;
    exitObserved: boolean;
    originalPid: number | undefined;
    cancelAttempts: number;
    lastCancel?: { attempt: number; kind: string; scope: string };
    preserveDisconnect: boolean;
    code: number | null;
    signal: NodeJS.Signals | null;
    error: boolean;
    acceptedChunks: number;
    acceptedBytes: number;
    lastInput?: {sequence: number; clientInputId?: string; bytes: number; result: 'callback-pending' | 'stdin-callback' | 'unknown'};
    inputPendingBytes: number;
    retainedOutput: Buffer;
    retainedBytes: number;
    outputPaused: boolean;
    cancellation: 'none' | 'requested' | 'shell-close-observed' | 'unknown';
    cancellationScope: 'shell-only' | 'windows-taskkill-request';
    cancelTask?: Promise<{ kind: string; scope: string }>;
    cancelHelper?: ReturnType<typeof execFile>;
    continueWork?: <T>(task: () => Promise<T>) => Promise<T>;
}

export class TerminalService extends EventEmitter {
    private static instance: TerminalService;
    // Keep records after shell close. Shell close is not a process-tree receipt.
    private sessions = new Map<string, TerminalSession>();
    private accepting = true;

    private constructor() {
        super();
        registerStarted('terminal-shells', {
            stopAdmission: () => this.stopAdmission(),
            settle: () => this.settleDesktop()
        });
    }

    public static getInstance(): TerminalService {
        if (!TerminalService.instance) TerminalService.instance = new TerminalService();
        return TerminalService.instance;
    }

    public createSession(sessionId: string): void {
        if (!this.accepting || !desktopRootsOpen()) throw new Error('TERMINAL_ADMISSION_STOPPED');
        if (this.sessions.size >= 4) throw new Error('TERMINAL_RETAINED_SESSION_LIMIT');
        if (this.sessions.has(sessionId)) throw new Error('TERMINAL_SESSION_ID_ALREADY_OWNED');
        const shell = os.platform() === 'win32' ? 'cmd.exe' : 'bash';
        // Exactly ONE acquired process, no overwritten first spawn. Node's
        // stdio pipes are not a PTY; resize remains unsupported, as before.
        const retainedOutput = Buffer.alloc(4 * 1024 * 1024);
        const proc = spawn(shell, [], { cwd: process.cwd(), env: process.env, shell: false });
        let closed!: () => void;
        let releaseCustody!: () => void;
        const session: TerminalSession = {
            id: sessionId, process: proc, accepting: true, writes: new Set(), outputs: new Set(), controlPending: 0, statusPending: 0,
            closed: new Promise<void>(resolve => { closed = resolve; }),
            custody: new Promise<void>(resolve => { releaseCustody = resolve; }),
            releaseCustody: () => releaseCustody(),
            closeRequested: false, closeObserved: false, exitObserved: false, originalPid: proc.pid,
            cancelAttempts: 0, preserveDisconnect: false, code: null, signal: null,
            error: false, acceptedChunks: 0, acceptedBytes: 0, inputPendingBytes: 0,
            retainedOutput, retainedBytes: 0, outputPaused: false,
            cancellation: 'none', cancellationScope: os.platform() === 'win32' ? 'windows-taskkill-request' : 'shell-only'
        };
        this.sessions.set(sessionId, session);
        // Attach observers synchronously before returning the acquired handle.
        const readAvailable = (stream: typeof proc.stdout) => {
            // Pull at most the remaining private quota, never enter flowing
            // mode and never read/discard a chunk after the quota is exhausted.
            while (session.retainedBytes < session.retainedOutput.length) {
                const available = stream.readableLength;
                if (!available) break;
                const data: Buffer | null = stream.read(Math.min(65536, available, session.retainedOutput.length - session.retainedBytes));
                if (!data) break;
                const offset = session.retainedBytes;
                data.copy(session.retainedOutput, offset);
                session.retainedBytes += data.length;
                try { this.emit('data', sessionId, data, offset); }
                catch { session.error = true; desktopFault('terminal-output', 'consumer-threw-bytes-retained'); }
            }
            session.outputPaused = session.retainedBytes === session.retainedOutput.length;
        };
        // Separate streams preserve their observed interleaving, not an invented
        // total order at the child. Full quota backpressures the native pipes.
        proc.stdout.on('readable', () => readAvailable(proc.stdout));
        proc.stderr.on('readable', () => readAvailable(proc.stderr));
        for (const stream of [proc.stdout, proc.stderr]) stream.on('error', () => {
            session.error = true;
            desktopFault('terminal-output', 'native-stream-error-retained-prefix-only');
            // Native read failures can make later bytes unknowable, never call
            // the retained prefix a complete command/output receipt.
        });
        proc.on('error', error => {
            session.error = true;
            desktopFault('terminal-shell', 'spawn-or-process-error');
            console.error('[Terminal] Shell error; handle retained:', {sessionId});
            this.emit('sessionError', sessionId); // no unhandled EventEmitter error
        });
        proc.stdin.on('error', error => {
            session.error = true;
            desktopFault('terminal-shell', 'stdin-result-uncertain');
            console.error('[Terminal] Input failed; command result uncertain:', {sessionId});
        });
        proc.once('exit', () => { session.exitObserved = true; });
        proc.once('close', (code, signal) => {
            session.accepting = false;
            session.closeObserved = true; session.code = code; session.signal = signal;
            if (session.cancellation === 'requested') session.cancellation = 'shell-close-observed';
            // Keep record and PID. Arbitrary commands can daemonize; no portable
            // Node-only proof that shell close means every descendant exited.
            desktopFault('terminal-shell', 'descendant-containment-unproven');
            // Socket output already submitted before process close must obtain
            // its own callback receipt before we ask the client socket to close.
            void Promise.allSettled([...session.outputs]).then(() => {
                try { this.emit('close', sessionId, code); }
                catch (error) {
                    desktopFault('terminal-shell', 'close-observer-failed');
                    console.error('[Terminal] Close observer failed:', {sessionId});
                } finally { closed(); }
            });
        });
        // Entire shell lifetime is owned independently of connection callback.
        // Global stop sends NO EOF/signal. A live session retains this ticket.
        const lifetime = desktopRun('terminal-shell-lifetime', () => {
            session.continueWork = desktopContinuation('terminal-output');
            // The current candidate has NO safe discharge path for retained
            // private bytes + uncontained descendants. Keep custody live after
            // shell.close so authenticated read/cancel remains owned during a
            // blocked stop. No timeout deletes state or pretends it is settled.
            return session.closed.then(() => session.custody);
        });
        void lifetime.catch(error => {
            desktopFault('terminal-shell', 'lifetime-transfer-failed');
            console.error('[Terminal] Lifetime ownership unresolved:', {sessionId});
        });
    }

    public write(sessionId: string, data: string, clientInputId?: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!this.accepting || !session?.accepting || session.closeRequested) return Promise.reject(new Error('TERMINAL_INPUT_NOT_ADMITTED'));
        if (clientInputId !== undefined && !/^[a-f0-9-]{36}:[0-9]{1,12}$/.test(clientInputId)) return Promise.reject(new Error('TERMINAL_INPUT_ID_INVALID'));
        const bytes = Buffer.byteLength(data);
        if (session.writes.size >= 16 || bytes > 65536 || session.inputPendingBytes + bytes > 262144) {
            // Do not accept later fragments after refusing part of a stream.
            session.accepting = false;
            return Promise.reject(new Error('TERMINAL_INPUT_BACKPRESSURE_NOT_ADMITTED'));
        }
        return desktopRun('terminal-input', () => {
            // Own the actual write callback, not just stdin.write's boolean.
            // Input chunks are arbitrary terminal bytes, not complete commands.
            const pending = new Promise<void>((resolve, reject) => {
                session.acceptedChunks++; session.acceptedBytes += bytes; session.inputPendingBytes += bytes;
                const input = {sequence: session.acceptedChunks, clientInputId, bytes, result: 'callback-pending' as 'callback-pending' | 'stdin-callback' | 'unknown'};
                session.lastInput = input;
                try {
                    session.process.stdin.write(data, error => {
                        session.inputPendingBytes -= bytes;
                        input.result = error ? 'unknown' : 'stdin-callback';
                        error ? reject(error) : resolve();
                    });
                } catch (error) { session.inputPendingBytes -= bytes; input.result = 'unknown'; reject(error); }
            });
            session.writes.add(pending);
            void pending.then(() => session.writes.delete(pending), error => {
                session.writes.delete(pending); session.error = true; session.accepting = false;
                desktopFault('terminal-input', 'accepted-write-result-uncertain');
                console.error('[Terminal] Accepted input write failed:', {sessionId});
            });
            return pending;
        });
    }

    public hasSession(sessionId: string): boolean { return this.sessions.has(sessionId); }

    public canDeliver(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        return !!session?.continueWork && session.outputs.size < 8;
    }

    public controlAvailable(sessionId: string, statusLane = false): boolean {
        const session = this.sessions.get(sessionId);
        return !!session && (statusLane ? session.statusPending < 2 : session.controlPending < 4);
    }

    public trackControl(sessionId: string, send: () => Promise<void>, statusLane = false): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session || !this.controlAvailable(sessionId, statusLane)) return Promise.reject(new Error('TERMINAL_CONTROL_CAPACITY'));
        if (statusLane) session.statusPending++; else session.controlPending++;
        const pending = this.trackOutput(sessionId, send);
        const settled = () => { if (statusLane) session.statusPending--; else session.controlPending--; };
        void pending.then(settled, settled);
        return pending;
    }

    public trackOutput(sessionId: string, send: () => Promise<void>): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session?.continueWork) return Promise.reject(new Error('TERMINAL_OUTPUT_OWNER_MISSING'));
        const output = session.continueWork(send);
        session.outputs.add(output);
        void output.then(() => session.outputs.delete(output), error => {
            session.outputs.delete(output); session.error = true;
            desktopFault('terminal-output', 'accepted-output-unreceipted');
            console.error('[Terminal] Output completion uncertain:', {sessionId});
        });
        return output;
    }

    public resize(_sessionId: string, _cols: number, _rows: number): void {
        // No PTY in the existing implementation. Do not invent resize support.
    }

    // Cancellation is separate from preserving shutdown. This restores the
    // existing ability to request termination, NOT a receipt of tree completion.
    public cancelSession(sessionId: string): Promise<{ kind: string; scope: string }> {
        const session = this.sessions.get(sessionId);
        if (!session) return Promise.resolve({ kind: 'not-found', scope: 'none' });
        if (session.cancelTask) return session.cancelTask;
        if (session.closeObserved || session.exitObserved || session.process.exitCode !== null || session.process.signalCode !== null) return Promise.resolve({ kind: 'shell-already-closed', scope: session.cancellationScope });
        session.accepting = false; session.closeRequested = true;
        session.cancellation = 'requested';
        desktopFault('terminal-shell', 'cancelled-work-may-have-partial-effects');
        const attempt = ++session.cancelAttempts;
        const scope = os.platform() === 'win32' && attempt > 1 ? 'shell-handle-only-retry' : session.cancellationScope;
        const cancel = async () => {
            try {
                // Revalidate the SAME retained ChildProcess, not a PID obtained
                // from a new query or caller. No retry after observed exit.
                if (session.process.pid !== session.originalPid || session.exitObserved || session.closeObserved
                    || session.process.exitCode !== null || session.process.signalCode !== null) {
                    return { kind: 'shell-exit-observed-no-signal', scope: session.cancellationScope };
                }
                if (os.platform() === 'win32' && attempt === 1 && session.process.pid) {
                    await new Promise<void>((resolve, reject) => {
                        // Keep helper handle and callback result as owned work.
                        session.cancelHelper = execFile('taskkill', ['/pid', String(session.process.pid), '/T', '/F'], {maxBuffer: 65536}, error => error ? reject(error) : resolve());
                    });
                } else if (!session.process.kill()) throw new Error('TERMINAL_SIGNAL_NOT_ACCEPTED');
                return { kind: 'cancel-requested', scope };
            } catch {
                session.cancellation = 'unknown';
                console.error('[Terminal] Cancellation uncertain; process still owned:', {sessionId});
                desktopFault('terminal-shell', 'cancellation-unknown');
                return { kind: 'unknown', scope };
            }
        };
        // It is a continuation of the already owned shell, not a new input root.
        const pending = session.continueWork ? session.continueWork(cancel) : cancel();
        session.cancelTask = pending;
        void pending.then(result => {
            session.lastCancel = {attempt, ...result};
            if (session.cancelTask === pending) session.cancelTask = undefined;
        }, () => {
            session.lastCancel = {attempt, kind: 'unknown', scope: session.cancellationScope};
            session.cancellation = 'unknown';
            if (session.cancelTask === pending) session.cancelTask = undefined;
        });
        return pending;
    }

    public kill(sessionId: string) { return this.cancelSession(sessionId); }

    public stopAdmission(): void {
        this.accepting = false;
        for (const session of this.sessions.values()) session.accepting = false;
        // No EOF, newline, exit, signal or automatic interpretation of partial
        // input. A live shell blocks graceful shutdown until resolved explicitly.
    }

    // Only the authenticated gateway may return bytes to its bound session.
    // Explicit offset read, no automatic replay and no pruning on send receipt.
    public readRetainedOutput(sessionId: string, offset: number): Buffer {
        const session = this.sessions.get(sessionId);
        if (!session || !Number.isSafeInteger(offset) || offset < 0 || offset > session.retainedBytes) throw new Error('TERMINAL_OUTPUT_READ_INVALID');
        const end = Math.min(offset + 65536, session.retainedBytes);
        return Buffer.from(session.retainedOutput.subarray(offset, end));
    }

    public setPreserveDisconnect(sessionId: string, preserve: boolean): void {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('TERMINAL_SESSION_NOT_FOUND');
        session.preserveDisconnect = preserve;
    }

    public outputStatus(sessionId: string) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('TERMINAL_SESSION_NOT_FOUND');
        return { retainedBytes: session.retainedBytes, quotaBytes: session.retainedOutput.length,
            outputPaused: session.outputPaused, shellClosed: session.closeObserved,
            disconnectPolicy: session.preserveDisconnect ? 'preserve' : 'cancel-request',
            cancellation: session.cancellation, cancelInFlight: !!session.cancelTask,
            cancelAttempts: session.cancelAttempts, lastCancel: session.lastCancel ?? null,
            lastInput: session.lastInput ?? null, controlPending: session.controlPending,
            statusPending: session.statusPending };
    }

    public receipt() {
        return { accepting: this.accepting, sessions: [...this.sessions.values()].map(session => ({
            id: session.id, pid: session.process.pid, accepting: session.accepting,
            writes: session.writes.size, outputs: session.outputs.size, closeRequested: session.closeRequested,
            closeObserved: session.closeObserved, code: session.code, signal: session.signal,
            error: session.error, acceptedChunks: session.acceptedChunks,
            acceptedBytes: session.acceptedBytes, retainedBytes: session.retainedBytes,
            outputPaused: session.outputPaused, cancellation: session.cancellation,
            cancellationScope: session.cancellationScope, outputPersistence: 'private-memory-only', custodyReleased: false, descendantsVerified: false
        })) };
    }

    public async settleDesktop(): Promise<void> {
        if (this.accepting) throw new Error('TERMINAL_ADMISSION_OPEN');
        await Promise.all([...this.sessions.values()].map(async session => { await session.closed; await session.cancelTask; }));
        if ([...this.sessions.values()].some(session => session.error || session.writes.size || session.outputs.size)) throw new Error('TERMINAL_INPUT_OR_PROCESS_UNRESOLVED');
        if (this.sessions.size) throw new Error('TERMINAL_DESCENDANT_CONTAINMENT_UNPROVEN');
    }
}
