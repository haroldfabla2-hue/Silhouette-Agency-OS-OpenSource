/**
 * Browser-safe Ollama Service shim.
 * Prevents ollamaService (which imports ioredis) from being bundled into the browser.
 * Returning empty strings/arrays would fabricate model output, so every call
 * fails loudly with an honest UNAVAILABLE instead.
 */

const unavailable = (): Error => new Error(
    'UNAVAILABLE: ollamaService is server-side only. Call the backend LLM gateway instead.'
);

export const ollamaService = {
    chat: async (): Promise<never> => { throw unavailable(); },
    generate: async (): Promise<never> => { throw unavailable(); },
    embeddings: async (): Promise<never> => { throw unavailable(); },
    list: async (): Promise<never> => { throw unavailable(); },
    pull: async (): Promise<never> => { throw unavailable(); },
    delete: async (): Promise<never> => { throw unavailable(); },
    show: async (): Promise<never> => { throw unavailable(); },
    copy: async (): Promise<never> => { throw unavailable(); },
    ps: async (): Promise<never> => { throw unavailable(); }
};

export async function chatWithOllama(): Promise<never> { throw unavailable(); }

export default ollamaService;
