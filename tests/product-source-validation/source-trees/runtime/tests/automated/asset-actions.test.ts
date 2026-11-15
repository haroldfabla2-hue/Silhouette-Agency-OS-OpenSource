import { describe, it, expect } from 'vitest';
import { runAssetAction } from '../../components/chat/assetActions';

const img = { id: 'a1', type: 'image' as const, url: 'http://x/a.png', prompt: 'a red car' };
const okPost = (url?: string) => (async () => ({ url })) as any;

describe('asset actions (regression: only sent a chat message, nothing executed or verified)', () => {
    it('upscale calls the real endpoint and verifies a url', async () => {
        const calls: any[] = [];
        const r = await runAssetAction('upscale', img, (async (p: string, b: any) => { calls.push([p, b]); return { url: 'http://x/4k.png' }; }) as any);
        expect(r).toMatchObject({ kind: 'done', url: 'http://x/4k.png' });
        expect(calls[0]).toEqual(['/v1/media/upscale', { image: 'http://x/a.png', scale: 4 }]);
    });
    it('empty result is a visible failure, not success', async () => {
        expect((await runAssetAction('upscale', img, okPost(undefined))).kind).toBe('failed');
        expect((await runAssetAction('regenerate', img, okPost(''))).kind).toBe('failed');
    });
    it('API errors are reported with the message', async () => {
        const r: any = await runAssetAction('upscale', img, (async () => { throw new Error('quota exceeded'); }) as any);
        expect(r.kind).toBe('failed'); expect(r.message).toContain('quota exceeded');
    });
    it('regenerate uses the asset prompt', async () => {
        const calls: any[] = [];
        await runAssetAction('regenerate', img, (async (p: string, b: any) => { calls.push([p, b]); return { url: 'u' }; }) as any);
        expect(calls[0]).toEqual(['/v1/media/generate/image', { prompt: 'a red car' }]);
    });
    it('no capability lost: video/audio and prompt-less assets still delegate to the agent', async () => {
        expect((await runAssetAction('regenerate', { ...img, type: 'video' }, okPost('u'))).kind).toBe('delegate');
        expect((await runAssetAction('regenerate', { id: 'b', type: 'image', url: 'u' }, okPost('u'))).kind).toBe('delegate');
        expect((await runAssetAction('favorite', img, okPost('u'))).kind).toBe('delegate');
    });
});
