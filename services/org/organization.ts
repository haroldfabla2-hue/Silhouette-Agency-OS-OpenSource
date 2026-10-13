/**
 * Organization loader: org chart as data, never hardcoded.
 *
 * Sources, in order:
 *   1. data/organization.json (if present and valid) — the operator's roster.
 *   2. Deterministic seed derived from the known agents (group by teamId,
 *      head = LEADER-role agent, fallback = first member). A fresh install
 *      always has a working org; the file only customizes it.
 *
 * The loader never throws: an invalid file logs loudly and falls back to the
 * seed (Silhouette convention: failures must be visible, never silent).
 */

import fs from 'fs';
import path from 'path';
import { AgentLike, OrgChart, OrganizationFile, OrgTeam } from './types';

const DEFAULT_TENANT = 'default';
const UNASSIGNED_TEAM = 'TEAM_UNASSIGNED';

function deriveSeedChart(agents: AgentLike[], tenantId: string): OrgChart {
    const byTeam = new Map<string, AgentLike[]>();
    const unassigned: string[] = [];
    for (const agent of agents) {
        const teamId = agent.teamId?.trim();
        if (!teamId) { unassigned.push(agent.id); continue; }
        const list = byTeam.get(teamId) || [];
        list.push(agent);
        byTeam.set(teamId, list);
    }
    const teams: OrgTeam[] = [...byTeam.entries()].map(([id, members]) => {
        const head = members.find(m => m.roleType === 'LEADER') || members[0];
        return {
            id,
            name: id.replace(/^TEAM_/, '').toLowerCase(),
            headAgentId: head.id,
            memberAgentIds: members.filter(m => m.id !== head.id).map(m => m.id),
            // domains are seeded from member roles so routing has real signal
            // from day one; data/organization.json refines them.
            domains: [...new Set(members.map(m => (m.role || '').toLowerCase()).filter(Boolean))],
            tenantId
        };
    });
    return { version: 1, tenantId, teams, unassignedAgentIds: unassigned };
}

function validateFile(raw: unknown, knownAgentIds: Set<string>, tenantId: string): OrgChart | null {
    if (!raw || typeof raw !== 'object') return null;
    const file = raw as OrganizationFile;
    if (file.version !== 1 || !Array.isArray(file.teams) || file.teams.length === 0) return null;
    const assigned = new Set<string>();
    const teams: OrgTeam[] = [];
    for (const team of file.teams) {
        if (!team?.id?.trim() || !team.name?.trim() || !team.headAgentId?.trim()) return null;
        if (!knownAgentIds.has(team.headAgentId)) {
            console.warn(`[ORG] organization.json: head '${team.headAgentId}' of team '${team.id}' is not a known agent — team kept, head may be spawned later.`);
        }
        const members = (team.memberAgentIds || []).filter(id => typeof id === 'string' && id.trim() && id !== team.headAgentId);
        const domains = (team.domains || []).map(d => String(d).toLowerCase().trim()).filter(Boolean);
        teams.push({
            id: team.id.trim(),
            name: team.name.trim(),
            headAgentId: team.headAgentId.trim(),
            memberAgentIds: [...new Set(members)],
            domains: [...new Set(domains)],
            tenantId
        });
        assigned.add(team.headAgentId);
        members.forEach(id => assigned.add(id));
    }
    const unassignedAgentIds = [...knownAgentIds].filter(id => !assigned.has(id));
    return { version: 1, tenantId, teams, unassignedAgentIds };
}

export function loadOrganization(filePath: string, seedAgents: AgentLike[], tenantId: string = DEFAULT_TENANT): OrgChart {
    const seed = deriveSeedChart(seedAgents, tenantId);
    try {
        if (!fs.existsSync(filePath)) return seed;
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
        const known = new Set(seedAgents.map(a => a.id));
        const chart = validateFile(raw, known, tenantId);
        if (!chart) {
            console.warn(`[ORG] ${filePath} is invalid — falling back to the seed org derived from known agents.`);
            return seed;
        }
        return chart;
    } catch (error) {
        console.warn(`[ORG] could not load ${filePath}: ${error instanceof Error ? error.message : String(error)} — using seed org.`);
        return seed;
    }
}

export const defaultOrganizationPath = (): string =>
    path.resolve(process.cwd(), 'data', 'organization.json');

/** Lookups used by routing. All pure functions over the chart. */
export function teamOfAgent(chart: OrgChart, agentId: string): OrgTeam | null {
    for (const team of chart.teams) {
        if (team.headAgentId === agentId || team.memberAgentIds.includes(agentId)) return team;
    }
    return null;
}

export function teamsForDomain(chart: OrgChart, domain: string): OrgTeam[] {
    const needle = domain.toLowerCase();
    return chart.teams.filter(t =>
        t.domains.some(d => needle.includes(d) || d.includes(needle)) ||
        t.id.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle));
}

export function headOfTeam(chart: OrgChart, teamId: string): string | null {
    return chart.teams.find(t => t.id === teamId)?.headAgentId ?? null;
}
