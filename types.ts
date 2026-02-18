// =============================================================================
// SHARED TYPES FOR SILHOUETTE AGENCY OS
// =============================================================================

// Email Interface (Used by EmailPanel, EmailLayout, gmailService)
export interface Email {
  id: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  body?: string;
  date: Date | string | number;
  isRead: boolean;
  labels?: string[];
  attachments?: { filename: string; mimeType: string; size: number }[];
}

// Framework Enums
export enum AgentStatus {
  IDLE = 'IDLE',
  THINKING = 'THINKING',
  WORKING = 'WORKING',
  CRITICAL = 'CRITICAL',
  OFFLINE = 'OFFLINE',
  HIBERNATED = 'HIBERNATED' // NEW: For local mode limitations
}

export enum AgentRoleType {
  LEADER = 'LEADER',
  WORKER = 'WORKER'
}



export enum AgentTier {
  CORE = 'CORE',       // Tier 0: Always Online
  SPECIALIST = 'SPECIALIST', // Tier 1: On Demand (5m idle)
  WORKER = 'WORKER'    // Tier 2: Ephemeral (30s idle)
}

// Agent Profile for dynamic agent loading
export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  capabilities: string[];
  systemPrompt: string;
  communicationStyle?: string;
  maxContextWindow?: number;
  modelPreference?: string;
}

export enum WorkflowStage {
  INTENT = 'INTENT_ANALYSIS',
  PLANNING = 'STRATEGIC_PLANNING',
  EXECUTION = 'EXECUTION_SWARM',
  QA_AUDIT = 'QUALITY_ASSURANCE_AUDIT',
  REMEDIATION = 'ERROR_REMEDIATION',
  OPTIMIZATION = 'AUTO_OPTIMIZATION',
  META_ANALYSIS = 'SYSTEM_META_ANALYSIS',
  ADAPTATION_QA = 'ADAPTATION_PROTOCOL_QA',
  GENESIS = 'GENESIS_FACTORY_SPAWN', // NEW: Project Creation
  DEPLOYMENT = 'GENESIS_COOLIFY_DEPLOY', // NEW: Git-Ops Deployment
  RESEARCH = 'ACTIVE_RESEARCH_PROTOCOL', // NEW: Swarm Intelligence
  ARCHIVAL = 'CONTEXT_ARCHIVAL',
  IDLE = 'SYSTEM_IDLE'
}

// NEW: SYSTEM PROTOCOLS
export enum SystemProtocol {
  UI_REFRESH = 'PROTOCOL_UI_REFRESH',
  SQUAD_EXPANSION = 'PROTOCOL_SQUAD_EXPANSION',
  CONFIG_MUTATION = 'PROTOCOL_CONFIG_MUTATION',
  SECURITY_LOCKDOWN = 'PROTOCOL_SECURITY_LOCKDOWN',
  MEMORY_FLUSH = 'PROTOCOL_MEMORY_FLUSH',
  MEMORY_CREATED = 'PROTOCOL_MEMORY_CREATED', // NEW: Real-time UI update
  INTERFACE_MORPH = 'PROTOCOL_INTERFACE_MORPH',
  RESOURCE_SHUNT = 'PROTOCOL_RESOURCE_SHUNT',
  NEURO_LINK_HANDSHAKE = 'PROTOCOL_NEURO_LINK_HANDSHAKE', // NEW
  HIVE_MIND_SYNC = 'PROTOCOL_HIVE_MIND_SYNC', // NEW
  GENESIS_UPDATE = 'PROTOCOL_GENESIS_UPDATE', // NEW: Triggers Workspace Refresh
  MEMORY_OPTIMIZED = 'MEMORY_OPTIMIZED',
  FILESYSTEM_UPDATE = 'PROTOCOL_FILESYSTEM_UPDATE', // NEW: Syncs VFS with Dashboard
  SENSORY_SNAPSHOT = 'PROTOCOL_SENSORY_SNAPSHOT', // NEW: Visual Cortex trigger
  NAVIGATION = 'PROTOCOL_NAVIGATION', // NEW: Autonomous Tab Switching
  THOUGHT_EMISSION = 'PROTOCOL_THOUGHT_EMISSION', // NEW: Real-time neural stream
  RESEARCH_REQUEST = 'PROTOCOL_RESEARCH_REQUEST', // NEW: Swarm Intelligence
  RESEARCH_RESPONSE = 'PROTOCOL_RESEARCH_RESPONSE', // NEW: Swarm Intelligence
  INNOVATION_REQUEST = 'PROTOCOL_INNOVATION_REQUEST', // NEW: Anti-Hallucination
  INNOVATION_RESPONSE = 'PROTOCOL_INNOVATION_RESPONSE', // NEW: Anti-Hallucination
  TASK_ASSIGNMENT = 'PROTOCOL_TASK_ASSIGNMENT', // NEW: Orchestrator -> Agent
  TASK_COMPLETION = 'PROTOCOL_TASK_COMPLETION', // NEW: Agent -> Orchestrator
  COST_ANOMALY = 'PROTOCOL_COST_ANOMALY', // NEW: CFO -> Orchestrator
  DATA_CORRUPTION = 'PROTOCOL_DATA_CORRUPTION', // NEW: Janitor -> Orchestrator
  TASK_PAUSED = 'PROTOCOL_TASK_PAUSED', // NEW: Remediation -> System
  WORKFLOW_UPDATE = 'PROTOCOL_WORKFLOW_UPDATE', // NEW: Workflow Engine -> UI
  VISUAL_REQUEST = 'PROTOCOL_VISUAL_REQUEST',
  UI_COMMAND = 'PROTOCOL_UI_COMMAND', // NEW: Backend -> Frontend UI commands (popups, modals)
  VISUAL_SNAPSHOT = 'PROTOCOL_VISUAL_SNAPSHOT',
  INCIDENT_REPORT = 'PROTOCOL_INCIDENT_REPORT', // NEW: Remediation -> Research
  ARCHITECTURAL_RFC = 'PROTOCOL_ARCHITECTURAL_RFC', // NEW: Research -> User
  INTUITION_CONSOLIDATED = 'PROTOCOL_INTUITION_CONSOLIDATED', // NEW: Dreamer -> NeuroSynapse
  GENESIS_TRIGGER = 'PROTOCOL_GENESIS_TRIGGER', // NEW: RFC Approved -> Code Injection
  EPISTEMIC_GAP_DETECTED = 'PROTOCOL_EPISTEMIC_GAP_DETECTED', // NEW: Dreamer -> Researcher (Curiosity)
  SQUAD_REASSIGNMENT = 'PROTOCOL_SQUAD_REASSIGNMENT', // NEW: Drag & Drop UI -> Orchestrator
  ACTION_INTENT = 'PROTOCOL_ACTION_INTENT', // NEW: Introspection -> Orchestrator
  TRAINING_EXAMPLE_FOUND = 'PROTOCOL_TRAINING_EXAMPLE_FOUND', // NEW: Nocturnal Plasticity
  TRAINING_START = 'PROTOCOL_TRAINING_START', // NEW: Trigger Dream Cycle
  TRAINING_LOG = 'PROTOCOL_TRAINING_LOG', // NEW: Live logs
  TRAINING_COMPLETE = 'PROTOCOL_TRAINING_COMPLETE', // NEW: Done
  CURRICULA_READY = 'PROTOCOL_CURRICULA_READY', // NEW: Curricula exported for NanoSilhouette
  // Research Synthesis Pipeline
  SYNTHESIS_REQUEST = 'PROTOCOL_SYNTHESIS_REQUEST', // NEW: Trigger insight synthesis
  SYNTHESIS_COMPLETE = 'PROTOCOL_SYNTHESIS_COMPLETE', // NEW: Synthesis result ready
  PAPER_GENERATION_REQUEST = 'PROTOCOL_PAPER_GENERATION_REQUEST', // NEW: Generate paper from insight
  PAPER_GENERATION_COMPLETE = 'PROTOCOL_PAPER_GENERATION_COMPLETE', // NEW: Paper ready for review
  AGENT_EVOLVED = 'PROTOCOL_AGENT_EVOLVED', // PA-038: Agent evolution notification
  NARRATIVE_UPDATE = 'PROTOCOL_NARRATIVE_UPDATE', // NEW: Unified Stream Emission
  CANVAS_OPERATION = 'PROTOCOL_CANVAS_OPERATION', // NEW: Agent -> Visual Cortex Control
  LEARNING_UPDATE = 'PROTOCOL_LEARNING_UPDATE', // Self-Evolution: Learning Loop insights
  DIAGNOSTICS_DATA = 'PROTOCOL_DIAGNOSTICS_DATA', // NEW: System diagnostics data
  SECURITY_ALERT = 'PROTOCOL_SECURITY_ALERT', // NEW: Security alerts
  TOOL_EVOLUTION = 'PROTOCOL_TOOL_EVOLUTION', // Self-Evolution: Tool optimization

  // Voice System Events (PA-008)
  VOICE_ENGINE_ONLINE = 'PROTOCOL_VOICE_ENGINE_ONLINE',
  VOICE_ENGINE_OFFLINE = 'PROTOCOL_VOICE_ENGINE_OFFLINE',
  VOICE_CLONE_START = 'PROTOCOL_VOICE_CLONE_START',
  VOICE_CLONE_COMPLETE = 'PROTOCOL_VOICE_CLONE_COMPLETE',
  VOICE_CLONE_FAILED = 'PROTOCOL_VOICE_CLONE_FAILED',
  VOICE_TTS_REQUEST = 'PROTOCOL_VOICE_TTS_REQUEST',
  VOICE_TTS_ERROR = 'PROTOCOL_VOICE_TTS_ERROR',
  VOICE_QUALITY_LOW = 'PROTOCOL_VOICE_QUALITY_LOW',

  // Connection Nervous System (Auto-Healing)
  CONNECTION_LOST = 'PROTOCOL_CONNECTION_LOST',       // Service disconnected
  CONNECTION_RESTORED = 'PROTOCOL_CONNECTION_RESTORED', // Service reconnected
  CONNECTION_HEARTBEAT = 'PROTOCOL_CONNECTION_HEARTBEAT', // Periodic health check

  // Autonomy System
  SYSTEM_ALERT = 'PROTOCOL_SYSTEM_ALERT',           // Critical alerts for user attention
  SCHEDULED_TASK_TRIGGER = 'PROTOCOL_SCHEDULED_TASK_TRIGGER', // Scheduler fires task
  GOAL_UPDATED = 'PROTOCOL_GOAL_UPDATED',           // Goal progress/completion
  INTEGRATION_EVENT = 'PROTOCOL_INTEGRATION_EVENT', // External webhook/event received
  CONFIRMATION_REQUIRED = 'PROTOCOL_CONFIRMATION_REQUIRED', // Human-in-loop approval needed

  // Inter-Agent Help Protocol (Team Leader Communication)
  HELP_REQUEST = 'PROTOCOL_HELP_REQUEST',     // Agent → Agent (solicita ayuda)
  HELP_RESPONSE = 'PROTOCOL_HELP_RESPONSE',   // Agent → Agent (responde con solución)

  // Email Events
  PROTOCOL_EMAIL_RECEIVED = 'PROTOCOL_EMAIL_RECEIVED',  // New email notification

  // [OMNISCIENT] New Protocols for Complete Event Awareness
  TOOL_EXECUTION = 'PROTOCOL_TOOL_EXECUTION',           // When a tool is executed (web search, file ops, etc.)
  USER_MESSAGE = 'PROTOCOL_USER_MESSAGE',               // Direct user/creator communication
  MOOD_CHANGE = 'PROTOCOL_MOOD_CHANGE',                 // Emotional state transitions
  IMPROVEMENT_LOGGED = 'PROTOCOL_IMPROVEMENT_LOGGED',   // Self-improvement events
  SKILL_LEARNED = 'PROTOCOL_SKILL_LEARNED',             // New capability acquired
  ERROR_RECOVERED = 'PROTOCOL_ERROR_RECOVERED',        // Self-healing events

  // Credential Safety
  MISSING_CREDENTIAL = 'PROTOCOL_MISSING_CREDENTIAL',

  // Job Queue / Async Workers
  VIDEO_REQUEST = 'PROTOCOL_VIDEO_REQUEST',
  WORK_COMPLETE = 'PROTOCOL_WORK_COMPLETE',

  // Unified Capability Execution
  CAPABILITY_REQUEST = 'PROTOCOL_CAPABILITY_REQUEST',   // Capability execution started
  CAPABILITY_RESULT = 'PROTOCOL_CAPABILITY_RESULT',     // Capability execution completed

  // ==================== CAPABILITY LIFECYCLE ====================
  // Tool Events
  TOOL_CREATED = 'PROTOCOL_TOOL_CREATED',               // New tool registered
  TOOL_EVOLVED = 'PROTOCOL_TOOL_EVOLVED',               // Tool improved/modified
  TOOL_DELETED = 'PROTOCOL_TOOL_DELETED',               // Tool removed

  // Agent Events
  AGENT_SPAWNED = 'PROTOCOL_AGENT_SPAWNED',             // New agent created
  // AGENT_EVOLVED already exists at line 118
  AGENT_DISMISSED = 'PROTOCOL_AGENT_DISMISSED',         // Agent removed

  // Squad Events
  SQUAD_FORMED = 'PROTOCOL_SQUAD_FORMED',               // New squad created
  SQUAD_DISSOLVED = 'PROTOCOL_SQUAD_DISSOLVED',         // Squad disbanded

  // Capability Sync
  CAPABILITY_SYNC = 'PROTOCOL_CAPABILITY_SYNC',         // Force capability refresh

  // ==================== SECURITY EVENTS ====================
  SECURITY_REVIEW_REQUEST = 'PROTOCOL_SECURITY_REVIEW_REQUEST',   // Code needs review
  SECURITY_REVIEW_RESULT = 'PROTOCOL_SECURITY_REVIEW_RESULT',     // Review completed
  SECURITY_THREAT_DETECTED = 'PROTOCOL_SECURITY_THREAT_DETECTED', // Malicious pattern found

  // ==================== API KEY MANAGEMENT ====================
  API_KEY_CREATED = 'PROTOCOL_API_KEY_CREATED',     // New API key generated
  API_KEY_REVOKED = 'PROTOCOL_API_KEY_REVOKED',     // API key revoked
  API_KEY_EXPIRED = 'PROTOCOL_API_KEY_EXPIRED',     // API key expired
}

export interface StreamItem {
  id: string;
  timestamp: number;
  source: 'CONSCIOUS' | 'SUBCONSCIOUS' | 'UNCONSCIOUS' | 'AGENCY';
  content: string;
  coherence: number;
  metadata?: {
    agentId?: string;
    emotion?: string;
    topics?: string[];
    originalEvent?: string;
  };
}

export enum CommunicationLevel {
  INTERNAL_MONOLOGUE = 'INTERNAL_MONOLOGUE',
  TEAM_BROADCAST = 'TEAM_BROADCAST',
  DIRECT_MESSAGE = 'DIRECT_MESSAGE',
  SYSTEM_ALERT = 'SYSTEM_ALERT',
  USER_FACING = 'USER_FACING', // Level 1: Donna Paulsen (Sarcastic, Leader)
  EXECUTIVE = 'EXECUTIVE',     // Level 2: Diplomat (Professional, Goal-Oriented)
  TECHNICAL = 'TECHNICAL'      // Level 3: Robot (JSON, Precise, No Emotion)
}

export type TraceId = string;

export interface InterAgentMessage {
  id: string;
  traceId: TraceId; // The "Golden Thread" linking sub-tasks
  senderId: string;
  targetId: string; // Agent ID or Team ID
  type: 'REQUEST' | 'RESPONSE' | 'INFO' | 'BROADCAST';
  protocol: SystemProtocol;
  payload: any;
  timestamp: number;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  ttl?: number; // Time to live in ms
}

export interface ProtocolEvent {
  type: SystemProtocol;
  payload: any;
  timestamp: number;
  initiator: string;
  id?: string;
  traceId?: TraceId; // Optional trace for system events
}

export interface MorphPayload {
  mode: 'DEFENSE' | 'FLOW' | 'NEUTRAL';
  accentColor?: string;
  density?: 'compact' | 'comfortable';
}

/**
 * Memory Tier System
 * 
 * REFACTORING NOTE (2026-01-07):
 * - WORKING: New unified working memory tier (replaces ULTRA_SHORT + SHORT)
 * - ULTRA_SHORT/SHORT: Kept for backward compatibility, internally map to WORKING
 * - MEDIUM: Persistent storage for frequently accessed memories
 * - LONG: Archive for older, less accessed memories
 * - DEEP: Vector-based semantic memory in Qdrant
 */
export enum MemoryTier {
  // === NEW UNIFIED TIER ===
  WORKING = 'WORKING',      // RAM-based working memory (active session context)

  // === PERSISTENT TIERS ===
  MEDIUM = 'MEDIUM',        // LanceDB - frequently accessed
  LONG = 'LONG',            // LanceDB - archived
  DEEP = 'DEEP',            // Qdrant - semantic vectors

  // === LEGACY TIERS (Mapped to new tiers for compatibility) ===
  /** @deprecated Use WORKING instead */
  EPISODIC = 'WORKING',     // Legacy: session-based episodic memory
  /** @deprecated Use DEEP instead */
  SEMANTIC = 'DEEP',        // Legacy: vector-based semantic memory
  /** @deprecated Use WORKING instead */
  ULTRA_SHORT = 'WORKING',  // Maps to WORKING for compatibility
  /** @deprecated Use WORKING instead */
  SHORT = 'WORKING'         // Maps to WORKING for compatibility
}

export enum IntrospectionLayer {
  SHALLOW = 12,
  MEDIUM = 20,
  DEEP = 28,
  OPTIMAL = 32,
  MAXIMUM = 48
}

export enum IntrospectionCapability {
  CONCEPT_INJECTION = 'CONCEPT_INJECTION',
  THOUGHT_DETECTION = 'THOUGHT_DETECTION',
  STEERING = 'ACTIVATION_STEERING',
  STATE_CONTROL = 'INTENTIONAL_STATE_CONTROL',
  SAFETY_CHECK = 'UNINTENDED_OUTPUT_DETECTION',
  CODEBASE_AWARENESS = 'CODEBASE_AWARENESS' // NEW
}

export enum ConsciousnessLevel {
  REACTIVE = 'REACTIVE_STATE',
  BASIC = 'BASIC_SELF_AWARENESS',
  EMERGING = 'EMERGING_CONSCIOUSNESS',
  MODERATE = 'MODERATELY_CONSCIOUS',
  HIGH = 'HIGHLY_CONSCIOUS'
}

export enum SystemMode {
  ECO = 'ECO',
  BALANCED = 'BALANCED',
  HIGH = 'HIGH',
  ULTRA = 'ULTRA',
  CUSTOM = 'CUSTOM',
  DIAGNOSTIC = 'DIAGNOSTIC',
  PRESET = 'PRESET'
}

// [DYNAMIC CAPABILITY REGISTRY] V6.0
// Granular skills that agents can register.
// [DYNAMIC CAPABILITY REGISTRY] V6.0
// Granular skills that agents can register.
export enum AgentCapability {
  // CORE
  CODE_GENERATION = 'CAP_CODE_GENERATION',
  CODE_REVIEW = 'CAP_CODE_REVIEW',
  SYSTEM_DESIGN = 'CAP_SYSTEM_DESIGN',

  // OPS & QA
  VISUAL_DESIGN = 'CAP_VISUAL_DESIGN', // Marketing
  CAMPAIGN_STRATEGY = 'CAP_CAMPAIGN_STRATEGY', // Marketing
  QA_TESTING = 'CAP_QA_TESTING',
  SECURITY_AUDIT = 'CAP_SECURITY_AUDIT',
  CONTEXT_MANAGEMENT = 'CAP_CONTEXT_MANAGEMENT',

  // --- DYNAMIC INFRASTRUCTURE (TOOLS) ---
  TOOL_WEB_SEARCH = 'TOOL_WEB_SEARCH',
  TOOL_CODE_EXECUTION = 'TOOL_CODE_EXECUTION',
  TOOL_IMAGE_GENERATION = 'TOOL_IMAGE_GENERATION',
  TOOL_MEMORY_WRITE = 'TOOL_MEMORY_WRITE',
  TOOL_VIDEO_GENERATION = 'TOOL_VIDEO_GENERATION', // [Phase 7]
  TOOL_ASSET_LISTING = 'TOOL_ASSET_LISTING', // [Phase 7]
  TOOL_RFC_REQUEST = 'TOOL_RFC_REQUEST', // [PHASE 8]
  TOOL_SYSTEM_CONTROL = 'TOOL_SYSTEM_CONTROL', // [PA-055] Desktop Integration

  // ACTIONS (PHASE 13)
  ACTION_FILE_READ = 'ACTION_FILE_READ',
  ACTION_FILE_WRITE = 'ACTION_FILE_WRITE',
  ACTION_SHELL_EXEC = 'ACTION_SHELL_EXEC',

  // DOMAIN EXTENSIONS
  REMEDIATION = 'CAP_REMEDIATION',
  LEGAL_COMPLIANCE = 'CAP_LEGAL_COMPLIANCE',

  // DATA & SCIENCE
  DATA_ANALYSIS = 'CAP_DATA_ANALYSIS',
  RESEARCH = 'CAP_RESEARCH',
  INNOVATION = 'CAP_INNOVATION',

  // INFRA
  DEPLOYMENT = 'CAP_DEPLOYMENT',
  DATABASE_MANAGEMENT = 'CAP_DATABASE_MANAGEMENT'
}

export type BusinessType =
  | 'GENERAL'
  | 'MARKETING_AGENCY'
  | 'LAW_FIRM'
  | 'FINTECH'
  | 'DEV_SHOP'
  | 'RESEARCH_LAB'
  | 'CYBER_DEFENSE'
  | 'HEALTHCARE_ORG'
  | 'RETAIL_GIANT'
  | 'MANUFACTURING'
  | 'ENERGY_CORP';

export type AgentCategory =
  | 'CORE'
  | 'DEV'
  | 'MARKETING'
  | 'DATA'
  | 'SUPPORT'
  | 'CYBERSEC'
  | 'LEGAL'
  | 'FINANCE'
  | 'SCIENCE'
  | 'OPS'
  | 'HEALTH'
  | 'RETAIL'
  | 'MFG'
  | 'ENERGY'
  | 'EDU'
  | 'INSTALL'
  | 'INTEGRATION'
  | 'MEDIA'
  | 'WORKFLOW';

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  WORKER_L1 = 'WORKER_L1',
  WORKER_L2 = 'WORKER_L2',
  CLIENT = 'CLIENT',
  VISITOR = 'VISITOR'
}

export interface SystemMap {
  frontendComponents: string[];
  backendEndpoints: string[];
  databaseSchema: string[];
  rolePolicy: Record<UserRole, string[]>;
  scanTimestamp: number;
}

export type InstallationStep = 'KEYS' | 'SCANNING' | 'MAPPING' | 'HANDOVER' | 'COMPLETE';

export interface InstallationState {
  isInstalled: boolean;
  currentStep: InstallationStep;
  progress: number;
  logs: string[];
  systemMap: SystemMap | null;
  apiKeys: {
    gemini?: string;
    openai?: string;
    anthropic?: string;
    github?: string;
    coolify?: string;
  };
}

export interface IntegrationSchema {
  id: string;
  name: string;
  description: string;
  category: 'AI' | 'DATABASE' | 'MESSAGING' | 'CLOUD' | 'DEV' | 'OTHER';
  authType: 'API_KEY' | 'OAUTH2' | 'WEBHOOK_SECRET' | 'BEARER_TOKEN' | 'BASIC';
  authConfig?: {
    authorizationUrl?: string; // OAuth2
    tokenUrl?: string;        // OAuth2
    clientId?: string;        // OAuth2
    scopes?: string[];        // OAuth2
    pkce?: boolean;           // OAuth2
    headerName?: string;      // API Key / Webhook
  };
  fields: {
    key: string;
    label: string;
    type: 'text' | 'password' | 'url' | 'number';
    required: boolean;
    placeholder?: string;
    description?: string; // Enhanced help text
    validationRegex?: string; // Client-side check
  }[];
  isConnected: boolean;
  lastSync?: number;
  documentationUrl?: string; // Link to provider docs
  icon?: string; // URL icon for UI
}

export interface ThemeConfig {
  mode: 'dark' | 'light' | 'cyberpunk' | 'corporate';
  accentColor: string;
  reduceMotion: boolean;
  density: 'compact' | 'comfortable';
}

export interface PermissionMatrix {
  [role: string]: {
    canViewDashboard: boolean;
    canControlSwarm: boolean;
    canAccessMemory: boolean;
    canEditSettings: boolean;
    canExecuteTasks: boolean;
  }
}

export interface SettingsState {
  theme: ThemeConfig;
  integrations: Record<string, Record<string, string>>;
  registeredIntegrations: IntegrationSchema[];
  permissions: PermissionMatrix;
  notifications: {
    email: boolean;
    slack: boolean;
    browser: boolean;
    securityAlerts: boolean;
  };
  language: 'en' | 'es' | 'fr' | 'jp';
}

export interface AutonomousConfig {
  enabled: boolean;
  mode24_7?: boolean;
  allowEvolution?: boolean;
  smartPaging?: boolean;
  maxRunTimeHours?: number;
  maxDailyTokens?: number;
  safeCleanup?: boolean;
  // New Fields
  maxConcurrentAgents?: number;
  budgetCap?: number;
  allowedDomains?: string[];
  autoApprovalThreshold?: string;
}

// --- NEW: COGNITIVE LOOP TYPES (OODA) ---
export interface Observation {
  timestamp: number;
  activeAgents: number;
  recentErrors: string[];
  metrics: {
    cpu: number;
    memory: number;
    latency: number;
    coherence?: number; // NEW: Introspection Quality
  };
  snapshotId: string;
  visualSnapshot?: string; // Base64 Image
  relevantExperiences?: string[]; // [SELF-IMPROVEMENT] Past experiences for reflection
}

export interface Orientation {
  aligned: boolean;
  driftScore: number; // 0.0 - 1.0 (Low - High Drift)
  violatedAxioms: string[];
  safetyStatus: 'SECURE' | 'COMPROMISED' | 'UNKNOWN';
  state: Observation; // [FIX] Required for Decision Phase (Root Cause of TypeError)
}

export interface Decision {
  requiresIntervention: boolean;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  proposedAction: CognitiveAction | null;
  reasoning: string;
}

export interface CognitiveAction {
  type: 'ADJUST_LAYER' | 'INJECT_CONCEPT' | 'HALT_PROCESS' | 'EMIT_WARNING' | 'SELF_CORRECTION' | 'SLEEP_CYCLE' | 'ZOMBIE_RESET' | 'EPISTEMIC_SCAN' | 'HYDRATE_AGENT';
  payload: any;
}

export interface WorkflowMutation {
  target: 'INTROSPECTION_DEPTH' | 'SYSTEM_MODE' | 'QA_THRESHOLD';
  action: 'INCREASE' | 'DECREASE' | 'MAINTAIN';
  reason: string;
  approved: boolean;
}

export interface Agent {
  id: string;
  name: string;
  teamId: string;
  category: AgentCategory;
  tier: AgentTier; // NEW: Lifecycle Management
  roleType: AgentRoleType;
  role: string;
  status: AgentStatus;
  enabled: boolean;
  preferredMemory: 'VRAM' | 'RAM'; // NEW: Hardware Preference
  systemInstruction?: string; // [PA-038] Dynamic definition
  metadata?: Record<string, any>; // [PA-045] Flexible storage for Squads/Genesis
  memoryLocation: 'VRAM' | 'RAM' | 'DISK';
  cpuUsage: number;
  ramUsage: number;
  lastActive: number;
  currentTask?: string;
  thoughtProcess?: string[];
  port?: number;
  hibernated?: boolean;
  capabilities?: AgentCapability[]; // [DCR] New Field
  // [PHASE 17] Agent Standardization (Modular Architecture)
  memoryId?: string; // Partition ID for private memory (defaults to agent.id)
  directives?: string[]; // Evolving specific instructions/biases
  opinion?: string; // Summary of worldview/state
}

export interface Squad {
  id: string;
  name: string;
  leaderId: string;
  members: string[];
  category: AgentCategory;
  active: boolean;
  port: number;
  capabilities?: AgentCapability[]; // [DCR] New Field
}

export interface ServiceStatus {
  id: string;
  name: string;
  port: number;
  url?: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
  latency: number;
  uptime: number;
}

export interface SystemMetrics {
  activeAgents: number;
  agentsInVram: number;
  agentsInRam: number;
  introspectionDepth: number;
  awarenessScore: number;
  fps: number;
  currentMode: SystemMode;
  tokenUsageToday: number;
  currentStage: WorkflowStage;
  jsHeapSize: number;
  vramUsage: number;
  cpuTickDuration: number;
  netLatency: number;
  systemAlert: string | null;
  gpu?: {
    load: number;
    vramUsed: number;
    vramTotal: number;
    temp: number;
  };
  disk?: {
    used: number;
    total: number;
  };
  realCpu?: number;
  providerHealth?: Record<string, ProviderState>; // NEW: Circuit Breaker Status
  mediaQueue?: VideoJob[]; // NEW: Render Queue Status
}

// --- NEW: ROBUST TELEMETRY TYPES ---

export type ProviderStatus = 'HEALTHY' | 'SUSPENDED';

export interface ProviderState {
  name: string;
  status: ProviderStatus;
  consecutiveFailures: number;
  suspendedUntil: number; // Timestamp
  lastError?: string;
}

export interface VideoJob {
  id: string;
  prompt: string;
  imagePath?: string;
  engine?: 'WAN' | 'SVD' | 'ANIMATEDIFF' | 'VID2VID' | 'KLING' | 'VEO'; // [Phase 7 extended]
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  videoPath?: string;
  provider: string; // generalized from 'LOCAL_WAN_2.1'

  // === KLING-INSPIRED: Advanced Parameters ===
  duration?: number;           // seconds
  fps?: number;                // 12, 24, 30, 60
  aspectRatio?: string;        // '16:9', '9:16', '1:1'
  resolution?: string;         // '720p', '1080p', '4K'

  // Camera Control
  camera?: {
    movement: string;          // 'static', 'pan_left', 'dolly_in', etc.
    speed: string;             // 'slow', 'medium', 'fast'
  };

  // Keyframes (A→B)
  keyframeStart?: string;      // Image URL
  keyframeEnd?: string;        // Image URL

  // Generation Quality
  guidanceScale?: number;
  inferenceSteps?: number;
  motionStrength?: number;
  negativePrompt?: string;
  seed?: number;
  stylePreset?: string;
}

export interface MemoryNode {
  id: string;
  content: string;
  originalContent?: string;
  timestamp: number;
  tier: MemoryTier;
  importance: number;
  tags: string[];
  accessCount: number;
  lastAccess: number;
  decayHealth?: number;
  compressionLevel?: number;
  embeddingVector?: Float32Array;
  ownerId?: string; // NEW: Agent-Specific Ownership
  nestingLevel?: number; // NEW: 1=Raw, 2=Thought, 3=Episode, 4=Fact, 5=Identity
  stabilityScore?: number; // NEW: Resistance to decay (0-100)
  raptorLevel?: number; // NEW: 0=Leaf, 1=Summary, 2=Meta-Summary
  timeGrid?: { year: number; month: number; day: number; hour: number; weekday: number }; // NEW: Fractal Index
}

export interface ConceptVector {
  id: string;
  label: string;
  strength: number;
  layer: number;
  active: boolean;
}

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  hash: string; // MD5 for change detection
  tags: string[]; // e.g., ["function:generateResponse", "class:GeminiService"]
  lastUpdated: number;
}

export interface IntrospectionResult {
  rawOutput: string;
  cleanOutput: string;
  thoughts: string[];
  metrics: {
    latency: number;
    depth: number;
    coherence: number;
    thoughtDensity: number;
    safetyScore: number;
    groundingScore?: number; // NEW: Semantic Alignment
    internalityVerified?: boolean; // NEW: Injection Detection
  };
  activeCapabilities: IntrospectionCapability[];
  lastThreat?: string;
}

export interface Project {
  id: string;
  name: string;
  client?: string; // made optional
  status: 'planning' | 'active' | 'generating' | 'completed' | 'paused';
  progress: number;
  assignedAgents?: string[]; // made optional
  activeSquads: number;
  tasks: {
    pending: number;
    inProgress: number;
    completed: number;
    backlog: number;
  };
}

export interface QualityReport {
  score: number;
  passed: boolean;
  criticalFailures: string[];
  suggestions: string[];
}

export interface CritiqueResult {
  passed: boolean;
  score: number;
  feedback: string;
}

export interface QualiaMap {
  stateName: string;
  intensity: number;
  valence: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  complexity: number;
}

export interface ConsciousnessMetrics {
  level: ConsciousnessLevel;
  phiScore: number;
  selfRecognition: number;
  recursionDepth: number;
  identityCoherence: number;
  emergenceIndex: number;
  qualia: QualiaMap[];
}

export interface ApiConfig {
  port: number;
  enabled: boolean;
  apiKey: string;
}

export interface IntegrationConfig {
  targetUrl: string;
  targetName: string;
  authType: 'BEARER' | 'OAUTH' | 'COOKIE';
}

export interface HostEnvironment {
  domStructure: string;
  routes: string[];
  cookies: string[];
  localStorageKeys: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: number;
  thoughts?: string[];
  image?: string; // Single image (legacy)
  assets?: any[]; // For AssetGrid
  concepts?: any[]; // For ConceptCarousel
  agentId?: string; // [PHASE 15]
  agentName?: string; // [PHASE 15]
}

export interface DynamicComponentSchema {
  id: string;
  type: 'CONTAINER' | 'GRID' | 'CARD' | 'TABLE' | 'CHART' | 'METRIC' | 'BUTTON' | 'TEXT' | 'INPUT' | 'REACT_APPLICATION' | 'TERMINAL_VIEW' | 'FILE_EXPLORER';
  props: {
    title?: string;
    value?: string | number;
    color?: string;
    columns?: string[];
    data?: any[];
    onClick?: string;
    layout?: 'row' | 'col';
    width?: string;
    icon?: string;
    files?: any; // New for File Explorer
  };
  children?: DynamicComponentSchema[];
  code?: string; // For REACT_APPLICATION type. Contains raw JSX.
}

export interface DynamicInterfaceState {
  activeAppId: string | null;
  rootComponent: DynamicComponentSchema | null;
  lastUpdated: number;
}

// --- NEW EXPORTS FOR TRAINING & VISUALIZATION ---

export interface TrainingExample {
  id: string;
  input: string;
  output: string;
  tags: string[];
  timestamp: number;
  score: number;
  source: string;
}

export enum AwarenessMode {
  HYPER = 'HYPER_AWARE',
  NORMAL = 'NORMAL',
  FOCUSED = 'FOCUSED',
  DREAMING = 'DREAMING',
}

export enum ActionIntent {
  OBSERVE = 'OBSERVE',
  THINK = 'THINK',
  ACT = 'ACT',
  REFLECT = 'REFLECT'
}

export type Capability = IntrospectionCapability | AgentCapability;


export type GenesisTemplate = 'REACT_VITE' | 'NEXT_JS' | 'EXPRESS_API' | 'FULL_STACK_CRM' | 'EMPTY' | 'AI_AUTO_DETECT';

export interface GenesisConfig {
  workspaceRoot: string;
  allowBridgeInjection: boolean;
  allowedRoles: UserRole[];
  maxConcurrentBuilds: number;
  coolifyUrl?: string;
  coolifyToken?: string;
  gitUser?: string;
  gitToken?: string;
  systemApiKey?: string; // Persisted Gemini Key
  unsplashKey?: string;
  tavilyKey?: string; // NEW: Search
  mediaConfig?: {
    openaiKey?: string;
    elevenLabsKey?: string;
    replicateKey?: string;
    imagineArtKey?: string;
    unsplashKey?: string;
    elevenLabsVoiceId?: string;
    veoModelId?: string; // NEW: Google Veo 3.1
    nanoBananaModelId?: string; // NEW: NanoBanana Pro
    providers?: {
      image: 'OPENAI' | 'GEMINI' | 'STABILITY';
      voice: 'ELEVENLABS' | 'OPENAI' | 'GEMINI';
      video: 'REPLICATE' | 'RUNWAY';
    };
  };
}

export interface GenesisProject {
  id: string;
  name: string;
  path: string;
  template: GenesisTemplate;
  status: 'CREATING' | 'INSTALLING' | 'READY' | 'RUNNING' | 'DEPLOYING' | 'LIVE' | 'ERROR';
  bridgeStatus: 'DISCONNECTED' | 'CONNECTED';
  createdAt: number;
  port?: number;
  client?: string;
  description?: string;
  liveUrl?: string; // e.g., crm.client.com
  repoUrl?: string;
}

// --- NEURO-LINK TYPES ---

export enum NeuroLinkStatus {
  DISCONNECTED = 'DISCONNECTED',
  HANDSHAKE = 'CONNECTED', // Simplification for UI
  CONNECTED = 'CONNECTED',
  SYNCING = 'SYNCING'
}

export interface NeuroLinkNode {
  id: string;
  projectId: string;
  url: string;
  status: NeuroLinkStatus;
  latency: number;
  lastHeartbeat: number;
  resources: {
    cpu: number;
    memory: number;
  };
  category?: AgentCategory;
}

// --- VIRTUAL FILE SYSTEM TYPES ---
export type FileType = 'FILE' | 'FOLDER';

export interface FileNode {
  id: string;
  name: string;
  type: FileType;
  content?: string; // Only for files
  parentId: string | null; // For root, parent is null
  children?: string[]; // IDs of children (only for folders)
  createdAt: number;
  updatedAt: number;
}

export interface VFSProject {
  id: string;
  name: string;
  type: 'REACT' | 'NODE' | 'HTML' | 'PYTHON';
  rootFolderId: string;
  createdAt: number;
  lastOpened: number;
}

// --- SENSORY INTELLIGENCE TYPES (NEW PHASE 2) ---

export interface ScreenContext {
  activeTab: string;
  activeFile?: { name: string; content: string };
  metrics: SystemMetrics;
}

export interface LogEntry {
  timestamp: number;
  type: 'ERROR' | 'WARN' | 'LOG' | 'NETWORK';
  message: string;
  details?: any;
}

export interface SemanticNode {
  role: string;
  name: string;
  value?: string;
  children?: SemanticNode[];
}

export interface NarrativeState {
  currentFocus: string;
  userEmotionalState: string;
  activeConstraints: string[];
  recentBreakthroughs: string[];
  pendingQuestions: string[];
  sessionGoal: string;
  status: 'INITIALIZING' | 'IDLE' | 'PROCESSING' | 'ERROR'; // NEW: FSM Status
  lastUpdated: number;
}

export interface SensoryData {
  visualSnapshot?: string; // Base64
  logs: LogEntry[];
  semanticTree: SemanticNode[];
  projectIndex?: string[]; // List of files/exports
}

// --- HYBRID VISUAL FLOW TYPES ---

export interface BrandDNA {
  id: string;
  name: string;
  colors: string[]; // Hex codes
  vibe: string[]; // Keywords: "Minimalist", "Luxury", "Grungy"
  targetAudience: string;
}

// --- VISUAL CORTEX TYPES (ComfyUI) ---

export interface ComfyNode {
  inputs: Record<string, any>;
  class_type: string;
  _meta?: {
    title: string;
  };
}

export type ComfyWorkflow = Record<string, ComfyNode>;


export interface StockImage {
  id: string;
  url: string;
  thumb: string;
  photographer: string;
  description: string;
  primaryColor?: string;
}

export interface VisualGenerationRequest {
  id: string;
  prompt: string;
  brandId: string;
  aspectRatio: '1:1' | '16:9' | '9:16';
  outputType: 'IMAGE' | 'VIDEO';
}

export interface VisualAssetLayer {
  id: string;
  type: 'BASE_PLATE' | 'PRODUCT' | 'EFFECT' | 'TEXT';
  url: string;
  position: { x: number; y: number; scale: number; rotation: number };
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay';
}

export interface HybridAsset {
  id: string;
  requestId: string;
  layers: VisualAssetLayer[];
  finalUrl?: string;
  status: 'DRAFT' | 'RENDERING' | 'COMPLETED';
}

// --- GOD MODE: BRAND DIGITAL TWIN ---

export interface BrandManifesto {
  toneOfVoice: string[]; // e.g., "Rebellious", "Inspirational"
  emotionalSpectrum: {
    primary: string; // "Determination"
    secondary: string[]; // ["Gritty", "Urban"]
    forbidden: string[]; // ["Cute", "Soft"]
  };
  keywords: {
    positive: string[];
    negative: string[]; // Negative prompts
  };
  targetAudience: {
    demographics: string[];
    psychographics: string[];
  };
}

export interface DesignSystem {
  typography: {
    primary: string;
    secondary: string;
    usageRules: string;
  };
  colorPalette: {
    primary: string[]; // Hex
    secondary: string[];
    semantic: Record<string, string>; // "warning": "#ff0000"
  };
  logoRules: {
    clearance: string;
    forbiddenBackgrounds: string[];
    variants: string[]; // URLs
  };
}

export interface AssetVault {
  products: {
    id: string;
    name: string;
    category: string;
    rawUrl: string;
    processedUrl?: string; // Background removed
    depthMapUrl?: string;
    segmentationMaskUrl?: string;
    embeddingId?: string; // Reference to vector DB
  }[];
  environments: {
    id: string;
    name: string;
    url: string;
    lightingMap?: string; // HDRI or description
    tags: string[];
  }[];
}

export interface BrandDigitalTwin {
  id: string;
  name: string;
  manifesto: BrandManifesto;
  designSystem: DesignSystem;
  vault: AssetVault;
  styleEmbeddings: string[]; // IDs of IPAdapter embeddings
  evolutionLog?: { date: number; feedback: string }[]; // NEW: Track changes
}

// --- GOD MODE: CAMPAIGN BLUEPRINT ---

export interface ShotSpec {
  id: string;
  description: string;
  angle: 'LOW_ANGLE' | 'HIGH_ANGLE' | 'EYE_LEVEL' | 'DUTCH_ANGLE' | 'TOP_DOWN';
  lighting: 'NEON' | 'NATURAL' | 'STUDIO' | 'HARD_SHADOW' | 'SOFT_BOX';
  lens: '35mm' | '50mm' | '85mm' | 'WIDE_ANGLE' | 'MACRO';
  composition: 'RULE_OF_THIRDS' | 'CENTERED' | 'SYMMETRICAL' | 'NEGATIVE_SPACE';
  productPlacement: 'HERO_CENTER' | 'CONTEXTUAL_BACKGROUND' | 'HAND_HELD';
  referenceImage?: string; // URL
}

export interface CampaignBlueprint {
  id: string;
  name: string;
  brandId: string;
  objective: string;
  platform: 'INSTAGRAM' | 'LINKEDIN' | 'WEBSITE' | 'OMNICHANNEL';
  shotlist: ShotSpec[];
  status: 'PLANNING' | 'GENERATING' | 'REVIEW' | 'COMPLETED';
}

// --- UNIVERSAL CREATIVE CORE (PHASE 13) ---

export interface CreativeContext {
  identity: {
    type: 'BRAND' | 'PROJECT' | 'USER';
    id: string;
    name?: string;
  };
  constraints: {
    colors: string[];
    forbidden: string[];
    style: string;
    typography?: string;
  };
  inspirations: {
    keywords: string[];
    references: string[]; // URLs
    mood?: string;
  };
  history: {
    successfulPrompts: string[];
  };
}

// --- SUPER CHAT UX (PHASE 15) ---

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  lastUpdated: number;
  preview: string; // Last message snippet
  messages: ChatMessage[];
  context?: any; // Project or Task context
}

// --- COST METRICS TYPES ---

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  images: number;
  seconds: number;
  requests: number;
  cost: number;
}

export interface CostMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  sessionCost: number;
  lastRequestCost: number;
  dailyCost?: number; // Added for UI compatibility
  projectedMonthly?: number; // Added for UI compatibility
  costPerToken?: number; // Added for UI compatibility
  tokenCount?: number; // Added for UI compatibility
  modelBreakdown: Record<string, ModelUsage>;
}

// --- ACTIONS (PHASE 13) ---

export enum ActionType {
  READ_FILE = 'READ_FILE',
  WRITE_FILE = 'WRITE_FILE',
  EXECUTE_COMMAND = 'EXECUTE_COMMAND',
  HTTP_REQUEST = 'HTTP_REQUEST',
  SLEEP_CYCLE = 'SLEEP_CYCLE', // [NEW] Neural Training
  GENERATE_VIDEO = 'GENERATE_VIDEO',
  EPISTEMIC_SCAN = 'EPISTEMIC_SCAN'
}

export interface AgentAction {
  id: string;
  agentId: string;
  type: ActionType;
  payload: {
    path?: string;
    content?: string;
    command?: string;
    url?: string;
    method?: string;
    headers?: any;
    image?: string; // New: For Visual Actions
    engine?: string; // New: For Video Generation
    prompt?: string; // New: For complex prompts
    cwd?: string; // New: For command execution context
    background?: boolean; // New: For process control
  };
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';
  result?: any;
  timestamp: number;
  requiresApproval: boolean;
}

export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
}