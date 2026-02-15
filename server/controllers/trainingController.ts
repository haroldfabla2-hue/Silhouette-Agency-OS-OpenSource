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

    // [GET] /sleep
    // SSE endpoint for real-time training progress
    public async startSleepCycle(req: Request, res: Response) {
        // SSE Setup
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders(); // Ensure headers are sent immediately

        const sendEvent = (type: string, message: string) => {
            res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
        };

        if (trainingService.isBusy()) {
            sendEvent('error', "Training cycle already in progress.");
            res.end();
            return;
        }

        sendEvent('log', "🌙 Initiating Sleep Cycle...");

        // Subscribe to TRAINING_LOG events from dreamerService
        const unsubscribeLog = systemBus.subscribe(SystemProtocol.TRAINING_LOG, (event) => {
            const { type, message } = event.payload || {};
            sendEvent(type || 'log', message || 'Processing...');
        });

        // Subscribe to TRAINING_COMPLETE to know when it's done
        const unsubscribeComplete = systemBus.subscribe(SystemProtocol.TRAINING_COMPLETE, (event) => {
            const { success, code } = event.payload || {};
            if (success) {
                sendEvent('done', `✅ Training complete (exit code: ${code})`);
            } else {
                sendEvent('error', `❌ Training failed (exit code: ${code})`);
            }
            // Cleanup subscriptions
            unsubscribeLog();
            unsubscribeComplete();
            res.end();
        });

        // Handle client disconnect
        req.on('close', () => {
            console.log('[TRAINING_CONTROLLER] Client disconnected from SSE');
            unsubscribeLog();
            unsubscribeComplete();
        });

        try {
            // Start the actual training - this will emit events via systemBus
            await trainingService.startSleepCycle();
            // Note: Don't end response here - wait for TRAINING_COMPLETE event
        } catch (e: any) {
            sendEvent('error', `Training error: ${e.message}`);
            unsubscribeLog();
            unsubscribeComplete();
            res.end();
        }
    }
}

