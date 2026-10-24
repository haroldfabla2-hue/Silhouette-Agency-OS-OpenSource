/**
 * Module-lifecycle-aware dynamic import.
 *
 * Constructors that fire dynamic imports while the module graph is still
 * evaluating (and tests restarting modules via vi.resetModules) can receive
 * a namespace whose export binding is not initialized yet; dereferencing it
 * then throws (observed as unhandled rejections) or loses writes behind
 * misleading subsystem errors. This helper polls the binding briefly, then
 * classifies the outcome honestly as a module-lifecycle skip - never as a
 * subsystem failure, never silently.
 *
 * Budgets stay short on purpose: in production the import resolves with the
 * binding initialized on the first attempt, so the wait only exists for
 * module-restart races, which resolve within ticks.
 */
export interface LifecycleBudget {
    attempts?: number;  // total polls (default 20)
    stepMs?: number;    // delay between polls (default 25ms)
    note?: string;      // honest classification appended to the skip log
}

export async function importWhenReady<T>(
    label: string,
    importer: () => Promise<any>,
    pick: (mod: any) => T | undefined | null,
    budget: LifecycleBudget = {}
): Promise<T | null> {
    const attempts = budget.attempts ?? 20;
    const stepMs = budget.stepMs ?? 25;
    const note = budget.note ?? 'NOT a subsystem failure';
    for (let attempt = 0; attempt <= attempts; attempt++) {
        let mod: any;
        try {
            mod = await importer();
        } catch (e) {
            console.error(`[LIFECYCLE] ${label} failed: module import error:`, e);
            return null;
        }
        const picked = pick(mod);
        if (picked) return picked;
        if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, stepMs));
    }
    console.error(`[LIFECYCLE] ${label} skipped: module binding not initialized after module-lifecycle wait (${note}).`);
    return null;
}
