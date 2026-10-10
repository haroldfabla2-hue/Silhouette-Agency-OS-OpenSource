export interface ActionAsset {
    id: string;
    type: 'image' | 'video' | 'audio' | 'file';
    url: string;
    prompt?: string;
    alt?: string;
}

export type AssetActionResult =
    | { kind: 'done'; message: string; url: string }
    | { kind: 'failed'; message: string }
    | { kind: 'delegate'; text: string };

type Post = <T>(path: string, body: unknown) => Promise<T>;

/**
 * Runs asset actions for real and VERIFIES the outcome (a non-empty result url).
 * Previously the chat only sent "Please upscale/regenerate..." as a message and nothing was checked.
 * - upscale: images only, POST /v1/media/upscale.
 * - regenerate: images with a known prompt, POST /v1/media/generate/image.
 * - anything else keeps the old behaviour (delegate to the agent via chat) so no capability is lost.
 */
export async function runAssetAction(action: string, asset: ActionAsset, post: Post): Promise<AssetActionResult> {
    const fallbackText = action === 'upscale' ? `Please upscale the asset: ${asset.id}` : `Please regenerate the asset: ${asset.id}`;
    if (action !== 'upscale' && action !== 'regenerate') return { kind: 'delegate', text: fallbackText };
    if (asset.type !== 'image') return { kind: 'delegate', text: fallbackText };

    try {
        if (action === 'upscale') {
            const res = await post<{ url?: string }>('/v1/media/upscale', { image: asset.url, scale: 4 });
            if (!res?.url) return { kind: 'failed', message: 'Upscale did not return an image. Nothing was changed.' };
            return { kind: 'done', message: 'Upscaled to 4K.', url: res.url };
        }
        const prompt = asset.prompt || asset.alt;
        if (!prompt) return { kind: 'delegate', text: fallbackText };
        const res = await post<{ url?: string }>('/v1/media/generate/image', { prompt });
        if (!res?.url) return { kind: 'failed', message: 'Regeneration did not return an image. Nothing was changed.' };
        return { kind: 'done', message: 'Regenerated.', url: res.url };
    } catch (e: any) {
        return { kind: 'failed', message: `${action === 'upscale' ? 'Upscale' : 'Regeneration'} failed: ${e?.message || 'unknown error'}` };
    }
}
