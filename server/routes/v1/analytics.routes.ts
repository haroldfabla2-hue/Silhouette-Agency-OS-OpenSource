/**
 * Analytics Routes — Privacy-First Telemetry API
 * 
 * Endpoints:
 * - POST   /events      — Ingest batch events from SDK
 * - GET    /consent     — Get current consent state
 * - PUT    /consent     — Update opt-in/opt-out
 * - GET    /events      — View buffered events (privacy dashboard)
 * - GET    /summary     — Event count summary
 * - DELETE /data        — Purge all collected data
 */

import { Router, Request, Response } from 'express';
import { telemetryAnalytics } from '../../../services/telemetryAnalytics.js';

const router = Router();

// Initialize telemetry on first route load
telemetryAnalytics.initialize().catch(err => {
    console.error('[Analytics Routes] Failed to initialize telemetry:', err);
});

/**
 * POST /events — Ingest analytics events
 */
router.post('/events', async (req: Request, res: Response) => {
    try {
        const { events } = req.body;

        if (!Array.isArray(events)) {
            return res.status(400).json({ error: 'events must be an array' });
        }

        let tracked = 0;
        for (const event of events) {
            if (event.name && typeof event.name === 'string') {
                telemetryAnalytics.track(event.name, event.properties || {});
                tracked++;
            }
        }

        res.json({ success: true, tracked });
    } catch (err) {
        console.error('[Analytics] Event ingestion error:', err);
        res.status(500).json({ error: 'Failed to process events' });
    }
});

/**
 * GET /consent — Get current consent state
 */
router.get('/consent', (_req: Request, res: Response) => {
    try {
        const consent = telemetryAnalytics.getConsent();
        res.json(consent);
    } catch (err) {
        console.error('[Analytics] Consent fetch error:', err);
        res.status(500).json({ error: 'Failed to get consent state' });
    }
});

/**
 * PUT /consent — Update opt-in/opt-out consent
 */
router.put('/consent', async (req: Request, res: Response) => {
    try {
        const { optedIn } = req.body;

        if (typeof optedIn !== 'boolean') {
            return res.status(400).json({ error: 'optedIn must be a boolean' });
        }

        await telemetryAnalytics.setConsent(optedIn);
        const consent = telemetryAnalytics.getConsent();
        res.json({ success: true, consent });
    } catch (err) {
        console.error('[Analytics] Consent update error:', err);
        res.status(500).json({ error: 'Failed to update consent' });
    }
});

/**
 * GET /events — View buffered events (privacy dashboard)
 */
router.get('/events', (_req: Request, res: Response) => {
    try {
        const limit = parseInt((_req.query.limit as string) || '100', 10);
        const events = telemetryAnalytics.getBufferedEvents(limit);
        res.json({ events, total: events.length });
    } catch (err) {
        console.error('[Analytics] Events fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

/**
 * GET /summary — Event count summary
 */
router.get('/summary', (_req: Request, res: Response) => {
    try {
        const summary = telemetryAnalytics.getEventSummary();
        res.json(summary);
    } catch (err) {
        console.error('[Analytics] Summary error:', err);
        res.status(500).json({ error: 'Failed to get summary' });
    }
});

/**
 * DELETE /data — Purge all collected analytics data
 */
router.delete('/data', (_req: Request, res: Response) => {
    try {
        telemetryAnalytics.purgeAllData();
        res.json({ success: true, message: 'All analytics data has been permanently deleted.' });
    } catch (err) {
        console.error('[Analytics] Data purge error:', err);
        res.status(500).json({ error: 'Failed to purge data' });
    }
});

/**
 * POST /flush — Force flush buffered events
 */
router.post('/flush', async (_req: Request, res: Response) => {
    try {
        const flushed = await telemetryAnalytics.flush();
        res.json({ success: true, flushedCount: flushed });
    } catch (err) {
        console.error('[Analytics] Flush error:', err);
        res.status(500).json({ error: 'Failed to flush events' });
    }
});

export const analyticsRouter = router;
