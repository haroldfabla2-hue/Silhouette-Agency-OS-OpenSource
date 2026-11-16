/** Browser-only lifecycle receipts. No Node imports or async-context emulation.
 * Callers scope external entry points and keep accepted continuations private. */
export class BrowserWorkScope {
    private accepting = true;
    private readonly pending = new Set<Promise<unknown>>();
    private readonly diagnostics: Array<{ resource: string; originalCapability: 'UNAVAILABLE' | 'UNVERIFIED'; terminal: boolean }> = [];
    private closing?: Promise<{ diagnostics: ReturnType<BrowserWorkScope['getDiagnostics']> }>;
    assertOpen(): void { if (!this.accepting) throw new Error('Browser service closing'); }
    get isOpen(): boolean { return this.accepting; }
    record(resource: string, terminal = false): void { this.diagnostics.push({ resource, originalCapability: 'UNAVAILABLE', terminal }); }
    getDiagnostics() { return [...this.diagnostics]; }
    run<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
        if (!this.accepting) return Promise.reject(new Error('Browser service closing'));
        let task: Promise<T>;
        try { task = Promise.resolve(operation()); } catch (error) { task = Promise.reject(error); }
        this.pending.add(task);
        void task.then(() => this.pending.delete(task), () => { this.pending.delete(task); this.record(name); });
        return task;
    }
    close(stop?: () => void): Promise<{ diagnostics: ReturnType<BrowserWorkScope['getDiagnostics']> }> {
        if (this.closing) return this.closing;
        this.accepting = false;
        this.closing = Promise.resolve().then(async () => {
            try { stop?.(); } catch { this.record('browser-restoration', true); }
            while (this.pending.size) await Promise.allSettled([...this.pending]);
            return { diagnostics: this.getDiagnostics() };
        });
        return this.closing;
    }
}
