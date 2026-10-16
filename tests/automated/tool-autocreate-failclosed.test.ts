import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const integration = readFileSync(join(ROOT, 'services', 'chatToolIntegration.ts'), 'utf8');
const executor = readFileSync(join(ROOT, 'services', 'planExecutor.ts'), 'utf8');

describe('PR-J: no more minted typos or lying plan successes', () => {
    it('J1: tool auto-creation is fail-closed behind CHAT_TOOL_AUTOCREATE', () => {
        expect(integration).toContain("process.env.CHAT_TOOL_AUTOCREATE !== 'true'");
        expect(integration).toContain('auto-creation disabled');
    });

    it('J2: a plan with zero successful steps reports failure', () => {
        expect(executor).toContain('successfulResults.length > 0');
        expect(executor).toContain('errors.length === 0 &&');
    });

    it('J3: role gate for auto-creation still present (ADMIN/CREATOR only when enabled)', () => {
        expect(integration).toContain("userRole !== 'ADMIN' && userRole !== 'CREATOR'");
    });
});
