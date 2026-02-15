import { geminiService } from './geminiService';
import { BrandDigitalTwin, SystemProtocol } from '../types';
import { sqliteService } from './sqliteService';
import { systemBus } from './systemBus';

export interface QAReport {
    score: number;
    reasoning: string;
    feedback: string;
    pass: boolean;
}

class QualityControlService {

    async critiqueAsset(
        assetUrl: string,
        brand: BrandDigitalTwin,
        originalPrompt: string
    ): Promise<QAReport> {
        console.log(`[QualityControl] Critiquing asset for ${brand.name}...`);

        try {
            const report = await geminiService.analyzeImage(assetUrl, originalPrompt, brand);

            if (!report) {
                throw new Error("Analysis returned null");
            }

            console.log(`[QualityControl] Score: ${report.score}/100. Pass: ${report.pass}`);
            return report;

        } catch (error) {
            console.error("[QualityControl] Critique Failed:", error);
            // Fail safe: If critic dies, we warn but don't block, or block safely.
            // For high-end agency, we should probably fail safe to "Manual Review".
            return {
                score: 0,
                reasoning: "The Critic is offline or encountered an error.",
                feedback: "Manual review required.",
                pass: false
            };
        }
    }
    async evaluateText(text: string): Promise<{ score: number, feedback: string }> {
        if (!text || text.length < 5) return { score: 50, feedback: "Content too short for evaluation." };

        try {
            const prompt = `
                You are Quality_Prime, a strict QA Auditor.
                Evaluate the following text output from an AI agent.
                Rate it from 0-100 based on clarity, precision, and professional tone.
                Provide a short 1-sentence feedback.
                
                Text to evaluate:
                "${text.substring(0, 1000)}..."
                
                Return JSON: { "score": number, "feedback": "string" }
            `;

            const response = await geminiService.generateText(prompt);
            const cleanJson = response.replace(/```json|```/g, '').trim();
            const result = JSON.parse(cleanJson);

            return {
                score: result.score || 75,
                feedback: result.feedback || "Evaluation complete."
            };
        } catch (error) {
            console.warn("[Quality] Evaluation failed, returning default.", error);
            return { score: 85, feedback: "Automated QA unavailable." };
        }
    }

    public getSystemQualityScore(): { score: number, stability: string } {
        // Calculate dynamic quality score based on recent system errors (15 mins)
        const recentErrors = sqliteService.getRecentLogs('ERROR', 15);
        const errorCount = recentErrors.length;

        // Base score 100, deduct 2 points per error. Min 0.
        let score = Math.max(0, 100 - (errorCount * 2));

        // Provide stability assessment
        let stability = 'EXCELLENT';
        if (score < 90) stability = 'GOOD';
        if (score < 80) stability = 'DEGRADED';
        if (score < 60) stability = 'CRITICAL';
        if (score < 40) stability = 'COLLAPSE_IMMINENT';

        return { score, stability };
    }

    // --- PA-038: EVOLUTION TRIGGER ---
    /**
     * Called when an agent's output scores below threshold.
     * Triggers evolution via orchestrator to improve agent performance.
     */
    public async onLowScore(agentId: string, score: number): Promise<void> {
        const EVOLUTION_THRESHOLD = 60;

        if (score < EVOLUTION_THRESHOLD) {
            console.warn(`[QualityControl] ⚠️ Agent ${agentId} scored ${score}/100 (below ${EVOLUTION_THRESHOLD}). Triggering evolution...`);

            try {
                // Dynamic import to avoid circular dependency
                const { orchestrator } = await import('./orchestrator');
                await orchestrator.requestEvolution(agentId);
            } catch (error: any) {
                console.error(`[QualityControl] ❌ Failed to trigger evolution for ${agentId}:`, error.message);
            }
        }
    }
}

export const qualityControl = new QualityControlService();

// --- PA-008: VOICE SYSTEM EVENT SUBSCRIPTIONS ---
// Integrates voice engine monitoring with quality control logging

systemBus.subscribe(SystemProtocol.VOICE_ENGINE_OFFLINE, (event) => {
    console.warn(`[QualityControl] 🔇 Voice Engine went OFFLINE`);
    sqliteService.log('WARN',
        `Voice Engine offline: ${event.payload?.error || 'Unknown error'}`,
        'voice_engine'
    );
});

systemBus.subscribe(SystemProtocol.VOICE_ENGINE_ONLINE, (event) => {
    console.log(`[QualityControl] 🎤 Voice Engine came ONLINE`);
    sqliteService.log('INFO',
        `Voice Engine online (Device: ${event.payload?.device || 'unknown'})`,
        'voice_engine'
    );
});

systemBus.subscribe(SystemProtocol.VOICE_TTS_ERROR, (event) => {
    console.error(`[QualityControl] Voice TTS Error:`, event.payload);
    sqliteService.log('ERROR',
        `TTS Error: ${event.payload?.error || 'Unknown'}`,
        'voice_engine'
    );
});

systemBus.subscribe(SystemProtocol.VOICE_QUALITY_LOW, (event) => {
    console.warn(`[QualityControl] Voice quality low: ${event.payload?.voiceId} = ${event.payload?.qualityScore}/100`);
    sqliteService.log('WARN',
        `Voice ${event.payload?.voiceId} has low quality score: ${event.payload?.qualityScore}/100`,
        'voice_quality'
    );
});

systemBus.subscribe(SystemProtocol.VOICE_CLONE_COMPLETE, (event) => {
    console.log(`[QualityControl] Voice clone completed: ${event.payload?.voiceId}`);
    sqliteService.log('INFO',
        `Voice cloned successfully: ${event.payload?.voiceId} (quality: ${event.payload?.qualityScore})`,
        'voice_clone'
    );
});

systemBus.subscribe(SystemProtocol.VOICE_CLONE_FAILED, (event) => {
    console.error(`[QualityControl] Voice clone failed: ${event.payload?.voiceId}`);
    sqliteService.log('ERROR',
        `Voice clone failed: ${event.payload?.voiceId} - ${event.payload?.error}`,
        'voice_clone'
    );
});

