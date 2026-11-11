/** Pure read of the explicit process mode. Does not load files or network. */
export function acceptanceBoot(): boolean {
    const mode = typeof process === 'undefined' ? undefined : process.env.SILHOUETTE_BOOT_MODE;
    if (mode === undefined || mode === '' || mode === 'normal') return false;
    if (mode === 'acceptance') return true;
    throw new Error('Invalid SILHOUETTE_BOOT_MODE (normal or acceptance)');
}

/** Process-start policy, not a request/config toggle. Changing it needs a restart.
 * OFF isolates external provider credentials while leaving local stores enabled.
 * ON preserves existing behavior; it does not grant authority for any effect.
 */
const externalProviderMode = typeof process === 'undefined' ? undefined : process.env.SILHOUETTE_PROVIDERS;
if (externalProviderMode !== undefined && externalProviderMode !== '' && !['on', 'off'].includes(externalProviderMode)) {
    throw new Error('Invalid SILHOUETTE_PROVIDERS (on or off)');
}
export function externalProvidersDisabled(): boolean {
    return acceptanceBoot() || externalProviderMode === 'off';
}

export function assertExternalProvidersEnabled(): void {
    if (externalProvidersDisabled()) throw new Error('External providers disabled by process policy');
}
