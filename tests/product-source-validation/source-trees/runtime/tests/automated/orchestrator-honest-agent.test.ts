import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const orchestrator = readFileSync(join(ROOT, 'services', 'orchestrator.ts'), 'utf8');

describe('PR-M: orchestrator ROUTE 2 stops reporting aborts/blank output as success', () => {
    it('M1: IDLE_CONCLUSION abort sentinel unwraps to failure', () => {
        expect(orchestrator).toContain("startsWith('Operation aborted:')");
    });

    it('M2: blank agent output unwraps to failure', () => {
        expect(orchestrator).toContain('returned empty output');
        expect(orchestrator).toContain('success: false,');
    });
});
