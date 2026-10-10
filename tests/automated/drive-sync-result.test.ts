import { describe, it, expect } from 'vitest';
import { interpretUpload, driveFileName } from '../../components/canvas/hooks/driveSyncResult';

describe('Drive sync result (regression: failed uploads returned a silent false)', () => {
    it('success needs success + file id', () => {
        expect(interpretUpload({ success: true, file: { id: 'f1', name: 'a.ncx' } }).ok).toBe(true);
    });
    it('missing file, success:false, null and empty responses are visible failures with a message', () => {
        for (const r of [{ success: true }, { success: false, error: 'quota' }, null, undefined, {}]) {
            const o: any = interpretUpload(r as any);
            expect(o.ok).toBe(false);
            expect(typeof o.error).toBe('string');
            expect(o.error.length).toBeGreaterThan(3);
        }
        expect((interpretUpload({ success: false, error: 'quota' }) as any).error).toBe('quota');
    });
    it('file names are versioned and unique per version', () => {
        const a = driveFileName('My Doc!', 'doc1', 1, 1000);
        const b = driveFileName('My Doc!', 'doc1', 2, 1000);
        expect(a).not.toBe(b);
        expect(a).toBe('My_Doc___doc1__v1__1000.ncx');
    });
});
