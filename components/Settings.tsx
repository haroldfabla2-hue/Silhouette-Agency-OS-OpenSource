
import React, { useState, useEffect } from 'react';
import { SettingsState, IntegrationSchema, UserRole } from '../types';
import { settingsManager } from '../services/settingsManager';
import { api } from '../utils/api';
import { Save, Shield, Globe, Bell, Palette, Database, Key, Check, AlertTriangle, Eye, EyeOff, Plug, Server, Trash2, Sliders, RotateCcw, Cloud, Download, Terminal } from 'lucide-react';

const Settings: React.FC = () => {
    // Force a deep copy state initialization to avoid reference issues
    const [settings, setSettings] = useState<SettingsState>(settingsManager.getSettings());
    const [activeTab, setActiveTab] = useState<'GENERAL' | 'INTEGRATIONS' | 'PERMISSIONS' | 'SYSTEM'>('GENERAL');
    const [unsavedChanges, setUnsavedChanges] = useState(false);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [discoverMessage, setDiscoverMessage] = useState<string | null>(null);

    // Integration Editing State
    const [editingIntegration, setEditingIntegration] = useState<string | null>(null);
    const [tempCredentials, setTempCredentials] = useState<Record<string, string>>({});

    const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

    // Dreamer Mode State
    const [dreamerMode, setDreamerMode] = useState<'DEV' | 'PROD'>('DEV');

    useEffect(() => {
        // Fetch initial config
        api.get('/v1/factory/config').then(res => {
            const data = res as any; // Cast generic response
            if (data.dreamerConfig) {
                setDreamerMode(data.dreamerConfig.mode);
            }
        }).catch(err => console.error("Failed to load config", err));
    }, []);

    const handleDreamerModeChange = (mode: 'DEV' | 'PROD') => {
        setDreamerMode(mode);
        const threshold = mode === 'DEV' ? 10 : 50;
        api.post('/v1/system/config', {
            dreamerConfig: { mode, threshold }
        }).then(() => alert(`Dreamer Mode set to ${mode} (Threshold: ${threshold})`));
    };

    const refreshSettings = () => {
        setSettings({ ...settingsManager.getSettings() });
    };

    const handleSave = () => {
        setUnsavedChanges(false);
        // Force persist
        alert("Configuration persisted to Continuum Memory.");
    };

    const handleDensityChange = (density: 'comfortable' | 'compact') => {
        settingsManager.updateTheme({ density });
        refreshSettings(); // Immediate UI update
    };

    const toggleNotification = async (key: keyof SettingsState['notifications']) => {
        const current = settings.notifications[key];
        // Call manager to handle side effects (e.g. browser permission)
        await settingsManager.updateNotifications({ [key]: !current });
        refreshSettings(); // Re-fetch logic-processed state
    };

    const handleIntegrationSave = (schemaId: string) => {
        settingsManager.saveCredential(schemaId, tempCredentials);
        setEditingIntegration(null);
        setTempCredentials({});
        refreshSettings();
    };

    const handleDiscoverExtensions = () => {
        setIsDiscovering(true);
        setDiscoverMessage("Querying Registry...");

        // Real logic: Ask manager for next available
        const newExtension = settingsManager.discoverNextExtension();

        if (newExtension) {
            settingsManager.registerIntegrationSchema(newExtension);
            setTimeout(() => {
                refreshSettings();
                setIsDiscovering(false);
                setDiscoverMessage(null);
            }, 800); // Small aesthetic delay
        } else {
            setTimeout(() => {
                setDiscoverMessage("No new modules found.");
                setIsDiscovering(false);
                setTimeout(() => setDiscoverMessage(null), 2000);
            }, 800);
        }
    };

    const togglePermission = (role: string, key: string) => {
        const current = (settings.permissions as any)[role][key];
        settingsManager.updatePermissions(role, { [key]: !current });
        refreshSettings();
    };

    const [apiKeys, setApiKeys] = useState({
        gemini: '',
        openai: '',
        elevenlabs: '',
        replicate: '',
        imagineArt: '',
        veoModelId: '',
        nanoBananaModelId: '',
        unsplash: '',
        providers: {
            image: 'OPENAI',
            voice: 'ELEVENLABS',
            video: 'REPLICATE'
        }
    });

    const handleSaveApiKey = (serviceId: string) => {
        if (serviceId === 'gemini') {
            settingsManager.saveCredential('gemini', { apiKey: apiKeys.gemini });
            alert("Gemini Key Saved & Synced");
        } else if (serviceId === 'unsplash') {
            api.post('/v1/system/config', { unsplashKey: apiKeys.unsplash })
                .then(() => alert("Unsplash Key Saved & Persisted"));
        } else if (serviceId === 'media') {
            // Sync Media Keys to Backend
            api.post('/v1/system/config', {
                mediaConfig: {
                    openaiKey: apiKeys.openai,
                    elevenLabsKey: apiKeys.elevenlabs,
                    replicateKey: apiKeys.replicate,
                    imagineArtKey: apiKeys.imagineArt,
                    veoModelId: apiKeys.veoModelId,
                    nanoBananaModelId: apiKeys.nanoBananaModelId,
                    providers: apiKeys.providers
                }
            }).then(() => alert("Media Cortex Updated"));
        }
    };

    const handleFactoryReset = () => {
        if (confirm("ARE YOU SURE? This will wipe all settings and local data.")) {
            settingsManager.factoryReset();
            window.location.reload();
        }
    };

    const startOAuthFlow = (schema: IntegrationSchema) => {
        if (schema.authConfig?.authorizationUrl) {
            // Real OAuth2 Logic Placeholder
            const redirectUri = `${window.location.origin}/oauth/callback`;
            const clientId = schema.authConfig.clientId;
            const scope = schema.authConfig.scopes?.join(' ') || '';
            const authUrl = `${schema.authConfig.authorizationUrl}?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code`;

            // Open popup or redirect
            window.open(authUrl, 'oauth_popup', 'width=600,height=700');
            console.log(`[OAUTH] Starting flow for ${schema.name} at ${authUrl}`);
        } else {
            alert("OAuth configuration missing for this provider.");
        }
    };

    const IntegrationCard: React.FC<{ schema: IntegrationSchema }> = ({ schema }) => {
        const isEditing = editingIntegration === schema.id;
        const CategoryIcon = {
            'AI': Globe,
            'DATABASE': Database,
            'MESSAGING': Bell,
            'CLOUD': Server,
            'DEV': Terminal,
            'OTHER': Plug
        }[schema.category];

        return (
            <div className={`p-4 rounded-xl border transition-all ${schema.isConnected ? 'bg-slate-900/50 border-green-900/50' : 'bg-slate-950 border-slate-800'}`}>
                <div className="flex justify-between items-start mb-3">
                    <div className="flex gap-3">
                        <div className={`p-2 rounded-lg ${schema.isConnected ? 'bg-green-900/20 text-green-400' : 'bg-slate-800 text-slate-500'}`}>
                            <CategoryIcon size={20} />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                {schema.name}
                                {schema.isConnected && <span className="text-[9px] bg-green-500 text-black px-1.5 py-0.5 rounded font-bold">ACTIVE</span>}
                            </h4>
                            <p className="text-[10px] text-slate-500">{schema.description}</p>
                        </div>
                    </div>
                    {!isEditing ? (
                        <button
                            onClick={() => setEditingIntegration(schema.id)}
                            className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded transition-colors"
                        >
                            {schema.isConnected ? 'CONFIGURE' : 'CONNECT'}
                        </button>
                    ) : (
                        <button
                            onClick={() => setEditingIntegration(null)}
                            className="text-slate-500 hover:text-white"
                        >
                            <span className="text-xs">CANCEL</span>
                        </button>
                    )}
                </div>

                {isEditing && (
                    <div className="mt-4 space-y-4 bg-black/20 p-4 rounded border border-slate-800 animate-in fade-in slide-in-from-top-2">
                        {/* OAuth2 Connect Button */}
                        {schema.authType === 'OAUTH2' && (
                            <div className="mb-4 p-3 bg-cyan-900/10 border border-cyan-500/20 rounded flex justify-between items-center">
                                <div>
                                    <span className="text-xs font-bold text-white block">OAuth2 Authorization</span>
                                    <p className="text-[10px] text-slate-400">Requires browser redirect to authenticate.</p>
                                </div>
                                <button
                                    onClick={() => startOAuthFlow(schema)}
                                    className="px-3 py-1.5 bg-white text-black text-xs font-bold rounded hover:bg-slate-200 flex items-center gap-2"
                                >
                                    <Globe size={12} /> CONNECT WITH {schema.name.toUpperCase()}
                                </button>
                            </div>
                        )}

                        {schema.fields.map(field => {
                            // Check if we have a saved value for this field
                            const savedValue = settingsManager.getCredential(schema.id, field.key);
                            // Visual feedback logic
                            const hasValue = savedValue && savedValue.length > 0;
                            const placeholderText = hasValue ? `•••••••• (Saved)` : (field.placeholder || 'Enter value...');

                            // Validation Logic
                            const isValid = !field.validationRegex || new RegExp(field.validationRegex).test(tempCredentials[field.key] || '');

                            return (
                                <div key={field.key}>
                                    <div className="flex justify-between items-end mb-1">
                                        <label className="text-[10px] uppercase text-slate-500 font-bold flex items-center gap-1">
                                            {field.label} {field.required && <span className="text-red-400">*</span>}
                                        </label>
                                        {hasValue && <span className="text-green-500 text-[9px] font-bold flex items-center gap-1"><Check size={8} /> SAVED</span>}
                                    </div>

                                    {field.description && (
                                        <p className="text-[9px] text-slate-500 mb-1.5 leading-tight">{field.description}</p>
                                    )}

                                    <div className="relative group">
                                        <input
                                            type={field.type === 'password' && !showSecrets[field.key] ? 'password' : 'text'}
                                            placeholder={placeholderText}
                                            value={tempCredentials[field.key] || ''}
                                            onChange={(e) => setTempCredentials({ ...tempCredentials, [field.key]: e.target.value })}
                                            className={`w-full bg-slate-900 border rounded p-2 text-xs text-white focus:outline-none font-mono placeholder:text-slate-600 transition-colors
                                                ${!isValid && tempCredentials[field.key] ? 'border-red-500/50 focus:border-red-500' : (hasValue ? 'border-green-900/30' : 'border-slate-700 focus:border-cyan-500')}
                                            `}
                                        />
                                        {field.type === 'password' && (
                                            <button
                                                onClick={() => setShowSecrets({ ...showSecrets, [field.key]: !showSecrets[field.key] })}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                {showSecrets[field.key] ? <EyeOff size={12} /> : <Eye size={12} />}
                                            </button>
                                        )}
                                    </div>
                                    {!isValid && tempCredentials[field.key] && (
                                        <span className="text-[9px] text-red-400 mt-1 block">Invalid format</span>
                                    )}
                                </div>
                            );
                        })}

                        <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-800/50">
                            {schema.isConnected && (
                                <button
                                    onClick={() => { settingsManager.disconnectIntegration(schema.id); refreshSettings(); setEditingIntegration(null); }}
                                    className="px-3 py-1.5 text-red-400 hover:bg-red-900/20 rounded text-xs transition-colors"
                                >
                                    DISCONNECT
                                </button>
                            )}
                            <button
                                onClick={() => handleIntegrationSave(schema.id)}
                                className="px-4 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-xs font-bold shadow-lg shadow-green-900/20"
                            >
                                SAVE CONFIGURATION
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col gap-6">

            {/* Header */}
            <div className="flex justify-between items-center glass-panel p-6 rounded-xl">
                <div>
                    <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                        <Sliders className="text-cyan-400" /> System Configuration
                    </h1>
                    <p className="text-xs text-slate-400 mt-1">
                        Manage global preferences, security vaults, and permission matrices.
                    </p>
                </div>
                <div className="flex gap-4">
                    <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                        {['GENERAL', 'INTEGRATIONS', 'PERMISSIONS', 'SYSTEM'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab as any)}
                                className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${activeTab === tab
                                    ? 'bg-cyan-600 text-white shadow-lg'
                                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                    {unsavedChanges && (
                        <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-bold animate-pulse">
                            <Save size={14} /> SAVE CHANGES
                        </button>
                    )}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 glass-panel rounded-xl p-6 overflow-y-auto custom-scrollbar">

                {/* GENERAL SETTINGS */}
                {activeTab === 'GENERAL' && (
                    <div className="max-w-3xl space-y-8">
                        <section>
                            <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                                <Palette size={16} className="text-purple-400" /> Appearance
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-2">Interface Theme</label>
                                        <select
                                            value={settings.theme.mode}
                                            onChange={(e) => { settingsManager.updateTheme({ mode: e.target.value as any }); refreshSettings(); }}
                                            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white text-xs outline-none focus:border-cyan-500"
                                        >
                                            <option value="dark">Dark Mode (Default)</option>
                                            <option value="light">Light Mode</option>
                                            <option value="cyberpunk">Cyberpunk Neon</option>
                                            <option value="corporate">Corporate Clean</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Google Gemini API Key</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                value={apiKeys.gemini}
                                                onChange={(e) => setApiKeys({ ...apiKeys, gemini: e.target.value })}
                                                className="flex-1 bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-cyan-500"
                                                placeholder="sk-..."
                                            />
                                            <button onClick={() => handleSaveApiKey('gemini')} className="px-4 bg-cyan-600 text-white rounded hover:bg-cyan-500">Save</button>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-slate-800">
                                        <h3 className="text-sm font-bold text-purple-400 mb-4 flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-purple-500"></span> Media Cortex Keys
                                        </h3>

                                        <div className="space-y-3">
                                            {/* Provider Selection */}
                                            <div className="grid grid-cols-3 gap-2 mb-4">
                                                <div>
                                                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Image Model</label>
                                                    <select
                                                        value={apiKeys.providers?.image || 'OPENAI'}
                                                        onChange={(e) => setApiKeys({ ...apiKeys, providers: { ...apiKeys.providers, image: e.target.value as any } })}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-[10px] text-white"
                                                    >
                                                        <option value="OPENAI">DALL-E 3 (OpenAI)</option>
                                                        <option value="GEMINI">Imagen 3 (Gemini)</option>
                                                        <option value="STABILITY">Stable Diffusion</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Voice Model</label>
                                                    <select
                                                        value={apiKeys.providers?.voice || 'ELEVENLABS'}
                                                        onChange={(e) => setApiKeys({ ...apiKeys, providers: { ...apiKeys.providers, voice: e.target.value as any } })}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-[10px] text-white"
                                                    >
                                                        <option value="ELEVENLABS">ElevenLabs (Ultra)</option>
                                                        <option value="OPENAI">OpenAI TTS</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Video Model</label>
                                                    <select
                                                        value={apiKeys.providers?.video || 'REPLICATE'}
                                                        onChange={(e) => setApiKeys({ ...apiKeys, providers: { ...apiKeys.providers, video: e.target.value as any } })}
                                                        className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-[10px] text-white"
                                                    >
                                                        <option value="REPLICATE">Replicate (SVD)</option>
                                                        <option value="RUNWAY">Runway Gen-2</option>
                                                    </select>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Unsplash Access Key (Real Stock)</label>
                                                <div className="flex gap-2">
                                                    <input
                                                        type="password"
                                                        value={apiKeys.unsplash || ''}
                                                        onChange={(e) => setApiKeys({ ...apiKeys, unsplash: e.target.value })}
                                                        className="flex-1 bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-purple-500 text-xs"
                                                        placeholder="Client ID..."
                                                    />
                                                    <button onClick={() => handleSaveApiKey('unsplash')} className="px-3 bg-slate-800 text-white rounded hover:bg-slate-700 text-xs font-bold border border-slate-700">Save</button>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">OpenAI Key (DALL-E 3 / TTS)</label>
                                                <input
                                                    type="password"
                                                    value={apiKeys.openai || ''}
                                                    onChange={(e) => setApiKeys({ ...apiKeys, openai: e.target.value })}
                                                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-purple-500 text-xs"
                                                    placeholder="sk-..."
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">ElevenLabs Key (Voice)</label>
                                                <input
                                                    type="password"
                                                    value={apiKeys.elevenlabs || ''}
                                                    onChange={(e) => setApiKeys({ ...apiKeys, elevenlabs: e.target.value })}
                                                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-purple-500 text-xs"
                                                    placeholder="xi-..."
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Replicate Key (Video & Relight)</label>
                                                <input
                                                    type="password"
                                                    value={apiKeys.replicate || ''}
                                                    onChange={(e) => setApiKeys({ ...apiKeys, replicate: e.target.value })}
                                                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-purple-500 text-xs"
                                                    placeholder="r8_..."
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Imagine Art Key (Fallback)</label>
                                                <input
                                                    type="password"
                                                    value={apiKeys.imagineArt || ''}
                                                    onChange={(e) => setApiKeys({ ...apiKeys, imagineArt: e.target.value })}
                                                    className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-purple-500 text-xs"
                                                    placeholder="ia-..."
                                                />
                                            </div>
                                        </div>

                                        {/* Advanced Model Config */}
                                        <div className="mt-4 pt-4 border-t border-slate-800">
                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-3">Advanced Video Models (Replicate IDs)</h4>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Google Veo 3.1 ID</label>
                                                    <input
                                                        type="text"
                                                        value={apiKeys.veoModelId || ''}
                                                        onChange={(e) => setApiKeys({ ...apiKeys, veoModelId: e.target.value })}
                                                        className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-purple-500 text-xs font-mono"
                                                        placeholder="google/veo-3.1"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">NanoBanana Pro ID</label>
                                                    <input
                                                        type="text"
                                                        value={apiKeys.nanoBananaModelId || ''}
                                                        onChange={(e) => setApiKeys({ ...apiKeys, nanoBananaModelId: e.target.value })}
                                                        className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-white outline-none focus:border-purple-500 text-xs font-mono"
                                                        placeholder="google/nano-banana-pro"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-4">
                                            <button
                                                onClick={() => handleSaveApiKey('media')}
                                                className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                                            >
                                                <Save size={14} /> SAVE MEDIA CONFIGURATION (ALL KEYS)
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-2">Density</label>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleDensityChange('comfortable')}
                                            className={`flex-1 py-2 rounded text-xs font-bold border transition-all ${settings.theme.density === 'comfortable'
                                                ? 'bg-slate-800 border-cyan-500 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                                                : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-white'
                                                }`}
                                        >
                                            COMFORTABLE
                                        </button>
                                        <button
                                            onClick={() => handleDensityChange('compact')}
                                            className={`flex-1 py-2 rounded text-xs font-bold border transition-all ${settings.theme.density === 'compact'
                                                ? 'bg-slate-800 border-cyan-500 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                                                : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-white'
                                                }`}
                                        >
                                            COMPACT
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section>
                            <h3 className="text-sm font-bold text-white border-b border-slate-800 pb-2 mb-4 flex items-center gap-2">
                                <Bell size={16} className="text-yellow-400" /> Notifications
                            </h3>
                            <div className="space-y-3">
                                {Object.entries(settings.notifications).map(([key, value]) => (
                                    <div
                                        key={key}
                                        onClick={() => toggleNotification(key as any)}
                                        className="flex items-center justify-between p-3 bg-slate-900/50 rounded border border-slate-800 cursor-pointer hover:border-slate-700 select-none transition-colors"
                                    >
                                        <span className="text-xs text-slate-300 capitalize font-medium">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                        <div className={`w-10 h-5 rounded-full relative transition-colors ${value ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-slate-700'}`}>
                                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 ${value ? 'left-6' : 'left-1'}`} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    </div>
                )
                }

                {/* INTEGRATIONS VAULT */}
                {
                    activeTab === 'INTEGRATIONS' && (
                        <div className="space-y-6">
                            {/* Integration Cards Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {settings.registeredIntegrations.map(schema => (
                                    <IntegrationCard key={schema.id} schema={schema} />
                                ))}
                                {/* Add New Button */}
                                <button
                                    onClick={handleDiscoverExtensions}
                                    disabled={isDiscovering}
                                    className="p-4 rounded-xl border border-dashed border-slate-700 text-slate-500 hover:border-cyan-500 hover:text-cyan-400 flex items-center justify-center gap-2 transition-all group"
                                >
                                    {isDiscovering ? (
                                        <>
                                            <Download className="animate-bounce" size={20} />
                                            <span className="text-xs font-bold">{discoverMessage || "FETCHING..."}</span>
                                        </>
                                    ) : (
                                        <>
                                            <Cloud className="group-hover:scale-110 transition-transform" size={20} />
                                            <span className="text-xs font-bold">DISCOVER NEW EXTENSIONS</span>
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* Webhooks & Event Triggers Section */}
                            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
                                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                    <Globe size={16} className="text-purple-400" />
                                    Webhooks & Event Triggers
                                </h3>
                                <p className="text-xs text-slate-400 mb-4">
                                    External services can send events to Silhouette via these webhook endpoints.
                                    Configure your integrations to POST to these URLs.
                                </p>

                                <div className="space-y-3">
                                    {/* GitHub Webhook */}
                                    <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-slate-800">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-slate-800">
                                                <Terminal size={16} className="text-slate-400" />
                                            </div>
                                            <div>
                                                <span className="text-xs font-bold text-white block">GitHub Webhook</span>
                                                <code className="text-[10px] text-cyan-400 font-mono">
                                                    {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3005'}/webhooks/github
                                                </code>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const url = `${window.location.origin}/webhooks/github`;
                                                navigator.clipboard.writeText(url);
                                                alert('Webhook URL copied!');
                                            }}
                                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold"
                                        >
                                            COPY
                                        </button>
                                    </div>

                                    {/* Gmail Push */}
                                    <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-slate-800">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-slate-800">
                                                <Bell size={16} className="text-slate-400" />
                                            </div>
                                            <div>
                                                <span className="text-xs font-bold text-white block">Gmail Push Notifications</span>
                                                <code className="text-[10px] text-cyan-400 font-mono">
                                                    {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3005'}/webhooks/gmail/push
                                                </code>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const url = `${window.location.origin}/webhooks/gmail/push`;
                                                navigator.clipboard.writeText(url);
                                                alert('Webhook URL copied!');
                                            }}
                                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold"
                                        >
                                            COPY
                                        </button>
                                    </div>

                                    {/* Slack Events */}
                                    <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-slate-800">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-slate-800">
                                                <Plug size={16} className="text-slate-400" />
                                            </div>
                                            <div>
                                                <span className="text-xs font-bold text-white block">Slack Events API</span>
                                                <code className="text-[10px] text-cyan-400 font-mono">
                                                    {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3005'}/webhooks/slack/events
                                                </code>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => {
                                                const url = `${window.location.origin}/webhooks/slack/events`;
                                                navigator.clipboard.writeText(url);
                                                alert('Webhook URL copied!');
                                            }}
                                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded text-xs font-bold"
                                        >
                                            COPY
                                        </button>
                                    </div>

                                    {/* Custom Webhook */}
                                    <div className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-slate-800">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 rounded-lg bg-purple-900/30">
                                                <Server size={16} className="text-purple-400" />
                                            </div>
                                            <div>
                                                <span className="text-xs font-bold text-white block">Custom Webhook</span>
                                                <code className="text-[10px] text-cyan-400 font-mono">
                                                    {typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3005'}/webhooks/webhook/:providerId
                                                </code>
                                            </div>
                                        </div>
                                        <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-1 rounded">
                                            Replace :providerId
                                        </span>
                                    </div>
                                </div>

                                <div className="mt-4 p-3 bg-cyan-900/10 border border-cyan-500/20 rounded-lg">
                                    <p className="text-xs text-cyan-400">
                                        <strong>💡 Tip:</strong> Set <code className="bg-black/30 px-1 rounded">X-Event-Type</code> header
                                        in your webhook requests to help Silhouette categorize events.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* PERMISSIONS MATRIX */}
                {
                    activeTab === 'PERMISSIONS' && (
                        <div>
                            <div className="bg-yellow-900/10 border border-yellow-500/30 p-4 rounded-lg mb-6 flex items-start gap-3">
                                <Shield className="text-yellow-500 shrink-0" size={20} />
                                <div>
                                    <h4 className="text-sm font-bold text-white">RBAC Configuration</h4>
                                    <p className="text-xs text-slate-400 mt-1">
                                        Modifying these rules affects all users assigned to these roles immediately.
                                        Ensure "SUPER_ADMIN" always has full access to prevent lockout.
                                    </p>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr>
                                            <th className="p-3 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase">Role</th>
                                            <th className="p-3 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase text-center">Dashboard</th>
                                            <th className="p-3 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase text-center">Swarm Control</th>
                                            <th className="p-3 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase text-center">Memory Access</th>
                                            <th className="p-3 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase text-center">Settings</th>
                                            <th className="p-3 border-b border-slate-700 text-xs font-bold text-slate-400 uppercase text-center">Exec Tasks</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.entries(settings.permissions).map(([role, perms]) => (
                                            <tr key={role} className="hover:bg-slate-900/50">
                                                <td className="p-3 border-b border-slate-800 text-xs font-bold text-white">
                                                    {role.replace('_', ' ')}
                                                </td>
                                                {Object.entries(perms).map(([key, val]) => (
                                                    <td key={key} className="p-3 border-b border-slate-800 text-center">
                                                        <button
                                                            onClick={() => togglePermission(role, key)}
                                                            disabled={role === UserRole.SUPER_ADMIN && key === 'canEditSettings'} // Prevent lockout
                                                            className={`w-4 h-4 rounded border flex items-center justify-center mx-auto transition-colors ${val
                                                                ? 'bg-cyan-600 border-cyan-500 text-white'
                                                                : 'bg-transparent border-slate-600 hover:border-slate-400'
                                                                }`}
                                                        >
                                                            {val && <Check size={10} />}
                                                        </button>
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                }

                {/* SYSTEM MAINTENANCE */}
                {
                    activeTab === 'SYSTEM' && (
                        <div className="space-y-6">

                            {/* DREAMER CONFIGURATION */}
                            <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-xl">
                                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                                    <Cloud size={16} className="text-cyan-400" /> Dreamer Configuration
                                </h3>
                                <div className="flex items-center justify-between p-4 bg-black/20 rounded border border-slate-800">
                                    <div>
                                        <span className="text-xs text-white font-bold block">Operational Mode</span>
                                        <span className="text-[10px] text-slate-500">
                                            {dreamerMode === 'DEV'
                                                ? "Development: Fast cycles (Threshold: 10). Good for testing."
                                                : "Production: Deep cycles (Threshold: 50). Optimized for stability."}
                                        </span>
                                    </div>
                                    <div className="flex bg-slate-950 rounded p-1 border border-slate-800">
                                        <button
                                            onClick={() => handleDreamerModeChange('DEV')}
                                            className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all ${dreamerMode === 'DEV' ? 'bg-cyan-900/50 text-cyan-400 border border-cyan-500/50' : 'text-slate-500 hover:text-white'}`}
                                        >
                                            DEV
                                        </button>
                                        <button
                                            onClick={() => handleDreamerModeChange('PROD')}
                                            className={`px-3 py-1.5 rounded text-[10px] font-bold transition-all ${dreamerMode === 'PROD' ? 'bg-purple-900/50 text-purple-400 border border-purple-500/50' : 'text-slate-500 hover:text-white'}`}
                                        >
                                            PROD
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-red-900/10 border border-red-900/50 p-6 rounded-xl">
                                <h3 className="text-sm font-bold text-red-400 mb-4 flex items-center gap-2">
                                    <AlertTriangle size={16} /> Danger Zone
                                </h3>
                                <div className="flex items-center justify-between p-4 bg-black/20 rounded border border-red-900/30 mb-4">
                                    <div>
                                        <span className="text-xs text-white font-bold block">Factory Reset</span>
                                        <span className="text-[10px] text-slate-500">Wipes all continuum memory, logs, and custom settings.</span>
                                    </div>
                                    <button onClick={handleFactoryReset} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-bold rounded flex items-center gap-2">
                                        <Trash2 size={14} /> PURGE SYSTEM
                                    </button>
                                </div>
                                <div className="flex items-center justify-between p-4 bg-black/20 rounded border border-red-900/30">
                                    <div>
                                        <span className="text-xs text-white font-bold block">Force Kernel Restart</span>
                                        <span className="text-[10px] text-slate-500">Restarts the Node.js backend process immediately.</span>
                                    </div>
                                    <button onClick={() => window.location.reload()} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded flex items-center gap-2">
                                        <RotateCcw size={14} /> REBOOT
                                    </button>
                                </div>
                            </div>

                            <div className="p-6 bg-slate-900/50 rounded-xl border border-slate-800">
                                <h3 className="text-sm font-bold text-white mb-2">System Info</h3>
                                <div className="grid grid-cols-2 gap-4 text-xs font-mono text-slate-400">
                                    <div>Version: <span className="text-cyan-400">4.2.0-Enterprise</span></div>
                                    <div>Build ID: <span className="text-purple-400">sha-29f8a1</span></div>
                                    <div>Environment: <span className="text-green-400">Production</span></div>
                                    <div>Uptime: <span className="text-white">48h 12m</span></div>
                                </div>
                            </div>
                        </div>
                    )
                }

            </div >
        </div >
    );
};

export default Settings;
