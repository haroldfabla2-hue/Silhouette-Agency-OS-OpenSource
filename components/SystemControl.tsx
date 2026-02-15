import React, { useState, useEffect } from 'react';
import { SystemMode, SystemMetrics, AutonomousConfig, AgentCategory, GenesisProject, GenesisTemplate, NeuroLinkStatus, NeuroLinkNode, SystemProtocol, ServiceStatus, CostMetrics } from '../types';
import { ShieldCheck, Zap, RotateCcw, Terminal, Globe, Network, Rocket, GitBranch, CloudLightning, Activity } from 'lucide-react';
import InstallationWizard from './InstallationWizard';
import { GenesisCore } from './GenesisCore';
import { PowerSelector } from './PowerSelector';
import { CostSimulator } from './CostSimulator';
import { ContextBudgetPanel } from './ContextBudgetPanel'; // [PA-041]
import { api, API_BASE_URL } from '../utils/api';
// CostMetrics imported from types now

// NOTE: Backend services are accessed via API to prevent build errors.

interface SystemControlProps {
    metrics: SystemMetrics;
    setMode: (mode: SystemMode) => void;
    autonomyConfig: AutonomousConfig;
    setAutonomyConfig: (config: AutonomousConfig) => void;
}

const SystemControl: React.FC<SystemControlProps> = ({ metrics, setMode, autonomyConfig, setAutonomyConfig }) => {
    const currentMode = metrics.currentMode;
    const [activeCats, setActiveCats] = useState<AgentCategory[]>([]);
    const [coreServices, setCoreServices] = useState<ServiceStatus[]>([]);
    const [showIntegrationModal, setShowIntegrationModal] = useState(false);
    const [activeNodes, setActiveNodes] = useState<NeuroLinkNode[]>([]);
    const [costMetrics, setCostMetrics] = useState<CostMetrics>({ totalCost: 0, dailyCost: 0, projectedMonthly: 0, costPerToken: 0, tokenCount: 0, modelBreakdown: {} } as any);
    const [isConnected, setIsConnected] = useState(false);
    const [isOffline, setIsOffline] = useState(false);
    const [orchestratorState, setOrchestratorState] = useState<any>(null);

    // Plugin Generation State
    const [showPluginModal, setShowPluginModal] = useState(false);
    const [pluginAppName, setPluginAppName] = useState('');
    const [pluginContext, setPluginContext] = useState('');
    const [pluginCapabilities, setPluginCapabilities] = useState<string[]>(['CHAT']);
    const [generatedScript, setGeneratedScript] = useState('');
    const [isGeneratingPlugin, setIsGeneratingPlugin] = useState(false);

    // Autonomy State
    const [tempConfig, setTempConfig] = useState(autonomyConfig);

    // Genesis State
    const [genesisProjects, setGenesisProjects] = useState<GenesisProject[]>([]);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDescription, setNewProjectDescription] = useState('');
    const [newProjectTemplate, setNewProjectTemplate] = useState<GenesisTemplate>('REACT_VITE');
    const [showAdvancedGenesis, setShowAdvancedGenesis] = useState(false);
    const [gitUser, setGitUser] = useState('');
    const [gitToken, setGitToken] = useState('');
    const [repoUrl, setRepoUrl] = useState('');
    const [isSpawning, setIsSpawning] = useState(false);
    const [genesisLogs, setGenesisLogs] = useState<string[]>([]);

    // Division Control State
    const [preset, setPreset] = useState<string>('CUSTOM');
    const categories: AgentCategory[] = ['DEV', 'MARKETING', 'DATA', 'CYBERSEC', 'LEGAL', 'FINANCE', 'SCIENCE', 'OPS', 'HEALTH', 'RETAIL', 'MFG', 'ENERGY', 'EDU'];

    useEffect(() => {
        const interval = setInterval(() => {
            // Poll for updates
            fetchGenesisProjects();
            fetchOrchestratorState();
            fetchNeuroLinkNodes();
            fetchCostMetrics();
        }, 5000);

        // Heartbeat Check
        const checkConnection = async () => {
            try {
                const res = await api.get<{ status: string, services: ServiceStatus[] }>('/v1/system/status');
                setIsConnected(true);
                if (res.services) setCoreServices(res.services);
            } catch (e) {
                setIsConnected(false);
            }
        };
        const heartbeat = setInterval(checkConnection, 5000);

        // SSE Connection for Real-time Logs
        const eventSource = new EventSource(`${API_BASE_URL}/v1/factory/stream`);
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'LOG') {
                    setGenesisLogs(prev => [...prev, data.message]);
                }
            } catch (e) { }
        };

        return () => {
            clearInterval(interval);
            clearInterval(heartbeat);
            eventSource.close();
        };
    }, []);

    const fetchOrchestratorState = async () => {
        try {
            const data = await api.get<any>('/v1/orchestrator/state');
            setOrchestratorState(data);
            setActiveCats(data.activeCategories || []);
        } catch (e) { }
    };

    const fetchNeuroLinkNodes = async () => {
        try {
            const data = await api.get<NeuroLinkNode[]>('/v1/neurolink/nodes');
            setActiveNodes(data || []);
        } catch (e) { }
    };

    const fetchCostMetrics = async () => {
        try {
            const data = await api.get<CostMetrics>('/v1/system/costs');
            setCostMetrics(data);
        } catch (e) { }
    };

    const applyConfig = () => {
        setAutonomyConfig(tempConfig);
        // Sync config to server
        api.post('/v1/system/config', { autonomy: tempConfig }).catch(console.error);
    };

    const fetchGenesisProjects = async () => {
        try {
            const projects = await api.get<GenesisProject[]>('/v1/factory/list');
            setGenesisProjects(projects);
        } catch (e) { }
    };

    const spawnProject = async () => {
        if (!newProjectName) return;
        setIsSpawning(true);

        try {
            // Call Backend to Spawn
            await api.post('/v1/factory/spawn', {
                name: newProjectName,
                description: newProjectDescription,
                template: newProjectTemplate,
                gitUser,
                gitToken,
                repoUrl
            });

            setGenesisLogs(prev => [...prev, `[SUCCESS] Project ${newProjectName} spawned.`]);
        } catch (e) {
            console.error(e);
            setGenesisLogs(prev => [...prev, `[ERROR] Spawn failed.`]);
        } finally {
            setIsSpawning(false);
        }
    };

    const filteredNodes = activeNodes.filter(node => activeCats.length === 0 || !node.category || activeCats.includes(node.category));
    const handleModeChange = (mode: SystemMode) => {
        // HARDWARE SAFETY CHECK
        if (mode === SystemMode.ULTRA) {
            const vramTotal = metrics.gpu?.vramTotal || 0;
            if (vramTotal < 6000) {
                console.warn("Hardware Warning: GPU VRAM insufficient for ULTRA mode stability.");
                alert("⚠️ HARDWARE LIMIT: Your RTX 3050 (4GB) cannot sustain ULTRA mode. Switching to HIGH for stability.");
                setMode(SystemMode.HIGH);
                return;
            }
        }
        setMode(mode);
    };

    const applyPreset = (presetName: string) => {
        setPreset(presetName);
        let targetCats: AgentCategory[] = [];
        let targetMode = SystemMode.BALANCED;

        switch (presetName) {
            case 'DEV_MODE':
                targetCats = ['DEV', 'OPS', 'CYBERSEC'];
                targetMode = SystemMode.HIGH;
                break;
            case 'CREATIVE_MODE':
                targetCats = ['MARKETING', 'RETAIL', 'SCIENCE'];
                targetMode = SystemMode.HIGH;
                break;
            case 'FULL_POWER':
                targetCats = categories; // All
                targetMode = SystemMode.ULTRA;
                break;
            case 'ECO_SAVER':
                targetCats = ['CORE'];
                targetMode = SystemMode.ECO;
                break;
        }

        handleModeChange(targetMode);

        categories.forEach(cat => {
            const shouldBeActive = targetCats.includes(cat);
            const isCurrentlyActive = activeCats.includes(cat);
            if (shouldBeActive !== isCurrentlyActive) {
                toggleDivision(cat);
            }
        });
    };

    const toggleDivision = async (cat: AgentCategory) => {
        if (cat === 'CORE') return;
        const isEnabled = activeCats.includes(cat);
        const newState = !isEnabled;

        // Optimistic Update
        const newCats = newState ? [...activeCats, cat] : activeCats.filter(c => c !== cat);
        setActiveCats(newCats);
        setPreset('CUSTOM');

        try {
            await api.post('/v1/orchestrator/category', { category: cat, enabled: newState });
            setIsOffline(false);
        } catch (e) {
            console.warn("Server Offline. Request Queued.");
            setIsOffline(true);
        }
    };

    const generatePlugin = async () => {
        setIsGeneratingPlugin(true);
        try {
            const result = await api.post<{ script: string }>('/v1/plugins/generate', { name: pluginAppName, context: pluginContext, capabilities: pluginCapabilities });
            setGeneratedScript(result.script);
        } catch (e) {
            alert('Plugin Generation Failed');
        } finally {
            setIsGeneratingPlugin(false);
        }
    };

    const toggleCapability = (cap: string) => {
        if (pluginCapabilities.includes(cap)) {
            setPluginCapabilities(pluginCapabilities.filter(c => c !== cap));
        } else {
            setPluginCapabilities([...pluginCapabilities, cap]);
        }
    };

    return (
        <div className="h-[calc(100vh-2rem)] flex gap-6 overflow-hidden relative">
            {showIntegrationModal && (
                <InstallationWizard onComplete={() => setShowIntegrationModal(false)} onClose={() => setShowIntegrationModal(false)} />
            )}

            {showPluginModal && (
                <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-cyan-500/50 rounded-xl p-6 w-full max-w-2xl shadow-2xl relative">
                        <button
                            onClick={() => setShowPluginModal(false)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-white"
                        >
                            ✕
                        </button>
                        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                            <Network className="text-cyan-400" /> Generate Silhouette Plugin
                        </h2>

                        {!generatedScript ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs text-slate-400 block mb-1">Target Application Name</label>
                                    <input
                                        type="text"
                                        value={pluginAppName}
                                        onChange={(e) => setPluginAppName(e.target.value)}
                                        className="w-full bg-black border border-slate-700 rounded p-2 text-sm text-white"
                                        placeholder="e.g. Legacy CRM Portal"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 block mb-1">Application Context & Purpose</label>
                                    <textarea
                                        value={pluginContext}
                                        onChange={(e) => setPluginContext(e.target.value)}
                                        className="w-full bg-black border border-slate-700 rounded p-2 text-sm text-white h-24"
                                        placeholder="Describe what this app does and how Silhouette should interact with it..."
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 block mb-2">Capabilities</label>
                                    <div className="flex gap-3">
                                        {['CHAT', 'READ', 'WRITE', 'ADMIN'].map(cap => (
                                            <button
                                                key={cap}
                                                onClick={() => toggleCapability(cap)}
                                                className={`px-3 py-1 rounded text-xs border ${pluginCapabilities.includes(cap) ? 'bg-cyan-900/50 border-cyan-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-500'}`}
                                            >
                                                {cap}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <button
                                    onClick={generatePlugin}
                                    disabled={isGeneratingPlugin || !pluginAppName}
                                    className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold flex items-center justify-center gap-2"
                                >
                                    {isGeneratingPlugin ? 'ARCHITECTING PLUGIN...' : 'GENERATE SDK'}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="bg-black border border-slate-800 rounded p-4 h-64 overflow-y-auto custom-scrollbar font-mono text-xs text-green-400">
                                    <pre>{generatedScript}</pre>
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => { navigator.clipboard.writeText(generatedScript); alert('Copied!'); }}
                                        className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold"
                                    >
                                        COPY CODE
                                    </button>
                                    <button
                                        onClick={() => { setGeneratedScript(''); setShowPluginModal(false); }}
                                        className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold"
                                    >
                                        DONE
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Left Column */}
            <div className="flex-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">

                {/* Real-time Telemetry (System Resources) */}
                <div className="glass-panel rounded-xl p-6 border border-cyan-500/30 bg-cyan-900/10">
                    <h2 className="text-xl font-bold text-white flex items-center gap-3 mb-4">
                        <Activity className="text-cyan-400" /> System Resources
                    </h2>
                    <div className="grid grid-cols-3 gap-4">
                        {/* CPU */}
                        <div className="bg-black/40 p-3 rounded border border-slate-800">
                            <div className="text-xs text-slate-400 mb-1">CPU Load</div>
                            <div className="text-2xl font-mono text-white">
                                {metrics.cpuTickDuration?.toFixed(1)}%
                            </div>
                            <div className="w-full h-1 bg-slate-800 mt-2 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-cyan-500 transition-all duration-500"
                                    style={{ width: `${Math.min(metrics.cpuTickDuration || 0, 100)}%` }}
                                />
                            </div>
                        </div>

                        {/* RAM */}
                        <div className="bg-black/40 p-3 rounded border border-slate-800">
                            <div className="text-xs text-slate-400 mb-1">RAM Usage</div>
                            <div className="text-2xl font-mono text-white">
                                {((metrics.jsHeapSize || 0) / 1024).toFixed(1)} GB
                            </div>
                            <div className="w-full h-1 bg-slate-800 mt-2 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-purple-500 transition-all duration-500"
                                    style={{ width: `${Math.min((metrics.jsHeapSize || 0) / 16 * 100, 100)}%` }} // Assuming 16GB total roughly
                                />
                            </div>
                        </div>

                        {/* GPU */}
                        <div className="bg-black/40 p-3 rounded border border-slate-800">
                            <div className="text-xs text-slate-400 mb-1">GPU VRAM</div>
                            <div className="text-2xl font-mono text-white">
                                {metrics.vramUsage?.toFixed(1)}%
                            </div>
                            <div className="w-full h-1 bg-slate-800 mt-2 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-green-500 transition-all duration-500"
                                    style={{ width: `${Math.min(metrics.vramUsage || 0, 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Real-time Service Health (New) */}
                <div className="glass-panel rounded-xl p-6 border border-cyan-500/30 bg-cyan-900/10">
                    <h2 className="text-xl font-bold text-white flex items-center gap-3 mb-4">
                        <Network className="text-cyan-400" /> Service Health
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {coreServices.map(service => (
                            <div key={service.id} className="p-3 bg-black/40 rounded border border-slate-800 flex items-center justify-between">
                                <div>
                                    <div className="text-xs font-bold text-white">{service.name}</div>
                                    <div className="text-[10px] text-slate-500">{service.url || `Port: ${service.port}`}</div>
                                </div>
                                <div className={`px-2 py-0.5 rounded text-[9px] font-bold border ${service.status === 'ONLINE' ? 'bg-green-900/30 text-green-400 border-green-500/30' :
                                    service.status === 'DEGRADED' ? 'bg-yellow-900/30 text-yellow-400 border-yellow-500/30' :
                                        'bg-red-900/30 text-red-400 border-red-500/30'
                                    }`}>
                                    {service.status}
                                </div>
                            </div>
                        ))}
                        {coreServices.length === 0 && <p className="text-xs text-slate-500 italic col-span-4">Initializing monitoring...</p>}
                    </div>
                </div>

                {/* Power Levels (Bio-Safe Protocol) */}
                <PowerSelector currentMode={currentMode} setMode={handleModeChange} />

                {/* GENESIS FACTORY V2 (GIT-OPS) */}
                <div className="glass-panel rounded-xl p-6 border border-orange-500/30 bg-orange-900/10">
                    <h2 className="text-xl font-bold text-white flex items-center gap-3 mb-4">
                        <Rocket className="text-orange-400" /> Genesis Factory V2 (Git-Ops)
                    </h2>
                    <div className="grid grid-cols-1 gap-6">
                        <div className="flex flex-col gap-4">
                            <h3 className="text-sm font-bold text-slate-300">Deployment Pipeline</h3>
                            <div className="space-y-3 bg-black/30 p-3 rounded border border-slate-800">
                                <input
                                    type="text"
                                    placeholder="App Name (e.g. MegaCRM)"
                                    value={newProjectName}
                                    onChange={(e) => setNewProjectName(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white"
                                />
                                <select
                                    value={newProjectTemplate}
                                    onChange={(e) => setNewProjectTemplate(e.target.value as GenesisTemplate)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white"
                                >
                                    <option value="REACT_VITE">React + Vite (Standard)</option>
                                    <option value="NEXT_JS">Next.js (Full Stack)</option>
                                    <option value="FULL_STACK_CRM">Full Stack CRM (Preset)</option>
                                    <option value="AI_AUTO_DETECT">✨ AI Auto-Detect (Smart)</option>
                                </select>

                                <textarea
                                    placeholder="Project Description / Instructions (e.g. 'A dark-themed dashboard for crypto analytics')"
                                    value={newProjectDescription}
                                    onChange={(e) => setNewProjectDescription(e.target.value)}
                                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white h-16 resize-none"
                                />

                                <div className="flex gap-2">
                                    <div className="flex-1 bg-slate-900 p-2 rounded border border-slate-800 flex items-center gap-2 opacity-70">
                                        <GitBranch size={12} className="text-white" /> <span className="text-[9px] text-slate-400">git push origin master</span>
                                    </div>
                                    <button
                                        onClick={() => setShowAdvancedGenesis(!showAdvancedGenesis)}
                                        className="px-2 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-[10px] text-cyan-400"
                                    >
                                        {showAdvancedGenesis ? 'Hide Config' : 'Adv. Config'}
                                    </button>
                                </div>

                                {showAdvancedGenesis && (
                                    <div className="p-2 bg-slate-900/50 border border-slate-800 rounded space-y-2 animate-in fade-in slide-in-from-top-2">
                                        <input
                                            type="text"
                                            placeholder="Git User (Optional)"
                                            value={gitUser}
                                            onChange={(e) => setGitUser(e.target.value)}
                                            className="w-full bg-black border border-slate-800 rounded p-1 text-[10px] text-white"
                                        />
                                        <input
                                            type="password"
                                            placeholder="Git Token (Optional)"
                                            value={gitToken}
                                            onChange={(e) => setGitToken(e.target.value)}
                                            className="w-full bg-black border border-slate-800 rounded p-1 text-[10px] text-white"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Remote Repo URL (Optional)"
                                            value={repoUrl}
                                            onChange={(e) => setRepoUrl(e.target.value)}
                                            className="w-full bg-black border border-slate-800 rounded p-1 text-[10px] text-white"
                                        />
                                    </div>
                                )}

                                <button
                                    onClick={spawnProject}
                                    disabled={isSpawning}
                                    className="w-full py-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-xs font-bold flex items-center justify-center gap-2"
                                >
                                    {isSpawning ? 'PROVISIONING INFRA...' : <><Rocket size={12} /> INITIALIZE & DEPLOY</>}
                                </button>
                            </div>
                        </div>

                        {/* Genesis Core (Topology + Terminal) */}
                        <div className="h-96 w-full border border-slate-800 rounded-lg overflow-hidden">
                            <GenesisCore nodes={filteredNodes} logs={genesisLogs} activeCategories={activeCats} />
                        </div>
                    </div>
                </div>

                {/* Integration Bridge */}
                <div className="glass-panel rounded-xl p-6 border border-cyan-500/30 bg-cyan-900/10">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h2 className="text-xl font-bold text-white flex items-center gap-3">
                                <Globe className="text-cyan-400" /> Universal API Bridge
                            </h2>
                            <p className="text-xs text-slate-400 mt-1">Connect existing apps via Neuro-Link.</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowPluginModal(true)}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold flex items-center gap-2 border border-slate-600"
                            >
                                <Network size={14} /> GENERATE PLUGIN
                            </button>
                            <button
                                onClick={() => setShowIntegrationModal(true)}
                                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-bold flex items-center gap-2 shadow-lg"
                            >
                                <Network size={14} /> DEPLOY NEURO-LINK SQUAD
                            </button>
                        </div>
                    </div>
                    {/* Active Integrations List */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                        {activeNodes.filter(n => n.projectId !== 'genesis-core').map(node => (
                            <div key={node.id} className="p-3 bg-slate-900/50 border border-cyan-900/30 rounded flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${node.status === NeuroLinkStatus.CONNECTED ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                                    <div>
                                        <div className="text-xs font-bold text-white">{node.projectId}</div>
                                        <div className="text-[10px] text-slate-500">{node.url}</div>
                                    </div>
                                </div>
                                <div className="text-[10px] font-mono text-cyan-400">
                                    {(node.latency || 0).toFixed(0)}ms
                                </div>
                            </div>
                        ))}
                        {activeNodes.filter(n => n.projectId !== 'genesis-core').length === 0 && <p className="text-xs text-slate-500 italic col-span-2 text-center py-2">No active bridges found.</p>}
                    </div>
                </div>

                {/* Cognitive Economics */}
                <CostSimulator metrics={costMetrics} />

                {/* [PA-041] Context Priority Control */}
                <ContextBudgetPanel />

                {/* Division Control */}
                <div className="glass-panel rounded-xl p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-white flex items-center gap-3">
                            <ShieldCheck className="text-green-400" /> Division Control
                            {isConnected ? (
                                <span className="text-[10px] bg-green-900/50 text-green-400 px-2 py-0.5 rounded border border-green-500/30">ONLINE (SERVER)</span>
                            ) : (
                                <span className="text-[10px] bg-red-900/50 text-red-400 px-2 py-0.5 rounded border border-red-500/30 animate-pulse">OFFLINE MODE (LOCAL)</span>
                            )}
                        </h2>
                        <select
                            value={preset}
                            onChange={(e) => applyPreset(e.target.value)}
                            className="bg-slate-900 border border-slate-700 text-xs text-white rounded px-2 py-1"
                        >
                            <option value="CUSTOM">Custom</option>
                            <option value="DEV_MODE">Dev Mode (Dev+Ops)</option>
                            <option value="CREATIVE_MODE">Creative Mode (Mkt+Sci)</option>
                            <option value="FULL_POWER">Full Power (All)</option>
                            <option value="ECO_SAVER">Eco Saver (Core Only)</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        <div className="p-3 bg-slate-900/80 border border-cyan-900/30 rounded flex flex-col justify-between opacity-70 cursor-not-allowed">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold text-cyan-400">CORE</span>
                                <div className="w-2 h-2 bg-cyan-500 rounded-full" />
                            </div>
                            <span className="text-[10px] text-slate-400">6 Squads</span>
                        </div>
                        {categories.map(cat => {
                            const isEnabled = activeCats.includes(cat);
                            // Fetch squad count from state or default to 0
                            const count = (orchestratorState as any)?.squadCounts?.[cat] || 0;
                            return (
                                <button
                                    key={cat}
                                    onClick={() => toggleDivision(cat)}
                                    className={`p-3 rounded border flex flex-col justify-between transition-all hover:scale-105 active:scale-95 ${isEnabled ? 'bg-slate-900 border-green-500/50 shadow-[0_0_10px_rgba(34,197,94,0.1)]' : 'bg-slate-950 border-slate-800 hover:border-slate-700 opacity-60 hover:opacity-100'}`}
                                >
                                    <div className="flex items-center justify-between w-full mb-2">
                                        <span className={`text-xs font-bold ${isEnabled ? 'text-white' : 'text-slate-500'}`}>{cat}</span>
                                        <div className={`w-2 h-2 rounded-full transition-all ${isEnabled ? 'bg-green-400' : 'bg-slate-600'}`} />
                                    </div>
                                    <span className="text-[10px] text-slate-500 w-full text-left">{count} Squads</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Right Column: Autonomy */}
            <div className="w-80 glass-panel rounded-xl flex flex-col border-l border-cyan-900/30 flex-shrink-0">
                <div className="p-6 border-b border-cyan-900/30 bg-slate-900/50">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <RotateCcw className="text-purple-400" size={18} /> Autonomous Ops
                    </h3>
                </div>
                <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
                    <div className="space-y-3">
                        <label className="flex items-center gap-2 text-sm text-slate-300">
                            <input
                                type="checkbox"
                                checked={tempConfig.mode24_7}
                                onChange={(e) => setTempConfig({ ...tempConfig, mode24_7: e.target.checked })}
                                className="rounded bg-slate-800 border-slate-600 text-cyan-500"
                            />
                            <span className="flex items-center gap-2">Continuous Context Loop</span>
                        </label>
                    </div>
                    <button
                        onClick={applyConfig}
                        className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-bold transition-colors flex items-center justify-center gap-2"
                    >
                        APPLY CONFIGURATION
                    </button>
                </div>
            </div>
        </div >
    );
};

export default SystemControl;
