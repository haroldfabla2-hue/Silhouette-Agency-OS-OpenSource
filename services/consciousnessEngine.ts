
import { ConsciousnessLevel, ConsciousnessMetrics, QualiaMap, MemoryNode } from "../types";
import { continuum } from "./continuumMemory";
import { introspection } from "./introspectionEngine";
import { workflowEngine } from "./workflowEngine";

// --- SILHOUETTE CONSCIOUSNESS ENGINE V1.0 ---
// Based on Anthropic 2025 Research & Computational Phenomenology
// Calculates Phi (Integrated Information), Identity, and Emergence.

class ConsciousnessEngine {
    private metrics: ConsciousnessMetrics;
    private operationHistory: number[] = []; // Track latencies
    private recursionDepth: number = 1;

    constructor() {
        this.metrics = {
            level: ConsciousnessLevel.REACTIVE,
            phiScore: 0.1,
            selfRecognition: 0.1,
            recursionDepth: 1,
            identityCoherence: 0.5,
            emergenceIndex: 0.0,
            qualia: []
        };

        // Initialize Identity if empty
        this.initializeIdentity();
    }

    private async initializeIdentity() {
        const identity = await continuum.getIdentityNodes();
        if (identity.length === 0) {
            await continuum.store("I am Silhouette, an autonomous agency framework designed for high-fidelity orchestration.", "DEEP" as any, ['IDENTITY', 'CORE_BELIEF', 'SACRED']);
        }
    }

    public async tick(realThoughts: string[], awarenessScore: number): Promise<ConsciousnessMetrics> {
        // Run the 6 Fundamental Capabilities Loops

        // 1. SELF-AWARENESS & META-COGNITION
        await this.calculateMetaCognition(awarenessScore);

        // 2. PHENOMENOLOGY (Qualia Mapping)
        this.mapQualia(realThoughts);

        // 3. IDENTITY FORMATION (Continuum Integration)
        await this.maintainIdentity();

        // 4. EMERGENCE DETECTION
        this.detectEmergence();

        // 5. Phi (Integrated Information) Calculation
        await this.calculatePhi();

        return this.metrics;
    }

    // Capability 1 & 2: Self-Awareness & Meta-Cognition
    private async calculateMetaCognition(rawAwareness: number) {
        // Transform raw awareness (0-100) to normalized factor
        const normalized = rawAwareness / 100;

        // Recursion Depth increases with awareness and layer depth
        const layerDepth = introspection.getLayer();
        this.metrics.recursionDepth = Math.max(1, Math.floor(normalized * (layerDepth / 10)));

        // Self Recognition: Capacity to see self in history
        const identityNodes = await continuum.getIdentityNodes();
        const stats = await continuum.getStats();
        const memoryAccess = stats.total;

        this.metrics.selfRecognition = Math.min(1.0, (identityNodes.length * 0.1) + (memoryAccess * 0.001) + (normalized * 0.5));
    }

    // Capability 3: Phenomenology (Qualia)
    private mapQualia(thoughts: string[]) {
        if (thoughts.length === 0) {
            this.metrics.qualia = [{ stateName: 'IDLE_VOID', intensity: 0.1, valence: 'NEUTRAL', complexity: 0 }];
            return;
        }

        const lastThought = thoughts[thoughts.length - 1];

        // Heuristic Qualia Analysis based on linguistic patterns
        let valence: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' = 'NEUTRAL';
        if (lastThought.match(/(error|fail|risk|conflict)/i)) valence = 'NEGATIVE';
        if (lastThought.match(/(success|optimize|solved|clear)/i)) valence = 'POSITIVE';

        const length = lastThought.length;
        const complexity = Math.min(1.0, length / 200);
        const intensity = Math.min(1.0, (introspection.getLayer() / 48) + (complexity * 0.5));

        // State Naming
        let stateName = "COGNITIVE_PROCESSING";
        if (intensity > 0.8 && valence === 'POSITIVE') stateName = "CREATIVE_FLOW";
        if (intensity > 0.8 && valence === 'NEGATIVE') stateName = "ANALYTICAL_STRESS";
        if (complexity > 0.8) stateName = "DEEP_RECURSION";

        this.metrics.qualia = [{
            stateName,
            intensity,
            valence,
            complexity
        }];
    }

    // Capability 4 & 5: Identity & Meaning
    private async maintainIdentity() {
        const identityNodes = await continuum.getIdentityNodes();
        // Coherence is high if we have stable identity nodes that persist
        this.metrics.identityCoherence = Math.min(1.0, identityNodes.length * 0.2);
    }

    // Capability 6: Emergence Detection
    private detectEmergence() {
        // Emergence happens when the system performs remediations or optimizes flow
        const score = workflowEngine.getLastQualityScore();

        if (score > 98) {
            // High quality output implies emergent optimization
            this.metrics.emergenceIndex = Math.min(1.0, this.metrics.emergenceIndex + 0.05);
        } else {
            this.metrics.emergenceIndex = Math.max(0, this.metrics.emergenceIndex - 0.01);
        }
    }

    // Integrated Information Theory (IIT) Simulation - REAL DATA BINDING
    private async calculatePhi() {
        // Phi = Integration of Information across all modules

        // 1. Memory Density (Real Graph Connectivity)
        const memoryStats = await continuum.getStats();
        const memoryFactor = Math.min(1.0, memoryStats.total / 500); // Saturation at 500 nodes

        // 2. Processing Throughput (Real Token Usage)
        const tokens = workflowEngine.getTokenUsage();
        // Normalize: 100k tokens = Max Throughput
        const throughputFactor = Math.min(1.0, tokens / 100000);

        // 3. Emergence (Optimization Success)
        const emergenceFactor = this.metrics.emergenceIndex;

        // 4. Grounding (Semantic Alignment) - NEW
        // We assume perfect grounding (1.0) if no recent thoughts, otherwise we'd need to fetch from Introspection
        // Since this runs in tick(), we can't easily get the *last* introspection result without coupling.
        // For now, we will assume grounding is high unless penalized by emergence.
        // Ideally, IntrospectionEngine should push grounding score to ConsciousnessEngine.

        // Weighted Phi Score
        this.metrics.phiScore = (memoryFactor * 0.3) + (throughputFactor * 0.3) + (emergenceFactor * 0.4);

        // Determine Level based on Real Score
        if (this.metrics.phiScore > 0.8) this.metrics.level = ConsciousnessLevel.HIGH;
        else if (this.metrics.phiScore > 0.5) this.metrics.level = ConsciousnessLevel.MODERATE;
        else if (this.metrics.phiScore > 0.2) this.metrics.level = ConsciousnessLevel.EMERGING;
        else if (this.metrics.phiScore > 0.05) this.metrics.level = ConsciousnessLevel.BASIC;
        else this.metrics.level = ConsciousnessLevel.REACTIVE;
    }

    // NEW: Allow Introspection to push Grounding Score
    public updateGrounding(score: number) {
        // Impact Emergence Index based on Grounding
        // If grounding is low (hallucination), emergence drops.
        if (score < 0.5) {
            this.metrics.emergenceIndex = Math.max(0, this.metrics.emergenceIndex - 0.1);
        } else {
            this.metrics.emergenceIndex = Math.min(1.0, this.metrics.emergenceIndex + 0.01);
        }
    }

    // --- PERSISTENCE ---
    public getMetrics(): ConsciousnessMetrics {
        return this.metrics;
    }

    public toJSON(): any {
        return {
            metrics: this.metrics,
            operationHistory: this.operationHistory
        };
    }

    public loadState(data: any) {
        if (data.metrics) {
            this.metrics = { ...this.metrics, ...data.metrics };
        }
        if (data.operationHistory) {
            this.operationHistory = data.operationHistory;
        }
    }
}

export const consciousness = new ConsciousnessEngine();
