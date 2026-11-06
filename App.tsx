import React, { useState, useEffect, Suspense } from 'react';
import Sidebar, { navigationItems } from './components/Sidebar';
import { Agent, SystemMode, AutonomousConfig, WorkflowStage, IntrospectionLayer, UserRole, Project, MorphPayload, SystemMetrics, SystemProtocol } from './types';
import { DEFAULT_AUTONOMOUS_CONFIG, DEFAULT_API_CONFIG } from './constants';
import { api } from './utils/api';
import { systemBus } from './services/systemBus';
import { useAuth } from './components/authContext';
import { SystemErrorBoundary } from './components/SystemErrorBoundary';

// CRITICAL COMPONENTS - Eager load for fast initial render
// [OPTIMIZATION] Dashboard is now Lazy Loaded to defer Recharts/Charts bundle
// import Dashboard from './components/Dashboard';

import ProtocolOverlay from './components/ProtocolOverlay';
import NotificationCenter from './components/NotificationCenter';

// LAZY LOAD SECONDARY COMPONENTS - Only loaded when tab is visited
const Dashboard = React.lazy(() => import('./components/Dashboard'));
const AgentOrchestrator = React.lazy(() => import('./components/AgentOrchestrator'));
const TerminalLog = React.lazy(() => import('./components/TerminalLog'));
const SystemControl = React.lazy(() => import('./components/SystemControl'));
const ContinuumMemoryExplorer = React.lazy(() => import('./components/ContinuumMemoryExplorer'));
const Settings = React.lazy(() => import('./components/Settings'));
const DynamicWorkspace = React.lazy(() => import('./components/DynamicWorkspace'));
const MediaStudio = React.lazy(() => import('./components/MediaStudio'));
const IntrospectionHub = React.lazy(() => import('./components/IntrospectionHub'));
const ChatWidget = React.lazy(() => import('./components/ChatWidget'));
const DrivePanel = React.lazy(() => import('./components/DrivePanel'));
const EmailPanel = React.lazy(() => import('./components/EmailPanel'));
const NexusCanvas = React.lazy(() => import('./components/canvas/NexusCanvas'));

// [OPTIMIZATION] Lazy load Visual Cortex to defer html2canvas/webgl utils
const VisualCortex = React.lazy(() => import('./components/VisualCortex').then(module => ({ default: module.VisualCortex })));

// NOTE: Backend services are no longer imported directly to avoid Vite build errors.
// The frontend now acts as a pure View layer, fetching state from the API.

declare global {
  interface Window {
    performance: any;
  }
}

const App: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [autonomyConfig, setAutonomyConfig] = useState<AutonomousConfig>(DEFAULT_AUTONOMOUS_CONFIG);
  const [liveThoughts, setLiveThoughts] = useState<string[]>([]);
  // [NEW] Distributed Squad Thoughts (The "100% Real" Stuff)
  const [squadThoughts, setSquadThoughts] = useState<Record<string, string[]>>({});

  // Settings are now fetched or managed locally for UI preferences
  const [appSettings, setAppSettings] = useState({
    theme: { mode: 'dark', density: 'comfortable', accentColor: 'cyan', reduceMotion: false },
    integrations: {},
    registeredIntegrations: [],
    permissions: {},
    notifications: {},
    language: 'en'
  });
  const [uiOverride, setUiOverride] = useState<MorphPayload | null>(null);

  const [dashboardProjects, setDashboardProjects] = useState<Project[]>([]);
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<SystemMetrics>({
    activeAgents: 0,
    agentsInVram: 0,
    agentsInRam: 0,
    introspectionDepth: (() => { try { return parseInt(localStorage.getItem('silhouette_introspection_depth') || '32'); } catch { return 32; } })(),
    awarenessScore: 85.0,
    fps: 60,
    currentMode: (() => { try { return (localStorage.getItem('silhouette_power_mode') as SystemMode) || SystemMode.ECO; } catch { return SystemMode.ECO; } })(),
    tokenUsageToday: 0,
    currentStage: WorkflowStage.IDLE,
    jsHeapSize: 0,
    vramUsage: 0,
    cpuTickDuration: 0,
    netLatency: 0,
    systemAlert: null
  });

  const [logs, setLogs] = useState<string[]>([]);
  const [driveOpen, setDriveOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const mapBackendRoleToUiRole = (role?: string): UserRole => {
    switch (role) {
      case 'CREATOR':
        return UserRole.SUPER_ADMIN;
      case 'ADMIN':
        return UserRole.ADMIN;
      case 'USER':
        return UserRole.CLIENT;
      default:
        return UserRole.VISITOR;
    }
  };

  const currentUserRole = mapBackendRoleToUiRole(user?.role);

  // ... (effects unchanged) ...

  // Restore active tab
  useEffect(() => {
    const savedTab = localStorage.getItem('silhouette_active_tab');
    if (savedTab) setActiveTab(savedTab);
  }, []);

  useEffect(() => {
    localStorage.setItem('silhouette_active_tab', activeTab);
  }, [activeTab]);

  // ADAPTIVE POLLING with UNIFIED ENDPOINT
  // - Uses single /full-state call instead of 4 separate calls
  // - 3s when user is active, 30s when idle
  // - SSE handles real-time updates, this is fallback/sync
  useEffect(() => {
    let lastActivity = Date.now();
    let sseConnected = false;

    // Track user activity
    const handleActivity = () => { lastActivity = Date.now(); };
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);

    const pollSystem = async () => {
      try {
        // UNIFIED ENDPOINT - 1 call instead of 4
        const data = await api.get<any>('/v1/system/full-state');

        // Update telemetry
        if (data.telemetry) {
          setMetrics(prev => ({
            ...prev,
            activeAgents: data.orchestrator?.agentCount || 0,
            agentsInVram: data.telemetry.agentsInVram || 0,
            agentsInRam: data.telemetry.agentsInRam || 0,
            jsHeapSize: data.telemetry.ram?.active ? data.telemetry.ram.active / (1024 * 1024) : 0,
            vramUsage: (data.telemetry.gpu?.vramUsed && data.telemetry.gpu?.vramTotal)
              ? (data.telemetry.gpu.vramUsed / data.telemetry.gpu.vramTotal) * 100 : 0,
            cpuTickDuration: data.telemetry.cpu || 0,
            realCpu: data.telemetry.cpu || 0,
            gpu: data.telemetry.gpu,
            providerHealth: data.telemetry.providerHealth,
            mediaQueue: data.telemetry.mediaQueue,
            brain: data.telemetry.brain // [NEW] Unified Daemon cognitive data
          }));
        }

        // Update agents
        if (data.orchestrator?.agents) {
          setAgents(data.orchestrator.agents);
        }

        // Update thoughts
        if (data.introspection?.thoughts) {
          setLiveThoughts(data.introspection.thoughts);
        }

        // Update projects for Dashboard Active Operations (VFS)
        if (data.projects) {
          setDashboardProjects(data.projects);
        }

      } catch (e) {
        console.error("[POLL] Error (will retry):", e);
      } finally {
        // ADAPTIVE INTERVAL: 3s if active, 30s if idle (no activity for 30s)
        const isIdle = (Date.now() - lastActivity) > 30000;
        const interval = sseConnected ? 30000 : (isIdle ? 30000 : 3000);
        timeoutId = setTimeout(pollSystem, interval);
      }
    };

    let timeoutId = setTimeout(pollSystem, 1000); // Initial fetch

    // SSE connection status
    const handleSSEStatus = (connected: boolean) => { sseConnected = connected; };

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
    };
  }, []); // [NEURO-UPDATE] SSE BRIDGE (Server -> Client Bus)

  useEffect(() => {
    let evtSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000; // Start at 1s, exponential backoff up to 30s
    let isCancelled = false;

    function connectSSE() {
      if (isCancelled) return;

      console.log("[SSE] Connecting to Neural Uplink...");
      evtSource = new EventSource(`/v1/factory/stream?apiKey=${DEFAULT_API_CONFIG.apiKey}`);

      evtSource.onopen = () => {
        console.log("[SSE] Connected.");
        reconnectDelay = 1000; // Reset backoff on successful connection
      };

      evtSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'bus_event') {
            const innerEvent = data.payload;
            if (innerEvent && innerEvent.type) {
              systemBus.emit(innerEvent.type, innerEvent.payload, 'SERVER_BRIDGE');
            }
          } else if (data.type) {
            systemBus.emit(data.type, data.payload, 'SERVER_BRIDGE');

            if (data.type === SystemProtocol.TASK_COMPLETION) {
              console.log("[SSE] Task Completed:", data.payload);
            }

            if (data.type === SystemProtocol.UI_REFRESH && data.payload?.uiCommand) {
              const cmd = data.payload.uiCommand;

              if (cmd.type === 'NAVIGATE') {
                setActiveTab(cmd.destination);
              } else if (cmd.type === 'ACTION') {
                if (cmd.action === 'open_panel') {
                  if (cmd.panel === 'drive') setDriveOpen(true);
                  else if (cmd.panel === 'email') setEmailOpen(true);
                } else if (cmd.action === 'close_panel') {
                  if (cmd.panel === 'drive') setDriveOpen(false);
                  else if (cmd.panel === 'email') setEmailOpen(false);
                } else if (cmd.action === 'highlight' && cmd.target) {
                  const el = document.querySelector(cmd.target);
                  if (el) {
                    el.classList.add('silhouette-highlight');
                    setTimeout(() => el.classList.remove('silhouette-highlight'), cmd.durationMs || 3000);
                  }
                }
              }
            }
          }
        } catch (err) {
          // Ignore parse errors for heartbeat/keepalive messages
        }
      };

      evtSource.onerror = () => {
        if (isCancelled) return;
        console.warn(`[SSE] Connection lost. Reconnecting in ${reconnectDelay / 1000}s...`);
        evtSource?.close();
        evtSource = null;
        reconnectTimer = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Exponential backoff, max 30s
          connectSSE();
        }, reconnectDelay);
      };
    }

    connectSSE();

    return () => {
      isCancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      evtSource?.close();
    };
  }, []);

  const handleModeChange = (mode: SystemMode) => {
    setMetrics(prev => ({ ...prev, currentMode: mode }));
    localStorage.setItem('silhouette_power_mode', mode);
    api.post('/v1/system/mode', { mode }).catch(console.error);
  };

  const handleIntrospectionChange = (layer: IntrospectionLayer) => {
    setMetrics(prev => ({ ...prev, introspectionDepth: layer }));
    localStorage.setItem('silhouette_introspection_depth', layer.toString());
    api.post('/v1/introspection/layer', { layer }).catch(console.error);
  };

  const handleAgentThought = (agentId: string, thoughts: string[], role: string) => {
    setSquadThoughts(prev => ({
      ...prev,
      [agentId]: thoughts
    }));
  };

  const handleCreateCampaign = () => {
    const defaultName = `Campaign ${new Date().toLocaleDateString().replace(/\//g, '-')}`;
    const name = prompt("SYSTEM PROTOCOL: INITIALIZE NEW CAMPAIGN\nEnter Project Identifier:", defaultName);
    if (name) {
      // Send request to server to create project
      console.log("Creating campaign:", name);
    }
  };

  // Track visited tabs to lazy-load components but keep them alive afterwards
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['dashboard']));

  useEffect(() => {
    setVisitedTabs(prev => {
      const newSet = new Set(prev);
      newSet.add(activeTab);
      return newSet;
    });
  }, [activeTab]);

  const renderContent = () => {
    return (
      <>
        <div style={{ display: activeTab === 'dashboard' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('dashboard') && <Dashboard metrics={metrics} projects={dashboardProjects} onCreateProject={handleCreateCampaign} />}
        </div>
        <div style={{ display: activeTab === 'system_control' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('system_control') && (
            <SystemControl
              metrics={metrics}
              setMode={handleModeChange}
              autonomyConfig={autonomyConfig}
              setAutonomyConfig={setAutonomyConfig}
            />
          )}
        </div>
        <div style={{ display: activeTab === 'orchestrator' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('orchestrator') && <AgentOrchestrator agents={agents} currentStage={metrics.currentStage} squadThoughts={squadThoughts} />}
        </div>
        <div style={{ display: activeTab === 'introspection' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('introspection') && (
            <IntrospectionHub />
          )}
        </div>
        <div style={{ display: activeTab === 'visual_cortex' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('visual_cortex') && (
            <React.Suspense fallback={<div className="flex items-center justify-center h-full text-cyan-400">Loading Visual Cortex...</div>}>
              <NexusCanvas />
            </React.Suspense>
          )}
        </div>
        <div style={{ display: activeTab === 'memory' ? 'block' : 'none', height: '100%' }}>
          {activeTab === 'memory' && <ContinuumMemoryExplorer isActive />}
        </div>
        <div style={{ display: activeTab === 'dynamic_workspace' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('dynamic_workspace') && <DynamicWorkspace initialProjectId={pendingProjectId} />}
        </div>
        <div style={{ display: activeTab === 'media_studio' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('media_studio') && (
            <React.Suspense fallback={<div className="flex items-center justify-center h-full text-cyan-400">Loading Neural Engine...</div>}>
              <MediaStudio />
            </React.Suspense>
          )}
        </div>
        <div style={{ display: activeTab === 'settings' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('settings') && <Settings />}
        </div>
        <div style={{ display: activeTab === 'terminal' ? 'block' : 'none', height: '100%' }}>
          {visitedTabs.has('terminal') && <TerminalLog logs={logs} />}
        </div>
      </>
    );
  };

  const mode = uiOverride?.mode === 'DEFENSE' ? 'dark' : (uiOverride?.mode === 'FLOW' ? 'cyberpunk' : (appSettings.theme?.mode || 'dark'));
  const density = uiOverride?.density || (appSettings.theme?.density || 'comfortable');

  const borderClass = uiOverride?.mode === 'DEFENSE' ? 'border-4 border-red-900' : '';
  const contentPaddingClass = density === 'compact'
    ? 'px-3 pb-24 pt-3 sm:px-5 sm:pt-5 md:px-6 md:pb-8 md:pt-5'
    : 'px-4 pb-28 pt-4 sm:px-6 sm:pt-6 md:px-8 md:pb-10 md:pt-6';
  const activeNavigation = navigationItems.find(item => item.id === activeTab) || navigationItems[0];
  const ActiveTabIcon = activeNavigation.icon;
  const mobileQuickTabs = navigationItems.filter(item => ['dashboard', 'orchestrator', 'dynamic_workspace', 'settings'].includes(item.id));
  const mobileLabelMap: Record<string, string> = {
    dashboard: 'Home',
    orchestrator: 'Swarm',
    dynamic_workspace: 'Work',
    settings: 'Settings',
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className={`relative flex min-h-[100dvh] bg-slate-950 overflow-hidden ${mode} ${borderClass}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.08),transparent_24%),linear-gradient(180deg,rgba(15,23,42,0.94),rgba(2,6,23,1))]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgba(148,163,184,0.14)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.14)_1px,transparent_1px)] [background-size:32px_32px]" />
      <ProtocolOverlay />

      {/* HEADLESS SENSORS - Wrapped in Suspense */}
      <SystemErrorBoundary name="visual cortex" compact>
        <Suspense fallback={null}>
          <VisualCortex />
        </Suspense>
      </SystemErrorBoundary>

      <SystemErrorBoundary name="chat widget" compact>
        <Suspense fallback={null}>
          <ChatWidget
            currentUserRole={currentUserRole}
            currentUserName={user?.name}
            systemMetrics={metrics}
            onUpdateThoughts={setLiveThoughts}
            onAgentThought={handleAgentThought}
          />
        </Suspense>
      </SystemErrorBoundary>

      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={handleTabChange}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
        onDriveClick={() => setDriveOpen(true)} 
        onEmailClick={() => setEmailOpen(true)} 
      />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/75 backdrop-blur-xl supports-[backdrop-filter]:bg-slate-950/60">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 md:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                className="md:hidden rounded-xl border border-cyan-900/40 bg-slate-900/70 p-2 text-cyan-300 hover:bg-cyan-950/40 transition-colors"
                aria-label="Open navigation"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                </svg>
              </button>

              <div className="min-w-0">
                <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-cyan-400/70">Silhouette Agency OS</div>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-white">
                  <ActiveTabIcon className="h-4 w-4 shrink-0 text-cyan-300" />
                  <span className="truncate text-sm font-medium sm:text-base">{activeNavigation.label}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {user && (
                <div className="hidden rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.18em] text-cyan-200 lg:flex">
                  {user.name} · {user.role}
                </div>
              )}
              <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[0.2em] text-white/50 md:flex">
                {metrics.currentMode}
              </div>
              <NotificationCenter />
            </div>
          </div>
        </div>

        <div className="relative flex-1 overflow-y-auto custom-scrollbar">
          <div className="pointer-events-none absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-cyan-500/60 via-blue-500/30 to-cyan-500/60" />
          <div className={`mx-auto flex min-h-full w-full max-w-[1720px] flex-col ${contentPaddingClass}`}>
            <SystemErrorBoundary name={activeNavigation.label}>
              <Suspense fallback={
                <div className="flex min-h-[50vh] items-center justify-center text-cyan-400">
                  Loading module...
                </div>
              }>
                {renderContent()}
              </Suspense>
            </SystemErrorBoundary>
          </div>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1 rounded-2xl border border-white/10 bg-slate-950/90 p-2 shadow-[0_20px_40px_rgba(2,6,23,0.55)] backdrop-blur-xl">
          {mobileQuickTabs.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleTabChange(item.id)}
                className={`flex min-w-0 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-mono transition-colors ${isActive ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/45 hover:text-white hover:bg-white/5'}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{mobileLabelMap[item.id] || item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-mono text-white/45 transition-colors hover:text-white hover:bg-white/5"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
            </svg>
            <span>More</span>
          </button>
        </div>
      </div>

      {/* Drive Panel (Lazy Loaded) */}
      <Suspense fallback={null}>
        <DrivePanel isOpen={driveOpen} onClose={() => setDriveOpen(false)} />
      </Suspense>

      {/* Email Panel (Lazy Loaded) */}
      <Suspense fallback={null}>
        <EmailPanel isOpen={emailOpen} onClose={() => setEmailOpen(false)} />
      </Suspense>
    </div>
  );
};

export default App;
