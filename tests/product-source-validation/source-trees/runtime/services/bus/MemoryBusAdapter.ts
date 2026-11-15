import { deliverReservedHelpResponse } from '../lifecycle/correlatedHelpResponse';
import type { Scope } from '../lifecycle/host';
import { IBusAdapter } from "./IBusAdapter";
import { ProtocolEvent, SystemProtocol, InterAgentMessage } from "../../types";

export class MemoryBusAdapter implements IBusAdapter {
    constructor(private readonly ownership: Scope) {
        ownership.onSeal(() => {
            const queued = [...this.mailboxes.values()].reduce((count, messages) => count + messages.length, 0);
            if (queued) ownership.unknown('memory-mailbox:QUEUED_NOT_DURABLE_AT_SEAL');
        });
    }
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
                    if (!this.ownership.open) {
                        deliverReservedHelpResponse(handler, event); return;
                    }
                    this.ownership.invoke('memory-delivery', () => handler(event));
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

    unsubscribe(protocol: SystemProtocol, handler: (event: ProtocolEvent) => void): void {
        this.listeners[protocol] = (this.listeners[protocol] || []).filter(listener => listener !== handler);
    }

    async send(message: InterAgentMessage): Promise<void> {
        if (!this.ownership.open) this.ownership.unknown('memory-mailbox:ADMITTED_SEND_QUEUED_AFTER_SEAL');
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
