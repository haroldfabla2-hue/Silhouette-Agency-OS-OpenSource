import { BrowserWorkScope } from './runtime/browserWorkScope';
import { api } from "../utils/api";
import { SettingsState, IntegrationSchema, PermissionMatrix, UserRole } from "../types";

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

    private readonly lifecycle = new BrowserWorkScope();
    private localReady = false;
    private startup?: Promise<void>;
    constructor() { this.state = this.getDefaultSettings(); }
    private startLocal(): void {
        if (this.localReady) return;
        this.lifecycle.assertOpen();
        try { this.state = this.loadSettings(); this.ensureDefaultIntegrations(); this.localReady = true; }
        catch (error) { this.lifecycle.record('settings-local-recovery', true); throw error; }
    }
    public start(): Promise<void> {
        this.lifecycle.assertOpen();
        this.startLocal();
        if (!this.startup) this.startup = this.lifecycle.run('settings-startup', async () => {
            // Preserve existing migration behavior, but only under explicit browser startup.
            // Ordering prevents status hydration from overwriting legacy values before migration.
            await this.migrateLocalStorageSecrets();
            await this.loadServerSecrets();
        });
        return this.startup;
    }
    public shutdown() { return this.lifecycle.close(); }
    public getLifecycleDiagnostics() { return this.lifecycle.getDiagnostics(); }

    public getSettings(): SettingsState {
        this.lifecycle.assertOpen(); this.startLocal();

        // Return a copy to ensure React detects state changes
        return JSON.parse(JSON.stringify(this.state));
    }

    public updateTheme(themeUpdates: Partial<SettingsState['theme']>) {
        this.lifecycle.assertOpen(); this.startLocal();

        this.state.theme = { ...this.state.theme, ...themeUpdates };
        this.saveSettings();
    }

    public updatePermissions(role: string, updates: Partial<PermissionMatrix[string]>) {
        this.lifecycle.assertOpen(); this.startLocal();

        if (this.state.permissions[role]) {
            this.state.permissions[role] = { ...this.state.permissions[role], ...updates };
            this.saveSettings();
        }
    }

    public async updateNotifications(updates: Partial<SettingsState['notifications']>) {
        this.lifecycle.assertOpen(); this.startLocal();
        return this.lifecycle.run('updateNotifications', async () => {

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
    
        });
    }

    public updateSystemUpdates(updates: Partial<SettingsState['systemUpdates']>) {
        this.lifecycle.assertOpen(); this.startLocal();

        if (!this.state.systemUpdates) {
            this.state.systemUpdates = { autoCheck: true, autoLaunch: false };
        }
        this.state.systemUpdates = { ...this.state.systemUpdates, ...updates };
        this.saveSettings();
    }

    // --- DYNAMIC INTEGRATION LOGIC ---

    // Register a new tool capability (called by Installation Service or manually)
    public registerIntegrationSchema(schema: IntegrationSchema) {
        this.lifecycle.assertOpen(); this.startLocal();

        const exists = this.state.registeredIntegrations.find(i => i.id === schema.id);
        if (!exists) {
            this.state.registeredIntegrations.push(schema);
            this.saveSettings();
        }
    }

    // Real Discovery Logic: Find next available extension from repo
    public discoverNextExtension(): IntegrationSchema | null {
        this.lifecycle.assertOpen(); this.startLocal();

        const installedIds = this.state.registeredIntegrations.map(i => i.id);
        const available = this.extensionRepository.find(ext => !installedIds.includes(ext.id));
        return available || null;
    }

    public async saveCredential(serviceId: string, data: Record<string, string>) {
        this.lifecycle.assertOpen(); this.startLocal();
        return this.lifecycle.run('saveCredential', async () => {

        // ── Server-side storage via Secrets Vault API ──
        try {
            await api.post(`/v1/system/secrets/${serviceId}`, { credentials: data });
            console.log(`[SETTINGS] Credentials for ${serviceId} saved to server vault`);
        } catch (e) {
            this.lifecycle.record('settings-credential-durability', true);
            return false;
        }

        // Update local connected status (for fast UI rendering)
        const schema = this.state.registeredIntegrations.find(i => i.id === serviceId);
        if (schema) {
            schema.isConnected = true;
            schema.lastSync = Date.now();
        }

        // Keep a minimal reference locally (just which keys exist, NOT values)
        if (!this.state.integrations[serviceId]) {
            this.state.integrations[serviceId] = {};
        }
        // Store only key names as markers, not actual values
        Object.keys(data).forEach(k => {
            this.state.integrations[serviceId][k] = '••••••••'; // Masked placeholder
        });

        this.saveSettings();
        return true;
    
        });
    }

    /**
     * Load secret status from server to hydrate UI connected indicators.
     * Called once on init — does NOT fetch raw values, only which services are configured.
     */
    private async loadServerSecrets() {
        try {
            const response = await api.get<{ services: Array<{ id: string; hasCredentials: boolean; keys: string[]; maskedPreview: Record<string, string> }> }>('/v1/system/secrets');
            if (response.services) {
                for (const svc of response.services) {
                    // Mark integration as connected in local state
                    const schema = this.state.registeredIntegrations.find(i => i.id === svc.id);
                    if (schema) {
                        schema.isConnected = true;
                    }
                    // Store masked previews for UI display
                    this.state.integrations[svc.id] = svc.maskedPreview;
                }
                this.saveSettings();
            }
        } catch (e) {
            // Server may not be available yet during cold start — this is OK
            this.lifecycle.record('settings-server-secret-status');
            console.warn('[SETTINGS] Could not load server secrets status (server may be starting)');
        }

        // Unified Google status: one server-side OAuth consent covers Drive + Gmail,
        // but /v1/system/secrets only reports the 'google-workspace' vault id.
        // Cross-check the real status endpoint so both cards show ACTIVE when connected.
        try {
            const ws = await api.get<{ connected?: boolean }>('/v1/google-auth/status');
            if (ws.connected) {
                for (const id of ['google_drive', 'gmail']) {
                    const schema = this.state.registeredIntegrations.find(i => i.id === id);
                    if (schema) schema.isConnected = true;
                }
                this.saveSettings();
            }
        } catch {
            this.lifecycle.record('settings-google-status');
            // status endpoint unavailable - leave cards as-is
        }
    }

    /**
     * One-time migration: if secrets exist in old localStorage format (raw values),
     * upload them to the server vault and replace with masked placeholders.
     */
    private async migrateLocalStorageSecrets() {
        const integrations = this.state.integrations;
        if (!integrations || Object.keys(integrations).length === 0) return;

        let migratedCount = 0;
        for (const [serviceId, creds] of Object.entries(integrations)) {
            if (!creds || typeof creds !== 'object') continue;

            // Check if any value looks like a real secret (not already masked)
            const hasRealValues = Object.values(creds).some(
                v => typeof v === 'string' && v.length > 0 && !v.startsWith('••')
            );

            if (hasRealValues) {
                try {
                    await api.post(`/v1/system/secrets/${serviceId}`, { credentials: creds });
                    // Replace with masked values
                    Object.keys(creds).forEach(k => {
                        (creds as any)[k] = '••••••••';
                    });
                    migratedCount++;
                } catch (e) {
                    this.lifecycle.record('settings-legacy-migration', true);
                    // Originals retained, no connected/durability success.
                }
            }
        }

        if (migratedCount > 0) {
            console.log(`[SETTINGS] Migrated ${migratedCount} service credentials to server vault`);
            this.saveSettings();
        }
    }

    public getCredential(serviceId: string, key: string): string | undefined {
        this.lifecycle.assertOpen(); this.startLocal();

        return this.state.integrations[serviceId]?.[key];
    }

    public disconnectIntegration(serviceId: string) {
        this.lifecycle.assertOpen(); this.startLocal();

        if (this.state.integrations[serviceId]) {
            delete this.state.integrations[serviceId];
            const schema = this.state.registeredIntegrations.find(i => i.id === serviceId);
            if (schema) schema.isConnected = false;
            this.saveSettings();
        }
    }

    public factoryReset() {
        this.lifecycle.assertOpen(); this.startLocal();

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
            language: 'en',
            systemUpdates: {
                autoCheck: true,
                autoLaunch: false
            }
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
