import React from 'react';
import { LayoutDashboard, Users, Brain, Terminal, Activity, Settings as SettingsIcon, Database, LayoutTemplate, Wand2, Sliders, BrainCircuit, Cloud, Mail, Palette } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  onDriveClick?: () => void;
  onEmailClick?: () => void;
}

export const navigationItems = [
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
] as const;

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isMobileOpen, onCloseMobile, onDriveClick, onEmailClick }) => {
  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <div className={`fixed inset-y-0 left-0 transform ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out md:relative md:translate-x-0 w-[min(88vw,20rem)] md:w-72 h-[100dvh] md:h-full bg-slate-950/95 backdrop-blur-xl border-r border-cyan-900/30 flex flex-col shadow-2xl z-50`}>

      <div className="sticky top-0 z-10 border-b border-cyan-900/30 bg-slate-950/90 backdrop-blur-xl">
        <div className="p-5 flex items-center gap-3">
          <div className="w-9 h-9 bg-cyan-500 rounded-full flex items-center justify-center animate-pulse-fast shadow-[0_0_15px_rgba(6,182,212,0.5)] shrink-0">
            <Activity size={18} className="text-black" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-cyan-400 font-bold tracking-wider text-lg truncate">SILHOUETTE</h1>
            <p className="text-xs text-slate-500 tracking-[0.28em] truncate">AGENCY OS V4.0</p>
          </div>
          <button
            onClick={onCloseMobile}
            className="md:hidden rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close navigation"
          >
            ✕
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar py-4 px-3 space-y-2">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-4 px-4 py-3 rounded-xl text-left transition-all duration-200 group min-h-[52px] ${isActive
                ? 'bg-cyan-950/50 text-cyan-400 border border-cyan-900/50 shadow-[0_0_10px_rgba(6,182,212,0.1)]'
                : 'text-slate-400 hover:bg-slate-900 hover:text-cyan-200'
                }`}
            >
              <Icon size={20} className={`shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-500 group-hover:text-cyan-200'}`} />
              <span className="font-mono text-sm leading-tight min-w-0 flex-1">{item.label}</span>
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
            className="w-full flex items-center gap-4 px-4 py-2.5 rounded-xl text-slate-400 hover:bg-slate-900 hover:text-cyan-200 transition-all"
          >
            <Cloud size={18} className="text-slate-500 shrink-0" />
            <span className="font-mono text-xs leading-tight">Google Drive</span>
          </button>
        </div>
      )}

      {/* Email Button */}
      {onEmailClick && (
        <div className="px-3 pb-2">
          <button
            onClick={onEmailClick}
            className="w-full flex items-center gap-4 px-4 py-2.5 rounded-xl text-slate-400 hover:bg-slate-900 hover:text-cyan-200 transition-all"
          >
            <Mail size={18} className="text-slate-500 shrink-0" />
            <span className="font-mono text-xs leading-tight">Gmail</span>
          </button>
        </div>
      )}


      <div className="p-4 border-t border-cyan-900/30 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-900/50">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <div className="flex-1">
            <p className="text-xs text-slate-400">System Status</p>
            <p className="text-xs text-green-400 font-mono">OPTIMAL</p>
          </div>
          <span className="text-[10px] text-slate-600 font-mono">RTX 3050</span>
        </div>
      </div>

    </div>
    </>
  );
};

export default Sidebar;
