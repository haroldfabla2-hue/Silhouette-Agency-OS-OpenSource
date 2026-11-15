import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sqliteService } from '../../services/sqliteService';
import { qualityControl, QUALITY_WINDOW_MINUTES } from '../../services/qualityControlService';

// Spy on the real service (no module mock): the qualityControl import chain
// builds the orchestrator, which needs a working sqliteService at init.
describe('system quality score window', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('uses a 24h error window so a failed night stays visible in the morning', () => {
        const spy = vi.spyOn(sqliteService, 'getRecentLogs').mockReturnValue([]);
        qualityControl.getSystemQualityScore();
        expect(spy).toHaveBeenCalledWith('ERROR', 24 * 60);
        expect(QUALITY_WINDOW_MINUTES).toBe(24 * 60);
    });

    it('deducts 2 points per error inside the window', () => {
        vi.spyOn(sqliteService, 'getRecentLogs').mockReturnValue(new Array(7).fill({}));
        const { score, stability } = qualityControl.getSystemQualityScore();
        expect(score).toBe(86);
        expect(stability).toBe('GOOD');
    });

    it('floors at 0 with COLLAPSE_IMMINENT on heavy error load', () => {
        vi.spyOn(sqliteService, 'getRecentLogs').mockReturnValue(new Array(60).fill({}));
        const { score, stability } = qualityControl.getSystemQualityScore();
        expect(score).toBe(0);
        expect(stability).toBe('COLLAPSE_IMMINENT');
    });
});
