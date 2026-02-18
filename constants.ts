
import { Agent, AgentStatus, AgentRoleType, Project, AutonomousConfig, AgentCapability, AgentTier, AgentCategory } from './types';

// The "Hero" Agents are explicitly defined.
// The Orchestrator will generate the remaining "Worker" drones to reach 131 total.

export const ZOMBIE_THRESHOLD = 2 * 60 * 1000; // 2 Minutes (Optimized for Service Heartbeat)
export const KERNEL_COMPLEXITY_THRESHOLD = 0.7; // 0.0 - 1.0 (Low - High complexity)

// --- PROTOCOL CLASSIFICATION FOR SMART NOTIFICATIONS ---
// Informative: Routine events that should ONLY go to System Logs (no UI re-renders)
export const INFORMATIVE_PROTOCOLS = [
  'PROTOCOL_WORKFLOW_UPDATE',        // Status: STABLE (every heartbeat)
  'PROTOCOL_VISUAL_REQUEST',         // Throttled visual capture request
  'PROTOCOL_HIVE_MIND_SYNC',         // Background sync
  'PROTOCOL_MEMORY_FLUSH',           // Cleanup operations
  'PROTOCOL_RESOURCE_SHUNT',         // Internal resource management
  'PROTOCOL_NEURO_LINK_HANDSHAKE',   // Background handshakes
];

// Actionable: Important events that should appear in NotificationCenter
export const ACTIONABLE_PROTOCOLS = [
  'PROTOCOL_THOUGHT_EMISSION',           // Silhouette ideas/thoughts (filtered by importance)
  'PROTOCOL_ARCHITECTURAL_RFC',          // Needs user approval
  'PROTOCOL_EPISTEMIC_GAP_DETECTED',     // New discovery/curiosity
  'PROTOCOL_COST_ANOMALY',               // Budget warning
  'PROTOCOL_DATA_CORRUPTION',            // Error alert
  'PROTOCOL_TRAINING_COMPLETE',          // Training finished
  'PROTOCOL_TASK_COMPLETION',            // Major task done
  'PROTOCOL_INCIDENT_REPORT',            // Research found issue
  'PROTOCOL_GENESIS_TRIGGER',            // Code injection approved
  'PROTOCOL_MISSING_CREDENTIAL',         // New: Credential Safety
];


// --- KERNEL AGENTS (The Seed) ---
// These are the core cognitive functions that always exist.
export const KERNEL_HEROS: Agent[] = [
  {
    id: 'core-01',
    name: 'Orchestrator_Prime',
    teamId: 'TEAM_CORE',
    category: 'CORE',
    roleType: AgentRoleType.LEADER,
    role: 'System Controller',
    status: AgentStatus.WORKING,
    enabled: true,
    cpuUsage: 12, ramUsage: 150, lastActive: Date.now(),
    memoryLocation: 'VRAM',
    capabilities: [AgentCapability.SYSTEM_DESIGN, AgentCapability.CONTEXT_MANAGEMENT, AgentCapability.TOOL_WEB_SEARCH, AgentCapability.TOOL_MEMORY_WRITE],
    tier: AgentTier.CORE,
    preferredMemory: 'VRAM'
  },
  {
    id: 'core-02',
    name: 'Intent_Analyzer_Alpha',
    teamId: 'TEAM_CORE',
    category: 'CORE',
    roleType: AgentRoleType.WORKER,
    role: 'Prompt Engineer Lead',
    status: AgentStatus.WORKING,
    enabled: true,
    cpuUsage: 15, ramUsage: 120, lastActive: Date.now(),
    memoryLocation: 'VRAM',
    tier: AgentTier.CORE,
    preferredMemory: 'VRAM'
  },
  {
    id: 'core-03',
    name: 'Workflow_Architect',
    teamId: 'TEAM_CORE',
    category: 'CORE',
    roleType: AgentRoleType.WORKER,
    role: 'System Evolutionist',
    status: AgentStatus.IDLE,
    enabled: true,
    cpuUsage: 25, ramUsage: 200, lastActive: Date.now(),
    memoryLocation: 'VRAM',
    tier: AgentTier.CORE,
    preferredMemory: 'VRAM'
  },
  {
    id: 'ctx-01',
    name: 'The_Librarian',
    teamId: 'TEAM_CONTEXT',
    category: 'DATA',
    roleType: AgentRoleType.LEADER,
    role: 'Context Keeper',
    status: AgentStatus.WORKING,
    enabled: true,
    cpuUsage: 8, ramUsage: 350, lastActive: Date.now(),
    memoryLocation: 'VRAM',
    tier: AgentTier.SPECIALIST,
    preferredMemory: 'VRAM'
  }
];

// --- EXTENDED LIBRARY (The Swarm Blueprints) ---
// These are specialists that can be hydrated on-demand.
export const SPECIALIST_LIBRARY: Agent[] = [
  {
    id: 'strat-01',
    name: 'Strategos_X',
    teamId: 'TEAM_STRATEGY',
    category: 'OPS',
    roleType: AgentRoleType.LEADER,
    role: 'Strategic Planner',
    status: AgentStatus.IDLE,
    enabled: true,
    cpuUsage: 5, ramUsage: 200, lastActive: Date.now(),
    memoryLocation: 'VRAM',
    capabilities: [AgentCapability.CAMPAIGN_STRATEGY, AgentCapability.TOOL_WEB_SEARCH],
    tier: AgentTier.SPECIALIST,
    preferredMemory: 'VRAM'
  },
  {
    id: 'dev-lead',
    name: 'Code_Architect',
    teamId: 'TEAM_DEV',
    category: 'DEV',
    roleType: AgentRoleType.LEADER,
    role: 'Lead Developer',
    status: AgentStatus.IDLE,
    enabled: true,
    cpuUsage: 0, ramUsage: 0, lastActive: Date.now(),
    memoryLocation: 'VRAM',
    capabilities: [AgentCapability.CODE_GENERATION, AgentCapability.SYSTEM_DESIGN],
    tier: AgentTier.SPECIALIST,
    preferredMemory: 'VRAM'
  },
  {
    id: 'mkt-lead',
    name: 'Creative_Director',
    teamId: 'TEAM_MKT',
    category: 'MARKETING',
    roleType: AgentRoleType.LEADER,
    role: 'Brand Director',
    status: AgentStatus.IDLE,
    enabled: true,
    cpuUsage: 0, ramUsage: 0, lastActive: Date.now(),
    memoryLocation: 'VRAM',
    capabilities: [AgentCapability.VISUAL_DESIGN, AgentCapability.CAMPAIGN_STRATEGY, AgentCapability.TOOL_IMAGE_GENERATION],
    tier: AgentTier.SPECIALIST,
    preferredMemory: 'VRAM'
  },
  {
    id: 'sci-03',
    name: 'Researcher_Pro',
    teamId: 'TEAM_SCIENCE',
    category: 'SCIENCE',
    roleType: AgentRoleType.WORKER,
    role: 'Senior Researcher',
    status: AgentStatus.IDLE,
    enabled: true,
    cpuUsage: 0, ramUsage: 160, lastActive: Date.now(),
    memoryLocation: 'VRAM',
    capabilities: [AgentCapability.RESEARCH, AgentCapability.TOOL_WEB_SEARCH, AgentCapability.TOOL_RFC_REQUEST],
    tier: AgentTier.SPECIALIST,
    preferredMemory: 'VRAM'
  }
];

// Export the Kernel as the initial agent set
export const INITIAL_AGENTS: Agent[] = [...KERNEL_HEROS];

export const PROJECTS: Project[] = [
  { id: '1', name: 'Silhouette', status: 'active', progress: 65, activeSquads: 4, tasks: { pending: 15, inProgress: 4, completed: 88, backlog: 20 } },
  { id: '2', name: 'Aether Lens', status: 'paused', progress: 30, activeSquads: 0, tasks: { pending: 10, inProgress: 0, completed: 15, backlog: 5 } },
  { id: '3', name: 'Nebula', status: 'planning', progress: 10, activeSquads: 1, tasks: { pending: 5, inProgress: 1, completed: 2, backlog: 8 } }
];

// Added back implicitly required exports
export const MOCK_PROJECTS = PROJECTS;

export const QDRANT_CONFIG = {
  url: process.env.QDRANT_URL || 'http://localhost:6444',
  collectionName: 'silhouette_memory_v1',
  embeddingSize: 384 // using all-MiniLM-L6-v2
};

export const DEFAULT_AUTONOMOUS_CONFIG: AutonomousConfig = {
  enabled: false,
  maxConcurrentAgents: 10,
  autoApprovalThreshold: 'routine',
  budgetCap: 100,
  allowedDomains: ['localhost', 'github.com', 'stackoverflow.com', 'npmjs.com']
};

export const DEFAULT_API_CONFIG = {
  enabled: true,
  apiKey: process.env.VITE_API_KEY ||
    ((import.meta as any).env?.VITE_API_KEY) ||
    '',
  port: 3005
};

export const REPLICATE_CONFIG = {
  apiKey: process.env.REPLICATE_API_TOKEN || 'default-replicate-key',
  models: {
    primary: "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
    fallback: "black-forest-labs/flux-dev", // Or another fallback
    video: "stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816f3afc54a3aaa84d8dd471ccbb1ba79c7b3"
  }
};

export const REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6499'),
  password: process.env.REDIS_PASSWORD
};