/**
 * INTEGRATION ARCHITECT - Dynamic Integration Discovery & Creation
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Enables Silhouette to autonomously discover, research, and implement
 * new integrations based on user requests.
 * 
 * Flow:
 * 1. User requests capability (e.g., "respond to WhatsApp")
 * 2. Architect analyzes request → identifies integration type
 * 3. Researches API documentation online
 * 4. Generates integration blueprint
 * 5. Requests human approval (Human-in-Loop)
 * 6. Creates: UI fields, tools, webhooks, and optionally PR
 */

import { SystemProtocol } from '../types';
import { systemBus } from './systemBus';
import { backgroundLLM } from './backgroundLLMService';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface IntegrationRequest {
    userRequest: string;
    source: 'CHAT' | 'SYSTEM' | 'AGENT';
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    timestamp: number;
}

export interface CredentialField {
    key: string;           // Environment variable name (e.g., TWILIO_ACCOUNT_SID)
    label: string;         // Human-readable label
    type: 'text' | 'password' | 'url' | 'number';
    required: boolean;
    placeholder?: string;
    helpUrl?: string;      // Link to documentation
    validation?: string;   // Regex pattern
}

export interface ToolBlueprint {
    name: string;
    description: string;
    category: 'MESSAGING' | 'DATA' | 'MEDIA' | 'WORKFLOW' | 'DEV';
    parameters: {
        name: string;
        type: string;
        description: string;
        required: boolean;
    }[];
    implementation: 'API_CALL' | 'WEBHOOK' | 'COMPOSED';
    apiEndpoint?: string;
    httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

export interface WebhookConfig {
    path: string;          // e.g., "/webhooks/whatsapp"
    eventTypes: string[];  // Events this webhook handles
    signatureHeader?: string;
    signatureSecret?: string;
}

export interface IntegrationBlueprint {
    id: string;
    name: string;           // e.g., "whatsapp"
    displayName: string;    // e.g., "WhatsApp Business"
    description: string;
    provider: string;       // e.g., "twilio", "meta", "custom"
    category: 'MESSAGING' | 'EMAIL' | 'CALENDAR' | 'STORAGE' | 'SOCIAL' | 'DEV' | 'CUSTOM';

    // Authentication
    authType: 'API_KEY' | 'OAUTH2' | 'WEBHOOK_SECRET' | 'BEARER_TOKEN';
    credentials: CredentialField[];

    // Capabilities
    tools: ToolBlueprint[];
    webhook?: WebhookConfig;

    // Metadata
    documentation: string;
    estimatedSetupTime: string;
    createdAt: number;
    status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'ACTIVE' | 'FAILED';
}

export interface ResearchResult {
    platform: string;
    providers: {
        name: string;
        apiDocs: string;
        authMethod: string;
        popularity: number;
    }[];
    recommendedProvider: string;
    requiredCapabilities: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION ARCHITECT
// ═══════════════════════════════════════════════════════════════════════════

class IntegrationArchitect {
    private static instance: IntegrationArchitect;
    private pendingBlueprints: Map<string, IntegrationBlueprint> = new Map();
    private activeBlueprints: Map<string, IntegrationBlueprint> = new Map();
    private maxDynamicIntegrations = 10;

    private constructor() {
        this.loadFromStorage();
    }

    public static getInstance(): IntegrationArchitect {
        if (!IntegrationArchitect.instance) {
            IntegrationArchitect.instance = new IntegrationArchitect();
        }
        return IntegrationArchitect.instance;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MAIN FLOW
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Analyze a user request and determine what integration is needed
     */
    public async analyzeRequest(request: IntegrationRequest): Promise<{
        needsIntegration: boolean;
        integrationType?: string;
        platform?: string;
        capabilities?: string[];
        existingIntegration?: string;
    }> {
        console.log(`[INTEGRATION_ARCHITECT] 🔍 Analyzing: "${request.userRequest.substring(0, 50)}..."`);

        const prompt = `Analyze this user request and determine if it requires a new integration:

User Request: "${request.userRequest}"

Current available integrations: GitHub, Gmail, Slack, Google Calendar, Google Drive

Respond with JSON:
{
    "needsIntegration": true/false,
    "integrationType": "MESSAGING|EMAIL|CALENDAR|STORAGE|SOCIAL|DEV|CUSTOM" or null,
    "platform": "whatsapp|telegram|discord|notion|etc" or null,
    "capabilities": ["send_message", "receive_message", "read_data", etc] or [],
    "existingIntegration": "name of existing integration if applicable" or null,
    "reasoning": "brief explanation"
}`;

        try {
            const response = await backgroundLLM.generate(
                prompt,
                { maxTokens: 500, taskType: 'ANALYSIS' }
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);
                console.log(`[INTEGRATION_ARCHITECT] 📊 Analysis result:`, result);
                return result;
            }
        } catch (e) {
            console.error('[INTEGRATION_ARCHITECT] Analysis failed:', e);
        }

        return { needsIntegration: false };
    }

    /**
     * Research an integration platform and available providers
     */
    public async researchIntegration(platform: string, capabilities: string[]): Promise<ResearchResult> {
        console.log(`[INTEGRATION_ARCHITECT] 📚 Researching: ${platform}`);

        const prompt = `Research the "${platform}" platform for API integration.

Required capabilities: ${capabilities.join(', ')}

I need information about:
1. Available API providers (official and third-party)
2. Authentication methods
3. API documentation URLs
4. Ease of integration

Respond with JSON:
{
    "platform": "${platform}",
    "providers": [
        {
            "name": "provider name",
            "apiDocs": "URL to documentation",
            "authMethod": "API_KEY|OAUTH2|BEARER_TOKEN|WEBHOOK_SECRET",
            "popularity": 1-10
        }
    ],
    "recommendedProvider": "name of best provider",
    "requiredCapabilities": ["capability1", "capability2"]
}`;

        try {
            const response = await backgroundLLM.generate(
                prompt,
                { maxTokens: 1000, taskType: 'ANALYSIS' }
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('[INTEGRATION_ARCHITECT] Research failed:', e);
        }

        // Fallback with common patterns
        return this.getDefaultResearch(platform);
    }

    /**
     * Generate a complete integration blueprint
     */
    public async generateBlueprint(
        platform: string,
        research: ResearchResult,
        capabilities: string[]
    ): Promise<IntegrationBlueprint> {
        console.log(`[INTEGRATION_ARCHITECT] 🏗️ Generating blueprint for: ${platform}`);

        const provider = research.providers.find(p => p.name === research.recommendedProvider)
            || research.providers[0];

        const prompt = `Generate a complete integration blueprint for ${platform} using ${provider.name}.

Required capabilities: ${capabilities.join(', ')}
Auth method: ${provider.authMethod}
API Docs: ${provider.apiDocs}

Generate JSON with:
1. Required credential fields (API keys, secrets, etc.)
2. Tools to create (with full parameter definitions)
3. Webhook configuration if needed

Response format:
{
    "credentials": [
        { "key": "ENV_VAR_NAME", "label": "Human Label", "type": "text|password", "required": true, "placeholder": "xxx", "helpUrl": "url" }
    ],
    "tools": [
        {
            "name": "tool_name",
            "description": "What it does",
            "category": "MESSAGING|DATA|MEDIA|WORKFLOW|DEV",
            "parameters": [{ "name": "param", "type": "string", "description": "desc", "required": true }],
            "implementation": "API_CALL",
            "apiEndpoint": "/v1/messages",
            "httpMethod": "POST"
        }
    ],
    "webhook": { "path": "/webhooks/${platform}", "eventTypes": ["message", "status"], "signatureHeader": "X-Signature" } or null,
    "documentation": "Brief setup instructions"
}`;

        try {
            const response = await backgroundLLM.generate(
                prompt,
                { maxTokens: 2000, taskType: 'CODE' }
            );

            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const generated = JSON.parse(jsonMatch[0]);

                const blueprint: IntegrationBlueprint = {
                    id: `integration_${platform}_${Date.now()}`,
                    name: platform.toLowerCase().replace(/\s+/g, '_'),
                    displayName: this.formatDisplayName(platform),
                    description: `Integration with ${this.formatDisplayName(platform)} via ${provider.name}`,
                    provider: provider.name.toLowerCase(),
                    category: this.inferCategory(platform, capabilities),
                    authType: provider.authMethod as any,
                    credentials: generated.credentials || [],
                    tools: generated.tools || [],
                    webhook: generated.webhook,
                    documentation: generated.documentation || '',
                    estimatedSetupTime: '5-10 minutes',
                    createdAt: Date.now(),
                    status: 'DRAFT'
                };

                this.pendingBlueprints.set(blueprint.id, blueprint);
                return blueprint;
            }
        } catch (e) {
            console.error('[INTEGRATION_ARCHITECT] Blueprint generation failed:', e);
        }

        throw new Error(`Failed to generate blueprint for ${platform}`);
    }

    /**
     * Request human approval for an integration
     */
    public async requestApproval(blueprint: IntegrationBlueprint): Promise<string> {
        blueprint.status = 'PENDING_APPROVAL';
        this.pendingBlueprints.set(blueprint.id, blueprint);

        // Emit confirmation required event
        systemBus.emit(SystemProtocol.CONFIRMATION_REQUIRED, {
            type: 'INTEGRATION_APPROVAL',
            blueprintId: blueprint.id,
            summary: `New integration: ${blueprint.displayName}`,
            details: {
                provider: blueprint.provider,
                credentialsNeeded: blueprint.credentials.map(c => c.label),
                toolsToCreate: blueprint.tools.map(t => t.name),
                hasWebhook: !!blueprint.webhook
            },
            riskLevel: 'MEDIUM',
            expiresAt: Date.now() + 3600000 // 1 hour
        }, 'INTEGRATION_ARCHITECT');

        console.log(`[INTEGRATION_ARCHITECT] 📝 Approval requested for: ${blueprint.displayName}`);
        return blueprint.id;
    }

    /**
     * Approve and execute integration setup
     */
    public async approveAndExecute(blueprintId: string): Promise<boolean> {
        const blueprint = this.pendingBlueprints.get(blueprintId);
        if (!blueprint) {
            console.error(`[INTEGRATION_ARCHITECT] Blueprint not found: ${blueprintId}`);
            return false;
        }

        if (this.activeBlueprints.size >= this.maxDynamicIntegrations) {
            console.error('[INTEGRATION_ARCHITECT] Max dynamic integrations reached');
            return false;
        }

        console.log(`[INTEGRATION_ARCHITECT] ✅ Executing integration: ${blueprint.displayName}`);

        try {
            // 1. Register integration schema in settings
            await this.registerIntegrationSchema(blueprint);

            // 2. Create tools
            await this.createTools(blueprint);

            // 3. Register webhook if needed
            if (blueprint.webhook) {
                await this.registerWebhook(blueprint);
            }

            // 4. Update status
            blueprint.status = 'ACTIVE';
            this.activeBlueprints.set(blueprint.id, blueprint);
            this.pendingBlueprints.delete(blueprint.id);

            // 5. Persist
            await this.saveToStorage();

            // 6. Create Pull Request for code persistence (Human-in-Loop Safety)
            try {
                const { gitIntegration } = await import('./gitIntegration');
                if (gitIntegration.getStatus().configured) {
                    const prBody = `## Integration: ${blueprint.displayName}\n\n${blueprint.description}\n\n### Capabilities added:\n${blueprint.tools.map(t => `- ${t.name}`).join('\n')}\n\n### Setup:\n- [ ] Configure secrets: ${blueprint.credentials.map(c => c.key).join(', ')}`;

                    await gitIntegration.createPR({
                        title: `feat(integration): Add ${blueprint.displayName}`,
                        body: prBody,
                        branchName: `integration/${blueprint.name}-${Date.now()}`,
                        files: this.generateIntegrationFiles(blueprint)
                    });
                    console.log(`[INTEGRATION_ARCHITECT] 🐙 PR created for: ${blueprint.displayName}`);
                }
            } catch (prError) {
                console.warn('[INTEGRATION_ARCHITECT] Failed to create PR (continuing runtime only):', prError);
            }

            // 7. Emit success event
            systemBus.emit(SystemProtocol.INTEGRATION_EVENT, {
                type: 'INTEGRATION_CREATED',
                integration: blueprint.name,
                displayName: blueprint.displayName
            }, 'INTEGRATION_ARCHITECT');

            console.log(`[INTEGRATION_ARCHITECT] 🎉 Integration active: ${blueprint.displayName}`);
            return true;

        } catch (e) {
            console.error('[INTEGRATION_ARCHITECT] Execution failed:', e);
            blueprint.status = 'FAILED';
            return false;
        }
    }

    private generateIntegrationFiles(blueprint: IntegrationBlueprint): { path: string, content: string, message: string }[] {
        const files = [];

        // 1. Tool Definitions
        for (const tool of blueprint.tools) {
            files.push({
                path: `services/tools/${blueprint.name}/${tool.name}.ts`,
                content: this.generateToolCode(blueprint, tool),
                message: `Add ${tool.name} tool for ${blueprint.displayName}`
            });
        }

        // 2. Blueprint JSON (for persistence)
        files.push({
            path: `config/integrations/${blueprint.name}.json`,
            content: JSON.stringify(blueprint, null, 2),
            message: `Add configuration for ${blueprint.displayName}`
        });

        return files;
    }

    /**
     * Reject an integration blueprint
     */
    public rejectBlueprint(blueprintId: string): boolean {
        const deleted = this.pendingBlueprints.delete(blueprintId);
        if (deleted) {
            console.log(`[INTEGRATION_ARCHITECT] ❌ Blueprint rejected: ${blueprintId}`);
        }
        return deleted;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EXECUTION HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    private async registerIntegrationSchema(blueprint: IntegrationBlueprint): Promise<void> {
        const { settingsManager } = await import('./settingsManager');


        const schema = {
            id: blueprint.name,
            name: blueprint.displayName,
            description: blueprint.description,
            category: 'INTEGRATION' as any, // Cast to avoid TS error until types sync
            authType: blueprint.authType,
            fields: blueprint.credentials.map(c => ({
                key: c.key,
                label: c.label,
                type: c.type === 'password' ? 'password' as const : 'text' as const,
                placeholder: c.placeholder || '',
                required: c.required,
                description: c.helpUrl ? `See documentation: ${c.helpUrl}` : undefined
            })),
            isConnected: false,
            documentationUrl: blueprint.documentation
        };

        settingsManager.registerIntegrationSchema(schema);
        console.log(`[INTEGRATION_ARCHITECT] 📋 Schema registered: ${blueprint.name}`);
    }

    private async createTools(blueprint: IntegrationBlueprint): Promise<void> {
        const { toolFactory } = await import('./tools/toolFactory');

        for (const toolBlueprint of blueprint.tools) {
            try {
                await toolFactory.createTool({
                    name: toolBlueprint.name,
                    purpose: toolBlueprint.description,
                    category: toolBlueprint.category as any,
                    inputs: toolBlueprint.parameters.map(p => ({
                        name: p.name,
                        type: p.type as any,
                        description: p.description,
                        required: p.required
                    })),
                    output: `Result of ${toolBlueprint.name}`,
                    implementation: 'CODE',
                    code: this.generateToolCode(blueprint, toolBlueprint),
                    tags: [blueprint.name, blueprint.provider, 'auto-generated']
                });

                console.log(`[INTEGRATION_ARCHITECT] 🔧 Tool created: ${toolBlueprint.name}`);
            } catch (e) {
                console.error(`[INTEGRATION_ARCHITECT] Failed to create tool: ${toolBlueprint.name}`, e);
            }
        }
    }

    private generateToolCode(blueprint: IntegrationBlueprint, tool: ToolBlueprint): string {
        // Generate basic implementation code
        const credentialRefs = blueprint.credentials.map(c =>
            `const ${c.key.toLowerCase()} = process.env.${c.key};`
        ).join('\n');

        return `
// Auto-generated tool for ${blueprint.displayName}
${credentialRefs}

async function handler(args) {
    const response = await fetch('${tool.apiEndpoint || 'https://api.example.com'}', {
        method: '${tool.httpMethod || 'POST'}',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (process.env.${blueprint.credentials[0]?.key} || '')
        },
        body: JSON.stringify(args)
    });
    
    if (!response.ok) {
        throw new Error('API call failed: ' + response.statusText);
    }
    
    return await response.json();
}

return handler(args);
`;
    }

    private async registerWebhook(blueprint: IntegrationBlueprint): Promise<void> {
        const { integrationHub } = await import('./integrationHub');

        integrationHub.registerProvider({
            id: blueprint.name,
            name: blueprint.displayName,
            type: 'WEBHOOK',
            enabled: true,
            config: {
                webhookPath: blueprint.webhook?.path,
                eventTypes: blueprint.webhook?.eventTypes,
                signatureHeader: blueprint.webhook?.signatureHeader
            }
        });

        console.log(`[INTEGRATION_ARCHITECT] 🔗 Webhook registered: ${blueprint.webhook?.path}`);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STORAGE
    // ═══════════════════════════════════════════════════════════════════════

    private async loadFromStorage(): Promise<void> {
        try {
            const { sqliteService } = await import('./sqliteService');
            const stored = await sqliteService.getConfig('integration_blueprints');

            if (stored) {
                const blueprints = JSON.parse(stored);
                for (const bp of blueprints) {
                    if (bp.status === 'ACTIVE') {
                        this.activeBlueprints.set(bp.id, bp);
                    } else if (bp.status === 'PENDING_APPROVAL') {
                        this.pendingBlueprints.set(bp.id, bp);
                    }
                }
                console.log(`[INTEGRATION_ARCHITECT] 📂 Loaded ${this.activeBlueprints.size} active integrations`);
            }
        } catch (e) {
            console.warn('[INTEGRATION_ARCHITECT] Failed to load from storage');
        }
    }

    private async saveToStorage(): Promise<void> {
        try {
            const { sqliteService } = await import('./sqliteService');
            const allBlueprints = [
                ...Array.from(this.activeBlueprints.values()),
                ...Array.from(this.pendingBlueprints.values())
            ];
            await sqliteService.setConfig('integration_blueprints', JSON.stringify(allBlueprints));
        } catch (e) {
            console.error('[INTEGRATION_ARCHITECT] Failed to save to storage');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════

    private formatDisplayName(platform: string): string {
        return platform.split(/[_\s]+/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    }

    private inferCategory(platform: string, capabilities: string[]): IntegrationBlueprint['category'] {
        const lower = platform.toLowerCase();
        if (['whatsapp', 'telegram', 'discord', 'slack', 'teams'].some(p => lower.includes(p))) {
            return 'MESSAGING';
        }
        if (['gmail', 'outlook', 'email'].some(p => lower.includes(p))) {
            return 'EMAIL';
        }
        if (['calendar', 'schedule'].some(p => lower.includes(p))) {
            return 'CALENDAR';
        }
        if (['drive', 'dropbox', 'storage', 's3'].some(p => lower.includes(p))) {
            return 'STORAGE';
        }
        if (['twitter', 'facebook', 'instagram', 'linkedin'].some(p => lower.includes(p))) {
            return 'SOCIAL';
        }
        if (['github', 'gitlab', 'bitbucket', 'jira'].some(p => lower.includes(p))) {
            return 'DEV';
        }
        return 'CUSTOM';
    }

    private getDefaultResearch(platform: string): ResearchResult {
        return {
            platform,
            providers: [{
                name: `${platform} API`,
                apiDocs: `https://developers.${platform.toLowerCase()}.com`,
                authMethod: 'API_KEY',
                popularity: 5
            }],
            recommendedProvider: `${platform} API`,
            requiredCapabilities: ['read', 'write']
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC GETTERS
    // ═══════════════════════════════════════════════════════════════════════

    public getPendingBlueprints(): IntegrationBlueprint[] {
        return Array.from(this.pendingBlueprints.values());
    }

    public getActiveBlueprints(): IntegrationBlueprint[] {
        return Array.from(this.activeBlueprints.values());
    }

    public getBlueprint(id: string): IntegrationBlueprint | undefined {
        return this.pendingBlueprints.get(id) || this.activeBlueprints.get(id);
    }

    public getStats(): {
        active: number;
        pending: number;
        maxAllowed: number;
    } {
        return {
            active: this.activeBlueprints.size,
            pending: this.pendingBlueprints.size,
            maxAllowed: this.maxDynamicIntegrations
        };
    }
}

export const integrationArchitect = IntegrationArchitect.getInstance();
