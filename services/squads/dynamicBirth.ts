/**
 * [W1] Dynamic squad birth helpers — deterministic, LLM-free, unit-testable.
 *
 * Factory fire test (cotizador-freelance, 2026-10-14) proved dynamic agents
 * were born as empty husks: name "undefined Lead", capabilities [], no
 * systemInstruction. The Orchestrator "delegated" work to them and the
 * workflow reported COMPLETE with zero artifacts produced — simulated
 * success, the failure mode this system explicitly forbids.
 *
 * These helpers make every dynamically spawned agent born COMPLETE:
 * a resolved name (never undefined), whitespace-free IDs, role-coherent
 * capabilities, and a deterministic system instruction with an honesty
 * contract. No LLM call is spent on any of this.
 */
import { AgentCapability } from '../../types';

/**
 * [PA-045] Resolve the squad name from a possibly double-wrapped payload.
 * The old code interpolated `payload.name` directly at agent creation,
 * producing the literal string "undefined Lead" when the mission payload
 * arrived wrapped as { payload: { name } }.
 */
export function resolveSquadName(payload: any): string {
    return (payload?.name || payload?.payload?.name || "Unknown Squad");
}

/**
 * Generate dynamic squad/leader IDs with NO trailing whitespace.
 * Legacy IDs were built as `SQ_DYN_${Date.now()} ` (trailing space inside
 * the template literal), which broke exact-match lookups and polluted
 * persistence keys. Old spaced IDs remain valid in the DB — reads fall
 * back to spaced/trimmed variants — so no migration is needed.
 */
export function generateDynamicIds(now: number = Date.now()): { squadId: string; leaderId: string } {
    return { squadId: `SQ_DYN_${now}`, leaderId: `agt_dyn_${now}` };
}

/** Deterministic role-text -> capability rules, evaluated in order. */
const DYNAMIC_ROLE_CAPABILITY_RULES: Array<{ pattern: RegExp; capability: AgentCapability }> = [
    { pattern: /develop|frontend|backend|full.?stack|engineer|program|cod/i, capability: AgentCapability.CODE_GENERATION },
    { pattern: /architect|system.?design|infra/i, capability: AgentCapability.SYSTEM_DESIGN },
    { pattern: /\bqa\b|test|quality/i, capability: AgentCapability.QA_TESTING },
    { pattern: /security|audit/i, capability: AgentCapability.SECURITY_AUDIT },
    { pattern: /\bux\b|\bui\b|design|visual/i, capability: AgentCapability.VISUAL_DESIGN },
    { pattern: /market|campaign|growth|ads/i, capability: AgentCapability.CAMPAIGN_STRATEGY },
    { pattern: /research|analyst|data|scien/i, capability: AgentCapability.RESEARCH },
    { pattern: /writ|content|copy|document/i, capability: AgentCapability.RESEARCH },
    { pattern: /legal|complian/i, capability: AgentCapability.LEGAL_COMPLIANCE },
    { pattern: /deploy|devops|\bops\b/i, capability: AgentCapability.DEPLOYMENT },
];

/**
 * Capabilities a dynamically spawned agent is born with.
 * Payload-provided capabilities win (validated against the enum; unknown
 * entries dropped). Otherwise a base set every agent needs (memory write,
 * web search, context management) plus role-coherent capabilities derived
 * deterministically from the role/category/name text.
 */
export function deriveDynamicCapabilities(payload: any): AgentCapability[] {
    const valid = new Set<string>(Object.values(AgentCapability));
    if (Array.isArray(payload?.capabilities)) {
        const fromPayload = payload.capabilities.filter(
            (c: unknown): c is AgentCapability => typeof c === 'string' && valid.has(c)
        );
        if (fromPayload.length > 0) {
            if (payloadDeclaresProject(payload)) {
                return Array.from(new Set([...fromPayload, AgentCapability.ACTION_FILE_READ, AgentCapability.ACTION_FILE_WRITE]));
            }
            return fromPayload;
        }
    }
    const caps = new Set<AgentCapability>([
        AgentCapability.CONTEXT_MANAGEMENT,
        AgentCapability.TOOL_MEMORY_WRITE,
        AgentCapability.TOOL_WEB_SEARCH,
    ]);
    const roleText = `${payload?.role || ''} ${payload?.category || ''} ${payload?.name || ''}`;
    for (const rule of DYNAMIC_ROLE_CAPABILITY_RULES) {
        if (rule.pattern.test(roleText)) caps.add(rule.capability);
    }
    if (payloadDeclaresProject(payload)) {
        caps.add(AgentCapability.ACTION_FILE_READ);
        caps.add(AgentCapability.ACTION_FILE_WRITE);
    }
    return [...caps];
}

/**
 * Birth grant: a squad born with an EXPLICIT project reference (projectId /
 * projectPath / project in the expansion payload) is born with the confined
 * filesystem capabilities. Text mentions of paths are deliberately NOT
 * parsed — the grant follows structured assignment, not prose. The jail (W2)
 * confines every actual write; this only makes the capability real and
 * visible from birth (DCR, UI, chat-path tool attachment).
 */
export function payloadDeclaresProject(payload: any): boolean {
    return Boolean(payload?.projectId || payload?.projectPath || payload?.project);
}

/**
 * Deterministic system instruction for a dynamically spawned squad leader.
 * Template-based (no LLM): identity, chain of command, and the honesty
 * contract that forbids simulated completion.
 */
export function buildDynamicLeaderInstruction(name: string, payload: any): string {
    const role = payload?.role || `Leader of the ${name} squad`;
    const category = payload?.category || 'GENERAL';
    return [
        `You are "${name} Lead", LEADER of the dynamically spawned squad "${name}" (category: ${category}).`,
        `Role: ${role}.`,
        `Chain of command: System -> Orchestrator -> Squad Leader (you) -> Workers. You decompose the mission, assign work to your squad, and integrate results.`,
        `Honesty contract: report UNAVAILABLE with the exact reason when you lack a capability or tool; never claim completion without produced, verifiable artifacts; never fabricate files, tests, or results.`,
        `Reverse engineering (if the mission involves analyzing external software): understand behavior and REWRITE FROM SCRATCH; never copy decompiled/extracted code; never analyze or bypass DRM or access protections; follow the reverse_engineering skill protocol.`,
        `Coordination: persist durable findings to memory; escalate blockers to the Orchestrator instead of simulating progress.`
    ].join('\n');
}

/**
 * [PR-4d] Birth policy (Alberto 2026-10-16): agents are long-lived assets
 * with soul, identity and history — a new one is born ONLY when no existing
 * agent can do the work. Order: validate contract -> reuse -> limits -> create.
 */

export interface BirthContractResult { ok: boolean; errors: string[] }

/**
 * Birth contract v1. name+category are already enforced by the PR-2 gate;
 * role drives capabilities, so it is required too. reason/missionId is the
 * work contract: strongly recommended — missing is allowed (warn) so existing
 * emitters keep working, and it becomes required in v2.
 */
export function validateBirthContract(payload: any): BirthContractResult {
    const inner = payload?.payload ?? payload ?? {};
    const errors: string[] = [];
    if (typeof inner.name !== 'string' || !inner.name.trim()) errors.push('name is required');
    if (typeof inner.category !== 'string' || !inner.category.trim()) errors.push('category is required');
    if (typeof inner.role !== 'string' || !inner.role.trim()) errors.push('role is required (it drives capabilities)');
    const hasReason = typeof inner.reason === 'string' && inner.reason.trim().length > 0;
    const hasMission = typeof inner.missionId === 'string' && inner.missionId.trim().length > 0;
    if (!hasReason && !hasMission) errors.push('warn: no reason/missionId — births should carry a work contract (required in v2)');
    return { ok: errors.filter(e => !e.startsWith('warn:')).length === 0, errors };
}

export interface ReusableAgentLike {
    id: string;
    name: string;
    category?: string;
    role?: string;
    status?: string;
    enabled?: boolean;
}

const normalize = (s: string | undefined): string => (s || '').toLowerCase().trim();

/**
 * Find an existing agent that can do this squad's work instead of birthing a
 * new one. Match = same category AND role overlap (either contains the other,
 * or shares a meaningful token >=4 chars). Excludes disabled/retired agents
 * and dynamic phantoms born without identity ("Unknown Squad Lead").
 */
export function findReusableAgent<T extends ReusableAgentLike>(agents: T[], spec: { name: string; category?: string; role?: string }): T | null {
    const cat = normalize(spec.category);
    const role = normalize(spec.role);
    const roleTokens = role.split(/[^a-z0-9]+/).filter(t => t.length >= 4);
    for (const a of agents) {
        if (!a || !a.id) continue;
        if (a.enabled === false) continue; // retired/FAILED
        if (a.name === 'Unknown Squad Lead') continue; // phantom husk
        if (cat && normalize(a.category) !== cat) continue;
        const aRole = normalize(a.role);
        if (!aRole) continue;
        const overlap = aRole.includes(role) || role.includes(aRole) ||
            roleTokens.some(t => aRole.includes(t));
        if (overlap) return a;
    }
    return null;
}

/** [PR-4d] Fleet limits (fleet = dynamic agents, the agt_dyn_* family). */
export const MAX_DYNAMIC_AGENTS = 50;
export const MAX_BIRTHS_PER_HOUR = 5;

/** Sliding-window rate limiter (in-memory; resets on restart — honest v1). */
export class BirthRateLimiter {
    private readonly stamps: number[] = [];
    public allow(now: number = Date.now()): boolean {
        const windowStart = now - 60 * 60 * 1000;
        while (this.stamps.length > 0 && this.stamps[0] < windowStart) this.stamps.shift();
        if (this.stamps.length >= MAX_BIRTHS_PER_HOUR) return false;
        this.stamps.push(now);
        return true;
    }
    public count(now: number = Date.now()): number {
        const windowStart = now - 60 * 60 * 1000;
        return this.stamps.filter(t => t >= windowStart).length;
    }
}
