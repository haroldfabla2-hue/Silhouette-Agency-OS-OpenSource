import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { browserAuditLedger } from '../../services/browser/browserAuditLedger';
import { browserService } from '../../services/browserService';
import { telephonyService } from '../../services/telephony/telephonyService';
import { toolHandler } from '../../services/tools/toolHandler';
import { sqliteService } from '../../services/sqliteService';
import * as geminiService from '../../services/geminiService';
import { ttsService } from '../../services/ttsService';

describe('Silhouette Supremacy Extensions (Anti-Instinct Superiority)', () => {

    beforeAll(() => {
        vi.spyOn(ttsService, 'speak').mockResolvedValue('data:audio/wav;base64,mock_audio');
        vi.spyOn(geminiService, 'generateText').mockResolvedValue('Understood. I am processing that request for you right now.');
        try {
            sqliteService.db.exec(`DELETE FROM telephony_calls;`);
        } catch { /* tables might not be created yet */ }
    });

    // =========================================================================
    // 1. CRYPTOGRAPHIC VISUAL AUDIT LEDGER (SHA-256 / HMAC HASH CHAIN)
    // =========================================================================
    describe('Cryptographic Visual Audit Ledger', () => {
        let testSessionId: string;

        it('initializes a tamper-evident visual audit session with root hash', () => {
            testSessionId = browserAuditLedger.startSession('https://silhouette-agent.internal/checkout');

            expect(testSessionId).toBeDefined();
            expect(testSessionId.startsWith('audit_')).toBe(true);

            const session = browserAuditLedger.getSession(testSessionId);
            expect(session).toBeDefined();
            expect(session?.status).toBe('RECORDING');
            expect(session?.chainRootHash.length).toBe(64); // SHA-256 hex length
            expect(session?.latestHash).toBe(session?.chainRootHash);
            expect(session?.frames.length).toBe(0);
        });

        it('records and chains consecutive visual action frames with cryptographic signatures', async () => {
            const frame1 = await browserAuditLedger.recordFrame({
                actionType: 'click',
                targetDescription: 'Select Round-Trip Flight',
                coordinates: { x: 340, y: 512 },
                url: 'https://silhouette-agent.internal/flights',
                screenshotBuffer: Buffer.from('mock_screenshot_frame_1'),
                domContent: '<div>Flight results loaded</div>'
            });

            expect(frame1).not.toBeNull();
            expect(frame1?.frameIndex).toBe(0);
            expect(frame1?.screenshotHash).not.toBe('0'.repeat(64));
            expect(frame1?.frameHash.length).toBe(64);
            expect(frame1?.signature).toBeDefined();

            const frame2 = await browserAuditLedger.recordFrame({
                actionType: 'type',
                targetDescription: 'Enter Passenger Full Name',
                coordinates: { x: 400, y: 620 },
                url: 'https://silhouette-agent.internal/checkout',
                screenshotBuffer: Buffer.from('mock_screenshot_frame_2'),
                domContent: '<input type="text" name="passenger"/>'
            });

            expect(frame2).not.toBeNull();
            expect(frame2?.frameIndex).toBe(1);
            expect(frame2?.previousFrameHash).toBe(frame1?.frameHash);
        });

        it('seals the audit session and cryptographically verifies chain integrity', async () => {
            const result = await browserAuditLedger.sealSession(testSessionId);

            expect(result.isValid).toBe(true);
            expect(result.session.status).toBe('SEALED');
            expect(result.session.frames.length).toBe(2);
            expect(fs.existsSync(result.reportPath)).toBe(true);

            // Read generated manifest
            const manifest = JSON.parse(fs.readFileSync(result.reportPath, 'utf8'));
            expect(manifest.sessionId).toBe(testSessionId);
            expect(manifest.isValid).toBe(true);
            expect(manifest.frames.length).toBe(2);
        });

        it('detects tampering if a visual replay frame is illegally modified', async () => {
            const tamperSessionId = browserAuditLedger.startSession('https://test-tamper.com');
            await browserAuditLedger.recordFrame({
                actionType: 'click',
                targetDescription: 'Legitimate Button',
                url: 'https://test-tamper.com',
                screenshotBuffer: Buffer.from('legit_frame')
            });

            const session = browserAuditLedger.getSession(tamperSessionId)!;
            // Malicious actor alters the recorded coordinates or action
            session.frames[0].actionType = 'MALICIOUS_UNAUTHORIZED_CLICK';

            const sealResult = await browserAuditLedger.sealSession(tamperSessionId);
            expect(sealResult.isValid).toBe(false); // Tamper detected!
        });
    });

    // =========================================================================
    // 2. AUTONOMOUS SELF-HEALING & BROWSER SERVICE
    // =========================================================================
    describe('Self-Healing DOM Clearance & Browser Service Supremacy', () => {
        it('clears intrusive obstructions and returns dismissed count', async () => {
            const clearance = await browserService.clearObstructions();
            expect(clearance).toBeDefined();
            expect(typeof clearance.cleared).toBe('boolean');
            expect(typeof clearance.dismissedCount).toBe('number');
        });

        it('initiates and seals an audit session directly via browserService API', async () => {
            const auditId = await browserService.startAuditSession();
            expect(auditId.startsWith('audit_')).toBe(true);

            const sealed = await browserService.sealAuditSession(auditId);
            expect(sealed.isValid).toBe(true);
            expect(sealed.reportPath).toBeDefined();
        });
    });

    // =========================================================================
    // 3. SUPER-TELEPHONY & ACOUSTIC NEGOTIATION RADAR
    // =========================================================================
    describe('Super-Telephony, Cloned Voice Personas & Acoustic Radar', () => {
        let activeCallId: string;

        it('initiates a call with custom voice persona routing and persists voiceId', async () => {
            const dialResult = await telephonyService.dial({
                toNumber: '+18005550199',
                purpose: 'Negotiate bulk hotel rate discount',
                initialGreeting: 'Hello, this is Silhouette calling on behalf of executive travel.',
                voiceId: 'xtts_es_sample'
            });

            expect(dialResult.error).toBeUndefined();
            expect(dialResult.call).toBeDefined();

            const call = dialResult.call!;
            activeCallId = call.id;

            expect(call.voiceId).toBe('xtts_es_sample');

            // Verify persistence in SQLite
            const fetchedCall = telephonyService.getCall(activeCallId);
            expect(fetchedCall?.voiceId).toBe('xtts_es_sample');
        });

        it('analyzes hesitation cadence and flags HESITANT disposition with binary-choice guidance', () => {
            const radar = telephonyService.analyzeAcousticSentiment(
                "Um, well, I guess we could maybe look at that, but I'm not really sure...",
                3200 // high pause latency
            );

            expect(radar.hesitationIndex).toBeGreaterThanOrEqual(0.4);
            expect(radar.disposition).toBe('HESITANT');
            expect(radar.negotiationSignals).toContain('UNCERTAINTY_HESITATION');
            expect(radar.tacticalAdvice).toContain('Option A vs Option B');
        });

        it('analyzes resistance/objections and flags RESISTANT disposition with concession advice', () => {
            const radar = telephonyService.analyzeAcousticSentiment(
                "No way, that is way too expensive. We cannot do that, cancel my reservation."
            );

            expect(radar.disposition).toBe('RESISTANT');
            expect(radar.negotiationSignals).toContain('COMMERCIAL_OBJECTION');
            expect(radar.tacticalAdvice).toContain('reframe value');
        });

        it('analyzes urgent fast-paced utterances and measures urgency score', () => {
            const radar = telephonyService.analyzeAcousticSentiment(
                "Please do this immediately, it's urgent, right now!",
                400 // fast response latency
            );

            expect(radar.urgencyScore).toBeGreaterThanOrEqual(0.6);
            expect(radar.negotiationSignals).toContain('RAPID_RESPONSE');
        });

        it('analyzes fatigue and prescribes concise resolution', () => {
            const radar = telephonyService.analyzeAcousticSentiment(
                "Whatever, fine, I don't care, just do whatever you want."
            );

            expect(radar.disposition).toBe('FATIGUED');
            expect(radar.tacticalAdvice).toContain('conversation fatigue');
        });

        it('executes sub-100ms full-duplex interruption (Barge-in) and generates stream clear TwiML', async () => {
            const bargeResult = await telephonyService.triggerBargeIn(activeCallId);

            expect(bargeResult.success).toBe(true);
            expect(bargeResult.twiml).toContain('<Clear/>');

            const call = telephonyService.getCall(activeCallId);
            const lastTurn = call?.transcript[call.transcript.length - 1];
            expect(lastTurn?.speaker).toBe('system');
            expect(lastTurn?.text).toContain('BARGE_IN_TRIGGERED');
        });

        it('processes interactive call turn enriched with live acoustic radar & voice persona', async () => {
            const { ttsService } = await import('../../services/ttsService');
            const { vi } = await import('vitest');
            vi.spyOn(ttsService, 'speak').mockResolvedValue('data:audio/wav;base64,mock_audio');

            const turnResult = await telephonyService.processCallTurn(
                activeCallId,
                "Well, um, we could give you a 10 percent discount, I guess."
            );

            expect(turnResult.error).toBeUndefined();
            expect(turnResult.agentResponse.length).toBeGreaterThan(0);
            expect(turnResult.sentiment).toBeDefined();
            expect(turnResult.sentiment?.hesitationIndex).toBeGreaterThan(0);
            expect(turnResult.voicePersona).toContain('María'); // xtts_es_sample name
        });
    });

    // =========================================================================
    // 4. AGENT TOOL HANDLER PROTOCOL SUPREMACY
    // =========================================================================
    describe('Agent Tool Handler Supremacy Tools', () => {
        it('executes telephony_analyze_sentiment tool seamlessly', async () => {
            const result = await toolHandler.handleFunctionCall('telephony_analyze_sentiment', {
                text: "That sounds too expensive, we might need a refund.",
                latency_ms: 1500
            });

            expect(result.status).toBe('success');
            expect(result.disposition).toBe('RESISTANT');
            expect(result.tactical_advice).toBeDefined();
        });

        it('executes browser_clear_obstructions tool seamlessly', async () => {
            const result = await toolHandler.handleFunctionCall('browser_clear_obstructions', {});

            expect(result.status).toBe('success');
            expect(typeof result.cleared).toBe('boolean');
        });

        it('executes browser_audit_session start and seal tools seamlessly', async () => {
            const startResult = await toolHandler.handleFunctionCall('browser_audit_session', {
                action: 'start'
            });

            expect(startResult.status).toBe('success');
            expect(startResult.action).toBe('start');
            expect(startResult.session_id).toBeDefined();

            const sealResult = await toolHandler.handleFunctionCall('browser_audit_session', {
                action: 'seal',
                session_id: startResult.session_id
            });

            expect(sealResult.status).toBe('success');
            expect(sealResult.is_valid).toBe(true);
        });
    });
});
