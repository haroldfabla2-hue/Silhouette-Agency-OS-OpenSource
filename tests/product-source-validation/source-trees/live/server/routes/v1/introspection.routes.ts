import { Router } from 'express';
import { systemController } from '../../controllers/systemController';
import { introspection } from '../../../services/introspectionEngine';
import { IntrospectionLayer } from '../../../types';

const router = Router();

/**
 * INTROSPECTION ROUTES V2.0 - Full Capability Access
 * 
 * Endpoints:
 * - GET /state - Current introspection state
 * - POST /inject - Concept injection
 * - POST /eye - Visual cortex bridge
 * - POST /thought - Add external thought
 * - GET /capabilities - List active capabilities
 * - POST /layer - Set introspection layer
 */

// Route: /v1/introspection/state
router.get('/state', (req, res) => systemController.getIntrospectionState(req, res));

// Route: /v1/introspection/inject - Concept Injection
router.post('/inject', (req, res) => {
    try {
        const { concept, strength, layer } = req.body;

        if (!concept) {
            return res.status(400).json({ error: 'Concept is required' });
        }

        const injectionStrength = strength || 1.0;
        const injectionLayer = layer || 32;

        introspection.injectConcept(concept, injectionStrength, injectionLayer);

        console.log(`[INTROSPECTION] Injected concept: "${concept}" (strength: ${injectionStrength}, layer: ${injectionLayer})`);

        res.json({
            success: true,
            injected: {
                concept,
                strength: injectionStrength,
                layer: injectionLayer
            },
            message: `Concept "${concept}" injected successfully`
        });
    } catch (error: any) {
        console.error('[INTROSPECTION] Injection failed:', error);
        res.status(500).json({ error: 'Failed to inject concept', details: error.message });
    }
});

// Route: /v1/introspection/thought - Add External Thought
router.post('/thought', (req, res) => {
    try {
        const { content, source, strength } = req.body;

        if (!content) {
            return res.status(400).json({ error: 'Content is required' });
        }

        introspection.addThought(content, source || 'external', strength || 1.0);

        res.json({
            success: true,
            message: 'Thought added successfully'
        });
    } catch (error: any) {
        console.error('[INTROSPECTION] Failed to add thought:', error);
        res.status(500).json({ error: 'Failed to add thought', details: error.message });
    }
});

// Route: /v1/introspection/layer - Set Introspection Layer
router.post('/layer', (req, res) => {
    try {
        const { layer } = req.body;

        if (layer === undefined) {
            return res.status(400).json({ error: 'Layer is required' });
        }

        // Convert string to enum if necessary
        let newLayer: IntrospectionLayer;
        if (typeof layer === 'string') {
            newLayer = IntrospectionLayer[layer as keyof typeof IntrospectionLayer];
        } else {
            newLayer = layer;
        }

        introspection.setLayer(newLayer);

        res.json({
            success: true,
            layer: newLayer,
            message: `Introspection layer set to ${newLayer}`
        });
    } catch (error: any) {
        console.error('[INTROSPECTION] Failed to set layer:', error);
        res.status(500).json({ error: 'Failed to set layer', details: error.message });
    }
});

// Route: /v1/introspection/capabilities - Get Active Capabilities
router.get('/capabilities', (req, res) => {
    try {
        const capabilities = introspection.getCapabilities();
        const activeConcepts = introspection.getActiveConcepts();
        const currentLayer = introspection.getCurrentLayer();
        const recentThoughts = introspection.getRecentThoughts();

        res.json({
            capabilities: Array.from(capabilities),
            activeConcepts,
            currentLayer,
            recentThoughts: recentThoughts.slice(-10), // Last 10 thoughts
            isDreaming: introspection.getDreaming()
        });
    } catch (error: any) {
        console.error('[INTROSPECTION] Failed to get capabilities:', error);
        res.status(500).json({ error: 'Failed to get capabilities' });
    }
});

// Route: /v1/introspection/eye (VisualCortex Bridge - receives screenshots)
router.post('/eye', async (req, res) => {
    try {
        const { image, timestamp, context } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'Image data is required' });
        }

        console.log(`[VISUAL_BRIDGE] 👁️ Received snapshot (${Math.round(image.length / 1024)}KB)`);

        // Store the visual snapshot for introspection
        // Note: Full image processing can be added when vision models are integrated

        res.json({
            status: 'received',
            timestamp: timestamp || Date.now(),
            context: context || 'general',
            message: 'Visual snapshot logged for introspection'
        });
    } catch (error: any) {
        console.error('[VISUAL_BRIDGE] Error processing visual input:', error);
        res.status(500).json({ error: 'Failed to process visual input' });
    }
});

// Route: /v1/introspection/dreaming - Toggle dreaming mode
router.post('/dreaming', (req, res) => {
    try {
        const { enabled } = req.body;
        introspection.setDreaming(!!enabled);

        res.json({
            success: true,
            isDreaming: introspection.getDreaming()
        });
    } catch (error: any) {
        console.error('[INTROSPECTION] Failed to toggle dreaming:', error);
        res.status(500).json({ error: 'Failed to toggle dreaming mode' });
    }
});

// Route: /v1/introspection/cognitive-cycle - Trigger a cognitive cycle
router.post('/cognitive-cycle', async (req, res) => {
    try {
        await introspection.runCognitiveCycle();

        res.json({
            success: true,
            message: 'Cognitive cycle completed'
        });
    } catch (error: any) {
        console.error('[INTROSPECTION] Cognitive cycle failed:', error);
        res.status(500).json({ error: 'Cognitive cycle failed', details: error.message });
    }
});

export default router;
