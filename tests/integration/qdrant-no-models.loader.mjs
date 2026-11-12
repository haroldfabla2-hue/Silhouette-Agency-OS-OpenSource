import fs from 'node:fs';
let audit;
export function initialize(data) { audit = data.audit; }
export async function resolve(specifier, context, nextResolve) {
    const resolved = await nextResolve(specifier, context);
    if (/\/(geminiService|localEmbeddingService|dreamerService|orchestrator|narrativeService|backgroundLlmService)\.[cm]?[jt]s(?:\?|$)/.test(resolved.url)
        || /\/(?:@xenova\/transformers|onnxruntime[^/]*|@google\/genai)\//.test(resolved.url)) {
        fs.appendFileSync(audit, 'blocked_model_or_bootstrap_module\n');
        throw new Error('Model/bootstrap modules are forbidden in this real-Qdrant consumer test');
    }
    return resolved;
}
