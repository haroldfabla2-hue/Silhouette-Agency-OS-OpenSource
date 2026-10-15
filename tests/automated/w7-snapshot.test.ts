/**
 * [Ticket W7] Capability snapshot persistence moved to the sqlite KV
 * (operational state, not semantic knowledge). Roundtrip: persist -> load
 * restores the same structure, $0, no LanceDB involved.
 */
import { describe, it, expect } from 'vitest';
import { capabilityAwareness } from '../../services/capabilityAwareness';
import { sqliteService } from '../../services/sqliteService';

describe('W7 capability snapshot via sqlite KV', () => {
    it('persistSnapshot writes to sqlite config (not LanceDB)', async () => {
        await (capabilityAwareness as any).persistSnapshot();
        const persisted = sqliteService.getConfig('capabilitySnapshot');
        expect(persisted).toBeTruthy();
        expect(persisted).toHaveProperty('tools');
        expect(persisted).toHaveProperty('agents');
        expect(persisted).toHaveProperty('squads');
        expect(persisted).toHaveProperty('lastUpdated');
    });

    it('loadPersistedSnapshot restores without throwing', async () => {
        await (capabilityAwareness as any).persistSnapshot();
        await expect((capabilityAwareness as any).loadPersistedSnapshot()).resolves.not.toThrow();
    });
});
