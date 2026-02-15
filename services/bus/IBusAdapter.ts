import { ProtocolEvent, SystemProtocol, InterAgentMessage } from "../../types";

export interface IBusAdapter {
    /**
     * Connect to the underlying bus transport (Redis, Memory, etc.)
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the bus
     */
    disconnect(): Promise<void>;

    /**
     * Publish a system event (Fire and Forget)
     */
    publish(event: ProtocolEvent): Promise<void>;

    /**
     * Subscribe to a system protocol
     */
    subscribe(protocol: SystemProtocol, handler: (event: ProtocolEvent) => void): Promise<void>;

    /**
     * Send a direct message to an agent (Mailbox)
     */
    send(message: InterAgentMessage): Promise<void>;

    /**
     * Check mailbox for an agent
     */
    checkMailbox(agentId: string): Promise<InterAgentMessage[]>;

    /**
     * Check if agent has pending mail
     */
    hasMail(agentId: string): Promise<boolean>;
}
