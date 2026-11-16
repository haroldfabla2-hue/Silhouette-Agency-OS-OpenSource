import {ResourceScope} from '../runtime/resourceScope';
interface AIReceipt {name:string;state:'PENDING'|'RETURNED_UNVERIFIED'|'DEGRADED'|'DISABLED';detail?:string}
const operations=new ResourceScope('ai-loader');
const receipts:AIReceipt[]=[];
let initialization:Promise<void>|undefined;
let phase:'NEW'|'INITIALIZING'|'RETURNED_UNQUALIFIED'|'FAILED'='NEW';
function receipt(name:string):AIReceipt{const r:AIReceipt={name,state:'PENDING'};receipts.push(r);return r;}
// Named phase receipts contain no key/config values. Raw owner errors below
// are private diagnostics, NOT a safe HTTP/log serialization API.
export function getAILoaderStatus(){return {phase,receipts:receipts.map(r=>({...r})),readiness:'UNVERIFIED',
    descendants:'UNVERIFIED',pendingDurable:false,failures:operations.getFailures(),diagnostics:operations.getDiagnostics()};}
// Drains returned loader work only. Does NOT revoke shared SDK/config/registry
// while active consumers still require them. Root must compose their own owners.
export function shutdownAILoader(){return operations.close();}
export function initAIServices():Promise<void>{
    if(!operations.accepting)return Promise.reject(new Error('AI loader closing'));
    if(initialization)return initialization;
    phase='INITIALIZING';
    operations.own({name:'ai-loader-coverage',close:()=>({state:'UNVERIFIED',detail:'Actual loader/import/configure/initialize returns retained, not hidden SDK/module/registry/store work or release/durability proof'})});
    initialization=operations.run('actual-initAIServices',async()=>{
        operations.assertAccepting();
        const {externalProvidersDisabled,loadRuntimeEnvironment}=await import('../config/runtimeCredentials');
        operations.assertAccepting();loadRuntimeEnvironment();
        console.log('[LOADER] Initializing AI Services...');
    // ─── Minimum Viable Config Check ─────────────────────────────────────────
    // Verify at least one LLM provider key is configured before proceeding.
    const knownKeys = [
        process.env.GEMINI_API_KEY,
        process.env.GROQ_API_KEY,
        process.env.DEEPSEEK_API_KEY,
        process.env.OPENROUTER_API_KEY,
        process.env.MINIMAX_API_KEY,
    ];
    const hasProvider = knownKeys.some(k => k && k.trim().length > 0 && !k.startsWith('YOUR_'));
    if (!hasProvider) {
        console.warn(`
╔══════════════════════════════════════════════════════════╗
║            ⚠️  NO LLM PROVIDER CONFIGURED               ║
╠══════════════════════════════════════════════════════════╣
║  The orchestrator cannot think without an AI provider.   ║
║                                                          ║
║  Add at least ONE key to your .env.local:               ║
║    GEMINI_API_KEY=your_key     (recommended - free tier) ║
║    GROQ_API_KEY=your_key       (fast, free tier)         ║
║    OPENROUTER_API_KEY=your_key (multi-model access)      ║
║    DEEPSEEK_API_KEY=your_key   (coding specialist)       ║
║                                                          ║
║  Or run the setup wizard:  npm run setup:intelligent     ║
╚══════════════════════════════════════════════════════════╝
        `);
    }

    const vectorReceipt=receipt('vector-memory');
    // 1. Vector Memory
    try {
        operations.assertAccepting();
        const {vectorMemory}=await import('../../services/vectorMemoryService');
        operations.assertAccepting();const actual=await vectorMemory.connect();
        vectorReceipt.state=actual.state==='ready'?'RETURNED_UNVERIFIED':actual.state==='disabled'?'DISABLED':'DEGRADED';
        vectorReceipt.detail=actual.state;
        if(actual.state==='unavailable')operations.recordDiagnostic('ai-vector-memory',new Error('Actual Qdrant unavailable'),'DEGRADED_FALLBACK','UNAVAILABLE');
    } catch (e) {
        vectorReceipt.state='DEGRADED';
        operations.recordDiagnostic('ai-vector-memory',e,'DEGRADED_FALLBACK','UNAVAILABLE');
    }

    operations.assertAccepting();
    const genAIReceipt=receipt('genai-configuration');
    const {sqliteService}=await import('../../services/sqliteService');
    // 2. Hydrate GenAI Config
    const apiKey = externalProvidersDisabled() ? undefined : sqliteService.getConfig('systemApiKey') || process.env.GEMINI_API_KEY;
    if (apiKey) {
        operations.assertAccepting();
        const {configureGenAI}=await import('../../services/geminiService');
        operations.assertAccepting();await configureGenAI(apiKey);
        genAIReceipt.state='RETURNED_UNVERIFIED';
        genAIReceipt.detail='Local SDK configuration returned; no provider request/capability or retired client release proof';
    }else{genAIReceipt.state=externalProvidersDisabled()?'DISABLED':'DEGRADED';}

    // 3. Configure MediaService with API keys from environment
    const mediaConfig = {
        executionMode: 'SERVER' as const,
        replicateKey: process.env.REPLICATE_API_TOKEN,
        openaiKey: process.env.OPENAI_API_KEY,
        imagineArtKey: process.env.IMAGINE_ART_KEY,
        elevenLabsKey: process.env.ELEVENLABS_API_KEY,
        unsplashKey: process.env.UNSPLASH_ACCESS_KEY
    };

    const mediaReceipt=receipt('media-configuration');
    // Only log configured providers
    const configuredProviders = Object.entries(mediaConfig)
        .filter(([k, v]) => v && k !== 'executionMode')
        .map(([k]) => k.replace('Key', ''));

    if (configuredProviders.length > 0) {
        operations.assertAccepting();
        const {mediaService}=await import('../../services/mediaService');
        operations.assertAccepting();await mediaService.updateConfig(mediaConfig);
        mediaReceipt.state='RETURNED_UNVERIFIED';
        mediaReceipt.detail='Local merge returned; no provider request/readiness/durability/release proof';
        console.log(`[LOADER] ✅ MediaService Configured. Providers: ${configuredProviders.join(', ')}`);
    } else {
        mediaReceipt.state=externalProvidersDisabled()?'DISABLED':'DEGRADED';
        console.warn("[LOADER] ⚠️ No media API keys found in environment. Image/video generation will fail.");
    }

    const toolsReceipt=receipt('tool-registry');
    // 4. Initialize Tool Registry (CRITICAL for tool execution)
    // This registers all core tools including generate_image, web_search, etc.
    try {
        operations.assertAccepting();
        const {toolRegistry}=await import('../../services/tools/toolRegistry');
        operations.assertAccepting();await toolRegistry.initialize();
        toolsReceipt.state='RETURNED_UNVERIFIED';
        toolsReceipt.detail='Actual initialization returned; persisted tool fallback/module descendants require own receipts';
    } catch (e) {
        toolsReceipt.state='DEGRADED';
        operations.recordDiagnostic('ai-tool-registry',e,'DEGRADED_FALLBACK','UNAVAILABLE');
    }
        operations.assertAccepting();phase='RETURNED_UNQUALIFIED';
    });
    void initialization.catch(error=>{phase='FAILED';operations.recordFailure('ai-loader-first-initialization',error);});
    return initialization;
}
