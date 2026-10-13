import { emitHelpResponse } from './communication/helpProtocol';

import { Agent, SystemProtocol } from "../types";
import { agentInferenceRouter } from "./llm/agentInferenceRouter";
import { capabilitiesFromAgentCapabilities } from "./llm/inference";
import { systemBus } from "./systemBus";
import { introspection } from "./introspectionEngine";
import { IntrospectionLayer, WorkflowStage } from "../types";
import { agentFileSystem } from "./agents/agentFileSystem";

/**
 * AGENT STREAM SERVICE
 * 
 * Manages independent cognitive loops for distributed agents.
 * Enables the "True Autonomy" mode where each squad member has a dedicated processing stream.
 */
export class AgentStreamService {
    // Stores context metadata to enable Loop Closure
    private idleWaiters = new Map<string, (() => void)[]>();

    private activeStreams: Map<string, any> = new Map();

    /**
     * Spawns a dedicated thought stream for a specific agent.
     * @param agent The agent entity to hydrate.
     * @param task The specific instruction for this agent.
     * @param context The broader project context.
     */
    public async spawnAgentStream(agent: Agent, task: string, context: any) {
        if (this.activeStreams.get(agent.id)) {
            console.log(`[AGENT_STREAM] Agent ${agent.name} is already thinking.`);
            return;
        }

        // Store context to pass it back on completion
        this.activeStreams.set(agent.id, { active: true, context });
        console.log(`[AGENT_STREAM] 🧠 Spawning Neural Thread for: ${agent.name} (${agent.role})`);

        let accumulatedThoughts: string[] = [];
        let fullText = "";

        try {
            // [EVOLUTION] Inject per-agent file system context (SOUL, IDENTITY, TOOLS)
            const agentSystemPrompt = agentFileSystem.buildSystemPrompt(agent.id, {
                includeMemory: true,
                includeHeartbeat: false,
                includeUser: !!context?.isUserFacing,
                maxMemoryLines: 50
            });

            const stream = agentInferenceRouter.stream({
                agentName: `${agent.name}_Stream`,
                role: "Orchestrator", // Sender
                category: agentSystemPrompt || agent.role, // Use rich prompt if available, fallback to role
                task,
                context: {
                    ...context,
                    toolCaller: { requesterId: agent.id, requesterRole: agent.role },
                    agentProfile: {
                        name: agent.name,
                        role: agent.role,
                        tier: agent.tier,
                        category: agent.category
                    }
                },
                introspectionDepth: IntrospectionLayer.DEEP, // Sub-agents are deep thinkers
                stage: WorkflowStage.EXECUTION,
                capabilities: capabilitiesFromAgentCapabilities(agent.capabilities || []) // [DCR]
            });

            for await (const event of stream) {
                if (event.type === 'provider') {
                    console.log(`[AGENT_STREAM] 🔀 ${agent.name} answered by ${event.provider}${event.model ? ` (${event.model})` : ''}`);
                    continue;
                }
                const chunk = event.text;
                fullText += chunk;

                // Real-time Thought Extraction for this Agent
                const currentThoughts = introspection.extractThoughts(fullText);

                if (currentThoughts.length > accumulatedThoughts.length) {
                    const newThoughts = currentThoughts.slice(accumulatedThoughts.length);
                    accumulatedThoughts = currentThoughts;

                    // Emit granular event specific to this agent
                    systemBus.emit(SystemProtocol.THOUGHT_EMISSION, {
                        agentId: agent.id,
                        role: agent.role,
                        thoughts: newThoughts,
                        timestamp: Date.now()
                    }, 'AGENT_STREAM');
                }
            }

            // A completed helper stream closes the same correlated request, not a generic task only.
            const source = context?.sourceMsg;
            if (source?.protocol === SystemProtocol.HELP_REQUEST && source.payload?.requesterId) {
                const failed = !fullText.trim() || /(^Error:|\[ERROR\]|\[SYSTEM CRITICAL FAILURE\])/i.test(fullText.trim());
                emitHelpResponse(source.payload, agent.id, fullText || 'Helper returned no output', !failed);
            }

            // Completion
            systemBus.emit(SystemProtocol.TASK_COMPLETION, {
                agentId: agent.id,
                result: fullText,
                timestamp: Date.now(),
                originalContext: context // Pass back context for correlation
            }, 'AGENT_STREAM');

            // [EVOLUTION] Log task completion to agent's MEMORY.md
            try {
                const summary = fullText.length > 500 ? fullText.substring(0, 500) + '...' : fullText;
                agentFileSystem.appendMemory(agent.id, `**Task Completed**\nTask: ${task.substring(0, 200)}\nResult Summary: ${summary}`);
            } catch (memErr) {
                // Non-critical — don't let memory failures break the flow
            }

        } catch (e) {
            console.error(`[AGENT_STREAM] 💥 Thread Crash for ${agent.name}:`, e);
            const source = context?.sourceMsg;
            if (source?.protocol === SystemProtocol.HELP_REQUEST && source.payload?.requesterId) {
                emitHelpResponse(source.payload, agent.id, `Unable to provide help: ${e instanceof Error ? e.message : String(e)}`, false);
            }
        } finally {
            this.activeStreams.delete(agent.id);
            const waiters = this.idleWaiters.get(agent.id) || [];
            this.idleWaiters.delete(agent.id);
            waiters.forEach(resolve => resolve());
        }
    }

    public isStreaming(agentId: string): boolean {
        return this.activeStreams.has(agentId);
    }

    /**
     * Processes an inbox message by converting it into a cognitive event/prompt.
     */
    public async handleIncomingMessage(agent: Agent, message: any) {
        // Do not drop incoming help replies while an agent is still streaming.
        while (this.isStreaming(agent.id)) {
            await new Promise<void>(resolve => {
                const waiters = this.idleWaiters.get(agent.id) || [];
                waiters.push(resolve);
                this.idleWaiters.set(agent.id, waiters);
            });
        }
        const sender = message.senderId;
        const content = JSON.stringify(message.payload);
        const type = message.protocol || 'MESSAGE';
        const sessionId = message.sessionId || null;

        const prompt = `
         [INCOMING COMMUNICATION]
         SENDER: ${sender}
         TYPE: ${type}
         ${sessionId ? `SESSION: ${sessionId}` : ''}
         CONTENT: ${content}
         
         INSTRUCTIONS:
         1. Read the message carefully, considering the sender's role and authority.
         2. If it requires action, execute it within your permissions.
         3. If it requires a reply, formulate a response.
         4. If you need help, you may request it by mentioning the relevant agent.
         5. If this is a delegation from a superior, acknowledge and begin work.
         6. If you cannot fulfill the request, explain why honestly.
         `;

        await this.spawnAgentStream(agent, prompt, {
            sourceMsg: message,
            sessionId,
            isUserFacing: type === 'USER_MESSAGE'
        });
    }
}

export const agentStreamer = new AgentStreamService();
