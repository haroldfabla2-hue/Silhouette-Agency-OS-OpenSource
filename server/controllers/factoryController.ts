import { ResourceScope } from '../runtime/resourceScope';
import { subscribeScoped } from '../../services/runtime/scopedSubscription';

import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { systemBus } from '../../services/systemBus';
import { SystemProtocol } from '../../types';
import { sqliteService } from '../../services/sqliteService';

export const factoryEvents = new EventEmitter();

const factoryScope = new ResourceScope('factory-events');
let bridgeStarted = false;
export function startFactoryEvents(): void {
    factoryScope.assertAccepting();
    if (bridgeStarted) return; bridgeStarted = true;
// --- GLOBAL BUS BRIDGE ---
subscribeScoped(factoryScope, systemBus, SystemProtocol.UI_REFRESH, (e) => factoryEvents.emit('bus_event', e));
subscribeScoped(factoryScope, systemBus, SystemProtocol.COST_ANOMALY, (e) => factoryEvents.emit('bus_event', e));
subscribeScoped(factoryScope, systemBus, SystemProtocol.TASK_PAUSED, (e) => factoryEvents.emit('bus_event', e));
subscribeScoped(factoryScope, systemBus, SystemProtocol.THOUGHT_EMISSION, (e) => factoryEvents.emit('bus_event', e));
subscribeScoped(factoryScope, systemBus, SystemProtocol.MEMORY_CREATED, (e) => factoryEvents.emit('bus_event', e));
subscribeScoped(factoryScope, systemBus, SystemProtocol.INTUITION_CONSOLIDATED, (e) => factoryEvents.emit('bus_event', e));
subscribeScoped(factoryScope, systemBus, SystemProtocol.VISUAL_REQUEST, (e) => factoryEvents.emit('bus_event', e));
subscribeScoped(factoryScope, systemBus, SystemProtocol.GENESIS_UPDATE, (e) => factoryEvents.emit('bus_event', e)); // Projects real-time
subscribeScoped(factoryScope, systemBus, SystemProtocol.NARRATIVE_UPDATE, (e) => factoryEvents.emit('bus_event', e)); // Unified Stream


}
export function closeFactoryEvents() { return factoryScope.close(); }

export class FactoryController {

    public streamEvents(req:Request,res:Response){
        factoryScope.assertAccepting();
        let resolveDone!:()=>void,ended=false;
        const done=new Promise<void>(resolve=>{resolveDone=resolve;});
        let release:()=>Promise<void>=async()=>{};
        let interval:ReturnType<typeof setInterval>|undefined;
        const sendEvent=(data:any)=>{
            if(ended||res.destroyed||res.writableEnded)return;
            void factoryScope.run('factory-sse-event',()=>{
                if(!ended&&!res.destroyed&&!res.writableEnded)res.write(`data: ${JSON.stringify(data)}\n\n`);
            }).catch(()=>{/* actual rejected callback retained by factoryScope */});
        };
        const logHandler=(log:string)=>sendEvent({type:'LOG',message:log});
        const busHandler=(event:any)=>sendEvent({type:event.type,payload:event.payload});
        const cleanupIntake=()=>{
            if(interval!==undefined){clearInterval(interval);interval=undefined;}
            factoryEvents.off('log',logHandler);factoryEvents.off('bus_event',busHandler);
        };
        const finish=()=>{
            if(ended)return;ended=true;cleanupIntake();
            if(!res.writableFinished)factoryScope.recordDiagnostic('factory-sse-response',new Error('SSE response closed before finish; client receipt unverified'),'OPERATION_REJECTED','UNAVAILABLE');
            res.off('finish',finish);res.off('close',finish);res.off('error',onError);
            resolveDone();void release();
        };
        const onError=(error:Error)=>factoryScope.recordDiagnostic('factory-sse-stream',error,'OPERATION_REJECTED','UNVERIFIED');
        res.once('finish',finish);res.once('close',finish);res.on('error',onError);
        release=factoryScope.own({name:'factory-sse',stopIntake:()=>{cleanupIntake();if(!res.destroyed&&!res.writableEnded)res.end();},close:async()=>{cleanupIntake();await done;}});
        // Scope owns response lifetime too, rather than relying on req.close,
        // which can mean only that the incoming request body has completed.
        void factoryScope.run('factory-sse-lifetime',()=>done).catch(error=>factoryScope.recordFailure('factory-sse-lifetime',error));
        try{
            res.setHeader('Content-Type','text/event-stream');res.setHeader('Cache-Control','no-cache');res.setHeader('Connection','keep-alive');res.flushHeaders();
            if(ended||res.destroyed||res.writableFinished){finish();return;}
            factoryEvents.on('log',logHandler);factoryEvents.on('bus_event',busHandler);
            interval=setInterval(()=>{
                if(ended||res.destroyed||res.writableEnded)return;
                void factoryScope.run('factory-sse-heartbeat',()=>{
                    if(!ended&&!res.destroyed&&!res.writableEnded)res.write(': heartbeat\n\n');
                }).catch(()=>{/* actual heartbeat rejection retained */});
            },15000);
        }catch(error){
            factoryScope.recordDiagnostic('factory-sse-setup',error,'OPERATION_REJECTED','UNAVAILABLE');
            if(!res.destroyed)res.destroy();throw error;
        }
        if(res.writableFinished||res.destroyed)finish();
    }

    public async legacySpawnProject(req: Request, res: Response) {
        try {
            const { genesisService } = await import('../../services/genesisService');
            const project = await genesisService.spawnProject(req.body);
            res.json({ success: true, project });
        } catch (e: any) {
            console.error("Spawn Error", e);
            if (!res.headersSent) res.status(500).json({ error: e.message || "Spawn failed" });
        }
    }

    public listProjects(req: Request, res: Response) {
        const projects = sqliteService.getConfig('genesisProjects') || [];
        res.json(projects);
    }

    public getConfig(req: Request, res: Response) {
        const config = sqliteService.getConfig('genesisConfig') || { workspaceRoot: './workspace' };
        res.json(config);
    }

    public async updateConfig(req: Request, res: Response) {
        const { config } = req.body;
        let currentConfig = sqliteService.getConfig('genesisConfig') || { workspaceRoot: './workspace' };
        currentConfig = { ...currentConfig, ...config };

        // Ensure workspace exists if root changed
        const rootDir = process.cwd();
        const wsPath = path.join(rootDir, currentConfig.workspaceRoot);
        if (!fs.existsSync(wsPath)) {
            fs.mkdirSync(wsPath, { recursive: true });
        }

        sqliteService.setConfig('genesisConfig', currentConfig);
        res.json({ success: true, config: currentConfig });
    }
}

export const factoryController = new FactoryController();

