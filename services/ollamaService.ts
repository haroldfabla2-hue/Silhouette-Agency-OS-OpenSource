import { ResourceScope } from '../server/runtime/resourceScope';
import { localInferenceAllowed, assertLocalInferenceAllowed } from './security/localInferencePolicy';
import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Ollama } from 'ollama';
import { REDIS_CONFIG } from '../constants';
import Redis from 'ioredis';

// --- TYPES ---
interface OllamaJobData {
    type: 'generate' | 'embedding';
    payload: any;
}

interface OllamaJobResult {
    success: boolean;
    data?: any;
    error?: string;
}

// --- CIRCUIT BREAKER CONFIG ---
const CB_THRESHOLD = 3;
const CB_TIMEOUT_MS = 30000; // 30 seconds cooldown

export class OllamaService {
    private ollama?:Ollama;
    private readonly operations=new ResourceScope('ollama');
    private quiescing=false;
    private infraPromise?:Promise<void>;
    private infraFailed=false;
    private workerClose?:Promise<void>;
    private eventsClose?:Promise<void>;
    private readonly connections:Array<{connection:Redis;ended:()=>boolean;end:Promise<void>;detach:()=>void}>=[];
    private readonly cancelWaiters=new Set<(reason?:Error)=>void>();
    private readonly streams=new Set<{stop:()=>Promise<unknown>}>();
    private readonly jobs:Array<{sequence:number;type:string;id?:string;enqueue:'PENDING'|'ACK'|'UNKNOWN';work:string;localWait:string;payload?:OllamaJobData}>=[];
    public getLifecycleStatus(){return {quiescing:this.quiescing,infraReady:this.infraReady,infraFailed:this.infraFailed,
        jobs:this.jobs.map(({payload,...receipt})=>({...receipt})),streams:this.streams.size,
        observedRedis:this.connections.length,redisEndEvents:this.connections.filter(c=>c.ended()).length,
        diagnostics:this.operations.getDiagnostics(),failures:this.operations.getFailures(),
        sdkRelease:'UNVERIFIED' as const,pendingDurable:false};}
    public getPendingJobIntents(){return this.jobs.filter(j=>!['COMPLETED_EVENT','COMPLETED_READBACK'].includes(j.work)).map(j=>({...j,payload:j.payload?{...j.payload,payload:{...j.payload.payload,...(Array.isArray(j.payload.payload?.stop)?{stop:[...j.payload.payload.stop]}:{})}}:undefined}));}
    private client():Ollama{
        assertLocalInferenceAllowed();this.operations.assertWorkAccepted();
        if(!this.ollama){this.operations.assertAccepting();this.ollama=new Ollama({host:'http://localhost:11434'});}
        return this.ollama;
    }
    public shutdownLifecycle(){this.startQuiesce();return this.operations.close();}
    private startQuiesce(){
        if(this.quiescing)return;this.quiescing=true;
        for(const cancel of [...this.cancelWaiters])cancel();
        // abort() is only an initiation for streams already registered by SDK.
        // Initial headers/no-stream fetches and physical pool release remain unknown.
        try{this.ollama?.abort();}catch(error){this.operations.recordFailure('ollama-abort-initiation',error);}
        for(const stream of [...this.streams])void stream.stop().catch(error=>this.operations.recordFailure('ollama-stream-return',error));
        if(this.worker){this.workerClose=this.worker.close(false);void this.workerClose.catch(error=>this.operations.recordFailure('ollama-worker-close',error));}
        if(this.queueEvents){this.eventsClose=this.queueEvents.close();void this.eventsClose.catch(error=>this.operations.recordFailure('ollama-events-close',error));}
    }
    private sdkError(name:string,error:unknown){
        if(name==='ollama-events-loop'||name==='ollama-worker-loop'){
            this.infraFailed=true;this.operations.recordFailure(name,error);
            for(const cancel of [...this.cancelWaiters])cancel(new Error('Ollama queue loop failed; job outcome remains unknown'));
            return;
        }
        if(this.quiescing)this.operations.recordFailure(name,error);
        else this.operations.recordDiagnostic(name,error,'UNCLASSIFIED','UNVERIFIED');
    }
    private trackStream(make:()=>AsyncGenerator<string,void,unknown>):AsyncGenerator<string,void,unknown>{
        const raw=make();let started=false,ended=false,resolveDone!:()=>void;
        const done=new Promise<void>(resolve=>{resolveDone=resolve;});
        const finish=()=>{ended=true;this.streams.delete(entry);resolveDone();};
        const entry={stop:async()=>{if(started&&!ended){try{await raw.return(undefined);}finally{finish();}}}};
        const begin=()=>{
            if(started)return;
            if(this.quiescing)throw new Error('Ollama stream intake closed');
            this.operations.assertAccepting();started=true;this.streams.add(entry);
            void this.operations.run('ollama-stream-lifetime',()=>done).catch(error=>this.operations.recordFailure('ollama-stream-admission',error));
        };
        const step=async(method:'next'|'return'|'throw',value?:any):Promise<IteratorResult<string,void>>=>{
            if(ended)return {done:true,value:undefined};
            if(method==='next'&&this.quiescing)throw new Error('Ollama stream intake closed');
            if(method==='next')begin();
            if(!started){finish();return {done:true,value:undefined};}
            try{
                const result=await raw[method](value);
                if(result.done)finish();
                // Actual work is drained separately; do not publish a late chunk.
                if(this.quiescing&&method==='next')return {done:true,value:undefined};
                return result;
            }catch(error){this.operations.recordDiagnostic('ollama-stream',error,'OPERATION_REJECTED','UNVERIFIED');finish();throw error;}
        };
        return {next:(...args:[]|[unknown])=>step('next',args[0]),return:value=>step('return',value),throw:error=>step('throw',error),[Symbol.asyncIterator](){return this;}};
    }

    // BullMQ infra is created lazily (on first enqueue) so that merely importing
    // this module never opens a Redis connection — that previously produced
    // *unhandled* ioredis 'error' events (and could crash the process / fail CI)
    // whenever Redis was unavailable.
    private queue?: Queue;
    private worker?: Worker;
    private queueEvents?: QueueEvents;
    private infraReady = false;

    // Circuit Breaker State
    private failureCount = 0;
    private lastFailureTime = 0;
    private isCircuitOpen = false;

    private readonly QUEUE_NAME = 'ollama-execution-queue';
    public serviceName = "Ollama Native Brain";

    constructor(){
        // Passive owner only. No Ollama client, Redis, Worker or request here.
        this.operations.own({name:'ollama-sdk-and-infra',stopIntake:()=>this.startQuiesce(),close:async()=>{
            this.startQuiesce();
            await Promise.allSettled([this.workerClose,this.eventsClose].filter((p):p is Promise<void>=>Boolean(p)));
            if(this.queue){try{await this.queue.close();}catch(error){this.operations.recordFailure('ollama-queue-close',error);}}
            for(const entry of this.connections){
                if(!entry.ended()){
                    try{await entry.connection.quit();}catch(error){this.operations.recordFailure('ollama-redis-quit',error);entry.connection.disconnect();}
                    await entry.end;
                }
                entry.detach();
            }
            // BullMQ's internal duplicates/cleanup errors, Ollama reader/fetch
            // initial phases and global HTTP pool cannot be inferred released.
            return {state:'UNVERIFIED',detail:'Application promises and explicit Redis end events retained; SDK duplicate/pool/reader release and queued-job durability remain unverified'};
        }});
    }
    private ensureInfra():Promise<void>{
        assertLocalInferenceAllowed();this.operations.assertWorkAccepted();
        if(this.infraFailed)return Promise.reject(new Error('Ollama infrastructure previously failed; no duplicate restart'));
        if(this.infraPromise)return this.infraPromise;
        this.operations.assertAccepting();
        this.infraPromise=this.operations.run('ollama-infra-readiness',async()=>{
            this.operations.assertAccepting();
            const redisOptions={host:REDIS_CONFIG.host,port:REDIS_CONFIG.port,password:REDIS_CONFIG.password,maxRetriesPerRequest:null};
            const adoptConnection=(connection:Redis):Redis=>{
                let ended=false,resolveEnd!:()=>void;
                const end=new Promise<void>(resolve=>{resolveEnd=resolve;});
                const onEnd=()=>{ended=true;resolveEnd();};
                const onError=(error:unknown)=>this.sdkError('ollama-redis',error);
                connection.on('error',onError);connection.once('end',onEnd);
                const duplicate=connection.duplicate;
                const ownedDuplicate:Redis['duplicate']=(...args)=>adoptConnection(duplicate.apply(connection,args));
                connection.duplicate=ownedDuplicate;
                this.connections.push({connection,end,ended:()=>ended,detach:()=>{
                    connection.off('error',onError);connection.off('end',onEnd);
                    if(connection.duplicate===ownedDuplicate)connection.duplicate=duplicate;
                }});
                return connection;
            };
            const makeConnection=()=>adoptConnection(new Redis(redisOptions));
            // Capture each real object immediately, including partial setup.
            this.queue=new Queue(this.QUEUE_NAME,{connection:makeConnection()});
            this.queue.on('error',error=>this.sdkError('ollama-queue',error));
            this.queueEvents=new QueueEvents(this.QUEUE_NAME,{connection:makeConnection(),autorun:false});
            this.queueEvents.on('error',error=>this.sdkError('ollama-queue-events',error));
            this.worker=new Worker(this.QUEUE_NAME,async(job:Job)=>{
                const receipt=job.id?this.jobs.find(j=>j.id===job.id):undefined;
                if(receipt)receipt.work='ACTIVE';
                if(this.quiescing)throw new Error('Ollama processor quiescing; no new provider effect');
                const result=await this.processJob(job);
                if(receipt)receipt.work='PROVIDER_RETURNED';
                return result;
            },{connection:makeConnection(),concurrency:1,autorun:false});
            this.worker.on('error',error=>this.sdkError('ollama-worker',error));
            this.worker.on('failed',(job,error)=>{
                const receipt=job?.id?this.jobs.find(j=>j.id===job.id):undefined;if(receipt)receipt.work='FAILED_EVENT';
                this.operations.recordDiagnostic('ollama-job-failed',error,'OPERATION_REJECTED','UNAVAILABLE');this.handleFailure();
            });
            this.worker.on('completed',(job,result:OllamaJobResult)=>{
                const receipt=job.id?this.jobs.find(j=>j.id===job.id):undefined;
                if(receipt){receipt.work=result?.success===true?'COMPLETED_EVENT':'UNKNOWN_RESULT';if(result?.success===true)receipt.payload=undefined;}
                if(result?.success===true)this.handleSuccess();
            });
            // Explicit loops retain their actual final promises. They are stopped
            // during stopIntake, BEFORE operations.close waits the drain set.
            void this.operations.run('ollama-queue-events-loop',()=>this.queueEvents!.run()).catch(error=>this.sdkError('ollama-events-loop',error));
            void this.operations.run('ollama-worker-loop',()=>this.worker!.run()).catch(error=>this.sdkError('ollama-worker-loop',error));
            await Promise.all([this.queue.waitUntilReady(),this.queueEvents.waitUntilReady(),this.worker.waitUntilReady()]);
            this.operations.assertAccepting();this.infraReady=true;
        });
        void this.infraPromise.catch(error=>{this.infraFailed=true;this.operations.recordFailure('ollama-infra-readiness',error);});
        return this.infraPromise;
    }
    private async enqueue(type:OllamaJobData['type'],data:OllamaJobData,options?:{priority:number}):Promise<OllamaJobResult>{
        await this.ensureInfra();this.operations.assertWorkAccepted();
        if(this.quiescing||this.infraFailed)throw new Error('Ollama quiescing or infrastructure failed before enqueue; no new queue.add attempted');
        const receipt={sequence:this.jobs.length+1,type,id:undefined as string|undefined,enqueue:'PENDING' as 'PENDING'|'ACK'|'UNKNOWN',work:'ENQUEUE_PENDING',localWait:'PENDING',payload:data as OllamaJobData|undefined};
        this.jobs.push(receipt);
        let job:Job;
        try{job=await this.queue!.add(type,data,options);
            if(typeof job.id!=='string'||!job.id)throw new Error('Enqueue returned no usable job ID; outcome unknown');
            receipt.id=job.id;receipt.enqueue='ACK';receipt.work='QUEUED';}
        catch(error){receipt.enqueue='UNKNOWN';receipt.work='UNKNOWN';receipt.localWait='REJECTED';this.operations.recordFailure('ollama-enqueue-outcome-unknown',error);throw error;}
        if(this.quiescing){receipt.localWait='CANCELLED_LOCAL';throw new Error('Ollama wait canceled locally; enqueued job retained for reconciliation');}
        return this.waitForJob(job,receipt);
    }
    private waitForJob(job:Job,receipt:OllamaService['jobs'][number]):Promise<OllamaJobResult>{
        // Do not call pinned waitUntilFinished's async Promise executor: a
        // readiness/readback rejection there can escape without settling waiter.
        let settled=false,resolve!: (value:OllamaJobResult)=>void,reject!:(error:unknown)=>void;
        const result=new Promise<OllamaJobResult>((yes,no)=>{resolve=yes;reject=no;});
        const events=this.queueEvents!;
        const completedEvent=`completed:${job.id}`,failedEvent=`failed:${job.id}`;
        const cleanup=()=>{events.off(completedEvent,completed);events.off(failedEvent,failed);this.cancelWaiters.delete(cancel);};
        const complete=(value:OllamaJobResult,state:string)=>{if(settled)return;
            if(!value||value.success!==true){receipt.work='UNKNOWN_RESULT';fail(new Error('Job returned an invalid success receipt; no replay'),'RESULT_UNKNOWN');return;}
            settled=true;cleanup();receipt.work=state;receipt.localWait='COMPLETED';receipt.payload=undefined;resolve(value);};
        const fail=(error:unknown,state:string)=>{if(settled)return;settled=true;cleanup();receipt.localWait=state;reject(error);};
        const completed=(args?:{returnvalue:OllamaJobResult})=>complete(args?.returnvalue as OllamaJobResult,'COMPLETED_EVENT');
        const failed=(args?:{failedReason?:string})=>{receipt.work='FAILED_EVENT';fail(new Error(args?.failedReason??'Queued job failed'),'FAILED_EVENT');};
        const cancel=(reason?:Error)=>fail(reason??new Error('Ollama local waiter canceled; job/provider outcome remains separate'),reason?'READBACK_UNKNOWN':'CANCELLED_LOCAL');
        events.on(completedEvent,completed);events.on(failedEvent,failed);this.cancelWaiters.add(cancel);
        if(this.quiescing){cancel();return result;}
        void this.operations.run('ollama-job-wait-readback',async()=>{
            await events.waitUntilReady();if(settled)return;
            const state=await job.getState();if(settled)return;
            if(state==='completed'||state==='failed'){
                const fresh=await Job.fromId(this.queue!,job.id!);if(settled)return;
                if(!fresh){receipt.work='UNKNOWN';throw new Error('Enqueued job missing during terminal readback; no replay');}
                if(state==='completed')complete(fresh.returnvalue,'COMPLETED_READBACK');
                else {receipt.work='FAILED_READBACK';fail(new Error(fresh.failedReason),'FAILED_READBACK');}
            }else if(state==='unknown'){receipt.work='UNKNOWN';throw new Error('Job state unknown; reconcile before any replay');}
        }).catch(error=>fail(error,'READBACK_UNKNOWN'));
        return result;
    }

    async initialize(): Promise<void> {
        if(this.quiescing)return Promise.reject(new Error('Ollama intake closing'));
        return this.operations.run('initialize',async()=>{
        if(this.quiescing)throw new Error('Ollama initialization quiescing');

        if (await this.checkStatus()) {
            console.log("🟢 Ollama Native Brain is ONLINE (Buffered & Robust).");
        } else {
            console.warn("⚠️ Ollama is unreachable. queued requests will wait or fail.");
        }
    
        });
    }

    async checkStatus(): Promise<boolean> {
        if(this.quiescing)return Promise.reject(new Error('Ollama intake closing'));
        return this.operations.run('checkStatus',async()=>{
        if(this.quiescing)throw new Error('Ollama work quiescing before invocation');

        if (!localInferenceAllowed()) return false;
        if (this.isCircuitOpen) return false;
        try {
            await this.client().list(); // Simple ping
            return true;
        } catch (error) {
            this.operations.recordDiagnostic('checkStatus',error,'DEGRADED_FALLBACK','UNVERIFIED');

            return false;
        }
    
        });
    }

    /**
     * Circuit Breaker Logic
     */
    private handleFailure() {
        this.failureCount++;
        if (this.failureCount >= CB_THRESHOLD) {
            this.isCircuitOpen = true;
            this.lastFailureTime = Date.now();
            console.error(`[Ollama] 🔴 CIRCUIT BREAKER OPENED. Pausing requests for ${CB_TIMEOUT_MS}ms.`);
        }
    }

    private handleSuccess() {
        if (this.failureCount > 0) {
            this.failureCount = 0;
            if (this.isCircuitOpen) {
                console.log(`[Ollama] 🟢 CIRCUIT BREAKER CLOSED. Resuming operations.`);
                this.isCircuitOpen = false;
            }
        }
    }

    private checkCircuit(): boolean {
        if (this.isCircuitOpen) {
            if (Date.now() - this.lastFailureTime > CB_TIMEOUT_MS) {
                // Half-open: Try one request
                console.log(`[Ollama] 🟡 Circuit Half-Open. Testing connection...`);
                return true; // Allow attempt
            }
            return false; // Reject
        }
        return true;
    }

    /**
     * The Processor: Logic executed by the Worker
     */


    private async processJob(job: Job): Promise<OllamaJobResult> {
        if(this.quiescing)return Promise.reject(new Error('Ollama processor quiescing; no provider effect admitted'));
        return this.operations.run('processJob',async()=>{
        if(this.quiescing)throw new Error('Ollama work quiescing before invocation');

        assertLocalInferenceAllowed();
        if (!this.checkCircuit()) {
            throw new Error("Ollama Circuit Breaker is OPEN. Service unavailable.");
        }

        // [PA-036] INTELLIGENT RESOURCE CHECK
        const { resourceArbiter } = await import('./resourceArbiter');
        const metrics = await resourceArbiter.getRealMetrics();
        if(this.quiescing)throw new Error('Ollama provider invocation fenced after metrics');
        assertLocalInferenceAllowed();
        const vramUsage = metrics.vramUsed / metrics.vramTotal;

        // If VRAM is critical (>92%) and we are not in a retry loop (simplified)
        if (vramUsage > 0.92) {
            console.warn(`[Ollama] 🛑 GPU Saturated (${(vramUsage * 100).toFixed(1)}%). Rejecting job to protect system.`);
            throw new Error("GPU_SATURATION_PROTECTION"); // Will trigger retry strategies
        }

        const { type, payload } = job.data as OllamaJobData;

        try {
            let result;
            if (type === 'generate') {
                // Typed Payload for Generate
                const { prompt, stop, max_tokens, model } = payload;
                const response = await this.client().generate({
                    model: model || process.env.OLLAMA_LOCAL_MODEL?.trim() || 'qwen3:4b',
                    prompt: prompt,
                    stream: false, // We use BullMQ, so streaming is harder. Batch mode for now.
                    options: {
                        stop: stop,
                        num_predict: max_tokens || 500,
                        temperature: 0.7,
                        top_p: 0.9,
                        num_gpu: 99, // [OPTIMIZATION] Force GPU offloading
                        num_ctx: 2048 // [OPTIMIZATION] Limit context to save RAM
                    }
                });
                result = response.response;

            } else if (type === 'embedding') {
                const { text, model } = payload;
                const response = await this.client().embeddings({
                    model: model || 'nomic-embed-text',
                    prompt: text
                });
                result = response.embedding;
            }

            return { success: true, data: result };

        } catch (error: any) {
            this.operations.recordDiagnostic('processJob',error,'OPERATION_REJECTED','UNVERIFIED');

            console.error(`[Ollama Worker] Error processing ${type}:`, error.message);
            throw error; // Will trigger 'failed' event
        }
    
        });
    }

    /**
     * Public API: Enqueues a generation request
     * @param tier 'fast' (GLM-4 Light), 'smart' (GLM-4 Light), or 'legacy' (GLM-4 Light fallback)
     * NOTE: All tiers now unified to GLM-4 Light for VRAM efficiency.
     *       Silhouette model will handle AGI tasks when trained.
     * @param priority BullMQ priority (lower = higher priority). 0 = highest (chat), 100 = low (background tasks)
     */
    async generateCompletion(
        prompt: string,
        stopSequences: string[] = ["User:", "System:"],
        tier: 'fast' | 'smart' | 'legacy' = 'fast',
        priority: number = 0,
        model: string = process.env.OLLAMA_LOCAL_MODEL?.trim() || 'qwen3:4b'
    ): Promise<string> {
        if(this.quiescing)return Promise.reject(new Error('Ollama intake closing'));
        return this.operations.run('generateCompletion',async()=>{
        if(this.quiescing)throw new Error('Ollama work quiescing before invocation');

        // [MODIFIED] Support dynamic model selection, defaulting to GLM-4 Light
        const modelToUse = model || process.env.OLLAMA_LOCAL_MODEL?.trim() || 'qwen3:4b';

        const result=await this.enqueue('generate',{type:'generate',payload:{prompt,stop:[...stopSequences],model:modelToUse}},{priority});
        return result.data;
    
        });
    }

    /**
     * Public API: Enqueues an embedding request
     */
    async generateEmbedding(text: string): Promise<number[]> {
        if(this.quiescing)return Promise.reject(new Error('Ollama intake closing'));
        return this.operations.run('generateEmbedding',async()=>{
        if(this.quiescing)throw new Error('Ollama work quiescing before invocation');

        const result=await this.enqueue('embedding',{type:'embedding',payload:{text,model:'nomic-embed-text'}});
        return result.data;
    
        });
    }

    /**
     * Public API: Checks if Ollama is reachable
     */
    async isAvailable(): Promise<boolean> {
        if(this.quiescing)return Promise.reject(new Error('Ollama intake closing'));
        return this.operations.run('isAvailable',async()=>{
        if(this.quiescing)throw new Error('Ollama work quiescing before invocation');

        return await this.checkStatus();
    
        });
    }

    /**
     * Public API: Fast, simple generation without complex stop sequences
     */
    async generateSimpleResponse(prompt: string): Promise<string> {
        if(this.quiescing)return Promise.reject(new Error('Ollama intake closing'));
        return this.operations.run('generateSimpleResponse',async()=>{
        if(this.quiescing)throw new Error('Ollama work quiescing before invocation');

        return await this.generateCompletion(prompt, [], 'fast'); // Default to Fast tier
    
        });
    }
    /**
     * Public API: Direct Streaming for Chat Fallback (Bypasses Queue for Latency)
     */
    public generateStream(prompt:string,model:string=process.env.OLLAMA_LOCAL_MODEL?.trim()||'qwen3:4b'):AsyncGenerator<string,void,unknown>{
        return this.trackStream(()=>this.rawGenerateStream(prompt,model));
    }
    public generateChatStream(messages:{role:string,content:string}[],model:string=process.env.OLLAMA_LOCAL_MODEL?.trim()||'qwen3:4b'):AsyncGenerator<string,void,unknown>{
        return this.trackStream(()=>this.rawGenerateChatStream(messages,model));
    }
    private async * rawGenerateStream(prompt: string, model: string = process.env.OLLAMA_LOCAL_MODEL?.trim() || 'qwen3:4b'): AsyncGenerator<string, void, unknown> {
        assertLocalInferenceAllowed();
        // [R2] Errors are thrown, never yielded as content: an error string in the
        // stream used to be persisted as an assistant response and stored as "facts".
        if (!this.checkCircuit()) {
            throw new Error('[Ollama Circuit Open - Local Brain Offline]');
        }

        let ownedStream:{abort:()=>void}|undefined;
        try {
            const stream = await this.client().generate({
                model: model,
                prompt: prompt,
                stream: true,
                options: { temperature: 0.7 }
            });

            ownedStream=stream;
            if(this.quiescing)stream.abort();
            for await (const chunk of stream) {
                yield chunk.response;
            }

            this.handleSuccess();
        } catch (error: any) {
            this.handleFailure();
            console.error("[Ollama Stream Error]", error);
            throw error;
        }finally{
            try{ownedStream?.abort();}catch(error){this.operations.recordFailure('ollama-owned-stream-abort',error);}
        }
    }

    /**
     * Public API: Chat Streaming (Messages Array) - Best for Context Retention
     */
    private async * rawGenerateChatStream(messages: { role: string, content: string }[], model: string = process.env.OLLAMA_LOCAL_MODEL?.trim() || 'qwen3:4b'): AsyncGenerator<string, void, unknown> {
        assertLocalInferenceAllowed();
        // [R2] Errors are thrown, never yielded as content (see generateStream).
        if (!this.checkCircuit()) {
            throw new Error('[Ollama Circuit Open - Local Brain Offline]');
        }

        let ownedStream:{abort:()=>void}|undefined;
        try {
            const stream = await this.client().chat({
                model: model,
                messages: messages,
                stream: true,
                options: { temperature: 0.7 }
            });

            ownedStream=stream;
            if(this.quiescing)stream.abort();
            for await (const chunk of stream) {
                yield chunk.message.content;
            }

            this.handleSuccess();
        } catch (error: any) {
            this.handleFailure();
            console.error("[Ollama Chat Error]", error);
            throw error;
        }finally{
            try{ownedStream?.abort();}catch(error){this.operations.recordFailure('ollama-owned-stream-abort',error);}
        }
    }
    /**
     * Public API: Forcefully unload a model from VRAM
     */
    async unloadModel(modelName: string): Promise<boolean> {
        if(this.quiescing)return Promise.reject(new Error('Ollama intake closing'));
        return this.operations.run('unloadModel',async()=>{
        if(this.quiescing)throw new Error('Ollama work quiescing before invocation');

        if (!localInferenceAllowed()) return false;
        try {
            console.log(`[Ollama] 📉 Unloading model: ${modelName}`);
            // Sending an empty request with keep_alive: 0 forces immediate unload
            await this.client().generate({
                model: modelName,
                prompt: '',
                keep_alive: 0
            });
            return true;
        } catch (error) {
            this.operations.recordDiagnostic('unloadModel',error,'DEGRADED_FALLBACK','UNVERIFIED');

            console.warn(`[Ollama] Failed to unload ${modelName}:`, error);
            return false;
        }
    
        });
    }
}

export const ollamaService = new OllamaService();
