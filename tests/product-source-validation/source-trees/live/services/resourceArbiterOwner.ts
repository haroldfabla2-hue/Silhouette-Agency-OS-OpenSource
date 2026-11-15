// Module-graph publication snapshot only. No runtime service import or startup.
type Arbiter = typeof import('./resourceArbiter').resourceArbiter;
let published: Arbiter | undefined;
export function publishResourceArbiter(owner: Arbiter): void {
    if (published && published !== owner) throw new Error('Resource arbiter owner already published');
    published = owner;
}
export function getPublishedResourceArbiter(): Arbiter | undefined { return published; }
