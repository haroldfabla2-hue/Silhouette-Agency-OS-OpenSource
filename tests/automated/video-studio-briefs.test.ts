import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { VideoStudioService } from '../../services/videoStudioService';

describe('videoStudioService (Fase 1)', () => {
    let dir: string;
    let svc: VideoStudioService;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-'));
        svc = new VideoStudioService(path.join(dir, 'test.sqlite'));
    });

    function insert(status: string): string {
        const row: any = {
            id: 'brief_test' + Math.random().toString(16).slice(2, 8),
            idea: 'idea', brief_json: '{}', status,
            errors: '[]', attempts: 1,
            created_at: Date.now(), updated_at: Date.now()
        };
        (svc as any).db.prepare(`INSERT INTO video_briefs
            (id, idea, brief_json, status, errors, attempts, created_at, updated_at)
            VALUES (@id, @idea, @brief_json, @status, @errors, @attempts, @created_at, @updated_at)`).run(row);
        return row.id;
    }

    it('approve transitions AWAITING_SCRIPT_OK -> APPROVED', () => {
        const id = insert('AWAITING_SCRIPT_OK');
        expect(svc.approve(id).status).toBe('APPROVED');
    });

    it('gate: approve refuses anything not AWAITING_SCRIPT_OK', () => {
        const id = insert('FAILED');
        expect(() => svc.approve(id)).toThrow(/only AWAITING_SCRIPT_OK/);
        const id2 = insert('APPROVED');
        expect(() => svc.approve(id2)).toThrow(/only AWAITING_SCRIPT_OK/);
    });

    it('reject transitions AWAITING_SCRIPT_OK -> REJECTED and is terminal', () => {
        const id = insert('AWAITING_SCRIPT_OK');
        expect(svc.reject(id).status).toBe('REJECTED');
        expect(() => svc.approve(id)).toThrow(/only AWAITING_SCRIPT_OK/);
    });

    it('unknown brief id fails loudly', () => {
        expect(() => svc.approve('brief_nope')).toThrow(/not found/);
        expect(svc.getBrief('brief_nope')).toBeNull();
    });

    it('idea vacia falla en voz alta', async () => {
        await expect(svc.generateBriefFromIdea('  ')).rejects.toThrow(/idea is required/);
    });
});
