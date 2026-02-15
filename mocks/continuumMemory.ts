// Mock for Continuum Memory in browser
export const continuum = {
    retrieve: async () => [],
    store: async () => { },
    update: async () => { },
    delete: async () => { },
    query: async () => []
};

export class ContinuumMemorySystem {
    constructor() { }
    async retrieve() { return []; }
    async store() { }
}
