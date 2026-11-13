// Read-only module-graph publication. No runtime service import/startup.
type Narrative = typeof import('./narrativeService').narrative;
let published: Narrative | undefined;
export function publishNarrative(owner: Narrative): void {
    if (published && published !== owner) throw new Error('Narrative owner already published');
    published = owner;
}
export function getPublishedNarrative(): Narrative | undefined { return published; }
