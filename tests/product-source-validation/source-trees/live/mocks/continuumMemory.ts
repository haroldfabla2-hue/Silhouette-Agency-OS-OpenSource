// Browser shim for continuumMemory.
// Memory lives on the SERVER. This shim exists only so the browser bundle
// builds; silently returning [] would fabricate an "empty memory", so reads
// and writes fail loudly with an honest UNAVAILABLE instead.

const unavailable = (): Error => new Error(
    'UNAVAILABLE: continuum memory is server-side only. ' +
    'Use the backend memory API instead of importing this service in the browser.'
);

export const continuum = {
    retrieve: async (): Promise<never> => { throw unavailable(); },
    store: async (): Promise<never> => { throw unavailable(); },
    update: async (): Promise<never> => { throw unavailable(); },
    delete: async (): Promise<never> => { throw unavailable(); },
    query: async (): Promise<never> => { throw unavailable(); }
};

export class ContinuumMemorySystem {
    async retrieve(): Promise<never> { throw unavailable(); }
    async store(): Promise<never> { throw unavailable(); }
}
