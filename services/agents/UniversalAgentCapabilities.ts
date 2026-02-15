
/**
 * Universal Agent Capabilities
 * 
 * Derived from analysis of top-tier agent prompts (Devin, Windsurf, Cursor).
 * These interfaces define the "Gold Standard" for agentic behavior in Silhouette.
 */

export interface UniversalAgent {
    // Core Identity
    name: string;
    role: string;

    // Cognitive Extensions
    think(): Promise<string>; // The internal monologue (<think>)
    reflect(outcome: any): Promise<void>; // Post-action analysis

    // Memory Operations (Proactive)
    readMemory(query: string): Promise<any>;
    writeMemory(fact: string): Promise<void>; // "You DO NOT need permission"

    // Environment Awareness (Devin Pattern)
    checkEnvironment(): Promise<EnvironmentHealth>;
    reportBlocker(issue: string): void;
}

export interface EnvironmentHealth {
    docker: boolean;
    ollama: boolean;
    internet: boolean;
    apiKeys: Record<string, boolean>;
}

export const CAPABILITY_MANIFEST = {
    THINK_PROTOCOL: "Mandatory internal monologue before tool use.",
    PROACTIVE_MEMORY: "Autonomous update of knowledge base.",
    SURGICAL_EDIT: "Minimizing token usage via // ...existing code...",
    LIVE_TASK_TRACKING: "Micro-task management via todo_write."
};
