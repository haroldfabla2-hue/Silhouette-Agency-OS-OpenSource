import { preserveOriginal } from './lifecycle/preserveOriginal';
import { architecturalReviewOwner } from './lifecycle/preparationBindings';
import type { Operation } from './lifecycle/host';
import { redisClient } from "./redisClient";
import { systemBus } from "./systemBus";
import { SystemProtocol, AgentStatus, IntrospectionLayer, WorkflowStage, CommunicationLevel } from "../types";
import { orchestrator } from "./orchestrator";
import { generateAgentResponse } from "./geminiService";
import { continuum } from "./continuumMemory";
import { MemoryTier } from "../types";

// --- ARCHITECTURAL REVIEW BOARD (ARB) ---
// "The Black Box" of the System.
// Analyzes why things broke and ensures they don't break again.

export class ArchitecturalReviewService {
    private readonly ownership = architecturalReviewOwner();
    private static instance: ArchitecturalReviewService;
    // Removed In-Memory Map in favor of Redis

    private constructor(construction: Operation) {
        this.ownership.validateConstruction(construction);
        this.initialize();
    }

    public static getInstance(): ArchitecturalReviewService {
        if (!ArchitecturalReviewService.instance) {
            const owner = architecturalReviewOwner();
            const operation = owner.beginConstruction();
            try {
                ArchitecturalReviewService.instance = new ArchitecturalReviewService(operation);
                owner.constructed(operation, ArchitecturalReviewService.instance);
            } catch (original) {
                preserveOriginal(owner, 'construction-failure', () => owner.constructionFailed(operation, original));
                throw original;
            }
        }
        return ArchitecturalReviewService.instance;
    }

    private initialize() {
        console.log("[ARB] 🏛️ Architectural Review Board initialized.");

        // Listen for Incident Reports from Remediation/Hospital
        const unsubscribe = systemBus.subscribe(SystemProtocol.INCIDENT_REPORT, (event) => {
            this.ownership.invoke('original-incident-delivery', () => this.handleIncident(event.payload));
        });
        this.ownership.onSeal(unsubscribe);
    }

    private async handleIncident(payload: any) {
        // Payload: { remediationType, component, error, patchDetails }
        try {
            console.log(`[ARB] 🕵️ Analyzing Incident in: ${payload.component}`);

            // 1. Calculate Error Signature (Simple Hash for now)
            const signature = `${payload.component}:${payload.error.substring(0, 50)}`;
            const redisKey = `arb:failure:${signature.replace(/\s+/g, '_')}`;

            // 2. Increment Counter in Redis (TTL 24h)
            let recurrence = 1;
            const currentVal = await redisClient.get(redisKey);
            if (currentVal) {
                recurrence = parseInt(currentVal) + 1;
            }

            // Persist (Update)
            await redisClient.set(redisKey, recurrence.toString(), 86400); // 24 Hours TTL

            // 3. Determine Action
            if (recurrence >= 3) {
                await this.triggerDeepInvestigation(payload, recurrence);
            } else {
                await this.performPostMortem(payload);
            }

        } catch (e) {
            this.ownership.failure('incident:SELECTED_ANALYSIS_FAILED', e);
            console.error("[ARB] Analysis Failed:", e);
        }
    }

    private async performPostMortem(payload: any) {
        // Lightweight Analysis: Was this a trivial error or a logic flaw?
        const prompt = `
        POST-MORTEM ANALYSIS
        Component: ${payload.component}
        Error: ${payload.error}
        Patch: ${payload.patchDetails}

        Analyze:
        1. Was this a Syntax Error (Trivial) or Logic Flaw (Significant)?
        2. Extract a "Lesson Learned" in one sentence.

        Output JSON: { "severity": "TRIVIAL" | "SIGNIFICANT", "lesson": "..." }
        `;

        // Use the Code Architect (Core Squad)
        const agentId = 'core-01'; // Orchestrator usually, but maybe we need a specific 'architect' role. 
        // For now, core-01 is fine as it has high reasoning.

        try {
            const response = await generateAgentResponse(
                agentId, "System Architect", "CORE", prompt, null,
                IntrospectionLayer.DEEP, WorkflowStage.QA_AUDIT, undefined, undefined, [], CommunicationLevel.INTERNAL_MONOLOGUE
            );

            const analysis = JSON.parse(response.output.replace(/```json/g, '').replace(/```/g, '').trim());

            if (analysis.severity === 'SIGNIFICANT') {
                console.log(`[ARB] 💡 Lesson Learned: "${analysis.lesson}"`);
                // Store in Long-Term Memory
                await continuum.store(
                    `POST-MORTEM: ${payload.component} - ${analysis.lesson}`,
                    MemoryTier.DEEP,
                    ['POST_MORTEM', 'ANTIFRAGILITY', 'LESSON']
                );
            }
        } catch (e) {
            console.warn("[ARB] Post-Mortem LLM Failure:", e);
        }
    }

    private async triggerDeepInvestigation(payload: any, count: number) {
        console.warn(`[ARB] 🚨 RECURRING FAILURE DETECTED (${count}x): ${payload.component}`);

        // Convert to Epistemic Gap for the Curiosity Engine
        const mystery = `Why does ${payload.component} keep failing with ${payload.error} despite fixes?`;

        systemBus.emit(SystemProtocol.EPISTEMIC_GAP_DETECTED, {
            question: mystery,
            source: 'ArchitecturalReviewBoard',
            confidence: 0.1, // Low confidence in current understanding
            context: [`Recurrence: ${count}`, `Last Patch: ${payload.patchDetails}`]
        }, "ARB");
    }
}

export const architecturalReview = ArchitecturalReviewService.getInstance();
