/**
 * INTEGRATION HUB (MCP-Style Server)
 * 
 * Central hub for external integrations and webhooks.
 * Enables Silhouette to receive events from:
 * - GitHub (push, PR, issues)
 * - Gmail (new emails via push notifications)
 * - Slack (messages, mentions)
 * - Custom webhooks
 * 
 * All events are normalized and emitted via SystemBus.
 */

import express, { Router, Request, Response } from 'express';
import { SystemProtocol } from '../types';
import { systemBus } from './systemBus';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface IntegrationProvider {
    id: string;
    name: string;
    type: 'GITHUB' | 'GMAIL' | 'SLACK' | 'WEBHOOK' | 'CALENDAR';
    enabled: boolean;
    config: Record<string, any>;
    lastEvent?: number;
    eventCount: number;
}

export interface IntegrationEvent {
    id: string;
    providerId: string;
    providerType: IntegrationProvider['type'];
    eventType: string;
    payload: any;
    timestamp: number;
    processed: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION HUB
// ═══════════════════════════════════════════════════════════════════════════

class IntegrationHub {
    private providers: Map<string, IntegrationProvider> = new Map();
    private recentEvents: IntegrationEvent[] = [];
    private router: Router;

    constructor() {
        this.router = Router();
        this.setupWebhookRoutes();
        this.loadProvidersFromSettings();
    }

    /**
     * Get the Express router for webhook endpoints
     */
    public getRouter(): Router {
        return this.router;
    }

    /**
     * Register a new integration provider
     */
    public registerProvider(provider: Omit<IntegrationProvider, 'eventCount' | 'lastEvent'>): void {
        const fullProvider: IntegrationProvider = {
            ...provider,
            eventCount: 0
        };

        this.providers.set(provider.id, fullProvider);
        console.log(`[INTEGRATION_HUB] ✅ Registered provider: ${provider.name} (${provider.type})`);

        this.persistProviders();
    }

    /**
     * Enable/disable a provider
     */
    public toggleProvider(providerId: string, enabled: boolean): boolean {
        const provider = this.providers.get(providerId);
        if (provider) {
            provider.enabled = enabled;
            this.persistProviders();
            console.log(`[INTEGRATION_HUB] ${enabled ? '🟢' : '🔴'} ${provider.name} is now ${enabled ? 'ENABLED' : 'DISABLED'}`);
            return true;
        }
        return false;
    }

    /**
     * Get all registered providers
     */
    public getProviders(): IntegrationProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Get recent events
     */
    public getRecentEvents(limit: number = 20): IntegrationEvent[] {
        return this.recentEvents.slice(-limit);
    }

    /**
     * Process an incoming event
     */
    public processEvent(providerId: string, eventType: string, payload: any): void {
        const provider = this.providers.get(providerId);

        if (!provider) {
            console.warn(`[INTEGRATION_HUB] ⚠️ Unknown provider: ${providerId}`);
            return;
        }

        if (!provider.enabled) {
            console.log(`[INTEGRATION_HUB] ⏸️ Provider disabled, ignoring event: ${providerId}`);
            return;
        }

        const event: IntegrationEvent = {
            id: crypto.randomUUID(),
            providerId,
            providerType: provider.type,
            eventType,
            payload,
            timestamp: Date.now(),
            processed: false
        };

        // Store event
        this.recentEvents.push(event);
        if (this.recentEvents.length > 100) {
            this.recentEvents.shift();
        }

        // Update provider stats
        provider.lastEvent = event.timestamp;
        provider.eventCount++;

        // Emit to SystemBus for system-wide handling
        systemBus.emit(SystemProtocol.INTEGRATION_EVENT, {
            event,
            provider: provider.name
        }, 'INTEGRATION_HUB');

        console.log(`[INTEGRATION_HUB] 📥 Event received: ${provider.name} → ${eventType}`);

        // Handle specific event types
        this.routeEvent(event);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS
    // ═══════════════════════════════════════════════════════════════════════

    private setupWebhookRoutes(): void {
        // Generic webhook endpoint
        this.router.post('/webhook/:providerId', this.handleWebhook.bind(this));

        // GitHub-specific endpoint
        this.router.post('/github', this.handleGitHubWebhook.bind(this));

        // Gmail push notification endpoint
        this.router.post('/gmail/push', this.handleGmailPush.bind(this));

        // Slack events endpoint
        this.router.post('/slack/events', this.handleSlackEvent.bind(this));

        // Health check
        this.router.get('/health', (req, res) => {
            res.json({
                status: 'online',
                providers: this.providers.size,
                recentEvents: this.recentEvents.length
            });
        });
    }

    private async handleWebhook(req: Request, res: Response): Promise<void> {
        const { providerId } = req.params;
        const eventType = req.headers['x-event-type'] as string || 'GENERIC';

        this.processEvent(providerId, eventType, req.body);
        res.json({ received: true });
    }

    private async handleGitHubWebhook(req: Request, res: Response): Promise<void> {
        const eventType = req.headers['x-github-event'] as string || 'unknown';
        const signature = req.headers['x-hub-signature-256'] as string;

        // Verify signature if secret is configured
        const provider = this.providers.get('github');
        const secret = provider?.config?.webhookSecret;

        if (secret && signature) {
            const crypto = await import('crypto');
            const payload = JSON.stringify(req.body);
            const expectedSignature = 'sha256=' + crypto.createHmac('sha256', secret)
                .update(payload)
                .digest('hex');

            // Timing-safe comparison to prevent timing attacks
            try {
                const sigBuffer = Buffer.from(signature);
                const expBuffer = Buffer.from(expectedSignature);

                if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
                    console.warn('[INTEGRATION_HUB] ⛔ GitHub webhook signature mismatch');
                    res.status(401).send('Invalid signature');
                    return;
                }
            } catch (e) {
                console.warn('[INTEGRATION_HUB] ⛔ Signature verification failed');
                res.status(401).send('Signature verification failed');
                return;
            }
        } else if (secret && !signature) {
            console.warn('[INTEGRATION_HUB] ⛔ Missing signature for configured secret');
            res.status(401).send('Signature required');
            return;
        }

        this.processEvent('github', eventType, req.body);
        res.status(200).send('OK');
    }

    private async handleGmailPush(req: Request, res: Response): Promise<void> {
        // Gmail push notifications use Pub/Sub format
        const message = req.body.message;

        if (message?.data) {
            const decoded = Buffer.from(message.data, 'base64').toString();
            try {
                const data = JSON.parse(decoded);
                this.processEvent('gmail', 'HISTORY_UPDATE', data);
            } catch (e) {
                this.processEvent('gmail', 'RAW_NOTIFICATION', { raw: decoded });
            }
        }

        res.status(200).send('OK');
    }

    private async handleSlackEvent(req: Request, res: Response): Promise<void> {
        const body = req.body;

        // Slack URL verification challenge
        if (body.type === 'url_verification') {
            res.json({ challenge: body.challenge });
            return;
        }

        if (body.event) {
            this.processEvent('slack', body.event.type, body.event);
        }

        res.status(200).send('OK');
    }

    private async routeEvent(event: IntegrationEvent): Promise<void> {
        try {
            switch (event.providerType) {
                case 'GITHUB':
                    await this.handleGitHubEvent(event);
                    break;
                case 'GMAIL':
                    await this.handleGmailEvent(event);
                    break;
                case 'SLACK':
                    await this.handleSlackEventInternal(event);
                    break;
                default:
                    // Generic handling via introspection
                    const { introspection } = await import('./introspectionEngine');
                    introspection.addThought(
                        `External event received: ${event.eventType} from ${event.providerId}`,
                        'INTEGRATION_HUB',
                        0.6
                    );
            }

            event.processed = true;
        } catch (e) {
            console.error(`[INTEGRATION_HUB] ❌ Failed to route event:`, e);
        }
    }

    private async handleGitHubEvent(event: IntegrationEvent): Promise<void> {
        const { introspection } = await import('./introspectionEngine');

        switch (event.eventType) {
            case 'push':
                const commits = event.payload.commits?.length || 0;
                const repo = event.payload.repository?.name;
                introspection.addThought(
                    `GitHub: ${commits} new commit(s) pushed to ${repo}`,
                    'GITHUB',
                    0.7
                );
                break;

            case 'pull_request':
                const action = event.payload.action;
                const prTitle = event.payload.pull_request?.title;
                introspection.addThought(
                    `GitHub: PR "${prTitle}" was ${action}`,
                    'GITHUB',
                    0.8
                );
                break;

            case 'issues':
                const issueAction = event.payload.action;
                const issueTitle = event.payload.issue?.title;
                introspection.addThought(
                    `GitHub: Issue "${issueTitle}" was ${issueAction}`,
                    'GITHUB',
                    0.6
                );
                break;
        }
    }

    private async handleGmailEvent(event: IntegrationEvent): Promise<void> {
        // Trigger Gmail sync when history update is received
        systemBus.emit(SystemProtocol.PROTOCOL_EMAIL_RECEIVED, event.payload, 'INTEGRATION_HUB');
    }

    private async handleSlackEventInternal(event: IntegrationEvent): Promise<void> {
        const { introspection } = await import('./introspectionEngine');

        if (event.eventType === 'app_mention') {
            const text = event.payload.text;
            const user = event.payload.user;

            introspection.addThought(
                `Slack mention from ${user}: "${text}"`,
                'SLACK',
                0.9
            );

            // Could trigger a response workflow here
        }
    }

    private async loadProvidersFromSettings(): Promise<void> {
        try {
            const { settingsManager } = await import('./settingsManager');

            // Register providers based on registered integrations from settings
            const settings = settingsManager.getSettings();
            const integrations = settings.registeredIntegrations || [];

            for (const schema of integrations) {
                const credentials = settings.integrations?.[schema.id] || {};
                this.registerProvider({
                    id: schema.id.toLowerCase(),
                    name: schema.name,
                    type: this.mapKeyToType(schema.id),
                    enabled: Object.keys(credentials).length > 0,
                    config: credentials
                });
            }
        } catch (e) {
            console.warn('[INTEGRATION_HUB] Failed to load providers from settings');
        }

        // Register default providers if none exist
        if (this.providers.size === 0) {
            this.registerProvider({
                id: 'github',
                name: 'GitHub',
                type: 'GITHUB',
                enabled: false,
                config: {}
            });

            this.registerProvider({
                id: 'gmail',
                name: 'Gmail',
                type: 'GMAIL',
                enabled: false,
                config: {}
            });
        }
    }

    private mapKeyToType(key: string): IntegrationProvider['type'] {
        const map: Record<string, IntegrationProvider['type']> = {
            'github': 'GITHUB',
            'gmail': 'GMAIL',
            'slack': 'SLACK',
            'calendar': 'CALENDAR'
        };
        return map[key.toLowerCase()] || 'WEBHOOK';
    }

    private async persistProviders(): Promise<void> {
        // Providers are persisted via settingsManager
        // This is mostly for tracking state changes
    }
}

// Singleton
export const integrationHub = new IntegrationHub();
