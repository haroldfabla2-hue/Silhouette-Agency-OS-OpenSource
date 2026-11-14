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
const identity: Slot = { name:'identity',phase:'UNSEEN' };
const profileHydration: Slot = { name:'profile-constructor-hydration',phase:'UNSEEN' };
const nervous: Slot = { name:'nervous',phase:'UNSEEN' };
const scheduler: Slot = { name:'scheduler',phase:'UNSEEN' };
const cron: Slot = { name:'cron',phase:'UNSEEN' };
const dreamer: Slot = { name:'dreamer',phase:'UNSEEN' };
const introspection: Slot = { name:'introspection-known-borrowers',phase:'UNSEEN' };
const voiceRoutes: Slot = { name:'known-voice-route-tasks',phase:'UNSEEN' };
const resourceManager: Slot = { name:'resource-manager-known-borrowers',phase:'UNSEEN' };
const telephonyTools: Slot = { name:'known-telephony-tool-tasks',phase:'UNSEEN' };
const telephony: Slot = { name:'telephony-known-borrowers',phase:'UNSEEN' };
const tts: Slot = { name:'tts-known-borrowers',phase:'UNSEEN' };
const voiceLibrary: Slot = { name:'voice-library-known-borrowers',phase:'UNSEEN' };
let voiceBorrowersSealed = false;
let conceptBorrowersSealed = false;
const producers = [daemon,curiosity,nervous,scheduler,cron,dreamer];
const storage = [continuousMemory,redis,graph,identity,sqlite];
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
export function admitEvaluatedIdentity(): Permit { return admit(identity); }
export function bindEvaluatedIdentity(permit: Permit, stop: () => unknown): void { publish(identity, permit, stop, storageSealed); }
export function failEvaluatedIdentity(permit: Permit, error: unknown): void { failed(identity, permit, error); }
export function admitEvaluatedProfileHydration(): Permit { return admit(profileHydration); }
export function bindEvaluatedProfileHydration(permit: Permit, join: () => unknown): void { publish(profileHydration, permit, join, storageSealed); }
export function failEvaluatedProfileHydration(permit: Permit, error: unknown): void { failed(profileHydration, permit, error); }
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
export function admitEvaluatedDreamer(): Permit { return admit(dreamer); }
export function bindEvaluatedDreamer(permit: Permit,stop: () => unknown): void { publish(dreamer,permit,stop,producersSealed); }
export function failEvaluatedDreamer(permit: Permit,error: unknown): void { failed(dreamer,permit,error); }
export function admitEvaluatedIntrospection(): Permit { return admit(introspection); }
export function bindEvaluatedIntrospection(permit: Permit,stop: () => unknown): void { publish(introspection,permit,stop,conceptBorrowersSealed); }
export function failEvaluatedIntrospection(permit: Permit,error: unknown): void { failed(introspection,permit,error); }
export function admitEvaluatedVoiceRoutes(): Permit { return admit(voiceRoutes); }
export function bindEvaluatedVoiceRoutes(permit: Permit,stop: () => unknown): void { publish(voiceRoutes,permit,stop,false); }

export function admitEvaluatedResourceManager(): Permit { return admit(resourceManager); }
export function bindEvaluatedResourceManager(permit: Permit,stop: () => unknown): void { publish(resourceManager,permit,stop,false); }
export function failEvaluatedResourceManager(permit: Permit,error: unknown): void { failed(resourceManager,permit,error); }

export function admitEvaluatedTelephonyTools(): Permit { return admit(telephonyTools); }
export function bindEvaluatedTelephonyTools(permit: Permit,stop: () => unknown): void { publish(telephonyTools,permit,stop,false); }

export function admitEvaluatedTelephony(): Permit { return admit(telephony); }
export function bindEvaluatedTelephony(permit: Permit,stop: () => unknown): void { publish(telephony,permit,stop,voiceBorrowersSealed); }
export function failEvaluatedTelephony(permit: Permit,error: unknown): void { failed(telephony,permit,error); }
export function admitEvaluatedTTS(): Permit { return admit(tts); }
export function bindEvaluatedTTS(permit: Permit,stop: () => unknown): void { publish(tts,permit,stop,voiceBorrowersSealed); }
export function failEvaluatedTTS(permit: Permit,error: unknown): void { failed(tts,permit,error); }
export function admitEvaluatedVoiceLibrary(): Permit { return admit(voiceLibrary); }
export function bindEvaluatedVoiceLibrary(permit: Permit,stop: () => unknown): void { publish(voiceLibrary,permit,stop,voiceBorrowersSealed); }
export function failEvaluatedVoiceLibrary(permit: Permit,error: unknown): void { failed(voiceLibrary,permit,error); }

/** Known source order only. Caller must FIRST join every real upstream HTTP,
 * callback, media, CFO and resource-manager lifetime. Not wired into global
 * shutdown while those frontiers are open. Does not authorize SQLite release.
 */
export async function drainEvaluatedKnownVoiceBorrowers(): Promise<void> {
    const failures: unknown[] = [];
    // Admitted resource shunt/restore can still import and call original TTS.
    // Join it before the new constructor admission frontier is sealed.
    // Known routes may still admit original resource/tool/voice imports.
    try { await drain([voiceRoutes]); } catch (error) { failures.push(error); }
    try { await drain([resourceManager]); } catch (error) { failures.push(error); }
    // Original admitted tool branches may still evaluate telephony imports.
    try { await drain([telephonyTools]); } catch (error) { failures.push(error); }
    registrationSealed = true;
    try { await drain([telephony]); } catch (error) { failures.push(error); }
    // No new speech/voice continuations can originate in joined call turns.
    // The independent owner drains below join any already-admitted work still
    // pending there; both are attempted even if one rejects.
    voiceBorrowersSealed = true;
    try { await drain([tts, voiceLibrary]); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Known original voice borrower drain failed');
}

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
    sealEvaluatedRuntimeProducers();
    const failures: unknown[] = [];
    // Existing original producers may still call addThought while settling.
    // Join them before sealing this source-fixed known borrower frontier.
    try { await drain(producers); } catch (error) { failures.push(error); }
    conceptBorrowersSealed = true;
    try { await drain([introspection]); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Original producer/concept borrower drain failed');
}
export async function closeEvaluatedRuntimeStorage(): Promise<void> {
    registrationSealed=true;storageSealed=true;
    // Original persistence before backends, with independent backends joined
    // allSettled even if one original close rejects.
    const failures: unknown[] = [];
    // Original constructor hydration may borrow Redis/Graph/SQLite. Join its
    // SAME Promise before any original storage close, even on rejection.
    try { await drain([profileHydration]); } catch (error) { failures.push(error); }
    try { await drain([continuousMemory]); } catch (error) { failures.push(error); }
    try { await drain([redis,graph,identity]); } catch (error) { failures.push(error); }
    // Graph may borrow SQLite: its original stop settles before SQLite close.
    try { await drain([sqlite]); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures,'Evaluated original storage stop failed');
}
export function evaluatedRuntimeFrontier(): readonly Readonly<{name:string;phase:string}>[] {
    // UNSEEN remains UNVERIFIED; never silently becomes NOT_ACQUIRED.
    return [...producers,introspection,voiceRoutes,resourceManager,telephonyTools,telephony,tts,voiceLibrary,profileHydration,...storage].map(slot => Object.freeze({name:slot.name,phase:slot.phase}));
}
