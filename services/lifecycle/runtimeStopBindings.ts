/** Source-fixed original singleton construction/stop frontier. Pure bookkeeping.
 * No service import, timer, IO or physical/global-quiescence claim.
 */
export class RuntimeConstructionAdmissionClosed extends Error {}
type Permit = Readonly<{ token: object }>;
type Slot = { name: string; phase: 'UNSEEN' | 'CONSTRUCTING' | 'PUBLISHED' | 'FAILED'; permit?: Permit; construction?: Promise<void>; finishConstruction?: () => void; original?: () => unknown; joined?: Promise<void>; failure?: unknown };
const curiosity: Slot = { name:'curiosity',phase:'UNSEEN' };
const daemon: Slot = { name:'daemon',phase:'UNSEEN' };
const continuousMemory: Slot = { name:'continuousMemory',phase:'UNSEEN' };
const redis: Slot = { name:'redis',phase:'UNSEEN' };
const graph: Slot = { name:'graph',phase:'UNSEEN' };
const sqlite: Slot = { name:'sqlite',phase:'UNSEEN' };
const nervous: Slot = { name:'nervous',phase:'UNSEEN' };
const scheduler: Slot = { name:'scheduler',phase:'UNSEEN' };
const cron: Slot = { name:'cron',phase:'UNSEEN' };
const producers = [daemon,curiosity,nervous,scheduler,cron];
const storage = [continuousMemory,redis,graph,sqlite];
let registrationSealed = false;
let producersSealed = false;
let storageSealed = false;
function admit(slot: Slot): Permit {
    if (registrationSealed) throw new RuntimeConstructionAdmissionClosed('Runtime construction admission closed: ' + slot.name);
    if (slot.phase !== 'UNSEEN') throw new Error('Duplicate runtime original singleton: ' + slot.name);
    const permit = Object.freeze({ token:Object.freeze({}) });
    slot.permit = permit;slot.phase = 'CONSTRUCTING';
    slot.construction = new Promise<void>(resolve => { slot.finishConstruction = resolve; });
    return permit;
}
function start(slot: Slot): Promise<void> {
    if (slot.joined) return slot.joined;
    if (slot.phase !== 'PUBLISHED' || !slot.original) throw new Error('Runtime original stopper unavailable: ' + slot.name);
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    slot.joined = new Promise<void>((yes,no) => { resolve=yes;reject=no; });
    void slot.joined.catch(() => undefined); // exact rejected task stays retained
    try { void Promise.resolve(slot.original()).then(() => resolve(),reject); }
    catch (error) { reject(error); }
    return slot.joined;
}
function publish(slot: Slot,permit: Permit,stop: () => unknown,sealed: boolean): void {
    if (slot.phase !== 'CONSTRUCTING' || slot.permit !== permit) throw new Error('Foreign runtime construction publication: ' + slot.name);
    slot.original=stop;slot.phase='PUBLISHED';slot.finishConstruction!();
    if (sealed) start(slot);
}
function failed(slot: Slot,permit: Permit,error: unknown): void {
    if (slot.phase !== 'CONSTRUCTING' || slot.permit !== permit) throw new Error('Foreign runtime construction failure: ' + slot.name);
    slot.failure=error;slot.phase='FAILED';slot.finishConstruction!();
}
export function admitEvaluatedCuriosity(): Permit { return admit(curiosity); }
export function bindEvaluatedCuriosity(permit: Permit,stop: () => unknown): void { publish(curiosity,permit,stop,producersSealed); }
export function failEvaluatedCuriosity(permit: Permit,error: unknown): void { failed(curiosity,permit,error); }
export function admitEvaluatedDaemon(): Permit { return admit(daemon); }
export function bindEvaluatedDaemon(permit: Permit,stop: () => unknown): void { publish(daemon,permit,stop,producersSealed); }
export function failEvaluatedDaemon(permit: Permit,error: unknown): void { failed(daemon,permit,error); }
export function admitEvaluatedContinuousMemory(): Permit { return admit(continuousMemory); }
export function bindEvaluatedContinuousMemory(permit: Permit,stop: () => unknown): void { publish(continuousMemory,permit,stop,storageSealed); }
export function failEvaluatedContinuousMemory(permit: Permit,error: unknown): void { failed(continuousMemory,permit,error); }
export function admitEvaluatedRedis(): Permit { return admit(redis); }
export function bindEvaluatedRedis(permit: Permit,stop: () => unknown): void { publish(redis,permit,stop,storageSealed); }
export function failEvaluatedRedis(permit: Permit,error: unknown): void { failed(redis,permit,error); }
export function admitEvaluatedGraph(): Permit { return admit(graph); }
export function bindEvaluatedGraph(permit: Permit,stop: () => unknown): void { publish(graph,permit,stop,storageSealed); }
export function failEvaluatedGraph(permit: Permit,error: unknown): void { failed(graph,permit,error); }
export function admitEvaluatedSqlite(): Permit { return admit(sqlite); }
export function bindEvaluatedSqlite(permit: Permit,stop: () => unknown): void { publish(sqlite,permit,stop,storageSealed); }
export function failEvaluatedSqlite(permit: Permit,error: unknown): void { failed(sqlite,permit,error); }
export function admitEvaluatedNervous(): Permit { return admit(nervous); }
export function bindEvaluatedNervous(permit: Permit,stop: () => unknown): void { publish(nervous,permit,stop,producersSealed); }
export function failEvaluatedNervous(permit: Permit,error: unknown): void { failed(nervous,permit,error); }
export function admitEvaluatedScheduler(): Permit { return admit(scheduler); }
export function bindEvaluatedScheduler(permit: Permit,stop: () => unknown): void { publish(scheduler,permit,stop,producersSealed); }
export function failEvaluatedScheduler(permit: Permit,error: unknown): void { failed(scheduler,permit,error); }
export function admitEvaluatedCron(): Permit { return admit(cron); }
export function bindEvaluatedCron(permit: Permit,stop: () => unknown): void { publish(cron,permit,stop,producersSealed); }
export function failEvaluatedCron(permit: Permit,error: unknown): void { failed(cron,permit,error); }
export function sealEvaluatedRuntimeProducers(): void {
    // Close the construction frontier BEFORE producer callbacks. Modules not
    // yet admitted now fail before allocating their original singleton.
    registrationSealed=true;producersSealed=true;
    for (const slot of producers) if (slot.phase === 'PUBLISHED') start(slot);
}
async function drain(slots: readonly Slot[]): Promise<void> {
    // Exact original constructors admitted before the seal remain obligations.
    await Promise.allSettled(slots.flatMap(slot => slot.construction ? [slot.construction] : []));
    const failures: unknown[] = slots.filter(slot => slot.phase === 'FAILED').map(slot => slot.failure);
    const results = await Promise.allSettled(slots.flatMap(slot => slot.phase === 'PUBLISHED' ? [start(slot)] : []));
    for (const result of results) if (result.status === 'rejected') failures.push(result.reason);
    if (failures.length) throw new AggregateError(failures,'Evaluated original owner stop failed');
}
export async function drainEvaluatedRuntimeProducers(): Promise<void> {
    sealEvaluatedRuntimeProducers();await drain(producers);
}
export async function closeEvaluatedRuntimeStorage(): Promise<void> {
    registrationSealed=true;storageSealed=true;
    // Original persistence before backends, with independent backends joined
    // allSettled even if one original close rejects.
    const failures: unknown[] = [];
    try { await drain([continuousMemory]); } catch (error) { failures.push(error); }
    try { await drain([redis,graph]); } catch (error) { failures.push(error); }
    // Graph may borrow SQLite: its original stop settles before SQLite close.
    try { await drain([sqlite]); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures,'Evaluated original storage stop failed');
}
export function evaluatedRuntimeFrontier(): readonly Readonly<{name:string;phase:string}>[] {
    // UNSEEN remains UNVERIFIED; never silently becomes NOT_ACQUIRED.
    return [...producers,...storage].map(slot => Object.freeze({name:slot.name,phase:slot.phase}));
}
