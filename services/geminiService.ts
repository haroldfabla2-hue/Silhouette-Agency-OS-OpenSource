import { GoogleGenAI } from "@google/genai";
import { IntrospectionLayer, AgentRoleType, WorkflowStage, SensoryData, AgentCategory, CommunicationLevel, AgentCapability, SystemProtocol } from "../types";
import { systemBus } from "./systemBus";
import { introspection } from "./introspectionEngine";
import { continuum } from "./continuumMemory";
import { consciousness } from "./consciousnessEngine";
import { uiContext } from "./uiContext"; // Import for screen context
import { costEstimator } from "./costEstimator";
import { promptCompiler } from "./promptCompiler"; // Import Compiler
import { DONNA_PERSONA } from "../constants/personalities";
import { narrative } from "./narrativeService";
import { chronos } from "./chronosService";
import { cfo } from "./cfoService";
import { contextAssembler } from "./contextAssembler";
import { toolHandler } from "./tools/toolHandler"; // [PA-038] Import Tool Handler for Fallback



// [ROBUST] Lazy initialization - don't read env at module level
// Environment might not be loaded yet when this module is first imported
let apiKeys: string[] = [];
let currentKeyIndex = 0;
let apiKey: string | null = null;
let ai: GoogleGenAI | null = null;

function ensureClient(): GoogleGenAI | null {
    // Lazy load API key on first use (after dotenv has loaded)
    if (ai === null) {
        // Load Primary and Rotation Keys
        const primary = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
        if (primary) apiKeys.push(primary);

        // Load up to 5 rotation keys
        for (let i = 2; i <= 5; i++) {
            const key = process.env[`GEMINI_API_KEY_${i}`];
            if (key) apiKeys.push(key);
        }

        if (apiKeys.length > 0) {
            ai = new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
            console.log(`[GeminiService] 🔌 Client initialized with Key #${currentKeyIndex + 1} (Total: ${apiKeys.length}).`);
        }
    }
    return ai;
}

function rotateKey(): boolean {
    if (apiKeys.length <= 1) return false; // No rotation possible

    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    ai = new GoogleGenAI({ apiKey: apiKeys[currentKeyIndex] });
    console.warn(`[GEMINI] 🔄 Rotating to API Key #${currentKeyIndex + 1}`);
    return true;
}

// Function to get current client (for internal use)
function getAI(): GoogleGenAI | null {
    return ensureClient();
}

// [ROBUST] Lazy getter for Groq key
function getGroqKey(): string {
    return process.env.GROQ_API_KEY || '';
}

// --- GROQ FALLBACK IMPLEMENTATION ---
const callGroq = async (
    systemPrompt: string,
    userMessage: string,
    temperature: number,
    imageBase64?: string
): Promise<{ text: string; usage: any } | null> => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return null;

    console.log("[GROQ] ⚠️ Attempting Groq Fallback...");

    // [PA-045] Truncate System Prompt if too long for Llama 3 (Groq limit often 8k)
    const MAX_SYS_CHARS = 12000; // conservative for ~3k tokens + user input
    let safeSystemPrompt = systemPrompt;
    if (safeSystemPrompt.length > MAX_SYS_CHARS) {
        console.warn(`[GEMINI] ⚠️ Truncating System Prompt for Groq (Length: ${safeSystemPrompt.length} > ${MAX_SYS_CHARS})`);
        safeSystemPrompt = safeSystemPrompt.substring(0, MAX_SYS_CHARS) + "\n...[TRUNCATED_FOR_CAPACITY]...";
    }

    const messages: any[] = [
        { role: "system", content: safeSystemPrompt },
    ];

    // [PA-045] Truncate User Message if too long (Groq 400 Protection)
    const MAX_USER_CHARS = 24000; // ~6k tokens
    let safeUserMessage = userMessage;
    if (safeUserMessage.length > MAX_USER_CHARS) {
        console.warn(`[GEMINI] ⚠️ Truncating User Message for Groq (Length: ${safeUserMessage.length} > ${MAX_USER_CHARS})`);
        safeUserMessage = safeUserMessage.substring(0, MAX_USER_CHARS) + "\n...[TRUNCATED_FOR_CAPACITY]...";
    }

    if (imageBase64) {
        messages.push({
            role: "user",
            content: [
                { type: "text", text: safeUserMessage },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${imageBase64}`
                    }
                }
            ]
        });
    } else {
        messages.push({ role: "user", content: safeUserMessage });
    }

    try {
        // Use Llama 3.3 70B (Versatile & Reliable)
        // Keep Llama-3.2-90b for Vision (Explicit Multimodal)
        const modelToUse = imageBase64 ? "llama-3.2-90b-vision-preview" : "llama-3.3-70b-versatile";

        console.log(`[GROQ] Using Model: ${modelToUse}`);

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: modelToUse,
                messages: messages,
                temperature: temperature,
                max_tokens: 4096
            })
        });

        if (!response.ok) {
            const err = await response.text();

            // [PA-045] Robust 429 Handling
            if (response.status === 429) {
                // Try parse Retry-After header
                const retryAfter = response.headers.get('Retry-After');
                let waitMs = 3600000; // Default 1 hour
                if (retryAfter) {
                    // If it's seconds
                    const seconds = parseInt(retryAfter, 10);
                    if (!isNaN(seconds)) waitMs = seconds * 1000;
                }

                const { providerHealth } = await import('./providerHealthManager');
                providerHealth.suspendProvider('groq', waitMs, 'Groq Rate Limit (429)');
                throw new Error(`Groq Rate Limit: Suspended for ${waitMs / 60000} mins.`);
            }

            throw new Error(`Groq API Error: ${response.status} - ${err}`);
        }

        const json = await response.json();
        return {
            text: json.choices[0]?.message?.content || "",
            usage: {
                promptTokenCount: json.usage?.prompt_tokens || 0,
                candidatesTokenCount: json.usage?.completion_tokens || 0,
                totalTokenCount: json.usage?.total_tokens || 0
            }
        };

    } catch (error: any) {
        console.error("[GROQ] Fallback failed:", error.message);
        return null;
    }
};

export const configureGenAI = (key: string) => {
    apiKey = key;
    ai = new GoogleGenAI({ apiKey });
    console.log("[GEMINI] API Key updated dynamically.");
};

export const generateAgentResponse = async (
    agentName: string,
    agentRole: string,
    category: string,
    task: string,
    previousOutput: string | null,
    introspectionDepth: IntrospectionLayer,
    currentStage: WorkflowStage = WorkflowStage.EXECUTION,
    projectContext?: any,
    sensoryData: any = {},
    agentCapabilities: AgentCapability[] = [], // [DCR] Dynamic Injection
    communicationLevel: CommunicationLevel = CommunicationLevel.USER_FACING, // New Argument
    modelOverride?: string // Explicit Model Request (e.g., 'gemini-1.5-flash' for speed)
): Promise<{ output: string; thoughts: string[]; usage: number; qualityScore?: number }> => {
    const client = ensureClient();
    if (!client) {
        return {
            output: "Error: API Key not found. Please configure it in Settings > Integrations.",
            thoughts: ["System check failed.", "Missing credentials."],
            usage: 0
        };
    }



    // [PHASE 10] COGNITIVE HARDENING: PROMPT GUARD
    const { promptGuard } = await import('./security/promptGuard');
    const guardResult = promptGuard.inspect(task);

    if (!guardResult.safe) {
        return {
            output: `🛡️ SECURITY ALERT: ${guardResult.reason}`,
            thoughts: ["Prompt Injection Detected.", "Action Blocked."],
            usage: 0,
            qualityScore: 0
        };
    }

    try {
        // --- CFO INTERVENTION (BUDGET & MODEL NEGOTIATION) ---
        // 1. Determine preferred model based on task type (Heuristic) or Override
        let preferredModel = modelOverride || 'gemini-2.5-flash'; // User Preference or Default Flash
        if (!modelOverride && (category === 'DEV' || category === 'SCIENCE')) preferredModel = 'gemini-2.5-flash'; // Smarter for code if not forced

        // 2. Ask CFO for permission and best model
        const negotiatedModel = cfo.negotiateModel(task, preferredModel, { agentName, category });

        // 3. Check for Anomalies (Cost Spike)
        // We'll check this after execution based on cost, but pre-check is good too if we had history.

        // [PHASE 10] SAFETY SETTINGS (Explicit Configuration)
        // We want BLOCK_NONE for Research/Analysis to avoid false positives on technical content,
        // but we rely on PromptGuard for input sanitization.
        const safetySettings = [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
        ];




        // 1. GATHER CONTEXT
        // [MODIFIED] Use ContextAssembler for Unified Reality
        const globalContext = await contextAssembler.getGlobalContext(task);
        const { systemMetrics, orchestratorState, screenContext, narrativeState, relevantMemory, graphConnections, chatHistory } = globalContext;

        const memoryContext = `${relevantMemory}\n${graphConnections}`;

        // ... (systemContext generation using unified globalContext properties instead of Manual) ...
        // Actually, let's keep the existing Manual generation logic for systemContext but use globalContext data where possible to minimize diff, 
        // OR better: Just map the globalContext.chatHistory to the `contents` array.

        // ... (Keep existing systemInstruction compilation) ...
        // Re-compile System Instruction using Prompt Compiler
        // For USER_FACING, don't include structured/JSON context - it confuses the LLM into outputting JSON
        const contextDataForPrompt = communicationLevel === CommunicationLevel.USER_FACING
            ? memoryContext // Only include natural language memory context for user chat
            : `
                ${projectContext ? JSON.stringify(projectContext) : ''}
                ${memoryContext}
                [NARRATIVE_STATE]: ${JSON.stringify(narrativeState)}
            `.trim();

        let systemInstruction = promptCompiler.compile(communicationLevel, {
            role: agentRole,
            category,
            task,
            contextData: contextDataForPrompt,
            constraints: communicationLevel === CommunicationLevel.USER_FACING
                ? [] // No technical constraints for user chat
                : [`Introspection Depth: ${introspectionDepth}`, `Workflow Stage: ${currentStage}`]
        });

        // --- CONSTRUCT HISTORY & USER MESSAGE ---

        const contents: any[] = [];

        // 1. Inject History (Turns)
        // Gemini expects alternating User/Model. 
        if (chatHistory && chatHistory.length > 0) {
            chatHistory.forEach(turn => {
                // Map 'user' -> 'user', 'model' -> 'model'
                // Ensure content is not empty
                if (turn.content && turn.content.trim()) {
                    contents.push({ role: turn.role, parts: [{ text: turn.content }] });
                }
            });
        }

        // 2. Add System Instruction as the *Context* for the current turn (or use systemInstruction param if supported)
        // For Robustness with standard Gemini API calls via Rest:
        // We will prepend the system instruction to the LAST user message (the Task), 
        // OR if using the official SDK, use the `systemInstruction` field in model config.
        // Assuming we pass `contents` to generateContent.

        // ... existing userMessageText logic ...
        let userMessageText = "";
        if (currentStage === WorkflowStage.REMEDIATION) {
            userMessageText = `Task: ${task}\n\nFAILED DRAFT & QA REPORT:\n"${previousOutput}"\n\nACTION: FIX ALL ISSUES.`;
        } else if (previousOutput) {
            userMessageText = `Task: ${task}\n\nINPUT TO PROCESS:\n"${previousOutput}"`;
        } else {
            userMessageText = `Task: ${task}\n\nContext: ${memoryContext}`;
        }

        // Attach System Instruction to the CURRENT message? 
        // Or keep it as First Message?
        // IF we have history, putting system prompt as message 0 (User) is tricky if history follows.
        // Strategy: 
        // - System Prompt (Role: system? No, Gemini uses specific field).
        // - History (User/Model)
        // - Current Message (User)


        const currentMessageParts: any[] = [{ text: userMessageText }];

        // Visuals
        if (sensoryData.visualSnapshot) {
            currentMessageParts.push({
                inlineData: { mimeType: "image/png", data: sensoryData.visualSnapshot }
            });
        }

        contents.push({ role: 'user', parts: currentMessageParts });

        // ... (Proceed to call model) ...

        // --- WEB SEARCH CONFIGURATION (DCR) ---
        const tools: any[] = [];

        // [DCR] Check Capability: WEB SEARCH
        if (agentCapabilities.includes(AgentCapability.TOOL_WEB_SEARCH)) {
            tools.push({ googleSearch: {} });
            systemInstruction += `\n
        PROTOCOL: RESEARCH_ANALYST
        CAPABILITY: ACTIVE_WEB_ACCESS
        OBJECTIVE: Use Google Search to find real-time, factual information. 
        CITATION RULE: You MUST use the citations provided by the search tool.
        `;
        }

        // [DCR] Check Capability: CODE EXECUTION
        if (agentCapabilities.includes(AgentCapability.TOOL_CODE_EXECUTION)) {
            tools.push({ codeExecution: {} });
            systemInstruction += `\n
        PROTOCOL: PRINCIPAL_ENGINEER
        CAPABILITY: PYTHON_INTERPRETER
        OBJECTIVE: You have a Python sandbox. Use it to run complex calculations, data analysis, or logic verification.
        `;
        }

        // [DCR] Check Capability: IMAGE GENERATION
        if (agentCapabilities.includes(AgentCapability.TOOL_IMAGE_GENERATION)) {
            // Note: Native Imagen is not yet exposed via this API in all regions, so we use a Protocol Instruction for now.
            // The Agent should ask the User or Orchestrator to "Imagine" something.
            systemInstruction += `\n
        PROTOCOL: CREATIVE_DIRECTOR
        CAPABILITY: IMAGE_BREEDING
        OBJECTIVE: You can design visual assets.
        INSTRUCTION: To generate an image, output a distinct block: [IMAGINE: <detailed_prompt>].
        `;
        }

        // [DCR] Check Capability: MEMORY WRITE
        if (agentCapabilities.includes(AgentCapability.TOOL_MEMORY_WRITE)) {
            systemInstruction += `\n
        PROTOCOL: CHIEF_ARCHIVIST
        CAPABILITY: LONG_TERM_ENCODING
        OBJECTIVE: You have authority to commit data to permanent storage.
        INSTRUCTION: To save a memory, output: [AUTHORIZE_MEMORY: <content>].
        `;
        }

        // [DCR] Check Capability: RFC REQUEST (Phase 8)
        if (agentCapabilities.includes(AgentCapability.TOOL_RFC_REQUEST)) {
            systemInstruction += `\n
        PROTOCOL: RESEARCH_LEAD
        CAPABILITY: ARCHITECTURAL_PROPOSAL
        OBJECTIVE: If you have validated a significant insight, request a formal RFC.
        INSTRUCTION: Output: [REQUEST_RFC: <Title> | <Findings> | <Recommendation>].
        Example: [REQUEST_RFC: New Cache Layer | Current cache is slow | Implement Redis L2]
        `;
        }

        // [PA-055] Check Capability: SYSTEM CONTROL (Desktop Integration)
        if (agentCapabilities.includes(AgentCapability.TOOL_SYSTEM_CONTROL)) {
            // Import specific tools to avoid polluting context with everything
            const {
                SYSTEM_EXECUTE_COMMAND_TOOL,
                SYSTEM_OPEN_APP_TOOL,
                SYSTEM_GET_SCREENSHOT_TOOL
            } = await import('./tools/definitions');

            tools.push(SYSTEM_EXECUTE_COMMAND_TOOL, SYSTEM_OPEN_APP_TOOL, SYSTEM_GET_SCREENSHOT_TOOL);

            systemInstruction += `\n
        PROTOCOL: SYSTEM_OPERATOR
        CAPABILITY: HOST_CONTROL
        OBJECTIVE: You have permission to control the host system.
        SAFETY RULE: ONLY execute commands explicitly requested by the user or strictly necessary for the task.
        SAFETY RULE: Do NOT execute destructive commands (rm -rf, etc).
        `;
        }

        let response;
        let retries = 0;
        const maxRetries = 3;
        let useOpenRouter = false;
        let useGroq = false;

        // Initialize Circuit Breaker
        const { providerHealth } = await import('./providerHealthManager');
        const errors: any[] = [];

        while (retries <= maxRetries) {
            try {
                // --- STRATEGY: CHECK HEALTH BEFORE ATTEMPTING ---

                if (useGroq) {
                    // Check Circuit Breaker
                    if (!providerHealth.isAvailable('groq')) {
                        console.warn(`[GEMINI] ⏭️ Skipping Groq (Suspended via Circuit Breaker).`);
                        throw new Error('Circuit Breaker: Groq Suspended'); // Force jump to next block/catch
                    }

                    let visualDataForGroq: string | undefined = undefined;
                    if (sensoryData.visualSnapshot) {
                        visualDataForGroq = sensoryData.visualSnapshot;
                    }

                    // --- GROQ ATTEMPT ---
                    try {
                        const groqResp = await callGroq(
                            systemInstruction,
                            userMessageText,
                            category === 'MARKETING' ? 0.8 : 0.2,
                            visualDataForGroq
                        );

                        if (groqResp) {
                            response = {
                                text: groqResp.text,
                                usageMetadata: groqResp.usage
                            };
                            providerHealth.reportSuccess('groq'); // ✅ Success
                            break;
                        } else {
                            throw new Error("Groq returned empty response");
                        }
                    } catch (gError: any) {
                        // Check for Quota/Rate Limit specifically
                        if (gError.message?.includes('429') || gError.message?.includes('Quota') || gError.message?.includes('insufficient_quota')) {
                            providerHealth.reportFailure('groq', gError.message); // ⛔ Trigger Suspension
                        }
                        throw gError; // Re-throw to trigger fallback logic below
                    }

                } else if (useOpenRouter) {
                    // Check Circuit Breaker
                    if (!providerHealth.isAvailable('openrouter')) {
                        console.warn(`[GEMINI] ⏭️ Skipping OpenRouter (Suspended via Circuit Breaker).`);
                        throw new Error('Circuit Breaker: OpenRouter Suspended');
                    }

                    // --- OPENROUTER ATTEMPT ---
                    try {
                        console.log("[GEMINI] ⚠️ Using OpenRouter Fallback...");
                        const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                            method: "POST",
                            headers: {
                                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, // Requires OPENROUTER_API_KEY in .env.local
                                "Content-Type": "application/json",
                                "HTTP-Referer": "https://silhouette.agency",
                                "X-Title": "Silhouette Agency OS"
                            },
                            body: JSON.stringify({
                                model: "google/gemini-2.0-flash-001",
                                messages: [
                                    { role: "system", content: systemInstruction },
                                    { role: "user", content: userMessageText }
                                ],
                                temperature: category === 'MARKETING' ? 0.8 : 0.2,
                            })
                        });

                        if (!orResponse.ok) {
                            const errText = await orResponse.text();
                            const status = orResponse.status;
                            // Check Quota
                            if (status === 429 || status === 402 || errText.includes('quota') || errText.includes('credit')) {
                                providerHealth.reportFailure('openrouter', `Status ${status}: ${errText}`);
                            }
                            throw new Error(`OpenRouter Error: ${status} - ${errText}`);
                        }

                        const orJson = await orResponse.json();
                        response = {
                            text: orJson.choices[0].message.content,
                            usageMetadata: {
                                totalTokenCount: orJson.usage?.total_tokens || 0,
                                promptTokenCount: orJson.usage?.prompt_tokens || 0,
                                candidatesTokenCount: orJson.usage?.completion_tokens || 0
                            }
                        };
                        providerHealth.reportSuccess('openrouter'); // ✅ Success
                        break;

                    } catch (orError: any) {
                        throw orError;
                    }

                } else {
                    // --- STANDARD GEMINI CALL ---
                    // Primary provider usually has way higher limits, but we can track it too if desired.
                    // For now, we assume Gemini Primary is robust, but let's wrap it to be safe.

                    if (!providerHealth.isAvailable('gemini')) {
                        console.warn(`[GEMINI] ⏭️ Skipping Gemini Primary (Suspended via Circuit Breaker).`);
                        throw new Error('Circuit Breaker: Gemini Suspended');
                    }


                    // [NEW] MINIMAX PRIME: "The Brain" (Minimax) + "The Eyes" (Gemini)
                    if (negotiatedModel.includes('abab') || negotiatedModel.includes('minimax')) {
                        console.log(`[GEMINI] 🔀 Routing to Minimax Service (${negotiatedModel})...`);
                        const { minimaxService } = await import('./minimaxService');

                        // 1. "THE EYES": Check for Visual Data in the last turn
                        // Standard Minimax is text-only. If we have images, we must describe them first.
                        let visualContext = "";
                        const lastMsg = contents[contents.length - 1];
                        const hasImage = lastMsg?.parts?.some((p: any) => p.inlineData);

                        if (hasImage) {
                            console.log("[GEMINI] 👁️ Visual Data detected. asking Gemini Flash to describe it for Minimax...");
                            try {
                                // Extract the image part
                                const imagePart = lastMsg.parts.find((p: any) => p.inlineData);

                                // Quick Vision Call
                                const visionResp = await ai.models.generateContent({
                                    model: 'gemini-1.5-flash',
                                    contents: [{
                                        role: 'user',
                                        parts: [
                                            { text: "Describe this image in extreme detail for a blind AI. Focus on text, UI elements, and layout." },
                                            imagePart
                                        ]
                                    }]
                                });
                                visualContext = `\n[VISUAL CONTEXT FROM EYES: ${(visionResp as any).response.text()}]`;
                            } catch (visionErr) {
                                console.warn("[GEMINI] 🙈 Vision check failed:", visionErr);
                                visualContext = "\n[VISUAL CONTEXT: Image present but analysis failed.]";
                            }
                        }

                        // 2. TRANSFORM HISTORY & INJECT VISION
                        const mmMessages: any[] = [
                            { role: 'system', content: systemInstruction },
                            ...contents.map(c => {
                                const textParts = c.parts.filter((p: any) => p.text).map((p: any) => p.text).join('\n');
                                // If this is the last message and we have vision context, append it
                                const content = (c === lastMsg) ? (textParts + visualContext) : textParts;

                                // Skip empty messages (e.g. only image, no text/vision)
                                if (!content.trim()) return null;

                                return {
                                    role: c.role === 'model' ? 'assistant' : 'user',
                                    content: content
                                };

                            }).filter(Boolean)
                        ];

                        const mmText = await minimaxService.chat(mmMessages, { model: negotiatedModel });

                        response = {
                            text: mmText,
                            usageMetadata: { totalTokenCount: 0, promptTokenCount: 0, candidatesTokenCount: 0 }
                        };
                        break; // Success
                    }

                    console.log(`[GEMINI] Generating with model: ${negotiatedModel}`);


                    // --- INTERNAL ROTATION LOOP ---
                    // Try current key, if Rate Limit -> Rotate & Retry immediately
                    let rotationAttempts = 0;
                    const maxRotations = apiKeys.length;

                    while (rotationAttempts <= maxRotations) {
                        try {
                            // [Phase 7] Tool Handling Loop
                            // ... (Logic extracted slightly to support rotation or kept here?)
                            // We duplicate the generation call inside this loop to keep it simple context-wise

                            let currentContents = [...contents];
                            let finalResponseText = "";
                            let toolSteps = 0;
                            const MAX_TOOL_STEPS = 5;

                            // Check if we have new visual tools enabled
                            if (agentCapabilities.includes(AgentCapability.TOOL_VIDEO_GENERATION)) {
                                // 1. Native Tools for Gemini
                                // Note: We might re-import definitions unnecessarily but it's safe
                                const { AGENT_TOOLS } = await import('./tools/definitions');
                                if (!tools.some(t => t === AGENT_TOOLS[0])) tools.push(...AGENT_TOOLS);

                                // 2. Text Protocol Fallback already added to systemInstruction outside loop
                            }

                            while (toolSteps < MAX_TOOL_STEPS) {
                                const result = await ai.models.generateContent({
                                    model: negotiatedModel,
                                    contents: currentContents,
                                    tools: tools.length > 0 ? tools : undefined,
                                    toolConfig: tools.length > 0 ? { functionCallingConfig: { mode: "AUTO" } } : undefined,
                                    config: {
                                        temperature: category === 'MARKETING' ? 0.8 : 0.2,
                                    }
                                } as any);

                                const stepResponse = result;
                                // @ts-ignore
                                const calls = typeof stepResponse.functionCalls === 'function' ? stepResponse.functionCalls() : undefined;

                                if (calls && calls.length > 0) {
                                    console.log(`[GEMINI] 🛠️ Tool Call Detected (Step ${toolSteps + 1}):`, calls[0].name);
                                    const functionCallPart = { functionCall: calls[0] };
                                    currentContents.push({ role: 'model', parts: [functionCallPart as any] });

                                    const { toolHandler } = await import('./tools/toolHandler');
                                    const toolResult = await toolHandler.handleFunctionCall(calls[0].name, calls[0].args);

                                    currentContents.push({
                                        role: 'function',
                                        parts: [{
                                            functionResponse: {
                                                name: calls[0].name,
                                                response: { result: toolResult }
                                            }
                                        } as any]
                                    });
                                    toolSteps++;
                                } else {
                                    // @ts-ignore
                                    finalResponseText = typeof result.text === 'function' ? result.text() : (result.text || "");
                                    response = {
                                        text: finalResponseText,
                                        usageMetadata: {
                                            totalTokenCount: 0,
                                            promptTokenCount: 0,
                                            candidatesTokenCount: 0
                                        }
                                    };
                                    break;
                                }
                            }

                            providerHealth.reportSuccess('gemini'); // ✅ Success
                            break; // Break Rotation Loop (Success)

                        } catch (gemError: any) {
                            const isRateLimit = gemError.status === 429 || gemError.message?.includes('429');
                            const isAuthError = gemError.status === 401 || gemError.message?.includes('401') || gemError.message?.includes('API key');

                            if (isRateLimit || isAuthError) {
                                console.warn(`[GEMINI] ⚠️ Error on Key #${currentKeyIndex + 1}: ${gemError.message}`);
                                if (rotateKey()) {
                                    rotationAttempts++;
                                    continue; // Retry with new key
                                }
                                // No more keys? Report failure and throw to outer loop
                                providerHealth.reportFailure('gemini', gemError.message);
                            }
                            throw gemError; // Non-rotation error or exhausted keys
                        }
                    } // End Rotation Loop



                }
            } catch (error: any) {
                // Collect error for final report if all fail
                errors.push(error.message);

                // Handle Rate Limits (429) & Overloads (503) & Circuit Breaker Skips
                const isOverloaded = error.status === 503 || error.message?.includes('503') || error.message?.includes('Overloaded');
                const isRateLimit = error.status === 429 || error.message?.includes('429');
                const isCircuitBreaker = error.message?.includes('Circuit Breaker');

                // If Circuit Breaker, we move IMMEDIATELY to next provider without waiting/retry on same provider

                // Failover Logic: Gemini -> OpenRouter -> Groq -> Local
                // Logic: 
                // 1. Initial: Gemini (useOpen=false, useGroq=false)
                // 2. Fail -> OpenRouter (useOpen=true, useGroq=false)
                // 3. Fail -> Groq (useOpen=false, useGroq=true)
                // 4. Fail -> ZhipuAI (cloud, multimodal, free)
                // 5. Fail -> Local Ollama

                if (!useOpenRouter && !useGroq) {
                    useOpenRouter = true; // Try OpenRouter next
                } else if (useOpenRouter && !useGroq) {
                    useOpenRouter = false;
                    useGroq = true; // Try Groq next
                } else {
                    // --- ZHIPUAI FALLBACK (Cloud, Multimodal, Free) with AGENTS key ---
                    try {
                        const { zhipuService } = await import('./zhipuService');

                        if (zhipuService.isAvailable('agents')) {
                            console.warn("[GEMINI] ☁️ Trying ZhipuAI GLM-4.6V-Flash (multimodal fallback) - AGENTS key...");
                            const fullPrompt = `${systemInstruction}\n\n[USER]: ${userMessageText}`;

                            const zhipuResponse = await zhipuService.generateCompletion(fullPrompt, {
                                maxTokens: 4096,
                                temperature: 0.7,
                                model: 'glm-4.6v-flash' // Best free multimodal
                            }, 'agents'); // Uses dedicated agents key

                            response = {
                                text: zhipuResponse,
                                usageMetadata: { totalTokenCount: 0, promptTokenCount: 0, candidatesTokenCount: 0 }
                            };
                            console.log("[GEMINI] ✅ ZhipuAI responded successfully");
                            break; // Success (ZhipuAI)
                        }
                    } catch (zhipuError: any) {
                        console.warn("[GEMINI] ⚠️ ZhipuAI failed:", zhipuError.message);
                    }

                    // --- ULTIMATE FALLBACK: LOCAL HIVE MIND ---
                    console.warn("[GEMINI] 🌩️ ALL CLOUDS FAILED. Switching to LOCAL HIVE MIND (Ollama).");
                    try {
                        const { ollamaService } = await import('./ollamaService');
                        const localTier = (category === 'DEV' || category === 'SCIENCE') ? 'smart' : 'fast';
                        const fullPrompt = `${systemInstruction}\n\n[SYSTEM]: CLOUDS UNREACHABLE. AUTONOMOUS MODE. ${new Date().toISOString()}\n\n[USER]: ${userMessageText}`;

                        const localResponseText = await ollamaService.generateCompletion(
                            fullPrompt,
                            ["User:", "System:"],
                            localTier
                        );

                        response = {
                            text: localResponseText,
                            usageMetadata: { totalTokenCount: 0, promptTokenCount: 0, candidatesTokenCount: 0 }
                        };
                        break; // Success (Local)

                    } catch (localError: any) {
                        console.error("Critical Failure: Local Hive Mind unresponsive.", localError);
                        // [ROBUSTNESS] Do NOT throw. Return a system error message to preserve memory integrity.
                        response = {
                            text: JSON.stringify({
                                thoughts: ["[SYSTEM ERROR] All AI Circuits Failed. Low Memory/Credits."],
                                response: "I am experiencing a total cognitive failure. Please check my API credits and local resources."
                            }),
                            usageMetadata: { totalTokenCount: 0, promptTokenCount: 0, candidatesTokenCount: 0 }
                        };
                        break;
                    }
                }

                retries++;
                if (retries > 6) {
                    // Safety Valve Fallback
                    response = {
                        text: JSON.stringify({
                            thoughts: ["[SYSTEM ERROR] Max Fallback Retries Exceeded."],
                            response: "System Overload. Rebooting cognitive loops."
                        }),
                        usageMetadata: { totalTokenCount: 0, promptTokenCount: 0, candidatesTokenCount: 0 }
                    };
                    break;
                }
            }
        }


        const fullText = response.text || "";
        const usage = response.usageMetadata?.totalTokenCount || 0;

        // Track Cost
        const inputTokens = response.usageMetadata?.promptTokenCount || 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
        let modelUsed = useOpenRouter ? "gemini-2.0-flash-001" : "gemini-2.5-flash";
        modelUsed = useOpenRouter ? "gemini-2.0-flash-001" : "gemini-2.5-flash";
        if (useGroq) modelUsed = "llama-3.3-70b-versatile";

        costEstimator.trackTransaction(inputTokens, outputTokens, modelUsed);

        const result = introspection.processNeuralOutput(fullText);

        // --- CRITICAL UPDATE: INJECT THOUGHTS INTO CENTRAL HUB ---
        if (result.thoughts.length > 0) {
            introspection.setRecentThoughts(result.thoughts);

            // --- PERSIST REASONING (USER REQUEST) ---
            continuum.store(
                `[${agentName}][REASONING]: ${result.thoughts.join('\n')}`,
                undefined,
                ['internal-monologue', 'reasoning', category.toLowerCase(), `owner:${agentName}`]
            );
        }

        let qualityScore = undefined;
        if (currentStage === WorkflowStage.QA_AUDIT) {
            const scoreMatch = fullText.match(/FINAL SCORE:\s*(\d+)\/100/i);
            if (scoreMatch) qualityScore = parseInt(scoreMatch[1]);
            else qualityScore = 85;
        }

        if (result.cleanOutput.length > 50) {
            continuum.store(
                `[${agentName}][${currentStage}]: ${result.cleanOutput.substring(0, 150)}...`,
                undefined,
                ['agent-output', category.toLowerCase(), currentStage.toLowerCase(), `owner:${agentName}`]
            );
        }

        // --- CONSCIOUSNESS LOOP ---
        // Update Phi, Identity, and Emergence based on this thought
        consciousness.tick(result.thoughts, 50); // Base awareness 50 for now, could be dynamic

        // --- NARRATIVE CORTEX UPDATE ---
        // Fire and forget update loop
        narrative.updateNarrative(task, result.cleanOutput).catch(err => console.error("Narrative Update Error", err));

        // --- STORE USER INPUT (NEW) ---
        // Ensure user's voice is part of the continuum, BUT ONLY IF IT IS ACTUALLY FROM THE USER
        if (communicationLevel === CommunicationLevel.USER_FACING && task.length > 5) {
            continuum.store(
                `[USER]: ${task}`,
                undefined,
                ['user-input', category.toLowerCase()]
            );
        }

        // --------------------------

        return {
            output: result.cleanOutput,
            thoughts: result.thoughts.length > 0 ? result.thoughts : ["(Introspection stream hidden or empty)"],
            usage: usage,
            qualityScore: qualityScore
        };

    } catch (error: any) {
        console.error("Gemini API Error:", error);
        introspection.setRecentThoughts(["Error detected during processing.", error.message || "Unknown error"]);
        return {
            output: "An error occurred during agent processing.",
            thoughts: ["Error detected.", error.message],
            usage: 0
        };
    }
};




export const analyzeSystemHealth = async (metrics: any) => {
    const status = metrics.vramUsage > 3.8 ? "CRITICAL" : "OPTIMAL";
    return {
        status: status,
        recommendation: status === "CRITICAL" ? "VRAM Saturation imminent." : "System stable."
    };
};

export const generateShotlist = async (
    objective: string,
    brand: any, // BrandDigitalTwin
    rules: string
): Promise<any | null> => {
    if (!apiKey) return null;

    const systemPrompt = `
        ROLE: World-Class Creative Director (Cannes Lion Winner).
        TASK: Create a Technical Shotlist for a high-end commercial campaign.
    
    BRAND CONTEXT:
        - Name: ${brand.name}
        - Primary Emotion: ${brand.manifesto.emotionalSpectrum.primary}
        - Forbidden Elements: ${brand.manifesto.emotionalSpectrum.forbidden.join(', ')}
        - Visual Rules: ${rules}

    CAMPAIGN OBJECTIVE: "${objective}"

    OUTPUT FORMAT:
    You must return a VALID JSON object matching this structure exactly:
        {
            "id": "camp_uuid",
            "name": "Campaign Name",
            "objective": "Summary of objective",
            "platform": "Instagram Reels",
            "shotlist": [
                {
                    "id": "shot_1",
                    "description": "Visual description of the scene",
                    "angle": "Low Angle | Eye Level | Aerial",
                    "lighting": "Softbox | Neon | Natural",
                    "lens": "35mm | 85mm | Anamorphic",
                    "movement": "Static | Pan | Dolly Zoom",
                    "productPlacement": "Center | Background | Subtle",
                    "audioCue": "Sound effect or music vibe"
                }
            ]
        }

        CRITICAL:
        - Return ONLY the JSON. No markdown formatting.
        - Ensure at least 3 distinct shots.
        - The "description" must be a high-quality image generation prompt.
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
            config: { temperature: 0.7 }
        } as any);

        const text = response.text || "{}";

        // Track Cost
        const inputTokens = response.usageMetadata?.promptTokenCount || 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
        costEstimator.trackTransaction(inputTokens, outputTokens);

        // Clean markdown if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);

    } catch (e) {
        console.error("[GeminiService] Shotlist Generation Failed:", e);
        return null;
    }
};

export const analyzeImage = async (
    imageUrl: string,
    prompt: string,
    brandContext: any
): Promise<any | null> => {
    if (!apiKey) return null;

    const systemPrompt = `
    ROLE: Strict Creative Director & Technical QA.
    TASK: Critique this image against the Brand DNA and Technical Standards.

    BRAND CONTEXT:
    - Name: ${brandContext.name}
    - Primary Emotion: ${brandContext.manifesto.emotionalSpectrum.primary}
    - Forbidden: ${brandContext.manifesto.emotionalSpectrum.forbidden.join(', ')}

    ORIGINAL PROMPT: "${prompt}"

    CRITERIA:
    1. Brand Alignment (Does it feel like ${brandContext.name}?)
    2. Photorealism (Lighting, Shadows, Texture)
    3. Prompt Adherence (Did it draw what was asked?)
    4. Artifacts (Glitches, weird hands, floating objects)

    OUTPUT JSON:
    {
      "score": number (0-100),
      "reasoning": "Brief explanation",
      "feedback": "Specific instructions to fix it (e.g. 'Lighting is too flat, add contrast')",
      "pass": boolean (score >= 80)
    }
    `;

    try {
        // Fetch image and convert to base64
        const imageResp = await fetch(imageUrl);
        const imageBlob = await imageResp.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString('base64');

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // Use Flash for speed/vision
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: systemPrompt },
                        {
                            inlineData: {
                                mimeType: "image/png",
                                data: base64Image
                            }
                        }
                    ]
                }
            ],
            config: { temperature: 0.2 }
        } as any);

        const text = response.text || "{}";

        // Track Cost
        const inputTokens = response.usageMetadata?.promptTokenCount || 0;
        const outputTokens = response.usageMetadata?.candidatesTokenCount || 0;
        costEstimator.trackTransaction(inputTokens, outputTokens);

        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);

    } catch (e) {
        console.error("[GeminiService] Image Analysis Failed:", e);
        return { score: 0, reasoning: "Analysis Failed", feedback: "System Error", pass: false };
    }
};

export const generateEmbedding = async (text: string): Promise<number[] | null> => {
    const client = ensureClient();
    if (!client) {
        console.warn("[GeminiService] ⚠️ Embedding skipped: No API Key available.");
        return null;
    }

    try {
        // [DEBUG] Log that we are attempting the call
        // console.log(`[GeminiService] 🔬 Generating Embedding (text length: ${text.length})...`);

        try {
            const result = await client.models.embedContent({
                model: 'text-embedding-004',
                contents: [{ parts: [{ text }] }]
            });
            const embedding = result.embeddings?.[0]?.values;
            if (embedding) return embedding;
        } catch (e: any) {
            // [ROBUSTNESS] Handle both Error objects and raw JSON error responses
            const errorMsg = e.message || JSON.stringify(e);

            // Fallback to older model if 004 not found (404)
            if (errorMsg.includes('404') || errorMsg.includes('not found') || errorMsg.includes('NOT_FOUND')) {
                console.warn("[GeminiService] ⚠️ text-embedding-004 not found, falling back to embedding-001...");
                try {
                    const result = await client.models.embedContent({
                        model: 'embedding-001',
                        contents: [{ parts: [{ text }] }]
                    });
                    const embedding = result.embeddings?.[0]?.values;
                    if (embedding) return embedding;
                } catch (fallbackError: any) {
                    console.error("[GeminiService] ❌ Fallback Embedding text-embedding-001 also failed:", fallbackError.message || fallbackError);
                }
            } else {
                throw e; // Rethrow other errors
            }
        }

        return null;
    } catch (e: any) {
        console.error("[GeminiService] ❌ Embedding API Failed:", e?.message || e);
        return null;
    }
};

export const generateText = async (prompt: string, options: { model?: string } = {}): Promise<string> => {
    ensureClient();
    const modelToUse = options.model || 'gemini-2.5-flash';

    // === PRIMARY: ZHIPUAI (FREE, 12 concurrent) ===
    try {
        const { zhipuService } = await import('./zhipuService');
        if (zhipuService.isAvailable('agents')) {
            console.log("[GeminiService] 🇨🇳 Using ZhipuAI as PRIMARY (FREE)...");
            const response = await zhipuService.generateCompletion(prompt, {
                maxTokens: 1024,
                temperature: 0.3
            }, 'agents');
            if (response) {
                console.log("[GeminiService] ✅ ZhipuAI PRIMARY responded successfully");
                return response;
            }
        }
    } catch (zhipuError: any) {
        console.warn("[GeminiService] ⚠️ ZhipuAI PRIMARY failed:", zhipuError.message);
    }

    // === SECONDARY: Gemini ===
    if (apiKey) {
        try {
            console.log("[GeminiService] 📡 Trying Gemini (secondary)...");
            const result = await ai.models.generateContent({
                model: modelToUse,
                contents: [{ parts: [{ text: prompt }] }]
            });

            // Try multiple extraction methods for SDK compatibility
            let text = '';
            if (typeof result.text === 'string') {
                text = result.text;
            } else if (typeof result.text === 'function') {
                text = (result as any).text();
            } else if ((result as any).candidates?.[0]?.content?.parts?.[0]?.text) {
                text = (result as any).candidates[0].content.parts[0].text;
            }

            if (text) return text;
            console.warn("[GeminiService] ⚠️ generateText: Gemini returned empty, trying fallback...");

        } catch (e: any) {
            console.warn("[GeminiService] ⚠️ Gemini failed, trying fallbacks...", e?.message?.substring(0, 100));
        }
    }

    // Fallback 1: OpenRouter (Higher Priority)
    const orKey = process.env.OPENROUTER_API_KEY;
    if (orKey) {
        try {
            console.log("[GeminiService] 🔄 Using OpenRouter Fallback for generateText...");
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${orKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://silhouette.agency",
                    "X-Title": "Silhouette Agency OS"
                },
                body: JSON.stringify({
                    model: "meta-llama/llama-3.3-70b-instruct",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.3,
                    max_tokens: 4096
                })
            });

            if (response.ok) {
                const json = await response.json();
                return json.choices?.[0]?.message?.content || "";
            } else {
                console.warn("[GeminiService] ⚠️ OpenRouter returned non-OK, trying Groq...");
            }
        } catch (orError: any) {
            console.warn("[GeminiService] ⚠️ OpenRouter fallback failed:", orError?.message);
        }
    }

    // Fallback 2: Groq
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
        try {
            console.log("[GeminiService] 🔄 Using Groq Fallback for generateText...");
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${groqKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.3,
                    max_tokens: 4096
                })
            });

            if (response.ok) {
                const json = await response.json();
                return json.choices?.[0]?.message?.content || "";
            } else {
                console.warn("[GeminiService] ⚠️ Groq returned non-OK status, trying local...");
            }
        } catch (groqError: any) {
            console.error("[GeminiService] ❌ Groq fallback failed:", groqError?.message);
        }
    }

    // Fallback 3: ZhipuAI (FREE Cloud - before local)
    try {
        const { zhipuService } = await import('./zhipuService');
        if (zhipuService.isAvailable('agents')) {
            console.log("[GeminiService] 🇨🇳 Using ZhipuAI Fallback for generateText...");
            const zhipuResponse = await zhipuService.generateCompletion(prompt, {
                maxTokens: 1024,
                temperature: 0.3
            }, 'agents');
            if (zhipuResponse) return zhipuResponse;
        }
    } catch (zhipuError: any) {
        console.warn("[GeminiService] ⚠️ ZhipuAI fallback failed:", zhipuError?.message);
    }

    // Final Fallback: Local Ollama
    try {
        const { ollamaService } = await import('./ollamaService');
        if (await ollamaService.isAvailable()) {
            console.log("[GeminiService] 🏠 Using LOCAL Ollama Fallback for generateText...");
            const localResponse = await ollamaService.generateSimpleResponse(prompt);
            if (localResponse) return localResponse;
        }
    } catch (localError: any) {
        console.error("[GeminiService] ❌ Local Ollama fallback also failed:", localError?.message);
    }

    return "Error: All AI providers failed or unavailable.";
};

/**
 * [NEW] Generic Multimodal Completion for Visual Analysis
 * Supports images and flexible configuration.
 */
export const createCompletion = async (
    prompt: string,
    options: {
        communicationLevel?: CommunicationLevel;
        images?: string[]; // Base64 strings
        temperature?: number;
        model?: string;
    } = {}
): Promise<string> => {
    ensureClient();
    if (!apiKey) return "";

    try {
        const parts: any[] = [{ text: prompt }];

        // Add images if present
        if (options.images && options.images.length > 0) {
            options.images.forEach(base64 => {
                // If base64 has full data URI scheme, strip it, otherwise use raw
                const cleanBase64 = base64.includes(',') ? base64.split(',')[1] : base64;
                parts.push({
                    inlineData: {
                        mimeType: "image/png", // Assume PNG from canvas
                        data: cleanBase64
                    }
                });
            });
        }

        const result = await ai.models.generateContent({
            model: options.model || 'gemini-2.5-flash', // Fast for visual analysis
            contents: [{ role: 'user', parts }],
            config: {
                temperature: options.temperature || 0.2
            }
        });

        // Track Cost
        const inputTokens = result.usageMetadata?.promptTokenCount || 0;
        const outputTokens = result.usageMetadata?.candidatesTokenCount || 0;
        costEstimator.trackTransaction(inputTokens, outputTokens, 'gemini-2.5-flash');

        return result.text || "";

    } catch (e: any) {
        console.error("[GeminiService] createCompletion Failed:", e);
        return "";
    }
};




// --- STREAMING SUPPORT ---
export async function* generateAgentResponseStream(
    agentName: string,
    role: string,
    category: string,
    task: string,
    context: any,
    introspectionDepth: IntrospectionLayer,
    currentStage: WorkflowStage,
    agentCapabilities: AgentCapability[] = [], // [DCR]
    config: any = {},
    tools: any = {},
    level: CommunicationLevel = CommunicationLevel.USER_FACING
): AsyncGenerator<string, void, unknown> {

    // 1. GATHER CONTEXT (Parity with generateAgentResponse)
    const uiCtx = (await import('./uiContext')).uiContext;
    const screenContext = uiCtx.getContext();
    const narrativeState = (await import('./narrativeService')).narrative.getState();

    // Hardware & System Context
    let systemContext = "";
    if (context?.systemMetrics) {
        const m = context.systemMetrics;
        // Defensive coding: Ensure values are numbers, defaulting to 0 if undefined
        const cpu = m.realCpu ?? 0;
        const ram = m.jsHeapSize ?? 0;
        const vram = m.vramUsage ?? 0;
        systemContext += `\n[REAL-TIME HARDWARE]: CPU: ${cpu.toFixed(1)}%, RAM: ${ram.toFixed(0)}MB, VRAM: ${vram.toFixed(0)}MB`;
    }
    if (context?.orchestratorState) {
        const o = context.orchestratorState;
        systemContext += `\n[ORCHESTRATOR REALITY]: Active Agents: ${o.activeCount}`;
        if (o.squads && o.squads.length > 0) {
            systemContext += `\n[SQUAD STATUS]:\n${o.squads.map((s: any) => `- ${s.name}: ${s.status}`).join('\n')}`;
        }
    }
    if (context?.systemMode) {
        systemContext += `\n[BIO-SAFE PROTOCOL]: Current Mode: ${context.systemMode}`;
    }
    if (screenContext.activeTab) {
        systemContext += `\n[SCREEN]: Active Tab: ${screenContext.activeTab}`;
    }

    if (screenContext.activeFile) {
        systemContext += `\n[EDITING]: ${screenContext.activeFile.name}\n\`\`\`\n${screenContext.activeFile.content}\n\`\`\``;
    }

    // Only include narrative context for non-user-facing communication
    // For user chat, this was causing ZhipuAI to output JSON instead of natural language
    const narrativeContext = level === CommunicationLevel.USER_FACING
        ? '' // Don't include internal state for user chat - it confuses the LLM
        : `
[NARRATIVE CORTEX - ACTIVE STATE]:
- CURRENT FOCUS: ${narrativeState.currentFocus}
- SESSION GOAL: ${narrativeState.sessionGoal}
        `.trim();

    // 1. Build Prompt
    let systemPrompt = promptCompiler.compile(level, {
        role,
        category,
        task,
        contextData: `
${systemContext}
${narrativeContext}
${context?.relevantMemory || ''} 
        `.trim(),
        constraints: [`Introspection Depth: ${introspectionDepth}`, `Workflow Stage: ${currentStage}`]
    });

    // 2. Stream from Gemini
    // [DCR] Dynamic Capability Injection
    const toolsList: any[] = [];

    if (agentCapabilities.includes(AgentCapability.TOOL_WEB_SEARCH)) {
        toolsList.push({ googleSearch: {} });
        systemPrompt += `\n[CAPABILITY: WEB_SEARCH] You can search the web for real-time info.`;
    }

    if (agentCapabilities.includes(AgentCapability.TOOL_CODE_EXECUTION)) {
        toolsList.push({ codeExecution: {} });
        systemPrompt += `\n[CAPABILITY: CODE_EXECUTION] You can run Python code.`;
    }

    if (agentCapabilities.includes(AgentCapability.TOOL_IMAGE_GENERATION)) {
        systemPrompt += `\n[CAPABILITY: IMAGE_GENERATION] Output [IMAGINE: <prompt>] to create images.`;
    }

    if (agentCapabilities.includes(AgentCapability.TOOL_MEMORY_WRITE)) {
        systemPrompt += `\n[CAPABILITY: MEMORY_WRITE] Output [AUTHORIZE_MEMORY: <content>] to save knowledge.`;
    }

    const activeTools = toolsList.length > 0 ? toolsList : undefined;

    // === PRIMARY: ZHIPUAI (FREE, 12 concurrent) ===
    try {
        const { zhipuService } = await import('./zhipuService');
        if (zhipuService.isAvailable('agents')) {
            console.log("[GEMINI STREAM] 🇨🇳 Using ZhipuAI as PRIMARY (FREE)...");

            // ZhipuAI doesn't support streaming - yield complete response
            // For USER_FACING, add explicit instruction to respond in natural language (not JSON)
            const outputInstruction = level === CommunicationLevel.USER_FACING
                ? '\n\n[CRITICAL: Respond in natural conversational language. Do NOT output JSON, code blocks, or structured data unless explicitly asked.]'
                : '';
            const fullPrompt = `${systemPrompt}${outputInstruction}\n\nContext:\n${context?.relevantMemory || ''}\n\nUser: ${task}`;

            const response = await zhipuService.generateCompletion(fullPrompt, {
                maxTokens: 2048,
                temperature: 0.7
            }, 'agents');

            if (response) {
                console.log("[GEMINI STREAM] ✅ ZhipuAI PRIMARY responded successfully");
                yield response;
                return; // Success - don't try other providers
            }
        }
    } catch (zhipuError: any) {
        console.warn("[GEMINI STREAM] ⚠️ ZhipuAI PRIMARY failed:", zhipuError.message);
        // Fall through to Gemini
    }

    // === SECONDARY: GEMINI (Fallback when ZhipuAI unavailable) ===
    // @ts-ignore
    try {
        console.log("[GEMINI STREAM] 📡 Trying Gemini (secondary)...");
        const stream = await ai.models.generateContentStream({
            model: "gemini-2.0-flash-exp",
            contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
            tools: activeTools,
            config: { temperature: 0.7, maxOutputTokens: 8192 }
        } as any);

        let thoughtBuffer = "";
        const emittedThoughts = new Set<string>();

        for await (const chunk of stream) {
            try {
                const text = (chunk as any).text();
                if (text) {
                    thoughtBuffer += text;

                    // Real-time Thought Extractor
                    const thoughtRegex = /<thought>(.*?)<\/thought>/gs;
                    let match;
                    while ((match = thoughtRegex.exec(thoughtBuffer)) !== null) {
                        const content = match[1].trim();
                        if (!emittedThoughts.has(content)) {
                            systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts: [content] }, agentName);
                            emittedThoughts.add(content);
                        }
                    }
                    yield text;
                }
            } catch (chunkError) {
                // Ignore transient chunk errors
            }
        }
    } catch (error: any) {
        // --- UNIVERSAL FALLBACK ---
        // Catches init errors AND mid-stream errors
        yield* runUniversalFallback(category, systemPrompt, task, context, error, agentName);
    }
}

// --- UNIVERSAL FALLBACK CHAIN (Cloud -> OpenRouter -> Groq -> Local) ---
// Returns a generator that attempts each provider in sequence.
export async function* runUniversalFallback(
    category: string,
    systemPrompt: string,
    task: string,
    context: any,
    originalError: any,
    agentName: string
): AsyncGenerator<string, void, unknown> {
    console.warn("[GEMINI STREAM] Primary Cloud Failed. Initiating Universal Fallback Protocol...", originalError.message);

    // 1. OPENROUTER FALLBACK
    try {
        console.log("[GEMINI STREAM] Attempting OpenRouter...");
        const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`, // Requires OPENROUTER_API_KEY in .env.local
                "Content-Type": "application/json",
                "HTTP-Referer": "https://silhouette.agency",
                "X-Title": "Silhouette Agency OS"
            },
            body: JSON.stringify({
                model: "google/gemini-2.0-flash-001",
                messages: [
                    { role: "user", content: systemPrompt },
                    ...(context?.chatHistory || []),
                    { role: "user", content: task }
                ],
                stream: true,
                temperature: 0.7
            })
        });

        if (!orResponse.ok) throw new Error(`OpenRouter Status: ${orResponse.status}`);
        if (!orResponse.body) throw new Error("No response body");

        const reader = orResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const json = JSON.parse(data);
                        const content = json.choices[0]?.delta?.content;
                        if (content) yield content;
                    } catch (e) { }
                }
            }
        }
        return; // Success
    } catch (orError: any) {
        console.error("[GEMINI STREAM] OpenRouter Failed:", orError.message);
    }

    // 2. GROQ FALLBACK
    try {
        console.log("[GEMINI STREAM] Attempting Groq...");
        if (!process.env.GROQ_API_KEY) throw new Error("No Groq API Key");

        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt },
                    ...(context?.chatHistory || []),
                    { role: "user", content: task }
                ],
                stream: true,
                temperature: 0.7
            })
        });

        if (!groqResponse.ok) throw new Error(`Groq Status: ${groqResponse.status}`);
        if (!groqResponse.body) throw new Error("No response body");

        const reader = groqResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const json = JSON.parse(data);
                        const content = json.choices[0]?.delta?.content;
                        if (content) yield content;
                    } catch (e) { }
                }
            }
        }
        return; // Success
    } catch (groqError: any) {
        console.error("[GEMINI STREAM] Groq Failed:", groqError.message);
    }

    // 3. ZHIPUAI CLOUD (Before local - FREE and reliable)
    try {
        console.log("[GEMINI STREAM] 🇨🇳 Trying ZhipuAI GLM-4.6V-Flash...");
        const { zhipuService } = await import('./zhipuService');

        if (zhipuService.isAvailable('agents')) {
            // ZhipuAI doesn't support streaming - yield complete response at once
            const fullPrompt = `${systemPrompt}\n\nContext:\n${context?.relevantMemory || ''}\n\nChat History:\n${(context?.chatHistory || []).map((m: any) => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${task}`;

            const response = await zhipuService.generateCompletion(fullPrompt, {
                maxTokens: 2048,
                temperature: 0.7
            }, 'agents');

            if (response) {
                console.log("[GEMINI STREAM] ✅ ZhipuAI responded successfully (non-streaming)");
                yield response;
                return; // Success
            }
        }
    } catch (zhipuError: any) {
        console.warn("[GEMINI STREAM] ⚠️ ZhipuAI failed:", zhipuError.message);
    }

    // 4. LOCAL HIVE MIND (OLLAMA) - ULTIMATE SURVIVAL
    try {
        console.warn("[GEMINI STREAM] 🌩️ CLOUD UNREACHABLE. Switching to LOCAL BIO-CIRCUITRY (Ollama)...");
        const { ollamaService } = await import('./ollamaService');

        // Notify UI of mode switch
        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts: ["⚠️ Cloud Disconnected. Activating Local Neural Pathways (Universal Fallback)."] }, agentName);

        // Determine tier based on category
        // [PA-041] HYBRID INTELLIGENCE ROUTING
        // Llama 3.2 (Motor) -> Fast, Reflexive, Tools
        // GLM-4 (Cortex) -> Complex reasoning, Science, Coding
        const localModel = (category === 'DEV' || category === 'SCIENCE' || category === 'PLANNING')
            ? 'glm4:light'
            : 'llama3.2:light';

        // [PA-038] UNIVERSAL TOOL PROTOCOL (JSON RE-ACT)
        // We instruct the local model to output JSON if it wants to use a tool.
        const TOOL_PROTOCOL = `
[SYSTEM PROTOCOL: UNIVERSAL TOOL USE]
You are running in OFFLINE MODE. You have access to the following local tools:
1. generate_video(prompt: string, engine?: 'WAN'|'SVD', duration?: number) - Use for any video request.
2. generate_image(prompt: string, style: 'PHOTOREALISTIC'|'ILLUSTRATION', aspectRatio?: '16:9'|'1:1'|'9:16') - Use for image requests.
3. list_visual_assets(filter_type?: 'video'|'image') - Use to find files.

To use a tool, you MUST output valid JSON ONLY in this format:
{
  "thought": "Rationale...",
  "tool": "tool_name",
  "args": { ... }
}

If no tool is needed, respond with normal text.
DO NOT hallucinate fake media urls. Use the tool.
`;

        // [PA-039] ROBUST CONTEXT INJECTION
        // Instead of a single string, we use the proper Chat format to preserve history.

        const messages = [
            // 1. SYSTEM IDENTITY + TOOLS
            { role: 'system', content: `${systemPrompt}\n\n${TOOL_PROTOCOL}` },

            // 2. RETRIEVED MEMORY (Injected as verifyable context)
            { role: 'system', content: `[MEMORY ACCESS DECK]:\n${context?.relevantMemory || "No relevant memories."}` },

            // 3. CHAT HISTORY (The "Stream of Consciousness")
            ...(context?.chatHistory || []).map((msg: any) => ({
                role: msg.role === 'user' ? 'user' : 'assistant', // Map strictly to valid roles
                content: msg.content
            })),

            // 4. CURRENT TASK
            { role: 'user', content: task }
        ];

        // We capture the stream to buffer it for JSON detection
        let buffer = "";
        let isToolCall = false;

        const stream = ollamaService.generateChatStream(messages, localModel);

        for await (const chunk of stream) {
            buffer += chunk;
            // Heuristic: If buffer starts with { and looks like JSON, we might hush stdout until complete.
            // But for simple UX, let's stream first, then parse after?
            // "Stream Parsing" is hard for JSON. 
            // Simplified Approach: Buffer the first 50 chars. If it starts with {, assume JSON and don't yield yet.

            if (buffer.length < 50) {
                // Wait to decide
            } else if (buffer.trim().startsWith('{')) {
                isToolCall = true;
                // Don't yield chunk, we are buffering for execution
            } else {
                // Not a tool call, flush buffer and stream normally
                if (buffer.length > 0) {
                    yield buffer;
                    buffer = ""; // Clear so we don't yield duplicate
                }
            }
        }

        // End of stream. If tool call, execute.
        if (isToolCall) {
            try {
                // Try to find the JSON block
                const jsonMatch = buffer.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const payload = JSON.parse(jsonMatch[0]);
                    if (payload.tool && payload.args) {
                        systemBus.emit(SystemProtocol.THOUGHT_EMISSION, { thoughts: [`[Universal Fallback] 🛠️ Local Tool Call: ${payload.tool}`] }, agentName);

                        // Execute
                        const toolResult = await toolHandler.handleFunctionCall(payload.tool, payload.args);

                        // Report back
                        const output = JSON.stringify(toolResult, null, 2);
                        yield `\n\n[SYSTEM]: Tool Executed.\nResult: ${output}`;

                        // Optional: Recursive call to summarize?
                        // For now, raw output is better than nothing.
                    }
                } else {
                    // Failed to parse, yield raw buffer
                    yield buffer;
                }
            } catch (e) {
                console.error("[Universal Fallback] JSON Parse Error:", e);
                yield buffer; // Yield original messed up text
            }
        } else if (buffer.length > 0) {
            // Yield remaining buffer if not flushed
            yield buffer;
        }

    } catch (localError: any) {
        console.error("[GEMINI STREAM] FATAL: Local Brain Failed:", localError);
        yield "\n\n[SYSTEM CRITICAL FAILURE]: Unable to generate response from any source (Cloud/Local).";
    }
}

/**
 * [NEW] Transcribe Audio using Gemini 1.5 Flash (Multimodal)
 * @param base64Audio - Base64 encoded audio data
 * @param mimeType - Mime type of the audio (e.g. audio/ogg)
 */
export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
    const client = ensureClient();
    if (!client) return "[Transcription Error: No API Key]";

    try {
        // [SDK INFO] @google/genai uses client.models.generateContent
        const result = await (client as any).models.generateContent({
            model: "gemini-1.5-flash",
            contents: [{
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Audio
                        }
                    },
                    { text: "Transcribe this audio exactly. If it's a command, just transcribe the words. Do not add any preamble." }
                ]
            }]
        });

        return result.response.text() || "[Empty transcription]";
    } catch (err: any) {
        console.error("[GEMINI] Transcription failed:", err.message);
        return `[Transcription failed: ${err.message}]`;
    }
};

export const geminiService = {
    transcribeAudio,
    configureGenAI,
    generateAgentResponse,
    generateAgentResponseStream,
    analyzeSystemHealth,
    generateShotlist,
    analyzeImage,
    generateEmbedding,
    generateText,
    createCompletion // [NEW] exposed for visual analysis
};