/**
 * TOOL EFFECT CLASSIFICATION (2026-11-05)
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
 *  - core tools are classified in CORE_TOOL_EFFECTS below;
 *  - anything registered without a declaration resolves to 'unclassified'.
 *
 * FAIL CLOSED: requiresHumanConfirmation() is true for every class except
 * 'read_only' and 'internal', so an undeclared (future or third-party)
 * tool requires explicit human confirmation instead of silently executing.
 * That is exactly the bypass class this fixes: new plugins cannot repeat it
 * without an explicit (and auditable) declaration.
 */
import { toolRegistry } from '../tools/toolRegistry';

export type ToolEffectClass =
    | 'read_only'        // no side effects (search, list, read, status)
    | 'internal'         // local-only side effects (files, workspace, assets, registry)
    | 'external_comms'   // communicates to third parties as the user (email)
    | 'external_publish' // creates/updates state on external services (trello, notion, calendar, docs, PRs)
    | 'wallet_bearing'   // spends money or credits (cloud generation)
    | 'unclassified';    // no declaration; fail closed (confirmation required)

/** Exhaustive classification of core tools (the 35 statically registered
 *  ones plus core handler tools registered dynamically). Deliberately
 *  conservative: over-classifying costs one extra confirmation;
 *  under-classifying reopens the bypass. The five tools governed by
 *  EFFECT_POLICIES in effectGate keep their dedicated policies; this map
 *  is the fallback layer the chokepoint consults for everything else. */
export const CORE_TOOL_EFFECTS: Readonly<Record<string, ToolEffectClass>> = Object.freeze({
    // The originally gated five (dedicated EFFECT_POLICIES still govern)
    send_email: 'external_comms',
    github_create_pr: 'external_publish',
    generate_image: 'wallet_bearing',
    generate_video: 'wallet_bearing',
    generate_voice: 'wallet_bearing',
    start_video_production: 'wallet_bearing',
    // Local-only side effects (legacy behavior preserved: no chat gate)
    write_file: 'internal',
    workspace_create: 'internal',
    workspace_update: 'internal',
    execute_code: 'internal',      // guarded by SecuritySquad review
    shell_exec: 'internal',
    manage_asset: 'internal',
    visual_compose: 'internal',
    visual_execute: 'internal',
    navigate_to: 'internal',
    ui_action: 'internal',
    delegate_task: 'internal',
    create_presentation: 'internal',
    create_tool: 'internal',       // newly created tools register 'unclassified' -> gated on use
    architect_audit: 'internal',
    conduct_research: 'internal',
    // Read-only
    introspect_database: 'read_only',
    list_visual_assets: 'read_only',
    search_assets: 'read_only',
    preview_asset: 'read_only',
    web_search: 'read_only',
    read_url: 'read_only',
    academic_search: 'read_only',
    github_list_prs: 'read_only',
    github_check_pr: 'read_only',
    read_inbox: 'read_only',
    get_production_status: 'read_only',
    list_productions: 'read_only',
    read_file: 'read_only',
    list_files: 'read_only',
    workspace_read: 'read_only',
    workspace_list: 'read_only',
    workspace_search: 'read_only',
});

/** Only these classes run without a human confirmation (legacy behavior).
 *  Everything else - including 'unclassified' - requires one. */
export function requiresHumanConfirmation(cls: ToolEffectClass): boolean {
    return cls !== 'read_only' && cls !== 'internal';
}

/** Resolve a tool's effect class: explicit registration metadata (plugins
 *  declare it) wins, then the core map, then fail-closed 'unclassified'.
 *  A tool with no declaration is NEVER treated as safe by default. */
export function getToolEffectClass(toolName: string): ToolEffectClass {
    try {
        const declared = toolRegistry.getTool(toolName)?.effects;
        if (declared) return declared;
    } catch {
        // registry not initialized yet (early boot): fall through to the map
    }
    return CORE_TOOL_EFFECTS[toolName] ?? 'unclassified';
}
