import type { RequestHandler,ErrorRequestHandler } from 'express';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { Socket } from 'node:net';
import type { ResourceScope, ReleaseReceipt } from './resourceScope';

type HttpApplication = (request: IncomingMessage, response: ServerResponse) => unknown;
interface RequestReceipt {
    readonly id:number;
    body:'PENDING'|'ENDED_COMPLETE'|'CLOSED_INCOMPLETE';
    response:'PENDING'|'FINISHED_OS_HANDOFF'|'CLOSED_BEFORE_FINISH';
    handlers:number;
    readonly clientReceipt:'UNVERIFIED';
}
interface RequestOwner {
    request:IncomingMessage;
    response:ServerResponse;
    receipt:RequestReceipt;
    detach:()=>void;
    resolveDone:()=>void;
}

// Passive association only; populated by the actual accepted HTTP dispatch.
const requestIngresses=new WeakMap<IncomingMessage,OwnedHttpIngress>();
/** Accept a descendant before scheduling it; the returned promise must include
 * the scheduled callback and actual downstream operation, not only dispatch. */
export function runHttpWork<T>(request:IncomingMessage,name:string,operation:()=>T|Promise<T>):Promise<T>{
    const ingress=requestIngresses.get(request);
    if(!ingress)return Promise.reject(new Error('HTTP descendant has no live request owner'));
    return ingress.runHandler(request,name,operation);
}
/** Callback-style middleware is complete at its actual next callback, not at
 * its synchronous return. Aborted SDK internals may never call it: keep pending. */
export function awaitHttpMiddleware(request:IncomingMessage,response:ServerResponse,name:string,middleware:RequestHandler):Promise<void>{
    return runHttpWork(request,name,async()=>{
        let called=false,resolveNext!:()=>void,rejectNext!:(error:unknown)=>void;
        const callback=new Promise<void>((resolve,reject)=>{resolveNext=resolve;rejectNext=reject;});
        const next=(error?:unknown)=>{if(called)return;called=true;error?rejectNext(error):resolveNext();};
        // Attach observation before invoking callbacks which can reject sync.
        void callback.catch(()=>{/* exact rejection rethrown after both receipts */});
        let returned:unknown;
        try{returned=middleware(request as any,response as any,next);}catch(error){next(error);}
        const returnedPromise=Promise.resolve(returned).catch(error=>{next(error);throw error;});
        const settled=await Promise.allSettled([callback,returnedPromise]);
        const failures=settled.filter((item):item is PromiseRejectedResult=>item.status==='rejected');
        if(failures.length)throw failures.length===1?failures[0].reason:new AggregateError(failures.map(item=>item.reason),'Middleware callback/returned work rejected');
    });
}

/** Bind the ACTUAL handler's returned promise to its admitted request. No
 * fallback to unowned execution when a route is mounted without the root. */
export function ownedHttpHandler(name:string,handler:RequestHandler):RequestHandler{
    return (request,response,next)=>{
        const ingress=requestIngresses.get(request);
        if(!ingress){next(new Error('HTTP handler has no bound production request owner'));return;}
        void ingress.runHandler(request,name,()=>handler(request,response,next)).catch(error=>{
            if(response.headersSent||response.destroyed){if(!response.destroyed)response.destroy();}
            else next(error);
        });
    };
}

/** Express recognizes error middleware by its actual four-argument arity.
 * A normal three-argument adapter would silently remove it from error dispatch. */
export function ownedHttpErrorHandler(name:string,handler:ErrorRequestHandler):ErrorRequestHandler{
    return (error,request,response,next)=>{
        const ingress=requestIngresses.get(request);
        if(!ingress){next(error);return;}
        void ingress.runHandler(request,name,()=>handler(error,request,response,next)).catch(cause=>{
            if(response.headersSent||response.destroyed){if(!response.destroyed)response.destroy();}
            else next(cause);
        });
    };
}

/** Explicit construction only. This does not import/build a second application.
 * The caller must supply the ACTUAL production application's request listener.
 * Register before listen; the server is owned immediately, even if bind fails.
 * No app/index/loaders currently instantiate this boundary. */
export class OwnedHttpIngress {
    readonly server:Server;
    private accepting=true;
    private binding=false;
    private bindStarted=false;
    private bindTask?:Promise<void>;
    private readonly requests=new Map<IncomingMessage,RequestOwner>();
    private readonly sockets=new Map<Socket,()=>void>();
    private readonly receipts:RequestReceipt[]=[];
    private readonly handlerTasks=new Set<Promise<unknown>>();
    private readonly waiters=new Set<()=>void>();
    private rejectedRequests=0;
    private serverCloseTask?:Promise<void>;
    private closing?:Promise<ReleaseReceipt>;

    constructor(private readonly scope:ResourceScope,private readonly application:HttpApplication){
        scope.assertAccepting();
        this.server=createServer((req,res)=>this.dispatch(req,res));
        this.server.on('connection',this.onConnection);
        this.server.on('error',this.onServerError);
        scope.own({name:'http-ingress',closeRank:-200,
            stopIntake:()=>{void this.beginShutdown();},close:()=>this.beginShutdown()});
    }
    private changed(){for(const resolve of this.waiters)resolve();this.waiters.clear();}
    private readonly onServerError=(error:Error)=>{
        this.scope.recordFailure('http-server',error);this.changed();
    };
    private readonly onConnection=(socket:Socket)=>{
        const error=(cause:Error)=>this.scope.recordDiagnostic('http-socket',cause,'OPERATION_REJECTED','UNVERIFIED');
        const closed=()=>{detach();this.sockets.delete(socket);this.changed();};
        const detach=()=>{socket.off('error',error);socket.off('close',closed);};
        this.sockets.set(socket,detach);socket.on('error',error);socket.once('close',closed);
        // Accepted sockets (including upgraded ones) stay attributed until their
        // actual close event. The protocol owner, not HTTP, initiates WS close.
    };
    public getStatus(){return {accepting:this.accepting,binding:this.binding,
        sockets:this.sockets.size,requests:this.requests.size,handlers:this.handlerTasks.size,
        rejectedRequests:this.rejectedRequests,receipts:this.receipts.map(r=>({...r})),
        applicationCoverage:'UNVERIFIED' as const,upgradedProtocolRelease:'SEPARATE_OWNER_REQUIRED' as const};}

    public listen(port:number,host:string):Promise<void>{
        if(this.bindTask&&this.accepting)return this.bindTask;
        if(!this.accepting||this.bindStarted)return Promise.reject(new Error('HTTP ingress is single-use or closing'));
        this.scope.assertAccepting();this.bindStarted=true;this.binding=true;
        this.bindTask=this.scope.run('http-bind',()=>{
            if(!this.accepting){this.binding=false;throw new Error('HTTP bind canceled before acquisition');}
            return new Promise<void>((resolve,reject)=>{
            const clean=()=>{this.server.off('listening',ready);this.server.off('error',failed);};
            const ready=()=>{clean();this.binding=false;
                if(!this.accepting){void this.closeServer();reject(new Error('HTTP bind completed after shutdown fence'));}
                else resolve();this.changed();};
            const failed=(error:Error)=>{clean();this.binding=false;reject(error);this.changed();};
            this.server.once('listening',ready);this.server.once('error',failed);
            try{this.server.listen(port,host);}catch(error){clean();this.binding=false;reject(error);this.changed();}
            });
        });
        // Prevent ignored caller rejection from becoming unhandled. The original
        // bind promise still rejects and the scope retains the actual failure.
        void this.bindTask.catch(error=>this.scope.recordFailure('http-bind',error));
        return this.bindTask;
    }
    private dispatch(request:IncomingMessage,response:ServerResponse){
        if(!this.accepting||!this.scope.accepting){
            this.rejectedRequests++;
            this.scope.recordDiagnostic('http-post-fence-request',new Error('Request refused before application dispatch'),'OPERATION_REJECTED','UNAVAILABLE');
            response.destroy();return;
        }
        const receipt:RequestReceipt={id:this.receipts.length+1,body:'PENDING',response:'PENDING',handlers:0,clientReceipt:'UNVERIFIED'};
        this.receipts.push(receipt);
        let resolveDone!:()=>void;
        const done=new Promise<void>(resolve=>{resolveDone=resolve;});
        const body=()=>{
            receipt.body=request.complete?'ENDED_COMPLETE':'CLOSED_INCOMPLETE';
            if(!request.complete)this.scope.recordDiagnostic('http-request-body',new Error('Incoming request closed before complete parsing'),'OPERATION_REJECTED','UNAVAILABLE');
            this.finishRequest(request);
        };
        const responseDone=()=>{
            receipt.response=response.writableFinished?'FINISHED_OS_HANDOFF':'CLOSED_BEFORE_FINISH';
            if(!response.writableFinished)this.scope.recordDiagnostic('http-response',new Error('Response closed before OS handoff; client receipt unverified'),'OPERATION_REJECTED','UNAVAILABLE');
            this.finishRequest(request);
        };
        const requestError=(error:Error)=>this.scope.recordDiagnostic('http-request',error,'OPERATION_REJECTED','UNVERIFIED');
        const responseError=(error:Error)=>this.scope.recordDiagnostic('http-response-stream',error,'OPERATION_REJECTED','UNVERIFIED');
        const owner:RequestOwner={request,response,receipt,resolveDone,detach:()=>{
            request.off('end',body);request.off('close',body);request.off('error',requestError);
            response.off('finish',responseDone);response.off('close',responseDone);response.off('error',responseError);
        }};
        this.requests.set(request,owner);requestIngresses.set(request,this);
        request.once('end',body);request.once('close',body);request.on('error',requestError);
        response.once('finish',responseDone);response.once('close',responseDone);response.on('error',responseError);
        if(request.readableEnded||request.destroyed)body();
        // runHandler increments synchronously before application invocation and
        // retains the exact returned promise, including work after res.end().
        // Root drain must see the complete accepted request lifetime BEFORE
        // releasing shared stores, not merely wait at the final HTTP close rank.
        void this.scope.run('http-request-lifetime',async()=>{
            try{await this.runHandler(request,'actual-application-dispatch',()=>this.application(request,response));}
            catch{if(!response.destroyed)response.destroy();}
            await done;
        }).catch(error=>{
            this.scope.recordFailure('http-request-lifetime-admission',error);
            if(!response.destroyed)response.destroy();
        });
    }
    /** Explicit wrappers must use this for each actual async route/middleware
     * callback. Express dispatch returning void does not reveal hidden promises.
     * Accepted requests may continue during quiesce, but not after their receipt
     * has ended. No automatic route coverage or descendant-task claim. */
    public runHandler<T>(request:IncomingMessage,name:string,operation:()=>T|Promise<T>):Promise<T>{
        const owner=this.requests.get(request);
        if(!owner)return Promise.reject(new Error('HTTP handler has no live accepted request'));
        owner.receipt.handlers++;
        let actual:Promise<T>;
        try{actual=Promise.resolve(operation());}catch(error){actual=Promise.reject(error);}
        this.handlerTasks.add(actual);
        void actual.then(()=>{
            this.handlerTasks.delete(actual);owner.receipt.handlers--;this.finishRequest(request);this.changed();
        },error=>{
            this.scope.recordDiagnostic('http-handler:'+name,error,'OPERATION_REJECTED','UNVERIFIED');
            this.handlerTasks.delete(actual);owner.receipt.handlers--;this.finishRequest(request);this.changed();
        });
        return actual;
    }
    private finishRequest(request:IncomingMessage){
        const owner=this.requests.get(request);if(!owner)return;
        const r=owner.receipt;
        if(r.body==='PENDING'||r.response==='PENDING'||r.handlers)return;
        owner.detach();this.requests.delete(request);requestIngresses.delete(request);owner.resolveDone();this.changed();
        if(!this.accepting)this.server.closeIdleConnections();
    }
    private closeServer():Promise<void>{
        if(this.serverCloseTask)return this.serverCloseTask;
        this.serverCloseTask=new Promise<void>((resolve,reject)=>{
            this.server.close((error?:Error)=>error?reject(error):resolve());
        });
        void this.serverCloseTask.catch(error=>this.scope.recordFailure('http-server-close',error));
        return this.serverCloseTask;
    }
    public beginShutdown():Promise<ReleaseReceipt>{
        if(this.closing)return this.closing;
        this.accepting=false; // synchronous global HTTP admission fence
        // Initiate close now unless bind is still pending. Calling close before
        // listening and treating ERR_SERVER_NOT_RUNNING as release can leak a
        // later successful bind; instead ready() initiates close at that moment.
        if(!this.binding&&this.server.listening)void this.closeServer();
        this.closing=Promise.resolve().then(async()=>{
            if(this.bindTask)await Promise.allSettled([this.bindTask]);
            if(this.server.listening&&!this.serverCloseTask)void this.closeServer();
            let closeError:unknown;
            if(this.serverCloseTask){try{await this.serverCloseTask;}catch(error){closeError=error;}}
            // A close callback is not substituted for request/handler/socket
            // receipts. No force-destroy/closeAllConnections or synthetic timeout.
            while(this.requests.size||this.handlerTasks.size||this.sockets.size){
                await new Promise<void>(resolve=>this.waiters.add(resolve));
            }
            if(closeError||this.server.listening){
                // Do not abandon attribution/listeners if close failed to stop
                // the actual listener. Root cannot qualify or restart over it.
                return {state:'UNVERIFIED',detail:'HTTP close failed or listener remains; ownership/listeners retained, restart forbidden'};
            }
            this.server.off('connection',this.onConnection);this.server.off('error',this.onServerError);
            return {state:'UNVERIFIED',detail:'Owned listener, observed bodies/responses/sockets and returned handler promises settled; complete production route/middleware/stream callback coverage remains unverified'};
        });
        return this.closing;
    }
}
