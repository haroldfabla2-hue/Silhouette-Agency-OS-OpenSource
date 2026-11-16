import { ResourceScope } from '../server/runtime/resourceScope';
import type { PluginDiscoveryResult } from './plugins/discovery';
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
    private readonly operations=new ResourceScope('integration-hub');
    private initializing?:Promise<void>;
    private initializationState:'NOT_STARTED'|'INITIALIZING'|'READY'|'DEGRADED'|'FAILED'='NOT_STARTED';
    private readonly responseReceipts:Array<{name:string,state:'PENDING'|'FINISHED'|'CLOSED_BEFORE_FINISH'}>=[];
    private pendingPlugins:PluginDiscoveryResult[]=[];
    public getLifecycleStatus(){return {initializationState:this.initializationState,responseReceipts:this.responseReceipts,pendingPlugins:this.pendingPlugins,diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures()};}
    public shutdownLifecycle(){return this.operations.close();}
    public initialize():Promise<void>{
        if(!this.initializing){
            this.initializationState='INITIALIZING';
            this.initializing=this.operations.run('integration-hub-initialize',async()=>{
                try {await this.loadProvidersFromSettings();this.initializationState=this.pendingPlugins.length||this.operations.getDiagnostics().length?'DEGRADED':'READY';}
                catch(error){this.initializationState='FAILED';throw error;}
            });
        }
        return this.initializing;
    }

    private providers: Map<string, IntegrationProvider> = new Map();
    private recentEvents: IntegrationEvent[] = [];
    private router: Router;

    constructor() {
        this.router = Router();
        this.setupWebhookRoutes();
        // No async settings read/custom scan or provider work at construction.
    }

    /**
     * Get the Express router for webhook endpoints
     */
    public getRouter(): Router {
        this.operations.assertWorkAccepted();

        return this.router;
    }

    /**
     * Register a new integration provider
     */
    public registerProvider(provider: Omit<IntegrationProvider, 'eventCount' | 'lastEvent'>): void {
        this.operations.assertWorkAccepted();

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
        this.operations.assertWorkAccepted();

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
        this.operations.assertWorkAccepted();

        return Array.from(this.providers.values());
    }

    /**
     * Get recent events
     */
    public getRecentEvents(limit: number = 20): IntegrationEvent[] {
        this.operations.assertWorkAccepted();

        return this.recentEvents.slice(-limit);
    }

    /**
     * Process an incoming event
     */
    public processEvent(providerId: string, eventType: string, payload: any): void {
        this.operations.assertWorkAccepted();

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
        void this.routeEvent(event).catch(()=>{/* actual task retained by operations */});
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PRIVATE METHODS
    // ═══════════════════════════════════════════════════════════════════════

    private endpoint(name:string,handler:(req:Request,res:Response)=>Promise<void>) {
        return (req:Request,res:Response):void=>{
            // The HTTP server owner must stop new sockets/requests globally.
            // This application owner accepts no new handler work after quiesce.
            if(!this.operations.accepting){res.destroy();return;}
            const receipt:{name:string,state:'PENDING'|'FINISHED'|'CLOSED_BEFORE_FINISH'}={name,state:'PENDING'};
            this.responseReceipts.push(receipt);
            let resolveDone!:()=>void,ended=false;
            const done=new Promise<void>(resolve=>{resolveDone=resolve;});
            let release:()=>Promise<void>=async()=>{};
            const finish=()=>{
                if(ended)return;ended=true;
                receipt.state=res.writableFinished?'FINISHED':'CLOSED_BEFORE_FINISH';
                if(receipt.state==='CLOSED_BEFORE_FINISH')this.operations.recordDiagnostic('integration-response:'+name,new Error('HTTP response closed before finish; client receipt is unverified'),'OPERATION_REJECTED','UNAVAILABLE');
                res.off('finish',finish);res.off('close',finish);
                resolveDone();void release();
            };
            res.once('finish',finish);res.once('close',finish);
            release=this.operations.own({name:'integration-response:'+name,
                stopIntake:()=>{if(!req.complete)req.destroy();},
                close:async()=>{await done;}});
            if(res.writableFinished||res.destroyed)finish();
            void this.operations.run('integration-request:'+name,async()=>{
                try {await handler.call(this,req,res);}
                catch(error){
                    this.operations.recordDiagnostic('integration-request:'+name,error,'OPERATION_REJECTED','UNAVAILABLE');
                    if(!res.headersSent&&!res.destroyed)res.status(500).json({error:'Integration request failed'});
                    else if(!res.destroyed)res.destroy();
                }
            }).catch(error=>{
                this.operations.recordFailure('integration-request-admission:'+name,error);
                if(!res.destroyed)res.destroy();
            });
        };
    }
    private setupWebhookRoutes(): void {
        // Generic webhook endpoint
        this.router.post('/webhook/:providerId', this.endpoint('generic-webhook',this.handleWebhook));

        // GitHub-specific endpoint
        this.router.post('/github', this.endpoint('github-webhook',this.handleGitHubWebhook));

        // Gmail push notification endpoint
        this.router.post('/gmail/push', this.endpoint('gmail-webhook',this.handleGmailPush));

        // Slack events endpoint
        this.router.post('/slack/events', this.endpoint('slack-webhook',this.handleSlackEvent));

        // Health check
        this.router.get('/health', this.endpoint('integration-health',async(req,res)=>{
            res.json({
                status:this.initializationState,
                pendingCustomPlugins:this.pendingPlugins.length,
                providers: this.providers.size,
                recentEvents: this.recentEvents.length
            });
        }));
    }

    private async handleWebhook(req: Request, res: Response): Promise<void> {
        return this.operations.run('handleWebhook',async()=>{

        const { providerId } = req.params;
        const eventType = req.headers['x-event-type'] as string || 'GENERIC';

        this.processEvent(providerId, eventType, req.body);
        res.json({ received: true });
    
        });
    }

    private async handleGitHubWebhook(req: Request, res: Response): Promise<void> {
        return this.operations.run('handleGitHubWebhook',async()=>{

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
            this.operations.recordDiagnostic('handleGitHubWebhook',e,'DEGRADED_FALLBACK','UNVERIFIED');

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
    
        });
    }

    private async handleGmailPush(req: Request, res: Response): Promise<void> {
        return this.operations.run('handleGmailPush',async()=>{

        // Gmail push notifications use Pub/Sub format
        const message = req.body.message;

        if (message?.data) {
            const decoded = Buffer.from(message.data, 'base64').toString();
            try {
                const data = JSON.parse(decoded);
                this.processEvent('gmail', 'HISTORY_UPDATE', data);
            } catch (e) {
            this.operations.recordDiagnostic('handleGmailPush',e,'DEGRADED_FALLBACK','UNVERIFIED');

                this.processEvent('gmail', 'RAW_NOTIFICATION', { raw: decoded });
            }
        }

        res.status(200).send('OK');
    
        });
    }

    private async handleSlackEvent(req: Request, res: Response): Promise<void> {
        return this.operations.run('handleSlackEvent',async()=>{

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
    
        });
    }

    private async routeEvent(event: IntegrationEvent): Promise<void> {
        return this.operations.run('routeEvent',async()=>{

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
            this.operations.recordDiagnostic('routeEvent',e,'DEGRADED_FALLBACK','UNVERIFIED');

            console.error(`[INTEGRATION_HUB] ❌ Failed to route event:`, e);
        }
    
        });
    }

    private async handleGitHubEvent(event: IntegrationEvent): Promise<void> {
        return this.operations.run('handleGitHubEvent',async()=>{

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
    
        });
    }

    private async handleGmailEvent(event: IntegrationEvent): Promise<void> {
        return this.operations.run('handleGmailEvent',async()=>{

        // Trigger Gmail sync when history update is received
        systemBus.emit(SystemProtocol.PROTOCOL_EMAIL_RECEIVED, event.payload, 'INTEGRATION_HUB');
    
        });
    }

    private async handleSlackEventInternal(event: IntegrationEvent): Promise<void> {
        return this.operations.run('handleSlackEventInternal',async()=>{

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
    
        });
    }

    private async loadProvidersFromSettings(): Promise<void> {
        return this.operations.run('loadProvidersFromSettings',async()=>{

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
            this.operations.recordDiagnostic('loadProvidersFromSettings',e,'DEGRADED_FALLBACK','UNVERIFIED');

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

        // [R12] DYNAMIC INTEGRATIONS: real discovery/validation/load of custom
        // plugins via ESM (the old require() scan broke under "type": "module"
        // and only registered inert descriptors). Valid plugins load for real
        // through the PluginRegistry; invalid files stay DEACTIVATED with a
        // reason. Provider entries are never auto-enabled: activation is
        // explicit opt-in via config/plugins.json.
        try {
            const { discoverCustomPlugins } = await import('./plugins/discovery');
            const results = await discoverCustomPlugins();
            this.pendingPlugins=results.filter(r=>r.status==='PENDING_EVALUATION');

            for(const result of results) {
                const id=result.file.replace(/\.(ts|js)$/,'').toLowerCase();
                if(!this.providers.has(id))this.registerProvider({id,name:`${id} (Dynamic, ${result.status==='PENDING_EVALUATION'?'pending evaluation':'deactivated'})`,type:'WEBHOOK',enabled:false,
                    config:{source:'custom-plugin',file:result.file,sourceIdentity:result.source,status:result.status,reason:result.reason,evaluation:result.evaluation,activation:result.activation}});
                this.operations.recordDiagnostic('custom-plugin:'+result.file,new Error(result.reason),'UNCLASSIFIED','UNVERIFIED');
            }
        } catch (scanErr: any) {
            this.operations.recordDiagnostic('loadProvidersFromSettings',scanErr,'DEGRADED_FALLBACK','UNVERIFIED');

            console.warn('[INTEGRATION_HUB] Dynamic custom plugin scan failed:', scanErr.message);
        }
    
        });
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
        return this.operations.run('persistProviders',async()=>{

        // Providers are persisted via settingsManager
        // This is mostly for tracking state changes
    
        });
    }
}

// Singleton
export const integrationHub = new IntegrationHub();
