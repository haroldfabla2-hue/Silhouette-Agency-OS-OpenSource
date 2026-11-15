/**
 * AGENT STANDARD
 * 
 * Defines the standard interface for all agents in Silhouette Agency OS.
 * Agents that conform to this standard can be validated, introspected,
 * and managed uniformly — reducing errors and improving reliability.
 */

import { Agent, AgentRoleType, AgentTier, AgentCapability, AgentCategory, AgentStatus } from '../../types';

// ═══════════════════════════════════════════════════════════════
// STANDARD AGENT INTERFACE
// ═══════════════════════════════════════════════════════════════

/**
 * Complete agent definition that includes both the runtime data (Agent interface)
 * and the file-system based identity (loaded from markdown files).
 */
export interface StandardAgent {
    /** Runtime agent data from SQLite */
    runtime: Agent;
    /** Version of this agent's configuration */
    version: string;
    /** Loaded file-system context */
    files: {
        identity: string;
        soul: string;
        rules: string;
        tools: string;
        user: string;
        heartbeat: string;
        bootstrap: string;
        memory: string;
    };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validates that an agent meets the minimum requirements.
 */
export function validateAgent(agent: Agent): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!agent.id) errors.push('Agent must have an id');
    if (!agent.name) errors.push('Agent must have a name');
    if (!agent.role) errors.push('Agent must have a role');
    if (!agent.teamId) errors.push('Agent must have a teamId');
    if (agent.tier === undefined) errors.push('Agent must have a tier');
    if (agent.roleType === undefined) errors.push('Agent must have a roleType');
    if (agent.category === undefined) errors.push('Agent must have a category');

    // ID format validation (alphanumeric + hyphens)
    if (agent.id && !/^[a-zA-Z0-9_-]+$/.test(agent.id)) {
        errors.push(`Agent ID "${agent.id}" contains invalid characters. Use alphanumeric, hyphens, and underscores only.`);
    }

    // Warnings for best practices
    if (!agent.capabilities || agent.capabilities.length === 0) {
        warnings.push('Agent has no capabilities defined. Consider registering relevant capabilities.');
    }

    if (!agent.directives || agent.directives.length === 0) {
        warnings.push('Agent has no directives. Consider defining operating directives for better performance.');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Creates a default agent with all required fields populated.
 */
export function createDefaultAgent(overrides: Partial<Agent> & { id: string; name: string }): Agent {
    return {
        id: overrides.id,
        name: overrides.name,
        teamId: overrides.teamId || 'UNASSIGNED',
        category: overrides.category || ('GENERAL' as AgentCategory),
        tier: overrides.tier || AgentTier.WORKER,
        roleType: overrides.roleType || AgentRoleType.WORKER,
        role: overrides.role || 'General Agent',
        status: overrides.status || AgentStatus.IDLE,
        enabled: overrides.enabled ?? true,
        preferredMemory: overrides.preferredMemory || 'RAM',
        memoryLocation: overrides.memoryLocation || 'DISK',
        cpuUsage: 0,
        ramUsage: 0,
        lastActive: Date.now(),
        capabilities: overrides.capabilities || [],
        directives: overrides.directives || [],
        opinion: overrides.opinion || '',
        ...overrides
    };
}
