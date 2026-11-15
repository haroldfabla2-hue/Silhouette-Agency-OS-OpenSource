/**
 * EXTERNAL GENERATION POLICY - hard block on potentially-paid external
 * generation (CERO COBROS).
 *
 * The campaign shotlist call reaches an external LLM (Gemini) whose cost
 * depends on the account's plan/entitlement - not verifiable from code,
 * and a quota budget is attempt accounting, not monetary authorization.
 * With no designed monetary grant mechanism, this delivery BLOCKS the
 * provider call unconditionally. There is deliberately NO config flag or
 * generic override: a boolean is not verifiable monetary authority and
 * would reopen spend (same class of risk as a generic allowPaidEffects).
 *
 * Future enablement requires a designed authorization mechanism -
 * specific, verifiable, non-boolean (e.g. a per-action grant backed by
 * verified entitlement) - which is a reserved owner decision. A
 * verifiably zero-cost route (e.g. a local model) is a separate
 * investigation, never assumed free by budget or defaults.
 *
 * Local preparation (request validation, brand DNA, brand rules) never
 * depends on this gate.
 */
export class ExternalGenerationDeniedError extends Error {
    public readonly code = 'EXTERNAL_GENERATION_DENIED' as const;
    constructor(reason: string) {
        super(`EXTERNAL_GENERATION_DENIED: ${reason}`);
        this.name = 'ExternalGenerationDeniedError';
    }
}

export function assertCampaignLlmGenerationAllowed(): void {
    throw new ExternalGenerationDeniedError(
        'campaign shotlist generation is blocked in this delivery (CERO COBROS): it calls an external LLM whose cost is entitlement-dependent and unverifiable from code, and no designed monetary authorization mechanism exists yet (a boolean flag is not monetary authority). Local preparation (request validation, brand DNA, brand rules) is unaffected.'
    );
}
