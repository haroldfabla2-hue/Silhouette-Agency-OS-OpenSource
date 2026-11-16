import { subscribeScoped } from './runtime/scopedSubscription';
import { ResourceScope } from '../server/runtime/resourceScope';
/**
 * CAPABILITY AWARENESS SERVICE
 * ═══════════════════════════════════════════════════════════════
 * Maintains persistent, real-time awareness of all Silhouette capabilities.
 * 
 * Features:
 * 1. Loads all tools, agents, and squads at startup
 * 2. Subscribes to SystemBus for real-time updates
 * 3. Persists capability index to LanceDB for semantic search
 * 4. Provides formatted summary for PromptCompiler
 */

import { systemBus } from './systemBus';
import { toolRegistry, DynamicTool } from './tools/toolRegistry';
import { lancedbService } from './lancedbService';
import { SystemProtocol, Agent, Squad } from '../types';

// ==================== INTERFACES ====================

interface ToolSummary {
    name: string;
    description: string;
    category: string;
    parameters: string[];
    createdBy: string;
    enabled: boolean;
}

interface AgentSummary {
    id: string;
    name: string;
    role: string;
    capabilities: string[];
    tier: string;
    status: string;
}

interface SquadSummary {
    id: string;
    name: string;
    mission: string;
    leaderId: string;
    memberCount: number;
}

interface CapabilitySnapshot {
    tools: ToolSummary[];
    agents: AgentSummary[];
    squads: SquadSummary[];
    lastUpdated: number;
}

// ==================== SERVICE ====================

class CapabilityAwarenessService {
    private readonly operations = new ResourceScope('CapabilityAwarenessService');
    public getLifecycleStatus() { return { initialized: this.initialized, snapshotReadCompleted: this.snapshotRecovered, diagnostics: this.operations.getDiagnostics(), failures: this.operations.getFailures() }; }
    public shutdownLifecycle() { return this.operations.close(); }
    private static instance: CapabilityAwarenessService;

    // In-memory caches
    private tools: Map<string, ToolSummary> = new Map();
    private agents: Map<string, AgentSummary> = new Map();
    private squads: Map<string, SquadSummary> = new Map();

    private initialized: boolean = false;
    private lastUpdated: number = 0;

    // Cached formatted summary for prompts
    private cachedSummary: string = '';
    private summaryDirty: boolean = true;

    private constructor() { }

    public static getInstance(): CapabilityAwarenessService {
        if (!CapabilityAwarenessService.instance) {
            CapabilityAwarenessService.instance = new CapabilityAwarenessService();
        }
        return CapabilityAwarenessService.instance;
    }

    // ==================== INITIALIZATION ====================

    /**
     * Initialize the service - load all capabilities and subscribe to events
     */
    private startup?: Promise<void>;
    private snapshotRecovered = false;
    public initialize(): Promise<void> {
        this.operations.assertWorkAccepted();
        if (!this.startup) this.startup = this.operations.run('initialize', () => this.initializeOnce());
        return this.startup;
    }
    private async initializeOnce(): Promise<void> {
        return this.operations.run('initializeOnce', async () => {

        if (this.initialized) return;

        console.log('[CapabilityAwareness] 🧠 Initializing capability awareness...');

        // 1. Load tools from registry
        await this.loadToolsFromRegistry();

        // 2. Load agents from orchestrator (lazy - will be populated as they register)
        // Agents register themselves via AGENT_SPAWNED events

        // Read persisted state before callbacks can schedule snapshot writes.
        await this.loadPersistedSnapshot();
        this.subscribeToEvents();

        this.initialized = true;
        this.lastUpdated = Date.now();

        console.log(`[CapabilityAwareness] ✅ Initialized with ${this.tools.size} tools, ${this.agents.size} agents, ${this.squads.size} squads`);
    
        });
    }

    private async loadToolsFromRegistry(): Promise<void> {
        return this.operations.run('loadToolsFromRegistry', async () => {

        const allTools = toolRegistry.getAllTools();

        for (const tool of allTools) {
            this.tools.set(tool.name, this.toolToSummary(tool));
        }

        this.summaryDirty = true;
    
        });
    }

    private toolToSummary(tool: DynamicTool): ToolSummary {
        return {
            name: tool.name,
            description: tool.description,
            category: tool.category,
            parameters: Object.keys(tool.parameters?.properties || {}),
            createdBy: tool.createdBy,
            enabled: tool.enabled
        };
    }

    // ==================== EVENT SUBSCRIPTIONS ====================

    private subscribeToEvents(): void {
        // Tool Events
        subscribeScoped(this.operations, systemBus, SystemProtocol.TOOL_CREATED, (event) => {
            this.onToolCreated(event.payload);
        });

        subscribeScoped(this.operations, systemBus, SystemProtocol.TOOL_EVOLVED, (event) => {
            this.onToolEvolved(event.payload);
        });

        subscribeScoped(this.operations, systemBus, SystemProtocol.TOOL_DELETED, (event) => {
            this.onToolDeleted(event.payload);
        });

        // Agent Events
        subscribeScoped(this.operations, systemBus, SystemProtocol.AGENT_SPAWNED, (event) => {
            this.onAgentSpawned(event.payload);
        });

        subscribeScoped(this.operations, systemBus, SystemProtocol.AGENT_EVOLVED, (event) => {
            this.onAgentEvolved(event.payload);
        });

        subscribeScoped(this.operations, systemBus, SystemProtocol.AGENT_DISMISSED, (event) => {
            this.onAgentDismissed(event.payload);
        });

        // Squad Events
        subscribeScoped(this.operations, systemBus, SystemProtocol.SQUAD_FORMED, (event) => {
            this.onSquadFormed(event.payload);
        });

        subscribeScoped(this.operations, systemBus, SystemProtocol.SQUAD_DISSOLVED, (event) => {
            this.onSquadDissolved(event.payload);
        });

        // Force sync
        subscribeScoped(this.operations, systemBus, SystemProtocol.CAPABILITY_SYNC, () => {
            return this.forceSync();
        });

        console.log('[CapabilityAwareness] 📡 Subscribed to capability lifecycle events');
    }

    // ==================== EVENT HANDLERS ====================

    private onToolCreated(payload: { tool: DynamicTool }): void {
        console.log(`[CapabilityAwareness] 🔧 Tool created: ${payload.tool.name}`);
        this.tools.set(payload.tool.name, this.toolToSummary(payload.tool));
        this.markDirty();
    }

    private onToolEvolved(payload: { toolName: string; changes: Partial<DynamicTool> }): void {
        console.log(`[CapabilityAwareness] 🔧 Tool evolved: ${payload.toolName}`);
        const existing = this.tools.get(payload.toolName);
        if (existing) {
            // Merge changes
            Object.assign(existing, payload.changes);
            this.markDirty();
        }
    }

    private onToolDeleted(payload: { toolName: string }): void {
        console.log(`[CapabilityAwareness] 🔧 Tool deleted: ${payload.toolName}`);
        this.tools.delete(payload.toolName);
        this.markDirty();
    }

    private onAgentSpawned(payload: { agent: Agent }): void {
        console.log(`[CapabilityAwareness] 🤖 Agent spawned: ${payload.agent.name}`);
        this.agents.set(payload.agent.id, {
            id: payload.agent.id,
            name: payload.agent.name,
            role: payload.agent.role,
            capabilities: payload.agent.capabilities || [],
            tier: payload.agent.tier,
            status: payload.agent.status
        });
        this.markDirty();
    }

    private onAgentEvolved(payload: { agentId: string; changes: Partial<Agent> }): void {
        console.log(`[CapabilityAwareness] 🤖 Agent evolved: ${payload.agentId}`);
        const existing = this.agents.get(payload.agentId);
        if (existing) {
            Object.assign(existing, payload.changes);
            this.markDirty();
        }
    }

    private onAgentDismissed(payload: { agentId: string }): void {
        console.log(`[CapabilityAwareness] 🤖 Agent dismissed: ${payload.agentId}`);
        this.agents.delete(payload.agentId);
        this.markDirty();
    }

    private onSquadFormed(payload: { squad: Squad }): void {
        console.log(`[CapabilityAwareness] 👥 Squad formed: ${payload.squad.name}`);
        this.squads.set(payload.squad.id, {
            id: payload.squad.id,
            name: payload.squad.name,
            mission: `Category: ${payload.squad.category}`,
            leaderId: payload.squad.leaderId || 'unassigned',
            memberCount: payload.squad.members?.length || 0
        });
        this.markDirty();
    }

    private onSquadDissolved(payload: { squadId: string }): void {
        console.log(`[CapabilityAwareness] 👥 Squad dissolved: ${payload.squadId}`);
        this.squads.delete(payload.squadId);
        this.markDirty();
    }

    private markDirty(): void {
        this.summaryDirty = true;
        this.lastUpdated = Date.now();
        // Persist asynchronously
        this.persistSnapshot().catch(err =>
            console.error('[CapabilityAwareness] Failed to persist:', err)
        );
    }

    // ==================== FORCE SYNC ====================

    public async forceSync(): Promise<void> {
        return this.operations.run('forceSync', async () => {

        await this.initialize();
        console.log('[CapabilityAwareness] 🔄 Force syncing capabilities...');
        await this.loadToolsFromRegistry();
        this.markDirty();
    
        });
    }

    // ==================== PROMPT INTEGRATION ====================

    /**
     * Get formatted capability summary for PromptCompiler
     * This is injected into Silhouette's system prompt
     */
    public getCapabilitySummary(): string {
        this.operations.assertWorkAccepted();

        if (!this.summaryDirty && this.cachedSummary) {
            return this.cachedSummary;
        }

        const enabledTools = Array.from(this.tools.values()).filter(t => t.enabled);
        const activeAgents = Array.from(this.agents.values());
        const activeSquads = Array.from(this.squads.values());

        let summary = `[AVAILABLE TOOLS - DYNAMIC REGISTRY (${enabledTools.length} tools)]\n`;
        summary += enabledTools.map(t => {
            const params = t.parameters.length > 0 ? `(${t.parameters.join(', ')})` : '()';
            return `- ${t.name}${params}: ${t.description}`;
        }).join('\n');

        if (activeAgents.length > 0) {
            summary += `\n\n[ACTIVE AGENTS (${activeAgents.length} agents)]\n`;
            summary += activeAgents.map(a =>
                `- ${a.name} [${a.tier}]: ${a.role} (${a.capabilities.join(', ')})`
            ).join('\n');
        }

        if (activeSquads.length > 0) {
            summary += `\n\n[ACTIVE SQUADS (${activeSquads.length} squads)]\n`;
            summary += activeSquads.map(s =>
                `- ${s.name}: ${s.mission} (${s.memberCount} members)`
            ).join('\n');
        }

        this.cachedSummary = summary;
        this.summaryDirty = false;
        return summary;
    }

    // ==================== PERSISTENCE ====================

    private async persistSnapshot(): Promise<void> {
        return this.operations.run('persistSnapshot', async () => {

        if (!this.snapshotRecovered) {
            const error = new Error('Capability snapshot write blocked: prior state unverified');
            this.operations.recordFailure('capability-snapshot-write-blocked', error);
            throw error;
        }
        const snapshot: CapabilitySnapshot = {
            tools: Array.from(this.tools.values()),
            agents: Array.from(this.agents.values()),
            squads: Array.from(this.squads.values()),
            lastUpdated: this.lastUpdated
        };

        try {
            // [Ticket W7] Snapshot persistence moved to the sqlite KV.
            // universal_knowledge is a semantic store whose writes must carry
            // real embeddings; an operational snapshot with vector: [] was
            // latent schema poison. sqlite config is the honest home for
            // operational state (same KV the orchestrator uses), $0.
            const { sqliteService } = await import('./sqliteService');
            sqliteService.setConfig('capabilitySnapshot', snapshot);
        } catch (err) {
            this.operations.recordFailure('capability-snapshot-durability', err);
            throw err;
        }
    
        });
    }

    private async loadPersistedSnapshot(): Promise<void> {
        return this.operations.run('loadPersistedSnapshot', async () => {

        try {
            const { sqliteService } = await import('./sqliteService');
            const snapshot = sqliteService.getConfig('capabilitySnapshot') as CapabilitySnapshot | null;
            if (snapshot !== null && snapshot !== undefined) {
                if (!snapshot || !Array.isArray(snapshot.tools) || !Array.isArray(snapshot.agents) || !Array.isArray(snapshot.squads) || !Number.isFinite(snapshot.lastUpdated)) {
                    throw new Error('Malformed capability snapshot; original retained');
                }
                // Validate the whole record before changing the live maps.
                if (snapshot.tools.some(t => !t || typeof t.name !== 'string') || snapshot.agents.some(a => !a || typeof a.id !== 'string') || snapshot.squads.some(s => !s || typeof s.id !== 'string')) {
                    throw new Error('Malformed capability snapshot entries; original retained');
                }
                if (snapshot.lastUpdated > this.lastUpdated) {
                    for (const tool of snapshot.tools) this.tools.set(tool.name, tool);
                    for (const agent of snapshot.agents) this.agents.set(agent.id, agent);
                    for (const squad of snapshot.squads) this.squads.set(squad.id, squad);
                    this.lastUpdated = snapshot.lastUpdated;
                }
            }
            this.snapshotRecovered = true;
        } catch (error) {
            this.snapshotRecovered = false;
            this.operations.recordDiagnostic('capability-snapshot-read', error, 'DEGRADED_FALLBACK', 'UNAVAILABLE');
        }
    
        });
    }

    // ==================== GETTERS ====================

    public getToolCount(): number {
        this.operations.assertWorkAccepted();

        return this.tools.size;
    }

    public getAgentCount(): number {
        this.operations.assertWorkAccepted();

        return this.agents.size;
    }

    public getSquadCount(): number {
        this.operations.assertWorkAccepted();

        return this.squads.size;
    }

    public getStats(): { tools: number; agents: number; squads: number; lastUpdated: number } {
        this.operations.assertWorkAccepted();

        return {
            tools: this.tools.size,
            agents: this.agents.size,
            squads: this.squads.size,
            lastUpdated: this.lastUpdated
        };
    }
}

export const capabilityAwareness = CapabilityAwarenessService.getInstance();
