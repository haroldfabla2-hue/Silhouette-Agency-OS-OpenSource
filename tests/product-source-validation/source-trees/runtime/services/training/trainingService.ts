
import { dreamer } from '../dreamerService';
import { peerReview } from '../peerReviewService';

export class TrainingService {
    constructor() { }

    public async startSleepCycle(): Promise<void> {
        // Check congestion before running sleep cycle
        const { congestionManager } = await import('../congestionManager');
        if (congestionManager.isCongested()) {
            console.log('[TRAINING] ⏸️ Sleep cycle delayed (system congested). Will retry later.');
            return;
        }

        // Holistic Cycle: Neural Training + Memory Consolidation + Peer Review

        // PA-039: Run peer review of supervisory agents during sleep
        console.log('[TRAINING] 🔍 Running supervisor peer review...');
        try {
            const reviewResults = await peerReview.runPeerReview();
            console.log(`[TRAINING] ✅ Peer review complete. Reviewed: ${reviewResults.reviewed}, Evolved: ${reviewResults.evolved}`);
        } catch (e: any) {
            console.error('[TRAINING] ❌ Peer review failed:', e.message);
        }

        // Original training logic
        return dreamer.forceSleepCycle({ train: true, consolidate: true });
    }

    public isBusy(): boolean {
        // Expose dreamer training state (assumes public getter or access)
        return (dreamer as any).isTraining;
    }
}

export const trainingService = new TrainingService();
