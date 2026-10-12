/**
 * Tanda 5 truthfulness remediation tests (video worker A2-real).
 * The worker must generate through the real media stack and never emit a
 * fabricated/placeholder video; without credentials it reports an honest
 * UNAVAILABLE with activation instructions.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const emitted: Array<{ protocol: any; payload: any }> = [];
let videoHandler: ((event: any) => Promise<void>) | null = null;

vi.mock('../../services/systemBus', () => ({
    systemBus: {
        subscribe: vi.fn((protocol: any, handler: any) => { videoHandler = handler; }),
        emit: vi.fn((protocol: any, payload: any) => { emitted.push({ protocol, payload }); }),
    },
}));
vi.mock('../../services/media/videoFactory', () => ({
    videoFactory: { createVideo: vi.fn() },
}));
vi.mock('../../services/media/veoService', () => ({
    veoService: { isAvailable: vi.fn() },
}));

import { videoFactory } from '../../services/media/videoFactory';
import { veoService } from '../../services/media/veoService';
import '../../services/workers/videoWorker';

const createVideo = videoFactory.createVideo as unknown as ReturnType<typeof vi.fn>;
const isAvailable = veoService.isAvailable as unknown as ReturnType<typeof vi.fn>;

const job = { prompt: 'a cat skateboarding', jobId: 'job-1', agentId: 'agent-x' };

describe('A2/T5: video worker uses the real stack or honest UNAVAILABLE', () => {
    beforeEach(() => {
        emitted.length = 0;
        createVideo.mockReset();
        isAvailable.mockReset();
    });

    it('subscribes to video requests', () => {
        expect(videoHandler).toBeTypeOf('function');
    });

    it('cloud engine without REPLICATE_API_TOKEN => UNAVAILABLE incident, no completion', async () => {
        isAvailable.mockReturnValue(false);
        await videoHandler!({ payload: job });
        expect(createVideo).not.toHaveBeenCalled();
        const incidents = emitted.filter(e => String(e.protocol).includes('INCIDENT'));
        expect(incidents).toHaveLength(1);
        expect(incidents[0].payload.error).toContain('UNAVAILABLE');
        expect(incidents[0].payload.error).toContain('REPLICATE_API_TOKEN');
        expect(emitted.some(e => String(e.protocol).includes('COMPLETION'))).toBe(false);
    });

    it('cloud success emits the REAL provider URL as the result', async () => {
        isAvailable.mockReturnValue(true);
        createVideo.mockResolvedValue({ url: 'https://replicate.delivery/x/video.mp4', provider: 'VEO_3.1', audioUrl: undefined });
        await videoHandler!({ payload: job });
        const completions = emitted.filter(e => String(e.protocol).includes('COMPLETION'));
        expect(completions).toHaveLength(1);
        expect(completions[0].payload.result).toBe('https://replicate.delivery/x/video.mp4');
        expect(completions[0].payload.queued).toBeUndefined();
    });

    it('local queue ticket is reported as QUEUED, never as a finished video', async () => {
        isAvailable.mockReturnValue(true);
        createVideo.mockResolvedValue({ url: 'ticket-123', provider: 'LOCAL_QUEUE_WAN' });
        await videoHandler!({ payload: { ...job, engine: 'WAN' } });
        const completions = emitted.filter(e => String(e.protocol).includes('COMPLETION'));
        expect(completions).toHaveLength(1);
        expect(completions[0].payload.queued).toBe(true);
        expect(completions[0].payload.howToRender).toContain('process_video_queue');
    });

    it('factory failure => honest incident with the real error', async () => {
        isAvailable.mockReturnValue(true);
        createVideo.mockRejectedValue(new Error('Replicate 402: insufficient credit'));
        await videoHandler!({ payload: job });
        const incidents = emitted.filter(e => String(e.protocol).includes('INCIDENT'));
        expect(incidents[0].payload.error).toContain('insufficient credit');
    });

    it('source contains no fabricated result paths', () => {
        const src = readFileSync(join(process.cwd(), 'services/workers/videoWorker.ts'), 'utf-8');
        expect(src).not.toContain('giphy');
        expect(src).not.toContain('(Simulated)');
        expect(src).not.toContain('stable-video-diffusion');
    });
});
