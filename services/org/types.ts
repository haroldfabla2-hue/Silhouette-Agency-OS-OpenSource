/**
 * Organization-as-data: types for the team roster.
 *
 * The audit (12-oct, priority #1) found the multiagent organization only
 * existed as hardcoded maps inside the orchestrator. This module makes the
 * org chart data: loadable from data/organization.json, overridable per
 * tenant, with a deterministic seed fallback derived from the kernel agents
 * so a fresh install always has a valid org.
 */

export interface AgentLike {
    id: string;
    name: string;
    role?: string;
    teamId?: string;
    roleType?: string;  // 'LEADER' | 'WORKER' | ... (AgentRoleType)
    tier?: string;
}

export interface OrgTeam {
    id: string;                 // e.g. 'TEAM_CORE'
    name: string;
    headAgentId: string;        // team head: receives escalations
    memberAgentIds: string[];   // executors (head is NOT repeated here)
    domains: string[];          // capability keywords used for routing
    tenantId: string;
}

export interface OrgChart {
    version: number;
    tenantId: string;
    teams: OrgTeam[];
    /** agents not assigned to any team (still routable individually) */
    unassignedAgentIds: string[];
}

/** Serialized shape of data/organization.json (user-editable). */
export interface OrganizationFile {
    version: number;
    tenantId?: string;
    teams: Array<{
        id: string;
        name: string;
        headAgentId: string;
        memberAgentIds?: string[];
        domains?: string[];
    }>;
}
