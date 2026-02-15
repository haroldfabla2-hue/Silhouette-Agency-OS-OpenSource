import React, { useState, useEffect, Suspense } from 'react';
import Sidebar from './components/Sidebar';
import { Agent, SystemMode, AutonomousConfig, WorkflowStage, IntrospectionLayer, UserRole, Project, MorphPayload, SystemMetrics, SystemProtocol } from './types';
import { DEFAULT_AUTONOMOUS_CONFIG, DEFAULT_API_CONFIG } from './constants';
import { api } from './utils/api';
import { systemBus } from './services/systemBus';
import LoginGate from './components/LoginGate';

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
  // ... (state definitions unchanged) ...

  const [currentUserRole, setCurrentUserRole] = useState<UserRole>(UserRole.ADMIN);
  const [activeTab, setActiveTab] = useState('dashboard');
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
    introspectionDepth: parseInt(localStorage.getItem('silhouette_introspection_depth') || '32'),
    awarenessScore: 85.0,
    fps: 60,
    currentMode: (localStorage.getItem('silhouette_power_mode') as SystemMode) || SystemMode.ECO,
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
            mediaQueue: data.telemetry.mediaQueue
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
    console.log("🔌 [SSE] Connecting to Neural Uplink...");
    const evtSource = new EventSource(`/v1/factory/stream?apiKey=${DEFAULT_API_CONFIG.apiKey}`);

    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'bus_event') {
          // [PA-045] Unwrap Server Bus Events so components hear the actual protocol
          // Server sends: { type: 'bus_event', payload: { type: 'PROTOCOL_VISUAL_REQUEST', payload: {} } }
          const innerEvent = data.payload;
          if (innerEvent && innerEvent.type) {
            systemBus.emit(innerEvent.type, innerEvent.payload, 'SERVER_BRIDGE');
          }
        } else if (data.type) {
          // Legacy direct events or Logs
          systemBus.emit(data.type, data.payload, 'SERVER_BRIDGE');
          // ... existing logic ...

          // Special Handlers for UI state caching
          if (data.type === SystemProtocol.TASK_COMPLETION) {
            console.log("✅ [SSE] Task Completed:", data.payload);
          }

          // [UI CONTROL] Handle navigation and UI action commands from Silhouette
          if (data.type === SystemProtocol.UI_REFRESH && data.payload?.uiCommand) {
            const cmd = data.payload.uiCommand;
            console.log("🎮 [SSE] UI Command received:", cmd);

            if (cmd.type === 'NAVIGATE') {
              // Navigate to tab
              setActiveTab(cmd.destination);
              if (cmd.message) {
                console.log(`📍 Navigation message: ${cmd.message}`);
              }
            } else if (cmd.type === 'ACTION') {
              // Handle UI actions
              if (cmd.action === 'open_panel') {
                if (cmd.panel === 'drive') setDriveOpen(true);
                else if (cmd.panel === 'email') setEmailOpen(true);
              } else if (cmd.action === 'close_panel') {
                if (cmd.panel === 'drive') setDriveOpen(false);
                else if (cmd.panel === 'email') setEmailOpen(false);
              } else if (cmd.action === 'highlight' && cmd.target) {
                // Highlight element with visual effect
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
        // console.error("SSE Parse Error", err);
      }
    };

    return () => {
      evtSource.close();
    };
  }, []);

  const handleModeChange = (mode: SystemMode) => {
    setMetrics(prev => ({ ...prev, currentMode: mode }));
    localStorage.setItem('silhouette_power_mode', mode);
    // Sync with server
    // Sync with server
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
          {visitedTabs.has('memory') && <ContinuumMemoryExplorer />}
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
  const paddingClass = density === 'compact' ? 'p-4' : 'p-8';

  return (
    <div className={`flex h-screen bg-slate-950 overflow-hidden relative ${mode} ${borderClass}`}>
      <ProtocolOverlay />

      {/* HEADLESS SENSORS - Wrapped in Suspense */}
      <Suspense fallback={null}>
        <VisualCortex />
      </Suspense>

      <Suspense fallback={null}>
        <ChatWidget
          currentUserRole={currentUserRole}
          onChangeRole={setCurrentUserRole}
          systemMetrics={metrics}
          onUpdateThoughts={setLiveThoughts}
          onAgentThought={handleAgentThought}
        />
      </Suspense>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} onDriveClick={() => setDriveOpen(true)} onEmailClick={() => setEmailOpen(true)} />
      <main className={`flex-1 ${paddingClass} overflow-y-auto relative`}>
        {/* Notification Center in top-right corner */}
        <div className="absolute top-4 right-4 z-40">
          <NotificationCenter />
        </div>
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-cyan-500 opacity-50"></div>
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-cyan-400">
            Loading module...
          </div>
        }>
          {renderContent()}
        </Suspense>
      </main>

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