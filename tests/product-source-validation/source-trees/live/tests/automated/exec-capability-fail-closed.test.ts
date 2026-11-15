/**
 * Source-audit: executeCapability must fail CLOSED when the security policy
 * engine cannot be consulted. Regression guard for the fail-open chokepoint
 * found 2026-10-16 (a broken securityManager import silently disabled the
 * operator denylist).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', '..', 'services', 'orchestrator.ts'), 'utf8');

describe('executeCapability security chokepoint', () => {
    it('never fails open', () => {
        expect(SRC).not.toContain('fail open');
        expect(SRC).toContain('SECURITY_UNAVAILABLE');
    });

    it('deny result is returned and emitted on policy-engine failure', () => {
        const block = SRC.slice(SRC.indexOf('SECURITY_UNAVAILABLE') - 800, SRC.indexOf('SECURITY_UNAVAILABLE') + 1200);
        expect(block).toContain('success: false');
        expect(block).toContain('emitCapabilityResult');
        expect(block).toContain('return denied');
    });
});
