// =============================================================================
// RATE LIMITER MIDDLEWARE
// Protects the API from abuse and excessive requests.
// Uses express-rate-limit with configurable windows.
// =============================================================================

import rateLimit,{MemoryStore,type Options,type RateLimitRequestHandler} from 'express-rate-limit';
import type { RequestHandler } from 'express';
import {ResourceScope} from '../runtime/resourceScope';
import {ownedHttpHandler,runHttpWork} from '../runtime/ownedHttpIngress';


const operations=new ResourceScope('http-rate-limiters');
interface Definition {name:string;options:Partial<Options>;actual?:RateLimitRequestHandler;store?:MemoryStore}
const definitions:Definition[]=[];
let prepareTask:Promise<void>|undefined;
const cleanupTasks=new Set<Promise<void>>();
function defineOwnedLimiter(name:string,options:Partial<Options>):RateLimitRequestHandler{
    const definition:Definition={name,options};definitions.push(definition);
    const handler:RequestHandler=(request,response,next)=>{
        void runHttpWork(request,'rate-limit:'+name,()=>operations.run('rate-limit:'+name,async()=>{
            if(!definition.actual)throw new Error('Rate limiter not prepared before HTTP ingress');
            let nextCalled=false;
            const observedNext=(error?:unknown)=>{
                if(nextCalled)return;nextCalled=true;
                if(error)operations.recordFailure('rate-limit-next:'+name,error);
                next(error);
            };
            // The pinned SDK returns an actual promise. A429 response intentionally
            // does not call next: never use the next-only adapter for this SDK.
            await definition.actual(request,response,observedNext);
        })).catch(error=>{
            if(response.headersSent||response.destroyed){if(!response.destroyed)response.destroy();}
            else next(error);
        });
    };
    return Object.assign(handler,{
        resetKey:(key:string)=>operations.run('rate-reset-key:'+name,()=>{
            if(!definition.actual)throw new Error('Rate limiter is not prepared');
            return definition.actual.resetKey(key);
        }),
        getKey:(key:string)=>operations.run('rate-get-key:'+name,()=>{
            if(!definition.actual)throw new Error('Rate limiter is not prepared');
            return definition.actual.getKey(key);
        })
    }) as RateLimitRequestHandler;
}
/** Explicit real preparation before listen; never construct a fresh limiter per
 * request, never reset every client's quota on each invocation. */
export function prepareRateLimiters():Promise<void>{
    if(!operations.accepting)return Promise.reject(new Error('Rate limiter scope is closing'));
    if(prepareTask)return prepareTask;
    prepareTask=operations.run('prepare-rate-limiters',async()=>{
        for(const definition of definitions){
            const store=new MemoryStore();definition.store=store;
            // Public per-instance resetAll wrapper retains the real promise which
            // pinned shutdown otherwise discards. No private-map/prototype patch.
            const resetAll=store.resetAll;
            store.resetAll=function(){
                let actual:Promise<void>;
                try{actual=Promise.resolve(resetAll.call(this));}catch(error){actual=Promise.reject(error);}
                cleanupTasks.add(actual);
                void actual.then(()=>cleanupTasks.delete(actual),error=>{cleanupTasks.delete(actual);operations.recordFailure('rate-store-reset:'+definition.name,error);});
                return actual;
            };
            // Adopt BEFORE rateLimit calls the actual store.init (which starts its
            // unref interval). Partial prepare failure cannot abandon that timer.
            operations.own({name:'rate-store:'+definition.name,stopIntake:()=>{
                if(store.interval)clearInterval(store.interval);
            },close:async()=>{
                store.shutdown();
                while(cleanupTasks.size)await Promise.allSettled([...cleanupTasks]);
                return {state:'UNVERIFIED',detail:'Pinned MemoryStore interval clear/reset promises retained; executable callback/drain/root qualification not performed'};
            }});
            definition.actual=rateLimit({...definition.options,store,
                // SDK discards config.handler's returned promise. Bind the exact
                // fixed-message/default429 body as real HTTP descendant work.
                handler:ownedHttpHandler('rate-limit-429:'+definition.name,async(_request,response)=>{
                    response.status(429);
                    if(!response.writableEnded)response.send(definition.options.message);
                })});
        }
    });
    void prepareTask.catch(error=>operations.recordFailure('rate-limit-first-preparation',error));
    return prepareTask;
}
export function shutdownRateLimiters(){return operations.close();}
export function getRateLimiterStatus(){return {prepared:definitions.filter(d=>d.actual).map(d=>d.name),
    accepting:operations.accepting,failures:operations.getFailures(),diagnostics:operations.getDiagnostics(),
    policyDurability:'MEMORY_ONLY_ORIGINAL',internalRelease:'UNVERIFIED'};}

// ─── Global Rate Limiter ─────────────────────────────────────────────────────

/**
 * Global rate limiter: 100 requests per minute per IP.
 * Applies to all endpoints.
 */
export const globalLimiter = defineOwnedLimiter('global',{
    windowMs: 60 * 1000, // 1 minute
    max: 1000,
    standardHeaders: true,    // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,     // Disable `X-RateLimit-*` headers
    message: {
        error: 'Too many requests',
        retryAfterMs: 60_000,
        hint: 'Rate limit: 100 requests per minute',
    },
});

// ─── Chat Rate Limiter ───────────────────────────────────────────────────────

/**
 * Chat/LLM rate limiter: 30 requests per minute per IP.
 * These endpoints are expensive (LLM inference).
 */
export const chatLimiter = defineOwnedLimiter('chat',{
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many chat requests',
        retryAfterMs: 60_000,
        hint: 'Chat rate limit: 30 requests per minute',
    },
});

// ─── Admin Rate Limiter ──────────────────────────────────────────────────────

/**
 * Admin rate limiter: 10 requests per minute per IP.
 * Extra restrictive for sensitive operations.
 */
export const adminLimiter = defineOwnedLimiter('admin',{
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'Too many admin requests',
        retryAfterMs: 60_000,
        hint: 'Admin rate limit: 10 requests per minute',
    },
});
