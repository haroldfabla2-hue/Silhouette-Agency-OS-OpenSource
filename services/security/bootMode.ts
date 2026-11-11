/** Pure read of the explicit process mode. Does not load files or network. */
export function acceptanceBoot(): boolean {
    const mode = typeof process === 'undefined' ? undefined : process.env.SILHOUETTE_BOOT_MODE;
    if (mode === undefined || mode === '' || mode === 'normal') return false;
    if (mode === 'acceptance') return true;
    throw new Error('Invalid SILHOUETTE_BOOT_MODE (normal or acceptance)');
}
