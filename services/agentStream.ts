
import { Agent, SystemProtocol } from "../types";
import { geminiService } from "./geminiService";
import { systemBus } from "./systemBus";
import { introspection } from "./introspectionEngine";
import { IntrospectionLayer, WorkflowStage } from "../types";

/**
 * AGENT STREAM SERVICE
 * 
 * Manages independent cognitive loops for distributed agents.
 * Enables the "True Autonomy" mode where each squad member has a dedicated processing stream.
 */
export class AgentStreamService {
    // Stores context metadata to enable Loop Closure
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
            const stream = geminiService.generateAgentResponseStream(
                `${agent.name}_Stream`,
                "Orchestrator", // Sender
                agent.role, // Persona
                task,
                null,
                IntrospectionLayer.DEEP, // Sub-agents are deep thinkers
                WorkflowStage.EXECUTION,
                agent.capabilities || [], // [DCR]
                {
                    ...context,
                    agentProfile: {
                        name: agent.name,
                        role: agent.role,
                        tier: agent.tier,
                        category: agent.category
                    }
                }
            );

            for await (const chunk of stream) {
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

            // Completion
            systemBus.emit(SystemProtocol.TASK_COMPLETION, {
                agentId: agent.id,
                result: fullText,
                timestamp: Date.now(),
                originalContext: context // Pass back context for correlation
            }, 'AGENT_STREAM');

        } catch (e) {
            console.error(`[AGENT_STREAM] 💥 Thread Crash for ${agent.name}:`, e);
        } finally {
            this.activeStreams.delete(agent.id);
        }
    }

    public isStreaming(agentId: string): boolean {
        return this.activeStreams.has(agentId);
    }

    /**
     * Processes an inbox message by converting it into a cognitive event/prompt.
     */
    public async handleIncomingMessage(agent: Agent, message: any) {
        const sender = message.senderId;
        const content = JSON.stringify(message.payload);
        const type = message.protocol || 'MESSAGE';

        const prompt = `
         [INCOMING COMMUNICATION]
         SENDER: ${sender}
         TYPE: ${type}
         CONTENT: ${content}
         
         INSTRUCTIONS:
         1. Read the message.
         2. If it requires action, execute it.
         3. If it requires a reply, use your tools to send a response.
         `;

        await this.spawnAgentStream(agent, prompt, { sourceMsg: message });
    }
}

export const agentStreamer = new AgentStreamService();
