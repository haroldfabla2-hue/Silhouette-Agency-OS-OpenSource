import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

export interface WebhookConfig {
    id: string;
    description: string;
    endpoint: string;
    method: 'POST' | 'GET';
    status: 'ACTIVE' | 'INACTIVE';
    secret?: string;
    provider: 'GITHUB' | 'GMAIL' | 'CUSTOM';
}

class WebhookManager extends EventEmitter {
    private static instance: WebhookManager;
    private webhooks: Map<string, WebhookConfig> = new Map();
    private persistencePath: string;

    private constructor() {
        super();
        this.persistencePath = path.join(process.cwd(), 'data', 'webhooks.json');

        // Ensure data dir exists
        const dataDir = path.dirname(this.persistencePath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        this.loadWebhooks();

        // Initialize default if empty
        if (this.webhooks.size === 0) {
            this.register({
                id: 'mcp-default',
                description: 'Default MCP Inbound Webhook',
                endpoint: '/v1/webhooks/mcp',
                method: 'POST',
                status: 'ACTIVE',
                provider: 'CUSTOM'
            });
        }
    }

    public static getInstance(): WebhookManager {
        if (!WebhookManager.instance) {
            WebhookManager.instance = new WebhookManager();
        }
        return WebhookManager.instance;
    }

    private loadWebhooks() {
        try {
            if (fs.existsSync(this.persistencePath)) {
                const data = fs.readFileSync(this.persistencePath, 'utf-8');
                const loaded = JSON.parse(data) as WebhookConfig[];
                loaded.forEach(w => this.webhooks.set(w.id, w));
                console.log(`[WebhookManager] 📂 Loaded ${loaded.length} webhooks from disk.`);
            }
        } catch (error) {
            console.error('[WebhookManager] ❌ Failed to load webhooks:', error);
        }
    }

    private saveWebhooks() {
        try {
            const data = Array.from(this.webhooks.values());
            fs.writeFileSync(this.persistencePath, JSON.stringify(data, null, 2));
            console.log('[WebhookManager] 💾 Webhooks persisted to disk.');
        } catch (error) {
            console.error('[WebhookManager] ❌ Failed to save webhooks:', error);
        }
    }

    public register(config: WebhookConfig) {
        this.webhooks.set(config.id, config);
        console.log(`[WebhookManager] 🔗 Registered webhook: ${config.id} (${config.endpoint})`);
        this.saveWebhooks(); // Persist on change
        this.emit('webhook_registered', config);
    }

    public unregister(id: string) {
        if (this.webhooks.has(id)) {
            this.webhooks.delete(id);
            console.log(`[WebhookManager] ⛓️ Unregistered webhook: ${id}`);
            this.saveWebhooks(); // Persist on change
            this.emit('webhook_unregistered', id);
        }
    }

    public getActiveWebhooks(): WebhookConfig[] {
        return Array.from(this.webhooks.values()).filter(w => w.status === 'ACTIVE');
    }

    public async handleWebhook(id: string, payload: any) {
        console.log(`[WebhookManager] 📨 Received payload for ${id}`);
        // Here we would emit to systemBus or trigger specific agents
        this.emit('webhook_received', { id, payload });
    }
}

export const webhookManager = WebhookManager.getInstance();
