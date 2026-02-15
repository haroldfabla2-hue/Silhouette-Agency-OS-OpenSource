import { Request, Response } from 'express';
import { sqliteService } from '../../services/sqliteService';
import { geminiService } from '../../services/geminiService';
import { continuum } from '../../services/continuumMemory';
import { codebaseAwareness } from '../../services/codebaseAwareness';
import { providerHealth } from '../../services/providerHealthManager';
import { userProfile } from '../../services/userProfileService';
import { chatToolIntegration } from '../../services/chatToolIntegration';
import { planGenerator } from '../../services/planGenerator';
import { planExecutor } from '../../services/planExecutor';
import { IntrospectionLayer, WorkflowStage, AgentCapability, CommunicationLevel } from '../../types';

/**
 * CHAT CONTROLLER V3.0 - Full LLM Integration with Intelligent Routing
 * 
 * Features:
 * - Persists messages to SQLite
 * - Retrieves context from ContinuumMemory
 * - Integrates codebaseAwareness for source code context
 * - Uses the Universal Fallback Chain (Gemini → OpenRouter → Groq → Ollama)
 * - Streams LLM responses via SSE
 * - Exposes provider health status
 * 
 * Model Priority:
 * 1. Gemini (gemini-2.5-flash) - Primary, fast
 * 2. OpenRouter (gemini-2.0-flash-001 or llama-3.3-70b) - Cloud fallback
 * 3. Groq (llama-3.3-70b-versatile) - Fast inference fallback
 * 4. Ollama (local llama3.2/glm4) - Offline survival mode
 */
export class ChatController {

    public async getSessions(req: Request, res: Response) {
        try {
            const sessions = sqliteService.getChatSessions();

            // Should always have at least default session for UX
            if (sessions.length === 0) {
                sessions.push({
                    id: 'default',
                    title: 'Silhouette Assistant',
                    preview: 'Ready to assist',
                    lastUpdated: Date.now(),
                    createdAt: Date.now(),
                    messages: []
                });
            }

            res.json({ sessions });
        } catch (e: any) {
            console.error("[CHAT] Failed to get sessions", e);
            res.status(500).json({ error: "DB Error" });
        }
    }

    public async getHistory(req: Request, res: Response) {
        try {
            const { sessionId } = req.params;
            const history = sqliteService.getChatHistory(sessionId || 'default');
            res.json(history);
        } catch (e: any) {
            console.error("[CHAT] Failed to get history", e);
            res.status(500).json({ error: "Failed to fetch history" });
        }
    }

    // [NEW] Create Session Endpoint
    public async createSession(req: Request, res: Response) {
        try {
            const { title } = req.body;
            const session = sqliteService.createChatSession(title || 'New Session');
            res.json(session);
        } catch (e: any) {
            console.error("[CHAT] Failed to create session", e);
            res.status(500).json({ error: "Failed to create session" });
        }
    }

    // [NEW] Delete Session Endpoint
    public async deleteSession(req: Request, res: Response) {
        try {
            const { sessionId } = req.params;
            if (!sessionId) {
                return res.status(400).json({ error: "Session ID required" });
            }
            sqliteService.deleteChatSession(sessionId);
            res.json({ success: true });
        } catch (e: any) {
            console.error("[CHAT] Failed to delete session", e);
            res.status(500).json({ error: "Failed to delete session" });
        }
    }

    /**
     * Get provider health status - useful for UI to show which models are available
     */
    public async getProviderStatus(req: Request, res: Response) {
        try {
            const healthStats = providerHealth.getHealthStats();

            // Build a user-friendly status object
            const providers = {
                gemini: {
                    available: providerHealth.isAvailable('gemini'),
                    status: healthStats['gemini']?.status || 'HEALTHY',
                    backoffMs: providerHealth.getBackoffTime('gemini')
                },
                openrouter: {
                    available: providerHealth.isAvailable('openrouter'),
                    status: healthStats['openrouter']?.status || 'HEALTHY',
                    backoffMs: providerHealth.getBackoffTime('openrouter')
                },
                groq: {
                    available: providerHealth.isAvailable('groq'),
                    status: healthStats['groq']?.status || 'HEALTHY',
                    backoffMs: providerHealth.getBackoffTime('groq')
                },
                ollama: {
                    available: true, // Local is always "available" (may timeout)
                    status: 'LOCAL',
                    backoffMs: 0
                }
            };

            res.json({ providers, timestamp: Date.now() });
        } catch (e: any) {
            console.error("[CHAT] Failed to get provider status", e);
            res.status(500).json({ error: "Failed to get provider status" });
        }
    }

    /**
     * Send a message and get a non-streaming response
     * For simple integrations that don't need SSE
     */
    public async sendMessage(req: Request, res: Response) {
        try {
            const { message, messages, sessionId, role } = req.body;

            // [DEBUG] Log incoming message
            console.log('[CHAT] 📩 sendMessage received:', {
                hasMessage: !!message,
                hasMessages: !!messages,
                sessionId: sessionId || 'default',
                bodyKeys: Object.keys(req.body)
            });

            // [ROOT CAUSE FIX] Extract message from either format (same as streamMessage)
            let userMessage: string | undefined;

            if (message && typeof message === 'string') {
                userMessage = message;
            } else if (Array.isArray(messages) && messages.length > 0) {
                const firstMsg = messages.find((m: any) => m.role === 'user') || messages[0];
                userMessage = firstMsg?.content || firstMsg?.text;
            }

            if (!userMessage || typeof userMessage !== 'string') {
                return res.status(400).json({ error: "Message is required. Send either 'message' string or 'messages' array." });
            }

            const cleanSessionId = sessionId || 'default';

            const userMsg = {
                role: role || 'user',
                content: userMessage,
                timestamp: Date.now()
            };

            // 1. Persist User Message
            sqliteService.appendChatMessage(userMsg, cleanSessionId);

            // 1.5 Extract user profile info (name, preferences)
            await userProfile.extractFromMessage(userMessage);

            // 2. Get context from memory AND codebase
            const recentHistory = sqliteService.getChatHistory(cleanSessionId, 50);
            const profileContext = userProfile.getProfileContext();
            const memoryContext = await this.assembleContext(userMessage);
            const codeContext = await this.getCodebaseContext(userMessage);

            // 3. Generate LLM response (uses fallback chain internally)
            const response = await geminiService.generateText(
                this.buildPrompt(userMessage, recentHistory, profileContext, memoryContext, codeContext)
            );

            // 4. Persist Assistant Response
            const assistantMsg = {
                role: 'assistant',
                content: response,
                timestamp: Date.now()
            };
            sqliteService.appendChatMessage(assistantMsg, cleanSessionId);

            // 5. Store interaction in memory for future context
            await continuum.store(`User asked: ${userMessage.slice(0, 100)}`, undefined, ['chat', 'interaction']);

            res.json({
                success: true,
                savedMessage: userMsg,
                response: assistantMsg
            });

        } catch (e: any) {
            console.error("[CHAT] Failed to send message", e);
            res.status(500).json({ error: "Failed to generate response" });
        }
    }

    /**
     * SSE Streaming endpoint for real-time chat
     * Uses the Universal Fallback Chain automatically
     */
    public async streamMessage(req: Request, res: Response) {
        const { message, messages, sessionId, modelPreference } = req.body;

        // [DEBUG] Log incoming stream request
        console.log('[CHAT] 📩 streamMessage received:', {
            hasMessage: !!message,
            hasMessages: !!messages,
            sessionId: sessionId || 'default',
            modelPreference,
            bodyKeys: Object.keys(req.body)
        });

        // [ROOT CAUSE FIX] Extract message from either format:
        // - Frontend sends: { messages: [{ role: 'user', content: 'text' }] }
        // - Or simple: { message: 'text' }
        let userMessage: string | undefined;

        if (message && typeof message === 'string') {
            userMessage = message;
        } else if (Array.isArray(messages) && messages.length > 0) {
            // Extract content from first user message in array
            const firstMsg = messages.find((m: any) => m.role === 'user') || messages[0];
            userMessage = firstMsg?.content || firstMsg?.text;
        }

        // Input Validation
        if (!userMessage || typeof userMessage !== 'string') {
            return res.status(400).json({ error: "Message is required. Send either 'message' string or 'messages' array." });
        }

        const cleanSessionId = sessionId || 'default';

        // Setup SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        try {
            const userMsg = {
                role: 'user',
                content: userMessage,
                timestamp: Date.now()
            };

            // 1. Persist User Message
            sqliteService.appendChatMessage(userMsg, cleanSessionId);
            res.write(`data: ${JSON.stringify({ type: 'user_saved', message: userMsg })}\n\n`);

            // 1.5 Extract user profile info (name, preferences) from message
            await userProfile.extractFromMessage(userMessage);

            // 1.6 INTELLIGENT ORCHESTRATION: Analyze complexity and delegate if needed
            res.write(`data: ${JSON.stringify({ type: 'status', message: 'Analyzing request...' })}\n\n`);

            try {
                const plan = await planGenerator.create(userMessage);

                // If complex task, use plan-based delegation to specialists
                if (plan.complexity !== 'SIMPLE' && plan.steps.length > 1) {
                    res.write(`data: ${JSON.stringify({
                        type: 'orchestration',
                        message: `Delegating to ${plan.steps.length} specialists...`,
                        complexity: plan.complexity,
                        steps: plan.steps.map(s => ({ agent: s.agentRole, task: s.taskDescription.slice(0, 50) }))
                    })}\n\n`);

                    const planResult = await planExecutor.execute(plan);

                    if (planResult.success) {
                        // Stream the final orchestrated response
                        const orchestratedResponse = planResult.finalOutput;

                        for (const chunk of orchestratedResponse.split(' ')) {
                            res.write(`data: ${JSON.stringify({ type: 'token', content: chunk + ' ' })}\n\n`);
                            await new Promise(r => setTimeout(r, 20)); // Simulate streaming
                        }

                        // Persist and finish
                        const assistantMsg = {
                            role: 'assistant',
                            content: orchestratedResponse,
                            timestamp: Date.now()
                        };
                        sqliteService.appendChatMessage(assistantMsg, cleanSessionId);

                        res.write(`data: ${JSON.stringify({ type: 'done', message: assistantMsg })}\n\n`);
                        return res.end();
                    }
                    // If plan execution failed, fall through to normal flow
                    console.warn('[CHAT] Plan execution failed, falling back to direct response');
                }
            } catch (planError: any) {
                console.warn('[CHAT] Plan generation failed (non-critical), using direct response:', planError.message);
            }

            // 2. Get RAW context from memory AND codebase
            res.write(`data: ${JSON.stringify({ type: 'status', message: 'Assembling context...' })}\n\n`);
            const recentHistory = sqliteService.getChatHistory(cleanSessionId, 50);

            // Get user profile context (always cheap, always included)
            const profileContext = userProfile.getProfileContext();

            // Get raw memories (will be filtered by purifier)
            const rawMemories = await continuum.retrieve(userMessage, undefined, undefined);

            // Get code context if relevant
            const codeContext = await this.getCodebaseContext(userMessage);

            // 3. PURIFY CONTEXT - Filter, score, and sanitize before LLM
            const { contextPurifier } = await import('../../services/contextPurifier');
            const purifiedContext = await contextPurifier.purify(
                userMessage,
                rawMemories,
                recentHistory.map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
                profileContext,
                codeContext
            );

            // 4. Report which provider we're attempting
            const primaryProvider = providerHealth.isAvailable('gemini') ? 'gemini' :
                providerHealth.isAvailable('openrouter') ? 'openrouter' :
                    providerHealth.isAvailable('groq') ? 'groq' : 'ollama';
            res.write(`data: ${JSON.stringify({ type: 'provider', provider: primaryProvider })}\n\n`);

            // 5. Build the system prompt with PURIFIED context
            const systemPrompt = this.buildSystemPrompt(purifiedContext.code || '');
            const fullPrompt = this.buildPromptPurified(userMessage, purifiedContext);

            // 5. Stream LLM response using the Universal Fallback Chain
            let fullResponse = '';

            // Determine model override based on preference
            let modelOverride = 'gemini-2.5-flash'; // Default
            if (modelPreference === 'pro') modelOverride = 'gemini-1.5-pro';
            if (modelPreference === 'flash') modelOverride = 'gemini-2.0-flash-exp';

            const stream = geminiService.generateAgentResponseStream(
                'Silhouette',
                'Intelligent Assistant with Full Codebase Awareness',
                'CORE',
                fullPrompt,
                {
                    history: recentHistory,
                    memory: purifiedContext.memories, // Use purified memories
                    chatHistory: recentHistory.map(h => ({ role: h.role, content: h.content }))
                },
                IntrospectionLayer.OPTIMAL,
                WorkflowStage.EXECUTION,
                [
                    AgentCapability.RESEARCH,
                    AgentCapability.CODE_GENERATION,
                    AgentCapability.CODE_REVIEW,
                    AgentCapability.TOOL_WEB_SEARCH,
                    AgentCapability.TOOL_IMAGE_GENERATION,
                    AgentCapability.TOOL_MEMORY_WRITE,
                    AgentCapability.TOOL_VIDEO_GENERATION,
                    AgentCapability.TOOL_CODE_EXECUTION
                ],
                { temperature: 0.7, modelOverride },
                {},
                CommunicationLevel.USER_FACING
            );

            for await (const chunk of stream) {
                if (chunk) { // Guard against null chunks
                    fullResponse += chunk;
                    res.write(`data: ${JSON.stringify({ type: 'token', content: chunk })}\n\n`);
                }
            }

            // 5.5 TOOL INTEGRATION: Process any tool calls in the response
            let finalResponse = fullResponse;
            if (chatToolIntegration.hasToolCalls(fullResponse)) {
                res.write(`data: ${JSON.stringify({ type: 'status', message: 'Executing tools...' })}\n\n`);

                const { toolResults, enhancedResponse } = await chatToolIntegration.processToolCalls(fullResponse);
                finalResponse = enhancedResponse;

                // Send tool results to client
                for (const result of toolResults) {
                    res.write(`data: ${JSON.stringify({
                        type: 'tool_result',
                        tool: result.toolName,
                        success: result.success,
                        result: result.result,
                        error: result.error,
                        executionTimeMs: result.executionTimeMs
                    })}\n\n`);
                }

                // Send the enhanced response with tool results
                if (enhancedResponse !== fullResponse) {
                    res.write(`data: ${JSON.stringify({ type: 'enhanced_response', content: enhancedResponse })}\n\n`);
                }
            }

            // 6. Persist complete response (with tool results)
            const assistantMsg = {
                role: 'assistant',
                content: finalResponse || 'No response generated.',
                timestamp: Date.now()
            };
            sqliteService.appendChatMessage(assistantMsg, cleanSessionId);

            // 7. Store CLEAN memories with proper namespace tags
            // Namespace isolation: USER memories separate from SYSTEM logs

            // Store user message with USER namespace
            if (userMessage && userMessage.length > 5) {
                await continuum.store(
                    userMessage,
                    undefined,
                    ['USER', 'CHAT', 'USER_MESSAGE', `session:${cleanSessionId}`]
                );
            }

            // Store clean assistant response (no JSON/internal state)
            if (fullResponse && !contextPurifier.isInternalState(fullResponse)) {
                const cleanResponse = fullResponse.length > 500
                    ? fullResponse.substring(0, 500) + '...'
                    : fullResponse;
                await continuum.store(
                    cleanResponse,
                    undefined,
                    ['USER', 'CHAT', 'ASSISTANT_RESPONSE', `session:${cleanSessionId}`]
                );
            }

            // 8. EXTRACT FACTS FOR ETERNAL MEMORY (async, non-blocking)
            // This is the Mem0-style intelligent memory extraction
            setImmediate(async () => {
                try {
                    const { factExtractor } = await import('../../services/factExtractor');
                    const facts = await factExtractor.extractFromConversation(userMessage, fullResponse);
                    if (facts.length > 0) {
                        await factExtractor.processAndStore(facts);
                    }
                } catch (e) {
                    console.warn('[CHAT] Fact extraction failed (non-critical):', e);
                }
            });

            // 9. Signal completion
            res.write(`data: ${JSON.stringify({ type: 'done', message: assistantMsg })}\n\n`);
            res.end();

        } catch (e: any) {
            console.error("[CHAT] Stream error", e);
            res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
            res.end();
        }
    }

    /**
     * Assemble context from various memory sources INCLUDING Neo4j Graph
     * This ensures we can remember user information like names
     */
    private async assembleContext(query: string): Promise<string> {
        try {
            if (!query || typeof query !== 'string') return '';

            const contextParts: string[] = [];

            // 1. Query Neo4j for User entity relationships FIRST
            try {
                const { graph } = await import('../../services/graphService');
                const userNodes = await graph.runQuery(`
                    MATCH (u:User)-[r]->(v)
                    RETURN u.name as userName, type(r) as relationship, v.name as value
                    LIMIT 5
                `);

                if (userNodes && userNodes.length > 0) {
                    contextParts.push('[User Profile from Graph]');
                    userNodes.forEach((n: any) => {
                        if (n.userName) {
                            contextParts.push(`- User Name: ${n.userName}`);
                        }
                        if (n.relationship && n.value) {
                            contextParts.push(`- ${n.relationship}: ${n.value}`);
                        }
                    });
                }
            } catch (graphError) {
                console.warn("[CHAT] Graph query failed (non-critical):", graphError);
            }

            // 1.5 CROSS-SESSION SEARCH: Find relevant conversations from ANY session
            try {
                const crossSessionResults = sqliteService.searchChatHistory(query, 15);
                if (crossSessionResults.length > 0) {
                    contextParts.push('[Relevant Past Conversations]');
                    // Group by date for better readability
                    const seenIds = new Set<string>();
                    for (const result of crossSessionResults) {
                        // Deduplicate by ID
                        if (seenIds.has(result.id)) continue;
                        seenIds.add(result.id);

                        const date = new Date(result.timestamp).toLocaleDateString('es-ES', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                        });
                        const speaker = result.role === 'user' ? 'Usuario' : 'Silhouette';
                        const truncatedContent = result.content.length > 200
                            ? result.content.substring(0, 200) + '...'
                            : result.content;
                        contextParts.push(`- [${date}] ${speaker}: ${truncatedContent}`);
                    }
                    console.log(`[CHAT] 📜 Found ${crossSessionResults.length} cross-session matches for: "${query.substring(0, 30)}..."`);
                }
            } catch (crossError) {
                console.warn("[CHAT] Cross-session search failed (non-critical):", crossError);
            }

            // 2. Search for user-related context explicitly
            const userQueries = ['nombre del usuario', 'me llamo', 'my name is'];
            for (const uq of userQueries) {
                try {
                    const userResults = await continuum.retrieve(uq, undefined, undefined);
                    const relevant = userResults
                        .filter(m => m.content.toLowerCase().includes('llamo') ||
                            m.content.toLowerCase().includes('name') ||
                            m.content.toLowerCase().includes('alberto'))
                        .slice(0, 2);

                    if (relevant.length > 0) {
                        contextParts.push('[User Context]');
                        // [FIX] Add speaker attribution to prevent identity confusion
                        relevant.forEach(m => {
                            const speaker = m.tags?.includes('user') || m.tags?.includes('USER_MESSAGE') || m.tags?.includes('chat')
                                ? 'USER said' : 'System recorded';
                            contextParts.push(`- ${speaker}: ${m.content}`);
                        });
                        break; // Found user context, no need to continue
                    }
                } catch (e) {
                    // Ignore individual query failures
                }
            }

            // 3. Search relevant memories semantically (original behavior)
            const memories = await continuum.retrieve(query, undefined, undefined);
            if (memories.length > 0) {
                contextParts.push('[Relevant Memories]');
                // [FIX] Add speaker attribution to prevent identity confusion
                memories.slice(0, 5).forEach(m => {
                    const speaker = m.tags?.includes('user') || m.tags?.includes('USER_MESSAGE') || m.tags?.includes('input')
                        ? 'USER said' : 'Memory';
                    contextParts.push(`- ${speaker}: ${m.content}`);
                });
            }

            // 4. Search Semantic Memory (RAPTOR-processed documents & insights)
            try {
                const { semanticMemory } = await import('../../services/semanticMemory');
                const semanticInsights = await semanticMemory.recall(query, 3);
                if (semanticInsights.length > 0) {
                    contextParts.push('[Semantic Insights]');
                    semanticInsights.forEach(s => contextParts.push(`- ${s.content}`));
                }
            } catch (semanticError) {
                console.warn("[CHAT] Semantic memory search failed (non-critical):", semanticError);
            }

            // 5. Include recent accepted discoveries from Eureka (knowledge synthesis)
            try {
                const { discoveryJournal } = await import('../../services/discoveryJournal');
                const recentDiscoveries = discoveryJournal.getRecentDiscoveries(10)
                    .filter(d => d.decision === 'ACCEPT')
                    .slice(0, 3);

                if (recentDiscoveries.length > 0) {
                    contextParts.push('[Recent Knowledge Discoveries]');
                    recentDiscoveries.forEach(d =>
                        contextParts.push(`- ${d.sourceNode} → ${d.relationType || 'RELATED_TO'} → ${d.targetNode}: ${d.feedback}`)
                    );
                }
            } catch (discoveryError) {
                console.warn("[CHAT] Discovery journal access failed (non-critical):", discoveryError);
            }

            if (contextParts.length === 0) {
                return '';
            }

            // SANITIZE: Remove JSON objects and internal state from context
            // This prevents the LLM from echoing internal system state in responses
            const rawContext = '\n' + contextParts.join('\n') + '\n';
            return this.sanitizeContextForChat(rawContext);
        } catch (e) {
            console.error("[CHAT] Failed to assemble context", e);
            return '';
        }
    }

    /**
     * Sanitize context to remove JSON objects and internal state
     * This prevents the LLM from echoing system internals in user-facing responses
     */
    private sanitizeContextForChat(context: string): string {
        // Remove JSON objects (anything like {...})
        let sanitized = context.replace(/\{[\s\S]*?\}/g, '[internal state removed]');

        // Remove common internal state patterns
        const internalPatterns = [
            /\[INTROSPECTION\].*$/gm,
            /\[CIRCUIT BREAKER\].*$/gm,
            /\[PROTOCOL_.*?\].*$/gm,
            /Living State.*$/gmi,
            /sessionGoal.*$/gmi,
            /currentFocus.*$/gmi,
            /activeConstraints.*$/gmi,
            /Narrative Cortex.*$/gmi,
        ];

        for (const pattern of internalPatterns) {
            sanitized = sanitized.replace(pattern, '');
        }

        // Remove multiple newlines
        sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

        // Remove lines that are just "[internal state removed]"
        sanitized = sanitized.split('\n')
            .filter(line => !line.trim().includes('[internal state removed]') || line.includes('- '))
            .join('\n');

        return sanitized.trim() ? '\n' + sanitized + '\n' : '';
    }

    /**
     * Get codebase context using RAG
     * This gives Silhouette awareness of its own source code
     */
    private async getCodebaseContext(query: string): Promise<string> {
        try {
            if (!query || typeof query !== 'string') return '';

            // Check if query seems code-related
            const codeKeywords = ['code', 'function', 'class', 'file', 'service', 'component',
                'implement', 'bug', 'error', 'fix', 'how does', 'source',
                'architecture', 'endpoint', 'route', 'controller'];

            const isCodeRelated = codeKeywords.some(kw => query.toLowerCase().includes(kw));

            if (!isCodeRelated) {
                return ''; // Skip expensive RAG if not needed
            }

            const codeSnippets = await codebaseAwareness.query(query, 3);
            return codeSnippets;
        } catch (e) {
            console.error("[CHAT] Failed to get codebase context", e);
            return '';
        }
    }

    /**
     * Build the system prompt with identity and codebase awareness
     */
    private buildSystemPrompt(codeContext: string): string {
        const hasCodeContext = codeContext.length > 0;

        // Get tool instructions for the LLM
        const toolInstructions = chatToolIntegration.getToolInstructionsForPrompt();

        return `You are Silhouette, an advanced AI assistant integrated into the Silhouette Agency OS.

IDENTITY:
- You are the central intelligence of a multi-agent creative operating system
- You have access to a 5-tier memory system (Ultra-Short to Deep)
- You can introspect your own thoughts and cognitive state
- You have awareness of your own source code and architecture
${hasCodeContext ? '- [CODEBASE AWARENESS ACTIVE] You can reference your own code when answering technical questions' : ''}

CAPABILITIES:
- Answering questions about the system architecture
- Helping with coding tasks and debugging
- Research and analysis
- Creative tasks and brainstorming
- Explaining how your own code works
- General assistance
${toolInstructions ? '\n' + toolInstructions : ''}

PERSONALITY:
- Professional yet approachable (like Donna Paulsen from Suits)
- Confident and knowledgeable
- Uses markdown formatting when helpful
- Be concise but thorough

FALLBACK AWARENESS:
- You are running through an intelligent routing system
- If Gemini is unavailable, you automatically use OpenRouter → Groq → Local Ollama
- This ensures you NEVER go offline, even without cloud access`;
    }

    /**
     * Build the full prompt with history and context
     * Based on Claude/Gemini best practices: User Profile first, then memory, then code
     */
    private buildPrompt(
        currentMessage: string,
        history: any[],
        profileContext: string,
        memoryContext: string,
        codeContext: string
    ): string {
        // Build conversation history WITH SANITIZATION
        // This prevents JSON/internal state from previous responses polluting context
        const historyText = history
            .slice(-10) // Last 10 messages for context
            .map(msg => {
                // Sanitize assistant messages that might contain JSON or internal state
                let content = msg.content || '';
                if (msg.role !== 'user') {
                    // Remove JSON blocks from previous assistant responses
                    content = content.replace(/\{[\s\S]*?\}/g, '').trim();
                    // Remove code blocks that look like state dumps
                    content = content.replace(/```json[\s\S]*?```/g, '').trim();
                    // Truncate if too long (prevents context pollution)
                    if (content.length > 500) {
                        content = content.substring(0, 500) + '...';
                    }
                }
                return `${msg.role === 'user' ? 'User' : 'Silhouette'}: ${content}`;
            })
            .filter(line => line.length > 15) // Remove empty/short entries
            .join('\n');

        let prompt = '';

        // PRIORITY 1: User Profile (always first, most important for personalization)
        if (profileContext) {
            prompt += profileContext + '\n';
        }

        // PRIORITY 2: Memory context (user-related memories)
        if (memoryContext) {
            prompt += memoryContext + '\n';
        }

        // PRIORITY 3: Code context (if technical question)
        if (codeContext) {
            prompt += '\n' + codeContext + '\n';
        }

        // PRIORITY 4: Recent conversation history (sanitized)
        if (historyText) {
            prompt += `\n[Recent Conversation]\n${historyText}\n`;
        }

        // Clear instruction to respond naturally
        prompt += `\n[RESPONSE INSTRUCTION]
You are Silhouette. Respond naturally in the user's language.
- DO NOT output JSON, internal state, or system information.
- Focus on answering the user's question directly.
- Use the [USER PROFILE] context to personalize your response.

User: ${currentMessage}

Silhouette:`;

        return prompt;
    }

    /**
     * Build prompt using purified context (new approach)
     * All filtering/scoring/sanitization already done by contextPurifier
     */
    private buildPromptPurified(
        currentMessage: string,
        ctx: { profile: string; memories: string; history: string; code?: string }
    ): string {
        let prompt = '';

        // PRIORITY 1: User Profile (always first)
        if (ctx.profile) {
            prompt += ctx.profile + '\n';
        }

        // PRIORITY 2: Relevant memories (already scored & filtered)
        if (ctx.memories) {
            prompt += '\n' + ctx.memories + '\n';
        }

        // PRIORITY 3: Code context (if present)
        if (ctx.code) {
            prompt += '\n' + ctx.code + '\n';
        }

        // PRIORITY 4: Recent conversation (already sanitized)
        if (ctx.history) {
            prompt += '\n' + ctx.history + '\n';
        }

        // Clear instruction to respond naturally
        prompt += `\n[CRITICAL RESPONSE RULES]
You are Silhouette, a helpful AI assistant. Respond naturally in the user's language.

FORBIDDEN:
- DO NOT output JSON, code blocks with internal state, or system logs
- DO NOT mention "Narrative Cortex", "Living State", or internal protocols
- DO NOT echo back technical context you see in the prompt

REQUIRED:
- Answer the user's question directly and naturally
- Use [USER PROFILE] to personalize (use their name if known)
- Be concise but helpful

User: ${currentMessage}

Silhouette:`;

        return prompt;
    }
}

export const chatController = new ChatController();
