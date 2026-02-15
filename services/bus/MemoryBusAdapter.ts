import { IBusAdapter } from "./IBusAdapter";
import { ProtocolEvent, SystemProtocol, InterAgentMessage } from "../../types";

export class MemoryBusAdapter implements IBusAdapter {
    private listeners: Record<string, ((event: ProtocolEvent) => void)[]> = {};
    private mailboxes: Map<string, InterAgentMessage[]> = new Map();

    async connect(): Promise<void> {
        console.log("[BUS] Memory Adapter Connected.");
    }

    async disconnect(): Promise<void> {
        this.listeners = {};
        this.mailboxes.clear();
    }

    async publish(event: ProtocolEvent): Promise<void> {
        if (this.listeners[event.type]) {
            this.listeners[event.type].forEach(handler => {
                try {
                    handler(event);
                } catch (e) {
                    console.error(`[BUS] Error in handler for ${event.type}`, e);
                }
            });
        }
    }

    async subscribe(protocol: SystemProtocol, handler: (event: ProtocolEvent) => void): Promise<void> {
        if (!this.listeners[protocol]) {
            this.listeners[protocol] = [];
        }
        this.listeners[protocol].push(handler);
    }

    async send(message: InterAgentMessage): Promise<void> {
        if (!this.mailboxes.has(message.targetId)) {
            this.mailboxes.set(message.targetId, []);
        }

        if (message.priority === 'CRITICAL') {
            this.mailboxes.get(message.targetId)?.unshift(message);
        } else {
            this.mailboxes.get(message.targetId)?.push(message);
        }
    }

    async checkMailbox(agentId: string): Promise<InterAgentMessage[]> {
        const mail = this.mailboxes.get(agentId) || [];
        if (mail.length > 0) {
            this.mailboxes.set(agentId, []);
        }
        return mail;
    }

    async hasMail(agentId: string): Promise<boolean> {
        return (this.mailboxes.get(agentId)?.length || 0) > 0;
    }
}
