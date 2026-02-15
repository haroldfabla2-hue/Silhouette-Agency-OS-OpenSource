import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Activity, Cpu, Database, HardDrive, Layout, Server, Zap, Brain, MessageSquare, Terminal, Plus, Send, Globe, ShieldAlert } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Project, SystemMetrics } from '../types';
import { api } from '../utils/api';
import HealthMonitor from './HealthMonitor';
import { DreamExplorer } from './DreamExplorer';
import ConfirmationModal from './ConfirmationModal';

interface DashboardProps {
  metrics: SystemMetrics;
  projects: Project[];
  onCreateProject: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ metrics, projects, onCreateProject }) => {
  const [brief, setBrief] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showConfirmations, setShowConfirmations] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // Fetch pending confirmation count
  useEffect(() => {
    const fetchPendingCount = async () => {
      try {
        const res = await api.get('/v1/autonomy/confirmations') as any;
        if (res.success) {
          setPendingCount(res.confirmations?.length || 0);
        }
      } catch (e) {
        // Silently ignore if endpoint not available
      }
    };
    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 5000);
    return () => clearInterval(interval);
  }, []);

  // [ROBUSTNESS] Zero-Dimension Fix for Recharts
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const { offsetWidth, offsetHeight } = containerRef.current;
        // Only update if changed to avoid renders
        setDimensions(prev => {
          if (Math.abs(prev.width - offsetWidth) < 2 && Math.abs(prev.height - offsetHeight) < 2) return prev;
          return { width: offsetWidth, height: offsetHeight };
        });
      }
    };

    // Initial measure
    updateDimensions();

    // Observer
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  // Use real CPU tick history for chart in a real implementation
  // Memoize data to prevent unnecessary re-calculations during render phase
  const data = useMemo(() => [
    { name: '0s', cpu: (metrics.realCpu || 0), mem: metrics.jsHeapSize * 0.9 },
    { name: '-1s', cpu: (metrics.realCpu || 0) * 0.9, mem: metrics.jsHeapSize },
    { name: '-2s', cpu: (metrics.realCpu || 0) * 1.1, mem: metrics.jsHeapSize * 0.95 },
    { name: '-3s', cpu: (metrics.realCpu || 0) * 0.8, mem: metrics.jsHeapSize * 0.92 },
    { name: '-4s', cpu: (metrics.realCpu || 0) * 1.0, mem: metrics.jsHeapSize * 0.98 },
  ], [metrics.realCpu, metrics.jsHeapSize]);

  const handleSendBrief = async () => {
    if (!brief.trim()) return;
    setIsSending(true);
    try {
      // Send to Orchestrator Inbox (General)
      const res = await api.post('/v1/inbox/Orchestrator', { message: brief, priority: 'HIGH' });
      if (res) {
        setBrief('');
      }
    } catch (e) {
      console.error("Failed to send brief", e);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto animate-in fade-in duration-500">

      {/* CONFIRMATION MODAL */}
      <ConfirmationModal isOpen={showConfirmations} onClose={() => setShowConfirmations(false)} />

      {/* HEADER SECTION */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-light tracking-tight text-white mb-2">
            Agency <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 font-normal">Command</span>
          </h1>
          <p className="text-white/40 font-mono text-sm">Orchestrating {metrics.activeAgents} autonomous units</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => setShowConfirmations(true)}
            className={`glass-button px-4 py-2 flex items-center gap-2 border-amber-500/30 hover:bg-amber-500/10 transition-colors rounded-lg relative ${pendingCount > 0 ? 'text-amber-400 animate-pulse' : 'text-amber-300/50'}`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Confirmations</span>
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {pendingCount}
              </span>
            )}
          </button>
          <button className="glass-button px-4 py-2 flex items-center gap-2 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/10 transition-colors rounded-lg">
            <Terminal className="w-4 h-4" />
            <span>System Logs</span>
          </button>
          <button onClick={onCreateProject} className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-6 py-2 rounded-lg font-medium shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all transform hover:scale-105 flex items-center gap-2">
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
      </div>

      {/* METRICS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={Cpu}
          label="Neural Load"
          value={`${(metrics.realCpu || 0).toFixed(1)}%`}
          subValue="Optimal"
          color="text-cyan-400"
          trend={12}
        />
        <MetricCard
          icon={Zap}
          label="Token Velocity"
          value={(metrics.tokenUsageToday || 0).toLocaleString()}
          subValue="$0.042/hr"
          color="text-amber-400"
          trend={-5}
        />
        <MetricCard
          icon={Activity}
          label="System Coherence"
          value={`${(metrics.awarenessScore || 85)}%`}
          subValue="Stable"
          color="text-emerald-400"
          trend={2}
        />
        <MetricCard
          icon={HardDrive}
          label="Memory Usage"
          value={`${Math.round(metrics.jsHeapSize)} MB`}
          subValue="VRAM: 12GB"
          color="text-purple-400"
        />
      </div>

      {/* MISSION CONTROL & TELEMETRY ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT: MISSION CONTROL (BRIEF SENDER) */}
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl border border-white/10 flex flex-col gap-4 relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-30 group-hover:opacity-100 transition-opacity" />
          <h3 className="text-lg font-medium text-white/80 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-indigo-400" />
            Mission Control
          </h3>
          <div className="flex-1 bg-black/20 rounded-xl p-4 border border-white/5 flex flex-col gap-3">
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Broadcast a mission brief to the Agency Swarm... (e.g., 'Research active competitors for Client X')"
              className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-white/20 resize-none h-24 font-mono text-sm outline-none"
            />
            <div className="flex justify-between items-center">
              <div className="flex gap-2">
                {['Research', 'Code', 'Design', 'Marketing'].map(tag => (
                  <span key={tag} className="px-2 py-1 rounded bg-white/5 text-[10px] text-white/40 border border-white/5 cursor-pointer hover:bg-white/10 hover:text-white/70 transition-colors">
                    #{tag}
                  </span>
                ))}
              </div>
              <button
                onClick={handleSendBrief}
                disabled={isSending || !brief.trim()}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 font-medium text-sm transition-all shadow-lg ${brief.trim()
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
                  : 'bg-white/5 text-white/20 cursor-not-allowed'
                  }`}
              >
                <Send className="w-4 h-4" />
                {isSending ? 'Transmitting...' : 'Dispatch Brief'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: REAL-TIME CHART */}
        <div className="glass-panel p-6 rounded-2xl border border-white/10 flex flex-col">
          <h3 className="text-lg font-medium text-white/80 mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-cyan-400" />
            Resource Telemetry
          </h3>
          <div className="flex-1 min-h-[150px]" ref={containerRef}>
            {dimensions.width > 0 && dimensions.height > 0 && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(value: any) => [`${value}%`, 'Usage']}
                  />
                  <Area
                    type="monotone"
                    dataKey="cpu"
                    stroke="#06b6d4"
                    fillOpacity={1}
                    fill="url(#colorCpu)"
                    isAnimationActive={false}
                  />
                  {/* Reduced animation for performance */}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* HEALTH & QUEUE MONITOR */}
      <HealthMonitor providerHealth={metrics.providerHealth} mediaQueue={metrics.mediaQueue} />

      {/* ACTIVE PROJECTS ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-light text-white/80 flex items-center gap-2">
            <Globe className="w-5 h-5 text-emerald-400" />
            Active Operations (VFS)
          </h2>

          {projects.length === 0 ? (
            <div className="glass-panel p-8 rounded-xl border border-dashed border-white/10 flex flex-col items-center justify-center text-white/30 gap-3">
              <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center">
                <Layout className="w-6 h-6" />
              </div>
              <span>No active operations in Virtual File System</span>
              <button onClick={onCreateProject} className="text-cyan-400 hover:text-cyan-300 text-sm font-medium">Initialize First Project</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map((project) => (
                <div key={project.id} className="glass-panel p-5 rounded-xl border border-white/10 hover:border-white/20 transition-all cursor-pointer group relative overflow-hidden bg-white/[0.02]">
                  {/* Dynamic Glow based on status */}
                  <div className={`absolute top-0 right-0 w-24 h-24 blur-[80px] rounded-full opacity-0 group-hover:opacity-30 transition-opacity ${project.status === 'active' ? 'bg-emerald-500' : 'bg-blue-500'
                    }`} />

                  <div className="flex justify-between items-start mb-3 relative z-10">
                    <div className="p-2 rounded-lg bg-white/5 border border-white/5">
                      <Layout className="w-5 h-5 text-white/70" />
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase ${project.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'
                      }`}>
                      {project.status}
                    </span>
                  </div>

                  <h3 className="text-lg font-medium text-white mb-0.5 group-hover:text-cyan-300 transition-colors relative z-10">{project.name}</h3>
                  <p className="text-xs text-white/40 mb-4 line-clamp-1 relative z-10">{project.client || 'Internal Operation'}</p>

                  <div className="w-full bg-white/5 rounded-full h-1 mb-2 relative z-10">
                    <div
                      className="bg-gradient-to-r from-cyan-500 to-blue-500 h-1 rounded-full"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-white/30 relative z-10 font-mono">
                    <span>PROGRESS</span>
                    <span>{project.progress}%</span>
                  </div>
                </div>
              ))}
              {/* New Project Slot */}
              <div
                onClick={onCreateProject}
                className="border border-dashed border-white/10 rounded-xl p-6 flex flex-col items-center justify-center gap-3 text-white/20 hover:text-white/40 hover:border-white/20 hover:bg-white/5 transition-all cursor-pointer min-h-[160px]"
              >
                <Plus className="w-6 h-6" />
                <span className="text-xs font-medium uppercase tracking-widest">New Operation</span>
              </div>
            </div>
          )}
        </div>

        {/* DREAM EXPLORER WIDGET */}
        <div className="glass-panel p-0 rounded-2xl border border-white/10 overflow-hidden flex flex-col">
          <div className="p-4 border-b border-white/5 bg-white/5">
            <h3 className="text-sm font-medium text-white/80 flex items-center gap-2">
              <BrainCircuitIcon className="w-4 h-4 text-purple-400" />
              Subconscious Feed
            </h3>
          </div>
          <div className="flex-1 p-4 bg-black/20">
            <DreamExplorer />
          </div>
        </div>
      </div >
    </div >
  );
};

// Simple Metric Card Component
const MetricCard = ({ icon: Icon, label, value, subValue, color, trend }: any) => (
  <div className="glass-panel p-5 rounded-xl border border-white/10 flex items-center justify-between group hover:border-white/20 hover:bg-white/[0.03] transition-all">
    <div>
      <p className="text-white/40 text-xs font-mono uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <h4 className="text-2xl font-light text-white">{value}</h4>
        {trend && (
          <span className={`text-xs ${trend > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      {subValue && <p className={`text-xs mt-1 opacity-60 ${color}`}>{subValue}</p>}
    </div>
    <div className={`p-3 rounded-lg bg-white/5 border border-white/5 group-hover:scale-110 transition-transform ${color}`}>
      <Icon className="w-6 h-6" />
    </div>
  </div>
);

// Helper for icon
const BrainCircuitIcon = (props: any) => <Activity {...props} />; // Fallback if Lucide missing

export default Dashboard;
