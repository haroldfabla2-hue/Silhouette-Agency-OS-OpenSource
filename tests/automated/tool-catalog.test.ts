import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as defs from '../../services/tools/definitions';

// Handlers that exist but are deliberately NOT offered to the model (system control / UI-only / email).
// Adding a handler without exposing it must be a conscious decision: add it here with a reason.
const INTENTIONALLY_UNEXPOSED = new Set([
    'create_plugin', 'request_collaboration', 'send_email', 'get_emails', 'read_inbox',
    'get_system_config', 'update_system_config', 'read_architecture', 'read_system_logs', 'analyze_and_repair',
    'rename', 'tag', 'untag', 'move', 'favorite', 'archive', 'delete',
    'open_panel', 'close_panel', 'highlight', 'show_tooltip', 'scroll_to', 'click_button',
]);

describe('tool catalog vs handlers (orphan detection)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/tools/toolHandler.ts'), 'utf8');
    const handled = [...new Set([...src.matchAll(/case '([a-z_0-9]+)':/g)].map(m => m[1]))];
    const d: any = defs;
    const exposed = new Set<string>(
        [...d.AGENT_TOOLS, ...d.ALL_TOOLS, ...d.DEVELOPMENT_TOOLS, ...d.UI_CONTROL_TOOLS, ...d.PRESENTATION_TOOLS, ...d.COMPLETE_TOOLS].map((t: any) => t.name)
    );

    it('every handler is either offered to the model or explicitly listed as unexposed', () => {
        const orphans = handled.filter(h => !exposed.has(h) && !INTENTIONALLY_UNEXPOSED.has(h));
        expect(orphans).toEqual([]);
    });

    it('regression: browser, vault and telephony tools reach the model catalog (they were orphaned)', () => {
        for (const n of ['browser_navigate', 'browser_clear_obstructions', 'vault_request_vcard', 'vault_get_spend_summary', 'telephony_dial_phone', 'telephony_hangup', 'browser_audit_session']) {
            expect(exposed.has(n), n).toBe(true);
        }
    });

    it('allowlist has no stale entries (handler removed or already exposed)', () => {
        const stale = [...INTENTIONALLY_UNEXPOSED].filter(n => !handled.includes(n) || exposed.has(n));
        expect(stale).toEqual([]);
    });

    it('catalog has no duplicate tool names', () => {
        const names = d.AGENT_TOOLS.map((t: any) => t.name);
        expect(new Set(names).size).toBe(names.length);
    });
});
