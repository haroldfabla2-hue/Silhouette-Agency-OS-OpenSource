
import { GenerateVideoArgs, ListVisualAssetsArgs, GenerateImageArgs, DelegateTaskArgs, SearchAssetsArgs, ManageAssetArgs, PreviewAssetArgs, CreateToolArgs, RequestCollaborationArgs } from './definitions';
// ... (existing imports)


import { ActionType } from '../../types';
import { actionExecutor } from '../actionExecutor';
import { mediaManager } from '../mediaManager';
import { videoFactory } from '../media/videoFactory';
import { imageFactory } from '../media/imageFactory';
import { toolFactory } from './toolFactory';
import { toolRegistry, ToolCategory } from './toolRegistry';
import { pluginRegistry } from '../plugins/pluginRegistry';
import { readUrl, searchWeb } from '../../tools/webBrowserTool';

export class ToolHandler {

    public async handleFunctionCall(name: string, args: any): Promise<any> {
        console.log(`[ToolHandler] 🛠️ Executing Tool: ${name}`);

        // 1. Check if this is a Plugin Tool
        const toolDef = toolRegistry.getTool(name);
        if (toolDef && toolDef.handler.type === 'BUILTIN' && toolDef.handler.handlerName.startsWith('PLUGIN:')) {
            const [, pluginId, toolName] = toolDef.handler.handlerName.split(':');
            const handler = pluginRegistry.getToolHandler(pluginId, toolName);

            if (handler) {
                try {
                    console.log(`[ToolHandler] 🔌 Routing to Plugin: ${pluginId}`);
                    return await handler(args);
                } catch (e: any) {
                    console.error(`[ToolHandler] ❌ Plugin execution failed:`, e);
                    return { error: `Plugin tool failed: ${e.message}` };
                }
            } else {
                console.error(`[ToolHandler] ❌ Plugin handler not found for ${name}`);
                return { error: "Plugin handler not found (plugin might be disabled)" };
            }
        }

        // 2. Legacy Switch-Case (Core Tools)
        switch (name) {
            case 'generate_video':
                return await this.handleGenerateVideo(args as GenerateVideoArgs);
            case 'generate_image':
                return await this.handleGenerateImage(args as GenerateImageArgs);
            case 'generate_voice':
                return await this.handleGenerateVoice(args as import('./definitions').GenerateVoiceArgs);
            case 'list_visual_assets':
                return await this.handleListVisualAssets(args as ListVisualAssetsArgs);
            case 'delegate_task':
                return await this.handleDelegateTask(args as DelegateTaskArgs);
            case 'search_assets':
                return await this.handleSearchAssets(args as SearchAssetsArgs);
            case 'manage_asset':
                return await this.handleManageAsset(args as ManageAssetArgs);
            case 'preview_asset':
                return await this.handlePreviewAsset(args as PreviewAssetArgs);
            // Research Tools (Phase 11)
            case 'web_search':
                return await this.handleWebSearch(args as import('./definitions').WebSearchArgs);
            case 'read_url':
                return await this.handleReadUrl(args as import('./definitions').ReadUrlArgs);
            // Meta Tools (Self-Extension)
            case 'create_tool':
                return await this.handleCreateTool(args as CreateToolArgs);
            case 'create_skill':
                return await this.handleCreateSkill(args);
            case 'create_plugin':
                return await this.handleCreatePlugin(args as import('./definitions').CreatePluginArgs);
            case 'list_my_tools':
                return await this.handleListMyTools(args);

            // GitHub Tools
            case 'github_create_pr':
                return await this.handleGitHubCreatePR(args as import('./definitions').GitHubCreatePRArgs);
            case 'github_list_prs':
                return await this.handleGitHubListPRs(args as import('./definitions').GitHubListPRsArgs);
            case 'github_check_pr':
                return await this.handleGitHubCheckPR(args as import('./definitions').GitHubCheckPRArgs);

            // Communication Tools (Gmail)
            case 'send_email':
                return await this.handleSendEmail(args);
            case 'get_emails':  // Alias for read_inbox (used in prompt instructions)
            case 'read_inbox':
                return await this.handleReadInbox(args);

            // Production Video Tools (Long-form video pipeline)
            case 'start_video_production':
                return await this.handleStartVideoProduction(args as import('./definitions').StartVideoProductionArgs);
            case 'get_production_status':
                return await this.handleGetProductionStatus(args as import('./definitions').GetProductionStatusArgs);
            case 'list_productions':
                return await this.handleListProductions();

            // ==================== FILESYSTEM TOOLS ====================
            case 'read_file':
                return await this.handleReadFile(args as import('./definitions').ReadFileArgs);
            case 'write_file':
                return await this.handleWriteFile(args as import('./definitions').WriteFileArgs);
            case 'list_files':
                return await this.handleListFiles(args as import('./definitions').ListFilesArgs);

            // ==================== WORKSPACE TOOLS ====================
            case 'workspace_create':
                return await this.handleWorkspaceCreate(args as import('./definitions').WorkspaceCreateArgs);
            case 'workspace_read':
                return await this.handleWorkspaceRead(args as import('./definitions').WorkspaceReadArgs);
            case 'workspace_update':
                return await this.handleWorkspaceUpdate(args as import('./definitions').WorkspaceUpdateArgs);
            case 'workspace_list':
                return await this.handleWorkspaceList();
            case 'workspace_search':
                return await this.handleWorkspaceSearch(args as import('./definitions').WorkspaceSearchArgs);

            // ==================== CODE EXECUTION ====================
            case 'execute_code':
                return await this.handleExecuteCode(args as import('./definitions').ExecuteCodeArgs);

            // ==================== UI CONTROL TOOLS (Omnipresent Silhouette) ====================
            case 'navigate_to':
                return await this.handleNavigateTo(args as import('./definitions').NavigateToArgs);
            case 'ui_action':
                return await this.handleUIAction(args as import('./definitions').UIActionArgs);

            // ==================== PRESENTATION TOOLS ====================
            case 'create_presentation':
                return await this.handleCreatePresentation(args as import('./definitions').CreatePresentationArgs);

            // ==================== SYSTEM CONTROL TOOLS ====================
            case 'system_execute_command':
                return await this.handleSystemExecuteCommand(args as { command: string; cwd?: string; background?: boolean });
            case 'system_open_app':
                return await this.handleSystemOpenApp(args as { target: string });
            case 'system_get_screenshot':
                return await this.handleSystemGetScreenshot(args as { monitor_index?: number });
            case 'system_get_info':
                return await this.handleSystemGetInfo();
            case 'architect_audit':
                return await this.handleArchitectAudit();
            case 'request_collaboration':
                return await this.handleRequestCollaboration(args as RequestCollaborationArgs);

            // ==================== SELF-CONFIGURATION TOOLS Phase 17 ====================
            case 'get_system_config':
                return await this.handleGetSystemConfig(args as any);
            case 'update_system_config':
                return await this.handleUpdateSystemConfig(args as any);
            case 'read_architecture':
                return await this.handleReadArchitecture();

            // ==================== SELF-HEALING KERNEL TOOLS Phase 18 ====================
            case 'read_system_logs':
                return await this.handleReadSystemLogs(args as any);
            case 'analyze_and_repair':
                return await this.handleAnalyzeAndRepair(args as any);

            // ==================== BROWSER SUBAGENT TOOLS Phase 18 ====================
            case 'browser_navigate':
                return await this.handleBrowserNavigate(args as any);
            case 'browser_action':
                return await this.handleBrowserAction(args as any);
            case 'browser_extract':
                return await this.handleBrowserExtract();
            case 'browser_screenshot':
                return await this.handleBrowserScreenshot();

            default:
                if (name.startsWith('query_') && name.includes('_db_')) {
                    if (!args.query) return { error: "Missing 'query' parameter for database tool execution." };
                    return await this.handleDynamicDbQuery(name, args.query);
                }
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    private async handleDelegateTask(args: DelegateTaskArgs): Promise<any> {
        if (!args.target_role || !args.task) return { error: "Missing role or task" };

        const { systemBus } = await import('../systemBus');
        const { SystemProtocol } = await import('../../types');
        const { orchestrator } = await import('../orchestrator');

        // Logic:
        // 1. Dispatch Request
        // 2. Orchestrator finds best agent for role (or Service Discovery)
        // 3. (Ideally) we would await response, but for now we queue it.
        // In this Architecture, inter-agent comms is async via Bus or Continuum.
        // But for Tools, we simulate a "Promise" via the Orchestrator? 
        // Or simpler: We create a "Task Ticket".

        systemBus.emit(SystemProtocol.TASK_ASSIGNMENT, {
            targetRole: args.target_role,
            task: args.task,
            context: args.context,
            priority: 'HIGH'
        }, 'TOOL_HANDLER');

        // We return a confirmation. The Agent must know to listen or check status later.
        // [FUTURE]: Implement sync-await for tools if we need immediate result.

        return {
            status: "delegated",
            message: `Task delegated to ${args.target_role}. System will notify completion.`,
            ticket_id: `DEL-${Date.now()}`
        };
    }

    private async handleGenerateVideo(args: GenerateVideoArgs): Promise<any> {
        // Validation
        if (!args.prompt) return { error: "Missing prompt" };

        const engine = args.engine || 'WAN';
        const duration = args.duration || 5;
        const inputAsset = args.input_asset_path;

        try {
            // [Phase 7] VRAM Safety: Request exclusive GPU access
            const { resourceManager } = await import('../resourceManager');
            const hasVram = await resourceManager.requestExclusiveAccess('VIDEO');

            if (!hasVram) {
                console.warn('[ToolHandler] âš ï¸ VRAM not available. Queueing anyway (will process when free).');
                // We still queue - the video processor will handle VRAM when it runs
            }

            // Direct delegation to VideoFactory
            // Note: VideoFactory returns { url, provider } or null
            const result = await videoFactory.createVideo(args.prompt, duration, inputAsset, engine);

            if (result) {
                return {
                    status: "queued",
                    job_id: result.url, // createVideo returns ticket string as url for local
                    provider: result.provider,
                    vram_reserved: hasVram,
                    message: `Video generation started using ${engine}. It will appear in the output folder shortly.`
                };
            } else {
                return { error: "Failed to queue video generation." };
            }
        } catch (e: any) {
            return { error: `Video generation failed: ${e.message}` };
        }
    }

    private async handleGenerateImage(args: GenerateImageArgs): Promise<any> {
        // Validation
        if (!args.prompt) return { error: "Missing prompt" };
        const style = args.style || 'PHOTOREALISTIC';

        try {
            const asset = await imageFactory.createAsset({
                prompt: args.prompt,
                style: style,
                aspectRatio: args.aspectRatio || '16:9',
                negativePrompt: args.negativePrompt,
                count: args.count
            });

            if (asset) {
                return {
                    status: "success",
                    url: asset.url,
                    localPath: asset.localPath,
                    provider: asset.provider,
                    message: `Image generated successfully in ${style} style.`
                };
            } else {
                return { error: "Failed to generate image." };
            }
        } catch (e: any) {
            return { error: `Image generation failed: ${e.message}` };
        }
    }

    private async handleGenerateVoice(args: import('./definitions').GenerateVoiceArgs): Promise<any> {
        if (!args.text) return { error: "Missing text to synthesize" };

        try {
            const { mediaService } = await import('../mediaService');
            // Generate the audio buffer
            const audioBuffer = await mediaService.generateSpeech(args.text, args.voiceId);
            // Save it locally
            const fs = await import('fs/promises');
            const path = await import('path');
            const today = new Date().toISOString().split('T')[0];
            const dir = path.join(process.cwd(), 'uploads', 'audio', today);

            await fs.mkdir(dir, { recursive: true });

            const filename = `voice_${Date.now()}.mp3`;
            const localPath = path.join(dir, filename);
            await fs.writeFile(localPath, Buffer.from(audioBuffer));

            // Register in assetCatalog
            const { assetCatalog } = await import('../assetCatalog');
            await assetCatalog.register({
                type: 'audio',
                name: filename,
                filePath: localPath,
                description: `Spoken audio generated from text: ${args.text.substring(0, 100)}`,
                tags: ['voice', 'generated', 'audio']
            });

            return {
                status: "success",
                localPath: localPath,
                message: `Voice generated successfully and saved to ${localPath}.`
            };
        } catch (e: any) {
            return { error: `Voice generation failed: ${e.message}` };
        }
    }

    private async handleListVisualAssets(args: ListVisualAssetsArgs): Promise<any> {
        const filter = args.filter_type || 'all';
        const limit = args.limit || 10;

        try {
            let assets: string[] = [];

            if (filter === 'all' || filter === 'image') {
                const images = await mediaManager.listAvailableAssets('image');
                assets = [...assets, ...images];
            }
            if (filter === 'all' || filter === 'video') {
                const videos = await mediaManager.listAvailableAssets('video');
                assets = [...assets, ...videos];
            }

            // Sort by most recent (assuming listAvailableAssets returns sorted or we strict sort here)
            // mediaManager returns sorted .reverse() already.

            // Flatten and slice
            return {
                assets: assets.slice(0, limit),
                count: assets.slice(0, limit).length,
                source: "media_library" // Context hint
            };

        } catch (e: any) {
            return { error: `Failed to list assets: ${e.message}` };
        }
    }

    // ==================== ASSET CATALOG TOOLS ====================

    private async handleSearchAssets(args: SearchAssetsArgs): Promise<any> {
        try {
            const { assetCatalog } = await import('../assetCatalog');

            const results = assetCatalog.search({
                query: args.query,
                type: args.type,
                tags: args.tags,
                folder: args.folder,
                limit: args.limit || 20,
                isArchived: false
            });

            return {
                status: "success",
                count: results.length,
                assets: results.map(a => ({
                    id: a.id,
                    name: a.name,
                    type: a.type,
                    path: a.filePath,
                    tags: a.tags,
                    folder: a.folder,
                    favorite: a.isFavorite,
                    created: new Date(a.createdAt).toISOString()
                }))
            };
        } catch (e: any) {
            return { error: `Search failed: ${e.message}` };
        }
    }

    private async handleManageAsset(args: ManageAssetArgs): Promise<any> {
        if (!args.asset_id || !args.action) {
            return { error: "Missing asset_id or action" };
        }

        try {
            const { assetCatalog } = await import('../assetCatalog');

            let result: any = null;

            switch (args.action) {
                case 'rename':
                    if (!args.new_name) return { error: "Missing new_name for rename" };
                    result = assetCatalog.update(args.asset_id, { name: args.new_name });
                    break;

                case 'tag':
                    if (!args.tags || args.tags.length === 0) return { error: "Missing tags" };
                    result = assetCatalog.addTags(args.asset_id, args.tags);
                    break;

                case 'untag':
                    if (!args.tags || args.tags.length === 0) return { error: "Missing tags" };
                    result = assetCatalog.removeTags(args.asset_id, args.tags);
                    break;

                case 'move':
                    result = assetCatalog.moveToFolder(args.asset_id, args.folder || '/');
                    break;

                case 'favorite':
                    result = assetCatalog.toggleFavorite(args.asset_id);
                    break;

                case 'archive':
                    result = assetCatalog.archive(args.asset_id);
                    break;

                case 'delete':
                    const deleted = await assetCatalog.delete(args.asset_id, true);
                    if (deleted) {
                        return { status: "success", message: "Asset deleted successfully." };
                    } else {
                        return { error: "Asset not found or already deleted." };
                    }

                default:
                    return { error: `Unknown action: ${args.action}` };
            }

            if (result) {
                return {
                    status: "success",
                    action: args.action,
                    asset: {
                        id: result.id,
                        name: result.name,
                        tags: result.tags,
                        folder: result.folder,
                        favorite: result.isFavorite,
                        archived: result.isArchived
                    }
                };
            } else {
                return { error: "Asset not found" };
            }
        } catch (e: any) {
            return { error: `Action failed: ${e.message}` };
        }
    }

    /**
     * Handle preview_asset tool - Emits event for UI to show asset preview popup
     */
    private async handlePreviewAsset(args: PreviewAssetArgs): Promise<any> {
        if (!args.asset_id) return { error: "Missing asset_id" };

        try {
            // Get asset details
            const { assetCatalog } = await import('../assetCatalog');
            const asset = assetCatalog.getById(args.asset_id);

            if (!asset) {
                return { error: `Asset not found: ${args.asset_id}` };
            }

            // Emit event for UI to show preview popup
            const { systemBus } = await import('../systemBus');
            const { SystemProtocol } = await import('../../types');

            systemBus.emit(SystemProtocol.UI_COMMAND, {
                type: 'SHOW_ASSET_PREVIEW',
                payload: {
                    assetId: asset.id,
                    asset: asset,
                    editMode: args.edit_mode || false
                }
            }, 'TOOL_HANDLER');

            return {
                status: "success",
                message: `Showing preview for: ${asset.name}`,
                asset: {
                    id: asset.id,
                    name: asset.name,
                    type: asset.type,
                    path: asset.filePath
                }
            };
        } catch (e: any) {
            return { error: `Preview failed: ${e.message}` };
        }
    }

    // ==================== PHASE 11: RESEARCH TOOLS ====================

    private async handleWebSearch(args: import('./definitions').WebSearchArgs): Promise<any> {
        try {
            console.log(`[ToolHandler] 🔍 Web Search: ${args.query}`);
            const result = await searchWeb(args.query);
            return {
                result,
                metadata: {
                    search_engine: 'DuckDuckGo HTML Scraper',
                    query: args.query
                }
            };
        } catch (e: any) {
            console.error(`[ToolHandler] ❌ Web search failed:`, e);
            return { error: `Web search failed: ${e.message}` };
        }
    }

    private async handleReadUrl(args: import('./definitions').ReadUrlArgs): Promise<any> {
        try {
            console.log(`[ToolHandler] 📖 Reading URL: ${args.url}`);
            const content = await readUrl(args.url);

            // Extract title and text to shove to LanceDB later or return to LLM
            // Truncate to avoid exploding context window (80k limit is high, but good to be safe)
            const maxLength = 25000;
            const truncated = content.length > maxLength
                ? content.substring(0, maxLength) + '\n\n[CONTENT TRUNCATED FOR LENGTH]'
                : content;

            // ---- PERSISTENT MEMORY / RAG INJECTION ----
            try {
                const { continuum } = await import('../continuumMemory');
                const { ingestion } = await import('../ingestionService');
                const { MemoryTier } = await import('../../types');

                if (content.length > 20000) {
                    // Start async background ingestion for large docs
                    ingestion.ingest(content, ['web_scrape', `url:${args.url}`]).catch(e => console.error('[ToolHandler] Async ingestion error:', e));
                } else {
                    // Direct synchronous storage for smaller docs
                    await continuum.store(content, MemoryTier.MEDIUM, ['web_scrape', `url:${args.url}`], true);
                }
            } catch (memErr) {
                console.warn('[ToolHandler] Failed to store web content in Continuum (LanceDB missed it)', memErr);
            }
            // ------------------------------------------

            return {
                content: truncated,
                length: content.length,
                url: args.url
            };
        } catch (e: any) {
            console.error(`[ToolHandler] ❌ Read URL failed:`, e);
            return { error: `Failed to read URL format. Details: ${e.message}` };
        }
    }

    // ==================== META TOOLS (Self-Extension) ====================

    /**
     * Create a new tool dynamically
     * This enables Silhouette to extend its own capabilities at runtime
     */
    private async handleCreateTool(args: CreateToolArgs): Promise<any> {
        try {
            console.log(`[ToolHandler] ðŸ­ Creating new tool: ${args.name}`);

            // Convert compose_from to steps format
            const steps = args.compose_from?.map(step => ({
                toolName: step.tool_name,
                inputMapping: step.input_mapping,
                outputAs: step.output_as
            }));

            // Create the tool via factory
            const tool = await toolFactory.createTool({
                name: args.name,
                purpose: args.purpose,
                category: args.category as ToolCategory,
                inputs: args.inputs.map(input => ({
                    name: input.name,
                    type: input.type,
                    description: input.description,
                    required: input.required
                })),
                output: 'Dynamic tool output',
                implementation: args.implementation || (steps && steps.length > 0 ? 'COMPOSE' : 'BUILTIN'),
                steps: steps,
                code: args.code,
                tags: args.tags
            });

            return {
                status: "success",
                message: `Tool '${tool.name}' created successfully! It is now available for use.`,
                tool: {
                    id: tool.id,
                    name: tool.name,
                    description: tool.description,
                    category: tool.category,
                    createdBy: tool.createdBy
                }
            };
        } catch (e: any) {
            return {
                error: `Tool creation failed: ${e.message}`,
                hint: "Ensure tool name is snake_case and doesn't already exist."
            };
        }
    }

    /**
     * List available tools, optionally filtered by category
     */
    private async handleListMyTools(args: { category?: string; include_disabled?: boolean }): Promise<any> {
        try {
            let tools = toolRegistry.getAllTools();

            // Filter by category if specified
            if (args.category && args.category !== 'ALL') {
                tools = tools.filter(t => t.category === args.category);
            }

            // Filter out disabled unless requested
            if (!args.include_disabled) {
                tools = tools.filter(t => t.enabled);
            }

            // Format for response
            const toolList = tools.map(t => ({
                name: t.name,
                description: t.description,
                category: t.category,
                createdBy: t.createdBy,
                enabled: t.enabled,
                usageCount: t.usageCount
            }));

            // Group by category for easier reading
            const byCategory: Record<string, any[]> = {};
            for (const tool of toolList) {
                if (!byCategory[tool.category]) {
                    byCategory[tool.category] = [];
                }
                byCategory[tool.category].push(tool);
            }

            return {
                status: "success",
                totalTools: tools.length,
                byCategory,
                tools: toolList
            };
        } catch (e: any) {
            return { error: `Failed to list tools: ${e.message}` };
        }
    }

    /**
     * Create a new skill dynamically
     */
    private async handleCreateSkill(args: any): Promise<any> {
        try {
            const { skillFactory } = await import('../skills/skillFactory');

            const skill = await skillFactory.createSkill({
                name: args.name,
                description: args.description,
                instructions: args.instructions,
                metadata: args.metadata
            });

            return {
                status: "success",
                message: `Skill '${skill.name}' created successfully!`,
                skill: {
                    name: skill.name,
                    path: skill.filePath
                }
            };
        } catch (e: any) {
            return { error: `Skill creation failed: ${e.message}` };
        }
    }

    // ==================== PLUGIN TOOLS ====================

    private async handleCreatePlugin(args: import('./definitions').CreatePluginArgs): Promise<any> {
        try {
            const { pluginFactory } = await import('../plugins/pluginFactory');
            const result = await pluginFactory.createPlugin(args);

            if (result.success) {
                return {
                    status: "success",
                    message: `Plugin '${args.name}' created successfully at ${result.path}`,
                    path: result.path,
                    next_steps: [
                        "1. Edit definitions in index.ts",
                        "2. Implement logic in tools.ts",
                        "3. Register in loader.ts (if core) or restart server to auto-discover (future)"
                    ]
                };
            } else {
                return { error: `Plugin creation failed: ${result.error}` };
            }
        } catch (e: any) {
            return { error: `Plugin creation error: ${e.message}` };
        }
    }

    // ==================== GITHUB TOOLS ====================

    private async handleGitHubCreatePR(args: import('./definitions').GitHubCreatePRArgs): Promise<any> {
        if (!args.title || !args.branch_name || !args.files || args.files.length === 0) {
            return { error: "Missing required arguments (title, branch_name, files)" };
        }

        try {
            const { gitIntegration } = await import('../../services/gitIntegration');

            if (!gitIntegration.isAvailable()) {
                return { error: "GitHub integration is not configured. Please set GITHUB_TOKEN." };
            }

            console.log(`[ToolHandler] ðŸ™ Creating PR: ${args.title}`);

            const result = await gitIntegration['createPR']({
                title: args.title,
                body: args.body,
                branchName: args.branch_name,
                files: args.files.map(f => ({
                    path: f.path,
                    content: f.content,
                    message: f.message || `Update ${f.path}`
                }))
            });

            if (result.success) {
                return {
                    status: "success",
                    pr_url: result.prUrl,
                    pr_number: result.prNumber,
                    message: `PR Created successfully! Check it at ${result.prUrl}`
                };
            } else {
                return { error: `PR Creation failed: ${result.error}` };
            }

        } catch (e: any) {
            return { error: `GitHub Create PR failed: ${e.message}` };
        }
    }

    private async handleGitHubListPRs(args: import('./definitions').GitHubListPRsArgs): Promise<any> {
        try {
            const { prReviewService } = await import('../../server/services/prReviewService');

            // Note: prReviewService.getPendingPRs currently filters for 'silhouette-auto' or similar labels.
            // We might want to list ALL PRs, but for now reuse the service.
            // Actually, let's call getPendingPRs(true) to force refresh.
            const prs = await prReviewService.getPendingPRs(true);

            return {
                status: "success",
                count: prs.length,
                prs: prs.map(pr => ({
                    number: pr.number,
                    title: pr.title,
                    url: pr.url,
                    state: pr.state,
                    ci_status: pr.ciStatus,
                    changed_files: pr.changedFiles.length
                }))
            };

        } catch (e: any) {
            return { error: `GitHub List PRs failed: ${e.message}` };
        }
    }

    private async handleGitHubCheckPR(args: import('./definitions').GitHubCheckPRArgs): Promise<any> {
        if (!args.pr_number) return { error: "Missing pr_number" };

        try {
            const { gitIntegration } = await import('../../services/gitIntegration');

            if (!gitIntegration.isAvailable()) return { error: "GitHub not configured" };

            const status = await gitIntegration.getCIStatus(args.pr_number);

            if (!status) return { error: "Could not retrieve CI status (PR might not exist)" };

            return {
                status: "success",
                conclusion: status.conclusion,
                all_passed: status.allPassed,
                check_runs: status.checkRuns.map(run => ({
                    name: run.name,
                    status: run.status,
                    conclusion: run.conclusion
                }))
            };

        } catch (e: any) {
            return { error: `GitHub Check PR failed: ${e.message}` };
        }
    }

    // ==================== COMMUNICATION TOOLS (Gmail) ====================

    private async handleSendEmail(args: { to: string; subject: string; body: string; driveLink?: string }): Promise<any> {
        if (!args.to || !args.subject || !args.body) {
            return { error: "Missing required arguments (to, subject, body)" };
        }

        try {
            const { gmailService } = await import('../gmailService');
            await gmailService.init();

            if (!gmailService.isReady()) {
                return { error: "Gmail not connected. User needs to authenticate with Google first." };
            }

            const result = await gmailService.sendEmail({
                to: args.to,
                subject: args.subject,
                body: args.body,
                driveLink: args.driveLink
            });

            if (result.success) {
                return {
                    status: "success",
                    messageId: result.messageId,
                    message: `Email sent successfully to ${args.to}`
                };
            } else {
                return { error: `Failed to send email: ${result.error}` };
            }
        } catch (e: any) {
            return { error: `Send email failed: ${e.message}` };
        }
    }

    private async handleReadInbox(args: { limit?: number; query?: string }): Promise<any> {
        try {
            const { gmailService } = await import('../gmailService');
            await gmailService.init();

            if (!gmailService.isReady()) {
                return { error: "Gmail not connected. User needs to authenticate with Google first." };
            }

            const limit = args.limit || 10;
            const emails = args.query
                ? await gmailService.searchEmails(args.query, limit)
                : await gmailService.getInbox(limit);

            return {
                status: "success",
                count: emails.length,
                emails: emails.map(e => ({
                    id: e.id,
                    from: e.from,
                    subject: e.subject,
                    snippet: e.snippet,
                    date: new Date(e.date).toISOString(),
                    isUnread: e.isUnread
                }))
            };
        } catch (e: any) {
            return { error: `Read inbox failed: ${e.message}` };
        }
    }

    // ==================== PRODUCTION VIDEO TOOLS ====================

    private async handleStartVideoProduction(args: import('./definitions').StartVideoProductionArgs): Promise<any> {
        if (!args.brief || !args.target_minutes) {
            return { error: "Missing required arguments (brief, target_minutes)" };
        }

        try {
            const { productionOrchestrator } = await import('../squads/productionSquad');

            // Validate target_minutes range
            if (args.target_minutes < 0.5 || args.target_minutes > 120) {
                return { error: "target_minutes must be between 0.5 and 120" };
            }

            console.log(`[ToolHandler] ðŸŽ¬ Starting video production: "${args.brief.substring(0, 50)}..."`);

            const project = await productionOrchestrator.startProduction(
                args.brief,
                args.target_minutes,
                args.platform || 'youtube'
            );

            return {
                status: "started",
                project_id: project.id,
                title: project.title || "Generating...",
                target_duration: `${args.target_minutes} minutes`,
                platform: args.platform || 'youtube',
                message: "Production pipeline started! Use get_production_status to track progress.",
                hint: "The process will: 1) Generate storyboard 2) Create character sheets 3) Produce clips 4) Compose final video"
            };
        } catch (e: any) {
            return { error: `Failed to start production: ${e.message}` };
        }
    }

    private async handleGetProductionStatus(args: import('./definitions').GetProductionStatusArgs): Promise<any> {
        if (!args.project_id) {
            return { error: "Missing required argument: project_id" };
        }

        try {
            const { productionOrchestrator } = await import('../squads/productionSquad');
            const project = productionOrchestrator.getProject(args.project_id);

            if (!project) {
                return { error: `Production not found: ${args.project_id}` };
            }

            return {
                status: project.status,
                phase: project.phase,
                progress: project.progress,
                current_task: project.currentTask,
                title: project.title,
                storyboard: project.storyboard ? {
                    scenes: project.storyboard.scenes.length,
                    total_shots: project.storyboard.scenes.reduce((acc, s) => acc + s.shots.length, 0),
                    characters: project.storyboard.characters.map(c => c.name)
                } : null,
                assets: {
                    master_images: project.generatedAssets.masterImages.size,
                    clips: project.generatedAssets.clips.size,
                    audio_tracks: project.generatedAssets.audio.size
                },
                output_path: project.outputPath,
                errors: project.errors.length > 0 ? project.errors : undefined
            };
        } catch (e: any) {
            return { error: `Failed to get status: ${e.message}` };
        }
    }

    private async handleListProductions(): Promise<any> {
        try {
            const { productionOrchestrator } = await import('../squads/productionSquad');
            const projects = productionOrchestrator.listProductions();

            return {
                status: "success",
                count: projects.length,
                productions: projects.map(p => ({
                    id: p.id,
                    title: p.title,
                    status: p.status,
                    progress: p.progress,
                    phase: p.phase,
                    platform: p.platform,
                    created: p.createdAt
                }))
            };
        } catch (e: any) {
            return { error: `Failed to list productions: ${e.message}` };
        }
    }

    // ==================== FILESYSTEM HANDLERS ====================

    private async handleReadFile(args: import('./definitions').ReadFileArgs): Promise<any> {
        try {
            const fs = await import('fs/promises');
            const content = await fs.readFile(args.path, 'utf-8');
            return { content, path: args.path };
        } catch (e: any) {
            return { error: `Failed to read file: ${e.message}` };
        }
    }

    private async handleWriteFile(args: import('./definitions').WriteFileArgs): Promise<any> {
        try {
            const fs = await import('fs/promises');
            const pathModule = await import('path');

            // Create parent dirs if needed
            if (args.create_dirs !== false) {
                const dir = pathModule.dirname(args.path);
                await fs.mkdir(dir, { recursive: true });
            }

            await fs.writeFile(args.path, args.content, 'utf-8');
            return { status: 'success', path: args.path, bytesWritten: args.content.length };
        } catch (e: any) {
            return { error: `Failed to write file: ${e.message}` };
        }
    }

    private async handleListFiles(args: import('./definitions').ListFilesArgs): Promise<any> {
        try {
            const fs = await import('fs/promises');
            const files = await fs.readdir(args.directory, { recursive: args.recursive || false });
            // Simple mapping - in real app might need stats
            return {
                status: 'success',
                path: args.directory,
                files: files.slice(0, 100)
            };
        } catch (e: any) {
            return { error: `List files failed: ${e.message}` };
        }
    }

    // ==================== SYSTEM CONTROL HANDLERS ====================

    private async handleSystemExecuteCommand(args: { command: string; cwd?: string; background?: boolean }): Promise<any> {
        try {
            // [SECURITY] Route through ActionExecutor for Safety Policies & Confirmation
            // Previously this bypassed the ActionExecutor's "Not Implemented" or "Confirmation" checks.
            const { actionExecutor } = await import('../actionExecutor');

            // We model this as an AgentAction to use the centralized executor
            const result = await actionExecutor.execute({
                id: `sys_cmd_${Date.now()}`,
                agentId: 'system', // or tool requester
                type: ActionType.EXECUTE_COMMAND,
                status: 'PENDING',
                timestamp: Date.now(),
                requiresApproval: true,
                payload: {
                    command: args.command,
                    cwd: args.cwd,
                    background: args.background
                }
            });

            if (!result.success) {
                return { error: `Security Block: ${result.error}` };
            }

            return result.data;
        } catch (e: any) {
            return { error: `System execution failed: ${e.message}` };
        }
    }

    private async handleSystemOpenApp(args: { target: string }): Promise<any> {
        try {
            const { SystemControlService } = await import('../system/systemControlService');
            const systemControl = SystemControlService.getInstance();

            const message = await systemControl.openApplication(args.target);
            return {
                status: 'success',
                message: message
            };
        } catch (e: any) {
            return { error: `Open app failed: ${e.message}` };
        }
    }

    private async handleSystemGetScreenshot(args: { monitor_index?: number }): Promise<any> {
        try {
            const { SystemControlService } = await import('../system/systemControlService');
            const systemControl = SystemControlService.getInstance();

            const base64Image = await systemControl.getScreenshot(args.monitor_index || 0);

            return {
                status: 'success',
                message: 'Screenshot captured',
                image_data: base64Image
            };
        } catch (e: any) {
            return { error: `Screenshot failed: ${e.message}` };
        }
    }

    private async handleSystemGetInfo(): Promise<any> {
        try {
            const { SystemControlService } = await import('../system/systemControlService');
            const systemControl = SystemControlService.getInstance();
            return await systemControl.getSystemInfo();
        } catch (e: any) {
            return { error: `Get system info failed: ${e.message}` };
        }
    }


    // ==================== WORKSPACE HANDLERS ====================

    private async handleWorkspaceCreate(args: import('./definitions').WorkspaceCreateArgs): Promise<any> {
        try {
            const { canvasService } = await import('../media/canvasService');
            const id = `doc_${Date.now()}`;

            const doc = await canvasService.saveDocument({
                id,
                name: args.title,
                documentJson: JSON.stringify({
                    content: args.content,
                    format: args.format || 'markdown',
                    tags: args.tags || []
                })
            });

            return {
                status: 'success',
                documentId: doc.id,
                name: doc.name,
                message: `Document "${args.title}" created successfully`
            };
        } catch (e: any) {
            return { error: `Failed to create workspace document: ${e.message}` };
        }
    }

    private async handleWorkspaceRead(args: import('./definitions').WorkspaceReadArgs): Promise<any> {
        try {
            const { canvasService } = await import('../media/canvasService');
            const docJson = await canvasService.loadDocument(args.documentId);
            if (!docJson) {
                return { error: `Document not found: ${args.documentId}` };
            }
            let parsed: any = {};
            try { parsed = JSON.parse(docJson); } catch { parsed = { content: docJson }; }
            return {
                documentId: args.documentId,
                content: parsed.content || docJson,
                format: parsed.format,
                tags: parsed.tags
            };
        } catch (e: any) {
            return { error: `Failed to read workspace document: ${e.message}` };
        }
    }

    private async handleWorkspaceUpdate(args: import('./definitions').WorkspaceUpdateArgs): Promise<any> {
        try {
            const { canvasService } = await import('../media/canvasService');

            const existing = await canvasService.loadDocument(args.documentId);
            if (!existing) {
                return { error: `Document not found: ${args.documentId}` };
            }

            let parsed: any = {};
            try { parsed = JSON.parse(existing); } catch { parsed = { content: existing }; }

            if (args.content) {
                parsed.content = args.append
                    ? (parsed.content || '') + '\n\n' + args.content
                    : args.content;
            }

            const updated = await canvasService.saveDocument({
                id: args.documentId,
                name: args.title || 'Updated Document',
                documentJson: JSON.stringify(parsed)
            });

            return {
                status: 'success',
                documentId: args.documentId,
                name: updated.name,
                message: 'Document updated successfully'
            };
        } catch (e: any) {
            return { error: `Failed to update workspace document: ${e.message}` };
        }
    }

    private async handleWorkspaceList(): Promise<any> {
        try {
            const { canvasService } = await import('../media/canvasService');
            const docs = await canvasService.listDocuments();
            return {
                count: docs.length,
                documents: docs.map(d => ({
                    id: d.id,
                    name: d.name,
                    modified: new Date(d.updatedAt).toISOString()
                }))
            };
        } catch (e: any) {
            return { error: `Failed to list workspace documents: ${e.message}` };
        }
    }

    private async handleWorkspaceSearch(args: import('./definitions').WorkspaceSearchArgs): Promise<any> {
        try {
            const { canvasService } = await import('../media/canvasService');
            const allDocs = await canvasService.listDocuments();

            const query = args.query.toLowerCase();
            const matches = allDocs.filter(d =>
                d.name.toLowerCase().includes(query)
            ).slice(0, args.limit || 10);

            return {
                query: args.query,
                count: matches.length,
                results: matches.map(d => ({
                    id: d.id,
                    name: d.name
                }))
            };
        } catch (e: any) {
            return { error: `Failed to search workspace: ${e.message}` };
        }
    }

    // ==================== CODE EXECUTION HANDLER ====================

    private async handleExecuteCode(args: import('./definitions').ExecuteCodeArgs): Promise<any> {
        const { language, code, timeout = 30, purpose = 'Execute code as requested' } = args;

        // ==================== SECURITY SQUAD REVIEW ====================
        // Multi-layer security analysis before execution
        try {
            const { securitySquad } = await import('../security/securitySquad');
            const review = await securitySquad.reviewCode({
                code,
                language: language as 'javascript' | 'typescript' | 'python' | 'bash',
                statedPurpose: purpose,
                requesterId: 'SILHOUETTE',
                traceId: `exec_${Date.now()}`
            });

            if (!review.approved) {
                return {
                    error: 'Code execution blocked by SecuritySquad',
                    blocked: true,
                    riskLevel: review.riskLevel,
                    blockedPatterns: review.blockedPatterns,
                    warnings: review.warnings,
                    reviewTimeMs: review.reviewTimeMs
                };
            }

            // Log warnings even if approved
            if (review.warnings.length > 0) {
                console.warn(`[ToolHandler] ⚠️ Security warnings for code execution:`, review.warnings);
            }
        } catch (err) {
            console.warn('[ToolHandler] SecuritySquad not available, falling back to basic checks');
            // Fallback to basic pattern matching if SecuritySquad fails
            const dangerousPatterns = [
                /rm\s+-rf\s+[\/~]/i,
                /:(){ :\|:& };:/,
                /mkfs\./i,
            ];
            for (const pattern of dangerousPatterns) {
                if (pattern.test(code)) {
                    return { error: 'Code execution blocked: dangerous pattern detected', blocked: true };
                }
            }
        }

        try {
            const useSandbox = process.env.SANDBOX_MODE === 'true';

            // ==================== JAVASCRIPT/TYPESCRIPT ====================
            if (language === 'javascript' || language === 'typescript') {
                if (useSandbox) {
                    return await this.executeInDocker('node:18-alpine', ['node', '-e', code], timeout);
                } else {
                    const vm = await import('vm');
                    const outputs: string[] = [];
                    const sandbox = {
                        console: {
                            log: (...logArgs: any[]) => outputs.push(logArgs.join(' ')),
                            error: (...logArgs: any[]) => outputs.push('[ERROR] ' + logArgs.join(' ')),
                            warn: (...logArgs: any[]) => outputs.push('[WARN] ' + logArgs.join(' ')),
                            info: (...logArgs: any[]) => outputs.push('[INFO] ' + logArgs.join(' '))
                        },
                        Math, Date, JSON, Array, Object, String, Number, Boolean,
                        setTimeout: undefined, setInterval: undefined, // Block async
                        fetch: undefined, require: undefined,          // Block network/modules
                        result: undefined as any
                    };

                    const context = vm.createContext(sandbox);
                    const script = new vm.Script(code);
                    const startTime = Date.now();
                    const result = script.runInContext(context, {
                        timeout: timeout * 1000
                    });

                    return {
                        status: 'success',
                        language,
                        result: result !== undefined ? String(result) : sandbox.result,
                        output: outputs.join('\n'),
                        executionTimeMs: Date.now() - startTime,
                        sandbox: false
                    };
                }
            }

            // ==================== PYTHON ====================
            if (language === 'python') {
                if (useSandbox) {
                    return await this.executeInDocker('python:3.10-slim', ['python', '-c', code], timeout);
                } else {
                    return await this.executeWithSpawn('python', ['-c', code], timeout);
                }
            }

            // ==================== BASH ====================
            if (language === 'bash') {
                if (useSandbox) {
                    return await this.executeInDocker('ubuntu:latest', ['bash', '-c', code], timeout);
                } else {
                    // Additional bash-specific safety
                    const bashDangerous = [
                        /sudo\s/i,
                        /su\s+-/i,
                        />\s*\/etc\//i,
                        /source\s+~?\//i,
                        /\.\s+~?\//i
                    ];
                    for (const pattern of bashDangerous) {
                        if (pattern.test(code)) {
                            return { error: 'Bash execution blocked: elevated privilege or system file access', blocked: true };
                        }
                    }
                    const shell = process.platform === 'win32' ? 'cmd' : 'bash';
                    const shellArgs = process.platform === 'win32' ? ['/c', code] : ['-c', code];
                    const result = await this.executeWithSpawn(shell, shellArgs, timeout);
                    return { ...result, sandbox: false };
                }
            }

            return {
                error: `Language "${language}" is not supported.`,
                supported_languages: ['javascript', 'typescript', 'python', 'bash']
            };

        } catch (e: any) {
            return {
                error: `Execution failed: ${e.message}`,
                language
            };
        }
    }

    /**
     * Execute a command using child_process.spawn with timeout
     */
    private async executeWithSpawn(command: string, args: string[], timeoutSec: number): Promise<any> {
        const { spawn } = await import('child_process');

        return new Promise((resolve) => {
            const startTime = Date.now();
            let stdout = '';
            let stderr = '';
            let killed = false;

            const proc = spawn(command, args, {
                timeout: timeoutSec * 1000,
                windowsHide: true,
                env: { ...process.env, PATH: process.env.PATH }
            });

            const timer = setTimeout(() => {
                killed = true;
                proc.kill('SIGTERM');
            }, timeoutSec * 1000);

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
                if (stdout.length > 100000) { // 100KB limit
                    killed = true;
                    proc.kill('SIGTERM');
                }
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (exitCode) => {
                clearTimeout(timer);
                resolve({
                    status: killed ? 'timeout' : (exitCode === 0 ? 'success' : 'error'),
                    exitCode,
                    output: stdout.trim(),
                    error: stderr.trim() || undefined,
                    executionTimeMs: Date.now() - startTime,
                    killed
                });
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                resolve({
                    status: 'error',
                    error: `Failed to start process: ${err.message}`
                });
            });
        });
    }

    /**
     * Execute code within an ephemeral Docker sandbox container
     */
    private async executeInDocker(image: string, cmdArgs: string[], timeoutSec: number): Promise<any> {
        return new Promise(async (resolve) => {
            const { spawn } = await import('child_process');

            // Run docker via child_process
            // --rm removes container after exit
            // -i interactive (needed to pass stdin sometimes, but we are passing via cmd args here)
            // --network none disables networking for safety
            const dockerArgs = [
                'run',
                '--rm',
                '-i',
                '--network', 'none',
                '--memory', '512m',
                '--cpus', '1.0',
                image,
                ...cmdArgs
            ];

            const startTime = Date.now();
            let stdout = '';
            let stderr = '';
            let killed = false;

            const proc = spawn('docker', dockerArgs, {
                timeout: timeoutSec * 1000,
                windowsHide: true,
                env: { ...process.env, PATH: process.env.PATH }
            });

            const timer = setTimeout(() => {
                killed = true;
                proc.kill('SIGTERM');
            }, timeoutSec * 1000);

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
                if (stdout.length > 500000) { // 500KB limit
                    killed = true;
                    proc.kill('SIGTERM');
                }
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (exitCode) => {
                clearTimeout(timer);
                resolve({
                    status: killed ? 'timeout' : (exitCode === 0 ? 'success' : 'error'),
                    exitCode,
                    output: stdout.trim(),
                    error: stderr.trim() || undefined,
                    sandbox: true,
                    executionTimeMs: Date.now() - startTime,
                    killed
                });
            });

            proc.on('error', (err) => {
                clearTimeout(timer);
                resolve({
                    status: 'error',
                    error: `Failed to start docker sandbox: ${err.message}. Ensure Docker is installed and running.`,
                    sandbox: true
                });
            });
        });
    }

    // ==================== UI CONTROL HANDLERS (Omnipresent Silhouette) ====================

    private async handleNavigateTo(args: import('./definitions').NavigateToArgs): Promise<any> {
        if (!args.destination) {
            return { error: "Missing destination argument" };
        }

        try {
            const { uiController } = await import('../uiController');

            const result = uiController.navigateTo(args.destination, {
                highlightElement: args.highlight_element,
                message: args.message
            });

            return {
                status: "success",
                navigated_to: args.destination,
                message: result.message,
                highlight: args.highlight_element || null
            };
        } catch (e: any) {
            return { error: `Navigation failed: ${e.message}` };
        }
    }

    private async handleUIAction(args: import('./definitions').UIActionArgs): Promise<any> {
        if (!args.action) {
            return { error: "Missing action argument" };
        }

        try {
            const { uiController } = await import('../uiController');

            let result;
            switch (args.action) {
                case 'open_panel':
                    if (!args.panel) return { error: "Missing panel argument for open_panel" };
                    result = uiController.openPanel(args.panel as any);
                    break;
                case 'close_panel':
                    if (!args.panel) return { error: "Missing panel argument for close_panel" };
                    result = uiController.closePanel(args.panel as any);
                    break;
                case 'highlight':
                    if (!args.target) return { error: "Missing target argument for highlight" };
                    result = uiController.highlight(args.target, args.duration_ms);
                    break;
                case 'show_tooltip':
                    if (!args.target || !args.message) return { error: "Missing target or message for tooltip" };
                    result = uiController.showTooltip(args.target, args.message, args.duration_ms);
                    break;
                case 'scroll_to':
                    result = uiController.performAction('scroll_to', { target: args.target });
                    break;
                case 'click_button':
                    result = uiController.performAction('click_button', { target: args.target });
                    break;
                default:
                    return { error: `Unknown UI action: ${args.action}` };
            }

            return {
                status: "success",
                action: args.action,
                target: args.target || args.panel,
                message: result.message
            };
        } catch (e: any) {
            return { error: `UI action failed: ${e.message}` };
        }
    }

    // ==================== PRESENTATION TOOLS ====================
    private async handleCreatePresentation(args: import('./definitions').CreatePresentationArgs): Promise<any> {
        try {
            const { presentationEngine } = await import('../presentationEngine');

            // Use AUTONOMOUS generation - AI decides what capabilities are needed
            // User parameters are passed as overrides if explicitly specified
            const presentation = await presentationEngine.generateAutonomous(
                args.topic,
                {
                    // Only pass values if user explicitly specified them
                    numSlides: args.num_slides,
                    theme: args.theme,
                    includeResearch: args.include_research,
                    generateImages: args.generate_images,
                    targetAudience: args.target_audience,
                    style: args.style,
                    language: args.language
                }
            );

            // Generate HTML export
            const htmlExport = presentationEngine.renderToHTML(presentation);

            // Save to VFS
            const { vfs } = await import('../virtualFileSystem');
            const project = vfs.createProject(presentation.title, 'HTML');
            vfs.createFile(project.rootFolderId, 'presentation.html', htmlExport);
            vfs.createFile(project.rootFolderId, 'data.json', JSON.stringify(presentation, null, 2));

            return {
                status: 'success',
                presentationId: presentation.id,
                title: presentation.title,
                slides: presentation.slides.length,
                theme: presentation.theme,
                projectId: project.id,
                message: `Presentación "${presentation.title}" creada con ${presentation.slides.length} slides. Disponible en el Workspace.`,
                viewUrl: `/workspace/${project.id}`
            };
        } catch (e: any) {
            console.error('[TOOL] Create presentation failed:', e);
            return { error: `Failed to create presentation: ${e.message}` };
        }
    }

    private async handleRequestCollaboration(args: RequestCollaborationArgs): Promise<any> {
        if (!args.target_role || !args.message) return { error: "Missing role or message" };

        const { systemBus } = await import('../systemBus');
        const { SystemProtocol } = await import('../../types');

        // Emit event for Orchestrator to route
        systemBus.emit(SystemProtocol.HELP_REQUEST, {
            targetRole: args.target_role,
            content: args.message,
            context: args.context,
            priority: args.priority || 'NORMAL',
            timestamp: Date.now()
        }, 'TOOL_HANDLER');

        return {
            status: "sent",
            message: `Collaboration request sent to ${args.target_role}.`,
            id: `REQ-${Date.now()}`
        };
    }

    private async handleArchitectAudit(): Promise<any> {
        try {
            const { ArchitectAuditTool } = await import('./architectAuditTool');
            const auditor = new ArchitectAuditTool();
            const result = await auditor.performAudit();

            return {
                status: result.issues.length === 0 ? "healthy" : "issues_detected",
                ...result,
                message: result.issues.length === 0
                    ? "System architecture and documentation are in sync."
                    : `Architectural issues detected: ${result.issues.length}. Check issues list.`
            };
        } catch (e: any) {
            return { error: `Audit failed: ${e.message}` };
        }
    }

    private async handleIntrospectDatabase(args: import('./definitions').IntrospectDatabaseArgs): Promise<any> {
        if (!args.uri || !args.dbType) {
            return { error: "Missing required arguments: uri and dbType" };
        }

        try {
            console.log(`[ToolHandler] 🔍 Initiating Database Introspection for ${args.dbType} at ${args.uri}...`);
            const { dbIntrospector } = await import('../dbIntrospector');

            const schema = await dbIntrospector.introspectAndAdapt(args.uri, args.dbType);

            return {
                status: "success",
                message: `Successfully connected to ${args.dbType} database. Mapped ${schema.tables.length} tables to Agent Tools.`,
                schema: {
                    type: schema.type,
                    tables: schema.tables.map(t => t.name)
                },
                next_steps: [
                    "You can now use the newly generated custom tool (e.g., 'query_sqlite_db_XXXX') to interact with this external database."
                ]
            };
        } catch (e: any) {
            return { error: `Database introspection failed: ${e.message}` };
        }
    }

    private async handleDynamicDbQuery(toolName: string, query: string): Promise<any> {
        try {
            console.log(`[ToolHandler] ⚡ Executing Dynamic DB query via ${toolName}...`);
            const { dbIntrospector } = await import('../dbIntrospector');
            const result = await dbIntrospector.executeQuery(toolName, query);
            return {
                status: "success",
                rows_returned: Array.isArray(result) ? result.length : 0,
                data: result
            };
        } catch (e: any) {
            console.error(`[ToolHandler] ❌ Dynamic DB Query failed: ${e.message}`);
            return { error: `Query failed: ${e.message}` };
        }
    }

    // ==================== SELF-CONFIGURATION TOOL HANDLERS Phase 17 ====================

    private async handleGetSystemConfig(args: any): Promise<any> {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');

            const envPath = path.resolve(process.cwd(), '.env.local');
            const configPath = path.resolve(process.cwd(), 'silhouette.config.json');

            let envContent = '';
            let configJson = {};

            try { envContent = await fs.readFile(envPath, 'utf8'); } catch (e) { }
            try { configJson = JSON.parse(await fs.readFile(configPath, 'utf8')); } catch (e) { }

            const envLines = envContent.split('\n');
            const envMap: Record<string, string> = {};
            envLines.forEach(line => {
                if (line.trim() && !line.startsWith('#')) {
                    const idx = line.indexOf('=');
                    if (idx > 0) {
                        const k = line.slice(0, idx).trim();
                        let v = line.slice(idx + 1).trim();
                        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
                        else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
                        envMap[k] = v;
                    }
                }
            });

            let result: Record<string, any> = {};

            if (args.keys && args.keys.length > 0) {
                args.keys.forEach((k: string) => {
                    if (envMap[k] !== undefined) result[k] = envMap[k];
                    else if ((configJson as any)[k] !== undefined) result[k] = (configJson as any)[k];
                });
            } else {
                result = { ...envMap, ...configJson };
                // Hide sensitive keys if returning ALL without explicit request
                Object.keys(result).forEach(k => {
                    if (k.toLowerCase().includes('key') || k.toLowerCase().includes('token') || k.toLowerCase().includes('password')) {
                        result[k] = '********';
                    }
                });
            }

            return {
                status: "success",
                config: result
            };
        } catch (e: any) {
            return { error: `Failed to read system config: ${e.message}` };
        }
    }

    private async handleUpdateSystemConfig(args: any): Promise<any> {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');

            const envPath = path.resolve(process.cwd(), '.env.local');
            let envContent = '';
            try { envContent = await fs.readFile(envPath, 'utf8'); } catch (e) { }

            let lines = envContent.split('\n');
            const updates = args.updates || {};
            let changedCount = 0;

            for (const [k, v] of Object.entries(updates)) {
                let found = false;
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].startsWith(`${k}=`) || lines[i].startsWith(`export ${k}=`)) {
                        // Quote the value if it has spaces
                        const stringVal = String(v);
                        const writeVal = stringVal.includes(' ') && !stringVal.startsWith('"') ? `"${stringVal}"` : stringVal;
                        lines[i] = `${k}=${writeVal}`;
                        found = true;
                        changedCount++;
                        break;
                    }
                }
                if (!found) {
                    const stringVal = String(v);
                    const writeVal = stringVal.includes(' ') && !stringVal.startsWith('"') ? `"${stringVal}"` : stringVal;
                    lines.push(`${k}=${writeVal}`);
                    changedCount++;
                }
            }

            await fs.writeFile(envPath, lines.join('\n'));

            console.log(`[ToolHandler] ⚙️ System config updated (${changedCount} keys). Reason: ${args.reason}`);



            return {
                status: "success",
                message: `Successfully updated ${changedCount} configuration keys in .env.local`,
                reason_logged: args.reason,
                requires_restart: true // Safe assumption, though we try to hot-reload
            };
        } catch (e: any) {
            return { error: `Failed to update system config: ${e.message}` };
        }
    }

    private async handleReadArchitecture(): Promise<any> {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');

            const archPath = path.resolve(process.cwd(), 'ARCHITECTURE.md');
            let archContent = '';
            try {
                archContent = await fs.readFile(archPath, 'utf8');
            } catch (e) {
                return { error: "ARCHITECTURE.md not found. Project root might be incorrect." };
            }

            return {
                status: "success",
                content: archContent
            };
        } catch (e: any) {
            return { error: `Failed to read architecture: ${e.message}` };
        }
    }

    // ==================== SELF-HEALING KERNEL TOOL HANDLERS Phase 18 ====================

    private async handleReadSystemLogs(args: any): Promise<any> {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const logPath = path.resolve(process.cwd(), 'logs', 'system_errors.log');

            let content = '';
            try {
                content = await fs.readFile(logPath, 'utf8');
            } catch (e) {
                return { status: "success", logs: "No errors logged yet. System is healthy." };
            }

            const linesParam = args.lines || 50;
            const logLines = content.split('\n').filter(l => l.trim() !== '');
            const recentLogs = logLines.slice(-linesParam).join('\n');

            return {
                status: "success",
                file: logPath,
                logs: recentLogs || "No recent errors."
            };
        } catch (e: any) {
            return { error: `Failed to read system logs: ${e.message}` };
        }
    }

    private async handleAnalyzeAndRepair(args: any): Promise<any> {
        try {
            const { file, hypothesis, proposed_code_change } = args;
            if (!file || !hypothesis) {
                return { error: "Missing required fields: file, hypothesis." };
            }

            return {
                status: "hypothesis_accepted",
                message: "Repair hypothesis submitted. To implement your fix completely, use system_execute_command to run Git operations or sed, or rewrite the file with your tool execution capabilities. We strongly recommend running 'npx tsc --noEmit' or 'npm run build' after modifying the file to verify if the compilation error was fixed.",
                hypothesis_evaluated: hypothesis,
                target_file: file
            };
        } catch (e: any) {
            return { error: `Repair hypothesis failed: ${e.message}` };
        }
    }

    // ==================== BROWSER SUBAGENT TOOL HANDLERS Phase 18 ====================

    private async handleBrowserNavigate(args: any): Promise<any> {
        try {
            const { browserService } = await import('../browserService');
            const title = await browserService.goto(args.url);
            return { status: "success", url: args.url, title };
        } catch (e: any) {
            return { error: `Navigation failed: ${e.message}` };
        }
    }

    private async handleBrowserAction(args: any): Promise<any> {
        try {
            const { browserService } = await import('../browserService');
            if (args.actionType === 'click') {
                await browserService.click(args.selector);
                return { status: "success", action: "clicked", selector: args.selector };
            } else if (args.actionType === 'type') {
                await browserService.type(args.selector, args.text || '');
                return { status: "success", action: "typed", selector: args.selector };
            }
            return { error: "Invalid actionType" };
        } catch (e: any) {
            return { error: `Action failed: ${e.message}` };
        }
    }

    private async handleBrowserExtract(): Promise<any> {
        try {
            const { browserService } = await import('../browserService');
            const text = await browserService.extractText();
            return { status: "success", content_length: text.length, content: text };
        } catch (e: any) {
            return { error: `Extraction failed: ${e.message}` };
        }
    }

    private async handleBrowserScreenshot(): Promise<any> {
        try {
            const { browserService } = await import('../browserService');
            const result = await browserService.screenshot();
            return {
                status: "success",
                file_path: result.path,
                message: `Screenshot saved to ${result.path}. You can send this file to the user via their messaging channel.`
            };
        } catch (e: any) {
            return { error: `Screenshot failed: ${e.message}` };
        }
    }
}

export const toolHandler = new ToolHandler();
