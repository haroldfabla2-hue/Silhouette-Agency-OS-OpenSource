// Isolated validation overlay only. Fixed once-per-module markers, never values.
// No timer, Promise, state update, new request or arbitrary console payload.
const stages = ['AUTO_LOGIN_JSON_FULFILLED', 'TRUST_RESULT_RETURNED',
    'SCREEN_AUTHENTICATED_SELECTED', 'SCREEN_UNREACHABLE_SELECTED',
    'SCREEN_SETUP_SELECTED', 'SCREEN_LOGIN_SELECTED', 'SETUP_FIRST_PASSIVE_EFFECT'] as const;
type Stage = typeof stages[number];
const emitted = new Set<Stage>();
export function markInitialAuthContinuation(stage: Stage): void {
    if (!stages.includes(stage) || emitted.has(stage)) return;
    emitted.add(stage);
    try { console.info('SILHOUETTE_BROWSER_BOUNDARY:' + stage); } catch { /* diagnostic only */ }
}
