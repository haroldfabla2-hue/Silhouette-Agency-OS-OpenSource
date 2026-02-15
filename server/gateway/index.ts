// =============================================================================
// SILHOUETTE GATEWAY - Barrel Export
// =============================================================================

export { gateway } from './wsGateway';
export { sessionManager } from './sessionManager';
export type { Session, SessionMessage } from './sessionManager';
export type {
    Frame,
    RequestFrame,
    ResponseFrame,
    EventFrame,
    ConnectFrame,
    ConnectOkFrame,
    ClientConnection,
    GatewayMethod,
    GatewayEvent,
    ClientType,
} from './protocol';
export {
    createResponse,
    createErrorResponse,
    createEvent,
    isValidFrame,
    PROTOCOL_TO_GATEWAY_EVENT,
} from './protocol';
