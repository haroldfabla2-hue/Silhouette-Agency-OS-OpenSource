/**
 * EXTERNAL GENERATION POLICY - fail-closed control for potentially-paid
 * external generation.
 *
 * A campaign shotlist call reaches an external LLM (Gemini) whose cost
 * depends on the account's plan/entitlement. That entitlement cannot be
 * verified from code, and an existing daily quota budget (quotaLedger) is
 * attempt ACCOUNTING, not monetary authorization. CERO COBROS: absent
 * verifiable evidence of zero cost, the default is DENY.
 *
 * Enabling (CAMPAIGN_LLM_GENERATION=allow) is a reserved owner/ops decision
 * that must follow explicit authorization after entitlement verification;
 * it is never inferred from config presence, quota headroom or an
 * authenticated request. Local preparation (validation, brand DNA, brand
 * rules) never depends on this gate.
 */
export class ExternalGenerationDeniedError extends Error {
    public readonly code = 'EXTERNAL_GENERATION_DENIED' as const;
    constructor(reason: string) {
        super(`EXTERNAL_GENERATION_DENIED: ${reason}`);
        this.name = 'ExternalGenerationDeniedError';
    }
}

export function isCampaignLlmGenerationAllowed(): boolean {
    return process.env.CAMPAIGN_LLM_GENERATION === 'allow';
}

export function assertCampaignLlmGenerationAllowed(): void {
    if (!isCampaignLlmGenerationAllowed()) {
        throw new ExternalGenerationDeniedError(
            'campaign shotlist generation calls an external LLM whose cost depends on account entitlement this deployment cannot verify (CERO COBROS). Enable CAMPAIGN_LLM_GENERATION=allow only after explicit owner authorization. Local preparation (request validation, brand DNA, brand rules) is unaffected.'
        );
    }
}
