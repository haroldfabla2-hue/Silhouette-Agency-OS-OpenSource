/**
 * Root-fix proof for "help responses nobody hears": requestCollaborationAndWait
 * returns the real answer inside the caller's own turn.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { requestCollaborationAndWait, subscribeHelpProtocol } from '../../services/communication/helpProtocol';
import { systemBus, SystemProtocol } from '../../services/systemBus';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(off => off()); });
async function mailbox(id: string) {
    await new Promise(resolve => setImmediate(resolve));
    return systemBus.checkMailbox(id);
}

describe('requestCollaborationAndWait (the caller actually hears the answer)', () => {
    it('resolves with the real solution the helper produced', async () => {
        const requesterId = crypto.randomUUID();
        const helperId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({ findHelper: () => helperId, prepare: async r => r.context }));
        const pending = requestCollaborationAndWait({ target_role: 'Librarian', message: 'Read the project license' }, { requesterId });
        // The helper acts on its mailbox, as the live agent stream does.
        const requests = await mailbox(helperId);
        const solution = await readFile('LICENSE', 'utf8');
        const { emitHelpResponse } = await import('../../services/communication/helpProtocol');
        emitHelpResponse(requests[0].payload, helperId, solution, true);
        const result = await pending;
        expect(result).toMatchObject({ status: 'answered', helperId, success: true });
        expect((result as any).solution).toContain('MIT'); // the real LICENSE content
    });
    it('resolves with an explicit failure when no specialist exists (not silence)', async () => {
        const requesterId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({ findHelper: () => null, prepare: async () => undefined }));
        const result = await requestCollaborationAndWait({ target_role: 'absent', message: 'help' }, { requesterId });
        expect(result).toMatchObject({ status: 'answered', success: false });
        expect((result as any).solution).toContain('No specialist found');
    });
    it('times out explicitly instead of hanging the tool loop', async () => {
        const requesterId = crypto.randomUUID();
        // Helper exists but never answers: no subscribeHelpProtocol at all.
        const result = await requestCollaborationAndWait({ target_role: 'Ghost', message: 'help' }, { requesterId }, { timeoutMs: 50 });
        expect(result.status).toBe('timeout');
        expect((result as any).message).toContain('Ghost');
    });
    it('rejects anonymous callers and bad args', async () => {
        expect(await requestCollaborationAndWait({ target_role: 'X', message: 'help' })).toHaveProperty('error');
        expect(await requestCollaborationAndWait({ target_role: '', message: 'help' }, { requesterId: 'a' })).toHaveProperty('error');
    });
    it('ignores responses correlated to other requests', async () => {
        const requesterId = crypto.randomUUID();
        const helperId = crypto.randomUUID();
        cleanups.push(subscribeHelpProtocol({ findHelper: () => helperId, prepare: async r => r.context }));
        const pending = requestCollaborationAndWait({ target_role: 'Librarian', message: 'help' }, { requesterId }, { timeoutMs: 500 });
        const { emitHelpResponse } = await import('../../services/communication/helpProtocol');
        emitHelpResponse({ requestId: 'someone-elses-request', requesterId: 'other' }, helperId, 'not for you', true);
        const requests = await mailbox(helperId);
        emitHelpResponse(requests[0].payload, helperId, 'the real answer', true);
        const result = await pending;
        expect(result).toMatchObject({ status: 'answered', solution: 'the real answer' });
    });
});

describe('tool loop wiring (structural)', () => {
    it('toolHandler awaits the answer and geminiService derives identity from the executing agent', async () => {
        const toolHandler = await readFile(require('path').resolve(__dirname, '../../services/tools/toolHandler.ts'), 'utf8');
        expect(toolHandler).toContain('await requestCollaborationAndWait(');
        const gemini = await readFile(require('path').resolve(__dirname, '../../services/geminiService.ts'), 'utf8');
        expect(gemini).toContain('projectContext?.toolCaller\n');
        expect(gemini).toContain('{ requesterId: agentName, requesterRole: agentRole }');
    });
});
