import { api } from "../utils/api";
import { SettingsState, IntegrationSchema, PermissionMatrix, UserRole } from "../types";
// import { continuum } from "./continuumMemory"; // REMOVED: Frontend service should not import backend logic

// --- SETTINGS MANAGER V1.0 ---
// Handles configuration, secrets vault, and permission matrices.
// Integrates with Continuum for persistence.

class SettingsManager {
    private state: SettingsState;
    private readonly STORAGE_KEY = 'silhouette_settings_v1';

    // A real "Marketplace" repository of available schemas
    private extensionRepository: IntegrationSchema[] = [
        {
            id: 'jira',
            name: 'Jira Enterprise',
            description: 'Project tracking and ticket management.',
            category: 'OTHER',
            isConnected: false,
            authType: 'API_KEY', // Added default
            fields: [
                { key: 'host', label: 'Jira URL', type: 'url', required: true },
                { key: 'email', label: 'Email', type: 'text', required: true },
                { key: 'apiToken', label: 'API Token', type: 'password', required: true }
            ]
        },
        {
            id: 'github',
            name: 'GitHub Repos',
            description: 'Source code management and CI/CD triggers.',
            category: 'DEV',
            isConnected: false,
            authType: 'API_KEY', // Added default
            fields: [
                { key: 'repoUrl', label: 'Repository URL', type: 'url', required: true },
                { key: 'pat', label: 'Personal Access Token', type: 'password', required: true }
            ]
        },
        {
            id: 'aws',
            name: 'AWS Cloud',
            description: 'S3 storage and Lambda execution.',
            category: 'CLOUD',
            isConnected: false,
            authType: 'API_KEY', // Added default (simulated)
            fields: [
                { key: 'region', label: 'Region', type: 'text', required: true },
                { key: 'accessKey', label: 'Access Key ID', type: 'text', required: true },
                { key: 'secretKey', label: 'Secret Access Key', type: 'password', required: true }
            ]
        }
    ];

    constructor() {
        this.state = this.loadSettings();
        // Initialize default integrations if missing
        this.ensureDefaultIntegrations();
    }

    public getSettings(): SettingsState {
        // Return a copy to ensure React detects state changes
        return JSON.parse(JSON.stringify(this.state));
    }

    public updateTheme(themeUpdates: Partial<SettingsState['theme']>) {
        this.state.theme = { ...this.state.theme, ...themeUpdates };
        this.saveSettings();
    }

    public updatePermissions(role: string, updates: Partial<PermissionMatrix[string]>) {
        if (this.state.permissions[role]) {
            this.state.permissions[role] = { ...this.state.permissions[role], ...updates };
            this.saveSettings();
        }
    }

    public async updateNotifications(updates: Partial<SettingsState['notifications']>) {
        // REAL LOGIC: Request Browser Permission
        if (updates.browser === true) {
            if (typeof Notification !== 'undefined') {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    console.warn("Browser notification permission denied.");
                    updates.browser = false; // Revert if denied
                }
            }
        }

        this.state.notifications = { ...this.state.notifications, ...updates };
        this.saveSettings();
        return this.state.notifications; // Return actual state after logic
    }

    // --- DYNAMIC INTEGRATION LOGIC ---

    // Register a new tool capability (called by Installation Service or manually)
    public registerIntegrationSchema(schema: IntegrationSchema) {
        const exists = this.state.registeredIntegrations.find(i => i.id === schema.id);
        if (!exists) {
            this.state.registeredIntegrations.push(schema);
            this.saveSettings();
        }
    }

    // Real Discovery Logic: Find next available extension from repo
    public discoverNextExtension(): IntegrationSchema | null {
        const installedIds = this.state.registeredIntegrations.map(i => i.id);
        const available = this.extensionRepository.find(ext => !installedIds.includes(ext.id));
        return available || null;
    }

    public saveCredential(serviceId: string, data: Record<string, string>) {
        // In a real server, this would encrypt before saving to disk.
        // Here we store in memory/localstorage structure.
        if (!this.state.integrations[serviceId]) {
            this.state.integrations[serviceId] = {};
        }
        this.state.integrations[serviceId] = { ...this.state.integrations[serviceId], ...data };

        // Mark as connected
        const schema = this.state.registeredIntegrations.find(i => i.id === serviceId);
        if (schema) {
            schema.isConnected = true;
            schema.lastSync = Date.now();
        }

        this.saveSettings();

        // REAL LOGIC: Sync with Backend if it's the Gemini Key
        if (serviceId === 'gemini' && data.apiKey) {
            this.syncGeminiKeyToBackend(data.apiKey);
        }

        // Also verify connectivity (Simulated)
        return true;
    }

    private async syncGeminiKeyToBackend(apiKey: string) {
        try {
            // We need to fetch the port from somewhere, but for now assume 3001 or use window location if applicable
            // Since this runs in browser, we can use fetch
            await api.post('/v1/system/config', { apiKey });
            console.log("[SETTINGS] Synced Gemini Key to Backend");
        } catch (e) {
            console.error("[SETTINGS] Failed to sync key to backend", e);
        }
    }

    public getCredential(serviceId: string, key: string): string | undefined {
        return this.state.integrations[serviceId]?.[key];
    }

    public disconnectIntegration(serviceId: string) {
        if (this.state.integrations[serviceId]) {
            delete this.state.integrations[serviceId];
            const schema = this.state.registeredIntegrations.find(i => i.id === serviceId);
            if (schema) schema.isConnected = false;
            this.saveSettings();
        }
    }

    public factoryReset() {
        localStorage.removeItem(this.STORAGE_KEY);
        this.state = this.getDefaultSettings();
        this.ensureDefaultIntegrations();
        this.saveSettings();
    }

    // --- PERSISTENCE ---

    private saveSettings() {
        if (typeof window !== 'undefined') {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
        }
    }

    private loadSettings(): SettingsState {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        }
        return this.getDefaultSettings();
    }

    private getDefaultSettings(): SettingsState {
        return {
            theme: {
                mode: 'dark',
                accentColor: 'cyan',
                reduceMotion: false,
                density: 'comfortable'
            },
            integrations: {}, // Secure vault
            registeredIntegrations: [],
            permissions: {
                [UserRole.SUPER_ADMIN]: { canViewDashboard: true, canControlSwarm: true, canAccessMemory: true, canEditSettings: true, canExecuteTasks: true },
                [UserRole.ADMIN]: { canViewDashboard: true, canControlSwarm: true, canAccessMemory: true, canEditSettings: false, canExecuteTasks: true },
                [UserRole.WORKER_L1]: { canViewDashboard: true, canControlSwarm: false, canAccessMemory: false, canEditSettings: false, canExecuteTasks: true },
                [UserRole.CLIENT]: { canViewDashboard: true, canControlSwarm: false, canAccessMemory: false, canEditSettings: false, canExecuteTasks: false },
                [UserRole.VISITOR]: { canViewDashboard: false, canControlSwarm: false, canAccessMemory: false, canEditSettings: false, canExecuteTasks: false }
            },
            notifications: {
                email: true,
                slack: false,
                browser: true,
                securityAlerts: true
            },
            language: 'en'
        };
    }

    private ensureDefaultIntegrations() {
        const defaults: IntegrationSchema[] = [
            {
                id: 'gemini',
                name: 'Google Gemini',
                description: 'Primary Cognitive Engine. Required for reasoning.',
                category: 'AI',
                isConnected: true, // Assumed since app is running
                authType: 'API_KEY',
                fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }]
            },
            {
                id: 'openai',
                name: 'OpenAI GPT-4',
                description: 'Fallback reasoning engine and embeddings.',
                category: 'AI',
                isConnected: false,
                authType: 'API_KEY',
                fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }, { key: 'orgId', label: 'Org ID', type: 'text', required: false }]
            },
            {
                id: 'google_drive',
                name: 'Google Drive',
                description: 'Cloud storage for assets and client deliverables.',
                category: 'CLOUD',
                isConnected: false,
                authType: 'OAUTH2',
                fields: [
                    { key: 'folderId', label: 'Default Folder ID', type: 'text', required: false, placeholder: 'From Drive URL' },
                    { key: 'autoSync', label: 'Auto-sync assets', type: 'text', required: false, placeholder: 'true/false' }
                ]
            },
            {
                id: 'gmail',
                name: 'Gmail',
                description: 'Email inbox and client communication.',
                category: 'MESSAGING',
                isConnected: false,
                authType: 'OAUTH2',
                fields: [
                    { key: 'emailNotifications', label: 'New Email Notifications', type: 'text', required: false, placeholder: 'true/false' },
                    { key: 'pollingInterval', label: 'Polling Interval (seconds)', type: 'text', required: false, placeholder: '60' }
                ]
            },
            {
                id: 'slack',
                name: 'Slack Workspace',
                description: 'For team notifications and chat-ops.',
                category: 'MESSAGING',
                isConnected: false,
                authType: 'WEBHOOK_SECRET',
                fields: [{ key: 'webhookUrl', label: 'Webhook URL', type: 'url', required: true }, { key: 'botToken', label: 'Bot User Token', type: 'password', required: true }]
            },
            {
                id: 'postgres',
                name: 'PostgreSQL DB',
                description: 'External persistence layer for enterprise data.',
                category: 'DATABASE',
                isConnected: false,
                authType: 'BASIC',
                fields: [
                    { key: 'host', label: 'Host', type: 'text', required: true },
                    { key: 'port', label: 'Port', type: 'text', required: true, placeholder: '5432' },
                    { key: 'database', label: 'Database Name', type: 'text', required: true },
                    { key: 'user', label: 'Username', type: 'text', required: true },
                    { key: 'password', label: 'Password', type: 'password', required: true }
                ]
            }
        ];

        defaults.forEach(d => this.registerIntegrationSchema(d));
    }

}

export const settingsManager = new SettingsManager();
