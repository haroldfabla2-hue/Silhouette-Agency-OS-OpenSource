/**
 * TOOL EFFECT CLASSIFICATION (2026-11-05, corregido tras revisión estática R8)
 *
 * Root fix for the plugin confirmation-gate bypass. Before this module,
 * human-confirmation gating consulted a fixed 5-name list
 * (confirmationGate.EXTERNAL_EFFECT_TOOLS) plus securityManager's
 * DANGEROUS_TOOLS; both default-ALLOWED anything unlisted. Plugin tools
 * with external side effects (trello_create_card, notion_create_page,
 * google_calendar_create_event, google_gmail_send, ...) - and every future
 * plugin - executed with NO human confirmation on any path.
 *
 * This module is the single source of truth for "what kind of effect can
 * this tool cause?":
 *  - plugin tools declare `effects` in their PluginToolDefinition;
 *  - core/handler tools are classified in CORE_TOOL_EFFECTS below
 *    (exhaustive over the toolHandler switch + static registry);
 *  - dynamic DB tools (query_*_db_*) are classified by PATTERN_CLASSES;
 *  - anything else resolves to 'unclassified'.
 *
 * FAIL CLOSED: requiresHumanConfirmation() is true only for
 * 'external_comms', 'external_publish', 'wallet_bearing' and
 * 'unclassified', so an undeclared (future or third-party) tool requires
 * explicit human confirmation instead of silently executing.
 *
 * RESIDUAL PATHS NOT COVERED BY THIS GATE (documented, next batch):
 *  - MCP server: exposes tools outside executeCapability (pre-existing
 *    documented bypass class).
 *  - Direct provider callers that skip executeCapability (the 2026-10-23
 *    audit note names imageFactory, gmailService, videoFactory) and any
 *    direct geminiService/streamAdapters callers: covered only where the
 *    provider service itself enforces a boundary; NOT audited here.
 *  - 'domain_gated' tools (payments_*, vault_*, browser_autofill_payment):
 *    the human loop lives in their domain boundary, VERIFIED in source on
 *    2026-11-05: paymentGateway.gated() binds provider+destination+amount;
 *    financialVault.requestVirtualCard goes through
 *    actionExecutor.requestConfirmation; browser autofill requires an
 *    attributed approval at the visualBrowserEngine boundary (added in
 *    this branch - previously it had NO deep gate).
 *  - Classification is metadata: a plugin that LIES about its effects is
 *    out of scope for this fix (declared limit, same as v4's declared
 *    limits). Absence of metadata is enforcement (fail closed); false
 *    metadata is not.
 */
import { toolRegistry } from '../tools/toolRegistry';

export type ToolEffectClass =
    | 'read_only'        // no side effects (search, list, read, status)
    | 'internal'         // local-only side effects (files, workspace, assets, registry, local DB, internal bus)
    | 'external_read'    // outbound interaction without intended side effects (web browsing/reading)
    | 'external_comms'   // communicates to third parties as the user (email, phone calls)
    | 'external_publish' // creates/updates state on external services (trello, notion, calendar, docs, PRs, browser form actions)
    | 'wallet_bearing'   // spends money or credits without a domain budget gate (cloud generation)
    | 'domain_gated'     // wallet/sensitive, but the human loop lives in its domain service (paymentGateway/financialVault); NOT re-verified in this cut
    | 'unclassified';    // no declaration; fail closed (confirmation required)

/** Exhaustive classification of the toolHandler switch (86 case labels,
 *  enumerated 2026-11-05) plus statically registered core tools and
 *  generate_voice. Conservative on purpose: over-classifying costs one
 *  extra confirmation; under-classifying reopens the bypass. */
export const CORE_TOOL_EFFECTS: Readonly<Record<string, ToolEffectClass>> = Object.freeze({
    // The originally gated five (dedicated EFFECT_POLICIES still govern)
    send_email: 'external_comms',
    github_create_pr: 'external_publish',
    generate_image: 'wallet_bearing',
    generate_video: 'wallet_bearing',
    generate_voice: 'wallet_bearing',
    start_video_production: 'wallet_bearing',
    // Wallet/sensitive with their OWN domain human loop (paymentGateway /
    // financialVault; see RESIDUAL PATHS above - not re-verified here)
    payments_initiate: 'domain_gated',
    payments_confirm: 'domain_gated',
    payments_payout: 'domain_gated',
    vault_request_vcard: 'domain_gated',
    vault_burn_card: 'domain_gated',
    browser_autofill_payment: 'domain_gated',
    // External comms as the user (telephony)
    telephony_dial_phone: 'external_comms',
    telephony_barge_in: 'external_comms',
    telephony_send_dtmf: 'external_comms',
    telephony_hangup: 'external_comms',
    // Browser subagent: side-effecting actions vs reads
    browser_action: 'external_publish',
    browser_click_coordinate: 'external_publish',
    browser_visual_act: 'external_publish',
    browser_clear_obstructions: 'external_publish',
    browser_navigate: 'external_read',
    browser_extract: 'external_read',
    browser_screenshot: 'external_read',
    browser_visual_observe: 'external_read',
    browser_visual_overlay: 'external_read',
    browser_audit_session: 'external_read',
    browser_ai_perception: 'external_read',
    read_url: 'external_read',
    // Local-only side effects (legacy behavior preserved: no chat gate)
    write_file: 'internal',
    workspace_create: 'internal',
    workspace_update: 'internal',
    execute_code: 'internal',      // guarded by SecuritySquad review
    shell_exec: 'internal',
    manage_asset: 'internal',
    archive: 'internal',           // assetCatalog local ops
    delete: 'internal',
    favorite: 'internal',
    highlight: 'internal',
    move: 'internal',
    rename: 'internal',
    tag: 'internal',
    untag: 'internal',
    visual_compose: 'internal',
    visual_execute: 'internal',
    navigate_to: 'internal',       // UI-only actions
    ui_action: 'internal',
    click_button: 'internal',
    close_panel: 'internal',
    open_panel: 'internal',
    scroll_to: 'internal',
    show_tooltip: 'internal',
    delegate_task: 'internal',
    create_presentation: 'internal',
    create_tool: 'internal',       // newly created tools register 'unclassified' -> gated on use
    create_plugin: 'internal',     // plugins register per-tool effects; undeclared -> gated
    create_skill: 'internal',
    architect_audit: 'internal',
    conduct_research: 'internal',
    update_system_config: 'internal',
    analyze_and_repair: 'internal',
    system_execute_command: 'internal',
    system_open_app: 'internal',
    request_collaboration: 'internal', // in-process systemBus HELP_REQUEST only (helpProtocol.ts)
    telephony_process_turn: 'internal',
    // Read-only
    get_emails: 'read_only',       // alias of read_inbox (toolHandler.ts:103)
    read_inbox: 'read_only',
    introspect_database: 'read_only',
    list_visual_assets: 'read_only',
    search_assets: 'read_only',
    preview_asset: 'read_only',
    web_search: 'read_only',
    academic_search: 'read_only',
    github_list_prs: 'read_only',
    github_check_pr: 'read_only',
    get_production_status: 'read_only',
    list_productions: 'read_only',
    read_file: 'read_only',
    list_files: 'read_only',
    list_my_tools: 'read_only',
    workspace_read: 'read_only',
    workspace_list: 'read_only',
    workspace_search: 'read_only',
    recall_deep: 'read_only',
    rea_analyze: 'read_only',
    read_architecture: 'read_only',
    read_system_logs: 'read_only',
    get_system_config: 'read_only',
    system_get_info: 'read_only',
    system_get_screenshot: 'read_only',
    telephony_analyze_sentiment: 'read_only',
    payments_status: 'read_only',
    payments_providers: 'read_only',
    vault_get_spend_summary: 'read_only',
});

/** Dynamic-name patterns (tools registered at runtime whose names are not
 *  enumerable). query_*_db_* is 'read_only' ONLY because of the CURRENT
 *  Safe Mode, verified in source 2026-11-05: dbIntrospector.executeQuery
 *  opens every connection with { readonly: true } AND rejects any
 *  non-SELECT statement (dbIntrospector.ts:164-170). If Safe Mode ever
 *  becomes configurable or write-capable, this classification MUST be
 *  revisited - the real boundary is the readonly connection, not this
 *  label. */
export const PATTERN_CLASSES: ReadonlyArray<{ matches: (name: string) => boolean; effects: ToolEffectClass }> = Object.freeze([
    { matches: (n) => n.startsWith('query_') && n.includes('_db_'), effects: 'read_only' },
]);

/** Only these classes run without a human confirmation (legacy behavior).
 *  Everything else - including 'unclassified' - requires one. */
export function requiresHumanConfirmation(cls: ToolEffectClass): boolean {
    return cls === 'external_comms' || cls === 'external_publish'
        || cls === 'wallet_bearing' || cls === 'unclassified';
}

/** Resolve a tool's effect class: explicit registration metadata (plugins
 *  declare it) wins, then the core map, then dynamic-name patterns, then
 *  fail-closed 'unclassified'. A tool with no declaration is NEVER
 *  treated as safe by default. */
export function getToolEffectClass(toolName: string): ToolEffectClass {
    try {
        const declared = toolRegistry.getTool(toolName)?.effects;
        if (declared) return declared;
    } catch {
        // registry not initialized yet (early boot): fall through to the map
    }
    const core = CORE_TOOL_EFFECTS[toolName];
    if (core) return core;
    for (const p of PATTERN_CLASSES) {
        if (p.matches(toolName)) return p.effects;
    }
    return 'unclassified';
}
