// Browser shim for geminiService.
// LLM calls run on the SERVER through the LLM Gateway. This shim exists only
// so the browser bundle builds; it never returns a fabricated model response.

const unavailable = (): Error => new Error(
    'UNAVAILABLE: geminiService cannot run in the browser. ' +
    'Call the backend LLM gateway (POST /v1/chat or /v1/llm/...) instead.'
);

export const geminiService = {
    generateAgentResponse: async (): Promise<never> => { throw unavailable(); },
    generateAgentResponseStream: async (): Promise<never> => { throw unavailable(); },
    configureGenAI: () => { /* no-op in browser: configuration is server-side */ }
};

export const generateAgentResponse = async (): Promise<never> => { throw unavailable(); };
export const generateAgentResponseStream = async (): Promise<never> => { throw unavailable(); };
export const configureGenAI = () => { /* no-op in browser */ };
