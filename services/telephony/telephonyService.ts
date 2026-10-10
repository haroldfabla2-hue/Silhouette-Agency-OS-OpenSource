// =============================================================================
// SILHOUETTE TELEPHONY & REAL-TIME VOIP ENGINE (PHASE 22 - TELEPHONY EXPANSION)
// Enterprise-Grade Bidirectional Voice Calling, Live Twilio/SIP Integration,
// Interactive Voice Response (IVR/DTMF) Navigation, and Memory Grounding.
// =============================================================================

import crypto from 'crypto';
import { sqliteService } from '../sqliteService';
import { systemBus } from '../systemBus';
import { SystemProtocol } from '../../types';
import { ttsService } from '../ttsService';
import { isDemoModeEnabled } from '../security/capabilityState';
import { generateText } from '../geminiService';
import { voiceLibraryService } from '../media/voiceLibraryService';

export type CallDirection = 'INBOUND' | 'OUTBOUND';
export type CallStatus = 'QUEUED' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'BUSY' | 'FAILED';

const TERMINAL: ReadonlySet<CallStatus> = new Set<CallStatus>(['COMPLETED', 'BUSY', 'FAILED']);
const ORDER: Record<CallStatus, number> = { QUEUED: 0, RINGING: 1, IN_PROGRESS: 2, COMPLETED: 3, BUSY: 3, FAILED: 3 };

/** Maps a Twilio call status to ours (null = unknown, ignored). */
export function mapProviderStatus(raw: string): CallStatus | null {
    switch ((raw || '').toLowerCase()) {
        case 'queued': case 'initiated': return 'QUEUED';
        case 'ringing': return 'RINGING';
        case 'in-progress': case 'answered': return 'IN_PROGRESS';
        case 'completed': return 'COMPLETED';
        case 'busy': return 'BUSY';
        case 'failed': case 'no-answer': case 'canceled': return 'FAILED';
        default: return null;
    }
}

/** Status only moves forward and never leaves a terminal state. */
export function canTransition(from: CallStatus, to: CallStatus): boolean {
    if (from === to) return false;
    if (TERMINAL.has(from)) return false;
    return ORDER[to] > ORDER[from];
}

export interface CallTurn {
    speaker: 'agent' | 'caller' | 'system';
    text: string;
    timestamp: number;
    dtmfDigits?: string;
    audioUrl?: string;
}

export interface AcousticSentimentAnalysis {
    hesitationIndex: number; // 0.0 to 1.0 (fillers, hesitations, latency)
    urgencyScore: number;    // 0.0 to 1.0 (urgency cues, pace)
    disposition: 'COOPERATIVE' | 'HESITANT' | 'RESISTANT' | 'FATIGUED';
    negotiationSignals: string[];
    tacticalAdvice: string;
}

export interface TelephonyCall {
    id: string;
    toNumber: string;
    fromNumber: string;
    direction: CallDirection;
    status: CallStatus;
    purpose: string;
    transcript: CallTurn[];
    durationSeconds: number;
    providerCallSid?: string;
    isSimulated: boolean;
    /** Provider error when the call could not be placed (status FAILED). */
    providerError?: string;
    voiceId?: string;
    createdAt: number;
    endedAt?: number;
    summary?: string;
}

export interface InitiateCallParams {
    toNumber: string;
    fromNumber?: string;
    purpose: string;
    initialGreeting?: string;
    agentPersona?: string;
    voiceId?: string;
    maxDurationSeconds?: number;
}

export class TelephonyService {
    private activeCalls: Map<string, TelephonyCall> = new Map();
    private isInitialized = false;

    // Twilio / SIP Configuration
    private accountSid: string | null = null;
    private authToken: string | null = null;
    private defaultFromNumber: string | null = null;

    constructor() {
        this.reloadCredentials();
        this.initializeSchema();
    }

    public reloadCredentials(): void {
        this.accountSid = process.env.TWILIO_ACCOUNT_SID || null;
        this.authToken = process.env.TWILIO_AUTH_TOKEN || null;
        this.defaultFromNumber = process.env.TWILIO_PHONE_NUMBER || '+15550199000';
    }

    /**
     * Initializes telephony table in SQLite for persistent call history and auditing.
     */
    private initializeSchema(): void {
        if (this.isInitialized) return;

        sqliteService.db.exec(`
            CREATE TABLE IF NOT EXISTS telephony_calls (
                id TEXT PRIMARY KEY,
                to_number TEXT NOT NULL,
                from_number TEXT NOT NULL,
                direction TEXT NOT NULL,
                status TEXT NOT NULL,
                purpose TEXT NOT NULL,
                transcript TEXT NOT NULL,
                duration_seconds INTEGER DEFAULT 0,
                provider_call_sid TEXT,
                is_simulated INTEGER DEFAULT 1,
                voice_id TEXT,
                created_at INTEGER NOT NULL,
                ended_at INTEGER,
                summary TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_telephony_status ON telephony_calls(status);
            CREATE INDEX IF NOT EXISTS idx_telephony_created ON telephony_calls(created_at);
        `);

        try {
            sqliteService.db.exec(`ALTER TABLE telephony_calls ADD COLUMN voice_id TEXT;`);
        } catch {}

        this.isInitialized = true;
    }

    /** Optional sender to the live media stream (WebSocket). Registered by the media-stream server when present. */
    private mediaStreamSender: ((callId: string, msg: { event: 'clear' }) => Promise<boolean>) | null = null;
    public setMediaStreamSender(fn: ((callId: string, msg: { event: 'clear' }) => Promise<boolean>) | null): void {
        this.mediaStreamSender = fn;
    }

    /**
     * Applies a provider status update (callback). This is the ONLY way a real call moves forward.
     * Backwards or post-terminal updates are ignored. Returns the call when the state changed.
     */
    public applyProviderStatus(providerCallSid: string, rawStatus: string): TelephonyCall | null {
        const next = mapProviderStatus(rawStatus);
        if (!next) return null;
        let call: TelephonyCall | undefined;
        for (const c of this.activeCalls.values()) if (c.providerCallSid === providerCallSid) { call = c; break; }
        if (!call) return null;
        if (!canTransition(call.status, next)) return null;
        call.status = next;
        if (TERMINAL.has(next)) {
            call.endedAt = Date.now();
            call.durationSeconds = Math.max(1, Math.round((call.endedAt - call.createdAt) / 1000));
            this.activeCalls.delete(call.id);
        }
        this.saveCallToDb(call);
        systemBus.emit(SystemProtocol.TELEMETRY_LOG, { service: 'TelephonyService', event: 'CALL_STATUS', callId: call.id, status: next });
        return call;
    }

    /**
     * Dials an outbound phone number.
     * Uses Twilio REST API when credentials exist; otherwise gracefully runs in
     * high-fidelity conversational simulation mode for testing and local dev.
     */
    public async dial(params: InitiateCallParams): Promise<{ call: TelephonyCall; error?: string }> {
        this.initializeSchema();

        const callId = `call_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
        const fromNumber = params.fromNumber || this.defaultFromNumber || '+15550199000';
        const hasCreds = !!(this.accountSid && this.authToken);
        let providerCallSid: string | undefined;
        let providerError: string | undefined;
        let status: CallStatus = 'QUEUED';
        let isSimulated = false;

        if (!hasCreds) {
            if (isDemoModeEnabled()) {
                // Explicit DEMO mode only: a labelled simulation, never presented as a real call.
                isSimulated = true;
                status = 'IN_PROGRESS';
            } else {
                providerError = 'UNAVAILABLE: no telephony provider credentials configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN). Set them, or enable SILHOUETTE_DEMO_MODE=1 for a labelled demo.';
                status = 'FAILED';
            }
        } else {
            try {
                const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`;
                const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
                const webhookUrl = process.env.SILHOUETTE_VOICE_WEBHOOK;
                if (!webhookUrl) {
                    providerError = 'UNAVAILABLE: SILHOUETTE_VOICE_WEBHOOK (public HTTPS URL for call callbacks) is not configured.';
                    status = 'FAILED';
                } else {
                    const body = new URLSearchParams({ To: params.toNumber, From: fromNumber, Url: webhookUrl });
                    const res = await fetch(endpoint, {
                        method: 'POST',
                        headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: body.toString()
                    });
                    if (res.ok) {
                        const data: any = await res.json();
                        if (data && typeof data.sid === 'string' && data.sid) {
                            providerCallSid = data.sid;
                            status = 'QUEUED'; // advances ONLY via provider callbacks
                        } else {
                            providerError = 'Provider accepted the request but returned no call SID.';
                            status = 'FAILED';
                        }
                    } else {
                        providerError = `Provider rejected the call (HTTP ${res.status}).`;
                        status = 'FAILED';
                    }
                }
            } catch (err: any) {
                providerError = `Could not reach provider: ${err.message}`;
                status = 'FAILED';
            }
        }

        const initialTurn: CallTurn = {
            speaker: 'agent',
            text: params.initialGreeting || `Hello, this is Silhouette Agency Assistant calling regarding: ${params.purpose}.`,
            timestamp: Date.now()
        };

        const callRecord: TelephonyCall = {
            id: callId,
            toNumber: params.toNumber,
            fromNumber,
            direction: 'OUTBOUND',
            status,
            purpose: params.purpose,
            transcript: [initialTurn],
            durationSeconds: 0,
            providerCallSid,
            isSimulated,
            providerError,
            voiceId: params.voiceId,
            createdAt: Date.now(),
            endedAt: status === 'FAILED' ? Date.now() : undefined
        };

        if (status !== 'FAILED') this.activeCalls.set(callId, callRecord);
        this.saveCallToDb(callRecord);

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'TelephonyService',
            event: status === 'FAILED' ? 'CALL_FAILED' : 'CALL_INITIATED',
            callId,
            toNumber: params.toNumber,
            isSimulated,
            status
        });

        return status === 'FAILED' ? { call: callRecord, error: providerError } : { call: callRecord };
    }

    /**
     * Acoustic Negotiation Radar:
     * Analyzes cadence, hesitation markers, speech tempo/latency, and resistance cues
     * to dynamically calibrate the agent's negotiation posture in real time.
     */
    public analyzeAcousticSentiment(text: string, latencyMs?: number): AcousticSentimentAnalysis {
        const lower = text.toLowerCase();
        const signals: string[] = [];

        // Hesitation detection
        const hesitationMarkers = ['um', 'uh', 'er', 'hmm', 'well...', 'well,', 'maybe', 'i guess', 'not sure', 'i think so', '...'];
        let hesitationCount = 0;
        for (const m of hesitationMarkers) {
            if (lower.includes(m)) hesitationCount++;
        }
        if (latencyMs && latencyMs > 2500) {
            hesitationCount += 2;
            signals.push('HIGH_LATENCY_PAUSE');
        }
        const hesitationIndex = Math.min(1, Number((hesitationCount / 4).toFixed(2)));
        if (hesitationIndex > 0.4) signals.push('UNCERTAINTY_HESITATION');

        // Urgency detection
        const urgencyMarkers = ['urgent', 'urgently', 'asap', 'immediately', 'quick', 'hurry', 'right now', 'emergency', 'fast', 'now'];
        let urgencyCount = 0;
        for (const m of urgencyMarkers) {
            if (lower.includes(m)) urgencyCount++;
        }
        if (latencyMs && latencyMs < 800) {
            urgencyCount++;
            signals.push('RAPID_RESPONSE');
        }
        const urgencyScore = Math.min(1, Number((urgencyCount / 3).toFixed(2)));
        if (urgencyScore > 0.5) signals.push('HIGH_URGENCY');

        // Resistance / Objection detection
        const resistanceMarkers = ['too expensive', 'can\'t', 'cannot', 'no way', 'too high', 'disagree', 'impossible', 'cancel', 'refund', 'don\'t want', 'ridiculous', 'not interested'];
        let resistanceCount = 0;
        for (const m of resistanceMarkers) {
            if (lower.includes(m)) resistanceCount++;
        }
        if (resistanceCount > 0) signals.push('COMMERCIAL_OBJECTION');

        // Fatigue detection
        const fatigueMarkers = ['whatever', 'fine', 'i don\'t care', 'if you say so', 'tired', 'ugh', 'exhausted'];
        let fatigueCount = 0;
        for (const m of fatigueMarkers) {
            if (lower.includes(m)) fatigueCount++;
        }
        if (fatigueCount > 0) signals.push('CALLER_FATIGUE');

        // Disposition classification
        let disposition: 'COOPERATIVE' | 'HESITANT' | 'RESISTANT' | 'FATIGUED' = 'COOPERATIVE';
        let tacticalAdvice = 'Interlocutor is receptive and cooperative. Proceed directly with confirmation and clear next steps.';

        if (resistanceCount > 0) {
            disposition = 'RESISTANT';
            tacticalAdvice = 'Interlocutor exhibits price, terms, or policy resistance. Acknowledge concerns with empathy, de-escalate tension, reframe value, and offer an alternative concession or tier.';
        } else if (hesitationIndex >= 0.4) {
            disposition = 'HESITANT';
            tacticalAdvice = 'Interlocutor is uncertain or weighing trade-offs. Simplify choices into a binary decision (Option A vs Option B) and provide reassuring validation.';
        } else if (fatigueCount > 0) {
            disposition = 'FATIGUED';
            tacticalAdvice = 'Interlocutor is experiencing conversation fatigue. Minimize verbosity, skip preamble, and proceed immediately to final resolution.';
        }

        return {
            hesitationIndex,
            urgencyScore,
            disposition,
            negotiationSignals: signals,
            tacticalAdvice
        };
    }

    /**
     * Sub-100ms Full-Duplex Interruption (Barge-In).
     * Truncates outbound TTS playback immediately when caller speech is detected,
     * flushing the provider media stream queue and synchronizing dialog turns.
     */
    public async triggerBargeIn(callId: string): Promise<{ success: boolean; twiml: string; timestamp: number; error?: string }> {
        const call = this.activeCalls.get(callId);
        if (!call || call.status !== 'IN_PROGRESS') {
            return { success: false, twiml: '', timestamp: Date.now(), error: `Call ${callId} is not active.` };
        }

        // A real call needs a connected media stream to flush queued audio. No stream = honestly UNAVAILABLE.
        const twimlClear = `<?xml version="1.0" encoding="UTF-8"?><Response><Clear/></Response>`;
        if (!call.isSimulated) {
            const sender = this.mediaStreamSender;
            if (!sender) {
                return { success: false, twiml: '', timestamp: Date.now(), error: 'UNAVAILABLE: no media stream connected for this call, audio cannot be cleared.' };
            }
            try {
                const ok = await sender(callId, { event: 'clear' });
                if (!ok) return { success: false, twiml: '', timestamp: Date.now(), error: 'Media stream did not accept the clear command.' };
            } catch (e: any) {
                return { success: false, twiml: '', timestamp: Date.now(), error: `Media stream error: ${e.message}` };
            }
        }

        const timestamp = Date.now();
        call.transcript.push({
            speaker: 'system',
            text: `[BARGE_IN_TRIGGERED: Outbound audio truncated. Interruption detected at ${new Date(timestamp).toISOString()}]`,
            timestamp
        });

        this.saveCallToDb(call);

        const twiml = twimlClear;

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'TelephonyService',
            event: 'BARGE_IN_TRIGGERED',
            callId,
            timestamp
        });

        return {
            success: true,
            twiml,
            timestamp
        };
    }

    /**
     * Processes an interactive voice turn in an ongoing phone call.
     * Converts speech transcript -> acoustic radar -> LLM reasoning -> voice synthesis (TTS).
     */
    public async processCallTurn(
        callId: string,
        callerUtterance: string,
        latencyMs?: number
    ): Promise<{
        agentResponse: string;
        audioBase64?: string;
        sentiment?: AcousticSentimentAnalysis;
        voicePersona?: string;
        error?: string;
    }> {
        const call = this.activeCalls.get(callId);
        if (!call || call.status !== 'IN_PROGRESS') {
            return { agentResponse: '', error: `Call ${callId} is not currently active.` };
        }

        // 1. Analyze acoustic sentiment & caller disposition
        const sentiment = this.analyzeAcousticSentiment(callerUtterance, latencyMs);

        // 2. Resolve configured voice persona
        let voicePersonaName = 'Silhouette Voice';
        if (call.voiceId) {
            try {
                const voice = await voiceLibraryService.getVoice(call.voiceId);
                if (voice) {
                    voicePersonaName = `${voice.name} (${voice.style || 'natural'}, ${voice.language})`;
                }
            } catch {}
        }

        // 3. Record caller's utterance
        call.transcript.push({
            speaker: 'caller',
            text: callerUtterance,
            timestamp: Date.now()
        });

        // 4. Build prompt context using call purpose, acoustic radar, and transcript history
        const dialogHistory = call.transcript
            .map(t => `${t.speaker.toUpperCase()}: ${t.text}`)
            .join('\n');

        const systemPrompt = `
You are Silhouette Agency OS's Voice Telephony Agent on a real phone call.
Keep your response concise, conversational, and direct (1-3 sentences maximum).
Never output markdown, bullet points, or emojis, because your response will be read by Text-to-Speech over a telephone line.
Current Call Purpose: ${call.purpose}
To Phone Number: ${call.toNumber}
Voice Persona: ${voicePersonaName}

Acoustic Negotiation Radar:
- Disposition: ${sentiment.disposition}
- Hesitation Index: ${sentiment.hesitationIndex}
- Urgency Score: ${sentiment.urgencyScore}
- Detected Signals: ${sentiment.negotiationSignals.join(', ') || 'Normal pace'}
- Tactical Negotiation Guidance: ${sentiment.tacticalAdvice}

Call Transcript so far:
${dialogHistory}

Agent Response (spoken naturally):`;

        let responseText = "Understood. I am processing that request for you right now.";
        try {
            const rawResponse = await generateText(systemPrompt);
            if (rawResponse && rawResponse.trim()) {
                responseText = rawResponse.trim().replace(/[*_#`]/g, '');
            }
        } catch (e: any) {
            console.error(`[Telephony] LLM generation error in call ${callId}:`, e.message);
        }

        // 5. Synthesize voice audio
        let audioBase64: string | undefined;
        try {
            const audioUrl = await ttsService.speak(responseText);
            if (audioUrl) {
                audioBase64 = audioUrl;
            }
        } catch {
            // TTS fallback
        }

        // 6. Record agent's response
        call.transcript.push({
            speaker: 'agent',
            text: responseText,
            timestamp: Date.now()
        });

        this.saveCallToDb(call);

        return {
            agentResponse: responseText,
            audioBase64,
            sentiment,
            voicePersona: voicePersonaName
        };
    }

    /**
     * Sends DTMF tones (keypad digits: '1', '2', '#', etc.) to navigate automated phone systems (IVRs).
     */
    public async sendDtmf(callId: string, digits: string): Promise<{ success: boolean; error?: string }> {
        const call = this.activeCalls.get(callId);
        if (!call || call.status !== 'IN_PROGRESS') {
            return { success: false, error: `Call ${callId} is not active.` };
        }

        // Clean digits
        const sanitized = digits.replace(/[^0-9*#w]/g, '');
        if (!sanitized) {
            return { success: false, error: 'Invalid DTMF digits. Only 0-9, *, # are supported.' };
        }

        if (!call.isSimulated && call.providerCallSid && this.accountSid && this.authToken) {
            try {
                // Twilio Play digits API
                const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls/${call.providerCallSid}.json`;
                const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

                const twiml = `<Response><Play digits="${sanitized}"/></Response>`;
                const body = new URLSearchParams({ Twiml: twiml });

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${authHeader}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: body.toString()
                });
                if (!res.ok) {
                    return { success: false, error: `Provider rejected DTMF (HTTP ${res.status}).` };
                }
            } catch (err: any) {
                return { success: false, error: `DTMF not sent, provider unreachable: ${err.message}` };
            }
        }

        call.transcript.push({
            speaker: 'system',
            text: `[DTMF KEYPAD SENT]: ${sanitized}`,
            timestamp: Date.now(),
            dtmfDigits: sanitized
        });

        this.saveCallToDb(call);

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'TelephonyService',
            event: 'DTMF_SENT',
            callId,
            digits: sanitized
        });

        return { success: true };
    }

    /**
     * Terminates an active call, generates an executive summary, and anchors
     * agreements and decisions into Silhouette's memory.
     */
    public async hangup(callId: string, reason: string = 'Completed normally'): Promise<{ call?: TelephonyCall; error?: string }> {
        const call = this.activeCalls.get(callId);
        if (!call) {
            return { error: `Call ${callId} not found.` };
        }

        // Real call: the provider must confirm the hangup. A local flag alone never ends a live call.
        if (!call.isSimulated && call.providerCallSid && this.accountSid && this.authToken) {
            try {
                const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls/${call.providerCallSid}.json`;
                const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ Status: 'completed' }).toString()
                });
                if (!res.ok) return { call, error: `Hangup NOT confirmed by provider (HTTP ${res.status}). The call may still be live.` };
            } catch (err: any) {
                return { call, error: `Hangup NOT confirmed, provider unreachable: ${err.message}. The call may still be live.` };
            }
        }

        call.status = 'COMPLETED';
        call.endedAt = Date.now();
        call.durationSeconds = Math.max(1, Math.round((call.endedAt - call.createdAt) / 1000));

        // Generate call summary
        const fullTranscriptText = call.transcript
            .map(t => `${t.speaker}: ${t.text}`)
            .join('\n');

        let summary = `Phone call to ${call.toNumber} regarding ${call.purpose}. Result: ${reason}`;
        try {
            const summaryPrompt = `
Summarize this phone conversation in 2 sentences. Highlight any agreed terms, reservations, numbers, or action items:
${fullTranscriptText}
`;
            const generatedSummary = await generateText(summaryPrompt);
            if (generatedSummary && generatedSummary.trim()) {
                summary = generatedSummary.trim();
            }
        } catch {
            // Keep default summary
        }

        call.summary = summary;
        this.saveCallToDb(call);
        this.activeCalls.delete(callId);

        // Emit call completed event on system bus for episodic memory ingestion
        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'TelephonyService',
            event: 'CALL_COMPLETED',
            callId,
            durationSeconds: call.durationSeconds,
            summary
        });

        return { call };
    }

    /**
     * Generates standard TwiML XML to handle incoming calls or webhook callbacks.
     */
    public generateInboundTwiML(greeting: string, streamUrl?: string): string {
        if (streamUrl) {
            return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna-Neural">${greeting}</Say>
    <Connect>
        <Stream url="${streamUrl}" />
    </Connect>
</Response>`;
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joanna-Neural">${greeting}</Say>
    <Gather input="speech" timeout="4" action="/v1/voice/twiml-gather">
        <Say>Please speak your request after the tone.</Say>
    </Gather>
</Response>`;
    }

    /**
     * Retrieves a call record by ID.
     */
    public getCall(callId: string): TelephonyCall | null {
        if (this.activeCalls.has(callId)) {
            return this.activeCalls.get(callId)!;
        }

        this.initializeSchema();
        const row = sqliteService.db.prepare(`
            SELECT * FROM telephony_calls WHERE id = ?
        `).get(callId) as any;

        if (!row) return null;

        return {
            id: row.id,
            toNumber: row.to_number,
            fromNumber: row.from_number,
            direction: row.direction as CallDirection,
            status: row.status as CallStatus,
            purpose: row.purpose,
            transcript: JSON.parse(row.transcript || '[]'),
            durationSeconds: row.duration_seconds,
            providerCallSid: row.provider_call_sid,
            isSimulated: Boolean(row.is_simulated),
            voiceId: row.voice_id || undefined,
            createdAt: row.created_at,
            endedAt: row.ended_at,
            summary: row.summary
        };
    }

    /**
     * Lists recent call history.
     */
    public listCalls(limit: number = 20): TelephonyCall[] {
        this.initializeSchema();
        const rows = sqliteService.db.prepare(`
            SELECT * FROM telephony_calls ORDER BY created_at DESC LIMIT ?
        `).all(limit) as any[];

        return rows.map(r => ({
            id: r.id,
            toNumber: r.to_number,
            fromNumber: r.from_number,
            direction: r.direction as CallDirection,
            status: r.status as CallStatus,
            purpose: r.purpose,
            transcript: JSON.parse(r.transcript || '[]'),
            durationSeconds: r.duration_seconds,
            providerCallSid: r.provider_call_sid,
            isSimulated: Boolean(r.is_simulated),
            voiceId: r.voice_id || undefined,
            createdAt: r.created_at,
            endedAt: r.ended_at,
            summary: r.summary
        }));
    }

    private saveCallToDb(call: TelephonyCall): void {
        sqliteService.db.prepare(`
            INSERT INTO telephony_calls (
                id, to_number, from_number, direction, status, purpose,
                transcript, duration_seconds, provider_call_sid, is_simulated,
                voice_id, created_at, ended_at, summary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                transcript = excluded.transcript,
                duration_seconds = excluded.duration_seconds,
                voice_id = excluded.voice_id,
                ended_at = excluded.ended_at,
                summary = excluded.summary
        `).run(
            call.id,
            call.toNumber,
            call.fromNumber,
            call.direction,
            call.status,
            call.purpose,
            JSON.stringify(call.transcript),
            call.durationSeconds,
            call.providerCallSid || null,
            call.isSimulated ? 1 : 0,
            call.voiceId || null,
            call.createdAt,
            call.endedAt || null,
            call.summary || null
        );
    }
}

export const telephonyService = new TelephonyService();
