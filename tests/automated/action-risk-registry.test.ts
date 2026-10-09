import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ActionType } from '../../types';
import {
    classifyActionType, mayAutoApprove, isRegisteredActionType, registeredActionTypes,
} from '../../services/security/actionRiskRegistry';
import { ActionExecutor } from '../../services/actionExecutor';

const mkAction = (type: string) => ({
    id: 'a1', agentId: 'test', type: type as any, payload: {}, status: 'PENDING' as any,
    requiresApproval: true, timestamp: Date.now(),
}) as any;

describe('Action risk registry (fail-closed)', () => {
    it('EXECUTE_PAYMENT is CRITICAL (regression: used to be LOW and auto-approved)', () => {
        expect(classifyActionType('EXECUTE_PAYMENT')).toMatchObject({ risk: 'CRITICAL', known: true });
        expect(mayAutoApprove('EXECUTE_PAYMENT')).toBe(false);
    });

    it('unknown / malformed types are never auto-approved', () => {
        for (const t of ['FOO_BAR', '', undefined, null, 42, '__proto__', 'constructor', 'toString']) {
            const c = classifyActionType(t as any);
            expect(c.known).toBe(false);
            expect(c.risk).toBe('HIGH');
            expect(mayAutoApprove(t as any)).toBe(false);
        }
    });

    it('every ActionType enum member is registered', () => {
        for (const v of Object.values(ActionType)) {
            expect(isRegisteredActionType(v as string), `ActionType ${v} is not registered`).toBe(true);
        }
    });

    it('every action type string literal used in services is registered', () => {
        const root = path.resolve(__dirname, '../../services');
        const found = new Set<string>();
        const walk = (d: string) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
                else if (/\.ts$/.test(e.name)) {
                    const src = fs.readFileSync(p, 'utf8');
                    for (const m of src.matchAll(/type:\s*'([A-Z][A-Z_]+)'\s*as any/g)) found.add(m[1]);
                }
            }
        };
        walk(root);
        for (const t of found) expect(isRegisteredActionType(t), `Unregistered: ${t}`).toBe(true);
    });

    it('registry covers all previously hard-coded risk types with same or higher risk', () => {
        expect(classifyActionType('EXECUTE_COMMAND').risk).toBe('CRITICAL');
        expect(classifyActionType('DELETE_FILE').risk).toBe('CRITICAL');
        expect(classifyActionType('WRITE_FILE').risk).toBe('HIGH');
        expect(classifyActionType('HTTP_REQUEST').risk).toBe('MEDIUM');
        expect(registeredActionTypes().length).toBeGreaterThan(10);
    });

    it('requestConfirmation does NOT auto-approve payments or unknown types', async () => {
        const ex = new ActionExecutor();
        for (const t of ['EXECUTE_PAYMENT', 'TOTALLY_UNKNOWN']) {
            const p = ex.requestConfirmation(mkAction(t), 'test');
            const pending = ex.getPendingConfirmations();
            expect(pending.length).toBe(1);
            expect(['HIGH', 'CRITICAL']).toContain(pending[0].riskLevel);
            ex.rejectAction(pending[0].id);
            expect(await p).toBe(false);
        }
    });

    it('requestConfirmation still auto-approves registered LOW actions (no capability lost)', async () => {
        const ex = new ActionExecutor();
        expect(await ex.requestConfirmation(mkAction('READ_FILE'))).toBe(true);
    });
});
