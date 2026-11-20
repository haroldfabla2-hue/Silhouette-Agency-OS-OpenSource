export interface WriterGate {
    run<T>(task: () => T): Promise<Awaited<T>>;
    root<T>(task: () => T): Promise<Awaited<T>>;
    stopAdmission(): void;
    drain(ms?: number): Promise<{ accepting: boolean; active: number }>;
    snapshot(): { accepting: boolean; active: number; rejected?: number };
}
export function createWriterGate(label: string): WriterGate;
