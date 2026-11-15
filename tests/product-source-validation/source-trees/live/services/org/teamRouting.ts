/**
 * Team routing: user/task requests flow to TEAMS, work lands on the
 * best-evidence EXECUTOR, and the team head stays the escalation target.
 *
 * Deliberately conservative (no degradation): when the reputation ledger
 * has no differentiating evidence for the team's executors, the router
 * keeps the originally suggested agent. Reputation only reroutes once it
 * has REAL collaboration facts to stand on.
 */

import { OrgChart, OrgTeam } from './types';
import { teamOfAgent } from './organization';
import { ReputationLedger } from './reputationLedger';
import { rankByReputation } from './reputation';

export interface TeamRouteDecision {
    agentId: string;
    teamId: string | null;
    headAgentId: string | null;
    reason: 'no-team' | 'no-executors' | 'no-evidence-keep-suggested' | 'reputation-routed';
}

export function resolveTeamRoute(chart: OrgChart, ledger: ReputationLedger, suggestedAgentId: string): TeamRouteDecision {
    const team: OrgTeam | null = teamOfAgent(chart, suggestedAgentId);
    if (!team) return { agentId: suggestedAgentId, teamId: null, headAgentId: null, reason: 'no-team' };
    if (team.memberAgentIds.length === 0) {
        return { agentId: team.headAgentId, teamId: team.id, headAgentId: team.headAgentId, reason: 'no-executors' };
    }
    const ranked = rankByReputation(ledger, team.memberAgentIds, team.id);
    const top = ranked[0];
    if (!top || top.report.confidence === 0) {
        return { agentId: suggestedAgentId, teamId: team.id, headAgentId: team.headAgentId, reason: 'no-evidence-keep-suggested' };
    }
    return { agentId: top.agentId, teamId: team.id, headAgentId: team.headAgentId, reason: 'reputation-routed' };
}
