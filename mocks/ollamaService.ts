/**
 * Browser-safe Ollama Service Mock
 * Prevents ollamaService (which imports ioredis) from being bundled into the browser.
 */

export const ollamaService = {
    chat: async () => ({ message: { content: '' } }),
    generate: async () => ({ response: '' }),
    embeddings: async () => ({ embedding: [] }),
    list: async () => ({ models: [] }),
    pull: async () => { },
    delete: async () => { },
    show: async () => ({}),
    copy: async () => { },
    ps: async () => ({ models: [] }),
};

export async function generateWithOllama() {
    return { response: 'Mock response - Ollama runs on server only' };
}

export async function chatWithOllama() {
    return { message: { content: 'Mock response - Ollama runs on server only' } };
}

export default ollamaService;
