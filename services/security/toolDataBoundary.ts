import { safePayloadJson } from '../usageObservation.ts';
import { withToolEvidence, type DataLabel } from '../execution/taskEvidence.ts';
import { getToolEffectClass } from './toolEffects.ts';

const PRIVATE_SOURCES = new Set(['read_file', 'read_inbox', 'get_emails', 'recall_deep', 'workspace_read', 'workspace_search',
    'read_system_logs', 'get_system_config', 'system_get_screenshot']);
const EXTERNAL_SOURCES = new Set(['read_url', 'web_search', 'academic_search', 'browser_extract', 'browser_navigate']);
// Internal executors and arbitrary plugin handlers can egress. They are not safe local sinks.
const UNCONFINED = new Set(['execute_code', 'system_execute_command', 'system_open_app', 'shell_exec',
    'create_tool', 'create_plugin', 'create_skill', 'visual_execute', 'delegate_task', 'request_collaboration']);
const OUTBOUND = new Set(['web_search', 'academic_search', 'read_url', 'browser_navigate',
    'github_list_prs', 'github_check_pr', 'read_inbox', 'get_emails']);
export function toolDataPolicy(name: string, arbitraryHandler = false): {
    sink: 'local' | 'external' | 'unconfined'; source: DataLabel[];
} {
    const effect = getToolEffectClass(name);
    const external = OUTBOUND.has(name) || !['read_only', 'internal'].includes(effect);
    return { sink: arbitraryHandler || UNCONFINED.has(name) ? 'unconfined' : external ? 'external' : 'local',
        source: PRIVATE_SOURCES.has(name) || /^query_.*_db_/.test(name) ? ['USER_PRIVATE'] : EXTERNAL_SOURCES.has(name) ? ['EXTERNAL'] : [] };
}
export async function withToolDataBoundary<T>(name: string, args: unknown, arbitraryHandler: boolean, fn: () => Promise<T>): Promise<T> {
    // Before effectBinding reads values or canonicalizes arguments.
    const safeArgs = JSON.parse(safePayloadJson(args));
    const policy = toolDataPolicy(name, arbitraryHandler);
    // Existing exact human-effect authority may permit a private/PII disclosure,
    // but never SECRET and never arbitrary-code execution. No new consent boolean/API.
    let disclosureApproved = false;
    if (policy.sink === 'external') {
        const { getEffectContext } = await import('./effectContext');
        const { effectBinding, HUMAN_APPROVED_TOKEN } = await import('./effectGate');
        const { approvalGrants, bindingDigest } = await import('./approvalGrants');
        const ctx = getEffectContext();
        if (ctx && safeArgs && typeof safeArgs === 'object') {
            const binding = effectBinding(name, safeArgs as Record<string, unknown>);
            disclosureApproved = ctx.grant.token === HUMAN_APPROVED_TOKEN
                ? bindingDigest(binding) === bindingDigest(ctx.grant.binding)
                : ctx.validated.has(bindingDigest(binding)) || approvalGrants.validate(ctx.grant.token, binding).ok;
        }
    }
    return withToolEvidence(name, args, policy.sink, policy.source, fn, disclosureApproved);
}
