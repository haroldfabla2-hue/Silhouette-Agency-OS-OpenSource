import React from 'react';
import { LayoutDashboard, Users, Brain, Terminal, Activity, Settings as SettingsIcon, Database, LayoutTemplate, Wand2, Sliders, BrainCircuit, Cloud, Mail, Palette } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onDriveClick?: () => void;
  onEmailClick?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, onDriveClick, onEmailClick }) => {
  const menuItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Command Center' },
    { id: 'system_control', icon: Sliders, label: 'System Control' },
    { id: 'orchestrator', icon: Users, label: 'Agent Swarm (131)' },
    { id: 'introspection', icon: BrainCircuit, label: 'Introspection Hub' },
    { id: 'visual_cortex', icon: Palette, label: 'Visual Cortex' },
    { id: 'memory', icon: Database, label: 'Continuum Memory' },
    { id: 'dynamic_workspace', icon: LayoutTemplate, label: 'Workspace' },
    { id: 'media_studio', icon: Wand2, label: 'Media Cortex' },
    { id: 'settings', icon: SettingsIcon, label: 'Settings & Config' },
    { id: 'terminal', icon: Terminal, label: 'System Logs' },
  ];


  return (
    <div className="w-64 h-screen bg-slate-950 border-r border-cyan-900/30 flex flex-col shadow-2xl z-20">
      <div className="p-6 flex items-center gap-3 border-b border-cyan-900/30">
        <div className="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center animate-pulse-fast shadow-[0_0_15px_rgba(6,182,212,0.5)]">
          <Activity size={18} className="text-black" />
        </div>
        <div>
          <h1 className="text-cyan-400 font-bold tracking-wider text-lg">SILHOUETTE</h1>
          <p className="text-xs text-slate-500 tracking-widest">AGENCY OS V4.0</p>
        </div>
      </div>

      <nav className="flex-1 py-6 px-3 space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-200 group ${isActive
                ? 'bg-cyan-950/50 text-cyan-400 border border-cyan-900/50 shadow-[0_0_10px_rgba(6,182,212,0.1)]'
                : 'text-slate-400 hover:bg-slate-900 hover:text-cyan-200'
                }`}
            >
              <Icon size={20} className={isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-cyan-200'} />
              <span className="font-mono text-sm">{item.label}</span>
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_5px_rgba(34,211,238,1)]" />}
            </button>
          );
        })}
      </nav>

      {/* Drive Button */}
      {onDriveClick && (
        <div className="px-3 pb-1">
          <button
            onClick={onDriveClick}
            className="w-full flex items-center gap-4 px-4 py-2 rounded-lg text-slate-400 hover:bg-slate-900 hover:text-cyan-200 transition-all"
          >
            <Cloud size={18} className="text-slate-500" />
            <span className="font-mono text-xs">Google Drive</span>
          </button>
        </div>
      )}

      {/* Email Button */}
      {onEmailClick && (
        <div className="px-3 pb-2">
          <button
            onClick={onEmailClick}
            className="w-full flex items-center gap-4 px-4 py-2 rounded-lg text-slate-400 hover:bg-slate-900 hover:text-cyan-200 transition-all"
          >
            <Mail size={18} className="text-slate-500" />
            <span className="font-mono text-xs">Gmail</span>
          </button>
        </div>
      )}


      <div className="p-4 border-t border-cyan-900/30">
        <div className="flex items-center gap-3 px-3 py-2 rounded bg-slate-900/50">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <div className="flex-1">
            <p className="text-xs text-slate-400">System Status</p>
            <p className="text-xs text-green-400 font-mono">OPTIMAL</p>
          </div>
          <span className="text-[10px] text-slate-600 font-mono">RTX 3050</span>
        </div>
      </div>

    </div>
  );
};

export default Sidebar;
