/**
 * CHANNEL MESSAGE AUTHORITY (R7).
 *
 * The ONLY source of authenticated identity for a channel (bus-carried) user
 * message. Payload fields (`role`, `senderId`, `sessionId`) are claims: this
 * resolver verifies the signed ingress envelope and re-derives the role from
 * the identity service. Anything unverifiable degrades to GUEST with NO
 * principal: the message may still be processed (availability), but it
 * carries zero authority (fail-closed), and the confirmation/effect gates
 * then refuse every external effect exactly as they do for guests.
 */
import { identityService, UserRole } from '../identityService';
import { channelIngress, type IngressAuthority } from './ingressEnvelope';

export interface ChannelAuthority {
    /** Verified authenticated principal, or null (guest / unverifiable). */
    principalId: string | null;
    /** Role re-derived from the identity service; NEVER the payload's claim. */
    role: UserRole;
    /** Verified conversation binding (session), or null when unverifiable. */
    conversationId: string | null;
    /** True only when a signed envelope verified (a verified guest message is
     *  verified:true with principalId:null: authentic, still no authority). */
    verified: boolean;
    /** Typed denial reason when verified is false. */
    reason?: string;
}

const NO_AUTHORITY = (reason: string): ChannelAuthority => ({
    principalId: null, role: UserRole.GUEST, conversationId: null, verified: false, reason,
});

export function resolveChannelAuthority(payload: any, ingress: IngressAuthority = channelIngress): ChannelAuthority {
    if (!payload || typeof payload !== 'object') return NO_AUTHORITY('MALFORMED');
    if (!payload.envelope) return NO_AUTHORITY('MISSING_ENVELOPE');

    const verdict = ingress.verify(payload.envelope, {
        channel: String(payload.channel ?? ''),
        senderId: String(payload.senderId ?? ''),
        messageId: String(payload.messageId ?? ''),
        conversationId: String(payload.sessionId ?? ''),
        content: String(payload.message ?? ''),
    });
    if (!verdict.ok) {
        console.warn(`[CHANNEL_AUTH] ⛔ envelope rejected (${verdict.reason}) for claimed channel=${payload.channel} sender=${payload.senderId}: message processed WITHOUT authority`);
        return NO_AUTHORITY(verdict.reason);
    }

    if (!verdict.principalId) {
        return { principalId: null, role: UserRole.GUEST, conversationId: verdict.conversationId, verified: true };
    }

    // The envelope binds the principal; the role is re-derived from identity
    // (revoked/unknown users keep no authority). A role field on the payload
    // is never consulted.
    let role: UserRole | null = null;
    try {
        role = identityService.getUserById(verdict.principalId)?.role ?? null;
    } catch {
        role = null;
    }
    if (!role) {
        console.warn(`[CHANNEL_AUTH] ⛔ verified envelope names unknown principal ${verdict.principalId}: no authority`);
        return NO_AUTHORITY('UNKNOWN_PRINCIPAL');
    }
    return { principalId: verdict.principalId, role, conversationId: verdict.conversationId, verified: true };
}
