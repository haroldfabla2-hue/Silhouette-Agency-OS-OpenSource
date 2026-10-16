/**
 * Source-audit: the chat tool bridge. Regression guards for the 2026-10-16
 * findings:
 *  - buildSystemPrompt (which carries the [TOOL:] protocol) was built and
 *    DISCARDED in /stream, so the model never saw the tool protocol and
 *    narrated actions without executing them.
 *  - /stream executed inline tool calls as GUEST regardless of the caller.
 *  - /message had no tool bridge at all.
 *  - LLM-driven tool auto-creation was open to GUESTs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const controller = readFileSync(join(ROOT, 'server', 'controllers', 'chatController.ts'), 'utf8');
const integration = readFileSync(join(ROOT, 'services', 'chatToolIntegration.ts'), 'utf8');

describe('chat tool bridge', () => {
    it('stream prompt includes the system prompt (tool protocol)', () => {
        expect(controller).not.toMatch(/^\s*this\.buildSystemPrompt\(purifiedContext\.code \|\| ''\);$/m);
        expect(controller).toContain('const systemPrompt = this.buildSystemPrompt(purifiedContext.code');
        expect(controller).toContain('`${systemPrompt}\\n\\n${this.buildPromptPurified(userMessage, purifiedContext)}`');
    });

    it('stream executes inline tool calls under the caller role', () => {
        expect(controller).toContain('processToolCalls(fullResponse, userRole)');
    });

    it('/message routes through the same bridge', () => {
        expect(controller).toContain('processToolCalls(response, userRole)');
        expect(controller).toContain('content: finalText,');
    });

    it('tool auto-creation is gated to ADMIN/CREATOR', () => {
        expect(integration).toContain("userRole !== 'ADMIN' && userRole !== 'CREATOR'");
        expect(integration).toContain('auto-creation requires ADMIN/CREATOR');
    });
});
