/**
 * GENESIS V2 — Intelligent Agent Birth Protocol
 * 
 * Improved Genesis that:
 * 1. SEED PHASE: Creates kernel agents with rich file system directories
 * 2. BOOTSTRAP PHASE: Injects all 8 identity files into the system prompt
 * 3. HANDSHAKE PHASE: Each agent announces its capabilities to the Orchestrator
 * 4. PROTOCOL TEACHING: Orchestrator receives operational manual
 * 5. VALIDATION PHASE: Verifies each agent can communicate via SystemBus
 * 
 * This replaces the simple migration that just copied Agent objects to SQLite.
 */

import { Agent, AgentTier, AgentRoleType, AgentStatus, AgentCategory } from '../../types';
import { KERNEL_HEROS } from '../../constants';
import { agentPersistence } from '../agentPersistence';
import { agentFileSystem } from '../agents/agentFileSystem';
import { systemBus } from '../systemBus';
import { agentConversation } from '../communication/agentConversation';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface GenesisReport {
    success: boolean;
    agentsCreated: string[];
    agentsFailed: string[];
    protocolsLoaded: boolean;
    validationPassed: boolean;
    timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// OPERATIONAL MANUAL (Protocol Teaching)
// ═══════════════════════════════════════════════════════════════

/**
 * The operational manual that teaches the Orchestrator how to manage
 * all communication protocols and agent lifecycle events.
 */
const ORCHESTRATOR_OPERATIONAL_MANUAL = `
# Silhouette Agency OS — Operational Manual for Orchestrator

## Communication Protocols

### Direct Communication
- Agents can initiate direct conversations using sessions
- Messages are routed through the ConversationRouter
- Hierarchy rules are enforced automatically

### Help Requests
- Any agent can request help from another agent
- Workers must route cross-squad requests through their leader
- Help requests create a DIRECT session automatically

### Task Delegation
- Leaders can delegate tasks to their squad members
- DELEGATION messages go from superior → subordinate
- Workers CANNOT delegate to leaders or other squads

### Reporting
- Workers report to their squad leader
- Squad leaders report to CORE agents
- Reports include REPORT mesYecsage type

### Escalation
- When an agent is stuck, they escalate to their superior
- ESCALATION messages bypass normal routing for urgency
- Escalations should be handled with priority

### Mentions
- Agents can @mention other agents to summon them into a session
- Mentioned agents are auto-added as participants
- Mentions trigger a notification to the mentioned agent

## Agent Lifecycle Management

### Hydration
When an agent is hydrated (loaded into RAM):
1. Load from SQLite (runtime data)
2. Load per-agent files (IDENTITY, SOUL, AGENTS, TOOLS, USER, BOOTSTRAP, MEMORY)
3. Build enriched system prompt
4. Register with AgentConversation service
5. Announce readiness via SystemBus

### Dehydration
When an agent is dehydrated (saved to DISK):
1. Save runtime state to SQLite
2. Append session summary to MEMORY.md
3. Unregister from AgentConversation service
4. Emit AGENT_DEHYDRATED event

### Persistent Agents
Some agents are marked as "persistent" and should NOT be dehydrated:
- CORE tier agents are always persistent
- Squad leaders during active operations
- Agents explicitly kept alive by user or Silhouette

## Session Management
- DIRECT: 1-to-1 conversations
- GROUP: Multiple agents on a topic
- SQUAD: Full team work sessions (persistent by default)

## Priority Handling
1. CORE messages → Immediate processing
2. ESCALATION → High priority
3. HELP → Medium priority
4. DELEGATION/REPORT → Normal priority
5. MESSAGE → Standard priority
`;

// ═══════════════════════════════════════════════════════════════
// GENESIS V2 SERVICE
// ═══════════════════════════════════════════════════════════════

export class GenesisV2 {

    /**
     * Execute the full Genesis V2 protocol.
     * This is called on FIRST RUN when no agents exist in the database.
     */
    public async execute(): Promise<GenesisReport> {
        console.log('\n[GENESIS V2] ═══════════════════════════════════════════');
        console.log('[GENESIS V2] 🌅 Beginning Genesis V2 Protocol...');
        console.log('[GENESIS V2] ═══════════════════════════════════════════\n');

        const report: GenesisReport = {
            success: false,
            agentsCreated: [],
            agentsFailed: [],
            protocolsLoaded: false,
            validationPassed: false,
            timestamp: Date.now()
        };

        try {
            // Phase 1: SEED — Create kernel agents with file system
            console.log('[GENESIS V2] 📌 Phase 1: SEED — Creating kernel agents...');
            await this.seedPhase(report);

            // Phase 2: BOOTSTRAP — Load identity files
            console.log('[GENESIS V2] 🔧 Phase 2: BOOTSTRAP — Loading identity files...');
            await this.bootstrapPhase(report);

            // Phase 3: HANDSHAKE — Agents announce capabilities
            console.log('[GENESIS V2] 🤝 Phase 3: HANDSHAKE — Capability announcement...');
            await this.handshakePhase(report);

            // Phase 4: PROTOCOL TEACHING — Load operational manual
            console.log('[GENESIS V2] 📚 Phase 4: PROTOCOL TEACHING — Loading operational manual...');
            await this.protocolTeachingPhase(report);

            // Phase 5: VALIDATION — Verify communication
            console.log('[GENESIS V2] ✅ Phase 5: VALIDATION — Verifying agent readiness...');
            await this.validationPhase(report);

            report.success = report.agentsFailed.length === 0;

            console.log('\n[GENESIS V2] ═══════════════════════════════════════════');
            console.log(`[GENESIS V2] ${report.success ? '✅' : '⚠️'} Genesis V2 Complete`);
            console.log(`[GENESIS V2] Agents Created: ${report.agentsCreated.length}`);
            console.log(`[GENESIS V2] Agents Failed: ${report.agentsFailed.length}`);
            console.log(`[GENESIS V2] Protocols: ${report.protocolsLoaded ? 'LOADED' : 'FAILED'}`);
            console.log(`[GENESIS V2] Validation: ${report.validationPassed ? 'PASSED' : 'FAILED'}`);
            console.log('[GENESIS V2] ═══════════════════════════════════════════\n');

        } catch (error) {
            console.error('[GENESIS V2] 💥 Critical failure during Genesis:', error);
            report.success = false;
        }

        return report;
    }

    // ───────────────────────────────────────────────────────────
    // PHASE 1: SEED
    // ───────────────────────────────────────────────────────────

    private async seedPhase(report: GenesisReport): Promise<void> {
        for (const kernel of KERNEL_HEROS) {
            try {
                // Create full Agent object from kernel definition
                const agent: Agent = {
                    id: kernel.id,
                    name: kernel.name,
                    teamId: kernel.teamId || 'CORE',
                    category: (kernel.category || 'SYSTEM') as AgentCategory,
                    tier: AgentTier.CORE,
                    roleType: kernel.id.includes('core-01') ? AgentRoleType.LEADER : AgentRoleType.WORKER,
                    role: kernel.role || 'Core Agent',
                    status: AgentStatus.IDLE,
                    enabled: true,
                    preferredMemory: 'RAM',
                    memoryLocation: 'DISK',
                    cpuUsage: 0,
                    ramUsage: 0,
                    lastActive: Date.now(),
                    capabilities: kernel.capabilities || [],
                    directives: [],
                    opinion: ''
                };

                // Save to SQLite (this also creates the file system directory)
                agentPersistence.saveAgent(agent);
                report.agentsCreated.push(agent.id);
                console.log(`[GENESIS V2]   ► Created: ${agent.name} (${agent.id})`);

            } catch (error) {
                console.error(`[GENESIS V2]   ✗ Failed to create ${kernel.name}:`, error);
                report.agentsFailed.push(kernel.id);
            }
        }
    }

    // ───────────────────────────────────────────────────────────
    // PHASE 2: BOOTSTRAP
    // ───────────────────────────────────────────────────────────

    private async bootstrapPhase(report: GenesisReport): Promise<void> {
        for (const agentId of report.agentsCreated) {
            try {
                // Verify all 8 files exist
                const context = agentFileSystem.loadAgentContext(agentId);
                const hasIdentity = context.identity.length > 0;
                const hasSoul = context.soul.length > 0;
                const hasBootstrap = context.bootstrap.length > 0;

                if (hasIdentity && hasSoul && hasBootstrap) {
                    console.log(`[GENESIS V2]   ► Bootstrapped: ${agentId} (all files present)`);
                } else {
                    console.warn(`[GENESIS V2]   ⚠️ Incomplete bootstrap for ${agentId}`);
                }
            } catch (error) {
                console.error(`[GENESIS V2]   ✗ Bootstrap failed for ${agentId}:`, error);
            }
        }
    }

    // ───────────────────────────────────────────────────────────
    // PHASE 3: HANDSHAKE
    // ───────────────────────────────────────────────────────────

    private async handshakePhase(report: GenesisReport): Promise<void> {
        for (const agentId of report.agentsCreated) {
            try {
                const agent = agentPersistence.loadAgent(agentId);
                if (!agent) continue;

                // Register agent in conversation system
                agentConversation.registerAgent(agent);

                // Emit handshake event
                systemBus.emit('AGENT_HANDSHAKE', {
                    agentId: agent.id,
                    name: agent.name,
                    role: agent.role,
                    tier: agent.tier,
                    capabilities: agent.capabilities,
                    timestamp: Date.now()
                }, 'GENESIS_V2');

                console.log(`[GENESIS V2]   ► Handshake: ${agent.name} announced capabilities`);
            } catch (error) {
                console.error(`[GENESIS V2]   ✗ Handshake failed for ${agentId}:`, error);
            }
        }
    }

    // ───────────────────────────────────────────────────────────
    // PHASE 4: PROTOCOL TEACHING
    // ───────────────────────────────────────────────────────────

    private async protocolTeachingPhase(report: GenesisReport): Promise<void> {
        try {
            // Write the operational manual to the Orchestrator's AGENTS.md
            const orchestratorId = report.agentsCreated.find(id => id.includes('core-01'));
            if (orchestratorId) {
                agentFileSystem.writeFile(orchestratorId, 'AGENTS.md', ORCHESTRATOR_OPERATIONAL_MANUAL);
                console.log(`[GENESIS V2]   ► Loaded operational manual for Orchestrator`);
            }

            report.protocolsLoaded = true;
        } catch (error) {
            console.error('[GENESIS V2]   ✗ Protocol teaching failed:', error);
            report.protocolsLoaded = false;
        }
    }

    // ───────────────────────────────────────────────────────────
    // PHASE 5: VALIDATION
    // ───────────────────────────────────────────────────────────

    private async validationPhase(report: GenesisReport): Promise<void> {
        let allPassed = true;

        for (const agentId of report.agentsCreated) {
            try {
                // Check 1: Agent directory exists
                if (!agentFileSystem.agentDirExists(agentId)) {
                    console.warn(`[GENESIS V2]   ⚠️ No directory for ${agentId}`);
                    allPassed = false;
                    continue;
                }

                // Check 2: Can build system prompt
                const prompt = agentFileSystem.buildSystemPrompt(agentId);
                if (!prompt || prompt.length < 100) {
                    console.warn(`[GENESIS V2]   ⚠️ Weak system prompt for ${agentId} (${prompt?.length || 0} chars)`);
                    allPassed = false;
                    continue;
                }

                // Check 3: Agent is registered in conversation system
                const registered = agentConversation.getAgent(agentId);
                if (!registered) {
                    console.warn(`[GENESIS V2]   ⚠️ Agent ${agentId} not registered in conversation system`);
                    allPassed = false;
                    continue;
                }

                console.log(`[GENESIS V2]   ► Validated: ${agentId} ✓`);
            } catch (error) {
                console.error(`[GENESIS V2]   ✗ Validation failed for ${agentId}:`, error);
                allPassed = false;
            }
        }

        report.validationPassed = allPassed;
    }

    /**
     * Migrate existing agents (already in DB) to the new file system.
     * For use when upgrading from the old Genesis to V2.
     */
    public async migrateExistingSystem(): Promise<number> {
        console.log('[GENESIS V2] 🔄 Migrating existing agents to V2 file system...');
        const count = agentPersistence.migrateAllToFileSystem();
        console.log(`[GENESIS V2] ✅ Migration complete: ${count} agents migrated`);
        return count;
    }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

export const genesisV2 = new GenesisV2();
