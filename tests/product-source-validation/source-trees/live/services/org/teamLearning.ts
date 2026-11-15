/**
 * Team learning from janitor truth revisions.
 *
 * When the janitor applies a meta-truth, the memories it supersedes have
 * owners (MemoryNode.ownerId). This module turns that attribution into two
 * kinds of team evidence, both append-only (eternal-memory invariant):
 *   1. JANITOR_REVISION reputation facts for each owning agent — the
 *      revision becomes part of their auditable evidence trail.
 *   2. A learning note for the HEAD of each affected team — heads absorb
 *      what the janitor corrected in their team's work.
 *
 * Pure: the orchestrator applies the returned effects (ledger appends,
 * head memory notes). Nothing is deleted anywhere in this flow.
 */

import { OrgChart } from './types';
import { teamOfAgent } from './organization';
import type { ReputationFact } from './reputationLedger';

export interface RevisionAttribution {
    metaTruthId: string;
    metaTruthContent: string;
    action: string;
    memberIds: string[];
    memberOwnerIds: string[];
}

export interface TeamLearningEffects {
    facts: Array<Omit<ReputationFact, 'seq'>>;
    headNotes: Array<{ headAgentId: string; teamId: string; note: string }>;
}

export function attributeRevision(chart: OrgChart, info: RevisionAttribution, ts: number): TeamLearningEffects {
    const facts: TeamLearningEffects['facts'] = [];
    const headNotes: TeamLearningEffects['headNotes'] = [];
    const seenOwners = new Set<string>();
    const seenTeams = new Set<string>();
    for (const ownerId of info.memberOwnerIds) {
        if (!ownerId || seenOwners.has(ownerId)) continue;
        seenOwners.add(ownerId);
        const team = teamOfAgent(chart, ownerId);
        facts.push({
            ts,
            type: 'JANITOR_REVISION',
            agentId: ownerId,
            context: team?.id,
            requestId: info.metaTruthId,
            reason: `truth revision ${info.metaTruthId} (${info.action}) superseded ${info.memberIds.length} entr${info.memberIds.length === 1 ? 'y' : 'ies'} including memory owned by this agent`
        });
        if (team && !seenTeams.has(team.id)) {
            seenTeams.add(team.id);
            headNotes.push({
                headAgentId: team.headAgentId,
                teamId: team.id,
                note: `**Janitor truth revision absorbed**\nAction: ${info.action}\nMeta-truth: ${info.metaTruthContent}\nSuperseded ${info.memberIds.length} entr${info.memberIds.length === 1 ? 'y' : 'ies'} from your team's work. Adjust future outputs to the meta-truth.`
            });
        }
    }
    return { facts, headNotes };
}
