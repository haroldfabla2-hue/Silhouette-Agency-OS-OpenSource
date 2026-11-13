// Publication snapshot only: type reference never starts the orchestrator graph.
type MessageProducer = Pick<import('./orchestrator').AgentSwarmOrchestrator,
    'getUserMessageProducerStatus' | 'stopUserMessageAdmissions'>;
let published: MessageProducer | undefined;
export function publishMessageProducer(owner: MessageProducer): void {
    if (published && published !== owner) throw new Error('Message producer already published');
    published = owner;
}
export function getPublishedMessageProducer(): MessageProducer | undefined { return published; }
