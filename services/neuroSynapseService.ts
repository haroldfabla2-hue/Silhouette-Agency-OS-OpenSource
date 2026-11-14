import { preserveOriginal } from './lifecycle/preserveOriginal';
import { neuroSynapseOwner } from './lifecycle/preparationBindings';
import type { Operation } from './lifecycle/host';

import { systemBus } from './systemBus';
import { SystemProtocol } from '../types';

// --- NEURO-SYNAPSE SERVICE (The "Corpus Callosum") ---
// Bridges the gap between "Active Dreaming" (Subconscious) and "Active Research" (Conscious).
// It converts abstract INTUITION events into concrete TASK ASSIGNMENTS.

class NeuroSynapseService {
    private readonly ownership = neuroSynapseOwner();
    private isConnected: boolean = false;

    constructor(construction: Operation) {
        this.ownership.validateConstruction(construction);
        console.log("[NEURO-LINK] 🧠 Initializing Synaptic Bridge...");
        this.initializeListeners();
    }

    private initializeListeners() {
        // Listen for new intuitions from the Dreamer
        const unsubscribe = systemBus.subscribe(SystemProtocol.INTUITION_CONSOLIDATED, async (event) => {
            await this.ownership.invoke('original-intuition-delivery', () => this.handleIntuition(event.payload));
        });

        this.ownership.onSeal(unsubscribe);
        this.isConnected = true;
        console.log("[NEURO-LINK] ✅ Synapses Firing. Listening for Dreams.");
    }

    private async handleIntuition(payload: { idea: string, source: string, confidence: number }) {
        console.log(`[NEURO-LINK] ⚡ Analyzing Dream Signal: "${payload.idea.substring(0, 50)}..."`);

        if (payload.confidence < 0.8) {
            console.log("[NEURO-LINK] 📉 Signal too weak. Ignoring.");
            return;
        }

        // Convert Insight into Actionable Research Task
        // We assign this to the "Researcher" agent.

        const researchTask = {
            targetRole: 'Researcher_Pro', // Target specific specialist
            taskType: 'RESEARCH_DISCOVERY',
            context: {
                hypothesis: payload.idea,
                origin: 'DreamerService',
                instruction: 'Analyze this hypothesis for scientific validity, architectural implications, and potential implementation paths. Output a structured report.'
            },
            priority: 'NORMAL'
        };

        // Dispatch to Orchestrator via Bus
        console.log(`[NEURO-LINK] 🚀 Routing to Researcher_Pro.`);
        systemBus.emit(SystemProtocol.TASK_ASSIGNMENT, researchTask);
    }
}

function constructOriginalNeuroSynapse(): NeuroSynapseService {
    const owner = neuroSynapseOwner();
    const operation = owner.beginConstruction();
    try {
        const instance = new NeuroSynapseService(operation);
        owner.constructed(operation, instance); return instance;
    } catch (original) {
        preserveOriginal(owner, 'construction-failure', () => owner.constructionFailed(operation, original));
        throw original;
    }
}
export const neuroSynapse = constructOriginalNeuroSynapse();
