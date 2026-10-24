import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../../../services/auth/accountStore';

const dirs: string[] = [];
function store(): AccountStore { const d = mkdtempSync(join(tmpdir(), 'as-')); dirs.push(d); return new AccountStore(join(d, 'accounts.db')); }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('AccountStore', () => {
    it('adds, activates and switches accounts per provider', () => {
        const s = store();
        s.add({ providerId: 'OPENAI_CODEX', accountId: 'work', label: 'Work', method: 'command', secretRef: 'file:tokens/codex-work.json' });
        s.add({ providerId: 'OPENAI_CODEX', accountId: 'personal', label: 'Personal', method: 'command', secretRef: 'env:CODEX_PERSONAL_REF' });
        s.activate('OPENAI_CODEX', 'work');
        expect(s.active('OPENAI_CODEX')?.accountId).toBe('work');
        s.activate('OPENAI_CODEX', 'personal');
        expect(s.active('OPENAI_CODEX')?.accountId).toBe('personal');
        expect(s.list('OPENAI_CODEX')).toHaveLength(2);
        s.close();
    });
    it('rejects secret material in secretRef', () => {
        const s = store();
        expect(() => s.add({ providerId: 'GEMINI', accountId: 'k', label: 'k', method: 'api-key', secretRef: 'sk-abc123' })).toThrow(/never contain/i);
        expect(() => s.add({ providerId: 'GEMINI', accountId: 'k', label: 'k', method: 'api-key', secretRef: 'AIzaSy123' })).toThrow();
        s.close();
    });
    it('tracks status transitions with error evidence', () => {
        const s = store();
        s.add({ providerId: 'GEMINI', accountId: 'main', label: 'Main', method: 'api-key', secretRef: 'env:GEMINI_API_KEY' });
        s.setStatus('GEMINI', 'main', 'expired', 'token expired');
        const a = s.list('GEMINI')[0];
        expect(a.status).toBe('expired');
        expect(a.lastError).toBe('token expired');
        expect(s.remove('GEMINI', 'main')).toBe(true);
        s.close();
    });
});
