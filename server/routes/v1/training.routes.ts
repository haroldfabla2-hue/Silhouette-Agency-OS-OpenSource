/**
 * TRAINING ROUTES V2.0
 * ═══════════════════════════════════════════════════════════════
 * 
 * Comprehensive endpoints for Silhouette's training system:
 * - Sleep cycles (dreaming/consolidation)
 * - Training data collection
 * - Dataset management
 * - Training statistics
 * 
 * Endpoints:
 * - GET  /latest        - Get latest training examples
 * - GET  /sleep         - SSE for real-time sleep cycle progress
 * - GET  /stats         - Training statistics
 * - POST /collect       - Manually submit training example
 * - GET  /dataset       - Get dataset info
 * - DELETE /dataset     - Clear training dataset
 * - GET  /status        - Current training status
 * - POST /abort         - Abort running training
 */

import { Router, Request, Response } from 'express';
import { TrainingController } from '../../controllers/trainingController';

const router = Router();
const controller = new TrainingController();

// ==================== CORE ENDPOINTS ====================

/**
 * GET /v1/training/latest
 * Get most recent training examples
 */
router.get('/latest', controller.getLatestTrainingData.bind(controller));

/**
 * GET /v1/training/sleep
 * SSE endpoint for real-time sleep cycle progress
 */
router.get('/sleep', controller.startSleepCycle.bind(controller));

// ==================== STATISTICS ====================

/**
 * GET /v1/training/stats
 * Get comprehensive training statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const { dataCollector } = await import('../../../services/training/dataCollector');
        const { trainingService } = await import('../../../services/training/trainingService');
        const { dreamer } = await import('../../../services/dreamerService');

        const stats = dataCollector.getStats();

        res.json({
            success: true,
            stats: {
                ...stats,
                isTraining: trainingService.isBusy(),
                lastSleepCycle: (dreamer as any).lastSleepTime || null,
                dreamerState: (dreamer as any).state || 'unknown'
            }
        });
    } catch (error: any) {
        console.error('[TRAINING] Error getting stats:', error);
        res.status(500).json({ error: 'Failed to get training stats', details: error.message });
    }
});

/**
 * GET /v1/training/status
 * Get current training status
 */
router.get('/status', async (_req: Request, res: Response) => {
    try {
        const { trainingService } = await import('../../../services/training/trainingService');
        const { dreamer } = await import('../../../services/dreamerService');

        res.json({
            success: true,
            status: {
                isTraining: trainingService.isBusy(),
                dreamerState: (dreamer as any).state || 'awake',
                isAsleep: (dreamer as any).isAsleep || false,
                lastSleepTime: (dreamer as any).lastSleepTime || null
            }
        });
    } catch (error: any) {
        console.error('[TRAINING] Error getting status:', error);
        res.status(500).json({ error: 'Failed to get training status', details: error.message });
    }
});

// ==================== DATA COLLECTION ====================

/**
 * POST /v1/training/collect
 * Manually submit a training example
 */
router.post('/collect', async (req: Request, res: Response) => {
    try {
        const { dataCollector } = await import('../../../services/training/dataCollector');
        const { input, output, score, tags, source } = req.body;

        if (!input || !output) {
            return res.status(400).json({
                error: 'Input and output are required'
            });
        }

        const normalizedScore = Math.max(0, Math.min(1, score || 0.8));
        const normalizedTags = Array.isArray(tags) ? tags : ['manual'];

        dataCollector.collect(
            input,
            output,
            normalizedScore,
            normalizedTags,
            source || 'API'
        );

        res.json({
            success: true,
            message: 'Training example collected',
            score: normalizedScore,
            tags: normalizedTags
        });
    } catch (error: any) {
        console.error('[TRAINING] Error collecting example:', error);
        res.status(500).json({ error: 'Failed to collect training example', details: error.message });
    }
});

// ==================== DATASET MANAGEMENT ====================

/**
 * GET /v1/training/dataset
 * Get dataset information
 */
router.get('/dataset', async (_req: Request, res: Response) => {
    try {
        const { dataCollector } = await import('../../../services/training/dataCollector');
        const fs = await import('fs');

        const stats = dataCollector.getStats();
        const datasetPath = dataCollector.getDatasetPath();

        let fileSize = 0;
        let exists = false;
        try {
            if (fs.existsSync(datasetPath)) {
                exists = true;
                const stat = fs.statSync(datasetPath);
                fileSize = stat.size;
            }
        } catch (e) {
            // Ignore
        }

        res.json({
            success: true,
            dataset: {
                path: datasetPath,
                exists,
                sizeBytes: fileSize,
                sizeFormatted: formatBytes(fileSize),
                totalExamples: stats.totalSaved,
                bufferCount: stats.bufferCount
            }
        });
    } catch (error: any) {
        console.error('[TRAINING] Error getting dataset info:', error);
        res.status(500).json({ error: 'Failed to get dataset info', details: error.message });
    }
});

/**
 * DELETE /v1/training/dataset
 * Clear the training dataset (dangerous operation)
 */
router.delete('/dataset', async (req: Request, res: Response) => {
    try {
        const { confirm } = req.body;

        if (confirm !== 'DELETE_ALL_TRAINING_DATA') {
            return res.status(400).json({
                error: 'Confirmation required',
                message: 'Send { "confirm": "DELETE_ALL_TRAINING_DATA" } to confirm deletion'
            });
        }

        const { dataCollector } = await import('../../../services/training/dataCollector');
        const fs = await import('fs');

        const datasetPath = dataCollector.getDatasetPath();

        if (fs.existsSync(datasetPath)) {
            fs.unlinkSync(datasetPath);
            console.log('[TRAINING] ⚠️ Training dataset deleted by API request');
        }

        res.json({
            success: true,
            message: 'Training dataset has been deleted'
        });
    } catch (error: any) {
        console.error('[TRAINING] Error deleting dataset:', error);
        res.status(500).json({ error: 'Failed to delete dataset', details: error.message });
    }
});

/**
 * POST /v1/training/flush
 * Force flush the buffer to disk
 */
router.post('/flush', async (_req: Request, res: Response) => {
    try {
        const { dataCollector } = await import('../../../services/training/dataCollector');

        dataCollector.saveToDisk();
        const stats = dataCollector.getStats();

        res.json({
            success: true,
            message: 'Buffer flushed to disk',
            bufferCount: stats.bufferCount,
            totalSaved: stats.totalSaved
        });
    } catch (error: any) {
        console.error('[TRAINING] Error flushing buffer:', error);
        res.status(500).json({ error: 'Failed to flush buffer', details: error.message });
    }
});

// ==================== CONTROL ====================

/**
 * POST /v1/training/abort
 * Abort a running training cycle
 */
router.post('/abort', async (_req: Request, res: Response) => {
    try {
        const { dreamer } = await import('../../../services/dreamerService');

        if (!(dreamer as any).isAsleep && !(dreamer as any).isTraining) {
            return res.json({
                success: false,
                message: 'No training cycle is currently running'
            });
        }

        // Attempt to abort
        if (typeof (dreamer as any).abort === 'function') {
            (dreamer as any).abort();
            res.json({
                success: true,
                message: 'Training cycle aborted'
            });
        } else {
            res.json({
                success: false,
                message: 'Training cycle is running but abort is not supported'
            });
        }
    } catch (error: any) {
        console.error('[TRAINING] Error aborting training:', error);
        res.status(500).json({ error: 'Failed to abort training', details: error.message });
    }
});

// ==================== HELPERS ====================

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default router;
