/**
 * TOOL REGISTRY - Dynamic Tool Management System
 * 
 * Enables Silhouette to:
 * 1. Load tools dynamically at runtime
 * 2. Register new tools created by ToolFactory
 * 3. Track usage metrics for tool optimization
 * 4. Enable/disable tools without code changes
 * 
 * Part of the Self-Extending Tool System (Phase 1)
 */

import { FunctionDeclaration, Type } from "@google/genai";
import { systemBus } from "../systemBus";
import { SystemProtocol } from "../../types";

// ==================== INTERFACES ====================

export interface DynamicTool {
    id: string;
    name: string;
    description: string;
    parameters: FunctionDeclarationSchema;
    handler: ToolHandler;
    category: ToolCategory;
    createdBy: 'SYSTEM' | 'USER' | 'SILHOUETTE';
    enabled: boolean;
    usageCount: number;
    successCount: number;
    lastUsed?: number;
    createdAt: number;
    version: string;
    tags?: string[];
}

export interface FunctionDeclarationSchema {
    type: string;
    properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
        items?: any;
    }>;
    required?: string[];
}

export type ToolHandler =
    | { type: 'BUILTIN'; handlerName: string }
    | { type: 'COMPOSED'; steps: ComposedStep[] }
    | { type: 'CODE'; code: string; sandbox: boolean };

export interface ComposedStep {
    toolName: string;
    inputMapping: Record<string, string>; // target param -> source expression
    outputAs?: string; // Store result as variable
}

export type ToolCategory =
    | 'MEDIA'      // Image, video, audio generation
    | 'RESEARCH'   // Web search, academic search
    | 'ASSET'      // Asset management
    | 'WORKFLOW'   // Campaign, paper generation
    | 'UTILITY'    // Helper tools
    | 'META'       // Tools that create tools
    | 'DEV'        // Development tools (GitHub, etc)
    | 'COMMUNICATION'; // Email, messaging

// ==================== TOOL REGISTRY ====================

class ToolRegistry {
    private static instance: ToolRegistry;
    private tools: Map<string, DynamicTool> = new Map();
    private initialized: boolean = false;

    private constructor() { }

    public static getInstance(): ToolRegistry {
        if (!ToolRegistry.instance) {
            ToolRegistry.instance = new ToolRegistry();
        }
        return ToolRegistry.instance;
    }

    /**
     * Initialize registry with built-in tools
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('[ToolRegistry] 🔧 Initializing dynamic tool registry...');

        // Load built-in tools
        await this.loadBuiltinTools();

        // Load persisted dynamic tools
        await this.loadPersistedTools();

        this.initialized = true;
        console.log(`[ToolRegistry] ✅ Loaded ${this.tools.size} tools`);
    }

    /**
     * Load built-in static tools from definitions
     */
    private async loadBuiltinTools(): Promise<void> {
        const {
            GENERATE_VIDEO_TOOL,
            GENERATE_IMAGE_TOOL,
            LIST_VISUAL_ASSETS_TOOL,
            DELEGATE_TASK_TOOL,
            SEARCH_ASSETS_TOOL,
            MANAGE_ASSET_TOOL,
            PREVIEW_ASSET_TOOL,
            WEB_SEARCH_TOOL,
            ACADEMIC_SEARCH_TOOL,
            CONDUCT_RESEARCH_TOOL,
            // GitHub Tools
            GITHUB_CREATE_PR_TOOL,
            GITHUB_LIST_PRS_TOOL,
            GITHUB_CHECK_PR_TOOL,
            ARCHITECT_AUDIT_TOOL
        } = await import('./definitions');

        // Convert static declarations to DynamicTool format
        const builtinTools: Partial<DynamicTool>[] = [
            {
                id: 'tool_architect_audit',
                name: 'architect_audit',
                description: ARCHITECT_AUDIT_TOOL.description || '',
                parameters: ARCHITECT_AUDIT_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleArchitectAudit' },
                category: 'DEV'
            },
            {
                id: 'tool_generate_video',
                name: 'generate_video',
                description: GENERATE_VIDEO_TOOL.description || '',
                parameters: GENERATE_VIDEO_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleGenerateVideo' },
                category: 'MEDIA'
            },
            {
                id: 'tool_generate_image',
                name: 'generate_image',
                description: GENERATE_IMAGE_TOOL.description || '',
                parameters: GENERATE_IMAGE_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleGenerateImage' },
                category: 'MEDIA'
            },
            {
                id: 'tool_list_visual_assets',
                name: 'list_visual_assets',
                description: LIST_VISUAL_ASSETS_TOOL.description || '',
                parameters: LIST_VISUAL_ASSETS_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleListVisualAssets' },
                category: 'ASSET'
            },
            {
                id: 'tool_delegate_task',
                name: 'delegate_task',
                description: DELEGATE_TASK_TOOL.description || '',
                parameters: DELEGATE_TASK_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleDelegateTask' },
                category: 'WORKFLOW'
            },
            {
                id: 'tool_search_assets',
                name: 'search_assets',
                description: SEARCH_ASSETS_TOOL.description || '',
                parameters: SEARCH_ASSETS_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleSearchAssets' },
                category: 'ASSET'
            },
            {
                id: 'tool_manage_asset',
                name: 'manage_asset',
                description: MANAGE_ASSET_TOOL.description || '',
                parameters: MANAGE_ASSET_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleManageAsset' },
                category: 'ASSET'
            },
            {
                id: 'tool_preview_asset',
                name: 'preview_asset',
                description: PREVIEW_ASSET_TOOL.description || '',
                parameters: PREVIEW_ASSET_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handlePreviewAsset' },
                category: 'ASSET'
            },
            {
                id: 'tool_web_search',
                name: 'web_search',
                description: WEB_SEARCH_TOOL.description || '',
                parameters: WEB_SEARCH_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleWebSearch' },
                category: 'RESEARCH'
            },
            {
                id: 'tool_academic_search',
                name: 'academic_search',
                description: ACADEMIC_SEARCH_TOOL.description || '',
                parameters: ACADEMIC_SEARCH_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleAcademicSearch' },
                category: 'RESEARCH'
            },
            {
                id: 'tool_conduct_research',
                name: 'conduct_research',
                description: CONDUCT_RESEARCH_TOOL.description || '',
                parameters: CONDUCT_RESEARCH_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleConductResearch' },
                category: 'RESEARCH'
            },
            // GitHub Tools
            {
                id: 'tool_github_create_pr',
                name: 'github_create_pr',
                description: GITHUB_CREATE_PR_TOOL.description || '',
                parameters: GITHUB_CREATE_PR_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleGitHubCreatePR' },
                category: 'DEV'
            },
            {
                id: 'tool_github_list_prs',
                name: 'github_list_prs',
                description: GITHUB_LIST_PRS_TOOL.description || '',
                parameters: GITHUB_LIST_PRS_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleGitHubListPRs' },
                category: 'DEV'
            },
            {
                id: 'tool_github_check_pr',
                name: 'github_check_pr',
                description: GITHUB_CHECK_PR_TOOL.description || '',
                parameters: GITHUB_CHECK_PR_TOOL.parameters as unknown as FunctionDeclarationSchema,
                handler: { type: 'BUILTIN', handlerName: 'handleGitHubCheckPR' },
                category: 'DEV'
            },
            // Communication Tools (Gmail)
            {
                id: 'tool_send_email',
                name: 'send_email',
                description: 'Sends an email from the authenticated Gmail account. Can include Drive links.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        to: { type: 'STRING', description: 'Recipient email address' },
                        subject: { type: 'STRING', description: 'Email subject line' },
                        body: { type: 'STRING', description: 'Email body content' },
                        driveLink: { type: 'STRING', description: 'Optional Google Drive link to include' }
                    },
                    required: ['to', 'subject', 'body']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleSendEmail' },
                category: 'COMMUNICATION'
            },
            {
                id: 'tool_read_inbox',
                name: 'read_inbox',
                description: 'Reads emails from the Gmail inbox. Can search by query.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        limit: { type: 'NUMBER', description: 'Max emails to return (default 10)' },
                        query: { type: 'STRING', description: 'Search query (e.g. "from:client@example.com")' }
                    }
                },
                handler: { type: 'BUILTIN', handlerName: 'handleReadInbox' },
                category: 'COMMUNICATION'
            },
            // Production Video Tools (Long-form Video Pipeline)
            {
                id: 'tool_start_video_production',
                name: 'start_video_production',
                description: 'Start a full video production pipeline for long-form videos. Creates storyboard, generates consistent characters, produces clips with transitions, and composes the final video.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        brief: { type: 'STRING', description: 'Creative brief describing the video content' },
                        target_minutes: { type: 'NUMBER', description: 'Target duration in minutes (0.5 to 120)' },
                        platform: { type: 'STRING', description: 'Target platform: youtube, reels, tiktok, cinema, ad, documentary' }
                    },
                    required: ['brief', 'target_minutes']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleStartVideoProduction' },
                category: 'MEDIA'
            },
            {
                id: 'tool_get_production_status',
                name: 'get_production_status',
                description: 'Get the current status and progress of a video production project.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        project_id: { type: 'STRING', description: 'The production project ID' }
                    },
                    required: ['project_id']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleGetProductionStatus' },
                category: 'MEDIA'
            },
            {
                id: 'tool_list_productions',
                name: 'list_productions',
                description: 'List all video production projects with their status.',
                parameters: {
                    type: 'OBJECT',
                    properties: {}
                },
                handler: { type: 'BUILTIN', handlerName: 'handleListProductions' },
                category: 'MEDIA'
            },
            // ==================== DEVELOPMENT TOOLS (Antigravity Parity) ====================
            // Filesystem Tools
            {
                id: 'tool_read_file',
                name: 'read_file',
                description: 'Read the contents of a file from the filesystem. Use to examine code, documents, or data files.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        path: { type: 'STRING', description: 'Absolute or relative path to the file to read.' }
                    },
                    required: ['path']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleReadFile' },
                category: 'DEV'
            },
            {
                id: 'tool_write_file',
                name: 'write_file',
                description: 'Write content to a file. Creates the file if it does not exist.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        path: { type: 'STRING', description: 'Absolute or relative path to the file to write.' },
                        content: { type: 'STRING', description: 'The content to write to the file.' },
                        create_dirs: { type: 'BOOLEAN', description: 'Create parent directories if they do not exist. Default: true.' }
                    },
                    required: ['path', 'content']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleWriteFile' },
                category: 'DEV'
            },
            {
                id: 'tool_list_files',
                name: 'list_files',
                description: 'List files and directories in a given path. Use to explore project structure.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        directory: { type: 'STRING', description: 'Path to the directory to list.' },
                        pattern: { type: 'STRING', description: 'Optional glob pattern to filter files.' },
                        recursive: { type: 'BOOLEAN', description: 'List files recursively. Default: false.' }
                    },
                    required: ['directory']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleListFiles' },
                category: 'DEV'
            },
            // Workspace Tools
            {
                id: 'tool_workspace_create',
                name: 'workspace_create',
                description: 'Create a new document in the Dynamic Workspace for reports, plans, or structured content.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        title: { type: 'STRING', description: 'Title of the document.' },
                        content: { type: 'STRING', description: 'Initial content (Markdown supported).' },
                        format: { type: 'STRING', description: 'Document format: markdown, code, document, presentation.' },
                        tags: { type: 'ARRAY', description: 'Tags for organizing the document.' }
                    },
                    required: ['title', 'content']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleWorkspaceCreate' },
                category: 'WORKFLOW'
            },
            {
                id: 'tool_workspace_read',
                name: 'workspace_read',
                description: 'Read the contents of a document from the Dynamic Workspace.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        documentId: { type: 'STRING', description: 'ID of the document to read.' }
                    },
                    required: ['documentId']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleWorkspaceRead' },
                category: 'WORKFLOW'
            },
            {
                id: 'tool_workspace_update',
                name: 'workspace_update',
                description: 'Update an existing document in the Dynamic Workspace.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        documentId: { type: 'STRING', description: 'ID of the document to update.' },
                        content: { type: 'STRING', description: 'New content (replaces existing unless append=true).' },
                        title: { type: 'STRING', description: 'New title (optional).' },
                        append: { type: 'BOOLEAN', description: 'Append content instead of replacing. Default: false.' }
                    },
                    required: ['documentId']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleWorkspaceUpdate' },
                category: 'WORKFLOW'
            },
            {
                id: 'tool_workspace_list',
                name: 'workspace_list',
                description: 'List all documents in the Dynamic Workspace.',
                parameters: {
                    type: 'OBJECT',
                    properties: {}
                },
                handler: { type: 'BUILTIN', handlerName: 'handleWorkspaceList' },
                category: 'WORKFLOW'
            },
            {
                id: 'tool_workspace_search',
                name: 'workspace_search',
                description: 'Search for documents in the Dynamic Workspace by content or title.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        query: { type: 'STRING', description: 'Search query.' },
                        limit: { type: 'NUMBER', description: 'Maximum results. Default: 10.' }
                    },
                    required: ['query']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleWorkspaceSearch' },
                category: 'WORKFLOW'
            },
            // Code Execution Tool
            {
                id: 'tool_execute_code',
                name: 'execute_code',
                description: 'Execute code in a sandboxed environment. Use for testing, data processing, or automation. Safety limits apply.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        language: { type: 'STRING', description: 'Programming language: javascript, typescript.' },
                        code: { type: 'STRING', description: 'The code to execute.' },
                        timeout: { type: 'NUMBER', description: 'Maximum execution time in seconds. Default: 30.' }
                    },
                    required: ['language', 'code']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleExecuteCode' },
                category: 'DEV'
            },
            // ==================== UI CONTROL TOOLS (Omnipresent Silhouette) ====================
            {
                id: 'tool_navigate_to',
                name: 'navigate_to',
                description: 'Navigate the user to a specific section of the application. Use this to guide users to the right place or when they ask to go somewhere.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        destination: { type: 'STRING', description: 'Section to navigate to: dashboard, chat, orchestrator, canvas, media, system, memory, settings, introspection, workspace, training, terminal' },
                        highlight_element: { type: 'STRING', description: 'Optional CSS selector or element ID to highlight after navigation.' },
                        message: { type: 'STRING', description: 'Optional message to show to the user after navigation.' }
                    },
                    required: ['destination']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleNavigateTo' },
                category: 'UTILITY'
            },
            {
                id: 'tool_ui_action',
                name: 'ui_action',
                description: 'Perform actions on the user interface. Open/close panels, highlight elements, show tooltips. Use this to guide users through the interface.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        action: { type: 'STRING', description: 'Action: open_panel, close_panel, click_button, highlight, scroll_to, show_tooltip' },
                        target: { type: 'STRING', description: 'CSS selector or element ID to target.' },
                        panel: { type: 'STRING', description: 'Panel to open/close: drive, email, notifications, settings' },
                        message: { type: 'STRING', description: 'Message for tooltip.' },
                        duration_ms: { type: 'NUMBER', description: 'Duration for highlight/tooltip in ms (default: 3000).' }
                    },
                    required: ['action']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleUIAction' },
                category: 'UTILITY'
            },
            // ==================== PRESENTATION TOOLS ====================
            {
                id: 'tool_create_presentation',
                name: 'create_presentation',
                description: 'Create a professional presentation with AI-generated slides, research, and visuals. Use this when the user asks for presentations, slide decks, or pitch decks.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        topic: { type: 'STRING', description: 'Main topic or title for the presentation.' },
                        num_slides: { type: 'NUMBER', description: 'Number of slides (5-15 recommended). Default: 7' },
                        theme: { type: 'STRING', description: 'Visual theme: modern-dark, corporate, pitch-deck, academic, minimal, creative' },
                        include_research: { type: 'BOOLEAN', description: 'Search the web for current information. Default: true' },
                        generate_images: { type: 'BOOLEAN', description: 'Generate AI images for slides. Default: false' },
                        target_audience: { type: 'STRING', description: 'Who the presentation is for.' },
                        style: { type: 'STRING', description: 'Style: formal, casual, technical' },
                        language: { type: 'STRING', description: 'Language for content. Default: Spanish' }
                    },
                    required: ['topic']
                },
                handler: { type: 'BUILTIN', handlerName: 'handleCreatePresentation' },
                category: 'MEDIA'
            }
        ];

        for (const tool of builtinTools) {
            this.registerTool({
                ...tool,
                createdBy: 'SYSTEM',
                enabled: true,
                usageCount: 0,
                successCount: 0,
                createdAt: Date.now(),
                version: '1.0.0'
            } as DynamicTool);
        }
    }

    /**
     * Load persisted dynamic tools from storage
     */
    private async loadPersistedTools(): Promise<void> {
        try {
            const { toolPersistence } = await import('./toolPersistence');
            const dynamicTools = await toolPersistence.loadAll();

            for (const tool of dynamicTools) {
                this.tools.set(tool.name, tool);
                console.log(`[ToolRegistry] 📦 Loaded dynamic tool: ${tool.name}`);
            }
        } catch (error) {
            console.warn('[ToolRegistry] No persisted tools found or error loading:', error);
        }
    }

    /**
     * Register a new tool (can be called at runtime)
     */
    public registerTool(tool: DynamicTool): void {
        const isNew = !this.tools.has(tool.name);

        if (!isNew) {
            console.log(`[ToolRegistry] 🔄 Updating tool: ${tool.name}`);
        } else {
            console.log(`[ToolRegistry] ➕ Registering new tool: ${tool.name} (${tool.category})`);
        }

        this.tools.set(tool.name, tool);

        // Emit TOOL_CREATED for CapabilityAwarenessService
        systemBus.emit(
            isNew ? SystemProtocol.TOOL_CREATED : SystemProtocol.TOOL_EVOLVED,
            {
                tool: {
                    name: tool.name,
                    description: tool.description,
                    category: tool.category,
                    version: tool.version
                }
            },
            'ToolRegistry'
        );

        // Emit event for UI updates
        systemBus.emit(SystemProtocol.UI_REFRESH, {
            source: 'TOOL_REGISTRY',
            message: `Tool registered: ${tool.name}`,
            tool: tool.name
        });
    }

    /**
     * Get all enabled tools as Gemini FunctionDeclarations
     */
    public getToolDeclarations(): FunctionDeclaration[] {
        const declarations: FunctionDeclaration[] = [];

        for (const [name, tool] of this.tools) {
            if (!tool.enabled) continue;

            declarations.push({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as any
            });
        }

        return declarations;
    }

    /**
     * Get tool by name
     */
    public getTool(name: string): DynamicTool | undefined {
        return this.tools.get(name);
    }

    /**
     * Get all tools (for UI display)
     */
    public getAllTools(): DynamicTool[] {
        return Array.from(this.tools.values());
    }

    /**
     * Get tools by category
     */
    public getToolsByCategory(category: ToolCategory): DynamicTool[] {
        return this.getAllTools().filter(t => t.category === category);
    }

    /**
     * Enable/disable a tool
     */
    public setToolEnabled(name: string, enabled: boolean): boolean {
        const tool = this.tools.get(name);
        if (!tool) return false;

        tool.enabled = enabled;
        console.log(`[ToolRegistry] ${enabled ? '✅' : '⛔'} Tool ${name} ${enabled ? 'enabled' : 'disabled'}`);
        return true;
    }

    /**
     * Record tool usage (for analytics)
     */
    public recordUsage(name: string, success: boolean): void {
        const tool = this.tools.get(name);
        if (!tool) return;

        tool.usageCount++;
        if (success) tool.successCount++;
        tool.lastUsed = Date.now();
    }

    /**
     * Check if a tool exists
     */
    public hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Delete a dynamic tool (cannot delete SYSTEM tools or tools with dependents)
     */
    public async deleteTool(name: string, options?: { force?: boolean }): Promise<{
        success: boolean;
        error?: string;
        dependents?: string[];
    }> {
        const tool = this.tools.get(name);
        if (!tool) {
            return { success: false, error: 'Tool not found' };
        }

        if (tool.createdBy === 'SYSTEM') {
            console.warn(`[ToolRegistry] ⚠️ Cannot delete system tool: ${name}`);
            return { success: false, error: 'Cannot delete system tool' };
        }

        // Check for dependents using dependency graph
        try {
            const { dependencyGraph } = await import('./dependencyGraph');
            const checkResult = dependencyGraph.canDelete(name);

            if (!checkResult.canDelete && !options?.force) {
                console.warn(`[ToolRegistry] ⚠️ Cannot delete ${name}: has dependents`);
                return {
                    success: false,
                    error: `Tool has dependents: ${checkResult.blockedBy?.join(', ')}`,
                    dependents: checkResult.blockedBy
                };
            }

            // If forcing, also remove from dependency graph
            if (options?.force) {
                dependencyGraph.removeTool(name);
                console.warn(`[ToolRegistry] ⚠️ Force deleting ${name} (may break dependents)`);
            }
        } catch (error) {
            console.warn('[ToolRegistry] Dependency graph not available, proceeding with deletion');
        }

        this.tools.delete(name);
        console.log(`[ToolRegistry] 🗑️ Deleted tool: ${name}`);
        return { success: true };
    }

    /**
     * Get registry snapshot for debugging
     */
    public getSnapshot(): any {
        const snapshot: any = {
            totalTools: this.tools.size,
            byCategory: {} as Record<string, number>,
            byCreator: {} as Record<string, number>,
            tools: [] as any[]
        };

        for (const tool of this.tools.values()) {
            snapshot.byCategory[tool.category] = (snapshot.byCategory[tool.category] || 0) + 1;
            snapshot.byCreator[tool.createdBy] = (snapshot.byCreator[tool.createdBy] || 0) + 1;
            snapshot.tools.push({
                name: tool.name,
                category: tool.category,
                enabled: tool.enabled,
                usageCount: tool.usageCount,
                createdBy: tool.createdBy
            });
        }

        return snapshot;
    }
}

export const toolRegistry = ToolRegistry.getInstance();
