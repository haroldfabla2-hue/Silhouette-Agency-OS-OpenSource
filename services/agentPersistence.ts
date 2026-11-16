import { Agent } from '../types';
import { sqliteService } from './sqliteService';
import { agentFileSystem } from './agents/agentFileSystem';

export interface AgentMetadataReceipt {
    id:string;
    operation:'FINAL_SNAPSHOT';
    application:'APPLIED'|'NOT_APPLIED'|'UNKNOWN';
    verification:'READBACK_MATCH'|'READBACK_MISMATCH'|'NOT_VERIFIED';
    sqliteCommit:'ACKNOWLEDGED'|'UNKNOWN';
    filesystem:'NOT_REQUESTED';
    powerLossDurability:'UNVERIFIED';
    errors:unknown[];
}

export class AgentPersistence {
    private readonly metadataReceipts:AgentMetadataReceipt[]=[];
    private readonly legacyFailures:Array<{operation:string,error:unknown}>=[];
    public getLifecycleStatus() { return { metadataReceipts:[...this.metadataReceipts], legacyFailures:[...this.legacyFailures] }; }
    /** Strict post-drain metadata-only path. Never creates/recreates a directory,
     * never retries an uncertain write, and never equates a commit with fsync.
     * Expected row content fences an obsolete owner against a newer persisted snapshot. */
    public commitFinalSnapshot(agent:Agent,expected:Agent):AgentMetadataReceipt {
        const receipt:AgentMetadataReceipt={id:agent.id,operation:'FINAL_SNAPSHOT',application:'UNKNOWN',verification:'NOT_VERIFIED',sqliteCommit:'UNKNOWN',filesystem:'NOT_REQUESTED',powerLossDurability:'UNVERIFIED',errors:[]};
        this.metadataReceipts.push(receipt);
        let writeAttempted=false;
        try {
            // One synchronous transaction prevents an intervening external writer
            // from passing the stale-row check then being overwritten by this owner.
            if(sqliteService.db.inTransaction) throw new Error('Final snapshot cannot acknowledge a nested savepoint as an outer commit');
            sqliteService.db.transaction(() => {
                const before=sqliteService.getAgent(agent.id);
                if(!before || JSON.stringify(before)!==JSON.stringify(expected)) throw new Error('Final snapshot fence: persisted row changed or was removed');
                writeAttempted=true;
                sqliteService.upsertAgent(agent);
                const after=sqliteService.getAgent(agent.id);
                if(JSON.stringify(after)!==JSON.stringify(agent)) {
                    receipt.verification='READBACK_MISMATCH';
                    throw new Error('Final snapshot readback mismatch; transaction must roll back');
                }
                receipt.verification='READBACK_MATCH';
            }).immediate();
            receipt.application='APPLIED';
            receipt.sqliteCommit='ACKNOWLEDGED';
        } catch(error) {
            // Conservatively unknown, including a commit/rollback error. Caller
            // must inspect this receipt rather than retry and duplicate effects.
            if(!writeAttempted) receipt.application='NOT_APPLIED';
            receipt.errors.push(error);
        }
        return receipt;
    }


    /**
     * Save agent to SQLite AND ensure its file system directory exists.
     * On first save, creates the per-agent directory with 8 template files.
     */
    public saveAgent(agent: Agent): void {
        try {
            sqliteService.upsertAgent(agent);

            // Ensure per-agent file system directory exists
            if (!agentFileSystem.agentDirExists(agent.id)) {
                agentFileSystem.createAgentDirectory(agent);
            }
        } catch (error) {
            this.legacyFailures.push({operation:'Failed to save agent',error});
            console.error(`[PERSISTENCE] Failed to save agent ${agent.id}`, error);
        }
    }

    /**
     * Load agent from SQLite.
     * The file-system context (SOUL, IDENTITY, etc.) is loaded separately
     * via agentFileSystem.buildSystemPrompt() when the agent is hydrated.
     */
    public loadAgent(agentId: string): Agent | null {
        try {
            return sqliteService.getAgent(agentId);
        } catch (error) {
            this.legacyFailures.push({operation:'Failed to load agent',error});
            console.error(`[PERSISTENCE] Failed to load agent ${agentId}`, error);
            return null;
        }
    }

    public getAllAgentIds(): string[] {
        try {
            const agents = sqliteService.getAllAgents();
            return agents.map(a => a.id);
        } catch (error) {
            this.legacyFailures.push({operation:'Failed to list agents',error});
            console.error("[PERSISTENCE] Failed to list agents", error);
            return [];
        }
    }

    public saveAgents(agents: Agent[]): void {
        agents.forEach(agent => {
            this.saveAgent(agent);
        });
    }

    public deleteAgent(agentId: string): void {
        try {
            sqliteService.deleteAgent(agentId);
            // Optionally delete file system directory too
            // agentFileSystem.deleteAgentDirectory(agentId);
            // ^ Not deleting by default to preserve memory/history
        } catch (error) {
            this.legacyFailures.push({operation:'Failed to delete agent',error});
            console.error(`[PERSISTENCE] Failed to delete agent ${agentId}`, error);
        }
    }

    /**
     * Migrate ALL existing agents to the per-agent file system.
     * Creates directories and template files for agents that don't have them yet.
     * Safe to call multiple times (idempotent).
     */
    public migrateAllToFileSystem(): number {
        let migrated = 0;
        try {
            const allAgents = sqliteService.getAllAgents();
            for (const agent of allAgents) {
                if (!agentFileSystem.agentDirExists(agent.id)) {
                    agentFileSystem.createAgentDirectory(agent);
                    migrated++;
                }
            }
            if (migrated > 0) {
                console.log(`[PERSISTENCE] 🔄 Migrated ${migrated} agents to per-agent file system.`);
            }
        } catch (error) {
            this.legacyFailures.push({operation:'Migration to file system failed',error});
            console.error("[PERSISTENCE] Migration to file system failed:", error);
        }
        return migrated;
    }
}

export const agentPersistence = new AgentPersistence();
