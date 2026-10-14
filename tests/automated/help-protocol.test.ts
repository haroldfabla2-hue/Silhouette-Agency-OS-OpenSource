import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { SystemProtocol } from '../../types';
import { systemBus } from '../../services/systemBus';
import { emitHelpResponse, requestCollaboration, subscribeHelpProtocol } from '../../services/communication/helpProtocol';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(off => off()); });
async function mailbox(id: string) {
    await new Promise(resolve => setImmediate(resolve));
    return systemBus.checkMailbox(id);
}

describe('real inter-agent help transport (no mocked bus or helpers)', () => {
    it('closes tool request -> helper mailbox -> response event -> requesting mailbox with correlation', async () => {
        const requesterId = crypto.randomUUID();
        const helperId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({ findHelper: role => role === 'Librarian' ? helperId : null,
            prepare: async request => request.context }));
        const sent = requestCollaboration({ target_role: 'Librarian', message: 'Read the project license', context: 'LICENSE' },
            { requesterId, requesterRole: 'Developer' });
        expect(sent.status).toBe('queued');
        const requests = await mailbox(helperId);
        expect(requests).toHaveLength(1);
        expect(requests[0].payload).toMatchObject({ requesterId, requesterRole: 'Developer', problem: 'Read the project license', requestId: sent.id, context: 'LICENSE' });
        // Perform a real deterministic helper task. This validates transport, not LLM quality.
        const solution = await readFile('LICENSE', 'utf8');
        emitHelpResponse(requests[0].payload, helperId, solution, true);
        const responses = await mailbox(requesterId);
        expect(responses).toHaveLength(1);
        expect(responses[0].protocol).toBe(SystemProtocol.HELP_RESPONSE);
        expect(responses[0].traceId).toBe(sent.id);
        expect(responses[0].payload).toEqual({ requestId: sent.id, requesterId, helperId, solution, success: true });
        expect(await mailbox(helperId)).toHaveLength(0);
    });
    it('returns a correlated explicit failure when no specialist exists', async () => {
        const requesterId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({ findHelper: () => null, prepare: async () => undefined }));
        const sent = requestCollaboration({ target_role: 'absent', message: 'help' }, { requesterId });
        const responses = await mailbox(requesterId);
        expect(responses).toHaveLength(1);
        expect(responses[0].payload).toMatchObject({ requestId: sent.id, requesterId, success: false });
    });
    it('closes failures during hydration/preparation instead of leaving requests hanging', async () => {
        const requesterId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({ findHelper: () => 'missing-agent', prepare: async () => { throw new Error('Unavailable specialist'); } }));
        const sent = requestCollaboration({ target_role: 'Developer', message: 'help' }, { requesterId });
        const responses = await mailbox(requesterId);
        expect(responses).toHaveLength(1);
        expect(responses[0].payload).toMatchObject({ requestId: sent.id, success: false, solution: 'Unable to route help: Unavailable specialist' });
    });
    it('rejects anonymous callers and does not take requester identity from tool arguments', () => {
        expect(requestCollaboration({ target_role: 'Librarian', message: 'help' })).toHaveProperty('error');
        expect(requestCollaboration({ target_role: 'Librarian', message: '' }, { requesterId: 'a' })).toHaveProperty('error');
    });
    it('unsubscribes real memory-bus handlers without duplicate delivery', async () => {
        const requesterId = crypto.randomUUID();
        const off = subscribeHelpProtocol({ findHelper: () => null, prepare: async () => undefined });
        off();
        requestCollaboration({ target_role: 'absent', message: 'help' }, { requesterId });
        expect(await mailbox(requesterId)).toHaveLength(0);
    });
    it('keeps runtime wiring connected to the tested protocol', async () => {
        const orchestrator = await readFile('services/orchestrator.ts', 'utf8');
        const handler = await readFile('services/tools/toolHandler.ts', 'utf8');
        const stream = await readFile('services/agentStream.ts', 'utf8');
        expect(orchestrator).toContain('subscribeHelpProtocol({');
        expect(handler).toContain('requestCollaborationAndWait(args as RequestCollaborationArgs, caller)');
        expect(stream).toContain('emitHelpResponse(source.payload, agent.id');
        expect(orchestrator).toContain('void agentStreamer.handleIncomingMessage(agent, msg).catch');
    });
});
