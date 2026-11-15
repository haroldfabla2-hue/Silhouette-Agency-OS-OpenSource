import { Request, Response } from 'express';
import { trainingService } from '../../services/training/trainingService';
import { dataCollector } from '../../services/training/dataCollector';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';

export class TrainingController {

    // [GET] /latest
    public async getLatestTrainingData(req: Request, res: Response) {
        try {
            const limit = parseInt(req.query.limit as string) || 10;
            const examples = dataCollector.getRecentExamples(limit);
            const stats = dataCollector.getStats();

            res.json({
                success: true,
                data: examples,
                stats: stats,
                isTraining: trainingService.isBusy()
            });
        } catch (error: any) {
            console.error("[TRAINING_CONTROLLER] Error fetching training data:", error);
            res.status(500).json({ error: "Failed to fetch training data", details: error.message });
        }
    }

    /**
     * Shared SSE plumbing for sleep-cycle streaming: subscribes to dreamer
     * training events on the systemBus and wires disconnect cleanup.
     * Returns sendEvent + cleanup so error paths can never leak subscriptions.
     */
    private attachSleepStream(req: Request, res: Response) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders(); // Ensure headers are sent immediately

        const sendEvent = (type: string, message: string) => {
            res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
        };

        const unsubscribeLog = systemBus.subscribe(SystemProtocol.TRAINING_LOG, (event) => {
            const { type, message } = event.payload || {};
            sendEvent(type || 'log', message || 'Processing...');
        });

        const unsubscribeComplete = systemBus.subscribe(SystemProtocol.TRAINING_COMPLETE, (event) => {
            const { success, code } = event.payload || {};
            if (success) {
                sendEvent('done', `✅ Training complete (exit code: ${code})`);
            } else {
                sendEvent('error', `❌ Training failed (exit code: ${code})`);
            }
            unsubscribeLog();
            unsubscribeComplete();
            res.end();
        });

        const cleanup = () => {
            unsubscribeLog();
            unsubscribeComplete();
        };

        // Handle client disconnect
        req.on('close', () => {
            console.log('[TRAINING_CONTROLLER] Client disconnected from SSE');
            cleanup();
        });

        return { sendEvent, cleanup };
    }

    // [POST] /sleep
    // Triggers a sleep cycle and streams its progress over SSE.
    // (Side effects belong to POST; see streamSleepCycle for read-only watch.)
    public async startSleepCycle(req: Request, res: Response) {
        if (trainingService.isBusy()) {
            const { sendEvent, cleanup } = this.attachSleepStream(req, res);
            sendEvent('error', "Training cycle already in progress.");
            cleanup();
            res.end();
            return;
        }

        const { sendEvent } = this.attachSleepStream(req, res);
        sendEvent('log', "🌙 Initiating Sleep Cycle...");

        try {
            // Start the actual training - this will emit events via systemBus
            await trainingService.startSleepCycle();
            // Note: Don't end response here - wait for TRAINING_COMPLETE event
        } catch (e: any) {
            sendEvent('error', `Training error: ${e.message}`);
            res.end();
        }
    }

    // [GET] /sleep
    // Read-only SSE watch of sleep-cycle progress. NEVER starts a cycle:
    // opening the training panel must not trigger training as a side effect.
    public async streamSleepCycle(req: Request, res: Response) {
        const { sendEvent } = this.attachSleepStream(req, res);
        sendEvent('log', trainingService.isBusy()
            ? "🌙 Sleep cycle in progress. Streaming..."
            : "👁 Watching sleep cycles (read-only). No cycle started.");
    }
}
