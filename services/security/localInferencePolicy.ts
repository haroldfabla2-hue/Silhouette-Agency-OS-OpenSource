/** Deployment policy. This does not grant permission to run a model.
 * cloud-only rejects local inference before model loading, Redis or HTTP.
 * mixed retains existing opt-in/caller behavior for other deployments.
 */
export function localInferenceAllowed(): boolean {
    const mode = process.env.SILHOUETTE_INFERENCE_MODE || 'mixed';
    if (mode !== 'mixed' && mode !== 'cloud-only') {
        throw new Error('Invalid SILHOUETTE_INFERENCE_MODE (mixed or cloud-only)');
    }
    return mode === 'mixed';
}

export function assertLocalInferenceAllowed(): void {
    if (!localInferenceAllowed()) throw new Error('LOCAL_INFERENCE_DISABLED: cloud-only process policy');
}
