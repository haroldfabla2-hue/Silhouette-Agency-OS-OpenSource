import { describe, it, expect, beforeAll, vi } from 'vitest';
import { telephonyService } from '../../services/telephony/telephonyService';
import { sqliteService } from '../../services/sqliteService';
import { ttsService } from '../../services/ttsService';
import * as geminiService from '../../services/geminiService';

describe('TelephonyService & Real-Time VoIP Engine (Phase 22)', () => {
    let testCallId: string;

    beforeAll(() => {
        process.env.SILHOUETTE_DEMO_MODE = '1'; // telephony simulation only runs in explicit demo mode
        vi.spyOn(ttsService, 'speak').mockResolvedValue('data:audio/wav;base64,mock_audio');
        vi.spyOn(geminiService, 'generateText').mockResolvedValue('Understood. I am processing that request for you right now.');
        try {
            sqliteService.db.exec(`
                DELETE FROM telephony_calls;
            `);
        } catch { /* tables might not be created yet */ }
    });

    it('initializes schema and places an outbound phone call', async () => {
        const result = await telephonyService.dial({
            toNumber: '+18004337300',
            purpose: 'Inquire about flight cancellation status for AA-492',
            initialGreeting: 'Hello, I am calling from Silhouette Agency regarding flight AA-492.'
        });

        expect(result.error).toBeUndefined();
        expect(result.call).toBeDefined();

        const call = result.call!;
        testCallId = call.id;

        expect(call.id.startsWith('call_')).toBe(true);
        expect(call.toNumber).toBe('+18004337300');
        expect(call.direction).toBe('OUTBOUND');
        expect(call.status).toBe('IN_PROGRESS');
        expect(call.transcript.length).toBe(1);
        expect(call.transcript[0].speaker).toBe('agent');
        expect(call.transcript[0].text).toContain('flight AA-492');
    });

    it('processes bidirectional conversational turns with speech reasoning', async () => {
        const turnResult = await telephonyService.processCallTurn(
            testCallId,
            'Thank you for calling American Airlines. How can I help you today?'
        );

        expect(turnResult.error).toBeUndefined();
        expect(turnResult.agentResponse.length).toBeGreaterThan(0);

        // Check active call transcript
        const currentCall = telephonyService.getCall(testCallId);
        expect(currentCall?.transcript.length).toBe(3); // Initial greeting + caller + agent response
        expect(currentCall?.transcript[1].speaker).toBe('caller');
        expect(currentCall?.transcript[2].speaker).toBe('agent');
    });

    it('sends DTMF touch-tone keypad digits to navigate IVR phone menus', async () => {
        const dtmfResult = await telephonyService.sendDtmf(testCallId, '1');

        expect(dtmfResult.success).toBe(true);

        const call = telephonyService.getCall(testCallId);
        const lastTurn = call?.transcript[call.transcript.length - 1];
        expect(lastTurn?.speaker).toBe('system');
        expect(lastTurn?.dtmfDigits).toBe('1');
    });

    it('generates standard TwiML XML for Twilio voice webhooks', () => {
        const twiml = telephonyService.generateInboundTwiML(
            'Welcome to Silhouette Agency OS phone line.',
            'wss://example.com/v1/voice/stream'
        );

        expect(twiml).toContain('<Response>');
        expect(twiml).toContain('<Say voice="Polly.Joanna-Neural">Welcome to Silhouette Agency OS phone line.</Say>');
        expect(twiml).toContain('<Stream url="wss://example.com/v1/voice/stream" />');
    });

    it('terminates call, generates executive summary, and archives to SQLite memory', async () => {
        const hangupResult = await telephonyService.hangup(testCallId, 'Reservation status verified successfully');

        expect(hangupResult.error).toBeUndefined();
        expect(hangupResult.call?.status).toBe('COMPLETED');
        expect(hangupResult.call?.durationSeconds).toBeGreaterThanOrEqual(0);
        expect(hangupResult.call?.summary).toBeDefined();

        // Verify retrieval from SQLite persistence
        const archived = telephonyService.getCall(testCallId);
        expect(archived).not.toBeNull();
        expect(archived?.status).toBe('COMPLETED');
        expect(archived?.durationSeconds).toBeDefined();

        const allCalls = telephonyService.listCalls();
        expect(allCalls.length).toBeGreaterThanOrEqual(1);
        expect(allCalls.some(c => c.id === testCallId)).toBe(true);
    });
});
