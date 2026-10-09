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
import { generateText } from '../geminiService';

export type CallDirection = 'INBOUND' | 'OUTBOUND';
export type CallStatus = 'QUEUED' | 'RINGING' | 'IN_PROGRESS' | 'COMPLETED' | 'BUSY' | 'FAILED';

export interface CallTurn {
    speaker: 'agent' | 'caller' | 'system';
    text: string;
    timestamp: number;
    dtmfDigits?: string;
    audioUrl?: string;
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
                created_at INTEGER NOT NULL,
                ended_at INTEGER,
                summary TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_telephony_status ON telephony_calls(status);
            CREATE INDEX IF NOT EXISTS idx_telephony_created ON telephony_calls(created_at);
        `);

        this.isInitialized = true;
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
        const isSimulated = !this.accountSid || !this.authToken;

        let providerCallSid: string | undefined;

        if (!isSimulated) {
            try {
                // Real Twilio REST API outbound call trigger
                const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`;
                const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
                const webhookUrl = process.env.SILHOUETTE_VOICE_WEBHOOK || 'http://localhost:3000/v1/voice/twiml';

                const body = new URLSearchParams({
                    To: params.toNumber,
                    From: fromNumber,
                    Url: webhookUrl
                });

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${authHeader}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: body.toString()
                });

                if (res.ok) {
                    const data: any = await res.json();
                    providerCallSid = data.sid;
                } else {
                    console.warn(`[Telephony] Twilio call dispatch failed, falling back to simulation. Status: ${res.status}`);
                }
            } catch (err: any) {
                console.warn(`[Telephony] Error connecting to Twilio: ${err.message}. Using simulation.`);
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
            status: 'IN_PROGRESS',
            purpose: params.purpose,
            transcript: [initialTurn],
            durationSeconds: 0,
            providerCallSid,
            isSimulated,
            createdAt: Date.now()
        };

        this.activeCalls.set(callId, callRecord);
        this.saveCallToDb(callRecord);

        systemBus.emit(SystemProtocol.TELEMETRY_LOG, {
            service: 'TelephonyService',
            event: 'CALL_INITIATED',
            callId,
            toNumber: params.toNumber,
            isSimulated
        });

        return { call: callRecord };
    }

    /**
     * Processes an interactive voice turn in an ongoing phone call.
     * Converts speech transcript -> LLM reasoning -> voice synthesis (TTS).
     */
    public async processCallTurn(callId: string, callerUtterance: string): Promise<{ agentResponse: string; audioBase64?: string; error?: string }> {
        const call = this.activeCalls.get(callId);
        if (!call || call.status !== 'IN_PROGRESS') {
            return { agentResponse: '', error: `Call ${callId} is not currently active.` };
        }

        // 1. Record caller's utterance
        call.transcript.push({
            speaker: 'caller',
            text: callerUtterance,
            timestamp: Date.now()
        });

        // 2. Build prompt context using call purpose and transcript history
        const dialogHistory = call.transcript
            .map(t => `${t.speaker.toUpperCase()}: ${t.text}`)
            .join('\n');

        const systemPrompt = `
You are Silhouette Agency OS's Voice Telephony Agent on a real phone call.
Keep your response concise, conversational, and direct (1-3 sentences maximum).
Never output markdown, bullet points, or emojis, because your response will be read by Text-to-Speech over a telephone line.
Current Call Purpose: ${call.purpose}
To Phone Number: ${call.toNumber}

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

        // 3. Synthesize voice audio
        let audioBase64: string | undefined;
        try {
            const ttsResult = await ttsService.synthesize(responseText);
            if (ttsResult && ttsResult.audioBase64) {
                audioBase64 = ttsResult.audioBase64;
            }
        } catch {
            // TTS fallback
        }

        // 4. Record agent's response
        call.transcript.push({
            speaker: 'agent',
            text: responseText,
            timestamp: Date.now()
        });

        this.saveCallToDb(call);

        return {
            agentResponse: responseText,
            audioBase64
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

                await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${authHeader}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: body.toString()
                });
            } catch (err: any) {
                console.warn(`[Telephony] Failed to send real DTMF: ${err.message}`);
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
                created_at, ended_at, summary
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                status = excluded.status,
                transcript = excluded.transcript,
                duration_seconds = excluded.duration_seconds,
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
            call.createdAt,
            call.endedAt || null,
            call.summary || null
        );
    }
}

export const telephonyService = new TelephonyService();
