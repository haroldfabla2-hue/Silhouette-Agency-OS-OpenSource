/**
 * Typed action-risk registry (fail-closed).
 *
 * Every action type the system can emit must be registered here with an
 * explicit risk level. A type that is NOT registered is never treated as
 * safe: it is classified HIGH and therefore always requires human
 * confirmation. Nothing is auto-approved by default.
 */

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface ActionRiskPolicy {
    risk: RiskLevel;
    /** Short rationale, shown to the human reviewer. */
    rationale: string;
}

const REGISTRY: Readonly<Record<string, ActionRiskPolicy>> = Object.freeze({
    // LOW: read-only or internal, no external side effect
    READ_FILE: { risk: 'LOW', rationale: 'Read-only file access' },
    SLEEP_CYCLE: { risk: 'LOW', rationale: 'Internal consolidation cycle' },
    EPISTEMIC_SCAN: { risk: 'LOW', rationale: 'Internal read-only scan' },
    GENERATE_VIDEO: { risk: 'LOW', rationale: 'Local generation, no external commitment' },

    // MEDIUM: external communication
    HTTP_REQUEST: { risk: 'MEDIUM', rationale: 'Outbound network request' },
    SEND_EMAIL: { risk: 'MEDIUM', rationale: 'Outbound email' },
    API_REQUEST: { risk: 'MEDIUM', rationale: 'Outbound API call' },

    EVALUATE_WEBHOOK: { risk: 'MEDIUM', rationale: 'Reacts to externally supplied webhook data' },

    // HIGH: modifies system state
    CONSCIOUSNESS_PROACTIVE: { risk: 'HIGH', rationale: 'Autonomous proactive action that asks for explicit user consent' },
    WRITE_FILE: { risk: 'HIGH', rationale: 'Modifies files' },
    SELF_CODE_EDIT: { risk: 'HIGH', rationale: 'Modifies own source code' },

    // CRITICAL: data loss, arbitrary execution, money, irreversible effects
    EXECUTE_COMMAND: { risk: 'CRITICAL', rationale: 'Arbitrary command execution' },
    EXECUTE_SHELL: { risk: 'CRITICAL', rationale: 'Arbitrary shell execution' },
    DELETE_FILE: { risk: 'CRITICAL', rationale: 'Irreversible deletion' },
    EXECUTE_PAYMENT: { risk: 'CRITICAL', rationale: 'Moves or commits money' },
    ISSUE_VIRTUAL_CARD: { risk: 'CRITICAL', rationale: 'Issues a payment instrument' },
    TRANSFER_FUNDS: { risk: 'CRITICAL', rationale: 'Moves money' },
    PLACE_PHONE_CALL: { risk: 'CRITICAL', rationale: 'Speaks to a third party on the user behalf' },
    SUBMIT_SENSITIVE_FORM: { risk: 'CRITICAL', rationale: 'Submits financial or identity data' },
});

/** Risk assigned to any type that is not registered. */
export const UNKNOWN_ACTION_RISK: RiskLevel = 'HIGH';

export interface ActionClassification {
    risk: RiskLevel;
    known: boolean;
    rationale: string;
}

export function classifyActionType(type: unknown): ActionClassification {
    const key = typeof type === 'string' ? type : '';
    if (Object.prototype.hasOwnProperty.call(REGISTRY, key)) {
        const p = REGISTRY[key];
        return { risk: p.risk, known: true, rationale: p.rationale };
    }
    return {
        risk: UNKNOWN_ACTION_RISK,
        known: false,
        rationale: `Unregistered action type "${key || String(type)}": denied by default, human confirmation required`,
    };
}

export function isRegisteredActionType(type: string): boolean {
    return Object.prototype.hasOwnProperty.call(REGISTRY, type);
}

export function registeredActionTypes(): string[] {
    return Object.keys(REGISTRY);
}

/** Only LOW risk (and registered) actions may skip human confirmation. */
export function mayAutoApprove(type: unknown): boolean {
    const c = classifyActionType(type);
    return c.known && c.risk === 'LOW';
}
