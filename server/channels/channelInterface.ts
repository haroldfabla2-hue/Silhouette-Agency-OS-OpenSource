// =============================================================================
// CHANNEL INTERFACE
// Abstract contract all messaging channels must implement.
// =============================================================================

/**
 * Incoming message from any channel.
 */
export interface IncomingMessage {
    /** Unique message ID from the channel */
    id: string;
    /** Channel type identifier */
    channel: string;
    /** Sender identifier (phone number, user ID, etc.) */
    senderId: string;
    /** Sender display name if available */
    senderName?: string;
    /** Chat/group/channel ID */
    chatId: string;
    /** Message text content */
    text: string;
    /** Timestamp of the message */
    timestamp: number;
    /** Whether this is a group message */
    isGroup: boolean;
    /** Quoted/replied-to message */
    replyTo?: string;
    /** Media attachments */
    media?: {
        type: 'image' | 'video' | 'audio' | 'document';
        url?: string;
        buffer?: Buffer;
        mimeType: string;
        filename?: string;
    }[];
    /** Raw channel-specific payload */
    raw?: unknown;
}

/**
 * Outgoing message to send via a channel.
 */
export interface OutgoingMessage {
    /** Target chat/group/channel ID */
    chatId: string;
    /** Text content */
    text: string;
    /** Reply to a specific message */
    replyToId?: string;
    /** Media to attach */
    media?: {
        type: 'image' | 'video' | 'audio' | 'document';
        url?: string;
        buffer?: Buffer;
        mimeType: string;
        filename?: string;
        caption?: string;
    }[];
    /** Send as a "typing" indicator first */
    showTyping?: boolean;
}

/**
 * Channel status information.
 */
export interface ChannelStatus {
    channel: string;
    connected: boolean;
    uptime: number;
    lastMessage?: number;
    error?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Event handler for incoming messages.
 */
export type MessageHandler = (message: IncomingMessage) => Promise<void>;

/**
 * Abstract channel interface.
 * All messaging platforms (WhatsApp, Telegram, Discord) implement this.
 */
export interface IChannel {
    /** Channel type identifier */
    readonly name: string;

    /** Initialize the channel connection */
    connect(): Promise<void>;

    /** Gracefully disconnect */
    disconnect(): Promise<void>;

    /** Send a message */
    send(message: OutgoingMessage): Promise<string | null>;

    /** Register a message handler */
    onMessage(handler: MessageHandler): void;

    /** Get channel status */
    getStatus(): ChannelStatus;

    /** Whether the channel is currently connected */
    isConnected(): boolean;
}
