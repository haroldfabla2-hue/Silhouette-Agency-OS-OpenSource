import { Router } from 'express';
import { continuum } from '../../../services/continuumMemory';
import { MemoryTier } from '../../../types';

const router = Router();

/**
 * MEMORY ROUTES V2.0 - Full Integration with ContinuumMemory
 * 
 * Endpoints:
 * - GET /state - Returns current memory state across all tiers
 * - GET /search - Search across memory tiers
 * - POST /consolidate - Force memory consolidation
 * - POST /store - Manual memory storage
 * - DELETE /:nodeId - Delete a specific memory node
 */

// GET /v1/memory/state - Returns current memory state for the ContinuumMemoryExplorer
router.get('/state', async (req, res) => {
    try {
        // Get all nodes from the 5-tier memory system
        const nodes = await continuum.getAllNodes();
        const stats = continuum.getStats();

        res.json({ nodes, stats });
    } catch (error: any) {
        console.error('[MEMORY] Error fetching memory state:', error);
        res.status(500).json({ error: 'Failed to fetch memory state', details: error.message });
    }
});

// GET /v1/memory/search - Search across memory tiers
router.get('/search', async (req, res) => {
    try {
        const query = req.query.q as string;
        const tag = req.query.tag as string | undefined;
        const agentId = req.query.agentId as string | undefined;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const results = await continuum.retrieve(query, tag, agentId);

        res.json({
            results,
            query,
            count: results.length
        });
    } catch (error: any) {
        console.error('[MEMORY] Error searching memory:', error);
        res.status(500).json({ error: 'Failed to search memory', details: error.message });
    }
});

// POST /v1/memory/consolidate - Force memory consolidation
router.post('/consolidate', async (req, res) => {
    try {
        // Force consolidation from RAM to LanceDB
        const result = await continuum.consolidateRamImmediate();

        // Also run maintenance
        await continuum.runMaintenance();

        res.json({
            success: true,
            promoted: result.promoted,
            message: 'Memory consolidation completed successfully'
        });
    } catch (error: any) {
        console.error('[MEMORY] Error during consolidation:', error);
        res.status(500).json({ error: 'Failed to consolidate memory', details: error.message });
    }
});

// POST /v1/memory/store - Manually store a memory
router.post('/store', async (req, res) => {
    try {
        const { content, tier, tags } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        // Default to ULTRA_SHORT tier if not specified
        const memoryTier = tier ? MemoryTier[tier as keyof typeof MemoryTier] : MemoryTier.ULTRA_SHORT;
        const memoryTags = tags || [];

        await continuum.store(content, memoryTier, memoryTags);

        res.json({
            success: true,
            message: 'Memory stored successfully',
            tier: memoryTier,
            tags: memoryTags
        });
    } catch (error: any) {
        console.error('[MEMORY] Error storing memory:', error);
        res.status(500).json({ error: 'Failed to store memory', details: error.message });
    }
});

// DELETE /v1/memory/:nodeId - Delete a specific memory node
router.delete('/:nodeId', async (req, res) => {
    try {
        const { nodeId } = req.params;

        if (!nodeId) {
            return res.status(400).json({ error: 'Node ID is required' });
        }

        await continuum.deleteNode(nodeId);

        res.json({
            success: true,
            message: `Memory node ${nodeId} deleted successfully`
        });
    } catch (error: any) {
        console.error('[MEMORY] Error deleting memory node:', error);
        res.status(500).json({ error: 'Failed to delete memory node', details: error.message });
    }
});

// GET /v1/memory/stats - Get memory system statistics
router.get('/stats', async (req, res) => {
    try {
        const stats = continuum.getStats();
        res.json({ stats });
    } catch (error: any) {
        console.error('[MEMORY] Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch memory stats' });
    }
});

// POST /v1/memory/save - Note: Consolidation handles persistence automatically
router.post('/save', async (req, res) => {
    try {
        // Trigger consolidation which persists to LanceDB
        await continuum.consolidateRamImmediate();
        res.json({ success: true, message: 'Memory persisted via consolidation' });
    } catch (error: any) {
        console.error('[MEMORY] Error saving:', error);
        res.status(500).json({ error: 'Failed to persist memory' });
    }
});

// GET /v1/memory/hippocampus - Get hippocampus working memory
router.get('/hippocampus', async (req, res) => {
    try {
        const hippocampus = continuum.getHippocampus();
        res.json({ hippocampus, count: hippocampus.length });
    } catch (error: any) {
        console.error('[MEMORY] Error fetching hippocampus:', error);
        res.status(500).json({ error: 'Failed to fetch hippocampus' });
    }
});

// GET /v1/memory/session-history - Get session chat history from memory
router.get('/session-history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 100;
        const history = continuum.getSessionHistory(limit);
        res.json({ history, count: history.length });
    } catch (error: any) {
        console.error('[MEMORY] Error fetching session history:', error);
        res.status(500).json({ error: 'Failed to fetch session history' });
    }
});

// ════════════════════════════════════════════════════════════════
// ETERNAL MEMORY ENDPOINTS (Self-Improvement System)
// ════════════════════════════════════════════════════════════════

// GET /v1/memory/facts - Get user facts from Neo4j
router.get('/facts', async (req, res) => {
    try {
        const { graph } = await import('../../../services/graphService');
        const facts = await graph.getUserFacts();
        res.json({ facts, count: facts.length });
    } catch (error: any) {
        console.error('[MEMORY] Error fetching facts:', error);
        res.status(500).json({ error: 'Failed to fetch facts', details: error.message });
    }
});

// GET /v1/memory/experiences - Get recent experiences from buffer
router.get('/experiences', async (req, res) => {
    try {
        const { experienceBuffer } = await import('../../../services/experienceBuffer');
        const limit = parseInt(req.query.limit as string) || 10;
        const type = req.query.type as string | undefined;

        const recent = experienceBuffer.getRecent(limit, type as any);
        const stats = experienceBuffer.getStats();

        res.json({ experiences: recent, stats });
    } catch (error: any) {
        console.error('[MEMORY] Error fetching experiences:', error);
        res.status(500).json({ error: 'Failed to fetch experiences' });
    }
});

// POST /v1/memory/feedback - Record user feedback
router.post('/feedback', async (req, res) => {
    try {
        const { feedbackService } = await import('../../../services/feedbackService');
        const { messageId, sessionId, query, response, rating, comment } = req.body;

        if (!messageId || !rating) {
            return res.status(400).json({ error: 'messageId and rating are required' });
        }

        const success = await feedbackService.recordFeedback(
            messageId,
            sessionId || 'default',
            query || '',
            response || '',
            rating,
            comment
        );

        res.json({ success });
    } catch (error: any) {
        console.error('[MEMORY] Error recording feedback:', error);
        res.status(500).json({ error: 'Failed to record feedback' });
    }
});

// GET /v1/memory/feedback/stats - Get feedback statistics
router.get('/feedback/stats', async (req, res) => {
    try {
        const { feedbackService } = await import('../../../services/feedbackService');
        const stats = await feedbackService.getStats();
        const recent = await feedbackService.getRecent(5);

        res.json({ stats, recent });
    } catch (error: any) {
        console.error('[MEMORY] Error fetching feedback stats:', error);
        res.status(500).json({ error: 'Failed to fetch feedback stats' });
    }
});

export default router;

