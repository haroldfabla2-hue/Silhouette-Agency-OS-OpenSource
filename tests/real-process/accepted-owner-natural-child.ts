/** Actual signed local confirmation -> real reply -> WAL -> accepted-owner join.
 * No model call, fake handler, private resolver mutation or forced successful exit.
 * Natural process termination is checked externally and can FAIL on graph timers.
 */
import '../setup/require-cloud-only';
import '../../server/config/runtimeCredentials';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {WebSocket} from 'ws';
import {createHook} from 'node:async_hooks';
// Read-only, bounded creation evidence before application imports. Never clear,
// unref, cancel, replace or simulate a timer. Traces are authored test graph only.
const timerCreation = new Map<number, {stack: string; hasRef: () => boolean}>();
let timerTraceOverflow = 0;
const timerTrace = createHook({
    init(id, type, _trigger, resource: {hasRef?: () => boolean}) {
        if (type !== 'Timeout') return;
        if (timerCreation.size >= 128) {timerTraceOverflow++; return;}
        const stack = new Error('Actual timer creation').stack ?? 'STACK_UNAVAILABLE';
        timerCreation.set(id, {stack: stack.slice(0, 4096), hasRef: () => typeof resource.hasRef === 'function' && resource.hasRef()});
    },
    destroy(id) {timerCreation.delete(id);}
});
timerTrace.enable();

import {getPublishedNarrative} from '../../services/narrativeInstanceOwner';
import {getPublishedResourceArbiter} from '../../services/resourceArbiterOwner';
const deniedMemory = process.argv[2] === 'post-delivery-memory-denied';
const {agentPersistence} = await import('../../services/agentPersistence');
const {INITIAL_AGENTS} = await import('../../constants');
for (const agent of INITIAL_AGENTS) agentPersistence.saveAgent(agent);
const {orchestrator} = await import('../../services/orchestrator');
const {continuousMemory} = await import('../../services/memory/continuousMemory');
const {identityService} = await import('../../services/identityService');
await identityService.init();
const principal = await identityService.upsertUser({email: 'signed-fixture@fixture.invalid', name: 'Authored fixture principal'});
const {channelIngress} = await import('../../services/security/ingressEnvelope');
const {gateway} = await import('../../server/gateway/wsGateway');
const server = http.createServer(); gateway.initialize(server);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as {port: number}).port;
async function connect(clientId: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const frames: {type: string; event?: string; sessionId?: string; payload?: {message: {id: string; content: string}}}[] = [];
    let notify: (() => void) | undefined;
    ws.on('message', data => { frames.push(JSON.parse(data.toString())); notify?.(); });
    await new Promise<void>((resolve, reject) => {ws.once('open', resolve); ws.once('error', reject);});
    async function until(test: () => boolean): Promise<void> {
        if (test()) return;
        await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => {notify = undefined; reject(new Error('actual socket event deadline'));}, 5000);
            notify = () => {if (test()) {clearTimeout(deadline); notify = undefined; resolve();}};
            notify();
        });
    }
    ws.send(JSON.stringify({type: 'connect', params: {clientId, clientType: 'web-ui'}}));
    await until(() => frames.some(frame => frame.type === 'connect-ok'));
    const sessionId = frames.find(frame => frame.type === 'connect-ok')!.sessionId;
    assert.ok(sessionId);
    return {ws, frames, sessionId, until};
}
const first = await connect('accepted-origin');
const other = await connect('accepted-other');
// Existing fixture uses the actual gateway connection registry to issue the real
// connection-scoped route, not a substitute delivery function. No mutation.
const origin = [...(gateway as unknown as {connections: Map<string, {conn: {clientId: string; id: string}}>}).connections.values()].find(entry => entry.conn.clientId === 'accepted-origin');
assert.ok(origin);
const route = gateway.issueReplyRoute(origin.conn.id); assert.ok(route);
const message = 'RECHAZAR TODO';
const payload = {channel: 'web-ui', senderId: 'signed-fixture-sender', messageId: 'signed-fixture-message', principalId: principal.id, sessionId: first.sessionId, message, replyRoute: route};
const envelope = channelIngress.issue({channel: payload.channel, senderId: payload.senderId, messageId: payload.messageId, principalId: payload.principalId, conversationId: payload.sessionId, content: message});
const memoryFile = 'data/agents/core-01/MEMORY.md';
const originalMemory = fs.readFileSync(memoryFile, 'utf8');
if (deniedMemory) fs.chmodSync(memoryFile, 0o400);
const before = orchestrator.getUserMessageProducerStatus();
assert.equal(before.pendingOwners, 0); assert.equal(before.counts.accepted, 0);
const owner = orchestrator.handleUserMessage({...payload, envelope});
// Retention is synchronous; body's first await(import authority) cannot finish
// until this stack yields. These assertions fail rather than add a fake barrier.
const admitted = orchestrator.getUserMessageProducerStatus();
assert.equal(admitted.pendingOwners, 1); assert.equal(admitted.counts.accepted, 1);
const stop = orchestrator.stopUserMessageAdmissions();
assert.equal(stop, orchestrator.stopUserMessageAdmissions());
assert.equal(orchestrator.getUserMessageProducerStatus().pendingOwners, 1);
await assert.rejects(orchestrator.handleUserMessage({...payload, message: 'must not enter after stop'}), error => error instanceof Error && error.name === 'UserMessageAdmissionStoppedError');
await owner;
const joined = await stop;
assert.equal(joined.counts.accepted, 1); assert.equal(joined.counts.settled, 1); assert.equal(joined.counts.denied, 1);
assert.equal(joined.pendingOwners, 0); assert.equal(joined.counts.receiptObserved, 1);
if (deniedMemory) {
    assert.ok(joined.counts.failures > 0); assert.equal(joined.counts.commitFailed, 1);
    assert.equal(joined.counts.otherPending, 1); assert.equal(joined.semanticStatus, 'INCOMPLETE');
} else {
    assert.equal(joined.counts.failures, 0); assert.equal(joined.semanticStatus, 'NO_LOCAL_MESSAGE_FAILURE_RECORDED');
}
await first.until(() => first.frames.some(frame => frame.type === 'event' && frame.event === 'session.message'));
const replies = first.frames.filter(frame => frame.type === 'event' && frame.event === 'session.message');
assert.equal(replies.length, 1); const received = replies[0].payload!.message;
assert.match(received.content, /No tienes acciones pendientes/);
assert.equal(other.frames.filter(frame => frame.type === 'event' && frame.event === 'session.message').length, 0);
const entries = JSON.parse(fs.readFileSync('data/wal/memory_wal.json', 'utf8'));
const entry = entries.find((item: {data: {input: string}}) => item.data.input === message);
assert.ok(entry); assert.equal(entry.status, deniedMemory ? 'PENDING' : 'COMMITTED');
if (deniedMemory) {
    assert.equal(fs.readFileSync(memoryFile, 'utf8'), originalMemory);
} else {
    assert.equal(entry.data.metadata.deliveryReceipt.id, received.id);
    assert.equal(entry.data.metadata.deliveryReceipt.transport, 'websocket');
}
assert.equal(entries.some((item: {data: {input: string}}) => item.data.input === 'must not enter after stop'), false);
assert.equal(fs.readFileSync(memoryFile, 'utf8').split('WAL_COMMIT:' + entry.id).length - 1, deniedMemory ? 0 : 1);
// Independent local public owners only. No graph creation just to clean up,
// private timer access, clearAllTimers, process.exit or shutdown-global claim.
const failures: unknown[] = [];
for (const retained of [getPublishedNarrative(), getPublishedResourceArbiter()]) {
    if (retained) try {await retained.stopAdmissions();} catch (error) {failures.push(error);}
}
try {continuousMemory.shutdown();} catch (error) {failures.push(error);}
const firstClosed = new Promise<void>(resolve => first.ws.once('close', () => resolve()));
const otherClosed = new Promise<void>(resolve => other.ws.once('close', () => resolve()));
first.ws.close(); other.ws.close();
await Promise.all([firstClosed, otherClosed]);
gateway.shutdown();
await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
if (failures.length) throw new AggregateError(failures, 'accepted-operation local cleanup incomplete');
await new Promise<void>(resolve => setImmediate(resolve));
const activeTimerEvidence = [...timerCreation].map(([id, timer]) => ({id, hasRef: timer.hasRef(), stack: timer.stack}));
console.log('ACCEPTED_TIMER_EVIDENCE ' + JSON.stringify({activeResources: process.getActiveResourcesInfo(), timers: activeTimerEvidence, overflow: timerTraceOverflow, scope: 'AT_LOCAL_CLEANUP_CUT_ONLY_NO_FUTURE_TIMER_ABSENCE_PROOF'}));
timerTrace.disable();
console.log('ACCEPTED_OWNER ' + JSON.stringify({accepted: true, joined: true, walId: entry.id, receipt: received.id, walStatus: entry.status, deniedMemory, stage: deniedMemory ? 'DELIVERED_PENDING_ERROR_RETAINED_JOINED_NATURAL_EXIT_AWAITED' : 'LOCAL_RECEIPT_COMMIT_JOIN_VERIFIED_NATURAL_EXIT_AWAITED', cognition: false, globalDrain: false}));
// Remaining initialized graph timers are intentionally NOT cleared. Parent must
// observe real natural exit before spawning successor and passing this case.
